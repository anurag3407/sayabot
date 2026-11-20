# Sayabot Desktop — Vault CLI Runner

Some password lookups must run where a password manager's CLI is already signed in on the person's Mac. `VaultRunner` fulfills those: it claims queued secret jobs from the Sayabot server, maps the job's `source` to a **fixed** command (`op` for 1Password, `bw` for Bitwarden, `pass-cli` for Proton Pass), runs it read-only, and returns the JSON result. A job can never name its own program — the command is chosen here, mirroring `apps/orchestrator/src/connectors/passwords.ts` `passwordArgv`.

Source files: `apps/desktop/src/vault-cli.ts`

---

## 📥 Job Lifecycle (`maybeRun`, `src/vault-cli.ts:92`)

After each heartbeat, `main.ts` calls `vaults.maybeRun(reply.secretJobs)` when the heartbeat reports queued jobs. Like the runner and MCP host, it is one-job-at-a-time (`busy` guard) and claims with `POST /api/desktop/secrets/claim`. A job is:

| Field    | Meaning                                                                                                                    |
| :------- | :------------------------------------------------------------------------------------------------------------------------- |
| `id`     | Job id; echoed in the result POST `/api/desktop/secrets/<id>`                                                              |
| `source` | Which password manager: `"onepassword"`, `"bitwarden"`, or `"protonpass"`                                                  |
| `action` | `"search"` (list/find) or `"read"` (fetch one item)                                                                        |
| `query`  | Item name/search text; empty means "list everything" for 1Password only                                                    |
| `vault`  | Optional 1Password vault name (Bitwarden and Proton Pass ignore it)                                                        |
| `token`  | Optional `OP_SERVICE_ACCOUNT_TOKEN` / `BW_SESSION` value; the literal `"desktop"` means "use whatever the CLI already has" |

One beat of the flow:

```
heartbeat reply.secretJobs > 0
├─ POST /api/desktop/secrets/claim        → { job } or null
├─ vaultCommand(job.source, job.action, job.query, job.vault)
│     ├─ null → POST /secrets/<id> { error: "That lookup isn't allowed." }
├─ findBinary(cmd.bin)   → missing → POST { error: "<bin> isn't installed on this computer." }
├─ spawn(bin, args, { env: PATH+HOME+token })   (20 s timeout, no shell)
└─ POST /secrets/<id> { result: <parsed stdout> }  |  { error: <stderr/exit> }
```

The result goes back over the host's authenticated transport and the server hands it to the agent that asked (see [api-desktop.md](../web/api/api-desktop.md)). The claim/result pairing mirrors the orchestrator's own password-connector argv builder (`apps/orchestrator/src/connectors/passwords.ts` `passwordArgv` — noted in the file header), so the same `source`/`action` vocabulary produces the same CLI invocations whether the lookup runs on a server with its own credentials or here on the owner's Mac, where the managers are signed in as the person.

### Claim cadence

`maybeRun` is driven from `main.ts`'s `onHeartbeat` hook (`src/main.ts:200`) — `void vaults?.maybeRun(reply.secretJobs ?? 0)`. Since heartbeats arrive every 2.5 s, queued jobs drain quickly, but never concurrently: while one lookup runs (up to its 20-second timeout), subsequent heartbeats find `busy` and return immediately, and the job count in the next reply governs whether another claim is attempted. `runner.stop()` does not stop the vault — a password lookup is short-lived and read-only — but `host.stop()`/`forget()` naturally cut off new claims by invalidating the transport (`post` returns `null` without credentials).

### Error message catalogue

| Condition                                                              | Message posted to `/api/desktop/secrets/<id>`                |
| :--------------------------------------------------------------------- | :----------------------------------------------------------- |
| Unknown `source`, or `action` not `search`/`read`                      | "That lookup isn't allowed."                                 |
| Empty query where required, over-length, leading `-`, or control chars | "That lookup isn't allowed."                                 |
| Binary not found in any PATH dir                                       | "`op` / `bw` / `pass-cli` isn't installed on this computer." |
| Spawn failed at exec time                                              | same message (resolved from the spawn `error` handler)       |
| Non-zero exit                                                          | trimmed stderr (≤ 300 chars), else "`<bin>` exited N"        |
| Success with unparseable output                                        | `{ result: { text: <≤ 4,000 chars> } }`                      |

## 🧾 What a Job Looks Like in Practice

| Agent asks                                  | Job on the wire                                      | Command actually run                                  |
| :------------------------------------------ | :--------------------------------------------------- | :---------------------------------------------------- |
| "Find my production AWS login in 1Password" | `onepassword` / `search` / `query: "production aws"` | `op item list --format json`                          |
| "Read that item"                            | `onepassword` / `read` / `query: "Production AWS"`   | `op item get "Production AWS" --format json --reveal` |
| "Search Bitwarden for db creds"             | `bitwarden` / `search` / `query: "db creds"`         | `bw list items --search "db creds"`                   |
| "Get the GitHub token from Bitwarden"       | `bitwarden` / `read` / `query: "GitHub token"`       | `bw get item "GitHub token"`                          |
| "List my Proton Pass items"                 | `protonpass` / `search` / `query: ""`                | refused (empty search is 1Password-only)              |
| "Run `rm` through the vault"                | any / non-search-read action                         | refused ("That lookup isn't allowed.")                |

The result payload is whatever the manager printed, parsed as JSON where possible:

```jsonc
// ok, JSON output (op/bw):  { result: [ { id, title, ... }, ... ] }
// ok, plain text output:    { result: { text: "first 4000 chars of stdout" } }
// any failure:              { error: "bw exited 1" | "op isn't installed on this computer." | ... }
```

