import { agentSecretGrants, vaultSecrets } from "@sayabot/db"
import { openSecret } from "@sayabot/llm"
import { createRunScrubber, matchesHostPattern } from "@sayabot/core"
import { assertSafeEgressHost } from "@sayabot/core/server"
import { and, eq, gt, isNull, or } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "../../db"
import { getEnv } from "../../env"
import type { ToolSpec } from "../audited"

const useSecretSchema = z.object({
  envName: z.string().min(1).max(64),
  request: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  }),
})

export type UseSecretInput = z.infer<typeof useSecretSchema>

export function useSecretTool(args: { agentId: string; orgId: string }): ToolSpec {
  return {
    name: "use_secret",
    description:
      "Execute an authenticated HTTPS request using an approved Secret Broker grant. The real credential is injected safely on your behalf and never visible to the model.",
    schema: useSecretSchema,
    dangerous: true,
    execute: async (input: UseSecretInput, signal?: AbortSignal) => {
      const db = getDb()
      const now = new Date()

      // 1. Fetch grant and sealed secret
      const [row] = await db
        .select({
          grant: agentSecretGrants,
          sealed: vaultSecrets.sealed,
          kind: vaultSecrets.kind,
        })
        .from(agentSecretGrants)
        .innerJoin(vaultSecrets, eq(agentSecretGrants.secretId, vaultSecrets.id))
        .where(
          and(
            eq(agentSecretGrants.agentId, args.agentId),
            eq(agentSecretGrants.envName, input.envName),
            isNull(agentSecretGrants.revokedAt),
            or(isNull(agentSecretGrants.expiresAt), gt(agentSecretGrants.expiresAt, now)),
          ),
        )
        .limit(1)

      if (!row) {
        throw new Error(
          `Secret grant "${input.envName}" was not found or has expired/been revoked.`,
        )
      }

      // 2. Validate URL protocol & host
      const parsedUrl = new URL(input.request.url)
      if (parsedUrl.protocol !== "https:") {
        throw new Error("Only HTTPS requests are permitted through the Secret Broker.")
      }

      const requestedHost = parsedUrl.hostname.toLowerCase()
      await assertSafeEgressHost(requestedHost)

      const isAllowedHost = row.grant.allowedHosts.some((pattern) =>
        matchesHostPattern(requestedHost, pattern),
      )

      if (!isAllowedHost) {
        throw new Error(
          `Host "${requestedHost}" is not allowlisted for secret "${input.envName}". Allowed: ${row.grant.allowedHosts.join(", ")}`,
        )
      }

      // 3. Validate HTTP method
      if (row.grant.methods && row.grant.methods.length > 0) {
        const allowedMethods = row.grant.methods.map((m) => m.toUpperCase())
        if (!allowedMethods.includes(input.request.method)) {
          throw new Error(
            `Method "${input.request.method}" is not permitted for secret "${input.envName}". Allowed: ${allowedMethods.join(", ")}`,
          )
        }
      }

      // 4. Decrypt credential
      const rawSecret = openSecret(row.sealed, getEnv().MESH_KEK)
      let parsedSecret: unknown = rawSecret
      try {
        parsedSecret = JSON.parse(rawSecret)
      } catch {
        parsedSecret = rawSecret
      }

      const secretString =
        typeof parsedSecret === "string"
          ? parsedSecret
          : (parsedSecret as any)?.token ||
            (parsedSecret as any)?.password ||
            (parsedSecret as any)?.apiKey ||
            rawSecret

      // 5. Inject credential based on inject mode
      const reqHeaders = { ...(input.request.headers || {}) }
      let targetUrl = input.request.url
      let reqBody: string | undefined

      const inject = row.grant.inject
      if (inject.mode === "header") {
        const template = inject.template || "Authorization: Bearer {secret}"
        const colonIdx = template.indexOf(":")
        if (colonIdx !== -1) {
          const headerName = template.slice(0, colonIdx).trim()
          const headerVal = template.slice(colonIdx + 1).trim().replace("{secret}", secretString)
          reqHeaders[headerName] = headerVal
        } else {
          reqHeaders["Authorization"] = `Bearer ${secretString}`
        }
      } else if (inject.mode === "basic") {
        let authHeader = ""
        if (typeof parsedSecret === "object" && parsedSecret !== null && "username" in parsedSecret) {
          const u = (parsedSecret as any).username || ""
          const p = (parsedSecret as any).password || secretString
          authHeader = Buffer.from(`${u}:${p}`).toString("base64")
        } else {
          authHeader = Buffer.from(`:${secretString}`).toString("base64")
        }
        reqHeaders["Authorization"] = `Basic ${authHeader}`
      } else if (inject.mode === "query") {
        const paramName = inject.param || "api_key"
        parsedUrl.searchParams.set(paramName, secretString)
        targetUrl = parsedUrl.toString()
      } else if (inject.mode === "body") {
        if (typeof input.request.body === "object") {
          reqBody = JSON.stringify(input.request.body).replace("{secret}", secretString)
          if (!reqHeaders["content-type"]) {
            reqHeaders["content-type"] = "application/json"
          }
        } else if (typeof input.request.body === "string") {
          reqBody = input.request.body.replace("{secret}", secretString)
        }
      }

      if (!reqBody && input.request.body) {
        reqBody =
          typeof input.request.body === "string"
            ? input.request.body
            : JSON.stringify(input.request.body)
      }

      // 6. Execute request
      const response = await fetch(targetUrl, {
        method: input.request.method,
        headers: reqHeaders,
        body: reqBody,
        signal,
      })

      // Update last_used_at on grant and secret
      await db
        .update(agentSecretGrants)
        .set({ lastUsedAt: new Date() })
        .where(eq(agentSecretGrants.id, row.grant.id))
      await db
        .update(vaultSecrets)
        .set({ lastUsedAt: new Date() })
        .where(eq(vaultSecrets.id, row.grant.secretId))

      const respText = await response.text()
      const scrubber = createRunScrubber([secretString])
      const scrubbedBody = scrubber(respText)

      // Filter response headers to safe allowlisted subset
      const safeHeaders: Record<string, string> = {}
      const allowedHeaderNames = [
        "content-type",
        "content-length",
        "date",
        "etag",
        "x-ratelimit-remaining",
        "x-ratelimit-reset",
        "x-request-id",
      ]
      response.headers.forEach((val, key) => {
        if (allowedHeaderNames.includes(key.toLowerCase())) {
          safeHeaders[key.toLowerCase()] = scrubber(val)
        }
      })

      const isTruncated = scrubbedBody.length > 200_000
      const bodyOutput = isTruncated ? scrubbedBody.slice(0, 200_000) : scrubbedBody

      return {
        status: response.status,
        headers: safeHeaders,
        body: bodyOutput,
        truncated: isTruncated,
      }
    },
  }
}
