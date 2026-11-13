# The Self-Hosted Sayabot Flow

Give a task from your phone, laptop, Telegram or a schedule, close everything, and get the
result (or a one-tap approval) on your lock screen. This page sets that up on your own server and
says what each step really does, including the limits.

```
 ┌─ You ask ───────────────┐        ┌─ Your server (VPS) ─────────────────────────┐        ┌─ You hear back ───────────┐
 │ Phone app  (QR-paired)  │        │ nginx ◀── Cloudflare Tunnel or :443         │        │ Phone push: Allow / Deny  │
 │ Browser / Mac app       │ ─────▶ │ orchestrator: one turn per room at a time   │ ─────▶ │ Browser push: Allow / Deny│
 │ Telegram / Discord / WA │        │ computerd: the agent's own cloud computer   │        │ Same Telegram chat        │
 │ Automations (cron)      │        │ Mac app tools, only while the Mac is awake  │        │ "Routine is done" alert   │
 └─────────────────────────┘        └─────────────────────────────────────────────┘        └───────────────────────────┘
```

## 0. Put the server online

Follow [`deploy/README.md`](../deploy/README.md). Copy `deploy/.env.production.example` to `deploy/.env.production` and configure your domain (`SAYABOT_DOMAIN`, legacy fallback `MESH_DOMAIN`), master encryption key (`SAYABOT_KEK`, legacy fallback `MESH_KEK`), and Supabase connection strings.

There are two ways to expose it:

|                         | Open ports + Let's Encrypt (default)                  | Cloudflare Tunnel                   |
| ----------------------- | ----------------------------------------------------- | ----------------------------------- |
| Ports open on the VPS   | 22, 80, 443                                           | 22 only                             |
| Certificate             | `deploy/scripts/init-letsencrypt.sh`, renewed by certbot | Cloudflare's, nothing to renew      |
| Turn it on              | nothing to set                                        | set `CLOUDFLARE_TUNNEL_TOKEN`       |
| SSO in front of the app | no                                                    | optional, through Cloudflare Access |

**Tunnel setup:**

1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → **Create a tunnel** (cloudflared).
   Copy the token.
2. On the tunnel, add a **Public Hostname**: your `SAYABOT_DOMAIN` (or legacy `MESH_DOMAIN`) → Service **HTTP** → `nginx:8080`.
3. Put the token in `deploy/.env.production` as `CLOUDFLARE_TUNNEL_TOKEN=…` and run
   `./deploy/deploy.sh`. Skip `init-letsencrypt.sh`.
4. Close the web ports: `sudo ufw delete allow 80/tcp && sudo ufw delete allow 443/tcp`.

nginx stays in the path, so rate limits, streaming and the canvas WebSocket behave the same.
It reads the visitor's real address from `CF-Connecting-IP`, so the rate limits still apply per
visitor.

**Cloudflare Access (optional SSO).** Phones, the Mac app, bots, MCP clients and webhooks can't
complete a browser sign-in. Add a **Bypass** policy for these paths, or they break:
`/api/v1/*` `/mcp/*` `/oauth/*` `/.well-known/*` `/api/mobile/*` `/api/desktop/*` `/api/remote/*`
`/api/messaging/*` `/api/version` `/api/health`. Sayabot still requires its own sign-in on every one
of these.

Phone and browser alerts need VAPID keys (`npx web-push generate-vapid-keys` → the
`*_VAPID_*` values in `.env.production`). Phone pushes are delivered through Expo's push
service, so alert titles and previews pass through Expo.

## 1. Pair your phone by QR

Browser → **Settings → Phones → Add a phone**. Scan the QR code with the Sayabot app, or type the
8-character code. The QR code is a `sayabot://pair?code=…&server=…` link. It carries your server
address, so you never type a URL. Codes expire after 10 minutes and work once.

## 2. Act from the lock screen

When an agent stops for a dangerous tool (`dangerous: true`: sending messages, writing files,
shell commands…), every room admin and workspace owner/admin gets an alert:

