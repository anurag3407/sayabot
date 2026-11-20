/**
 * The prompt copied from the landing page. It is written for an agent sitting on a VPS
 * that just cloned this repo. Every command and check matches deploy/install.sh,
 * deploy/deploy.sh, and the public routes those containers actually serve.
 */
export const AGENT_SETUP_PROMPT = `Set up Sayabot on this Linux server from the public repository, then verify the self-hosted stack. Follow the installer in the clone. Do not invent a deploy path, and do not print secrets.

Repository: https://github.com/anurag3407/sayabot
License: AGPL-3.0. Keep SAYABOT_EDITION=self-hosted. A self-hosted server has no plans, no usage limits, and no billing. Do not set the edition to cloud, and do not run anything under ee/.

What the installer starts
- nginx, the Next.js web app, and the orchestrator
- Let's Encrypt on ports 80/443, or a Cloudflare Tunnel when a tunnel token is provided
- Postgres, sign-in, realtime, and file storage on this machine when database mode is bundled (the recommended answer)

What the installer does not start
- Agent computers (computerd) and the SSRF-safe egress proxy. They start only after deploy/scripts/setup-computers.sh and SAYABOT_APP_SERVICES includes computerd and egress. The default value is "orchestrator web".

Requirements
- Ubuntu 22.04 or 24.04, or Debian 12
- 2 vCPU, 4 GB RAM, 40 GB disk. The first web build needs about 3 GB; setup-vps.sh adds 4 GB of swap.
- A domain whose A record points at this server, or a Cloudflare Tunnel token

Install
1. From a laptop, once, as root:
   scp deploy/scripts/setup-vps.sh root@SERVER:/root/
   ssh root@SERVER 'bash /root/setup-vps.sh --user deploy --ssh-key "$(cat ~/.ssh/id_ed25519.pub)"'
   Confirm ssh deploy@SERVER works before closing the root session. This turns off password login.
2. As the deploy user:
   git clone https://github.com/anurag3407/sayabot.git ~/sayabot && cd ~/sayabot
   ./deploy/install.sh
   Answers: the domain, the name shown in the apps, HTTPS (Let's Encrypt, or a Cloudflare Tunnel token), and the database. Choose "Everything on this server" unless an existing Supabase project was provided. The database URL must use the session pooler, port 5432, never 6543.
3. Turn on agent computers. As root:
   sudo ./deploy/scripts/setup-computers.sh
   It picks a microVM when /dev/kvm exists, otherwise gVisor. Paste the lines it prints into deploy/.env.production. They set COMPUTER_BACKEND and:
   SAYABOT_APP_SERVICES="orchestrator web computerd egress"
   Then, as the deploy user: ./deploy/deploy.sh
4. Open https://DOMAIN and create the first account. Connect a model under AI accounts. To share one model with every user, set SAYA_AI_* in deploy/.env.production and run ./deploy/deploy.sh reload.

Verify each item and report pass or fail. Do not print SAYABOT_KEK, database passwords, or API keys.
- curl -fsS https://DOMAIN/api/health returns JSON with "ok": true and "service": "sayabot-web"
- curl -fsS https://DOMAIN/api/instance returns "sayabot": true and "edition": "self-hosted", plus the server name
- ./deploy/deploy.sh status shows web, orchestrator, and nginx healthy. After the computer step, computerd and egress are healthy too.
- deploy/.env.production is mode 600 and SAYABOT_KEK is non-empty
- DATABASE_URL contains :5432 and does not contain :6543
- https://DOMAIN/login renders
- After a model is connected, a room accepts a message and an agent turn starts
- A tool marked dangerous pauses for a human yes and does not run on its own
- The canvas socket at wss://DOMAIN/collab accepts a WebSocket upgrade
- MCP is reachable at https://DOMAIN/api/v1/mcp
- The Mac and phone apps can read this server from https://DOMAIN/api/instance before anyone signs in
- When the database is bundled, ./deploy/deploy.sh backup writes a dump under deploy/backups

Never change SAYABOT_KEK after it is written. Losing it makes every saved key unreadable. Copy deploy/.env.production off the server.

Day to day
- git pull && ./deploy/deploy.sh
- ./deploy/deploy.sh status
- ./deploy/deploy.sh logs web
- ./deploy/deploy.sh rollback

If a check fails, read docs/self-hosting-quickstart.md and deploy/README.md in the clone. Do not open the orchestrator's /internal API, do not weaken TLS, and do not commit deploy/.env.production.`

export const PROMPT_CLIENTS = ["Cursor", "Claude", "Codex", "Gemini"] as const

/** What a clone on a VPS actually does, checked against install.sh, deploy.sh, and compose. */
export const SELF_HOST_FEATURES: {
  feature: string
  state: "Ready" | "Extra step" | "Off"
  detail: string
}[] = [
  {
    feature: "Web workspace, rooms, schedules, memory",
    state: "Ready",
    detail: "Started by ./deploy/install.sh together with nginx and the orchestrator.",
  },
  {
    feature: "Sign-in on this server",
    state: "Ready",
    detail:
      "Bundled Supabase serves Postgres, auth, realtime, and file storage on your domain. Email delivery and Google or GitHub sign-in need SMTP or OAuth settings.",
  },
  {
    feature: "Turns, canvas, MCP, approval gates",
    state: "Ready",
    detail:
      "Turns use the room lock. Canvas is wss://DOMAIN/collab. MCP is https://DOMAIN/api/v1/mcp. Dangerous tools wait for a yes.",
  },
  {
    feature: "Sealed secrets",
    state: "Ready",
    detail:
      "install.sh generates SAYABOT_KEK. Saved keys are encrypted with it. The file must stay mode 600, and the key must never change.",
  },
  {
    feature: "Mac and phone apps",
    state: "Ready",
    detail:
      "Point them at https://DOMAIN. They read /api/instance first and show your server's name.",
  },
  {
    feature: "Agent computers and egress",
    state: "Extra step",
    detail:
      "Default services are orchestrator and web. Run setup-computers.sh, set SAYABOT_APP_SERVICES to include computerd and egress, then deploy again.",
  },
  {
    feature: "A model for the agents",
    state: "Extra step",
    detail:
      "Add a provider under AI accounts, or set SAYA_AI_* and run ./deploy/deploy.sh reload.",
  },
  {
    feature: "Plans, limits, and billing",
    state: "Off",
    detail: "Those exist only when SAYABOT_EDITION=cloud. A server you host does not run them.",
  },
]
