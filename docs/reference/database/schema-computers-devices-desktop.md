# Computers, Devices & Desktop Schemas

This reference documents the Drizzle schemas that track Sayabot's client and compute surface: persistent agent computers (`agent_computers`), workspace computer settings including the Boat and E2B keys and the VPS target (`org_computer_settings`, `cloud_home_copies`), mobile device pairings and push tokens (`device_pairings`, `mobile_push_tokens`), and the desktop app ecosystem (`desktop_hosts`, `remote_sessions`, `local_runner_jobs`, `desktop_secret_jobs`, `desktop_mcp_calls`). Every table is org- or user-scoped and protected by the RLS policies in `packages/db/sql/0002_rls.sql` and later SQL migrations.

Source files: `packages/db/src/schema/computers.ts`, `packages/db/src/schema/computer-settings.ts`, `packages/db/src/schema/devices.ts`, `packages/db/src/schema/desktop.ts`, `packages/db/src/schema/enums.ts` (computer enums)

---

## Agent Computers (`agent_computers`)

Defined at `packages/db/src/schema/computers.ts:13`. One row per persistent sandbox. `agent_id` is the primary key — an agent has exactly one computer. The orchestrator and `computerd` update `status`, container coordinates, and disk usage here; the idle-sweeper index drives sleep/eviction decisions.

| Column              | SQL type                | Constraints / Default                         | Description                                                                                                                              |
| :------------------ | :---------------------- | :-------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_id`          | `uuid`                  | PK, FK → `agents.id`, `ON DELETE CASCADE`     | The owning agent. Primary key, so one computer per agent.                                                                                |
| `org_id`            | `uuid`                  | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE` | Owning workspace (denormalized for org-scoped queries and quotas).                                                                       |
| `profile`           | `computer_profile` enum | NOT NULL, default `"standard"`                | Sandbox image profile: `standard` or `browser` (headless Chromium).                                                                      |
| `status`            | `computer_status` enum  | NOT NULL, default `"none"`                    | Lifecycle state: `none`, `stopped`, `starting`, `running`, `stopping`, `error`, `over_quota` (`packages/db/src/schema/enums.ts:93-101`). |
| `container_id`      | `text`                  | nullable                                      | Backend container/VM identifier (Docker container ID, smolvm machine, E2B sandbox).                                                      |
| `container_ip`      | `text`                  | nullable                                      | Current IP, used by egress to attribute outbound traffic.                                                                                |
| `volume`            | `text`                  | NOT NULL                                      | Persistent volume name backing `/home/bot` (Docker volume, VM disk, or E2B snapshot ref).                                                |
| `proxy_secret_hash` | `text`                  | nullable                                      | Hash of the per-agent egress proxy credential; the credential itself never leaves computerd.                                             |
| `cpu_millis`        | `integer`               | NOT NULL, default `1000`                      | CPU allocation in milliseconds (1 vCPU default).                                                                                         |
| `mem_mb`            | `integer`               | NOT NULL, default `1024`                      | Memory allocation in MB.                                                                                                                 |
| `disk_mb`           | `integer`               | NOT NULL, default `5120`                      | Disk quota in MB (5 GB default).                                                                                                         |
| `disk_used_mb`      | `integer`               | NOT NULL, default `0`                         | Current usage, refreshed by the storage summary job.                                                                                     |
| `last_active_at`    | `timestamptz`           | nullable                                      | Last tool call against the computer; drives idle sleep.                                                                                  |
| `started_at`        | `timestamptz`           | nullable                                      | When the current run started.                                                                                                            |
| `created_at`        | `timestamptz`           | NOT NULL, default `now()`                     | Row creation time.                                                                                                                       |
| `error`             | `text`                  | nullable                                      | Last provisioning/runtime error, if any.                                                                                                 |

Indexes (`packages/db/src/schema/computers.ts:37-40`):

