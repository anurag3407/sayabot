/**
 * Fake Telegram Bot API + Discord REST API + OpenAI-compatible model endpoint for the gateway E2E
 * run (`pnpm test:gateways`). This is the ONLY thing faked at the network boundary: the Next app,
 * the orchestrator, Postgres and the webhook routes all run for real; Telegram/Discord/model HTTP
 * leaves the system here and nowhere else.
 *
 * Control plane used by the spec:
 *   GET  /__calls  -> every recorded request (provider, method, path, body)
 *   POST /__reset  -> clears the log
 *   GET  /health   -> readiness probe
 */
import { createServer } from "node:http"

const PORT = Number(process.env.FAKE_PROVIDER_PORT ?? 4599)
const REPLY = process.env.FAKE_MODEL_REPLY ?? "Gateway reply from the fake model."

/** @type {Array<{provider:string, method:string, path:string, body:any, at:string}>} */
let calls = []

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body)
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/plain" : "application/json",
    ...headers,
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ""
    req.on("data", (chunk) => {
      raw += chunk
    })
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({ raw })
      }
    })
  })
}

function completion(content) {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "fake-gateway-model",
    choices: [
      { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
  }
}

function streamCompletion(res, content) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  const base = {
    id: "chatcmpl-stream",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "fake-gateway-model",
  }
  res.write(
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`,
  )
  res.write(
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } })}\n\n`,
  )
  res.write("data: [DONE]\n\n")
  res.end()
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`)
  const path = url.pathname
  const method = req.method ?? "GET"
  if (path === "/health") return send(res, 200, { ok: true })
  if (path === "/__calls") return send(res, 200, calls)
  if (path === "/__reset" && method === "POST") {
    calls = []
    return send(res, 200, { ok: true })
  }

  const body = method === "POST" ? await readBody(req) : {}
  calls.push({ provider: path.split("/")[1] ?? "?", method, path, body, at: new Date().toISOString() })

  // Telegram Bot API: /telegram/bot<token>/<method>
  if (path.startsWith("/telegram/bot")) {
    const botMethod = path.split("/").pop()
    if (botMethod === "getMe") {
      return send(res, 200, {
        ok: true,
        result: {
          id: 7000001,
          is_bot: true,
          first_name: "Gateway E2E",
          username: "gateway_e2e_bot",
        },
      })
    }
    if (botMethod === "setWebhook" || botMethod === "deleteWebhook") {
      return send(res, 200, { ok: true, result: true })
    }
    if (botMethod === "sendMessage") {
      return send(res, 200, {
        ok: true,
        result: {
          message_id: Math.floor(Math.random() * 100000),
          chat: { id: Number(body.chat_id) },
          text: body.text,
        },
      })
    }
    return send(res, 200, { ok: true, result: {} })
  }

  // Discord REST: /discord/users/@me, /discord/channels/<id>/messages, /discord/gateway/bot
  if (path.startsWith("/discord/")) {
    if (path === "/discord/users/@me") {
      return send(res, 200, { id: "900000000000000001", username: "gateway_e2e_discord" })
    }
    if (path === "/discord/gateway/bot") return send(res, 200, { url: "ws://127.0.0.1:4599" })
    if (path.includes("/messages")) {
      return send(res, 200, {
        id: "910000000000000002",
        channel_id: path.split("/")[3],
        content: body.content,
      })
    }
    return send(res, 200, {})
  }

  // OpenAI-compatible model endpoint (the agent's only source of truth in this run).
  if (path.endsWith("/chat/completions")) {
    if (body?.stream) return streamCompletion(res, REPLY)
    return send(res, 200, completion(REPLY))
  }

  return send(res, 404, { error: "not found" })
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[fake-provider] listening on http://127.0.0.1:${PORT}`)
})
