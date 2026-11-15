# Admin & Public Pages

Two groups of screens share this doc. First, **workspace admin**: `/[org]/admin` is now only a redirect — member management moved into `/[org]/settings/workspace`, whose role form and remove-member controls live in `components/admin/`. Second, the **public pages**: the help, privacy, terms, and security documents plus the `/download` page, all sharing `PublicShell` chrome, and the `/download` + `/api/download` redirect routes that resolve to GitHub release artifacts.

Source files: `apps/web/src/app/(workspace)/[org]/admin/page.tsx`, `apps/web/src/components/admin/member-role-form.tsx`, `apps/web/src/components/admin/remove-member-button.tsx`, `apps/web/src/app/help/page.tsx`, `apps/web/src/app/privacy/page.tsx`, `apps/web/src/app/terms/page.tsx`, `apps/web/src/app/security/page.tsx`, `apps/web/src/app/download/page.tsx`, `apps/web/src/components/public/public-shell.tsx`, `apps/web/src/components/public/doc-page.tsx`, `apps/web/src/components/public/mac-download.tsx`, `apps/web/src/app/api/download/*/route.ts`, `apps/web/src/app/download/*/route.ts`

---

## 🛡️ Admin Page (`(workspace)/[org]/admin/page.tsx`)

The whole page is:

```typescript
// apps/web/src/app/(workspace)/[org]/admin/page.tsx:3
/** Moved into settings; kept so old links and bookmarks still land. */
export default async function AdminPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params
  redirect(`/${org}/settings/workspace`)
}
```

Member management (invites, roles, removal) lives on the settings/workspace page — see [Settings UI](./settings-ui.md). The `components/admin/` widgets are used there.

## 👥 Member Role Form (`components/admin/member-role-form.tsx`)

`MemberRoleForm({ orgSlug, userId, role, allowOwner })` is a client component using `useActionState` with the `setMemberRole` server action (a form-action signature `(_prev, formData)` from `lib/actions/orgs.ts`):

- Hidden inputs carry `orgSlug` and `userId`; a `Select` offers `member` / `admin`, plus `owner` only when `allowOwner` is true; a small outline **save** button shows "saving" while pending.
- On a successful result it `router.refresh()`es (`member-role-form.tsx:24-26`); inline `<span>` feedback shows `state.error` (alert role) or "saved".

The server-side guard in `setMemberRole` (`lib/actions/orgs.ts:402`): `adminOrgAccess` gate, `orgRoleSchema` validation, "Only an owner can promote someone to owner", target lookup in `org_members`, and (further down) last-owner protections.

## 🚪 Remove Member Button (`components/admin/remove-member-button.tsx`)

`RemoveMemberButton({ orgSlug, userId, name })` wraps a `ConfirmButton` (from `components/ui/confirm-button.tsx`) whose confirm label is "Remove <name>" with the warning "They lose access to every room here. Their past messages stay." Confirmation calls `removeMemberAction({ orgSlug, userId })` in a transition; success toasts "<name> removed" and refreshes; errors render inline.

`removeMemberAction` (`lib/actions/orgs.ts:356`) rules: admin-gated; "You cannot remove yourself"; "Member not found"; "Only an owner can remove another owner"; "A workspace needs at least one owner".

## 🌐 Public Chrome (`components/public/public-shell.tsx`)

`PublicShell({ children })` is the shared frame for every public page: it imports the landing page's stylesheet (`landing.css`) and the Anybody variable font, renders the landing `SiteHeader`, a `<main id="main-content">` with `pt-24 sm:pt-28` clearance for the fixed header, and a footer containing `SiteFooterLinks`. So help/legal/download pages look exactly like the landing page (see [Landing page](./landing-page.md)).

## 📄 Doc Pages (`components/public/doc-page.tsx`)

Three composable building blocks:

- **`DocPage({ eyebrow, title, lede, draft?, children })`** — `PublicShell` + centered `max-w-3xl` article: mono eyebrow, H1 title, lede paragraph, and — when `draft` is true — a warning banner: *"Draft. This is a working draft for the operator of this deployment to review with counsel before publishing. It is not legal advice."* A footer line links to `/`, `/security`, `/privacy`, `/terms`.
- **`DocSection({ title, children })`** — an `<h2>` plus muted body copy.
- **`DocList({ items })`** — a bulleted list of plain strings.

### The four documents

| Page | Eyebrow | Draft? | Content |
| :--- | :--- | :--- | :--- |
| `/help` | `help` | no | "How Sayabot works": quick start (account, rooms, @mentions, Inbox), rooms/turns/advisory-lock model, collaboration (invites, bot keys, cursors, approvals), meetings and check-ins, tasks/requests/Inbox, approvals and webhooks, sign-in/account, troubleshooting. Links to `/signup`, `/login`, and the sibling legal pages. |
| `/privacy` | `privacy` | **yes** | Privacy policy draft: what is stored (account, workspace data, agent config, encrypted secrets, operational data), why, processors (Supabase, model providers, E2B, Brave, MCP servers, bot webhooks — operator chooses), cookies (Supabase session cookies only, no ad cookies), retention/deletion (operator-managed), your choices, contact. |
| `/terms` | `terms` | **yes** | Ten numbered sections: service, accounts, workspaces/rooms, agents/models/tools, content ownership, acceptable use (no PII like government IDs, card data, medical records, passwords), keys and secrets, availability, disclaimers, contact. |
| `/security` | `security` | no | Access (Supabase Auth, RLS room scoping, hidden ciphertext/hashes, service role only server-side), secrets (AES-256-GCM envelope, agent keys hashed SHA-256, HMAC-SHA256 signed webhooks with 5-minute tolerance, secret redaction), dangerous actions (admin approval, DB notification wait, 5-minute timeout counts as rejection), isolation (E2B microVM, sandboxed iframes, webhook SSRF checks, advisory locks), operations, reporting, and an explicit **no certification claim** ("does not claim SOC 2, ISO 27001 or any other certification"). |

