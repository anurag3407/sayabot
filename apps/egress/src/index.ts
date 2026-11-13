import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http"
import { request as httpsRequest } from "node:https"
import { connect, type Socket } from "node:net"
import { URL } from "node:url"
import { timingSafeEqual } from "node:crypto"
import { Hono } from "hono"
import { serve } from "@hono/node-server"
import { assertSafeEgressHost } from "./ssrf"
import { flushGrantCache, forgetIdentity, isHostAllowed, proxySecretFrom, resolveAgentIdentityBySecret, reportViolation, requestApproval, resolveAgentIdentity, resolvePlaceholder } from "./swapper"
import { scrubResponseText } from "./scrub"

const PROXY_PORT = Number(process.env.PROXY_PORT || 8080)
const ADMIN_PORT = Number(process.env.ADMIN_PORT || 8081)
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://orchestrator:4000"
const INTERNAL_SECRET = process.env.ORCHESTRATOR_INTERNAL_SECRET || ""

const PLACEHOLDER_RE = /saaya_ph_[A-Za-z0-9_-]{32,}/g

// ── Admin Server (:8081) ────────────────────────────────────────────────────

const adminApp = new Hono()

adminApp.use("*", async (c, next) => {
  if (c.req.path === "/health") return next()
  const secretHeader = c.req.header("x-internal-secret")
  const authHeader = c.req.header("authorization")
  const provided = secretHeader ?? (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined)
  if (!INTERNAL_SECRET || !provided) return c.json({ error: "unauthorized" }, 401)
  const a = Buffer.from(provided)
  const b = Buffer.from(INTERNAL_SECRET)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return c.json({ error: "unauthorized" }, 401)
  await next()
})

adminApp.get("/health", (c) => {
  return c.json({ ok: true, service: "egress", proxyPort: PROXY_PORT })
})

adminApp.post("/flush", (c) => {
  flushGrantCache()
  return c.json({ flushed: true })
})

// Computer IPs are reused as bot computers sleep and wake; computerd resets the
// IP -> agent mapping before a container that received an IP can send traffic.
adminApp.post("/identity/forget", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { containerIp?: unknown } | null
  if (!body || typeof body.containerIp !== "string" || !body.containerIp) {
    return c.json({ error: "containerIp required" }, 400)
  }
  return c.json({ forgotten: forgetIdentity(body.containerIp) })
})

serve({ fetch: adminApp.fetch, port: ADMIN_PORT }, () => {
  console.log(`[egress] admin server listening on :${ADMIN_PORT}`)
})

// ── Background SSE cache invalidator ────────────────────────────────────────

