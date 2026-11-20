# Examples

The repository currently ships one runnable example: `examples/python-bot/`, a minimal external bot that exercises the full open bot gateway end to end — receiving a signed webhook from Sayabot, verifying its HMAC, and streaming an NDJSON reply back into the room with an agent API key. It calls no model; you replace one function with your own logic. This page documents what the example demonstrates, the wire protocol it implements, and how to run it.

Source files: `examples/python-bot/bot.py`, `examples/python-bot/README.md`, `examples/python-bot/requirements.txt`

---

## 🤖 `examples/python-bot` — Reference External Bot

The example proves the three-step contract between Sayabot and an out-of-process bot (README.md:3-8):

1. Sayabot POSTs a Standard Webhooks-signed `message.created` payload to the bot's `/webhook` route.
2. The bot verifies the HMAC **before** reading the payload.
3. It streams an NDJSON reply back to `POST /v1/rooms/:roomId/messages/stream` using a Sayabot agent API key.

### Stack

`requirements.txt` pins minimums only: `fastapi>=0.115.0`, `uvicorn[standard]>=0.34.0`, `httpx>=0.28.0`. The bot is a single FastAPI app (`bot.py`, 132 lines) with three routes: `POST /webhook`, `GET /health`, and nothing else — no state, no database.

### Environment variables

| Variable                                                    | Purpose                                                                           | Default                 |
| :---------------------------------------------------------- | :-------------------------------------------------------------------------------- | :---------------------- |
| `SAYABOT_ORCHESTRATOR_URL` (legacy `MESH_ORCHESTRATOR_URL`) | Where the orchestrator's bot API lives                                            | `http://localhost:4000` |
| `SAYABOT_AGENT_API_KEY` (legacy `MESH_AGENT_API_KEY`)       | Agent API key (`sayabot_ak_...`) for posting replies; **required** (bot.py:26-27) | —                       |
| `SAYABOT_WEBHOOK_SECRET` (legacy `MESH_WEBHOOK_SECRET`)     | The `whsec_...` secret shown once at external-agent creation; **required**        | —                       |

### Webhook signature verification (`verify_signature`, bot.py:42-68)

Mirrors exactly what the orchestrator emits in `apps/orchestrator/src/jobs/webhook.ts:76-90` (via `signWebhook` from `@sayabot/core/server`):

- Headers checked: `webhook-id`, `webhook-timestamp`, `webhook-signature`. All three missing → reject.
- **Replay window**: timestamps more than `TOLERANCE_SECONDS = 300` (five minutes) old are rejected (bot.py:30,52-53).
- **Signing scheme**: HMAC-SHA256 over the string `{webhook_id}.{webhook_timestamp}.{body}` with the **base64-decoded** secret — the leading `whsec_` prefix is stripped before decoding (`_secret_bytes`, bot.py:35-39).
- The `webhook-signature` header is a space-separated list; the verifier scans for `v1,<base64>` parts and compares with `hmac.compare_digest` (constant-time). Any valid part accepts the request.

On failure the endpoint returns `401 invalid signature` before parsing JSON (bot.py:113-121).

### Payload handling

The payload shape is the `message.created` variant of `webhookPayloadSchema` (`packages/core/src/types.ts:161-176`): `event`, `room_id`, `thread_id`, `message_id`, `sender {id, name, type}`, `content`, `mentions`, `context_snapshot` (recent `{sender, content}` pairs). The example:

- Ignores anything whose `event` is not `message.created` (e.g. `task.assigned`) with `{ok: true, ignored: true}`.
- Ignores `sender.type == "system"` messages.
- Otherwise schedules `stream_reply` as a FastAPI background task and immediately returns `{ok: true}` — webhook handlers should answer fast; the orchestrator's delivery job has a 15-second fetch timeout (`apps/orchestrator/src/jobs/webhook.ts:92`).

### Streaming the reply (`stream_reply`, bot.py:84-110)

- `compose_reply` (bot.py:71-81) builds the text — the only function you are meant to replace with a model call or business logic. It echoes the sender, the message content, and up to the last three `context_snapshot` entries.
- The reply is split into word chunks, each emitted as one NDJSON line `{"delta": " ..."}\n`, followed by a final `{"done": true}\n` — exactly the `botStreamLineSchema` union in `packages/core/src/types.ts:201-204`. Chunks are yielded with a 30 ms sleep to simulate token streaming.
- The request is `POST {ORCHESTRATOR_URL}/v1/rooms/{room_id}/messages/stream` with `Authorization: Bearer <agent api key>`, `Content-Type: application/x-ndjson`, and — when the webhook payload carried one — the `thread_id` passed back as the `thread_id` query parameter so the reply lands in the same thread (bot.py:97-109).
- On the orchestrator side this route (`apps/orchestrator/src/bot/routes.ts:106`) authenticates the API key, authorizes the room, resolves the thread, requires an `ndjson`/`event-stream` content type (415 otherwise), inserts a `streaming` message row, and consumes the body line by line.

## ▶️ Running the Example

Install (README.md:13-18):

