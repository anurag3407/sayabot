# Email System

The web app sends transactional email — verification codes, magic-link sign-ins, password resets, and a Supabase auth invite when one is emitted — through the Resend API. Delivery lives in one client (`lib/email/client.ts`), themed HTML/text templates render through a shared dark-mode shell, and `lib/email/index.ts` exports the dispatch helpers other modules call. Without `RESEND_API_KEY` nothing is sent: emails are logged and suppressed instead of failing the calling action.

Source files: `apps/web/src/lib/email/client.ts`, `apps/web/src/lib/email/index.ts`, `apps/web/src/lib/email/templates/base.ts`, `apps/web/src/lib/email/templates/auth.ts`, `apps/web/src/lib/email/templates/invites.ts`

---

## 🚚 Delivery client (`email/client.ts`)

- Provider: the official `resend` SDK, instantiated once when `RESEND_API_KEY` is present (`client.ts:6`); otherwise `resend` is `null`.
- Sender: `DEFAULT_FROM` = `RESEND_FROM_EMAIL` or the fallback `"Sayalabs <auth@sayalabs.in>"` (`client.ts:4`).
- `sendEmail(opts)` (`client.ts:23`) — options `{ to: string | string[], subject, html, text?, from?, replyTo? }`:
  - No API key: logs a `[email] RESEND_API_KEY is not set` warning with the subject and recipients, returns `{ ok: false, error: "RESEND_API_KEY not configured" }`.
  - API errors and unexpected throws are logged with the `[email]` prefix and returned as `{ ok: false, error }` — `sendEmail` **never throws**.
  - Success returns `{ ok: true, id }` (the Resend message id).

Workspace and room invitations no longer send mail. `inviteMember` and `inviteToRoom` refuse and tell the caller to share a link. `sendWorkspaceInviteEmail` remains for the Supabase auth hook's `invite` action type only.

---

## 📬 Dispatch helpers (`email/index.ts`)

`index.ts` re-exports `./client`, `./templates/base`, `./templates/auth`, and `./templates/invites`, and adds five one-purpose functions that pick a template and forward to `sendEmail` (`index.ts:20`–113):

| Function | Template | Input |
| :--- | :--- | :--- |
| `sendVerificationEmail({ email, code?, link, name? })` | `renderVerificationTemplate` | 6-digit signup code and/or confirm link |
| `sendMagicLinkEmail({ email, code?, link })` | `renderMagicLinkTemplate` | OTP sign-in code and/or direct link |
| `sendPasswordResetEmail({ email, link })` | `renderPasswordResetTemplate` | reset link |
| `sendWorkspaceInviteEmail({ email, inviterName?, workspaceName, role, joinUrl, isExistingUser? })` | `renderWorkspaceInviteTemplate` | workspace invitation |
| `sendRoomInviteEmail({ email, inviterName?, roomName, joinUrl })` | `renderRoomInviteTemplate` | room invitation |

Each returns the `SendEmailResult` untouched. Callers include the member-invite actions (above) and `POST /api/auth/send-email` (plain-text mention: documented with the other routes in the proxy/files API reference), which issues verification and magic-link mail for the custom auth flows.

---

## 🎨 Base shell (`templates/base.ts`)

`renderEmailShell({ title, previewText?, contentHtml })` (`base.ts:7`) wraps every email in a self-contained HTML document:

- **Dark theme**: `#070907` page background, a centered 540 px card (`#0d110e`, `#1f2821` border, 12 px radius), accent green `#34d399` (`base.ts:28`–33).
- **Header**: "Saya**labs**" wordmark with the green accent and a "PLATFORM" badge (`base.ts:40`–47).
- **Hidden preview text**: the `previewText` renders in an invisible div for inbox preheaders (`base.ts:12`).
- **MSO fallback**: a conditional Outlook comment forces Arial/Helvetica (`base.ts:22`).
- **Footer**: "Sayalabs Studio · Autonomous Multi-Agent Workspace" plus "If you did not initiate this request, you can safely ignore this email." (`base.ts:65`–69).
- All styles are inline — no external CSS or images, so the mail survives strict clients.

---

## 🔐 Auth templates (`templates/auth.ts`)

All three return `{ subject, html, text }`, render through the shell, and include the action link both as a button and as a copy-paste fallback:

- `renderVerificationTemplate({ code?, link, name? })` (`auth.ts:3`) — subject "Verify your Sayalabs account"; with a `code` it shows the 6-digit code in a monospace box (34 px, letter-spaced) plus "Or click the button below to verify automatically"; without, just the confirm button. Preview text announces the code when present. Plain-text variant includes the code and link.
- `renderMagicLinkTemplate({ code?, link })` (`auth.ts:71`) — subject "Your Sayalabs sign-in code"; same code-box layout, button "Sign In Directly", and the note "This link and code will expire shortly."
- `renderPasswordResetTemplate({ link })` (`auth.ts:135`) — subject "Reset your Sayalabs password"; single "Reset Password" button, copy-paste fallback, and the reassurance "If you did not request a password reset, no action is needed."

---

## 🎟️ Invitation templates (`templates/invites.ts`)

- `renderWorkspaceInviteTemplate({ inviterName?, workspaceName, role, joinUrl, isExistingUser? })` (`invites.ts:3`) — subject "`<inviter>` invited you to join `<workspace>` on Sayalabs" (inviter falls back to "A teammate"). A details card shows the workspace name and a role badge (`"Workspace Admin"` when `role === "admin"`, otherwise `"Member"`). The button label depends on `isExistingUser`: existing accounts get "Open Workspace" ("added to … Click below to jump straight to the workspace"), new ones get "Accept Invitation & Join" with the pitch about chat, tools and canvases.
- `renderRoomInviteTemplate({ inviterName?, roomName, joinUrl })` (`invites.ts:80`) — subject "`<inviter>` invited you to #`<room>` on Sayalabs", body "invited you to join the room #\<room\>", button "Open #\<room\>", and a plain direct link.

Both include the raw URL as a last-resort link and an "ignore this email" note in the plain-text version.

---

## ⚙️ Environment variables

| Variable | Role | Default |
| :--- | :--- | :--- |
| `RESEND_API_KEY` | Enables sending; without it all email is suppressed with a warning | — |
| `RESEND_FROM_EMAIL` | Overrides the `From` header | `"Sayalabs <auth@sayalabs.in>"` |

Emails are sent directly from server actions and route handlers (no queue): the custom `/api/auth/send-email` endpoint (verification, magic link, password reset, and a Supabase-emitted auth invite) calls `sendEmail` and relies on the result object instead of exceptions. There is no retry or batching. Product invitations do not send mail.

---

## 📣 How mail gets triggered

| Caller | Dispatch call | Notes |
| :--- | :--- | :--- |
| `inviteMember` / `inviteToRoom` (`lib/actions/orgs.ts`) | none | Both refuse. People join from a shared link after an admin approves. |
| `POST /api/auth/send-email` `invite` | `sendWorkspaceInviteEmail` | Only when Supabase itself emits an auth invite. The product does not call `inviteUserByEmail`. |
| `POST /api/auth/send-email` (Supabase Auth hook) | all three auth helpers | Maps Supabase's `email_action_type`: `signup`/`email_change` → verification (with the 6-digit `token`), `magiclink`/`login` → sign-in code, `recovery` → reset, `invite` → workspace invite rendered for "Sayalabs" as member. |
| Mobile pairing / bot joins | none by design | Those flows exchange codes and MCP URLs in-app; no email is sent. |

The send-email hook builds the action link from `email_data.redirect_to`, else `<NEXT_PUBLIC_SITE_URL>/auth/callback?token_hash=…&type=…`, else `/auth/complete` — so every link lands on a route that can consume Supabase's token.

## 🧾 Template contract

Every renderer returns `{ subject, html, text }`, and every HTML body:

- Is a complete `<!DOCTYPE html>` document from `renderEmailShell` — inline styles only, no external assets, dark palette on `#070907`, accent `#34d399`, content column max-width 540 px.
- Carries a hidden preheader div when `previewText` is given (inbox preview snippets such as "Your verification code is 482913").
- Shows the action as a full-width button plus a copy-paste URL fallback ("If the button above does not work…"), because some clients strip buttons.
- Includes a plaintext `text` part with the same link (and the code, when present) so clients that refuse HTML still work.

