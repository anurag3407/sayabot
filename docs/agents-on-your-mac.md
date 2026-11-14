# Agents on your Mac

With Sayabot for Mac installed, your agents run **on your Mac**, using the Claude Code, Codex,
Gemini CLI, OpenCode or Cursor you're already signed in to. That means your own subscription, no API
key and no setup. Chats, tasks and canvases still live on the server, so the web and phone
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

## Which agents run on the Mac

- **By default:** once Sayabot for Mac finds a signed-in app, agents with no key or computer of
  their own run on that Mac, in workspaces where **you're the only member**. The app picked is
  Claude Code, then Codex, Gemini CLI, OpenCode, Cursor.
- **When the Mac is offline,** the server answers as before.
- **In shared workspaces,** pick "run on my computer" per agent. Nobody else's messages run on your
  Mac by default.
- **Turn it off** in Settings → Computers → _Use this computer for my agents_. Once off, it stays
  off.

## What they can do

|                                                             | Claude Code   | Codex                            | Gemini / OpenCode / Cursor |
| ----------------------------------------------------------- | ------------- | -------------------------------- | -------------------------- |
| Reply in the room                                           | ✓             | ✓                                | ✓                          |
| Sayabot tools: tasks, canvas, decisions, votes, owner facts | ✓             | ✓                                | —                          |
| Live tool cards in the room                                 | ✓             | ✓                                | —                          |
| Commands, edits, web pages                                  | ask you first | inside its folder only (sandbox) | app defaults               |

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
- [`apps/desktop/src/approve-mcp.ts`](../apps/desktop/src/approve-mcp.ts): Claude Code's permission prompt (stdio MCP)
- [`apps/desktop/src/mac-stream.ts`](../apps/desktop/src/mac-stream.ts): reads Claude / Codex output, always-allow rules
- [`apps/orchestrator/src/runner/local.ts`](../apps/orchestrator/src/runner/local.ts): queues the job, the tool token, the Mac default
- [`apps/orchestrator/src/runner/local-events.ts`](../apps/orchestrator/src/runner/local-events.ts): tool cards and approvals
- [`apps/web/src/app/api/desktop/jobs/`](../apps/web/src/app/api/desktop/jobs/): claim, progress, events, approvals (host token)
- [`apps/web/src/lib/mac-runner.ts`](../apps/web/src/lib/mac-runner.ts): who can answer, always-allow
- [`packages/db/sql/0032_mac_runner_tools.sql`](../packages/db/sql/0032_mac_runner_tools.sql): job columns + card lookup index