All four are static server components with only `metadata`; every page's copy emphasizes that the *deployment operator* is the responsible party (self-hosted framing).

## ⬇️ Download Page (`app/download/page.tsx`)

A server component under `PublicShell` promoting the Mac and Android clients:

- Computes `thisServer()` from the request headers via `getPublicOrigin` (`lib/public-origin.ts`), so a self-hosted page advertises its own address.
- **Self-hosted extra panel** (only when `edition() === "self-hosted"` from `lib/env.ts` **and** `needsServerAddress(server)` from `lib/public-origin.ts`, i.e. the host is not `DEFAULT_APP_SERVER_HOST` = `sayabot.sayalabs.in`, the server the apps use out of the box; the official server may run with `SAYABOT_EDITION` unset, which defaults to self-hosted): "Connect your apps to <instanceName>" with a `sayabot://connect?server=<url>` deep link ("Open in Sayabot for Mac"), the host name with a `CopyButton`, and instructions to pick "My own server" on a fresh install (`download/page.tsx:52-90`).
- **Mac card**: Apple icon, "macOS 14+" badge, feature list ("Uses your own Claude or ChatGPT subscription", etc.), and the `<MacDownload>` client widget.
- **Android card**: "Android 10+" badge and a single white **Download Android APK** button pointing at `DOWNLOADS.androidApk` (downloaded as `Sayabot.apk`), noted as "Direct release install · No Google Play account required".
- **How the Connected Flow Works**: a 4-step banner (install Mac app → sign in with Google → install phone APK → control 24/7) with an alert-mood `Mascot seed="Pip"`.
- **Self-hosting callout** linking to the GitHub self-hosting quickstart (`SELF_HOSTING_DOCS` constant at `download/page.tsx:13-14`).

### `MacDownload` (`components/public/mac-download.tsx`)

Client component detecting the Mac's chip so users get one button instead of an arch choice:

- `detectChip()` (`mac-download.tsx:14-37`): first `navigator.userAgentData.getHighEntropyValues(["architecture"])` (`arm` / `x86`); falls back to the WebGL renderer string (`/apple (m\d|gpu)/i` → arm, `/intel|amd|radeon/i` → intel); otherwise `unknown`, which defaults to **Apple Silicon** ("every Mac sold since 2020").
- Renders a white "Download for Mac" button for the detected arch (`Sayabot-arm64.dmg` / `Sayabot-x64.dmg`), an opposite-arch fallback link ("Mac with an Apple chip (M1 or newer)?" / "Older Mac with an Intel chip?"), a 3-step install list (drag to Applications, the macOS Gatekeeper "Open Anyway" flow, sign in), and a `<details>` with the one-line Terminal install: `curl -fsSL <server>/install-mac.sh | bash`, copyable via `CopyButton`.

### Download URLs (`components/landing/content.ts`)

`DOWNLOADS` is the single source of truth used by both the download page and the redirect routes: `macArm64` / `macIntel` / `androidApk` all point at GitHub release assets (`https://github.com/anurag3407/sayabot/releases/latest/download/…`), `web` at `/signup`, `mobile` at `/download`.

## 🔀 Download Redirect Routes

Six thin route handlers, all `dynamic = "force-dynamic"` and 302 redirects with `Cache-Control: no-cache, no-store, must-revalidate` (so a re-release takes effect immediately):

| Route | Behaviour |
| :--- | :--- |
| `GET /api/download/mac` and `GET /download/mac` | `?arch=x64` → `DOWNLOADS.macIntel`; otherwise `DOWNLOADS.macArm64` |
| `GET /api/download/android` and `GET /download/android` | → `DOWNLOADS.androidApk` |
| `GET /api/download/apk` and `GET /download/apk` | → `DOWNLOADS.androidApk` |

The `/download/*` pages and `/api/download/*` handlers are exact duplicates (pairs share identical code), giving marketing-friendly paths and API-stable paths. Both path families are in the middleware's public allowlist, so they work signed-out.

## Related docs

- [Settings UI](./settings-ui.md) — the workspace settings page (members, invites) the admin page redirects to
- [Landing page](./landing-page.md) — the header/footer/stylesheet `PublicShell` reuses
- [Auth flows](./auth-flows.md) — the login/signup pages linked from help, and the Supabase session model the legal pages describe
- [Onboarding](./onboarding.md) — where new signups land after account creation
- [Computers & remote UI](./computers-remote-ui.md) — what the Mac app enables (download page links here via `/download`)
- [App overview](./app-overview.md) — the middleware public-path allowlist covering these routes
- ../../architecture/security-model.md — the security guarantees the `/security` page describes
- ../../architecture/editions-and-licensing.md — `edition()` / self-hosted behaviour on the download page
