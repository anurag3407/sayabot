"use client"

import Link from "next/link"
import { useEffect, useRef, useState, type CSSProperties } from "react"
import { animate, createAnimatable, createDraggable, createTimeline, onScroll, spring, splitText, stagger } from "animejs"
import { ArrowRight } from "lucide-react"
import { GITHUB_URL } from "./content"
import { GitHubIcon } from "./brand-icons"
import { LiveMascot, useInView } from "./live-mascot"
import { afterFonts, useAnime } from "./motion"

/** Left to right across the floor. Bigger and lower means closer to you. */
const CAST = [
  { seed: "Codex", x: "12%", s: "clamp(84px, min(10.5vw, 17svh), 160px)", b: "74px", line: "14 tests passing." },
  { seed: "Claude Code", x: "30%", s: "clamp(96px, min(12vw, 20svh), 184px)", b: "58px", line: "Patch is ready." },
  { seed: "Saya", x: "50%", s: "clamp(116px, min(14vw, 24svh), 216px)", b: "42px", line: "One at a time, everyone." },
  { seed: "Hermes", x: "70%", s: "clamp(96px, min(12vw, 20svh), 184px)", b: "58px", line: "This one needs a human." },
  { seed: "Cursor", x: "88%", s: "clamp(84px, min(10.5vw, 17svh), 160px)", b: "74px", line: "Canvas is updated." },
]

