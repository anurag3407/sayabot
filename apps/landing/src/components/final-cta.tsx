"use client"

import { useRef } from "react"
import { SAYA_INK, sayaGeometry } from "@sayabot/core/mascot"
import { LINKS } from "@/lib/links"
import { useInView, useLookAt } from "@/lib/motion"
import { DownloadButton } from "./download-button"
import { ArrowRight } from "./icons"

const ghost = sayaGeometry("ghost", "idle")

/** "Meet your first agent": Saya draws itself in outline, fills in, then watches the pointer. */
export function FinalCta() {
  const box = useRef<HTMLDivElement>(null)
  const eyes = useRef<SVGSVGElement>(null)
  const on = useInView(box, { once: true })
  useLookAt(eyes)
  const { x, y, w, h, r } = ghost.visor

  return (
    <section className="section final" aria-labelledby="final-title">
      <div className="wrap head-center" ref={box}>
        <h2 className="h2 final-title" id="final-title">
          Meet your first agent.
        </h2>
        <p className="lede">
          Free and open source. Start with one agent and one useful job; add more when it earns it.
        </p>
        <div className="final-ctas">
          <DownloadButton align="center" />
          <a className="btn btn-ghost" href={LINKS.app}>
            Open the web app <ArrowRight className="arrow" />
          </a>
        </div>

        <div className={`final-art ${on ? "is-on" : ""}`} aria-hidden>
          <svg viewBox="0 0 100 100" ref={eyes} className="final-svg">
            <path className="final-saaya" d={ghost.shell} transform="translate(0 6)" />
            <path className="final-fill" d={ghost.shell} />
            <path className="final-line" d={ghost.shell} pathLength={1} />
            <rect className="final-visor" x={x} y={y} width={w} height={h} rx={r} fill={SAYA_INK} />
            <g className="final-eyes">
              <g className="saya-look">
                {ghost.eyesFill ? <path d={ghost.eyesFill} fill="#ece8ff" /> : null}
              </g>
            </g>
          </svg>
        </div>
      </div>
    </section>
  )
}
