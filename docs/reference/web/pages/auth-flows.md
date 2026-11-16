# Auth Flows

The web app authenticates against Supabase Auth and keeps the session in cookies, refreshed by middleware on every request. On top of the classic password / OAuth / magic-link paths it implements four less common flows end-to-end in the UI: a 6-digit code verification panel, a guest-to-account merge used by desktop guest mode, and deep-link token handoffs to the Mac and mobile apps. Email sending (verification codes, magic links, reset links) is done in application code via Resend templates rather than Supabase's built-in mailer.

Source files: `apps/web/src/app/login/page.tsx`, `apps/web/src/app/signup/page.tsx`, `apps/web/src/app/forgot-password/page.tsx`, `apps/web/src/app/reset-password/page.tsx`, `apps/web/src/app/auth/callback/route.ts`, `apps/web/src/app/auth/complete/page.tsx`, `apps/web/src/app/auth/merge/route.ts`, `apps/web/src/app/auth/merge/finish/page.tsx`, `apps/web/src/app/auth/save-account/page.tsx`, `apps/web/src/app/auth/desktop/page.tsx`, `apps/web/src/app/auth/mobile/page.tsx`, `apps/web/src/components/auth/*`, `apps/web/src/lib/actions/auth.ts`, `apps/web/src/lib/actions/guest-merge.ts`, `apps/web/src/lib/guest-merge.ts`

---

## 🔐 Server Actions (`src/lib/actions/auth.ts`)

All actions follow the `useActionState` signature `(prevState, formData) => Promise<ActionResult>` (from `src/lib/types.ts`) and validate with Zod schemas declared at the top (`emailSchema`, `passwordSchema` min 8 / max 72, `nameSchema` 1–60). Two helpers shape every flow:

- `requestOrigin()` (`lib/actions/auth.ts:26`) — `NEXT_PUBLIC_SITE_URL` or the request's `origin`/`host`, used to build absolute callback URLs.
- `callbackUrl(next)` — always routes through `/auth/callback?next=<safeNextPath(next)>`.

| Action | Behaviour |
| :--- | :--- |
| `signUpAction` | Validates name/email/password/terms, then calls Supabase admin `generateLink({ type: "signup" })` to create the user + OTP without the Supabase dashboard mailer, and emails the 6-digit `email_otp` plus action link via `sendVerificationEmail`. If the email already exists but was never confirmed, it re-sends a magiclink code instead and returns `needsVerification`; a confirmed duplicate returns "already exists. Sign in instead." Success returns `data: { needsVerification: true, email }` which the panel turns into the verify step. |
| `verifyEmailAction` | Tries `supabase.auth.verifyOtp` with the 6-digit token for types `signup`, `email`, then `magiclink`. On failure it checks (admin client) whether the email is already confirmed — returning a specific "already verified" message — otherwise "invalid or expired". On success `redirect(next)` (session cookies are now set on the server client). |
| `resendVerificationAction` | Admin `generateLink({ type: "magiclink" })` and re-emails the code. |
| `signInEmailAction` | `signInWithPassword`; an "email not confirmed" error returns `needsVerification` so the UI switches to the code entry; success `redirect(next)`. |
| `sendMagicLinkAction` | Admin `generateLink({ type: "magiclink" })`, emails code + link via `sendMagicLinkEmail`, returns `needsVerification` so the same code-entry panel is reused for sign-in. |
| `forgotPasswordAction` | Admin `generateLink({ type: "recovery" })` targeting `/auth/callback?next=/reset-password`, emails it. Always returns a neutral success message (no account enumeration). |
| `updatePasswordAction` | Requires a current user (reset link session), validates password + confirm match, `supabase.auth.updateUser({ password })`, `redirect("/")`. |
| `signOutAction` | `auth.signOut()` then `redirect("/login")`. |

Every `next` value passes through `safeNextPath` (`src/lib/safe-next.ts`), which rejects anything not starting with `/`, protocol-relative `//`, backslashes (browsers normalize `/\evil.com` to a slash), and control characters.

---

## 🪟 Login & Signup Screens

`/login` (`src/app/login/page.tsx`) and `/signup` (`src/app/signup/page.tsx`) are server components rendered inside `PublicShell`. Both bounce signed-in users to their first org (or `/onboarding`) unless `?force|reauth|switch=true` (login only). Login accepts `next`, `error`, `verified`, and `merge` params:

- `?verified=true` shows a green "email verified, sign in" notice.
- `?error=<msg>` renders a red notice with two special-cased messages: `auth` (expired link) and PKCE/"code verifier" errors, which are reframed as "Your email is verified! Please sign in below."
- `?merge=1` is the desktop guest-merge variant: the sign-in/sign-up side panel explains that bots and chats will move into the account chosen, and signup `next` is the merge confirm step instead of `/onboarding`.

`AuthPanel` (`src/components/auth/auth-panel.tsx`) is a single client component with three internal states:

- **`mode`** (`"signup" | "signin"`) — `SignUpForm` / `SignInForm`, switchable in place.
- **`verification`** (`{ email, next }`) — when either form's action returns `needsVerification`, a `useEffect` lifts it into `VerifyForm`, which renders the 6-digit `CodeInput` plus a resend form. Signing up defaults `signupNext="/onboarding"`; signing in defaults `signInNext="/"`.

`CodeInput` (`src/components/auth/code-input.tsx`) is six single-char inputs with a hidden `name="code"` input carrying the joined digits; it supports paste of a full code, arrow-key navigation, and backspace-to-previous.

`OAuthButtons` (`src/components/auth/oauth-buttons.tsx`) renders Google and GitHub buttons only when the corresponding `googleAuthEnabled()` / `githubAuthEnabled()` flags (from `src/lib/env.ts`) are on. Clicking calls `supabase.auth.signInWithOAuth` **from the browser client** with `redirectTo: <origin>/auth/callback?next=...` (Google gets `prompt: "select_account"`), so the provider round-trip completes in the browser and lands on the callback route.

---

## 🔁 Callback Route (`/auth/callback`)

The single GET handler for every provider redirect, email link, and OTP link (`src/app/auth/callback/route.ts`). Flow:

1. **Origin resolution** — `x-forwarded-host` + `x-forwarded-proto` (proxy/tunnel safe), else `NEXT_PUBLIC_SITE_URL`, else the request origin.
2. **Provider error** — `error`/`error_description` query params redirect to `/login?error=...`.
3. **Token-hash links** — `token_hash` + `type` (any of `signup|invite|magiclink|recovery|email_change|email`) → `supabase.auth.verifyOtp({ token_hash, type })`.
4. **PKCE code** — `code` → `exchangeCodeForSession(code)`.
5. **Database session recovery** — if the code exchange fails, `recoverSessionFromCode()` (`route.ts:62`) opens a direct `pg` connection, looks up `auth.flow_state` by `auth_code`, rejects codes older than 24 h, confirms the email if needed, generates an admin magiclink, verifies its `hashed_token` on the server client to mint session cookies, and deletes the `flow_state` row to prevent replay. This rescues links whose PKCE verifier was lost (e.g. opened in a different browser).
6. **Profile sync** — `syncUserProfile()` (`route.ts:18`) upserts a `profiles` row from user metadata: display name from `full_name` / `name` / `user_name` / email prefix, avatar from `avatar_url` / `picture`; it only fills missing values on existing profiles.
7. **Destination** — explicit `next` wins; otherwise first org slug (`listUserOrgs`) or `/onboarding`.

## 🏁 Complete Auth (`/auth/complete`)

A page for implicit-flow links that carry tokens in the URL **fragment** (which never reaches the server). `CompleteAuth` (`src/components/auth/complete-auth.tsx`) runs once in the browser:

- Reads errors from query or hash; renders a "Sign-in Incomplete" card with a back-to-login link on failure.
- While that runs, the page shows `WorkspaceSkeleton` (a sidebar and a room with no data yet) instead of a blank screen.
- `access_token` + `refresh_token` in the hash → `supabase.auth.setSession(...)`, then `window.location.replace` to `next`, else the first org (queried client-side from `org_members`/`orgs`) or `/onboarding`.
- `DesktopSessionSync` (`src/components/desktop-session-sync.tsx`), mounted from the root layout, runs only inside the Mac app. On every auth state change it copies the browser session into the app's `sayabot-session.json` through `sayabotDesktop.saveLiveSession`, so the file does not keep a refresh token the page has already replaced.
- `code` or `token_hash` in the query → forwards everything to `/auth/callback`.
- No tokens: falls back to an existing browser session with the same destination logic, else errors.

While it is working, `WorkspaceSkeleton` covers the page. A failed sign-in still shows the error card.

---

## 👤 Guest → Account Merge

Desktop guest mode creates real but **anonymous** Supabase users (`is_anonymous === true`). Saving the account moves everything the guest owns into a real login.

```mermaid
sequenceDiagram
    participant App as Mac app / browser (guest)
    participant API as POST /api/account/merge
    participant M as /auth/merge
    participant L as /login
    participant F as /auth/merge/finish
    participant DB as account_merge_tickets + merge_guest_into_user()

    App->>API: POST { next } (bearer or cookie)
    API->>DB: createMergeTicket() — SHA-256 hash stored, 30 min TTL
    API-->>App: { url: /auth/merge?ticket=<raw> }
    M->>M: validate ticket, move raw ticket into httpOnly cookie
    alt already signed in as a full account
      M->>F: redirect
    else
      M->>L: redirect /login?force=true&merge=1&next=/auth/merge/finish
      L->>F: after sign-in / sign-up
    end
    F->>DB: summarizeGuest() — workspaces + computers listed
    F->>DB: confirmGuestMergeAction → completeGuestMerge()
    DB->>DB: claim ticket (atomic update), rpc merge_guest_into_user
    F-->>App: redirect next / first workspace; guest auth user deleted
```

The pieces:

- **Ticket store** (`src/lib/guest-merge.ts`) — `account_merge_tickets` rows store only `hashTicket(token)` (SHA-256), `guest_user_id`, `expires_at` (30 minutes). `findMergeTicket` matches unused, unexpired hashes. `completeGuestMerge` claims the ticket with a conditional `update ... is used_at null` (so two tabs cannot merge twice), calls the `merge_guest_into_user` SQL function (`packages/db/sql/0031`), releases the claim on failure ("Nothing was changed. Try again."), deletes the guest auth user on success, and returns `firstWorkspaceSlug` for the redirect.
- **Ticket creation** — `POST /api/account/merge` (`src/app/api/account/merge/route.ts`) authenticates via `userFromRequest` (desktop bearer token or web cookie), rejects non-anonymous users, and returns the `/auth/merge?ticket=...&next=...` URL.
- **`/auth/merge` route** (`src/app/auth/merge/route.ts`) — validates the ticket, moves the raw token from the URL into the `sayabot_guest_merge` httpOnly cookie, and routes to the finish page when already signed in as a real account, otherwise to the forced login with `merge=1`.
- **`/auth/merge/finish` page** — requires a real (non-anonymous) session and the cookie ticket; shows "Nothing to move" when the ticket expired. Renders `summarizeGuest()` output (workspace names, computer names) and a form bound to `confirmGuestMergeAction` (`src/lib/actions/guest-merge.ts`), which re-checks session + ticket, completes the merge, deletes the cookie, and redirects to `next` (the desktop flow passes `/auth/desktop` to hand the login back to the app) or the first moved workspace.
- **`/auth/save-account` + `SaveAccountForm`** — the entry UI linked from the sidebar's "Save your account" row (`/auth/save-account?next=/<org>`). The page redirects full accounts straight to their destination. The form POSTs to `/api/account/merge` with `next: "/auth/desktop"` when running inside the Mac app (detected via `"sayabotDesktop" in window`) and opens the returned URL in the **system browser** — Google blocks sign-in inside embedded windows — showing a "Finish in your browser" state with a re-open button; in a plain browser it navigates directly.

The sidebar (`src/components/workspace/sidebar.tsx`) shows a "Save your account" row for `user.isGuest` sessions, linking to `/auth/save-account?next=/<orgSlug>`.

---

## 💻 Desktop Handoff (`/auth/desktop`) & Mobile Handoff (`/auth/mobile`)

Both pages solve the same problem: a native app opened a web sign-in and needs the resulting tokens back. The two implementations are near-identical (`desktop-handoff-client.tsx`, `mobile-handoff-client.tsx` — the only differences are copy and mascot seed `Pip` vs `Juno`):

1. The server component reads the Supabase session server-side and passes `SessionPayload { accessToken, refreshToken, email, userId }` (or `null`) plus `siteUrl` (from `NEXT_PUBLIC_SITE_URL`, falling back to `https://sayabot.sayalabs.in`).
2. The client, on mount, deep-links the app:

```typescript
// apps/web/src/app/auth/desktop/desktop-handoff-client.tsx:35
const targetUri = `sayabot://auth/callback?access_token=...&refresh_token=...&user_id=...&email=...&server_url=...`
window.location.href = targetUri
```

3. If no server session exists it falls back to `supabase.auth.getSession()` in the browser; still nothing → an "unauthenticated" state that links to `/login?force=true&next=/auth/desktop` (mobile: `/auth/mobile`).
4. Status cycles `checking → redirecting → ready` (ready after 1.2 s) and always shows a manual "Open Sayabot (Mac) App" anchor with the same deep link, plus a "continue to Web Workspace" escape link.

---

## 🔑 Password Recovery Pages

- `/forgot-password` renders `ForgotPasswordForm` (`useActionState` over `forgotPasswordAction`): one email field, neutral success message regardless of account existence.
- `/reset-password` is a server component: with a session (the recovery link signed the user in) it renders `ResetPasswordForm` with the account email; without one it shows "This reset link is missing or expired" with a link back to `/forgot-password`. The form posts `password` + `confirmPassword` to `updatePasswordAction`.

## 🧭 Where the gate lives

The middleware (`src/proxy.ts`) marks `/auth/*`, `/login`, `/signup`, `/forgot-password`, `/reset-password` public and bounces signed-in users off `/login`/`/signup` unless `?force|reauth|switch=true`; `safeNextPath` sanitizes every `next` in both middleware and actions. Page-level helpers in `src/lib/auth.ts` (`getCurrentUser`, `requireUser`, `requireOrgAccess`) do the per-page checks — `requireOrgAccess` returns 404 via `notFound()` for non-members rather than redirecting.

---

## Related docs

- [App overview](./app-overview.md) — the middleware that gates these routes
- [Onboarding](./onboarding.md) — where signup lands (`/onboarding`)
- [Model system](./model-system.md) — where OAuth-connected provider keys live after login
- ../../architecture/auth-and-authorization.md — Supabase session and RLS model
- ../../architecture/security-model.md — open-redirect and session-cookie hardening
- ../../database/schema-identity-and-invites.md — `profiles`, `org_members`, `account_merge_tickets`
- Email templates live in `apps/web/src/lib/email/templates/auth.ts`; the merge API route is documented with the other route handlers under `docs/reference/web/api/`.
