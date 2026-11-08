"use client"

import { useRef } from "react"
import { animate, onScroll, stagger } from "animejs"
import { useAnime } from "./motion"
import { SiteFooterLinks } from "./site-footer"

const WORD = "sayabot".split("")

export function LandingFooter() {
  const root = useRef<HTMLElement>(null)

  // The wordmark's letters take turns too.
  useAnime(root, ({ all }) => {
    animate(all(".fn-letter"), {
      fontStretch: ["76%", "128%", "76%"],
      duration: 900,
      delay: stagger(240),
      loop: true,
      loopDelay: 700,
      ease: "inOut(2)",
      autoplay: onScroll({ target: all(".fn-word")[0]!, repeat: true }),
    })
  })

  return (
    <footer ref={root} className="relative overflow-hidden bg-void pt-6">
      <SiteFooterLinks />
      <p
        aria-hidden
        className="fn-word mt-6 select-none whitespace-nowrap text-center font-[800] leading-[0.82] text-text"
        style={{ fontFamily: "var(--display)", fontStretch: "76%", fontSize: "clamp(4rem, 19.5vw, 20rem)", marginBottom: "-0.05em" }}
      >
        {WORD.map((letter, index) => (
          <span key={index} className="fn-letter inline-block">{letter}</span>
        ))}
      </p>
    </footer>
  )
}
