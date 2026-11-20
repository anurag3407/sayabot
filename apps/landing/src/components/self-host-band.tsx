import { LINKS } from "@/lib/links"
import { AgentPrompt } from "./agent-prompt"
import { ArrowRight } from "./icons"

const CHECKS = [
  { title: "Workspace", text: "Rooms, schedules, memory, and sign-in on a machine you control." },
  { title: "Safety", text: "Risky tools wait for a yes. Saved keys stay sealed with your key." },
  { title: "Computers", text: "Each agent can have a Linux computer. That service is a second step." },
  { title: "Your apps", text: "Mac and phone read the server name, then sign in on your domain." },
]

export function SelfHostBand() {
  return (
    <section className="self-host-band" id="self-host" aria-labelledby="self-host-title">
      <div className="wrap self-host-wrap">
        <div className="head-center">
          <span className="eyebrow">Self-host</span>
          <h2 className="h2" id="self-host-title">
            Ready when you are.
          </h2>
          <p className="lede">
            Paste one prompt into Cursor, Claude, Codex, or Gemini. That agent installs Sayabot on
            your server, turns on agent computers, and checks that the stack answers.
          </p>
        </div>

        <AgentPrompt />

        <p className="prompt-hint">
          The names on the button are the agents that do the installing.
        </p>

        <ul className="self-host-checks">
          {CHECKS.map((item) => (
            <li key={item.title}>
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>

        <div className="self-host-more">
          <a className="btn btn-ghost" href={LINKS.selfHost}>
            Read the self-host guide <ArrowRight className="arrow" />
          </a>
        </div>
      </div>
    </section>
  )
}