| Where                    | What you can do                                 | How it behaves                                                                                                                                         |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phone (approval)         | **Allow** / **Don't allow**                     | The app opens after you unlock and decides at once. There's nothing to navigate.                                                                       |
| Phone (question)         | **Answer**, typed in the notification           | The answer goes straight to the agent.                                                                                                                 |
| Browser / Mac (approval) | **Allow** / **Don't allow** on the notification | Decided in the background with your signed-in session. A "Allowed" / "Not allowed" note confirms it. If the approval already expired, the Inbox opens. |

Approvals expire after **5 minutes**, and the agent is told no. Only room admins and workspace
owners/admins can approve, whatever the device. Every decision is recorded in `tool_calls`.

> **Why Allow opens the app on the phone:** acting fully in the background isn't reliable once the
> app has been closed. Opening also keeps approvals behind your phone's unlock, so anyone holding
> your locked phone can't approve.

## 3. Message your agent from Telegram, Discord or WhatsApp

1. **Settings → Connectors** → add Telegram (bot token from @BotFather), Discord (bot token) or
   WhatsApp Business.
2. On the connector, open **Chat**: pick the room and agent that should answer, and list your
   chat ID under **Allowed chats**. Anyone who finds your bot can message it, so always set this
   list.
3. Save. Telegram's webhook is registered for you, and Discord connects by itself. For WhatsApp,
   the confirmation shows the callback URL and verify token to paste into Meta.

Then send something like `check staging logs and summarize`. The agent runs on your server and
replies **in the same chat**. If it needs approval along the way, the chat says
_"Waiting for your OK to use …"_, and you approve from your phone or browser alert (section 2).
For safety, approvals are never granted from inside the chat.

Text messages only for now. Voice notes are ignored.

## 4. Proactive Automations

Sidebar → **Automations** → **New routine**: pick an agent, a schedule (cron, with time zone), a
room and a prompt.

- **Also send results to**: pick one of your allowed Telegram/Discord/WhatsApp chats, and the
  agent's reply is posted there when the run finishes. The server re-checks the target on every
  run. It must be an active connector in this workspace, with chat turned on, and the chat must
  be on its allowed list.
- When a run ends, its creator gets a push: **"Morning brief is done"** with the first line of the
  result, or **"… didn't finish"** with the reason. If an agent or the API created the routine,
  the room's admins get it instead.
- The routine's run history shows what the agent actually said, not just that it started.

Examples:

| Routine         | Schedule       | Prompt                                                                                   |
| --------------- | -------------- | ---------------------------------------------------------------------------------------- |
| Morning brief   | `0 8 * * 1-5`  | Summarize my unread GitHub notifications and today's calendar in 5 bullets.              |
| Uptime watchdog | `*/15 * * * *` | Fetch https://example.com/api/health. If it isn't 200, find the cause and propose a fix. |

Anything dangerous a routine tries (opening a PR, sending a message) still waits for your Allow,
exactly like a task you typed.

## 5. Mac app + cloud computer

The Mac app (`apps/desktop`) pairs your Mac as a **host**. While it's awake, agents can use the
local apps and MCP servers you've shared from it, and can reach saved password-manager items
through it.

When the lid closes, the app stops sending its 2.5-second heartbeat. After **60 seconds of
silence**, agents stop being offered the Mac's tools. They carry on with their own **cloud
computer** (`computerd`) and web tools, and the turn shows _"Skipped …: the computer running it
was offline"_. Nothing stalls. Before this change, each call waited 25 seconds and then failed.

This is not a live migration. Work that needs your Mac (a local file, a desktop-only app) waits
until the Mac is back. Anything the cloud computer can do continues. The cloud computer needs
`SAYABOT_APP_SERVICES="orchestrator web computerd egress"` (legacy fallback: `MESH_APP_SERVICES`) and
`deploy/scripts/setup-computers.sh` on the VPS (see [`tools-and-sandboxes.md`](tools-and-sandboxes.md)).

## 6. Saya AI: your own model, for everyone, always current

Saya AI is a provider that you, the server operator, run for every user. It sits next to the
hosted providers in the model picker and needs no key from anyone. You set it in
`deploy/.env.production`:

