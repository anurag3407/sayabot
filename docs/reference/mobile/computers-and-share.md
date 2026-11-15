# Computers, Share Target & Agent Profiles

This group covers the secondary stack screens: `ComputersScreen` watches the org's paired Macs (Sayabot for Mac runners) and agents' cloud computers with a 15-second poll; `WebPageScreen` embeds any Sayabot web page in an authenticated WebView; `ShareTargetScreen` is the modal intake for the OS "Share to Sayabot" flow; `AgentProfileScreen` renders an agent's identity, model, usage, and rooms from the home snapshot; and `AdvancedScreen` holds the technical escape hatches — push toggle, server URL with diagnostics, update checks, and app reset.

Source files: `src/screens/ComputersScreen.tsx`, `src/screens/WebPageScreen.tsx`, `src/screens/ShareTargetScreen.tsx`, `src/screens/AgentProfileScreen.tsx`, `src/screens/AdvancedScreen.tsx`

---

## 💻 Computer management (`src/screens/ComputersScreen.tsx`)

`ComputersScreen` (stack screen `Computers`, pushed from More) fetches `GET /api/mobile/computers?orgSlug=<settings.orgSlug>` through the shared `api()` helper (`ComputersScreen.tsx:39-50`), polling every 15 seconds while mounted plus pull-to-refresh (`ComputersScreen.tsx:52-56`, `62`). The endpoint's server side is documented in [Mobile App API](../web/api/api-mobile.md).

Two sections:

### "Your Macs"

Each `Mac` record is `{ id, name, platform, online, mine, ownerName, permissions, localAgents, settings }` (`ComputersScreen.tsx:10-20`). Rows show:

- A `Laptop` icon tile, the Mac's name, and a status line: "Online"/"Offline", `<owner>'s` for other people's Macs, and "· runs agents" when `settings.runnerEnabled` (`ComputersScreen.tsx:72-91`).
- "Signed in here: <agents>" listing `localAgents` with `status === "ready"` (`ComputersScreen.tsx:87-91`).
- A warn note on your own Mac when the `screen` or `accessibility` permission is not `"granted"`: "On the Mac, allow Screen Recording and Accessibility for Sayabot to see and control it." (`ComputersScreen.tsx:92-96`).
- An **"Open screen"** button (disabled with label "Offline" when `!mac.online`) that navigates to `WebPage` with `path: /{orgSlug}/remote/{mac.id}` and `title: mac.name` — the web app's remote-desktop view (`ComputersScreen.tsx:97-103`).
- Empty state: "No computers yet / Install Sayabot for Mac to see and control it from here." with the footer hint "Open Sayabot for Mac on a computer and sign in. It shows up here."

### "Agents' cloud computers"

`CloudComputer` rows (`{ agentId, name, status, diskUsedMb, diskMb }`) render as read-only `Row`s: status is prettified (`running` → "Running", `none` → "Not started") alongside "X of Y GB used" (`diskMb` is converted from MB to GB by dividing by 1024) (`ComputersScreen.tsx:108-119`). Empty state: "None running / Agents with a computer get one when they first need it."

The underlying computer lifecycle (Docker/smolvm/e2b, `/home/bot` persistence) is documented in [Tools & sandboxes](../../tools-and-sandboxes.md); the phone only observes it here — there is no start/stop/delete control on this screen.

### Loading and error handling

- `loaded` only flips true after the first request settles (success or failure), so a slow network shows a "Loading…" `EmptyState` rather than empty groups implying "no computers" (`ComputersScreen.tsx:35`, `120`).
- Request errors render once at the top in danger tone ("Couldn't load computers" or the server's message) and do not wipe previously loaded rows, since `setMacs`/`setCloud` are only called on success (`ComputersScreen.tsx:39-50`, `64-68`).
- The 15-second poll re-runs `load()` through the same `api()` helper, so it inherits bearer-token auth and the `currentWebApiUrl()` base — a server switch takes effect on the next poll tick.

---

## 🌐 In-app web viewer (`src/screens/WebPageScreen.tsx`)

`WebPageScreen` takes `{ path, title }` params and renders the corresponding Sayabot web page inside a `react-native-webview` (`WebPageScreen.tsx:15-52`):

- **Session handover**: the target URL is built by `signedInWebUrl(path)` from `src/core/api.ts` — `{base}/auth/complete?next=<path>#access_token=…&refresh_token=…` when a Supabase session exists, or the plain path otherwise. Tokens travel in the URL *fragment*, which browsers keep client-side and never send to the server (`WebPageScreen.tsx:23-25`; `api.ts:82-89`).
- **WebView flags**: `allowsInlineMediaPlayback` with `mediaPlaybackRequiresUserAction: false` (remote-desktop audio/video), `mediaCapturePermissionGrantType: "grantIfSameHostElsePrompt"`, `allowsBackForwardNavigationGestures`, `setSupportMultipleWindows: false`, `pullToRefreshEnabled`, `originWhitelist: ["https://*", "http://*"]` (`WebPageScreen.tsx:39-51`).
- A themed header offers Back and Reload (`RotateCw` re-runs `ref.current?.reload()`); an `ActivityIndicator` overlays until `onLoadEnd` (`WebPageScreen.tsx:29-57`).

