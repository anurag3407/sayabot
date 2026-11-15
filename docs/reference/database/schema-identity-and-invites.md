# Identity & Invites Schemas

This reference documents the tenancy roots of Sayabot — `profiles` (users), `orgs` (workspaces), and `org_members` (membership with roles) — plus every table that gets outsiders **into** a workspace or room: room invite links (`room_invites`), the bot "ask to join" flow (`bot_invites`), workspace-level email/link invites (`workspace_invites`), the OAuth client machinery bots use to obtain tokens (`oauth_clients` / `oauth_codes` / `oauth_tokens`), and the desktop guest-account merge tickets (`account_merge_tickets`). Secrets never appear here in plaintext: every credential-shaped column stores only a hash (`code_hash`, `token_hash`, `poll_token_hash`).

Source files: `packages/db/src/schema/identity.ts`, `packages/db/src/schema/invites.ts`, `packages/db/src/schema/enums.ts`, `packages/db/sql/0002_rls.sql`, `packages/db/sql/0009_bot_platform.sql`, `packages/db/sql/0020_bot_invites.sql`, `packages/db/sql/0023_workspace_invites.sql`, `packages/db/sql/0031_guest_account_merge.sql`

---

## Profiles (`profiles`)

Defined at `packages/db/src/schema/identity.ts:13`. One row per human user, kept 1:1 with Supabase `auth.users`: a `SECURITY DEFINER` trigger `handle_new_user()` (`packages/db/sql/0001_functions.sql:32-60`) inserts the row at signup and backfills `display_name`/`avatar_url` from auth metadata (falling back to the email local-part, then `"member"`). There is no `org_id` — a user can belong to many workspaces through `org_members`.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK | Mirrors `auth.users.id`; set by the signup trigger, not generated. |
| `display_name` | `text` | NOT NULL, default `""` | Human-visible name; trigger derives it at signup and preserves user-set values afterwards. |
| `avatar_url` | `text` | nullable | Avatar image URL from auth metadata. |
| `preferences` | `jsonb` | NOT NULL, default `{}` | Typed `{ notifications?: "all" \| "mentions" \| "off"; sound?: boolean; timezone?: string }` (`identity.ts:17-20`). |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Signup time. |

**RLS** (`packages/db/sql/0002_rls.sql:95-105`): `profiles_select` lets a user read their own row plus anyone who `shares_org_with(id)` (co-members of an org); `profiles_update_own` allows updating only the caller's own row.

**Used by**: the web app's auth callback and onboarding flows (`apps/web/src/app/auth/callback/route.ts`, `apps/web/src/app/onboarding/page.tsx`, `apps/web/src/lib/queries.ts`), the desktop heartbeat (`apps/web/src/app/api/desktop/heartbeat/route.ts`), and orchestrator authorization whenever user identity is resolved (`apps/orchestrator/src/authz.ts`).

---

## Workspaces (`orgs`)

Defined at `packages/db/src/schema/identity.ts:24`. The tenant root — one row per workspace. Every tenant table in the package references `orgs.id` with `ON DELETE CASCADE`, so dropping a workspace removes all of its data.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Workspace id used in all URLs (`/[org]/...`). |
| `slug` | `text` | NOT NULL, UNIQUE | URL-safe identifier; uniqueness is enforced at the database level. |
| `name` | `text` | NOT NULL | Display name. |
| `sso_enabled` | `boolean` | NOT NULL, default `false` | Flag reserved for SSO-gated workspaces; no login flow reads it today, so it is inert unless set server-side. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Creation time. |

**RLS** (`packages/db/sql/0002_rls.sql:107-110`): `orgs_select` — readable by `public.is_org_member(id)`; there are no client insert/update policies, workspace creation is server-side.

**Used by**: workspace layout and settings pages (`apps/web/src/app/(workspace)/[org]/layout.tsx`, `.../settings/workspace/page.tsx`), landing/workspace resolution (`apps/web/src/app/page.tsx`), the OAuth consent screen (`apps/web/src/app/oauth/authorize/page.tsx`), and orchestrator authorization (`apps/orchestrator/src/authz.ts`).

