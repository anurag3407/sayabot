# Agents on your Mac

With Sayabot for Mac installed, your agents run **on your Mac**, using an agent app you're already
signed in to: Claude Code, Codex, GitHub Copilot, Command Code, Cursor, Gemini CLI, OpenCode,
Mistral Vibe, Grok, Kimi, Kiro, Droid, Devin, Cline, Qwen, Hermes, OMP, pi or DeepSeek Harness.
That means your own subscription, and for most of them no API key and no setup. Chats, tasks and canvases still live on the server, so the web and phone
see everything live.

## What happens when you message an agent

```
 You (web / phone / Mac)         Sayabot server                          Your Mac (Sayabot for Mac)
 "@helper fix the tests"  ─────► turn starts
                                 mints a one-run tool token
                                 (this agent, this room, no secrets)
                                 queues a job ─────────────────────────► claims it, starts Claude Code
                                                                          with Sayabot's tools + the
                                                                          approval prompt
 tool cards appear live  ◄────── each step it takes ◄─────────────────── "Bash: npm test" …
 approval card: Allow /  ◄────── needs your OK ◄──────────────────────── wants to edit a file
 Always allow / Deny  ─────────► your answer ─────────────────────────► allowed or denied
 reply streams in        ◄────── final answer ◄──────────────────────── done
                                 token revoked
```

## Which apps, and do you need an API key?

Sayabot for Mac looks for each app's command-line tool and its sign-in (a login file or keychain
entry; the credentials themselves are never read or sent) and reports what it finds every minute.
The Providers page lists them under _On this computer_, with the rest under _More providers_ and
their install command. The model picker shows each ready app with the models it offers you.

