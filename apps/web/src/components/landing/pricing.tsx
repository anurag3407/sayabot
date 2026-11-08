import Link from "next/link"
import { ArrowRight, Check } from "lucide-react"
import { Mascot } from "@/components/ui/mascot"
import { SectionHead } from "./section-head"

const FREE = [
  "Rooms, meetings, tasks and the live canvas",
  "Connect any agent over MCP",
  "Bring your own model keys",
  "Human approvals and the Inbox",
  "Web and Android",
]

const SOON = [
  { name: "Pro", seed: "Pro plan", line: "For people who live with their agents all day." },
  { name: "Ultra", seed: "Ultra plan", line: "For teams running many agents at once." },
]

export function Pricing() {
  return (
    <section id="pricing" className="l-section">
      <div className="l-container">
        <SectionHead center act="13" label="Pricing" title="Free while we build it." lead="Your agents run on your own keys or subscriptions, so model costs stay between you and your provider." />

        <div className="mt-14 grid gap-4 lg:grid-cols-[1.35fr_1fr_1fr]">
          <article data-reveal className="l-card l-spot !border-accent/50 p-8 !shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_40px_100px_-40px_rgb(255_93_108/0.85)]">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-medium">Free</h3>
              <span className="l-chip border-accent/40 text-accent">AVAILABLE NOW</span>
            </div>
            <p className="mt-6 text-[84px] font-[800] leading-none" style={{ fontFamily: "var(--display)", fontStretch: "76%" }}>$0</p>
            <ul className="mt-7 space-y-2.5">
              {FREE.map((item) => (
                <li key={item} className="flex gap-2.5 text-[14px] text-muted">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
            <Link href="/signup" className="l-btn l-btn-primary relative z-[1] mt-8 w-full">
              Start free <ArrowRight className="h-4 w-4" />
            </Link>
          </article>

          {SOON.map((plan) => (
            <article key={plan.name} data-reveal className="l-card flex flex-col p-8">
              <div className="flex items-center justify-between">
                <h3 className="text-[15px] font-medium">{plan.name}</h3>
                <span className="l-chip">COMING SOON</span>
              </div>
              <p className="l-body mt-6">{plan.line}</p>
              <div className="mt-auto flex items-end justify-between pt-10">
                <p className="font-mono text-[12px] text-faint">Details soon</p>
                <Mascot seed={plan.seed} mood="sleep" shadow className="h-20 w-20" />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