---

## Memberships (`org_members`)

Defined at `packages/db/src/schema/identity.ts:32`. Join table between users and workspaces carrying the caller's role. Composite PK `(org_id, user_id)` means one membership row per user per workspace.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `org_id` | `uuid` | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE`, part of PK | The workspace. |
| `user_id` | `uuid` | NOT NULL, FK → `profiles.id`, `ON DELETE CASCADE`, part of PK | The member. |
| `role` | `org_role` enum | NOT NULL, default `"member"` | `owner`, `admin`, or `member` (`packages/db/src/schema/enums.ts:3`). `owner`/`admin` gate admin-only server operations; `owner` additionally gates workspace deletion and billing. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | When the user joined. |

Indexes: composite PK on `(org_id, user_id)` plus `org_members_user_idx` on `(user_id)` (`identity.ts:44`) — the reverse lookup "which workspaces does this user belong to".

**RLS** (`packages/db/sql/0002_rls.sql:112-116`): `org_members_select` — a user sees their own memberships and the membership list of any org they belong to. Writes are server-only (invites/actions run as the service role). This table is also the predicate workhorse: almost every RLS policy in the package resolves access through `org_members` via `is_org_member()`.

**Used by**: orchestrator authorization and push fan-out (`apps/orchestrator/src/authz.ts`, `apps/orchestrator/src/push.ts`), room settings (`apps/web/src/app/(workspace)/[org]/r/[roomId]/settings/page.tsx`), meeting scheduler participant expansion (`apps/orchestrator/src/scheduler/meetings.ts`), local runner context (`apps/orchestrator/src/runner/local.ts`), and the collab server (`apps/orchestrator/src/collab/index.ts`).

---

## Room invites (`room_invites`)

