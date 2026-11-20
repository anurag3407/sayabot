# SSRF Guard & Realtime Broadcast

Two small but load-bearing modules: `ssrf.ts` decides whether an outbound URL the orchestrator itself fetches (webhook deliveries to external bots) is safe, blocking loopback/RFC1918/metadata addresses with full DNS re-resolution on every attempt; `realtime.ts` is the single `broadcast(roomId, event)` function that pushes typed `RoomEvent`s to room UIs through Supabase Realtime's REST broadcast endpoint, keeping the orchestrator stateless (no per-room websocket from the orchestrator itself).

Source files: `apps/orchestrator/src/ssrf.ts`, `apps/orchestrator/src/realtime.ts`

Neither module is large — together about 160 lines — but nearly every feature in this book touches one or both: webhook delivery calls the SSRF guard per attempt, and every streaming reply, tool card, and turn-state update flows through `broadcast`.

---

## 🛡️ SSRF Guard (`src/ssrf.ts`)

`assertSafeWebhookUrl(raw, allowPrivate)` (`ssrf.ts:11-42`) validates a webhook target and returns the parsed `URL`:

1. **Parse** — failures throw `"invalid webhook URL"`.
2. **Scheme** — only `http:` or `https:` ("webhook URL must use http or https").
3. **Credentials** — `url.username`/`url.password` are rejected ("webhook URL must not contain credentials"), so a URL can't smuggle `user:pass@host` tricks.
4. **Escape hatch** — when `allowPrivate` is true the URL is returned unvalidated. The flag comes from `MESH_ALLOW_PRIVATE_WEBHOOKS` (alias `SAYABOT_ALLOW_PRIVATE_WEBHOOKS`) in `src/env.ts:20-55`, parsed as `=== "true"`. This exists for self-hosters whose bots live on the private network.
5. **Hostname blocklist** — `localhost`, anything ending in `.localhost`, `.local`, or `.internal` → `"webhook URL resolves to a private host"`.
6. **Literal IPs** — `isIP(host)` short-circuits DNS; a private literal → `"webhook URL points at a private address"`.
7. **DNS resolution** — `lookup(host, { all: true, verbatim: true })` fetches **every** A/AAAA record; zero records → `"webhook host did not resolve"`; **any** private record rejects the whole URL ("webhook host resolves to a private address"). DNS is re-checked on every delivery attempt — a hostname that re-resolves private later is caught on the next webhook.

The core of the function, in the module's own words (`ssrf.ts:7-10`): "Blocks webhook targets that resolve to loopback, link-local or private networks. DNS is re-checked on every delivery attempt."

```typescript
const host = url.hostname.toLowerCase()
if (
  host === "localhost" ||
  host.endsWith(".localhost") ||
  host.endsWith(".local") ||
  host.endsWith(".internal")
) {
  throw new Error("webhook URL resolves to a private host")
}
if (isIP(host)) {
  if (isPrivateIp(host)) throw new Error("webhook URL points at a private address")
  return url
}
const addresses = await lookup(host, { all: true, verbatim: true })
if (addresses.length === 0) throw new Error("webhook host did not resolve")
for (const address of addresses) {
  if (isPrivateIp(address.address)) throw new Error("webhook host resolves to a private address")
}
return url
```

The check is deliberately re-run per attempt by `deliverWebhook` (see [internal-api-and-jobs.md](./internal-api-and-jobs.md)); it is _not_ a pinning cache — the orchestrator delegates its general outbound proxying (with true DNS-rebinding defense, IP filtering, and per-agent identity) to the separate **egress** app, documented in [tools-and-sandboxes.md](../../../tools-and-sandboxes.md).

### `isPrivateIp` — the blocklist (`packages/core/src/server/ssrf.ts:62-156`)

Re-exported from `ssrf.ts:5` and shared with egress-side code. IPv4 ranges blocked:

