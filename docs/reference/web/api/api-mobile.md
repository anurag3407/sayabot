# Mobile App API

`app/api/mobile/*` is the HTTP surface for the Sayabot phone app (Expo/React Native). Pairing exchanges a one-time code for a Supabase sign-in plus a device token; everything else authenticates with either a Supabase bearer token or the web session cookie through `userFromRequest` (`lib/route-bearer.ts`), and reads run through the caller's own RLS-scoped client. Most responses are JSON with `cache-control: no-store`.

Source files: `apps/web/src/app/api/mobile/device/route.ts`, `apps/web/src/app/api/mobile/pair/route.ts`, `apps/web/src/app/api/mobile/push/route.ts`, `apps/web/src/app/api/mobile/home/route.ts`, `apps/web/src/app/api/mobile/inbox/route.ts`, `apps/web/src/app/api/mobile/inbox/answer/route.ts`, `apps/web/src/app/api/mobile/upload/route.ts`, `apps/web/src/app/api/mobile/usage/route.ts`, `apps/web/src/app/api/mobile/version/route.ts`, `apps/web/src/app/api/mobile/computers/route.ts`

---

## 📱 Device check-in — `GET /api/mobile/device`

**Auth:** headers only — `x-device-id` (a UUID) and `x-device-token`. No session.

Returns the pairing's current state so a paired phone learns it was removed on the computer (`device/route.ts:9`):

- `400 { status: "unknown" }` — malformed device id or missing token.
- `200 { status: "revoked" }` — pairing row missing, `status !== "paired"`, or the token's `hashAgentApiKey` digest does not match `device_pairings.device_token_hash`.
- `200 { status: "active" }` (plus `cache-control: no-store`) — valid pairing; `last_seen_at` is stamped with the check-in time.

---

## 🔗 Pairing — `POST /api/mobile/pair`

**Auth:** none (that is the point — the one-time code is the credential). Body: `{ code, deviceName?, platform? }` (`pair/route.ts:17`).

Flow:

1. `normalizePairingCode` + `isPairingCode` validate the code from the computer screen (`400` "That code doesn't look right…").
2. The pairing row is claimed with a guarded update — `.eq("code_hash", hashAgentApiKey(code)).eq("status", "waiting").gt("expires_at", now)` — so two phones cannot both redeem one code (`pair/route.ts:33`); failure is `410` "That code expired or was already used…".
3. The claim sets `status: "paired"`, `paired_at`, `device_name` (trimmed ≤ 80, defaulting to `"<platform> phone"`), `platform` (≤ 20), and `device_token_hash` from a fresh `generateDeviceToken()`.
4. `auth.admin.generateLink({ type: "magiclink", email })` mints a single-use Supabase sign-in token for the pairing's user (the account must have an email, else `409` and the pairing is revoked again).
5. Audit `phone.paired` (when the pairing carries an org).

**Response** (`pair/route.ts:78`):

```json
{
  "token_hash": "<supabase hashed_token>",
  "type": "magiclink",
  "email": "…",
  "org_slug": "… | null",
  "device_id": "<pairing id>",
  "device_token": "<plaintext device token>",
  "supabase_url": "<NEXT_PUBLIC_SUPABASE_URL>"
}
```

The phone redeems `token_hash` with `verifyOtp` and keeps `device_id` + `device_token` for the `/device` check-in. Errors: `400` non-JSON body, `409`/`500` account issues (pairing revoked), `410` expired code.

---

## 🔔 Push tokens — `POST`/`DELETE /api/mobile/push`

**Auth:** `userFromRequest` (bearer or session).

- `POST` — body `{ token, platform? }`; `token` must match `/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,}\]$/` (`push/route.ts:5`, else `400 "invalid token"`). Upserts into `mobile_push_tokens` keyed on `token` with `platform` (≤ 20 chars) and `last_seen_at`. Returns `{ ok: true }`.
- `DELETE` — body `{ token }`; deletes the row only when it belongs to the caller (`push/route.ts:26`). Returns `{ ok: true }`.

---