Defined at `packages/db/src/schema/invites.ts:14` (table created in `packages/db/sql/0009_bot_platform.sql`). One-time, expiring join links for **external bots** into a specific room. The link itself carries no secret — `code_hash` stores only a hash of the invite code.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Invite id. |
| `org_id` | `uuid` | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE` | Owning workspace. |
| `room_id` | `uuid` | NOT NULL, FK → `rooms.id`, `ON DELETE CASCADE` | Room the invite admits into. |
| `code_hash` | `text` | NOT NULL, UNIQUE | SHA-style hash of the invite code; raw code lives only in the shareable URL. |
| `client` | `text` | NOT NULL | Which client kind the invite is for (e.g. MCP-connected bot client). |
| `handle_hint` | `text` | nullable | Suggested agent handle for the joining bot. |
| `display_name_hint` | `text` | nullable | Suggested display name. |
| `scopes` | `text[]` | NOT NULL, default `["messages:write", "tasks:write", "votes:write", "profile:write", "canvas:read", "activity:wait"]` | Scapes granted to the joined agent (`invites.ts:28-38`). |
| `created_by` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Inviting human. |
| `expires_at` | `timestamptz` | NOT NULL | Hard expiry; expired links are dead even if unclaimed. |
| `claimed_agent_id` | `uuid` | nullable, FK → `agents.id`, `ON DELETE SET NULL` | Agent that redeemed the link. |
| `claimed_at` | `timestamptz` | nullable | Redemption time. |
| `revoked_at` | `timestamptz` | nullable | Set when a human revokes the link. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Creation time. |

Indexes: composite PK none (surrogate `id` PK); `room_invites_room_expires_idx` on `(room_id, expires_at)` and a redundant-but-handy `room_invites_code_hash_idx` on `(code_hash)` (`invites.ts:46-49`; both indexes also declared in `0009_bot_platform.sql:220-221`).

**RLS** (`packages/db/sql/0009_bot_platform.sql:223-226`): `room_invites_read` — room members can list invites for their room. Redemption happens server-side (service role).

**Used by**: the OAuth authorize flow that renders room invites (`apps/web/src/app/oauth/authorize/page.tsx`) and the MCP invite redemption route (`apps/web/src/app/mcp/r/[code]/route.ts`); `oauth_codes.invite_id` links back here.

---

## OAuth clients (`oauth_clients`)

Defined at `packages/db/src/schema/invites.ts:52` (created `0009_bot_platform.sql:231-239`). Registered OAuth client applications (bots/CLIs) that may start the authorization-code flow. Table created in SQL with a `kind`-less schema; the Drizzle table mirrors it.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Row id. |
| `client_id` | `text` | NOT NULL, UNIQUE | Public OAuth client identifier. |
| `client_name` | `text` | NOT NULL | Human-readable app name shown on the consent screen. |
| `redirect_uris` | `text[]` | NOT NULL | Allow-list of redirect URIs; the token endpoint rejects others. |
| `metadata` | `jsonb` | NOT NULL, default `{}` | Client metadata (logo, description) for dynamic client registration. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Registration time. |

Indexes: `oauth_clients_client_id_idx` on `(client_id)` (`invites.ts:62`).

**RLS**: RLS is enabled and **all access is revoked** from `authenticated`/`anon` (`0009_bot_platform.sql:238-239`) — service-role only. Clients register and read through the server (dynamic registration route `apps/web/src/app/oauth/register/route.ts`).

---

## OAuth authorization codes (`oauth_codes`)

Defined at `packages/db/src/schema/invites.ts:65` (created `0009_bot_platform.sql:242-257`). Short-lived, single-use authorization codes with PKCE. Only the hash of the code is stored.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Row id. |
| `code_hash` | `text` | NOT NULL, UNIQUE | Hash of the issued authorization code. |
| `client_id` | `text` | NOT NULL | The requesting client (references `oauth_clients.client_id` logically, not by FK). |
| `invite_id` | `uuid` | nullable, FK → `room_invites.id`, `ON DELETE CASCADE` | The room invite this login was scoped through. |
| `agent_id` | `uuid` | nullable, FK → `agents.id`, `ON DELETE CASCADE` | The agent identity the code was granted for. |
| `code_challenge` | `text` | NOT NULL | PKCE code challenge (S256) presented at authorize time. |
| `redirect_uri` | `text` | NOT NULL | Exact redirect URI used for this code. |
| `scopes` | `text[]` | NOT NULL | Granted scopes (copied from the invite). |
| `expires_at` | `timestamptz` | NOT NULL | Code expiry (minutes, not days). |
| `used_at` | `timestamptz` | nullable | Set when the code is exchanged; a used/expired code is rejected. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Issue time. |

Indexes: `oauth_codes_code_hash_idx` on `(code_hash)` (`invites.ts:80`).

**RLS**: enabled, revoked from `authenticated`/`anon` (`0009_bot_platform.sql:256-257`) — service-role only.

**Used by**: the token exchange endpoint `apps/web/src/app/oauth/token/route.ts:49,88` (verify code + PKCE, mark used).

---

## OAuth tokens (`oauth_tokens`)

Defined at `packages/db/src/schema/invites.ts:83` (created `0009_bot_platform.sql:260-276`). Issued access/refresh tokens for bots. Only hashes are stored; the SQL layer adds a `check (kind in ('access', 'refresh'))`.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Row id. |
| `kind` | `text` | NOT NULL | `"access"` or `"refresh"` (TS-typed union at `invites.ts:87`; CHECK in SQL). |
| `token_hash` | `text` | NOT NULL, UNIQUE | Hash of the bearer token presented on each request. |
| `client_id` | `text` | NOT NULL | Issuing client. |
| `agent_id` | `uuid` | nullable, FK → `agents.id`, `ON DELETE CASCADE` | The bot identity this token acts as. |
| `room_ids` | `uuid[]` | nullable | Room scope restriction; null/empty = all rooms the agent can reach. |
| `scopes` | `text[]` | NOT NULL | Granted scopes. |
| `expires_at` | `timestamptz` | NOT NULL | Token expiry (short for access, long for refresh). |
| `revoked_at` | `timestamptz` | nullable | Set on logout/revocation. |
| `rotated_from` | `uuid` | nullable | Token row this one replaced (refresh rotation audit chain). |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Issue time. |

Indexes: `oauth_tokens_token_hash_idx` on `(token_hash)` (`invites.ts:98`).

**RLS**: enabled, revoked from `authenticated`/`anon` (`0009_bot_platform.sql:274-275`) — service-role only.

**Used by**: token issuance and refresh rotation in `apps/web/src/app/oauth/token/route.ts:110-215`; bearer authentication of MCP/bot requests in the orchestrator (`apps/orchestrator/src/bot/auth.ts`, `apps/orchestrator/src/runner/cli-mcp.ts`).

---

## Bot invites (`bot_invites`)

Defined at `packages/db/src/schema/invites.ts:108` (created `packages/db/sql/0020_bot_invites.sql`). The "add an agent" link flow: a human creates a link, the bot opens it and **asks to join** (`status: waiting → pending`), a person approves in their Inbox, and only then does the requesting bot — proven by its poll token — receive its connection key exactly once. Per the doc comment (`invites.ts:103-107`), the link holds no credential.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Invite id. |
| `org_id` | `uuid` | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE` | Workspace. |
| `room_id` | `uuid` | NOT NULL, FK → `rooms.id`, `ON DELETE CASCADE` | Room the bot wants to join. |
| `code` | `text` | NOT NULL, UNIQUE | The invite code itself (unlike `room_invites`, stored raw; the link is a capability URL). |
| `name` / `app` | `text` | nullable | Optional expected name / app for the bot. |
| `status` | `text` | NOT NULL, default `"waiting"` | TS-typed `BotInviteStatus` = `waiting \| pending \| approved \| joined \| declined \| revoked` (`invites.ts:101`). |
| `request_name` / `request_app` / `request_about` / `request_user_agent` | `text` | nullable | Self-description the bot submitted when asking to join. |
| `requested_at` | `timestamptz` | nullable | When the ask happened. |
| `poll_token_hash` | `text` | nullable | Hash of the token proving *which* bot made the request; the key is released only to the holder. |
| `agent_id` | `uuid` | nullable, FK → `agents.id`, `ON DELETE SET NULL` | Agent created/joined after approval. |
| `created_by` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Human who generated the link. |
| `decided_by` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Human who approved/declined. |
| `decided_at` / `joined_at` | `timestamptz` | nullable | Decision and join timestamps. |
| `rejected_attempts` | `jsonb` | NOT NULL, default `[]` | Array of `{ at, app?, userAgent? }` for failed join attempts (`invites.ts:133`). |
| `expires_at` | `timestamptz` | NOT NULL | Link expiry. |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL, default `now()` | Timestamps. |

