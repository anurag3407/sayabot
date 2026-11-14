# Desktop Guest Mode (open the Mac app without signing in)

The Mac app opens straight into a workspace on first launch, with no sign-in screen. Behind the
scenes it creates a **Supabase anonymous user**. That's a real user id, so bots, chats, computers
and RLS all work exactly like a normal account. Later the person can sign in to **any** account
(a brand-new Gmail or one that already has Sayabot data) and everything from the guest session
**moves into that account**.

## Flow

```
First launch (no session, not signed out before)
  └─ controller page → main: auth:start-guest
       ├─ GET  {server}/api/desktop/guest           → { enabled, supabaseUrl, anonKey }
       └─ POST {supabaseUrl}/auth/v1/signup  {}      → anonymous session (from this Mac's IP)
            └─ session saved (isGuest: true) → host registers → /auth/complete → /onboarding

Saving (guest banner → /auth/save-account, or app menu → Sign In to Existing Account…)
  ├─ POST /api/account/merge  (guest's cookie or desktop bearer)  → one-time ticket, 30 min
  │     only sha256(ticket) is stored in account_merge_tickets
  ├─ GET  /auth/merge?ticket=…  → ticket moved into httpOnly cookie, out of the URL
  │     → /login?force=true&merge=1   (Google, GitHub, email, password, sign-up: any of them)
  ├─ /auth/merge/finish  → shows the guest's workspaces + computers, asks to confirm
  └─ confirm → merge_guest_into_user(guest, account)  (sql/0031, one transaction)
        → guest auth user deleted → redirect: /auth/desktop (desktop) or the moved workspace

Desktop: /auth/desktop hands the new login back via sayabot://auth/callback. This Mac stays
registered (its desktop_hosts row moved with the merge).
```

From the Mac app the browser part happens in the **system browser**, because Google blocks
sign-in inside embedded windows.

### What moves

`merge_guest_into_user` walks the catalog for every single-column foreign key to `profiles(id)`
or `auth.users(id)` in `public`, so tables added later are covered automatically. In practice that
means org memberships (the guest's workspace, as owner), room memberships, agents, rooms, tasks,
vault entries, connectors, desktop hosts, push tokens, and so on. Columns that hold a user id
without a foreign key are listed explicitly: `messages.sender_id`, `canvas_versions.author_id`,
`task_events.actor_id`, `task_comments.author_id`, `audit_logs.actor_id`. **If you add another
such column, add it to the function.**

- The guest's workspace is **added** to the account (it shows in the workspace switcher). It is
  not blended into the account's existing workspace.
- Clashes: if the account already has an equivalent row (same room membership, one-per-user fact),
  the account's row wins and the guest's duplicate is dropped. The function returns counts of
  `moved` and `dropped` rows, which are logged.
- Any other error rolls everything back, releases the ticket, and keeps the guest so the person
  can retry.

### Why there's a confirm step

Without it, someone could send a merge link for *their* guest and get it added to another
person's account (including their desktop host, which would then run that person's jobs). The
confirm page names the workspaces and computers being moved. The ticket is single-use, expires in
30 minutes, and only its hash is stored.

- Explicit **Sign Out** sets `guestDeclined` in `sayabot-config.json`. The next launch shows the
  sign-in card (with a *Continue without an account* button) instead of making a new guest.
- **Sayabot → Sign In to Existing Account…** in the app menu runs the same merge flow for a guest
  (and a plain sign-in for everyone else).
- The sign-up request goes from the Mac directly to Supabase, so Supabase's per-IP rate limit for
  anonymous sign-ins applies per person, not to our server.

## Required Supabase settings

Dashboard → **Authentication → Sign In / Providers**:

1. **Allow anonymous sign-ins**: ON. Without it, the app falls back to the sign-in card and logs
   `Anonymous sign-ins are disabled`.

Dashboard → **Authentication → Rate Limits**: "Anonymous sign-ins" defaults to 30/hour per IP.

Recommended: turn on **CAPTCHA** (Turnstile/hCaptcha) in Auth settings if guest accounts get abused.
The desktop sign-up would then need a captcha token, which isn't wired up yet.

## Database

Apply the migration (it adds `account_merge_tickets` and `merge_guest_into_user`):

```bash
pnpm db:migrate
```

## Server switch

| Env (web) | Default | Effect |
| --- | --- | --- |
| `DESKTOP_GUEST_MODE` | on | `false` / `0` / `off` disables guest mode; the app shows the sign-in card |

## Cleaning up abandoned guests

Guests that never save their account pile up in `auth.users`. Supabase marks them with
`is_anonymous = true`. A periodic cleanup (not automated yet):

```sql
-- Review first! Deleting a user cascades to their org memberships and data.
select id, created_at, last_sign_in_at from auth.users
where is_anonymous and last_sign_in_at < now() - interval '30 days';
```

## Files

- [`packages/db/sql/0031_guest_account_merge.sql`](../packages/db/sql/0031_guest_account_merge.sql): ticket table + merge function
- [`apps/web/src/lib/guest-merge.ts`](../apps/web/src/lib/guest-merge.ts): tickets, summary, `completeGuestMerge`
- [`apps/web/src/app/api/account/merge/route.ts`](../apps/web/src/app/api/account/merge/route.ts), [`app/auth/merge/route.ts`](../apps/web/src/app/auth/merge/route.ts), [`app/auth/merge/finish/page.tsx`](../apps/web/src/app/auth/merge/finish/page.tsx): merge flow

- [`apps/web/src/app/api/desktop/guest/route.ts`](../apps/web/src/app/api/desktop/guest/route.ts): guest config
- [`apps/web/src/app/auth/save-account/page.tsx`](../apps/web/src/app/auth/save-account/page.tsx) + [`save-account-form.tsx`](../apps/web/src/components/auth/save-account-form.tsx): "Save account" entry
- [`apps/web/src/components/auth/guest-banner.tsx`](../apps/web/src/components/auth/guest-banner.tsx): workspace banner
- [`apps/desktop/src/main.ts`](../apps/desktop/src/main.ts): `createGuestSession`, `auth:start-guest`
- [`apps/desktop/src/renderer/index.html`](../apps/desktop/src/renderer/index.html): auto-start + fallback card