- `agent_computers_org_status_idx` on `(org_id, status)` — org dashboards and quota checks.
- `agent_computers_idle_sweeper_idx` on `(status, last_active_at)` — the idle sweeper finds running computers eligible for sleep/eviction.

---

## Workspace Computer Settings (`org_computer_settings`)

Defined at `packages/db/src/schema/computer-settings.ts:8`. One row per workspace: the Boat key and the E2B key (each sealed with `MESH_KEK`) and an optional VPS that can host this workspace's bots, reached by an SSH config alias or by host, user, port and a sealed private key. Sayabot never stops the VPS itself. Each Save in Settings → AI providers upserts only one provider's columns, so the others are left as they were.

| Column                                              | SQL type      | Constraints / Default                   | Description                                                                                                                              |
| :-------------------------------------------------- | :------------ | :-------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `org_id`                                            | `uuid`        | PK, FK → `orgs.id`, `ON DELETE CASCADE` | The workspace.                                                                                                                           |
| `boat_ciphertext`                                   | `text`        | nullable                                | AES-256-GCM ciphertext of the Boat key.                                                                                                  |
| `boat_iv`                                           | `text`        | nullable                                | Base64 IV for the Boat key.                                                                                                              |
| `boat_tag`                                          | `text`        | nullable                                | Base64 GCM auth tag for the Boat key.                                                                                                    |
| `boat_last4`                                        | `text`        | nullable                                | Last four characters for UI display.                                                                                                     |
| `e2b_ciphertext` / `e2b_iv` / `e2b_tag`             | `text`        | nullable                                | AES-256-GCM envelope of the E2B API key (migration 0039).                                                                                |
| `e2b_last4`                                         | `text`        | nullable                                | Last four characters of the E2B key for the UI.                                                                                          |
| `vps_ssh_alias`                                     | `text`        | nullable                                | SSH config alias of the workspace VPS, on the orchestrator machine. Used when no `vps_host` is set.                                      |
| `vps_host`                                          | `text`        | nullable                                | Direct SSH host (name, IP or Tailscale name). Wins over the alias.                                                                       |
| `vps_user`                                          | `text`        | nullable                                | SSH login for `vps_host` (orchestrator falls back to `root`).                                                                            |
| `vps_port`                                          | `integer`     | nullable                                | SSH port for `vps_host` (falls back to 22).                                                                                              |
| `vps_key_ciphertext` / `vps_key_iv` / `vps_key_tag` | `text`        | nullable                                | AES-256-GCM envelope of the SSH private key for `vps_host`. Opened only for one ssh call, written to a 0600 temp file and deleted after. |
| `vps_start_automatically`                           | `boolean`     | NOT NULL, default `false`               | When true, `auto` placement may create this bot's container on the VPS. Off until an admin enables it.                                   |
| `updated_at`                                        | `timestamptz` | NOT NULL, default `now()`               | Last update time.                                                                                                                        |

Per the doc comment at `packages/db/src/schema/computer-settings.ts:4-7`, a Cloud plan's relay token is never stored here — the person's own key wins at request time.

---

## Cloud Home Copies (`cloud_home_copies`)

Defined at `packages/db/src/schema/computer-settings.ts:24`. While a Cloud plan is active, the user's Mac-local bot data (bots, chats, routines, keys) is snapshotted once into `snapshot` so it can be restored later.

| Column        | SQL type      | Constraints / Default                          | Description                                           |
| :------------ | :------------ | :--------------------------------------------- | :---------------------------------------------------- |
| `user_id`     | `uuid`        | PK, FK → `profiles.id`, `ON DELETE CASCADE`    | The user whose home was copied. One row per user.     |
| `org_id`      | `uuid`        | nullable, FK → `orgs.id`, `ON DELETE SET NULL` | Workspace the copy belongs to, if any.                |
| `snapshot`    | `jsonb`       | NOT NULL, typed `Record<string, unknown>`      | The captured home data blob.                          |
| `copied_at`   | `timestamptz` | NOT NULL, default `now()`                      | When the snapshot was taken.                          |
| `restored_at` | `timestamptz` | nullable                                       | Set once the snapshot has been restored to a machine. |