Indexes: `bot_invites_room_idx` on `(room_id, status)` and `bot_invites_org_idx` on `(org_id, status)` (`invites.ts:138`).

**RLS** (`packages/db/sql/0020_bot_invites.sql:42-45`): RLS enabled with **no client policies** — `revoke all ... from anon, authenticated, public` and `grant all ... to service_role`. Every read/write goes through server actions.

**Used by**: `apps/web/src/lib/actions/bot-invites.ts` (create/decide/revoke, e.g. `.from("bot_invites").select("*")` at line 64), the bots settings page (`apps/web/src/app/(workspace)/[org]/settings/bots/page.tsx`), and the bot-facing join route `apps/web/src/app/bot/[code]/join/route.ts`.

---

## Workspace invites (`workspace_invites`)

Defined at `packages/db/src/schema/invites.ts:147` (created `packages/db/sql/0023_workspace_invites.sql`). The three ways into a workspace per the doc comment (`invites.ts:143-146`): a tracked **email invite**, a **single-use link** expiring 24 hours after creation, or a **permanent link** anyone holding it can use.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Invite id. |
| `org_id` | `uuid` | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE` | Workspace being joined. |
| `kind` | `text` | NOT NULL | TS-typed `WorkspaceInviteKind` = `email \| link \| permanent` (`invites.ts:141`). |
| `code` | `text` | nullable, UNIQUE | Link code; null for pure email invites. |
| `email` | `text` | nullable | Target email for `kind = "email"`; tracked until first sign-in. |
| `user_id` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Filled once the invited person signs in. |
| `role` | `text` | NOT NULL, default `"member"` | Role granted on acceptance (free-form text, not the `org_role` enum). |
| `room_ids` | `uuid[]` | NOT NULL, default `[]` | Rooms the invitee is auto-joined into on acceptance. |
| `max_uses` | `integer` | nullable | Use cap (single-use links set `1`); null = unlimited. |
| `use_count` | `integer` | NOT NULL, default `0` | Acceptances so far. |
| `created_by` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Inviter. |
| `expires_at` | `timestamptz` | nullable | Expiry (24h for `link` kind, per the action code). |
| `last_used_at` | `timestamptz` | nullable | Most recent acceptance. |
| `revoked_at` | `timestamptz` | nullable | Set on revocation. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Creation time. |

Indexes: `workspace_invites_org_idx` on `(org_id, kind)` (`invites.ts:168`).

**RLS** (`packages/db/sql/0023_workspace_invites.sql:29-31`): RLS enabled, all access revoked from `anon`/`authenticated`/`public`, `grant all` to `service_role`.

**Used by**: `apps/web/src/lib/actions/workspace-invites.ts` (create/list/redeem/revoke); redemption also upserts `room_reads` for the auto-joined rooms (`workspace-invites.ts:206`).

---

## Account merge tickets (`account_merge_tickets`)

Defined at `packages/db/src/schema/identity.ts:51` (created `packages/db/sql/0031_guest_account_merge.sql`). One-time proof that a **desktop guest** is signing into a real account, so the guest's local data can be merged into the real one. Per the doc comment (`identity.ts:47-50`): service-role only; the raw token lives in an httpOnly cookie and the table stores only its hash.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Ticket id. |
| `token_hash` | `text` | NOT NULL, UNIQUE | Hash of the one-time merge token. |
| `guest_user_id` | `uuid` | NOT NULL, FK → `profiles.id`, `ON DELETE CASCADE` | The guest identity being merged away. |
| `target_user_id` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | The real account taking over; set once known. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Ticket issue time. |
| `expires_at` | `timestamptz` | NOT NULL | Ticket validity window. |
| `used_at` | `timestamptz` | nullable | Set when the merge completed; tickets are single-use. |

Indexes: `account_merge_tickets_guest_idx` on `(guest_user_id)` (`identity.ts:64`).

**RLS** (`packages/db/sql/0031_guest_account_merge.sql:20-21`): `revoke all` from `anon`/`authenticated`/`public`, `grant all` to `service_role`. The actual data move is the `merge_guest_into_user(uuid, uuid)` SQL function, likewise restricted to the service role (`0031_guest_account_merge.sql:127-128`).

**Used by**: `apps/web/src/lib/guest-merge.ts` and the integration test `apps/web/tests/integration/guest-merge.test.ts`.

---

## Discrepancy notes (code vs AGENTS.md)

- AGENTS.md's Rule 3 example shows RLS policies written as `org_id in (select org_id from org_members where user_id = auth.uid())`; the actual package expresses the same intent through helper predicates (`public.is_org_member()`, `public.can_read_room()`, `public.shares_org_with()`) defined in `packages/db/sql/`. The membership table itself is identical.
- AGENTS.md describes roles generically; the actual role model is exactly three enum values (`owner`/`admin`/`member`) on `org_members.role`, plus a free-form `role` text default `"member"` on `workspace_invites` (not enum-constrained at the database level).

---

## Related docs

- [Database reference overview](./overview.md)
- [Agents & templates schemas](./schema-agents-and-templates.md)
- [Rooms, messages & canvas schemas](./schema-rooms-messages-canvas.md)
- [RLS & Realtime deep dive](./rls-and-realtime.md)
- [Migrations catalog](./migrations-catalog.md)