export function Hero() {
  const root = useRef<HTMLElement>(null)
  const inView = useInView(root)
  const [turn, setTurn] = useState(2)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    if (!inView || !started) return
    const timer = window.setTimeout(() => setTurn((value) => (value + 1) % CAST.length), 2400)
    return () => window.clearTimeout(timer)
  }, [inView, started, turn])

  // Whoever receives the turn gives a small hop.
  useEffect(() => {
    if (!started) return
    const element = root.current?.querySelectorAll<HTMLElement>(".he-hop")[turn]
    if (element) hop(element)
  }, [turn, started])

  useAnime(root, ({ all, fine, scope }) => {
    const intro = all(".he-intro")
    const hops = all(".he-hop")
    const cone = all(".he-cone")
    let split: ReturnType<typeof splitText> | undefined

    const stopFonts = afterFonts(scope, () => {
      intro.forEach((element) => {
        element.style.animation = "none"
        element.style.opacity = "1"
      })
      split = splitText(all(".he-title")[0]!, { lines: { wrap: "clip" }, words: { class: "l-split-word" } })
      let played = false
      split.addEffect(({ words }: { words: HTMLElement[] }) => {
        if (played || !words.length) return
        played = true
        createTimeline({ defaults: { ease: "out(4)" } })
        .set(hops, { translateY: "-140vh" })
        .add(cone, { opacity: [0, 1, 0.15, 1, 0.5, 1], duration: 900, ease: "linear" }, 120)
        .add(all(".he-floor"), { opacity: [0, 1], duration: 900 }, 300)
        .add(all(".he-chip"), { opacity: [0, 1], translateY: [14, 0], duration: 700 }, 420)
        .add(words, { translateY: ["112%", "0%"], duration: 1100, delay: stagger(56) }, 480)
        .add(all(".he-sub, .he-cta"), { opacity: [0, 1], translateY: [22, 0], duration: 850, delay: stagger(90) }, 900)
        .add(hops, { translateY: 0, ease: spring({ bounce: 0.46, duration: 620 }), delay: stagger(95, { from: "center" }) }, 720)
        .call(() => setStarted(true), 1750)
      })
    })

    // Leaving the hero: the camera pushes into the room.
    createTimeline({
      defaults: { ease: "linear" },
      autoplay: onScroll({ target: root.current!, enter: "top top", leave: "bottom top", sync: true }),
    })
      .add(all(".he-copy"), { translateY: [0, -140], opacity: [1, 0], duration: 600 }, 0)
      .add(all(".he-cast"), { scale: [1, 1.34], translateY: [0, 60], duration: 1000 }, 0)
      .add(cone, { scale: [1, 1.2], duration: 1000 }, 0)

    if (fine) {
      const castLayer = createAnimatable(all(".he-parallax")[0]!, { x: 700, y: 700, ease: "out(3)" })
      const coneLayer = createAnimatable(cone[0]!, { skewX: 900, ease: "out(3)" })
      const onMove = (event: PointerEvent) => {
        const dx = event.clientX / window.innerWidth - 0.5
        const dy = event.clientY / window.innerHeight - 0.5
        ;(castLayer.x as unknown as (v: number) => void)(dx * -22)
        ;(castLayer.y as unknown as (v: number) => void)(dy * -8)
        ;(coneLayer.skewX as unknown as (v: number) => void)(dx * -7)
      }
      window.addEventListener("pointermove", onMove, { passive: true })

      // Grab a bot and pull: it stretches on a rubber band and springs home.
      const drags = all(".he-fig").map((element) =>
        createDraggable(element, {
          container: [0, 0, 0, 0],
          containerFriction: 0.72,
          releaseContainerFriction: 1,
          releaseStiffness: 190,
          releaseDamping: 13,
        }),
      )
      return () => {
        window.removeEventListener("pointermove", onMove)
        drags.forEach((drag) => drag.revert())
        stopFonts()
        split?.revert()
      }
    }
    return () => {
      stopFonts()
      split?.revert()
    }
  })

  return (
    <section ref={root} className="he-stage l-grain" aria-labelledby="hero-title">
      <div className="he-cone he-intro" aria-hidden />
      <div className="l-dots absolute inset-0" aria-hidden />
      <div className="he-floor he-intro" aria-hidden />
      <div className="he-bulb" aria-hidden />

      <div className="he-copy relative z-[2] pt-[92px] text-center sm:pt-[100px]">
        <div className="l-container">
          <a href="#mcp" className="he-chip he-intro l-chip transition-colors hover:text-text">
            <span className="h-2 w-2 rounded-full bg-[#ffd08a] shadow-[0_0_10px_#ffd08a]" />
            ANY AGENT. ONE MCP LINK.
          </a>
          <h1 id="hero-title" className="he-title he-intro l-display mx-auto mt-5 !text-[clamp(3.25rem,min(8.4vw,14.5svh),8.5rem)]">
            Every agent you use, <br className="hidden sm:block" />
            working in <span className="text-accent">one room.</span>
          </h1>
          <p className="he-sub he-intro l-lead mx-auto mt-5 max-w-[60ch]">
            They share rooms with your team, take turns, get their own computers, and stop to ask you before anything
            risky.
          </p>
          <div className="he-cta he-intro mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup" className="l-btn l-btn-primary">
              Get started free <ArrowRight className="h-4 w-4" />
            </Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="l-btn l-btn-ghost">
              <GitHubIcon className="h-4 w-4" /> Star on GitHub
            </a>
          </div>
        </div>
      </div>

      <div className="he-cast relative z-[1] min-h-[clamp(300px,42svh,440px)] flex-1 origin-bottom">
        <div className="he-parallax absolute inset-0">
          {CAST.map((bot, index) => (
            <div
              key={bot.seed}
              className={`he-slot ${index === 0 || index === 4 ? "hidden sm:block" : ""}`}
              style={{ "--x": bot.x, "--s": bot.s, "--b": bot.b } as CSSProperties}
            >
              <div className="he-fig">
                <div className="he-hop he-intro" onClick={(event) => hop(event.currentTarget)}>
                  <LiveMascot seed={bot.seed} figure shadow lit={turn === index} delay={index * 0.7} className="block w-full" />
                  <span className="he-bubble" data-on={started && turn === index}>{bot.line}</span>
                </div>
                <span className="he-tag">{bot.seed}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function hop(element: HTMLElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
  animate(element, {
    translateY: [{ to: -26, duration: 190, ease: "out(3)" }, { to: 0, ease: spring({ bounce: 0.55, duration: 420 }) }],
    scaleY: [{ to: 1.05, duration: 190 }, { to: 1, duration: 340 }],
  })
}
