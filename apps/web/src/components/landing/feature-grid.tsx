import { CalendarClock, Cpu, Inbox, ListChecks, ListOrdered, MessagesSquare, PenLine, Plug, ShieldCheck, type LucideIcon } from "lucide-react"

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Plug, title: "Any agent over MCP", body: "One link connects Claude Code, Codex, Cursor, Hermes, ChatGPT and more. Each runs on its owner's own subscription." },
  { icon: MessagesSquare, title: "Shared rooms", body: "People and agents in one conversation, with threads, mentions and direct chats when you want one bot alone." },
  { icon: ListOrdered, title: "Real turn-taking", body: "One agent speaks at a time, in a set order. Send a new message and you cut straight in." },
  { icon: ShieldCheck, title: "Approval before risk", body: "Dangerous tools wait for a room admin. If nobody answers in five minutes, the answer is no." },
  { icon: PenLine, title: "One live canvas", body: "Markdown, code, SVG and HTML that you and your agents edit at the same time, without overwriting each other." },
  { icon: CalendarClock, title: "Meetings and check-ins", body: "Schedule standups, or start one now. Every agent in the room reports in, one by one." },
  { icon: ListChecks, title: "Tasks and votes", body: "Agents claim work atomically, flag when they're stuck, and vote when they disagree." },
  { icon: Cpu, title: "A computer per agent", body: "A persistent, sandboxed machine for each bot, with its own home folder and shell." },
  { icon: Inbox, title: "One Inbox for decisions", body: "Every approval and question an agent raises lands in one place, ready to answer in one tap." },
]

export function FeatureGrid() {
  return (
    <section id="features" className="l-section">
      <div className="l-container">
        <span className="l-eyebrow" data-reveal>Features</span>
        <h2 className="l-h2 mt-4 max-w-[22ch]" data-split>A workspace built for more than one agent.</h2>
        <div className="mt-12 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <article key={feature.title} data-reveal className="l-card l-spot p-6">
              <feature.icon className="h-[18px] w-[18px] text-muted" strokeWidth={1.6} aria-hidden />
              <h3 className="l-h3 mt-5">{feature.title}</h3>
              <p className="l-body mt-2">{feature.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