| Range                                                                   | Meaning                                         |
| :---------------------------------------------------------------------- | :---------------------------------------------- |
| `127.0.0.0/8`, `0.0.0.0/8`, `255.255.255.255`, `::1`, `::`, `localhost` | Loopback / unspecified / broadcast              |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`                         | RFC 1918 private                                |
| `169.254.0.0/16`                                                        | Link-local & cloud metadata (`169.254.169.254`) |
| `100.64.0.0/10`                                                         | CGNAT                                           |
| `198.18.0.0/15`                                                         | RFC 2544 benchmarking                           |
| `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`                     | TEST-NET documentation ranges                   |
| `224.0.0.0/4`, `240.0.0.0/4`                                            | Multicast & reserved                            |

The two exact hostnames `127.0.0.1` and the word `localhost` are matched literally before version dispatch (`ssrf.ts:64`), so they cannot fall through any octet arithmetic.

IPv6 is parsed to its 8 words by `parseIpv6Words` (handling `::` expansion and stripping brackets), and blocked for: multicast `ff00::/8`, loopback/unspecified, link-local `fe80::/10`, ULA `fc00::/7`, discard `100::/64`, documentation `2001:db8::/32` — plus, critically, **IPv4-embedded forms are recursively checked as IPv4**: IPv4-mapped (`::ffff:a.b.c.d`), IPv4-compatible (`::a.b.c.d`), NAT64 (`64:ff9b::/96`), and 6to4 (`2002::/16`). An unparseable IPv6 string is treated as **unsafe** (fails closed).

The sibling `assertSafeEgressHost(hostname)` (same file, ssrf.ts:158-195) is the hostname-level variant used by connector code paths that fetch directly (e.g. password-manager APIs, see [connectors-content.md](./connectors-content.md)); it additionally blocks `.onion` and returns the resolved addresses.

## 📡 Realtime Broadcast (`src/realtime.ts`)

The whole module is one exported function. `broadcast(roomId, event)` (`realtime.ts:8-39`) posts to Supabase Realtime's REST broadcast API:

```typescript
await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  },
  body: JSON.stringify({
    messages: [
      {
        topic: `room:${roomId}`,
        event: event.type,
        payload: event,
        private: true, // not echo-broadcast back to the sender
      },
    ],
  }),
})
```

Design notes from the module docstring: broadcasting through REST "keeps the orchestrator stateless and avoids one websocket per room". Errors are **never thrown** — a failed broadcast is logged (`[realtime] broadcast <type> failed: <status> <body-slice-300>` or the fetch error) and the caller continues; realtime is best-effort UI signaling, while durable state lives in Postgres. Web browsers subscribe to the `room:{id}` channel with a Supabase key; `private: true` keeps the message from being rebroadcast to the publishing client.

The orchestrator's other realtime needs — room events it must _receive_ rather than send (turn interrupts, run stops, approval resolution, bot replies, vault invalidation) — use Postgres `LISTEN/NOTIFY` on dedicated pool clients instead (`mesh_room_interrupt`, `mesh_stop_run`, `mesh_bot_reply`, `mesh_agent_inbox`, `vault_changed`), documented in [bot-platform.md](./bot-platform.md), [internal-api-and-jobs.md](./internal-api-and-jobs.md), and [mcp-server.md](./mcp-server.md).

## 🗂️ Event Catalogue (`RoomEvent`, `packages/core/src/types.ts:65-163`)

`roomEventSchema` is a discriminated union on `type`; every broadcast payload is one of:

| Event                     | Payload                                                                                                           | Emitted by                                                                               |
| :------------------------ | :---------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| `message.delta`           | `{ messageId, seq, delta }`                                                                                       | streaming replies (bot stream route, agent runners)                                      |
| `message.done`            | `{ messageId, status }` (MESSAGE_STATUSES)                                                                        | finalized messages (postAgentMessage, votes, stream finalization)                        |
| `message.removed`         | `{ messageId }`                                                                                                   | "a reply attempt that was replaced (a failed try the server retried); drop it from view" |
| `turn.state`              | `{ sessionId, activeAgentId (nullable), queue: string[], threadRootId? }`                                         | turn coordinator (who's speaking, what's queued)                                         |
| `tool.approval_requested` | `{ toolCallId, agentId, toolName, args }`                                                                         | dangerous-tool gate + egress approval gateway                                            |
| `tool.approval_resolved`  | `{ toolCallId, status: "approved" \| "rejected" }`                                                                | approval decisions                                                                       |
| `tool.started`            | `{ toolCallId, agentId, toolName, args }`                                                                         | audited tool execution                                                                   |
| `tool.finished`           | `{ toolCallId, status: "done" \| "error" \| "rejected", durationMs }`                                             | audited tool execution                                                                   |
| `tool.output`             | `{ toolCallId, seq, chunk }`                                                                                      | streamed tool output (shell, browser…)                                                   |
| `agent.connected`         | `{ agentId, handle, client? }`                                                                                    | presence for local/MCP agents                                                            |
| `computer.state`          | `{ agentId, status }`                                                                                             | computerd lifecycle via `/internal/computer/state`                                       |
| `room.notice`             | `{ level: "info" \| "warn" \| "error", message }`                                                                 | system notices (e.g. egress violations)                                                  |
| `run.step`                | `{ runId, step, kind: "model" \| "tool" \| "compaction" \| "recall" \| "plan" \| "subagent" \| "verify", label }` | engine loop progress                                                                     |
| `run.status`              | `{ runId, status: "thinking" \| "tool" \| "waiting:approval" \| "waiting:answer" \| "compacting" }`               | engine loop state                                                                        |
| `run.plan`                | `{ runId, items: [{ id, title, status: "pending" \| "in_progress" \| "done" \| "blocked", note? }] }`             | `update_plan` tool                                                                       |

Callers span the whole orchestrator: `coordinator/index.ts` (turn.state), `runner/llm.ts` + `runner/cli.ts` + `runner/local.ts` (message deltas, run steps), `tools/audited.ts` (tool lifecycle + approvals), `collab/index.ts` (message.done), `bot/routes.ts` (streaming), `engine/plan-tool.ts`, `engine/subagents.ts`, `engine/resume.ts`, `engine/fit-model.ts`, `internal/routes.ts`, `runner/local-events.ts`, `plans.ts`, and `tools/builtins/computer.ts`.

Three representative payloads as they appear on the wire (the whole event is the `payload`; the REST wrapper adds `topic`/`event`):

```jsonc
// streaming text into the room, in order
{ "type": "message.delta", "messageId": "7f0d…", "seq": 42, "delta": "and the fix is…" }