| App              | Command        | Sign-in                                                                              | API key instead                        |
| ---------------- | -------------- | ------------------------------------------------------------------------------------ | -------------------------------------- |
| Claude Code      | `claude`       | its own login                                                                        | `ANTHROPIC_API_KEY`                    |
| Codex            | `codex`        | `codex login`                                                                        | `OPENAI_API_KEY`                       |
| Antigravity      | `agy`          | your Google account (run `agy` once); the CLI ships with Antigravity (`agy install`) | none (account only)                    |
| GitHub Copilot   | `copilot`      | `copilot login`                                                                      | `COPILOT_GITHUB_TOKEN` / `GH_TOKEN`    |
| Command Code     | `command-code` | `command-code login`                                                                 | `COMMAND_CODE_API_KEY`                 |
| Cursor           | `cursor-agent` | `cursor-agent login`                                                                 | `CURSOR_API_KEY`                       |
| Gemini CLI       | `gemini`       | **needs a key**: Google ended personal Gemini CLI logins (use Antigravity for those) | `GEMINI_API_KEY` / `GOOGLE_API_KEY`    |
| OpenCode         | `opencode`     | `opencode auth login`, or its free models                                            | `OPENCODE_API_KEY`                     |
| Mistral (Vibe)   | `vibe-acp`     | `vibe`                                                                               | `MISTRAL_API_KEY`                      |
| Grok             | `grok`         | `grok login`                                                                         | none (subscription only)               |
| Kimi Code        | `kimi`         | `kimi login`                                                                         | none (subscription only)               |
| Kiro             | `kiro-cli`     | `kiro-cli login`                                                                     | `KIRO_API_KEY`                         |
| Droid (Factory)  | `droid`        | `droid`                                                                              | `FACTORY_API_KEY`                      |
| Devin            | `devin`        | `devin auth login`                                                                   | `WINDSURF_API_KEY`                     |
| Cline            | `cline`        | `cline auth`                                                                         | `CLINE_API_KEY`                        |
| Qwen Code        | `qwen`         | providers set up in Qwen                                                             | —                                      |
| Hermes           | `hermes`       | providers set up with `hermes setup`                                                 | —                                      |
| OMP (Oh My Pi)   | `omp`          | providers set up in OMP                                                              | —                                      |
| pi               | `pi`           | **needs a provider key** saved in pi                                                 | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`… |
| DeepSeek Harness | `dsh`          | **needs a key**                                                                      | `DEEPSEEK_API_KEY`                     |
| ZCode            | `zcode`        | `zcode login zai`                                                                    | `ZCODE_API_KEY` / `ZAI_API_KEY`        |

**Antigravity is for your own messages only.** Google allows Antigravity's personal sign-in
through its official ACP server (`agy acp`, which is what Sayabot runs) for single-user,
interactive use. So a bot on Antigravity answers **only messages you send yourself**. Routines,
meetings, webhooks, connected chats (WhatsApp, Slack…), other people in the room and other bots
get an error instead, and Antigravity is never picked as a Mac's default app. Sayabot never reads
or forwards its tokens. For automated or shared use, run Gemini CLI with a `GEMINI_API_KEY`.

**Why there's no "Claude Code (ACP)" or "Codex (ACP)".** Anthropic doesn't allow third-party apps
built on its Agent SDK (which the Claude ACP adapter is) to use a Claude subscription sign-in.
Only the unmodified Claude Code app may use it. OpenAI hasn't approved third-party use of ChatGPT
sign-in either. So Sayabot runs `claude` and `codex` themselves, as the apps you installed.

**Model lists are live.** Each app reports the models it offers you: Claude Code and Codex from
their own lists, pi from `pi --list-models`, Cursor from its session or `cursor-agent models`, and
every ACP app (Antigravity, OpenCode, Copilot, Hermes, OMP…) from a session that is opened and
closed without a prompt. Lists are kept six hours (or until the app updates) and read in the
background, so a slow app never makes the Mac look offline. The **refresh** button in the model
picker asks your Macs to read them again now; the picker reloads by itself when they answer
(usually within a minute). Apps that offer a thinking effort (OpenCode, Copilot…) get an Effort
choice too.

An "API key instead" only counts when Sayabot for Mac can see it: saved in the app itself, or in
the environment the Mac app was started with (apps opened from the Dock don't read your shell
profile). Keys you add to Sayabot's own Providers page are used by the server, not by these apps.

## Which agents run on the Mac

- **By default:** once Sayabot for Mac finds a signed-in app, agents with no key or computer of
  their own run on that Mac, in workspaces where **you're the only member**. The app picked is
  Claude Code, then Codex, Copilot, Cursor, Gemini CLI, OpenCode, then the others in the table
  above.
- **When the Mac is offline,** the server answers as before.
- **In shared workspaces,** pick "run on my computer" per agent. Nobody else's messages run on your
  Mac by default.
- **Turn it off** in Settings → Computers → _Use this computer for my agents_. Once off, it stays
  off.

## What they can do

|                                                             | Claude Code   | Codex                            | ACP apps¹     | pi           |
| ----------------------------------------------------------- | ------------- | -------------------------------- | ------------- | ------------ |
| Reply in the room                                           | ✓             | ✓                                | ✓             | ✓            |
| Sayabot tools: tasks, canvas, decisions, votes, owner facts | ✓             | ✓                                | ✓²            | —            |
| Live tool cards in the room                                 | ✓             | ✓                                | ✓             | —            |
| Pick a model (and effort) in the picker                     | ✓             | ✓                                | ✓             | ✓            |
| Commands, edits, web pages                                  | ask you first | inside its folder only (sandbox) | ask you first | app defaults |

¹ Antigravity, OpenCode, Copilot, Command Code, Cursor, Gemini CLI, Mistral Vibe, Grok, Kimi, Kiro, Droid, Devin, Cline, Qwen, Hermes, OMP, DeepSeek Harness and
ZCode speak the [Agent Client Protocol](https://agentclientprotocol.com). Sayabot for Mac
starts them with no file or terminal access of its own (`apps/desktop/src/acp.ts`), streams their
reply, and turns every permission they ask for into an approval card; a yes allows that one step.
The model and effort you pick are set on the session before the prompt. With Sayabot for Mac
1.0.32+, the room's instructions go in as the session's system prompt where the app takes one
(ACP's `systemPrompt`, or Antigravity's own extension), not in front of your message.

² Needs Sayabot for Mac 1.0.32 or later. The room tools are handed to the session as a small
stdio MCP server (`apps/desktop/src/room-mcp.ts`) that uses a token for this one run, which is
revoked when the run ends. Calls to these tools don't ask you on the Mac, just as with Claude Code;
the server still asks before the risky ones. The runner posts the reply itself, so it hides
`post_message`, `wait_for_activity` and `use_secret`. Older Mac apps run ACP agents without room
tools, and the server doesn't tell them they have any.

Each agent works in its own folder: `~/Sayabot/agents/<handle>`.

## Approvals

When Claude Code wants to do something that needs permission (run a command, edit a file, open a
page), the step's card in the chat turns into an approval:

- **Allow** runs this one step.
- **Always allow …** runs it and saves a narrow rule on the agent, so it won't ask again. A
  command is allowed by its first words (`npm test`, not all of `npm`), a web page by its site.
  Commands that chain others (`&&`, `;`, `|`, `>`) or use `rm` or `sudo` can only be allowed once.
- **Deny**: Claude is told no and explains what it needed instead.

You can answer from the web, the phone (push notification and the room) or the Mac, which shows a
notification that opens the chat. Unanswered after five minutes, the step is refused. **Only the
owner of the Mac can answer**, even in a shared room where others are admins. Saved rules live in
the agent's settings (`params.localAllow`).

## Security

- **One-run token:** the tool token is limited to that agent and room, has no secrets access, expires
  after 30 minutes and is revoked when the job ends. It's sealed with `MESH_KEK` until the Mac
  claims the job, then wiped from the database. On the Mac it sits in a 0600 file in a 0700
  folder (Claude) or an environment variable (Codex), never on a command line.
- **Approvals fail closed:** the approval server (`approve-mcp.js`) talks to the app over a private
  socket. If anything fails (no answer, socket gone, Sayabot unreachable), the answer is no.
- **Your own setup stays out:** agent runs use only the agent folder's settings
  (`--setting-sources project,local`) and `--strict-mcp-config`. Your own hooks, plugins and MCP
  servers aren't loaded into agent runs.
- **Blocked Sayabot tools:** `post_message`, `wait_for_activity` and `use_secret` are blocked
  during a Mac run.

## Files

- [`apps/desktop/src/runner.ts`](../apps/desktop/src/runner.ts): runs the apps, reports steps, answers approvals
- [`apps/desktop/src/acp.ts`](../apps/desktop/src/acp.ts): the Agent Client Protocol client (sessions, models, steps, permissions)
- [`apps/desktop/src/room-mcp.ts`](../apps/desktop/src/room-mcp.ts): room tools for ACP apps (stdio → `/api/v1/mcp` bridge)
- [`apps/desktop/src/agent-login.ts`](../apps/desktop/src/agent-login.ts): Antigravity's Google sign-in from the Providers page (`agy acp --login`)
- [`apps/desktop/src/local-agents.ts`](../apps/desktop/src/local-agents.ts): finds each app and its sign-in, and how to start it
- [`apps/desktop/src/local-models.ts`](../apps/desktop/src/local-models.ts): each app's live model list (cached six hours)
- [`apps/desktop/src/bin-path.ts`](../apps/desktop/src/bin-path.ts): finds the apps and the `node` they need, even when opened from the Dock
- [`packages/core/src/mac-apps.ts`](../packages/core/src/mac-apps.ts): the app list the web and the server share, and whether each needs an API key
- [`apps/desktop/src/approve-mcp.ts`](../apps/desktop/src/approve-mcp.ts): Claude Code's permission prompt (stdio MCP)
- [`apps/desktop/src/mac-stream.ts`](../apps/desktop/src/mac-stream.ts): reads Claude / Codex output, always-allow rules
- [`apps/orchestrator/src/runner/local.ts`](../apps/orchestrator/src/runner/local.ts): queues the job, the tool token, the Mac default
- [`apps/orchestrator/src/runner/local-events.ts`](../apps/orchestrator/src/runner/local-events.ts): tool cards and approvals
- [`apps/web/src/app/api/desktop/jobs/`](../apps/web/src/app/api/desktop/jobs/): claim, progress, events, approvals (host token)
- [`apps/web/src/lib/mac-runner.ts`](../apps/web/src/lib/mac-runner.ts): who can answer, always-allow
- [`packages/db/sql/0032_mac_runner_tools.sql`](../packages/db/sql/0032_mac_runner_tools.sql): job columns + card lookup index