```bash
SAYA_AI_NAME=Saya AI
SAYA_AI_BASE_URL=https://llm.example.com/v1     # any OpenAI-compatible endpoint
SAYA_AI_API_KEY=sk-...
SAYA_AI_PROTOCOL=openai-compatible              # or: openai | anthropic
SAYA_AI_MODELS=pro=gpt-5.1|Saya Pro,fast=gpt-5.1-mini|Saya Fast
SAYA_AI_DEFAULT=pro                             # "Automatic" and new agents
SAYA_AI_FAST=fast                               # titles, memory, summaries, critics
```

Then run `./deploy/deploy.sh reload`. That takes seconds with no rebuild. Plain `restart` keeps the
old values.

**How updates reach everyone silently.** Agents never store your real model id. They store an
alias (`saya/pro`), or nothing at all for **Automatic**. Every turn resolves the alias against the
server's current environment. So when you change `pro=gpt-5.1` to `pro=gpt-6`, or point the
endpoint somewhere else, and reload:

| Where                | What people see                                                      | Update needed |
| -------------------- | -------------------------------------------------------------------- | ------------- |
| Web app              | The picker lists your models by label; agents run on the new id      | none          |
| Mac app              | Same as web (it loads your server)                                   | none          |
| Phone app            | Agent profiles show "Saya Pro"; chats and routines run on the new id | none          |
| Agents & Automations | Pick up the new model on their next turn                             | none          |

- **Add a model:** add `alias=id|Label` to `SAYA_AI_MODELS`. It appears in the picker after reload.
- **Retire a model:** remove its alias. Agents that used it move to `SAYA_AI_DEFAULT` instead of
  failing.
- **Rename the provider:** `SAYA_AI_NAME`.
- Keep aliases stable and change the ids behind them freely.

**Privacy.** Browsers and phones only ever receive names and aliases
(`GET /api/providers/saya`). The key, endpoint and real model ids stay on the server (sealed using
`SAYABOT_KEK`), and they are stripped from every agent subprocess, the same as the other server
secrets. Usage and cost records store the real model id, so spend stays accurate across model changes.

A server that only has the older `DEV_OPENAI_COMPAT_*` values shows them as Saya AI with one
model. Nothing needs migrating.

## The whole loop

1. **Ask** from the phone app, browser, Mac, Telegram, or let an Automation fire.
2. **Close everything.** The task runs on your server, one turn per room at a time
   (room advisory lock), in the agent's own sandbox.
3. **Approve** dangerous steps from the alert: Allow on the phone, or right on the browser
   notification. The chat that asked is told it's waiting.
4. **Get the result** where you asked: the same chat, the room, and a "done" push for Automations.
5. **Audit**: every tool call and decision is in the run trace (room → message → Inspect).

## Troubleshooting

| Symptom                                             | Check                                                                                                                                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No phone alerts                                     | App → Settings → alerts on. The phone must be paired with an account that is a room admin or workspace owner/admin.                                                              |
| No browser alerts / no buttons                      | VAPID keys are set. Browser notifications are allowed for the site. Safari doesn't show action buttons, so click the notification to open the Inbox.                             |
| Allow on a notification opens the Inbox             | The approval expired (5 min) or someone already decided it.                                                                                                                      |
| Telegram bot doesn't answer                         | Connector → Chat is on and your chat ID is in Allowed chats. Saving the Chat form again re-registers Telegram's webhook. With Cloudflare Access, `/api/messaging/*` is bypassed. |
| Routine results not in Telegram                     | "Also send results to" only lists chats in a connector's Allowed chats.                                                                                                          |
| Saya AI missing from the picker                     | `SAYA_AI_BASE_URL`, `SAYA_AI_API_KEY` and `SAYA_AI_MODELS` are set, then `./deploy/deploy.sh reload`. Check `/api/providers/saya` while signed in.                               |
| Changed a Saya AI model id, nothing changed         | You ran `restart` instead of `reload`. Containers only read `.env.production` when recreated.                                                                                    |
| Tunnel deploy: "did not respond through Cloudflare" | The tunnel's Public Hostname points at `http://nginx:8080`, and Access bypasses `/api/health`.                                                                                   |
