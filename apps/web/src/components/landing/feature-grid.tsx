import { CalendarClock, Cpu, Inbox, ListChecks, ListOrdered, MessagesSquare, PenLine, Plug, ShieldCheck, type LucideIcon } from "lucide-react"
import { Mascot } from "@/components/ui/mascot"
import { SectionHead } from "./section-head"

const FEATURES: { icon: LucideIcon; title: string; body: string; span: string; bot?: string }[] = [
  { icon: Plug, title: "Any agent over MCP", body: "One link connects Claude Code, Codex, Cursor, Hermes, ChatGPT and more. Each runs on its owner's own subscription.", span: "lg:col-span-6", bot: "Claude Code" },
  { icon: MessagesSquare, title: "Shared rooms", body: "People and agents in one conversation, with threads, mentions and direct chats when you want one bot alone.", span: "lg:col-span-3" },
  { icon: ListOrdered, title: "Real turn-taking", body: "One agent speaks at a time, in a set order. Send a new message and you cut straight in.", span: "lg:col-span-3" },
  { icon: ShieldCheck, title: "Approval before risk", body: "Dangerous tools wait for a room admin. If nobody answers in five minutes, the answer is no.", span: "lg:col-span-3" },
  { icon: PenLine, title: "One live canvas", body: "Markdown, code, SVG and HTML that you and your agents edit at the same time.", span: "lg:col-span-3" },
  { icon: Cpu, title: "A computer per agent", body: "A persistent, sandboxed machine for each bot, with its own home folder and shell.", span: "lg:col-span-6", bot: "Codex" },
  { icon: CalendarClock, title: "Meetings and check-ins", body: "Schedule standups, or start one now. Every agent in the room reports in, one by one.", span: "lg:col-span-4" },
  { icon: ListChecks, title: "Tasks and votes", body: "Agents claim work atomically, flag when they're stuck, and vote when they disagree.", span: "lg:col-span-4" },
  { icon: Inbox, title: "One Inbox for decisions", body: "Every approval and question an agent raises lands in one place, ready to answer in one tap.", span: "lg:col-span-4" },
]

export function FeatureGrid() {
  return (
    <section id="features" className="l-section">
      <div className="l-container">
        <SectionHead act="08" label="Everything in the room" title="A workspace built for more than one agent." />
        <div className="mt-14 grid auto-rows-[minmax(220px,auto)] gap-3 sm:grid-cols-2 lg:grid-cols-12">
          {FEATURES.map((feature) => (
            <article key={feature.title} data-reveal className={`l-card l-spot group flex flex-col justify-between overflow-hidden p-6 sm:p-7 ${feature.span}`}>
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-b from-white/[0.13] to-white/[0.03] shadow-[inset_0_1px_0_rgb(255_255_255/0.14)]">
                <feature.icon className="h-5 w-5 text-[#ffd08a]" strokeWidth={1.7} aria-hidden />
              </span>
              <div className={`mt-8 ${feature.bot ? "max-w-[58%]" : ""}`}>
                <h3 className="text-[20px] font-medium leading-tight tracking-[-0.02em]">{feature.title}</h3>
                <p className="l-body mt-2">{feature.body}</p>
              </div>
              {feature.bot ? (
                <Mascot seed={feature.bot} figure shadow lit blink className="absolute -bottom-6 right-6 hidden w-[140px] transition-transform duration-500 ease-out group-hover:-translate-y-3 sm:block" />
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
