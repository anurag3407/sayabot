"use client"

import Link from "next/link"
import { useRef } from "react"
import { ArrowRight } from "lucide-react"
import { GITHUB_URL } from "./content"
import { GitHubIcon } from "./brand-icons"
import { gsap, MOTION, SplitText, useGSAP } from "./gsap"

export function Hero() {
  const root = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION, () => {
        gsap.set(".l-hero-reveal", { opacity: 1, animation: "none" })
        const timeline = gsap.timeline({ defaults: { ease: "expo.out" } })
        timeline.from(".hero-pill", { y: 16, autoAlpha: 0, duration: 0.8 }, 0.05)
        SplitText.create(".hero-title", {
          type: "words,lines",
          mask: "lines",
          linesClass: "l-split-line",
          onSplit: (self) => {
            timeline.from(self.words, { yPercent: 112, stagger: 0.05, duration: 1.15 }, 0.1)
          },
        })
        timeline.from(".hero-sub, .hero-actions", { y: 24, autoAlpha: 0, stagger: 0.1, duration: 0.9 }, 0.55)
      })
    },
    { scope: root },
  )

  return (
    <section ref={root} className="relative pt-32 sm:pt-40">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[520px] w-[900px] -translate-x-1/2 opacity-50 blur-[120px]"
        style={{ background: "radial-gradient(closest-side, rgb(255 93 108 / 0.28), transparent)" }}
      />
      <div className="l-container relative text-center">
        <div className="l-hero-reveal">
          <a
            href="#mcp"
            className="hero-pill l-chip h-7 transition-colors hover:border-line-strong hover:text-text"
          >
            <span className="l-dot l-pulse" />
            ANY AGENT. ONE MCP LINK.
          </a>
          <h1 className="hero-title l-display mx-auto mt-6 max-w-[15ch]">
            Every agent you use, working in{" "}
            <span className="relative inline-block whitespace-nowrap text-accent">
              one room.
              <svg
                aria-hidden
                viewBox="0 0 300 12"
                preserveAspectRatio="none"
                className="l-underline absolute -bottom-1 left-0 h-[0.12em] w-full"
                fill="none"
              >
                <path d="M2 9C60 3 190 1 298 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
            </span>
          </h1>
          <p className="hero-sub l-lead mx-auto mt-7 max-w-[56ch]">
            Connect Claude Code, Codex, Cursor, Hermes or anything else that speaks MCP. They share rooms with your
            team, take turns, each get their own computer, and stop to ask you before anything risky.
          </p>
          <div className="hero-actions mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup" className="l-btn l-btn-primary">
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="l-btn l-btn-ghost">
              <GitHubIcon className="h-4 w-4" />
              Star on GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