---

## Mobile Device Pairings (`device_pairings`)

Defined at `packages/db/src/schema/devices.ts:11`. Phones sign in from a computer using a one-time code. A row starts in `waiting`; the phone trades the code for a sign-in and becomes `paired`. Revocation flips the row to `revoked`, and the phone signs itself out the next time it opens or wakes.

| Column              | SQL type                             | Constraints / Default                             | Description                                                               |
| :------------------ | :----------------------------------- | :------------------------------------------------ | :------------------------------------------------------------------------ |
| `id`                | `uuid`                               | PK, `gen_random_uuid()` default                   | Pairing identifier.                                                       |
| `user_id`           | `uuid`                               | NOT NULL, FK → `profiles.id`, `ON DELETE CASCADE` | User initiating the pairing.                                              |
| `org_id`            | `uuid`                               | nullable, FK → `orgs.id`, `ON DELETE CASCADE`     | Workspace context chosen at pairing time.                                 |
| `code_hash`         | `text`                               | NOT NULL, UNIQUE                                  | Hash of the one-time pairing code (raw code is never stored).             |
| `status`            | `text` (typed `DevicePairingStatus`) | NOT NULL, default `"waiting"`                     | `waiting` → `paired` → `revoked` (`packages/db/src/schema/devices.ts:4`). |
| `device_name`       | `text`                               | nullable                                          | Human-readable device name reported by the phone.                         |
| `platform`          | `text`                               | nullable                                          | e.g. `ios` / `android`.                                                   |
| `device_token_hash` | `text`                               | nullable                                          | Hash of the device's long-lived sign-in token.                            |
| `paired_at`         | `timestamptz`                        | nullable                                          | When the code was redeemed.                                               |
| `last_seen_at`      | `timestamptz`                        | nullable                                          | Last check-in from the phone.                                             |
| `revoked_at`        | `timestamptz`                        | nullable                                          | When the pairing was revoked.                                             |
| `expires_at`        | `timestamptz`                        | NOT NULL                                          | Expiry for the pairing attempt/token.                                     |
| `created_at`        | `timestamptz`                        | NOT NULL, default `now()`                         | Row creation time.                                                        |

Index: `device_pairings_user_idx` on `(user_id, status)` (`packages/db/src/schema/devices.ts:30`).

---

## Mobile Push Tokens (`mobile_push_tokens`)

Defined at `packages/db/src/schema/devices.ts:34`. Expo push tokens for the phone app, used for push alerts that carry Answer / Allow action buttons (tool approvals, ask-responses).

| Column         | SQL type      | Constraints / Default                             | Description                                 |
| :------------- | :------------ | :------------------------------------------------ | :------------------------------------------ |
| `id`           | `uuid`        | PK, `gen_random_uuid()` default                   | Row identifier.                             |
| `user_id`      | `uuid`        | NOT NULL, FK → `profiles.id`, `ON DELETE CASCADE` | Token owner.                                |
| `token`        | `text`        | NOT NULL, UNIQUE                                  | The Expo push token.                        |
| `platform`     | `text`        | nullable                                          | e.g. `ios` / `android`.                     |
| `created_at`   | `timestamptz` | NOT NULL, default `now()`                         | Registration time.                          |
| `last_seen_at` | `timestamptz` | NOT NULL, default `now()`                         | Last confirmation the token is still valid. |

Index: `mobile_push_tokens_user_idx` on `(user_id)` (`packages/db/src/schema/devices.ts:46`).

---

## Desktop Hosts (`desktop_hosts`)

Defined at `packages/db/src/schema/desktop.ts:24`. A computer running the Sayabot desktop app. It signs in once and keeps its own token (`token_hash`), so remote desktop and the local runner keep working after the person's login session expires.