## 🏠 Home screen — `GET /api/mobile/home?orgSlug=`

**Auth:** `userFromRequest`; `dynamic = "force-dynamic"`.

One round trip for everything the phone's home needs (`home/route.ts:11`). The org resolves from `orgSlug`, falling back to the caller's first membership; without any membership it is `404 { error: "no workspace" }`. Parallel reads (all through the caller's RLS client):

- `agents` (id, handle, display_name, kind, model, provider_key_id, params, bio)
- `room_agents` for the org's rooms
- caller's `room_reads` (pinned / muted_until / archived / last_read_at)
- latest 600 top-level `messages` (no thread root) across the org's rooms
- open `tasks` of `kind: "request"` (expiry-filtered)
- count of `tool_calls` with `status: "pending_approval"`
- `agent_runs` running in the last 10 minutes (which agent works in which room)
- `rpc("usage_rollup", { p_org, p_since: now-30d })`

**Response shape** (`home/route.ts:130`):

```json
{
  "org": { "slug", "name" },
  "orgs": [{ "id", "slug", "name" }],
  "user": { "id", "name", "email" },
  "needsYou": { "questions": <int>, "approvals": <int> },
  "chats": [{
    "id", "name", "kind", "agentIds", "pinned", "muted", "unread",
    "questions", "workingAgentId",
    "lastMessage": { "preview": "<140 chars>", "senderName", "at", "streaming" } | null,
    "updatedAt"
  }],
  "agents": [{
    "id", "handle", "name", "kind", "about", "model", "workingRoomId",
    "usage": { "tokens", "runs", "costUsd", "lastAt", "topModel" } | null,
    "roomIds"
  }]
}
```

Notable rules: archived rooms are hidden; unread counts messages from other senders newer than `last_read_at`; DM names come from the paired agent's display name; agent `model` labels are user-facing — Mac-runner agents read "`<app>` on your computer", external agents "Its own app", and server agents without a key use the operator's Saya AI config via `sayaModelLabel` so renames appear without an app update (`home/route.ts:146`).

---

## 📥 Inbox — `GET /api/mobile/inbox?orgSlug=`

**Auth:** `userFromRequest`; force-dynamic. The phone's inbox of agent questions waiting on this person (`inbox/route.ts:8`):

- Loads the org's rooms (RLS), then up to 50 open `kind: "request"` tasks ordered by `updated_at`, filtered by expiry, plus a head-count of `pending_approval` tool calls.
- Requester agents are resolved for handle/name.

**Response:** `{ questions: [{ id, roomId, roomName, title, description, agentHandle, agentName, askedCount, updatedAt, options, items: [{ key, question, hint, options, answer }] }], approvals }`. `items` comes from `askItemsFromMetadata` — the structured "ask items" the answer endpoint fills. Empty org: `{ questions: [], approvals: 0 }`.

---

## 📝 Answering — `POST /api/mobile/inbox/answer`

**Auth:** `userFromRequest`. Body: `{ orgSlug, taskId, answer?, alsoPost?, itemAnswers? }` (`inbox/answer/route.ts:6`).

Validates JSON (`400 "invalid JSON"`) and the presence of `orgSlug` + `taskId` (`400 "orgSlug and taskId are required"`). `itemAnswers` keeps only non-empty string values, each capped at 1,000 chars. The real work is delegated to `answerRequestsAs(who, ...)` — the same shared routine the web Inbox uses (documented in the rooms/messages actions reference), so keyed answers become owner facts, tasks complete through the orchestrator, and the bot receives the answer in a DM or the room.

**Response:** `{ ok: true, message }` (200) or `{ ok: false, error }` (400).

---

## 📎 Uploads — `POST /api/mobile/upload`

**Auth:** `userFromRequest`. Multipart form: `file` + `roomId` (`upload/route.ts:14`).

- `roomId` must be a UUID and the caller must be able to **read the room through RLS** — `404 "room not found"` otherwise.
- Size cap 15 MB (`413 "Files can be up to 15 MB."`); MIME allow-list `ALLOWED` (`upload/route.ts:8`): images (jpeg, png, webp, gif, heic, heif), `application/pdf`, plain text / CSV / markdown, and common Office formats — anything else is `415 "That kind of file can't be sent yet."`.
- Stored name is sanitized to `[A-Za-z0-9._-]` and capped at 80 chars; the storage path is `rooms/<roomId>/<randomUUID>/<safeName>` in the private `attachments` bucket.

**Response:** `{ url: "<app>/api/files/<path>", name, type, size }` — the returned URL goes through `/api/files/[...path]`, which re-checks room visibility on every read (`upload/route.ts:10`).

---

## 📊 Usage — `GET /api/mobile/usage?orgSlug=&days=&tzOffset=`

**Auth:** `userFromRequest`; force-dynamic. Query: `days` ∈ {7, 30, 90} (default 30), `tzOffset` in minutes (JavaScript `getTimezoneOffset` semantics, clamped to ±840) (`usage/route.ts:18`).

- Exact totals from the `usage_rollup` RPC (RLS-scoped).
- A per-day series built from raw `usage_events`, paged 1,000 rows at a time up to 20,000 rows; each event lands on the day computed in the phone's own time zone (`usage/route.ts:49`).

**Response:** `{ days, totals: { tokens, costUsd, runs, cachedTokens }, series: [{ day, tokens, cost, runs }], agents: [{ id, handle, name, tokens, runs, costUsd }] (sorted by tokens), models: [{ model, provider, tokens, costUsd }] (top 8) }`.

---

## 🖥️ Computers — `GET /api/mobile/computers?orgSlug=`

**Auth:** `userFromRequest`; force-dynamic. Two lists (`computers/route.ts:10`):

- `macs` — `listComputers(userId, orgId, role)` from `lib/computers.ts` (the shared view used by the web Computers page): the person's Macs plus hosts shared with the workspace, filtered by `canOpenHost`, with liveness from `last_seen_at`.
- `cloud` — every `agent_computers` row in the org joined with the agent's handle/name: `{ agentId, handle, name, status, profile, diskUsedMb, diskMb, lastActiveAt, error }`.

Errors: `401 { error: "unauthorized" }`, `404 { error: "workspace not found" }`.

---

## 🆙 Version — `GET /api/mobile/version`

**Auth:** none; CORS `*` for `GET, OPTIONS` and CDN caching (`s-maxage=60, stale-while-revalidate=300`) so app stores and phones can poll it cheaply (`version/route.ts:14`).

Update check. Env vars pin a release by hand. Otherwise the route follows the newest APK on GitHub Releases: `fetchLatestApk(repo)` from `apps/web/src/lib/mobile-release.ts` calls `GET https://api.github.com/repos/<repo>/releases/latest` (5 s timeout, Next-cached for 10 minutes). `pickLatestApk` then picks the highest `Sayabot-<x.y.z>.apk` asset. The repo is `$MOBILE_RELEASES_REPO`, or comes from the landing page's `GITHUB_URL` via `repoFromGithubUrl`. Any failure falls back to the defaults below.

```json
{
  "latestVersion": "$MOBILE_LATEST_VERSION || <newest Sayabot-x.y.z.apk on GitHub> || \"1.1.0\"",
  "minSupportedVersion": "$MOBILE_MIN_VERSION || \"1.0.0\"",
  "apkUrl": "$MOBILE_APK_URL || <that asset's download URL> || <landing page Android APK URL>",
  "releaseNotes": "$MOBILE_RELEASE_NOTES || \"Performance improvements, …\"",
  "publishedAt": "$MOBILE_RELEASE_DATE || now"
}
```

Setting `MOBILE_LATEST_VERSION` skips the GitHub lookup entirely.

`OPTIONS` answers the same CORS headers with `204`.

---

Related docs: [Auth & authorization](../../architecture/auth-and-authorization.md), [Computers & remote UI](../pages/computers-remote-ui.md), [Tasks, inbox & meetings UI](../pages/tasks-inbox-meetings-ui.md)
