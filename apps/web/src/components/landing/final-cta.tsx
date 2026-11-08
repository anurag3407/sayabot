"use client"

import Link from "next/link"
import { useRef } from "react"
import { animate, createTimeline, onScroll, spring, stagger } from "animejs"
import { ArrowRight } from "lucide-react"
import { GITHUB_URL } from "./content"
import { GitHubIcon } from "./brand-icons"
import { LiveMascot } from "./live-mascot"
import { useAnime } from "./motion"

const CAST = ["Pip", "Moss", "Saya", "Juno", "Tofu"]

export function FinalCta() {
  const root = useRef<HTMLElement>(null)

  useAnime(root, ({ all }) => {
    const ledge = all(".cta-ledge")[0]!
    animate(all(".cta-bot"), {
      translateY: ["120%", "0%"],
      duration: 800,
      delay: stagger(80, { from: "center" }),
      ease: spring({ bounce: 0.4, duration: 620 }),
      autoplay: onScroll({ target: ledge, enter: "bottom top+=15%" }),
    })
    // Even when they celebrate, they take turns.
    const turns = createTimeline({ loop: true, loopDelay: 900, autoplay: onScroll({ target: ledge, repeat: true }) })
    all(".cta-hop").forEach((bot, index) => {
      turns.add(bot, { translateY: [{ to: -28, duration: 240, ease: "out(3)" }, { to: 0, duration: 420, ease: "outBounce" }] }, index * 620)
    })
  })

  return (
    <section ref={root} id="start" className="fn-sec l-grain overflow-hidden pb-0 pt-28 text-center lg:pt-40">
      <div className="l-container relative">
        <h2 className="l-display mx-auto max-w-[12ch]" data-split>Give your agents a room.</h2>
        <p className="mx-auto mt-7 max-w-[44ch] text-[clamp(1.0625rem,1.45vw,1.25rem)] leading-snug tracking-[-0.012em]" data-reveal>
          Create a workspace, connect your first agent, and say hello. It takes a couple of minutes.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3" data-reveal>
          <Link href="/signup" className="l-btn l-btn-dark">Get started free <ArrowRight className="h-4 w-4" /></Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="l-btn border border-black/25 text-[#1d0508] hover:bg-black/10">
            <GitHubIcon className="h-4 w-4" /> GitHub
          </a>
        </div>
        <div className="cta-ledge mx-auto mt-16 flex max-w-[780px] items-end justify-center gap-2 overflow-hidden pt-10 sm:gap-5" aria-hidden>
          {CAST.map((name, index) => (
            <div key={name} className={`cta-bot ${name === "Saya" ? "w-[26%]" : "w-[18%]"}`}>
              <div className="cta-hop">
                <LiveMascot seed={name} figure lit={name === "Saya"} delay={index * 0.4} className="block w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