| Column         | SQL type      | Constraints / Default                                          | Description                                                      |
| :------------- | :------------ | :------------------------------------------------------------- | :--------------------------------------------------------------- |
| `id`           | `uuid`        | PK, `gen_random_uuid()` default                                | Host identifier.                                                 |
| `user_id`      | `uuid`        | NOT NULL, FK → `profiles.id`, `ON DELETE CASCADE`              | Owner of the computer.                                           |
| `org_id`       | `uuid`        | nullable, FK → `orgs.id`, `ON DELETE SET NULL`                 | Workspace the host is attached to, if any.                       |
| `name`         | `text`        | NOT NULL                                                       | Display name of the computer.                                    |
| `platform`     | `text`        | NOT NULL                                                       | OS platform (e.g. `darwin`, `win32`, `linux`).                   |
| `app_version`  | `text`        | nullable                                                       | Desktop app version.                                             |
| `token_hash`   | `text`        | NOT NULL                                                       | Hash of the host's persistent auth token.                        |
| `permissions`  | `jsonb`       | NOT NULL, default `{}`, typed `Record<string, string>`         | Granted permission flags.                                        |
| `local_agents` | `jsonb`       | NOT NULL, default `[]`, typed `Array<Record<string, unknown>>` | Apps discovered on the machine (Claude Code, Codex, …).          |
| `settings`     | `jsonb`       | NOT NULL, default `{}`, typed `DesktopHostSettings`            | Control/runner settings (see below).                             |
| `storage`      | `jsonb`       | NOT NULL, default `{}`                                         | What Sayabot uses on that computer, measured by the desktop app. |
| `last_seen_at` | `timestamptz` | nullable                                                       | Last heartbeat from the desktop app.                             |
| `revoked_at`   | `timestamptz` | nullable                                                       | Set when the host is revoked.                                    |
| `created_at`   | `timestamptz` | NOT NULL, default `now()`                                      | Row creation time.                                               |

Index: `desktop_hosts_user_idx` on `(user_id)` (`packages/db/src/schema/desktop.ts:45`).

The `DesktopHostSettings` shape (`packages/db/src/schema/desktop.ts:5-18`):

- `whoCanControl`: `"only_me" | "admins" | "members"` — who may start a remote session.
- `askOnComputer`: boolean — each remote session waits for a person at the computer to allow it.
- `runnerEnabled`: boolean — let this computer run agents on the apps signed in here.
- `localDefault`: `{ app: string } | false` — the owner's default local app for running their agents; `false` records an explicit opt-out, and _unset_ means Sayabot for Mac may turn it on once it finds a signed-in app.

---

## Remote Sessions (`remote_sessions`)

Defined at `packages/db/src/schema/desktop.ts:49`. One remote-desktop connection; the WebRTC offer/answer is exchanged through the server, media flows peer-to-peer.

| Column           | SQL type      | Constraints / Default                                  | Description                                    |
| :--------------- | :------------ | :----------------------------------------------------- | :--------------------------------------------- |
| `id`             | `uuid`        | PK, `gen_random_uuid()` default                        | Session identifier.                            |
| `host_id`        | `uuid`        | NOT NULL, FK → `desktop_hosts.id`, `ON DELETE CASCADE` | The computer being viewed.                     |
| `viewer_user_id` | `uuid`        | NOT NULL, FK → `profiles.id`, `ON DELETE CASCADE`      | User viewing the screen.                       |
| `status`         | `text`        | NOT NULL, default `"requested"`                        | Lifecycle state (`requested` → … → ended).     |
| `control`        | `boolean`     | NOT NULL, default `false`                              | Whether the viewer has keyboard/mouse control. |
| `offer`          | `text`        | nullable                                               | WebRTC SDP offer from the viewer.              |
| `answer`         | `text`        | nullable                                               | WebRTC SDP answer from the host.               |
| `error`          | `text`        | nullable                                               | Negotiation error, if any.                     |
| `created_at`     | `timestamptz` | NOT NULL, default `now()`                              | Session start.                                 |
| `updated_at`     | `timestamptz` | NOT NULL, default `now()`                              | Last update.                                   |
| `ended_at`       | `timestamptz` | nullable                                               | Session end.                                   |

