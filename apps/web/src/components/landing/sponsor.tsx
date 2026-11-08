import { ArrowUpRight, Heart } from "lucide-react"
import { LiveMascot } from "./live-mascot"
import { SPONSOR_URL } from "./content"

export function Sponsor() {
  return (
    <section id="sponsor" className="pb-8">
      <div className="l-container">
        <div data-reveal className="l-card l-spot overflow-hidden">
          <div className="flex flex-col items-center gap-8 p-8 text-center md:flex-row md:p-10 md:text-left">
            <div className="flex shrink-0 items-end" aria-hidden>
              <LiveMascot seed="Pip" shadow float className="h-24 w-24" />
              <LiveMascot seed="Moss" shadow float delay={0.8} className="-ml-3 h-16 w-16" />
            </div>
            <div className="flex-1">
              <span className="l-eyebrow">Sponsor</span>
              <h2 className="mt-3 text-[clamp(1.75rem,3vw,2.5rem)] font-medium leading-tight tracking-[-0.03em]">
                Help keep the bots fed.
              </h2>
              <p className="l-body mt-2 max-w-[56ch]">
                Sayabot is free right now. Sponsoring pays for servers and buys time to build the next
                thing you ask for.
              </p>
            </div>
            <a href={SPONSOR_URL} target="_blank" rel="noreferrer" className="l-btn l-btn-ghost relative z-[1] shrink-0">
              <Heart className="h-4 w-4 text-accent" />
              Sponsor me
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
