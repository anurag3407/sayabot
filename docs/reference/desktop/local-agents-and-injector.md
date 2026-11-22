# Sayabot Desktop — Local Agent Detection & Input Injection

`local-agents.ts` finds the AI coding CLIs installed on this computer and reports **only their presence, version, account label and model list** — credentials are never read or sent. `injector.ts` is the mouse/keyboard side of remote desktop. On macOS it is one long-lived JXA process that posts CoreGraphics and System Events once Accessibility is granted. On Windows it is one long-lived hidden PowerShell process (`WIN_INJECTOR_SCRIPT`) that calls `SetCursorPos`, `mouse_event`, `keybd_event`, and `SendInput`. Windows has no Accessibility prompt; `permissionState()` reports `accessibility: "granted"` and `screen: "granted"` unless `getMediaAccessStatus("screen")` is `denied` or `restricted`. The Command key from a viewer is the Windows key (`VK 0x5B`).

Source files: `apps/desktop/src/local-agents.ts`, `src/injector.ts`

---

## 🕵️ Agent Specs (`AGENT_SPECS`, `src/local-agents.ts:69`)

Each of the 21 CLI apps is an `AgentSpec`: `{ id, name, bin, run, keyEnv, login?, signedIn }`. `run` is how the [local runner](./runner-and-stream.md) starts it — `{ kind: "tools" }` (Claude Code, Codex stream modes), `{ kind: "plain" }` (pi's print mode), or `{ kind: "acp", args }` (Agent Client Protocol, handled by `acp.ts`). Every mode but `plain` gets Sayabot's room tools. `login` is the sign-in command shown in auth errors when it isn't `bin` itself (Antigravity: `agy`). Claude Code and Codex run only as their own unmodified binaries (`tools`): Anthropic does not allow third-party apps built on the Agent SDK to use a Claude subscription sign-in, and OpenAI has not sanctioned third-party use of ChatGPT sign-in, so the `claude-agent-acp` / `codex-acp` adapters are deliberately not listed.

| id             | Name             | bin            | Run mode                                      | Sign-in checked via (paths relative to `$HOME`; `XDG_*`/app-specific env overrides honoured)                               |
| :------------- | :--------------- | :------------- | :-------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| `claude-code`  | Claude Code      | `claude`       | tools                                         | `~/.claude/.credentials.json`, `~/.claude.json` containing `"oauthAccount"`, or Keychain service `Claude Code-credentials` |
| `codex`        | Codex            | `codex`        | tools                                         | `auth.json` under `$CODEX_HOME` (default `~/.codex`)                                                                       |
| `antigravity`  | Antigravity      | `agy`          | acp `acp`                                     | `~/.gemini/antigravity-cli/antigravity-oauth-token` (Google sign-in); `login: "agy"`                                       |
| `copilot`      | GitHub Copilot   | `copilot`      | acp `--acp --stdio`                           | `config.json` under `$COPILOT_HOME` with `loggedInUsers`/`lastLoggedInUser`, or Keychain `copilot-cli`                     |
| `command-code` | Command Code     | `command-code` | acp `acp`                                     | `~/.commandcode/auth.json` with an `apiKey`                                                                                |
| `cursor`       | Cursor           | `cursor-agent` | acp `acp`                                     | Keychain `cursor-access-token` or `~/.cursor/cli-config.json` with `authInfo`                                              |
| `gemini`       | Gemini CLI       | `gemini`       | acp `--acp`                                   | `GEMINI_API_KEY`/`GOOGLE_API_KEY` in env or `~/.gemini/.env`, or `~/.gemini/settings.json` with `selectedType` `gemini-api-key` / `vertex-ai` |
| `opencode`     | OpenCode         | `opencode`     | acp `acp`                                     | `auth.json`, `opencode.json` (config) or `opencode.db` under XDG data/config                                               |
| `mistral-vibe` | Mistral (Vibe)   | `vibe-acp`     | acp                                           | `$VIBE_HOME` (default `~/.vibe`) `whoami_cache.json`, `.env` with `MISTRAL_API_KEY`, or Keychain `ai.mistral.vibe`         |
| `grok`         | Grok             | `grok`         | acp `agent stdio`                             | `auth.json` under `$GROK_HOME` (default `~/.grok`)                                                                         |
| `kimi`         | Kimi Code        | `kimi`         | acp `acp`                                     | credentials dir under `$KIMI_CODE_HOME` (default `~/.kimi-code`) matching `/^kimi-code.*\.json$/`                          |
| `kiro`         | Kiro             | `kiro-cli`     | acp `acp --agent-engine=v3 --auth-method=cli` | `kiro-cli/data.sqlite3` under `~/Library/Application Support` (macOS) or XDG data                                          |
| `droid`        | Droid (Factory)  | `droid`        | acp `exec -o acp`                             | `~/.factory/auth.json` or `auth.v2.*`                                                                                      |
| `devin`        | Devin            | `devin`        | acp `acp`                                     | XDG config `devin/credentials.toml`                                                                                        |
| `cline`        | Cline            | `cline`        | acp `--acp --auto-approve false`              | providers.json under `$CLINE_DIR` (default `~/.cline`) with `apiKey`/`accessToken`                                         |
| `qwen`         | Qwen Code        | `qwen`         | acp `--acp`                                   | `~/.qwen/oauth_creds.json` or `settings.json`                                                                              |
| `hermes`       | Hermes           | `hermes`       | acp `acp`                                     | `~/.hermes/config.yaml` or `auth.json`                                                                                     |
| `omp`          | OMP (Oh My Pi)   | `omp`          | acp `acp`                                     | `~/.omp/agent`                                                                                                             |
| `pi`           | pi               | `pi`           | plain                                         | `~/.pi/agent/auth.json` containing a JSON object                                                                           |
| `deepseek`     | DeepSeek Harness | `dsh`          | acp `--profile acp`                           | `.credentials.yaml` or `.env` with `DEEPSEEK_API_KEY` under `$DSH_HOME` (default `~/.dsh`)                                 |
| `zcode`        | ZCode            | `zcode`        | acp `--acp`                                   | `~/.zcode/cli/config.json`, `~/.zcode/cli/setting.json` or `~/.zcode/v2/provider_config.json`                              |

`keyEnv` lists API keys each app accepts **instead of** a sign-in; `hasEnv` only checks that a variable is non-empty in the app's own environment — the values are never opened. Keychain probes run `/usr/bin/security find-generic-password -s <service>` on macOS only (`keychainHas` returns false on Windows) and check only the exit code. Sign-in files under the home directory still count on Windows.

The detection primitives are small async helpers reused across specs: `fileHas(file, regex)` reads a file and tests its text (missing file → false), `dirHas(dir, regex)` matches at least one entry name, `exists` is a `stat` probe, and `xdgData`/`xdgConfig` resolve XDG base dirs with `~/.local/share` / `~/.config` defaults (respecting `$XDG_DATA_HOME` / `$XDG_CONFIG_HOME`). On Windows both resolve to `%APPDATA%` (`~/AppData/Roaming`). Kiro's database is also checked under `%LOCALAPPDATA%`. `someTrue` short-circuits the per-app check list in order, so the cheapest probe wins.

`findBinary` (`src/bin-path.ts`) searches `PATH` plus Homebrew/`/usr/local` on macOS, or npm, pnpm, Scoop, WinGet, Chocolatey, Volta, and nvm-windows on Windows. On Windows it tries `PATHEXT` (`.exe` before `.cmd`). `spawnTool` runs `.exe` directly and `.cmd`/`.bat` shims through `cmd.exe /d /s /c` with `quoteForCmd`, because Node refuses `spawn` of a `.cmd` file. The runner, ACP client, model probes, vault CLI, and local MCP host all start tools through `spawnTool`.

### Signing Antigravity in from Sayabot (`src/agent-login.ts`)

`AgentLogin` runs an app's **own** login so a person can sign in without a terminal. Only `antigravity` is supported (`LOGIN_ARGS`): it spawns `agy acp --login`, which prints a Google link (`https://accounts.google.com/o/oauth2/auth?…redirect_uri=https://antigravity.google/oauth-callback…`) and then reads one line from stdin, the code or the full URL of the page the browser lands on.

- `start(appId)` → `{ ok: true, url }` once `loginUrl()` finds the link in the output (30 s), or `{ ok: false, error }`. One sign-in at a time; a new start cancels the last.
- `submit(code)` → writes the cleaned line (`cleanCode`: trimmed, one line, ≤ 4,096 chars) to stdin and waits up to 90 s for exit; exit 0 = signed in. Error text is the output's last lines with URLs stripped.
- `cancel()` kills the login process.

IPC (`src/main.ts`): `agents:sign-in-start` (opens the link with `shell.openExternal`), `agents:sign-in-submit` (on success `DesktopHost.rescanAgents()` forces a scan on the next heartbeat) and `agents:sign-in-cancel`. Preload exposes them as `signInAgentStart`, `signInAgentSubmit`, `signInAgentCancel`. Sayabot never reads, stores or forwards the tokens: `agy` writes its own sign-in, and Google's terms forbid extracting or reusing it. The Providers page uses this for a signed-out Antigravity (see [lib reference](../web/pages/lib-reference.md)).

### Coordination with `@sayabot/core`

This list mirrors `MAC_CLI_APPS` in `packages/core/src/mac-apps.ts` — the shared catalogue the web (model picker, Providers page) and orchestrator use. `apps/desktop/src/acp.test.ts` ("agent apps") imports `MAC_CLI_APPS` and asserts every desktop spec's `id`/`bin` matches the shared entry and that its `run.kind` equals the shared `transport` (`tools` | `acp` | `plain`), so the two lists cannot drift. The server uses `transport` to decide which runs get room tools (`macAppTakesRoomTools`). The core side classifies each app's `access` level (`account`, `account_or_key`, `key`, `own_config`) and carries the `install`/`signIn` command strings shown in the UI; the desktop side owns the detection probes and the launch arguments, which is why the two files exist at all. See [Scanner (core)](../core/scanner.md) and [Agents on your Mac](../../agents-on-your-mac.md).

The TypeScript shapes the rest of the app consumes:

```typescript
export interface LocalAgent {
  id: string // spec id, e.g. "claude-code"
  name: string // display name, e.g. "Claude Code"
  binary: string | null // resolved path, or null when not installed
  status: "ready" | "signed_out" | "not_installed"
  version: string | null // "x.y" or "x.y.z" from `--version`
  account?: string | null // "you@example.com · Org" when the app exposes it
  models?: ReportedModel[] // model list, when it could be read
}

export type RunMode =
  | { kind: "tools" } // Claude Code, Codex
  | { kind: "plain" } // pi
  | { kind: "acp"; args: readonly string[] } // Agent Client Protocol apps
```

`ReportedModel` comes from [local-mcp-and-models.md](./local-mcp-and-models.md). `main.ts` strips `binary` and `run` before the list goes to the server — the heartbeat only carries `{ id, name, status, version, account?, models? }` (`src/main.ts:187-195`).

---

## 🔎 Detection Pipeline (`detectLocalAgents`, `src/local-agents.ts:327`)

For every spec, in parallel:

1. **Binary lookup** — `findBinary(spec.bin)` (`src/local-agents.ts:301`) scans `$PATH` plus `BIN_DIRS` (`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `~/.local/bin`, `~/.bun/bin`, `~/.npm-global/bin`, `~/.claude/local`) and `versionManagerBins()` — `~/.volta/bin`, `~/.fnm/aliases/default/bin`, and every `~/.nvm/versions/node/*/bin` (newest first) — because apps launched from the Dock get a bare PATH. Candidates must pass `access(..., X_OK)`.
2. **Sign-in status** — `ready` when a binary exists **and** (`hasEnv(keyEnv)` or `spec.signedIn(home)`); `signed_out` when the binary exists but no login was found; `not_installed` otherwise.
3. **Version** — `run(binary, ["--version"])` (2.5 s timeout) with the first `x.y[.z]` extracted from stdout.
4. **Account + models** — only for `ready` apps: `claudeAccount` (email · org from `~/.claude.json`'s `oauthAccount`) and `geminiAccount` (active account from `~/.gemini/google_accounts.json`) where applicable, plus `appModels(...)` from [local-models.ts](./local-mcp-and-models.md).

Model servers running locally are appended with no sign-in concept: `detectLocalModelServers()` probes Ollama and LM Studio, and each becomes a `LocalAgent` with `status: "ready"` when it has downloaded models (`src/local-agents.ts:360-368`). Their `binary` is `null` and `version` is `null` — there is no CLI to inspect, only an HTTP endpoint.

The result — `LocalAgent[]` with `{ id, name, binary, status, version, account?, models? }` — is what the host reports in its heartbeat's `localAgents` field (scanned at most once a minute) and what powers the web's model pickers and Providers page.

Two details keep the report honest and cheap:

- **`version` comes from the binary itself** (`run(binary, ["--version"])`, `src/local-agents.ts:315`): the child runs with a PATH whose first entry is the binary's own directory — the same trick the runner uses later, since nvm-installed CLIs are Node scripts that need their matching `node` — and a failed/timed-out run yields `null`, not an error.
- **`agentSpec(id)`** (`src/local-agents.ts:273`) is the single lookup the runner uses to turn a claimed job's `app` string into `{ bin, run, keyEnv, name }`; an unknown app falls through to the plain-text path, where `commandFor` treats `claude-code` as the default.

---

## ⌨️ Input Injection (`src/injector.ts`)

`Injector` is macOS-only (`supported` = `process.platform === "darwin"`). `send` lazily spawns:

```bash
/usr/bin/osascript -l JavaScript -e <INJECTOR_SCRIPT>
```

The embedded JXA script (`src/injector.ts:9-44`) reads newline-delimited JSON events from stdin in a loop and dispatches (each line is `try/catch`ed, so one malformed event never kills the process):

- `move` / `down` / `up` — `CGEventCreateMouseEvent` + `CGEventPost`, tracking held buttons so moves become drags (types 5/6/7) and right-button (`b: 2`) events use the right variants (types 3/4/2).
- `scroll` — `CGEventCreateScrollWheelEvent2` with negated `dy`/`dx`.
- `text` — System Events `keystroke(s)`.
- `key` — System Events `keyCode(code, { using: mods })` when the key maps in `KEY_CODES`, else `keystroke(key, { using })`; mods translate to `command/control/option/shift down`.

The `KEY_CODES` table (`src/injector.ts:46-61`) covers the special keys a viewer's keyboard sends as names rather than text: `Enter` 36, `Backspace` 51, `Tab` 48, `Escape` 53, `Delete` 117 (forward delete), `ArrowLeft/Right/Down/Up` 123–126, `Home` 115, `End` 119, `PageUp` 116, `PageDown` 121, and space (`" "`) 49. Printable characters travel as `text`/`keystroke` events instead.

Everything is normalized upstream by `DesktopHost.parseInput` (coordinates 0–1, scaled to the display, string keys ≤ 20 chars, text ≤ 500 chars) — see [host.md](./host.md). Without the Accessibility permission macOS silently drops the events, which is why the host gates control on `permissionState().accessibility === "granted"`.

The injector process is kept long-lived: `send` respawns it only when `proc` is null or has an `exitCode`, writes one JSON line per event to its stdin, and swallows its stderr — so a burst of pointer events costs no process startup. On Windows the script is passed as a UTF-16 `-EncodedCommand` to `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` with the window hidden. If spawn itself fails, `proc` is reset and the event is dropped silently. `supported` is true on `darwin` and `win32`.

`stop()` ends stdin and kills the process; the app tears the injector down when the host stops (menu-driven server change, sign-out, quit), and the next `send` after that transparently spawns a fresh JXA process. The script is exported as `INJECTOR_SCRIPT` for tests.

---

## ⚠️ Failure Semantics

Detection never throws: every probe (`stat`, `readFile`, `readdir`, keychain exec, `--version`) has a catch or resolves false on error, so a half-uninstalled app or an unreadable config yields `signed_out` / `version: null` rather than a failed scan — matching the heartbeat contract where `detectLocalAgents().catch(() => this.agents)` falls back to the previous scan (`src/host.ts:372`).

---

## Related docs

- [Host service (registration & heartbeat)](./host.md)
- [Local runner & event streaming](./runner-and-stream.md)
- [Local MCP & model discovery](./local-mcp-and-models.md)
- [Overview (lifecycle, IPC, storage)](./overview.md)
- [Scanner (core usage engine)](../core/scanner.md)
- [Agents on your Mac](../../agents-on-your-mac.md)
- [Computers & remote UI](../web/pages/computers-remote-ui.md)