function startInvalidationStream() {
  if (!ORCHESTRATOR_URL || !INTERNAL_SECRET) return

  async function connectStream() {
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/internal/egress/stream`, {
        headers: { "x-internal-secret": INTERNAL_SECRET },
      })
      if (!res.ok || !res.body) return

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (line.includes("vault_changed")) {
            console.log("[egress] vault_changed event received; flushing cache")
            flushGrantCache()
          }
        }
      }
    } catch {
      // Reconnect after 5 seconds
      setTimeout(connectStream, 5000)
    }
  }

  connectStream()
}

startInvalidationStream()

// ── Computer identity ───────────────────────────────────────────────────────

// A proxy credential is sent on the first request of a connection; keep-alive requests
// that follow on the same TCP connection inherit it.
const connectionIdentity = new WeakMap<Socket, { agentId: string; orgId: string }>()

async function identifyConnection(
  req: IncomingMessage,
): Promise<{ agentId: string; orgId: string } | null | "invalid"> {
  const secret = proxySecretFrom(req.headers["proxy-authorization"])
  if (secret) {
    const identity = await resolveAgentIdentityBySecret(secret)
    if (!identity) return "invalid"
    connectionIdentity.set(req.socket, identity)
    return identity
  }
  const bound = connectionIdentity.get(req.socket)
  if (bound) return bound
  const remoteIp = req.socket.remoteAddress?.replace(/^::ffff:/, "") || ""
  return remoteIp ? resolveAgentIdentity(remoteIp) : null
}

// ── Proxy Listener (:8080) ──────────────────────────────────────────────────

const proxyServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const rawUrl = req.url || "/"
    let parsedUrl: URL
    try {
      parsedUrl = new URL(rawUrl)
    } catch {
      res.writeHead(400, { "content-type": "text/plain" })
      res.end("Bad Request: Invalid URL")
      return
    }

    const host = parsedUrl.hostname

    // Identify the computer: by per-agent proxy credential (microVM computers, added by
    // computerd on the host side) or else by container IP on botnet (Docker computers).
    let agentId = "anonymous"
    const identified = await identifyConnection(req)
    if (identified === "invalid") {
      res.writeHead(407, { "content-type": "text/plain", "proxy-authenticate": 'Basic realm="saaya"' })
      res.end("saaya: invalid proxy credential")
      return
    }
    if (identified?.agentId) agentId = identified.agentId
    // Reject attempts to spoof x-saaya-agent-id if it contradicts resolved container IP
    const headerAgentId = req.headers["x-saaya-agent-id"] as string | undefined
    if (headerAgentId && agentId !== "anonymous" && headerAgentId !== agentId) {
      res.writeHead(403, { "content-type": "text/plain" })
      res.end("saaya: agent identity mismatch")
      return
    }

    // 1. SSRF Check & IP Pinning to prevent TOCTOU DNS Rebinding
    let safeIps: string[]
    try {
      safeIps = await assertSafeEgressHost(host)
    } catch (e: any) {
      console.warn(`[egress] SSRF blocked: ${e.message}`)
      res.writeHead(403, { "content-type": "text/plain" })
      res.end(`saaya: forbidden host (${e.message})`)
      return
    }
    const pinnedIp = safeIps[0]!
    const isIpv6 = pinnedIp.includes(":")

    // 2. Read request body
    const bodyChunks: Buffer[] = []
    for await (const chunk of req) {
      bodyChunks.push(Buffer.from(chunk))
    }
    let bodyBuffer = Buffer.concat(bodyChunks)
    let bodyText = bodyBuffer.toString("utf8")

    // 3. Scan headers & body for placeholders
    const secretsToPlaceholder = new Map<string, string>()
    const headers = { ...req.headers }
    delete headers["host"]
    delete headers["proxy-authorization"]
    delete headers["proxy-connection"]

    // Check placeholder occurrences
    const placeholderSet = new Set<string>()
    for (const val of Object.values(headers)) {
      if (typeof val === "string") {
        const matches = val.match(PLACEHOLDER_RE)
        if (matches) matches.forEach((m) => placeholderSet.add(m))
      }
    }
    const bodyMatches = bodyText.match(PLACEHOLDER_RE)
    if (bodyMatches) bodyMatches.forEach((m) => placeholderSet.add(m))

    // 4. Resolve placeholders and swap
    for (const ph of placeholderSet) {
      try {
        const grant = await resolvePlaceholder(agentId, ph)

        // Check host allowlist
        if (!isHostAllowed(host, grant.hostAllowlist)) {
          await reportViolation(agentId, host, `Secret not allowed for host: ${host}`)
          res.writeHead(403, { "content-type": "text/plain" })
          res.end(`saaya: secret is not allowed for ${host}`)
          return
        }

        // Check approval if required
        if (grant.requiresApproval) {
          const decision = await requestApproval(agentId, grant.grantId, parsedUrl.toString(), req.method || "GET")
          if (decision !== "approved") {
            res.writeHead(403, { "content-type": "text/plain" })
            res.end("saaya: human approval rejected or timed out")
            return
          }
        }

        // Record for scrubbing response
        secretsToPlaceholder.set(grant.secretPlaintext, ph)

        // Swap in headers
        for (const [k, v] of Object.entries(headers)) {
          if (typeof v === "string" && v.includes(ph)) {
            headers[k] = v.replaceAll(ph, grant.secretPlaintext)
          }
        }

        // Swap in body
        if (bodyText.includes(ph)) {
          bodyText = bodyText.replaceAll(ph, grant.secretPlaintext)
          bodyBuffer = Buffer.from(bodyText, "utf8")
        }
      } catch (e: any) {
        res.writeHead(502, { "content-type": "text/plain" })
        res.end(`saaya: secret broker error (${e.message})`)
        return
      }
    }

    // 5. Forward request
    const isHttps = parsedUrl.protocol === "https:"
    const requester = isHttps ? httpsRequest : httpRequest
    const port = parsedUrl.port || (isHttps ? 443 : 80)

    const clientReq = requester(
      {
        protocol: parsedUrl.protocol,
        hostname: host,
        port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: req.method,
        headers,
        lookup: (_hostname, opts, cb) => {
          const callback = typeof opts === "function" ? opts : cb
          callback(null, pinnedIp, isIpv6 ? 6 : 4)
        },
        servername: host,
      },
      (upstreamRes) => {
        // Collect and scrub response
        const respChunks: Buffer[] = []
        upstreamRes.on("data", (c) => respChunks.push(Buffer.from(c)))
        upstreamRes.on("end", () => {
          const respBuffer = Buffer.concat(respChunks)
          const respHeaders = { ...upstreamRes.headers }

          // Scrub response headers
          for (const [k, v] of Object.entries(respHeaders)) {
            if (typeof v === "string") {
              respHeaders[k] = scrubResponseText(v, secretsToPlaceholder)
            }
          }

          // Scrub response body
          const ct = (respHeaders["content-type"] as string) || ""
          let finalBody: Buffer = respBuffer
          if (ct.includes("text") || ct.includes("json") || ct.includes("xml")) {
            const scrubbed = scrubResponseText(respBuffer.toString("utf8"), secretsToPlaceholder)
            finalBody = Buffer.from(scrubbed, "utf8")
            respHeaders["content-length"] = String(finalBody.length)
          }

          res.writeHead(upstreamRes.statusCode || 200, respHeaders)
          res.end(finalBody)
        })
      },
    )

    clientReq.on("error", (err) => {
      res.writeHead(502, { "content-type": "text/plain" })
      res.end(`saaya: upstream connection failed (${err.message})`)
    })

    if (bodyBuffer.length > 0) {
      clientReq.write(bodyBuffer)
    }
    clientReq.end()
  } catch (err: any) {
    res.writeHead(500, { "content-type": "text/plain" })
    res.end(`saaya: egress internal error (${err.message})`)
  }
})

// ── Handle CONNECT tunnel (for HTTPS from clients) ──────────────────────────

proxyServer.on("connect", async (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
  const [host, rawPort] = (req.url || "").split(":")
  const port = Number(rawPort || 443)

  try {
    if ((await identifyConnection(req)) === "invalid") {
      clientSocket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="saaya"\r\n\r\n')
      return
    }
    if (!host) throw new Error("Missing host in CONNECT request")
    if (port !== 443) {
      throw new Error(`CONNECT tunnel restricted to port 443 (requested: ${port})`)
    }
    const safeIps = await assertSafeEgressHost(host)
    const pinnedIp = safeIps[0]!

    const targetSocket = connect({ host: pinnedIp, port }, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length > 0) targetSocket.write(head)
      targetSocket.pipe(clientSocket)
      clientSocket.pipe(targetSocket)
    })

    targetSocket.on("error", (err) => {
      clientSocket.end(`HTTP/1.1 502 Bad Gateway\r\n\r\n${err.message}`)
    })

    clientSocket.on("error", () => {
      targetSocket.destroy()
    })
  } catch (err: any) {
    clientSocket.end(`HTTP/1.1 403 Forbidden\r\n\r\n${err.message}`)
  }
})

proxyServer.listen(PROXY_PORT, "0.0.0.0", () => {
  console.log(`[egress] proxy listener running on :${PROXY_PORT}`)
})