## 🧭 Command Mapping (`vaultCommand`, `src/vault-cli.ts:31`)

| Source        | `action: "search"`                                                                                        | `action: "read"`                                           |
| :------------ | :-------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------- |
| `onepassword` | `op item list --format json [--vault <v>]` — also returned for an **empty query** search (list the vault) | `op item get <query> --format json --reveal [--vault <v>]` |
| `bitwarden`   | `bw list items --search <query>`                                                                          | `bw get item <query>`                                      |
| `protonpass`  | `pass-cli item list`                                                                                      | `pass-cli item view <query>`                               |

Tokens map one-to-one per source:

| Source        | Token env var              | Notes                                                                         |
| :------------ | :------------------------- | :---------------------------------------------------------------------------- |
| `onepassword` | `OP_SERVICE_ACCOUNT_TOKEN` | set only when `job.token` is a real token, never for the `"desktop"` sentinel |
| `bitwarden`   | `BW_SESSION`               | an unlocked session key; absent means `bw` uses whatever it already has       |
| `protonpass`  | none                       | `pass-cli` keeps its own sign-in; a job token is ignored                      |

Only `search` and `read` exist — any other action returns `null`, which the job runner reports as "That lookup isn't allowed." A search without a query is only meaningful for 1Password (its `item list`); for the others an empty query is refused.

### Input sanitization (`clean`, `src/vault-cli.ts:25`)

Every query and vault name passes through `clean(value, max)`, which returns `null` (refusing the job) when the value: is empty after trimming, exceeds the cap (200 chars for queries, 80 for vaults), **starts with `-`** (so it can never be parsed as a CLI flag), or contains `\r`, `\n`, or `\0`. Values are then passed as separate `spawn` argv entries — never through a shell — so injection is structurally impossible.

## 🏃 Execution (`run`, `src/vault-cli.ts:56`)

- **Binary resolution** — `findBinary(cmd.bin)` from [local-agents-and-injector.md](./local-agents-and-injector.md), falling back to the bare command name if not in any known dir; if that bare name also doesn't exist on disk (`fs.existsSync`), the job fails with "`op`/`bw`/`pass-cli` isn't installed on this computer." The resolved binary's directory is prepended to the child's PATH so self-locating CLIs (and anything they invoke) work.
- **Environment** — the child gets a minimal env: `PATH` = binary dir + `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin` + the inherited PATH, and `HOME` set to the real home directory (`os.homedir()`) so each CLI finds its own sign-in state (1Password's app Keychain, Bitwarden's `~/.config/Bitwarden CLI` data, pass-cli's local store) even though Electron was launched from the Dock.
- **Tokens** — when `job.token` is present and not the literal `"desktop"`, it is injected as the manager's session variable: `OP_SERVICE_ACCOUNT_TOKEN` for 1Password (a service-account token the server can hold so `op` works unattended), `BW_SESSION` for Bitwarden (an unlocked session key). The sentinel `"desktop"` means "rely on whatever the person's CLI already has", which is also the behaviour when no token is sent. Proton Pass takes no token here — `pass-cli` uses its own stored sign-in.
- **Timeouts and caps** — 20-second kill timer; stdout capped at 200,000 chars; stderr kept at 400 chars. `run` never rejects: every failure path resolves with `{ ok: false, error }`, so the runner's only control flow is ok/not-ok. Spawn errors (binary missing at exec time) resolve as a failed job rather than throwing.
- **Output parsing** — on exit 0, stdout is parsed as JSON; if it isn't JSON, it is wrapped as `{ text: <first 4,000 chars> }` so unstructured CLI output still reaches the server. An empty but successful run resolves as `{}`. Non-zero exits fail with the trimmed stderr (≤ 300 chars) or "`<bin>` exited N".

Every failure mode produces a distinct, agent-readable message: refusal ("That lookup isn't allowed."), missing binary ("`<bin>` isn't installed on this computer."), spawn/exec failure (same message, from the `error` handler), non-zero exit (stderr excerpt), or a successful-but-unparseable result (wrapped as text rather than failed).

## 🔐 Security Posture

- The Mac app never stores secrets for this feature: it is a pass-through to the manager the person already signed into, executed locally with no shell, no flag injection, and a fixed argv template per source (`bin` + `args` arrays passed straight to `spawn`).
- Query/vault values are sanitized before they can reach argv (`clean`, `src/vault-cli.ts:25`): trimmed, length-capped (200/80), no leading `-`, no control characters.
- A job chooses at most _which saved record to look up_ — never _which program runs_ or _which extra flags apply_.
- The result goes to the server over the host's `x-host-id`/`x-host-token` authenticated transport (see [host.md](./host.md)); what the server redacts or grants before an agent sees it is governed there and by the secret-broker rules in the [security model](../architecture/security-model.md).
- Refusal is the default on every unexpected shape: unknown source/action, malformed query, missing binary, or a manager that errors out.

### Relationship to the secret broker

This runner is the **local** leg of Sayabot's secret story. The broker path (`use_secret`, `$SECRET{...}` placeholders) resolves credentials server-side and injects them into authorized outbound requests — agents never see plaintext. The vault runner is for the opposite case: the credential only exists inside a password manager signed in on the owner's Mac, so the _lookup_ runs there and the result flows back through the server's grant checks. The two mechanisms share nothing at runtime on the desktop — the app holds no KEK and never decrypts Sayabot-stored secrets.

---

## Related docs

- [Host service (registration & heartbeat)](./host.md)
- [Overview (lifecycle, IPC, storage)](./overview.md)
- [Local MCP & model discovery](./local-mcp-and-models.md)
- [Desktop Host API (server side)](../web/api/api-desktop.md)
- [Security model](../architecture/security-model.md)