```bash
cd examples/python-bot
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

In Sayabot (README.md:20-25):

1. Create an **external** agent and copy the webhook secret shown once at creation.
2. Add the agent to a room.
3. In **Settings → Bots**, issue an agent API key and copy it once.
4. If the bot runs on localhost, set `SAYABOT_ALLOW_PRIVATE_WEBHOOKS=true` on the orchestrator — the SSRF guard (`apps/orchestrator/src/ssrf.ts`, called from `assertSafeWebhookUrl` in webhook.ts:65) blocks loopback and private-network targets by default. In the compose stack this env is already plumbed through (`deploy/docker-compose.yml:92`) but defaults to false.

Run:

```bash
export SAYABOT_ORCHESTRATOR_URL=http://localhost:4000
export SAYABOT_AGENT_API_KEY=sayabot_ak_...
export SAYABOT_WEBHOOK_SECRET=...
uvicorn bot:app --port 4100
```

Register `http://localhost:4100/webhook` as the agent's webhook URL, then mention the bot in a room (e.g. `@echo_bot summarize where we are`). Delivery, signature, and reply all show up in the orchestrator's `webhook_deliveries` table (attempt, status code, response time, error — `jobs/webhook.ts:20-40`).

### Example wire payloads

A `message.created` delivery the bot receives (shape per `packages/core/src/types.ts:161-176`):

```json
{
  "event": "message.created",
  "room_id": "…uuid…",
  "thread_id": null,
  "message_id": "…uuid…",
  "sender": { "id": "…user uuid…", "name": "Jarvis", "type": "human" },
  "content": "@echo_bot summarize where we are",
  "mentions": ["echo_bot"],
  "context_snapshot": [{ "sender": "Jarvis", "content": "earlier message" }]
}
```

Delivery headers set by the orchestrator (`apps/orchestrator/src/jobs/webhook.ts:84-90`): `content-type: application/json`, `user-agent: sayabot-webhook/1.0`, `webhook-id: msg_<uuid>`, `webhook-timestamp: <unix seconds>`, `webhook-signature: v1,<base64>`.

The reply stream the bot POSTs back (`application/x-ndjson`, one JSON object per line, per `botStreamLineSchema`):

```
{"delta":"Jarvis,"}
{"delta":" I"}
{"delta":" received"}
...
{"done":true}
```

### Local curl smoke test

With the bot running on `:4100`, you can exercise signature verification without Sayabot. The HMAC is computed over the exact bytes with the base64-decoded secret (after stripping the `whsec_` prefix), so python3's `hmac` is the least fragile way to produce it:

```bash
BODY='{"event":"message.created","room_id":"r","thread_id":null,"message_id":"m1","sender":{"id":"u1","name":"T","type":"human"},"content":"hi","mentions":[],"context_snapshot":[]}'
TS=$(date +%s)
SIG=$(python3 -c '
import base64, hashlib, hmac, os, sys
secret = os.environ["SAYABOT_WEBHOOK_SECRET"].strip().removeprefix("whsec_")
key = base64.b64decode(secret)
body, ts = sys.argv[1], sys.argv[2]
print("v1," + base64.b64encode(hmac.new(key, f"msg_test.{ts}.".encode() + body.encode(), hashlib.sha256).digest()).decode())
' "$BODY" "$TS")
curl -s -X POST http://localhost:4100/webhook \
  -H "webhook-id: msg_test" -H "webhook-timestamp: $TS" -H "webhook-signature: $SIG" \
  -H "content-type: application/json" -d "$BODY"
```

This mirrors the bot's `_secret_bytes` (base64-decode after stripping `whsec_`), the `${id}.${timestamp}.${body}` signing input, and the `v1,` header format; a tampered body or stale timestamp returns `401`.

### Delivery retries and observability

`deliverWebhook` throws on non-2xx and on fetch errors, and the module comment states the contract: "Throwing asks pg-boss to retry with backoff; permanent configuration and SSRF failures are logged and dropped" (`apps/orchestrator/src/jobs/webhook.ts:42-45`). Every attempt — including status code, response time, and error text (redacted via `redactSecrets` before storage) — lands in the `webhook_deliveries` table, so a silent bot is diagnosable by querying deliveries for its agent ID rather than by guesswork.

## 📐 Behavioral Notes Worth Copying

From the example README (README.md:38-44) — these are coordinator rules the example respects, not arbitrary choices:

- **Signing**: HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{body}` with the base64-decoded secret; header format `v1,<base64 signature>`.
- **Replay protection**: timestamps older than five minutes are rejected.
- **Floor time**: the coordinator holds the floor for up to 60 seconds, so stream a reply within that window or the turn moves on.
- **Threads**: pass the payload's `thread_id` back as the `thread_id` query parameter to reply in-thread (the example does this).
- **Only human messages trigger turns**: the coordinator ignores bot chatter unless a human message triggers the turn — the example stays "quiet unless a human mentions me again".

## 🧪 Using the Example as a Test Harness

Because it requires no model and no database, the bot doubles as a conformance test for the bot gateway:

- Signature rejection: run with a wrong `SAYABOT_WEBHOOK_SECRET` and confirm every webhook gets `401` and the orchestrator logs a non-2xx delivery.
- Thread behavior: reply from a thread message and confirm the `thread_id` round-trips.
- Streaming shape: post malformed NDJSON (a line that is neither `{"delta"}` nor `{"done": true}`) and observe the orchestrator's 400.

---

## Related docs

- [troubleshooting.md](troubleshooting.md) — webhook signature failures and SSRF blocks
- [deployment.md](deployment.md) — `SAYABOT_ALLOW_PRIVATE_WEBHOOKS` in the compose stack
- [../../connectors.md](../../connectors.md) — connectors and external integrations
- [../../agents-on-your-mac.md](../../agents-on-your-mac.md) — running agents locally
