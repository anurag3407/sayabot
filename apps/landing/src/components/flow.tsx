"use client"

import { useRef, type CSSProperties } from "react"
import type { SayaShape } from "@sayabot/core/mascot"
import { useInView } from "@/lib/motion"
import { ChatIcon, GlobeIcon, LaptopIcon, PhoneIcon } from "./icons"
import { Reveal } from "./reveal"
import { Saya } from "./saya"

/** Diagram space: 1000 x 440. HTML nodes are placed in the same coordinates as percentages. */
const SOURCES = [
  { y: 70, label: "Phone", icon: PhoneIcon },
  { y: 170, label: "Mac & PC", icon: LaptopIcon },
  { y: 270, label: "Web", icon: GlobeIcon },
  { y: 370, label: "Slack · Telegram", icon: ChatIcon },
]
const COMPUTERS: { y: number; shape: SayaShape; name: string }[] = [
  { y: 110, shape: "block", name: "block" },
  { y: 220, shape: "ledger", name: "ledger" },
  { y: 330, shape: "hoot", name: "hoot" },
]
const TOOLS = [
  { y: 110, label: "GitHub" },
  { y: 220, label: "Stripe" },
  { y: 330, label: "Notion" },
]

const pct = (x: number, y: number): CSSProperties => ({
  left: `${x / 10}%`,
  top: `${(y / 440) * 100}%`,
})

function Comet({
  path,
  dur,
  begin,
  color = "#b6a9ff",
}: {
  path: string
  dur: number
  begin: number
  color?: string
}) {
  return (
    <g>
      <circle r="9" fill={color} opacity="0.18">
        <animateMotion dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" rotate="auto">
          <mpath href={`#${path}`} />
        </animateMotion>
      </circle>
      <circle r="3.6" fill={color}>
        <animateMotion dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" rotate="auto">
          <mpath href={`#${path}`} />
        </animateMotion>
      </circle>
    </g>
  )
}

export function Flow() {
  const ref = useRef<HTMLDivElement>(null)
  const on = useInView(ref)

  return (
    <section className="section flow-section" aria-labelledby="flow-title">
      <div className="wrap">
        <Reveal className="head-center">
          <span className="eyebrow">Remote by design</span>
          <h2 className="h2" id="flow-title">
            From your pocket to its computer.
          </h2>
          <p className="lede">
            Ask from anywhere. Sayabot takes the turn, runs the work on the agent&apos;s own machine
            with your tools, and routes anything risky back to you.
          </p>
        </Reveal>

        <div className="flow-scroll">
          <div className={`flow ${on ? "is-on" : ""}`} ref={ref}>
            <svg className="flow-svg" viewBox="0 0 1000 440" aria-hidden>
              <defs>
                {SOURCES.map((source, index) => (
                  <path
                    key={index}
                    id={`fs${index}`}
                    d={`M168 ${source.y}C250 ${source.y} 250 220 336 220`}
                  />
                ))}
                {COMPUTERS.map((computer, index) => (
                  <path
                    key={index}
                    id={`fc${index}`}
                    d={`M564 220C610 220 600 ${computer.y} 652 ${computer.y}`}
                  />
                ))}
                {TOOLS.map((tool, index) => (
                  <path key={index} id={`ft${index}`} d={`M778 ${tool.y}H862`} />
                ))}
                <path id="fback" d="M336 196C250 196 250 70 168 70" />
              </defs>

              {[
                ...SOURCES.map((_, i) => `fs${i}`),
                ...COMPUTERS.map((_, i) => `fc${i}`),
                ...TOOLS.map((_, i) => `ft${i}`),
              ].map((id) => (
                <g key={id}>
                  <use href={`#${id}`} className="flow-wire" />
                  <use href={`#${id}`} className="flow-dash" />
                </g>
              ))}
              <use href="#fback" className="flow-wire flow-wire-amber" />

              {on ? (
                <>
                  {SOURCES.map((_, index) => (
                    <Comet key={`s${index}`} path={`fs${index}`} dur={2.6} begin={index * 0.65} />
                  ))}
                  {COMPUTERS.map((_, index) => (
                    <Comet
                      key={`c${index}`}
                      path={`fc${index}`}
                      dur={2.2}
                      begin={0.9 + index * 0.7}
                    />
                  ))}
                  {TOOLS.map((_, index) => (
                    <Comet
                      key={`t${index}`}
                      path={`ft${index}`}
                      dur={1.6}
                      begin={1.6 + index * 0.5}
                    />
                  ))}
                  <Comet path="fback" dur={2.8} begin={1.2} color="#ffb547" />
                </>
              ) : null}
            </svg>

            {SOURCES.map((source) => {
              const Icon = source.icon
              return (
                <div key={source.label} className="flow-node flow-source" style={pct(96, source.y)}>
                  <Icon /> {source.label}
                </div>
              )
            })}

            <div className="flow-node flow-hub" style={pct(450, 220)}>
              <Saya shape="ghost" mood="thinking" live className="flow-hub-face" />
              <strong>Sayabot</strong>
              <span className="flow-hub-list">
                <span>turns</span>
                <span>approvals</span>
                <span>schedules</span>
                <span>audit log</span>
              </span>
            </div>

            {COMPUTERS.map((computer) => (
              <div
                key={computer.name}
                className="flow-node flow-computer"
                style={pct(715, computer.y)}
              >
                <Saya shape={computer.shape} mood="working" className="flow-computer-face" />
                <span className="mono">{computer.name}:~</span>
              </div>
            ))}

            {TOOLS.map((tool) => (
              <div key={tool.label} className="flow-node flow-tool" style={pct(915, tool.y)}>
                {tool.label}
              </div>
            ))}

            <div className="flow-node flow-badge" style={pct(250, 118)}>
              approve?
            </div>

            {/* Same x as each column's nodes, so the labels can never drift off them. */}
            {[
              { x: 96, label: "You, anywhere" },
              { x: 450, label: "Sayabot" },
              { x: 715, label: "Agent computers" },
              { x: 915, label: "Your tools" },
            ].map((caption) => (
              <span key={caption.label} className="flow-caption" style={{ left: `${caption.x / 10}%` }}>
                {caption.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