The code boxes render the 6-digit value in 34 px monospace with 8 px letter-spacing — sized to be readable and hard to misread. Auth templates close with the "this link and code will expire shortly" / "no action is needed" reassurance lines; invite templates close with the ignore note.

## 🧪 Failure semantics

- `sendEmail` returns `{ ok: false, error: "RESEND_API_KEY not configured" }` when the key is missing and logs `[email] RESEND_API_KEY is not set. Suppressed email to <recipients>: { subject }`.
- API errors log `[email] Resend API error:` and unexpected throws log `[email] Unexpected error delivering email:` — both return the error string instead of throwing.
- Product invitations do not send mail, so a mail outage cannot block a join. A leftover unused email invite can still be removed with `revokeInviteAction`.

---

## 🎨 The shell's palette and structure

`renderEmailShell` is self-contained markup with these fixed values (`templates/base.ts`):

| Element | Value |
| :--- | :--- |
| Page background | `#070907`, full-width single-cell table, 40 px vertical padding |
| Card | max-width 540 px, background `#0d110e`, 1 px `#1f2821` border, 12 px radius, drop shadow |
| Header | "Saya**labs**" wordmark (accent on "labs") + the "PLATFORM" pill (`#16241b` on `#34d399`), 1 px `#19211b` divider |
| Body | 36 px padding, 15 px/1.6 `#d4d4d8` text |
| Footer | `#090d0a` band: "Sayalabs Studio · Autonomous Multi-Agent Workspace" plus the ignore-this-email note |
| Fonts | System stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial`); a `<!--[if mso]>` block forces Arial for Outlook |

Nothing in the shell fetches remote images or stylesheets, so rendering never depends on a network call. The shell is the single place the brand appears — new emails only compose `title`, `previewText` and `contentHtml`.

## 🗂️ Template → subject map

| Renderer | Subject | Button |
| :--- | :--- | :--- |
| `renderVerificationTemplate` | "Verify your Sayalabs account" | "Verify Email Address" |
| `renderMagicLinkTemplate` | "Your Sayalabs sign-in code" | "Sign In Directly" |
| `renderPasswordResetTemplate` | "Reset your Sayalabs password" | "Reset Password" |
| `renderWorkspaceInviteTemplate` | "`<inviter>` invited you to join `<workspace>` on Sayalabs" | "Accept Invitation & Join" (new) / "Open Workspace" (existing) |
| `renderRoomInviteTemplate` | "`<inviter>` invited you to #`<room>` on Sayalabs" | "Open #\<room\>" |

All templates interpolate the action URL into both the button and a plain "Direct link:" fallback line; the invite templates add the workspace/role card, and the room template uses the `#room` convention throughout.

## 🔒 Handling of secrets and addresses

Recipients and subjects may appear in logs (the suppression warning prints them), but bodies never contain credentials: verification codes are short-lived Supabase tokens, invitation links point at join codes that expire or can be revoked, and password-reset links are single-use. Nothing here handles vault secrets or provider keys — those are brokered by the orchestrator (see the secrets broker reference), so a mailbox compromise cannot leak long-lived credentials.
### Sending from a route handler

The only HTTP entry point is the auth hook, and its shape is the pattern to copy (`api/auth/send-email/route.ts:13`): parse the payload, resolve the action link, dispatch one helper, and always end with a JSON ack:

```ts
switch (email_data.email_action_type) {
  case "signup":
  case "email_change":
    await sendVerificationEmail({ email, code: token, link, name: user.user_metadata?.full_name })
    break
  case "magiclink":
  case "login":
    await sendMagicLinkEmail({ email, code: token, link })
    break
  case "recovery":
    await sendPasswordResetEmail({ email, link })
    break
  case "invite":
    await sendWorkspaceInviteEmail({ email, workspaceName: "Sayalabs", role: "member", joinUrl: link, isExistingUser: false })
    break
  default:
    console.warn(`[auth-email-hook] Unhandled action type: ${email_data.email_action_type}`)
}
return NextResponse.json({ ok: true })
```

Processing errors are logged with the `[auth-email-hook]` prefix and returned as `500` so Supabase retries rather than silently dropping the mail.
---

Related docs: [Auth flows](../pages/auth-flows.md), [Onboarding](../pages/onboarding.md), [Settings UI](../pages/settings-ui.md), [Configuration](../../architecture/configuration.md)
