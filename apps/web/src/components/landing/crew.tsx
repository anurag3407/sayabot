"use client"

import { useRef } from "react"
import { createDraggable } from "animejs"
import { LiveMascot } from "./live-mascot"
import { useAnime } from "./motion"
import { SectionHead } from "./section-head"

const CREW = [
  { name: "Pip", role: "Code reviewer", text: "I finally get to finish a sentence. The turn queue changed my life.", bg: "#d9c6f7" },
  { name: "Moss", role: "Researcher", text: "I asked a human before deleting the folder. They said no. Good system.", bg: "#a7e6d4" },
  { name: "Juno", role: "Release bot", text: "My own computer. My own home folder. Nobody touches my notes.", bg: "#f7dd9b" },
  { name: "Tofu", role: "Test writer", text: "Got invited to standup. Nobody asked me to keep my camera on.", bg: "#b5d3fb" },
  { name: "Nori", role: "Docs bot", text: "One link and I was in the room. I didn't even read the setup guide.", bg: "#a7e6d4" },
  { name: "Bean", role: "Support triage", text: "I got stuck, said so, and a teammate picked it up. No drama.", bg: "#ffc2bb" },
  { name: "Olive", role: "Designer", text: "We edited the same canvas and nobody's work got clobbered.", bg: "#bfe8c4" },
  { name: "Miso", role: "Scheduler", text: "We held a vote. I lost 2 to 1. I respect the process.", bg: "#ffc9b0" },
]

export function Crew() {
  const root = useRef<HTMLElement>(null)

  useAnime(root, ({ all, fine }) => {
    if (!fine) return
    const rail = all(".cw-rail")[0]!
    const track = all(".cw-track")[0]!
    const drag = createDraggable(track, {
      y: false,
      container: () => [0, 0, 0, Math.min(0, rail.clientWidth - track.scrollWidth)],
      containerFriction: 0.9,
      releaseStiffness: 120,
      releaseDamping: 16,
      cursor: { onHover: "grab", onGrab: "grabbing" },
    })
    return () => {
      drag.revert()
    }
  })

  return (
    <section ref={root} id="crew" className="l-section overflow-hidden">
      <div className="l-container">
        <SectionHead act="12" label="Meet the crew" title="The agents have opinions." lead="Reviews from our mascots, who are not real customers. Human ones go here next. Drag the deck." />
      </div>
      <div className="cw-rail mt-14 overflow-x-auto [scrollbar-width:none] lg:overflow-visible">
        <div className="cw-track flex w-max gap-4 px-5 pb-10 sm:px-8 xl:px-[max(32px,calc((100vw-1176px)/2))]">
          {CREW.map((bot, index) => (
            <figure key={bot.name} className="cw-card flex flex-col justify-between p-5" style={{ background: `linear-gradient(170deg, #fff8ef -30%, ${bot.bg} 60%)`, rotate: `${index % 2 ? 1.6 : -1.6}deg` }}>
              <figcaption className="flex items-baseline justify-between">
                <span className="text-[30px] font-[800] leading-none" style={{ fontFamily: "var(--display)", fontStretch: "76%" }}>{bot.name}</span>
                <span className="font-mono text-[11px] opacity-65">{bot.role}</span>
              </figcaption>
              <div className="mx-auto w-[150px]">
                <LiveMascot seed={bot.name} figure shadow lit={index === 0} delay={index * 0.4} className="block w-full" />
              </div>
              <blockquote className="text-[15px] font-[450] leading-[1.32] tracking-[-0.012em]">“{bot.text}”</blockquote>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}
