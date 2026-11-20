import type { Metadata } from "next"
import { AgentPrompt } from "@/components/agent-prompt"
import { CopyButton } from "@/components/copy-button"
import { Footer } from "@/components/footer"
import { Nav } from "@/components/nav"
import { LINKS } from "@/lib/links"
import { AGENT_SETUP_PROMPT, SELF_HOST_FEATURES } from "@/lib/self-host-prompt"

export const metadata: Metadata = {
  title: "Self-host",
  description:
    "Set Sayabot up with Cursor, Claude, Codex, or Gemini. The prompt installs a clone on your VPS. This page shows what comes up, the four steps, and the checks.",
  alternates: { canonical: "https://sayabot.tech/self-host" },
}

const STEPS = [
  {
    n: "01",
    title: "Prepare the server",
    body: "Ubuntu 22.04 or 24.04, or Debian 12. Two vCPU, 4 GB RAM, 40 GB disk. Point a domain at the machine, or have a Cloudflare Tunnel token ready.",
    code: `scp deploy/scripts/setup-vps.sh root@YOUR_IP:/root/
ssh root@YOUR_IP 'bash /root/setup-vps.sh --user deploy --ssh-key "$(cat ~/.ssh/id_ed25519.pub)"'`,
    note: "Confirm ssh deploy@YOUR_IP works before you close the root session. The script turns off password login.",
  },
  {
    n: "02",
    title: "Clone and install",
    body: "The installer writes deploy/.env.production, generates every secret, gets a certificate or uses your tunnel, and starts Sayabot. Re-running it keeps SAYABOT_KEK.",
    code: `git clone https://github.com/anurag3407/sayabot.git ~/sayabot && cd ~/sayabot
./deploy/install.sh`,
    note: "Choose “Everything on this server” unless you already have a Supabase project. The database URL must use port 5432.",
  },
  {
    n: "03",
    title: "Turn on agent computers",
    body: "The first install starts the web app and the orchestrator. Computers and the outbound proxy are a second step, because the computer image is heavy.",
    code: `sudo ./deploy/scripts/setup-computers.sh
# paste the lines it prints into deploy/.env.production, including:
# SAYABOT_APP_SERVICES="orchestrator web computerd egress"
./deploy/deploy.sh`,
    note: "A host with /dev/kvm gets a microVM per agent. Any other VPS gets gVisor. A tiny machine can use a cloud computer with COMPUTER_BACKEND=e2b instead.",
  },
  {
    n: "04",
    title: "Open it and connect a model",
    body: "Create the first account at your domain. Sayabot's own agents need a model before a turn can run. Add one under AI accounts, or set SAYA_AI_* for everyone on the server.",
    code: `./deploy/deploy.sh reload    # after SAYA_AI_* changes
./deploy/deploy.sh status
./deploy/deploy.sh backup     # bundled database`,
    note: "Mac and phone: open https://YOUR_DOMAIN/download, or choose your server in the app. The apps check /api/instance and show your server's name.",
  },
]

const CHECKS = [
  {
    label: "Health",
    text: "curl -fsS https://DOMAIN/api/health returns ok: true and service: sayabot-web.",
  },
  {
    label: "This server",
    text: "curl -fsS https://DOMAIN/api/instance returns sayabot: true and edition: self-hosted.",
  },
  {
    label: "Containers",
    text: "./deploy/deploy.sh status shows web, orchestrator, and nginx healthy. After step 03, computerd and egress too.",
  },
  {
    label: "Secrets",
    text: "deploy/.env.production is mode 600. DATABASE_URL uses port 5432. SAYABOT_KEK is set, and never printed or changed.",
  },
  {
    label: "A turn",
    text: "The login page renders. A room starts a turn once a model is connected.",
  },
  {
    label: "A yes",
    text: "A dangerous tool pauses for approval. The canvas socket upgrades at /collab.",
  },
  {
    label: "MCP",
    text: "https://DOMAIN/api/v1/mcp answers. A bundled database backup lands in deploy/backups.",
  },
  {
    label: "Day to day",
    text: "git pull && ./deploy/deploy.sh, then status, logs, backup, and rollback.",
  },
]

const JUMP = [
  { href: "#comes-up", label: "What comes up" },
  { href: "#install", label: "Install" },
  { href: "#checks", label: "Checks" },
  { href: "#prompt", label: "The prompt" },
]

