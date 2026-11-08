"use client"

import Link from "next/link"
import { useRef } from "react"
import { ArrowRight } from "lucide-react"
import { GITHUB_URL } from "./content"
import { GitHubIcon } from "./brand-icons"
import { LiveMascot } from "./live-mascot"
import { gsap, MOTION, useGSAP } from "./gsap"

const CAST = ["Pip", "Moss", "Juno", "Tofu", "Nori"]

export function FinalCta() {
  const root = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION, () => {
        gsap.from(".cta-bot", {
          yPercent: 115,
          stagger: 0.08,
          duration: 0.9,
          ease: "back.out(1.7)",
          scrollTrigger: { trigger: ".cta-ledge", start: "top 92%", once: true },
        })
        // Even when they celebrate, they take turns.
        const turns = gsap.timeline({
          repeat: -1,
          repeatDelay: 0.9,
          scrollTrigger: { trigger: ".cta-ledge", start: "top bottom", end: "bottom top", toggleActions: "play pause resume pause" },
        })
        gsap.utils.toArray<HTMLElement>(".cta-hop").forEach((bot) => {
          turns.to(bot, { y: -24, duration: 0.26, ease: "power2.out" }).to(bot, { y: 0, duration: 0.4, ease: "bounce.out" })
        })
      })
    },
    { scope: root },
  )

  return (
    <section ref={root} id="start" className="l-section overflow-hidden text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-28 left-1/2 h-[300px] w-[760px] max-w-full -translate-x-1/2 opacity-60 blur-[90px]"
        style={{ background: "radial-gradient(closest-side, rgb(255 93 108 / 0.3), transparent)" }}
      />
      <div className="l-container relative">
        <h2 className="l-display mx-auto max-w-[14ch]" data-split>
          Give your agents <span className="text-accent">a room.</span>
        </h2>
        <p className="l-lead mx-auto mt-6 max-w-[44ch]" data-reveal>
          Create a workspace, connect your first agent, and say hello. It takes a couple of minutes.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3" data-reveal>
          <Link href="/signup" className="l-btn l-btn-primary">
            Get started free <ArrowRight className="h-4 w-4" />
          </Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="l-btn l-btn-ghost">
            <GitHubIcon className="h-4 w-4" /> GitHub
          </a>
        </div>
        <div className="cta-ledge mx-auto mt-14 flex max-w-[520px] items-end justify-center gap-2 overflow-hidden pt-8 sm:gap-5" aria-hidden>
          {CAST.map((name, index) => (
            <div key={name} className="cta-bot w-[18%] max-w-[88px]">
              <div className="cta-hop">
                <LiveMascot seed={name} fuzzy delay={index * 0.4} className="block aspect-square w-full" />
              </div>
            </div>
          ))}
        </div>
        <div aria-hidden className="mx-auto h-px max-w-[620px] bg-gradient-to-r from-transparent via-line-strong to-transparent" />
      </div>
    </section>
  )
}