Index: `remote_sessions_host_idx` on `(host_id, status)` (`packages/db/src/schema/desktop.ts:68`).

---

## Local Runner Jobs (`local_runner_jobs`)

Defined at `packages/db/src/schema/desktop.ts:72`. Agents that run on a person's computer through a signed-in app (Claude Code, Codex, …). The orchestrator queues a job with the prompt; the Mac claims it, runs it in the local app, and streams tool cards back to the room attached to `run_id`.

| Column             | SQL type      | Constraints / Default                                  | Description                                                                               |
| :----------------- | :------------ | :----------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| `id`               | `uuid`        | PK, `gen_random_uuid()` default                        | Job identifier.                                                                           |
| `host_id`          | `uuid`        | NOT NULL, FK → `desktop_hosts.id`, `ON DELETE CASCADE` | The Mac that will run the job.                                                            |
| `agent_id`         | `uuid`        | NOT NULL, FK → `agents.id`, `ON DELETE CASCADE`        | Sayabot agent the job answers for.                                                        |
| `room_id`          | `uuid`        | NOT NULL                                               | Room to post results into (no FK constraint).                                             |
| `message_id`       | `uuid`        | NOT NULL                                               | Triggering message (no FK constraint).                                                    |
| `reply_message_id` | `uuid`        | nullable                                               | Message created for the reply.                                                            |
| `run_id`           | `uuid`        | nullable                                               | The `agent_runs` row this job answers for; the Mac's tool cards attach to it.             |
| `app`              | `text`        | nullable                                               | Which app runs it (`claude-code`, `codex`, …); chosen per agent, or the Mac's default.    |
| `model`            | `text`        | nullable                                               | Model inside that app; null keeps the app's default.                                      |
| `effort`           | `text`        | nullable                                               | Thinking effort passed to the app; null keeps its default.                                |
| `status`           | `text`        | NOT NULL, default `"queued"`                           | Job lifecycle (`queued` → claimed → finished).                                            |
| `prompt`           | `text`        | NOT NULL                                               | The prompt sent to the local app.                                                         |
| `mcp_token_enc`    | `text`        | nullable                                               | One-run MCP token for Sayabot's room tools, sealed with `MESH_KEK`; cleared once claimed. |
| `mcp_token_id`     | `uuid`        | nullable                                               | The `oauth_tokens` row behind it, revoked when the job ends.                              |
| `output`           | `text`        | nullable                                               | Captured output from the app.                                                             |
| `error`            | `text`        | nullable                                               | Job error, if any.                                                                        |
| `claimed_at`       | `timestamptz` | nullable                                               | When the Mac claimed the job.                                                             |
| `finished_at`      | `timestamptz` | nullable                                               | Completion time.                                                                          |
| `created_at`       | `timestamptz` | NOT NULL, default `now()`                              | Queue time.                                                                               |

Index: `local_runner_jobs_host_idx` on `(host_id, status)` (`packages/db/src/schema/desktop.ts:105`).

---

## Desktop Secret Jobs (`desktop_secret_jobs`)

Defined at `packages/db/src/schema/desktop.ts:112`. A password-manager read that has to run on the person's computer (`op` for 1Password, `bw` for Bitwarden, `pass-cli`). The result is sealed into `result_enc`; the connector token is never stored on the row — the claim route reads it.