export default function SelfHostPage() {
  return (
    <>
      <Nav />
      <main className="guide">
        <section className="guide-hero" aria-labelledby="guide-title">
          <div className="guide-glow" aria-hidden />
          <div className="wrap guide-hero-inner">
            <span className="eyebrow">Self-host guide</span>
            <h1 id="guide-title">Set Sayabot up with your agent.</h1>
            <p className="lede">
              Cursor, Claude, Codex, and Gemini install it for you. Paste the prompt into one of
              them. They clone the repo, run the installer, and check that your server answers.
              Sayabot&apos;s own agents live on that server after it is up.
            </p>
            <AgentPrompt />
            <p className="prompt-hint">
              Copies the setup prompt. Your agent installs Sayabot. It does not sign in as a
              Sayabot agent.
            </p>
            <nav className="guide-jump" aria-label="On this page">
              {JUMP.map((item) => (
                <a key={item.href} href={item.href}>
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        </section>

        <section className="guide-block" id="comes-up" aria-labelledby="works-title">
          <div className="wrap">
            <div className="head-center">
              <span className="eyebrow">On a VPS clone</span>
              <h2 className="guide-h" id="works-title">
                What actually comes up
              </h2>
              <p className="lede">
                Checked against the installer and the compose files. Ready means the first install
                starts it. Extra step means the server runs without it until you add that setting.
              </p>
            </div>
            <ul className="guide-features">
              {SELF_HOST_FEATURES.map((row) => (
                <li key={row.feature} className="card guide-feature">
                  <span
                    className={`guide-state guide-state-${row.state.replace(" ", "-").toLowerCase()}`}
                  >
                    {row.state}
                  </span>
                  <h3>{row.feature}</h3>
                  <p>{row.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="guide-block" id="install" aria-labelledby="steps-title">
          <div className="wrap">
            <div className="head-center">
              <span className="eyebrow">Four steps</span>
              <h2 className="guide-h" id="steps-title">
                Install
              </h2>
              <p className="lede">
                The same commands the copied prompt tells your agent to run. You can run them
                yourself.
              </p>
            </div>
            <ol className="guide-steps">
              {STEPS.map((step) => (
                <li key={step.n} className="card guide-step">
                  <div className="guide-step-top">
                    <span className="guide-n">{step.n}</span>
                    <h3>{step.title}</h3>
                  </div>
                  <p>{step.body}</p>
                  <div className="guide-term">
                    <div className="guide-term-bar">
                      <span className="guide-dots" aria-hidden>
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="guide-term-title">terminal</span>
                      <CopyButton text={step.code} label="Copy" title="Copy command" />
                    </div>
                    <pre className="mono">{step.code}</pre>
                  </div>
                  <p className="guide-note">{step.note}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="guide-block" id="checks" aria-labelledby="check-title">
          <div className="wrap">
            <div className="head-center">
              <span className="eyebrow">After it boots</span>
              <h2 className="guide-h" id="check-title">
                Checks your agent should run
              </h2>
              <p className="lede">
                Each line is a pass or a fail. The prompt asks for a report, and it tells the agent
                not to print keys.
              </p>
            </div>
            <ul className="guide-checks">
              {CHECKS.map((item) => (
                <li key={item.label} className="card">
                  <strong>{item.label}</strong>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="guide-block" id="prompt" aria-labelledby="prompt-title">
          <div className="wrap guide-prompt-wrap">
            <div className="head-center">
              <span className="eyebrow">Hand this over</span>
              <h2 className="guide-h" id="prompt-title">
                The prompt
              </h2>
              <p className="lede">
                Same text the button copies. Paste it into Cursor, Claude, Codex, or Gemini on the
                machine that will run Sayabot.
              </p>
            </div>
            <div className="guide-term guide-term-tall">
              <div className="guide-term-bar">
                <span className="guide-dots" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <span className="guide-term-title">setup-prompt.txt</span>
                <CopyButton
                  text={AGENT_SETUP_PROMPT}
                  label="Copy prompt"
                  title="Copy setup prompt"
                />
              </div>
              <pre className="guide-prompt mono">{AGENT_SETUP_PROMPT}</pre>
            </div>
            <p className="guide-foot">
              Longer manuals live in the repository:{" "}
              <a className="link" href={LINKS.selfHostDocs}>
                the full self-hosting guide
              </a>{" "}
              and{" "}
              <a className="link" href={LINKS.selfHostQuickstart}>
                the ten-minute quickstart
              </a>
              .
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
