# Pairing & Onboarding

The phone can attach to a Sayabot server two ways: the hosted Sayabot Cloud (built-in defaults), or a self-hosted server whose address is verified via `GET /api/instance` and stored locally. Once a computer that is signed in offers "Add a phone", the phone signs in with a one-time 8-character code — scanned as a `sayabot://pair` QR/deep link or typed by hand — which the web app exchanges for a single-use Supabase magic-link token. First sign-in lands on a three-step onboarding wizard that sets theme, push alerts, and App Lock before marking the account `onboarded`.

Source files: `src/core/pair-link.ts`, `src/core/pairing.ts`, `src/core/server-url.ts`, `src/core/server.ts`, `src/core/workspace-draft.ts`, `src/components/PairScanner.tsx`, `src/screens/AuthScreen.tsx`, `src/screens/OnboardingScreen.tsx`

---

## 🔗 Pair links (`src/core/pair-link.ts`)

Pure helpers, deliberately free of React Native imports so they unit-test in Node (`pair-link.ts:1`):

- `parsePairLink(url)` matches `sayabot://pair?code=…&server=…` (case-insensitive scheme check `/^sayabot:\/\/pair\b/i`), trims the code, and keeps `server` only when it is an `http(s)` URL with trailing slashes stripped. Returns `null` for anything else or a missing code (`pair-link.ts:9-17`).
- `cleanPairCode(input)` uppercases and strips everything except `[0-9A-Z]`.
- `extractServerFromScan(data)` extracts a server URL from any scanned QR text: a `sayabot://pair?code=...&server=...` pair link, a `sayabot://connect?server=...` link, or a raw `http(s)` server address, returning the normalized URL or null.
- `codeFromScan(data)` is what the camera uses: a pair link (code + server) or a bare 8-character code. Anything else, including a random URL, returns `null` so the scanner keeps looking.
- `supabaseMismatch(appSupabaseUrl, serverSupabaseUrl)` compares URL hosts with a hand-rolled regex (React Native's `URL` lacks `host`), returning true when the server signs people in on a different Supabase project than the app build (`pair-link.ts:24-31`).

---

## 🏠 Server URL handling (`src/core/server-url.ts`)

### `normalizeServerUrl(input)`

Turns loose input into a base URL without using `URL` (`server-url.ts:5-24`):

- Trims; rejects empty or whitespace-containing input.
- If a scheme is present it must be `http://` or `https://` (any other scheme rejected).
- Schemeless input gets `http://` only for local addresses — `localhost`, `127.*`, `10.*`, `192.168.*`, `172.16-31.*`, `*.local` — otherwise `https://` (`server-url.ts:11-14`). So `"192.168.1.20:7431/"` becomes an HTTP LAN URL while `"sayabot.acme.com"` becomes HTTPS. Release APKs allow these `http://` addresses because the main manifest sets `usesCleartextTraffic`.
- Hostname must be alphanumeric/dots/dashes (or bracketed IPv6) and contain a dot unless it is exactly `localhost`.
- Returns `scheme://host[:port]` plus any path, trailing slashes stripped.

### `checkServer(input)`

The gate before the phone trusts a server: normalizes the URL, then `fetch(url + "/api/instance")` with an 8-second `AbortController` timeout (`server-url.ts:36-77`). Responses:

- `ok: true` with `{ webApiUrl, name, supabaseUrl, supabaseAnonKey }` — the JSON must contain `"sayabot": true` plus string `supabase.url` and `supabase.anonKey`; `name` falls back to the host (`server-url.ts:46-65`).
- Distinct errors: "That doesn't look like a web address.", "That server answered, but it isn't running Sayabot (or it needs an update).", "That server isn't set up for the phone app yet.", "The server didn't answer in time. Is it running?", and "Couldn't reach that server. Check the address and your connection."

The same endpoint contract is documented server-side in [Mobile App API](../web/api/api-mobile.md).

---

## 🔀 Switching servers (`src/core/server.ts`)

- `restartApp()` reloads the JS bundle via `expo-updates` `Updates.reloadAsync()`, falling back to `DevSettings.reload()` (`server.ts:16-22`). Switching servers always restarts so every screen rebuilds against the new client.
- `useServer(server)` — the "Connect" path: `supabase.auth.signOut()` (errors swallowed), `saveServer(server)` into AsyncStorage, `saveSettings({ webApiUrl: server.webApiUrl })`, then restart (`server.ts:25-30`).
- `useCloud()` — the "Back to Sayabot Cloud" path: sign out, `saveServer(null)`, reset `webApiUrl` to `ENV.WEB_API_URL`, restart (`server.ts:33-38`).
- Re-exports `checkServer` / `normalizeServerUrl` / `ServerCheck` for callers (`server.ts:14`).

---

## 🤝 Pairing with a code (`src/core/pairing.ts`)

### `pairWithCode(rawCode, serverUrl?)`

Deduplicated via an `inflight` Map keyed by cleaned code — several screens mount `useAuth`, so a scanned link pairs once, not once per listener (`pairing.ts:22-32`). `pairOnce` then:

1. Validates the code is exactly 8 characters (error: "Codes have 8 letters and numbers. Check the one on your computer.") (`pairing.ts:35`).
2. `POST {server}/api/mobile/pair` with `{ code, deviceName, platform }`, where `deviceName` is derived from `Platform.constants` (Android: brand + model, e.g. "Google Pixel 8"; iOS: "iPhone") and `platform` is `"iOS" | "Android"` (`pairing.ts:8-16`, `37-41`).
3. Parses the response `{ error?, token_hash?, org_slug?, device_id?, device_token?, supabase_url? }`; failure throws the server's error message or `Could not sign in (HTTP <status>)` (`pairing.ts:42-50`).
4. **Supabase mismatch branch** (`pairing.ts:51-69`): when the answer's `supabase_url` differs from the app's current Supabase host, the code came from another Sayabot server. The phone runs `checkServer(server)`, redeems the `token_hash` with `verifyOtp({ type: "magiclink" })` on a _newly built_ client for that server's Supabase, persists `webApiUrl` (+ `orgSlug` when returned), `deviceId`, and `deviceToken` into settings via `applySettings`, saves the `SavedServer`, and restarts the app — landing on the new server already signed in.
5. **Same-Supabase branch** (`pairing.ts:71-78`): redeems the token hash with the current `supabase` client and applies `webApiUrl` / `orgSlug` / `deviceId` / `deviceToken` settings without a restart.

`deviceId`/`deviceToken` are what future `GET /api/mobile/device` revocation checks send (see [Navigation & auth](navigation-and-auth.md)).

### `phoneWasRemoved()` and `forgetPairing()`

- `phoneWasRemoved()` loads settings and, only when `deviceId` and `deviceToken` are both set, fetches `GET {currentWebApiUrl()}/api/mobile/device` with the device headers; `status === "revoked"` means the pairing was removed on the computer. Any network failure returns `false` — the check never signs anyone out (`pairing.ts:82-95`).
- `forgetPairing()` clears `deviceId` and `deviceToken` from settings (`pairing.ts:97-99`); `useAuth.signOut()` calls it alongside Supabase sign-out.

`currentWebApiUrl()` (from `src/core/settings.ts:89-92`) reads the in-memory cached settings each call, so a server change applies to the very next request.

### What pairing persists (and what it does not)

| Store                               | Written during pairing                                                                                 | Cleared                                     |
| :---------------------------------- | :----------------------------------------------------------------------------------------------------- | :------------------------------------------ |
| Settings (`@sayabot/settings_v1`)   | `webApiUrl`, `orgSlug` (when the pairing carries one), `deviceId`, `deviceToken` — via `applySettings` | never by pairing                            |
| Saved server (`@sayabot/server_v1`) | only in the Supabase-mismatch branch (`saveServer(check.server)`)                                      | only by `useCloud()`                        |
| Supabase session                    | created by `verifyOtp` on the matching client                                                          | only by sign-out / `useServer` / `useCloud` |
| Push token cache                    | untouched                                                                                              | —                                           |

Note the same-Supabase branch never restarts the app: the existing screens simply re-render against the new settings, which is why org-scoped hooks (`useHome`, `useInbox`) watch `settings.orgSlug` for changes (see [Home & chat](home-and-chat.md) and [Inbox, tasks & usage](inbox-tasks-usage.md)).

---

## 🧱 Workspace drafts (`src/core/workspace-draft.ts`)

Pure helpers used when the phone creates rooms and tasks (kept node-testable; see `tests/unit/workspace-draft.test.ts`):

- `roomNameSlug(name)` lowercases and slugifies a room name to `[a-z0-9_-]`, collapsing runs of dashes and trimming edges (`workspace-draft.ts:3-10`).
- `taskPriority(metadata)` extracts `"low" | "medium" | "high" | "urgent"` from a task's metadata, defaulting to `"medium"` for absent/invalid values (`workspace-draft.ts:12-19`).
- `taskInsertRow(input)` builds the exact insert payload for the `tasks` table — `org_id`, `room_id`, trimmed `title`/`description`, `status: "open"`, `kind: "task"`, `budget_turns` (positive finite values clamped to ≤ 60, default 12), `created_by`, and `metadata: { priority }`; `assignee_agent_id` is included only when delegating (`workspace-draft.ts:22-50`). Priority intentionally lives in `metadata` and task numbering is database-assigned (`workspace-draft.ts:21`).
- `delegationMessage(handle, title, description?)` composes the chat message that wakes a delegated agent immediately instead of waiting for its next check-in: `@<handle> New task for you: <title>[<description>]\nIt's on the task board. Claim it, and ask me here if anything is unclear.` (`workspace-draft.ts:53-57`).

---

## ⌨️ Where pairing is triggered from

Three entry points all funnel into `pairWithCode`:

1. **Scanned QR** — AuthScreen's primary button "Scan the QR code" opens `PairScanner` (`src/components/PairScanner.tsx`), a full-screen `CameraView` from `expo-camera` that reads QR codes. `codeFromScan` (`pair-link.ts`) accepts a `sayabot://pair?code=…&server=…` link or a bare 8-character code. The scan calls `signInWithCode(code, server)` so the server in the QR is used. Camera permission is requested when the scanner opens; if it is refused, the screen offers "Allow camera" and "Type the code instead". A bad code unlocks the camera so the next QR can be tried.
2. **Tapped link** — `useAuth`'s deep-link handler parses the same `sayabot://pair` URL and passes both the code and the server (see [Navigation & auth](navigation-and-auth.md)).
3. **Typed code** — "Type the code instead" opens the code modal, which calls `signInWithCode(codeInput)` with no server argument, so it uses `currentWebApiUrl()`. The modal displays that target ("Server: <url>") with a "Change server" shortcut.
4. All three paths share the same dedupe map, so a QR scanned while a code is already being redeemed cannot double-pair.

The unit suites `tests/unit/server-url.test.ts` and `tests/unit/server-check.test.ts` pin `normalizeServerUrl` and `checkServer` behavior (the node-testable halves of this page); `tests/unit/workspace-draft.test.ts` covers the draft helpers.

---

## 🧭 Onboarding wizard (`src/screens/OnboardingScreen.tsx`)

A three-step first-run flow (`STEPS = ["hello", "how", "look"]`, `OnboardingScreen.tsx:13`), shown by `RootNavigator` when signed in but `!settings.onboarded`:

1. **`hello`** — three `Mascot` avatars (`hermes`, working `scout`, `writer`) and the pitch "Your AI team, in your pocket" (`OnboardingScreen.tsx:38-52`).
2. **`how`** — three explainer cards: _Answer_ (agent questions land in your Inbox), _Hand out work_ (New task → pick who does it), _Check in_ (a pulsing ring means an agent is working) (`OnboardingScreen.tsx:53-71`).
3. **`look`** — "Make it yours" preference chips, all changeable later in More (`OnboardingScreen.tsx:72-106`):
   - Theme mode chips for `system` (labeled "Automatic"), `light`, `dark` writing `settings.themeMode`.
   - A push-alerts chip calling `enablePush(true)` from `src/core/push.ts`; on success it flips `alertsOn` and persists `pushNotifications: true`.
   - An App Lock chip that toggles `appLock`; enabling it verifies biometric hardware and enrollment (`hasHardwareAsync` + `isEnrolledAsync`) and requires a successful `authenticateAsync({ promptMessage: "Turn on app lock" })` before saving (`OnboardingScreen.tsx:94-104`).

Progress dots render above the content; "Continue" advances and the final step's button reads "Get started" (`OnboardingScreen.tsx:31-35`, `109`). A "Skip" ghost button appears on every step except the last. Both paths call `finish()`: `haptic.success()` then `updateSettings({ onboarded: true })`, which makes `RootNavigator` swap to the main tabs (`OnboardingScreen.tsx:24-27`, `110`).

Note the wizard is intentionally short — it does not create an org or workspace record; org selection comes from the pairing response (`orgSlug`) or the `DEFAULT_ORG_SLUG` setting, and server/credential setup is handled entirely by the pairing flow above.

---

Related docs: [Navigation & auth](navigation-and-auth.md), [Overview](overview.md), [Settings & UI kit](settings-and-ui-kit.md), [Mobile App API](../web/api/api-mobile.md), [Self-hosted flow](../../self-hosted-flow.md)

## 🏠 Self-hosted and Mac setups

Phone pairing is free on every server, with no plan check in `/api/mobile/pair`. How a phone reaches each setup:

| Setup                                                           | What the phone uses                                                                       | Reach                               |
| :-------------------------------------------------------------- | :---------------------------------------------------------------------------------------- | :---------------------------------- |
| Cloud / public domain server                                    | server domain                                                                             | anywhere                            |
| Self-hosted with a domain (`deploy/docker-compose.yml` + nginx) | the domain                                                                                | anywhere                            |
| Sayabot running on a Mac (`pnpm dev` / local)                   | `http://<Mac's Wi-Fi IP>:<port>`, put into the QR by `createPhonePairingAction`           | same Wi-Fi                          |
| Same Mac + `cloudflared tunnel --url http://localhost:7431`     | `https://<random>.trycloudflare.com` (open the web app there first, so the QR carries it) | anywhere, until the tunnel restarts |

A typed code is sent to the phone's current server. If the phone is still on Sayabot Cloud and Cloud answers 410 for a code made by another server, `pairOnce` appends "If your computer runs its own Sayabot, tap Change server and enter the address shown under the code." Scanning the QR avoids this, because the link carries `server=`.