Callers: the Computers screen's "Open screen" (remote desktop), and the home screen's "Add agent" tile links the same web surface externally (`Linking.openURL` of `/{orgSlug}/agents`, see [Home & chat](home-and-chat.md)). MoreScreen opens three more pages through it — `/{orgSlug}/agents`, `/{orgSlug}/marketplace`, `/{orgSlug}/cron` (titled "Routines"), and `/{orgSlug}/settings/phones` ("Phones signed in") — all sharing the same fragment-based session handover, so no separate mobile auth exists for these pages (see [Settings & UI kit](settings-and-ui-kit.md)).

---

## 📤 Share target (`src/screens/ShareTargetScreen.tsx`)

The endpoint of the OS-level "Share to Sayabot" integration. The `expo-share-intent` plugin is configured in `app.json` (iOS activation rules: text, 1 web URL, up to 4 images/files; Android intent filters `text/*`, `image/*`, `application/pdf`) and provided at the app root by `ShareIntentProvider` (see [Overview](overview.md)). When `hasShareIntent` flips, `RootNavigator` opens this screen as a bottom-sheet modal (see [Navigation & auth](navigation-and-auth.md)).

`ShareTargetScreen` reads `useShareIntentContext()` (`ShareTargetScreen.tsx:19`):

- **Files** map to the same `Picked` shape the chat composer uses: `file://`/`content://` paths are normalized, `mimeType` decides `isImage`, missing names become `"file"` (`ShareTargetScreen.tsx:26-32`).
- **Text** combines `shareIntent.text` and `shareIntent.webUrl` (deduplicated, newline-joined) (`ShareTargetScreen.tsx:33`).
- **UI**: previews of shared images (64px thumbnails) or file chips, the shared text in a card, a note input ("Add a note, like \"@hermes summarise this\""), and a chat picker `FlatList` from `useHome()` with the first room agent's Mascot as the row icon and a "✓" on the selection (`ShareTargetScreen.tsx:64-121`).
- **Send** (`ShareTargetScreen.tsx:42-62`): uploads up to 6 files with `uploadToRoom(chat.id, f)` converting each to `attachmentMarkdown`, assembles `content = [note, sharedText, ...links]`, then posts with `postRoomMessage(data.org.slug, chat.id, content)` (the same `POST /api/messages` used elsewhere). On success it fires `haptic.success()`, resets the share intent, and `navigation.replace("Chat", …)` so Back leaves the share flow entirely; the modal also has a Cancel (`X`) that resets the intent and pops.
- Closing without sending still calls `resetShareIntent()`; combined with `resetOnBackground: true` on the provider, a stale share never reopens later.

---

## 🧭 Entry points & wiring

| Screen | Stack route | Presented by | Params |
| :-- | :-- | :-- | :-- |
| ComputersScreen | `Computers` | MoreScreen row | none |
| WebPageScreen | `WebPage` | Computers "Open screen", (potentially any caller passing a web path) | `{ path, title }` |
| ShareTargetScreen | `ShareTarget` | OS share intent via `SignedInEffects` | none |
| AgentProfileScreen | `AgentProfile` | Home agent strip, home search results | `{ agent: HomeAgent, orgSlug }` |
| AdvancedScreen | `AdvancedSettings` | MoreScreen row | none |

`ShareTargetScreen` caps shared files at 6 by the composer's own attachment cap (`slice(0, 6)` in ChatScreen picking; the share screen uploads `files.slice(0, 6)`), uploads sequentially, and posts a single message — so the receiving chat sees one bubble with inline `![…]` / `[📎 …]` links exactly like a hand-attached message. The screen renders only when the home snapshot has chats; with no chat selected the Send button stays disabled (`ShareTargetScreen.tsx:128`).

On the AdvancedScreen server field: because it writes `settings.webApiUrl` without touching the saved `SavedServer`, the Supabase client keeps pointing at the previous project — it is meant for correcting an address on an already-paired self-hosted setup, not for switching servers (the Auth screen picker is the switching flow).

---

## 🤖 Agent profiles (`src/screens/AgentProfileScreen.tsx`)

`AgentProfileScreen` takes `{ agent, orgSlug }` params but always prefers the fresh `HomeAgent` with the same id from `useHome()` data, falling back to the param object (`AgentProfileScreen.tsx:16-18`). Sections:

- **Identity**: a 96px `Mascot` (working ring while `workingRoomId` is set), name, `@handle` with `kind` ("Invited" for `external`, "Made here" for `llm`), optional `about`, and "Working in <room> now" when active (`AgentProfileScreen.tsx:29-46`).
- **Message button**: appears when the agent shares at least one chat; navigates to the first one (`AgentProfileScreen.tsx:47-54`).
- **"Thinks with"**: the agent's `model` with the subtitle "Its own app's model and subscription" (external) or "Change it in the web app under Agents" (`AgentProfileScreen.tsx:57-59`).
- **"Last 30 days"**: Runs / Tokens / Spend / Last active rows from `agent.usage` (`{ tokens, runs, costUsd, lastAt, topModel }`), with a footer noting "Runs on its own subscription, so tokens aren't billed here." for external agents or when the model string matches `/computer/` (`AgentProfileScreen.tsx:61-66`).
- **"In N chats"**: the agent's rooms — either listed in its `roomIds` or containing the agent — each opening the chat (`AgentProfileScreen.tsx:20`, `68-72`).

Entry points: the home agent strip, search results, and chat avatars all navigate here with the agent and orgSlug (see [Home & chat](home-and-chat.md)).

---

## 🛠️ Advanced settings (`src/screens/AdvancedScreen.tsx`)

`AdvancedScreen` (stack screen `AdvancedSettings`) is built from `useSettings()` and `useAppUpdates()` groups:

### Notifications

A `ToggleRow` "Alerts on this phone" bound to `settings.pushNotifications`. Toggling calls `enablePush()` / `disablePush()` from `src/core/push.ts` first, then persists `pushNotifications`, updating a footer note ("Alerts are on." / "Alerts are off for this phone.") or the thrown error ("Couldn't change alerts") (`AdvancedScreen.tsx:22-42`). While busy, a "Working…" row shows. Push registration mechanics are in [Push & updates](push-and-updates.md).

### Server

- An editable `webApiUrl` text input with a **Save** button that trims trailing slashes, rejects non-`http(s)` values via `Alert.alert("Use an address that starts with https://")`, and persists with `updateSettings({ webApiUrl: next })` (`AdvancedScreen.tsx:44-69`). Note this path writes the setting directly — it does not run `checkServer()`/`useServer()` or swap the Supabase client the way the Auth screen's server picker does (see [Pairing & onboarding](pairing-and-onboarding.md)).
- **Test connection** runs `runDiagnostics(server.trim())` from `useSettings`, which fires both probes from `src/core/settings.ts` in parallel: `pingGateway(target)` (`GET {url}/api/health` with a 6-second timeout, falling back to a `HEAD` on the root; `ok` = status < 500, reporting latency) and `pingDatabase()` (a `select id from orgs limit 1` via Supabase) (`AdvancedScreen.tsx:68-74`; `settings.ts:145-211`). The result line reads "Server OK (N ms) · Data OK (N ms)" in ok tone, otherwise "unreachable" in danger tone.

### App updates

A "Check for updates" row from `useAppUpdates()`: subtitle cycles "Checking for updates…" / "Update available (v<latest>)" / "You are on the latest version"; the installed version shows in the group footer (`AdvancedScreen.tsx:78-91`). The check flow (`GET /api/mobile/version` and the update prompt) is documented in [Push & updates](push-and-updates.md).

### Reset

"Reset this app" (destructive) shows a confirm `Alert` ("Reset Sayabot on this phone?" — "Your workspace isn't affected.") and calls `resetAll()` from `useSettings`, wiping the `@sayabot/settings_v1` AsyncStorage key back to `DEFAULT_SETTINGS` (`AdvancedScreen.tsx:93-106`; `settings.ts:124-133`). Note this clears settings only — the paired server record (`@sayabot/server_v1`) and Supabase session are separate keys.

---

## 📌 Behavior notes

- All five screens tolerate a missing home snapshot or unset `orgSlug` gracefully: Computers/Usage fetch with whatever slug is set, ShareTarget disables Send, and AgentProfileScreen returns `null` when the agent cannot be resolved from either the route params or the snapshot (`AgentProfileScreen.tsx:19`).
- None of these screens write to the database directly except ShareTargetScreen (via `postRoomMessage` and `uploadToRoom`); Computers, AgentProfile, and Advanced read through `api()` or the `useHome` snapshot.
- Deep links back into the stack (task detail → chat, agent profile → chat) pass `{ roomId, roomName, orgSlug }` consistently, matching the params `ChatScreen` destructures.

---

Related docs: [Push & updates](push-and-updates.md), [Pairing & onboarding](pairing-and-onboarding.md), [Home & chat](home-and-chat.md), [Mobile App API](../web/api/api-mobile.md), [Computers & remote UI](../web/pages/computers-remote-ui.md), [Tools & sandboxes](../../tools-and-sandboxes.md)