| Column         | SQL type      | Constraints / Default                                  | Description                                    |
| :------------- | :------------ | :----------------------------------------------------- | :--------------------------------------------- |
| `id`           | `uuid`        | PK, `gen_random_uuid()` default                        | Job identifier.                                |
| `host_id`      | `uuid`        | NOT NULL, FK → `desktop_hosts.id`, `ON DELETE CASCADE` | Mac to run the read on.                        |
| `org_id`       | `uuid`        | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE`          | Owning workspace.                              |
| `connector_id` | `uuid`        | NOT NULL                                               | Connector this read serves (no FK constraint). |
| `source`       | `text`        | NOT NULL                                               | Connector source type.                         |
| `action`       | `text`        | NOT NULL                                               | Requested password-manager action.             |
| `query`        | `text`        | NOT NULL                                               | Search query for the manager.                  |
| `vault`        | `text`        | nullable                                               | Specific vault/collection to search.           |
| `status`       | `text`        | NOT NULL, default `"queued"`                           | Job lifecycle.                                 |
| `result_enc`   | `text`        | nullable                                               | Sealed result envelope.                        |
| `error`        | `text`        | nullable                                               | Job error, if any.                             |
| `created_at`   | `timestamptz` | NOT NULL, default `now()`                              | Queue time.                                    |
| `finished_at`  | `timestamptz` | nullable                                               | Completion time.                               |

Index: `desktop_secret_jobs_host_idx` on `(host_id, status)` (`packages/db/src/schema/desktop.ts:133`).

---

## Desktop MCP Calls (`desktop_mcp_calls`)

Defined at `packages/db/src/schema/desktop.ts:137`. One MCP tool call destined for a local app that only runs on the person's computer (Obsidian, Paper, Apple apps). The desktop app claims the call, executes the method against the local server, and stores the JSON result.

| Column        | SQL type      | Constraints / Default                                  | Description                               |
| :------------ | :------------ | :----------------------------------------------------- | :---------------------------------------- |
| `id`          | `uuid`        | PK, `gen_random_uuid()` default                        | Call identifier.                          |
| `host_id`     | `uuid`        | NOT NULL, FK → `desktop_hosts.id`, `ON DELETE CASCADE` | Mac to run the call on.                   |
| `org_id`      | `uuid`        | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE`          | Owning workspace.                         |
| `server_id`   | `uuid`        | NOT NULL                                               | The `mcp_servers` row (no FK constraint). |
| `app_id`      | `text`        | NOT NULL                                               | Local app identifier.                     |
| `method`      | `text`        | NOT NULL                                               | MCP method to invoke.                     |
| `params`      | `jsonb`       | NOT NULL, default `{}`                                 | Call parameters.                          |
| `status`      | `text`        | NOT NULL, default `"queued"`                           | Call lifecycle.                           |
| `result`      | `jsonb`       | nullable                                               | Result payload.                           |
| `error`       | `text`        | nullable                                               | Call error, if any.                       |
| `created_at`  | `timestamptz` | NOT NULL, default `now()`                              | Queue time.                               |
| `finished_at` | `timestamptz` | nullable                                               | Completion time.                          |

Index: `desktop_mcp_calls_host_idx` on `(host_id, status)` (`packages/db/src/schema/desktop.ts:157`).

---

## Lifecycle notes

- Computers: `agent_computers.status` transitions are driven by `computerd`; `over_quota` is set when a provision request would exceed `org_quotas.max_computers` / `max_running_computers` / `max_disk_mb_total`.
- Placement: `org_computer_settings.vps_start_automatically` gates whether a bot set to Auto may start its container on the workspace VPS. A bot pinned to `vps` starts its own container without it.
- Desktop claim routes: `local_runner_jobs`, `desktop_secret_jobs`, and `desktop_mcp_calls` all follow the same queue pattern — orchestrator inserts with `status = "queued"`, the desktop app polls by `(host_id, status)`, claims, then writes results and `finished_at`.

---

## Related docs

- [Database reference overview](./overview.md)
- [Connectors & Vault schemas](./schema-connectors-and-vault.md)
- [Engine, Tools & Ops schemas](./schema-engine-tools-ops.md)
- [Billing schema](./schema-billing.md)
- [Migrations catalog](./migrations-catalog.md)
- [RLS & Realtime deep dive](./rls-and-realtime.md)
- [Seed script](./seed.md)