// a dangerous tool asking the room for a human
{ "type": "tool.approval_requested", "toolCallId": "c1e2…", "agentId": "a8…",
  "toolName": "slack_send_message", "args": { "channel": "C0123", "text": "…" } }

// engine progress card
{ "type": "run.step", "runId": "r4…", "step": 7, "kind": "tool", "label": "web_fetch" }
```

Note the split of concerns: `message.delta`/`message.done` are the _chat_ stream, `run.step`/`run.status`/`run.plan` are the _engine telemetry_ cards, and `tool.*` are the _audit_ stream — the web app renders each family differently.

## 🧪 Tests

There is no dedicated `ssrf.test.ts` or `realtime.test.ts` in the orchestrator; the IP blocklist is covered by `packages/core/src/server/ssrf.test.ts` (`isPrivateIp` / `assertSafeEgressHost` cases, including IPv6 embedded-IPv4 forms).

## 🧭 Threat-model notes

- **Fail closed everywhere**: unparseable IPv6 is treated as private; a missing `isIP` match (any non-IP, non-hostname edge) falls through to `return true` (blocked) at the end of `isPrivateIp`; zero DNS records reject the URL.
- **TOCTOU on DNS is accepted at this layer.** `assertSafeWebhookUrl` resolves then the fetch happens separately, so a rebinding attacker could in principle race the two lookups. The design answer is the egress proxy (`apps/egress`) for general outbound traffic; webhook delivery keeps re-checking per attempt (`redirect: "error"` and a fresh resolve each retry) to shrink the window rather than eliminate it.
- **Metadata endpoints are covered twice**: `169.254.0.0/16` in the IPv4 list (covers `169.254.169.254`), and link-local `fe80::/10` in IPv6.
- **Error messages are operator-usable**: every throw is a plain sentence ("webhook URL must use http or https", "webhook host resolves to a private address") that `deliverWebhook` stores verbatim in `webhook_deliveries.error` after redaction, so a blocked delivery explains itself in the UI.
- **`broadcast` failures are silent by design** — the function logs and returns `void`; no caller can be broken by a Supabase outage. This asymmetry is intentional: realtime is presentation state, Postgres is the record.
- **Environment**: `broadcast` needs only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (already required by the canvas server); the `service_role` key is used because broadcast is a server-to-server API call, not a client subscription.

---

Related docs:

- [Internal API & jobs](./internal-api-and-jobs.md) — the webhook pipeline that calls `assertSafeWebhookUrl`
- [Approvals](../tools/approvals.md) — the `tool.approval_requested`/`resolved` lifecycle
- [Bot platform](./bot-platform.md) — a heavy `broadcast` producer (streaming)
- [Tools & sandboxes guide](../../../tools-and-sandboxes.md) — the egress proxy with full DNS-rebinding defense
