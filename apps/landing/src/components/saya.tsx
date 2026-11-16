"use client"

import { useId, useRef, useState, type CSSProperties } from "react"
import {
  SAYA_BADGE,
  SAYA_EYE_STROKE,
  SAYA_INK,
  SAYA_SAAYA_OFFSET,
  SAYA_SHAPE_INFO,
  SAYA_TONES,
  SAYA_ZZ_STROKE,
  sayaGeometry,
  type SayaMood,
  type SayaShape,
  type SayaTone,
} from "@sayabot/core/mascot"
import { useLookAt } from "@/lib/motion"

/**
 * A Saya on the landing page, drawn from the same geometry as the app. `follow` makes the
 * eyes track the pointer (and a hover makes it smile); `live` adds the slow bob and blink;
 * `lit` glows the turn halo behind it.
 */
export function Saya({
  shape = "ghost",
  tone,
  mood = "idle",
  follow = false,
  live = false,
  lit = false,
  pool = false,
  label,
  className,
  style,
}: {
  shape?: SayaShape
  tone?: SayaTone
  mood?: SayaMood
  follow?: boolean
  live?: boolean
  lit?: boolean
  pool?: boolean
  label?: string
  className?: string
  style?: CSSProperties
}) {
  const ref = useRef<SVGSVGElement>(null)
  const id = useId().replace(/[^a-zA-Z0-9]/g, "")
  const [hover, setHover] = useState(false)
  useLookAt(ref, follow)
  const palette = SAYA_TONES[tone ?? SAYA_SHAPE_INFO[shape].tone]
  const g = sayaGeometry(shape, follow && hover && mood === "idle" ? "done" : mood)
  const { x, y, w, h, r } = g.visor

  return (
    <svg
      ref={ref}
      viewBox="0 0 100 100"
      className={["saya", live ? "saya-live" : "", lit ? "saya-lit" : "", className ?? ""].join(
        " ",
      )}
      style={style}
      data-mood={mood}
      onPointerEnter={follow ? () => setHover(true) : undefined}
      onPointerLeave={follow ? () => setHover(false) : undefined}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      focusable="false"
    >
      <defs>
        <radialGradient id={`${id}h`}>
          <stop offset="0" stopColor={palette.base} stopOpacity="0.75" />
          <stop offset="1" stopColor={palette.base} stopOpacity="0" />
        </radialGradient>
      </defs>
      {pool ? (
        <ellipse className="saya-pool" cx="50" cy="97" rx="38" ry="5.5" fill={`url(#${id}h)`} />
      ) : null}
      <g className="saya-body">
        <ellipse className="saya-halo" cx="50" cy="52" rx="50" ry="48" fill={`url(#${id}h)`} />
        <path d={g.shell} fill={palette.shade} transform={`translate(0 ${SAYA_SAAYA_OFFSET})`} />
        <path d={g.shell} fill={palette.base} />
        {g.detail ? <path d={g.detail} fill={palette.shade} /> : null}
        <rect x={x} y={y} width={w} height={h} rx={r} fill={SAYA_INK} />
        <g className={live || follow ? "saya-eyes" : undefined}>
          <g className="saya-look">
            {g.eyesFill ? <path d={g.eyesFill} fill={palette.eye} /> : null}
            {g.eyesLine ? (
              <path
                d={g.eyesLine}
                fill="none"
                stroke={palette.eye}
                strokeWidth={SAYA_EYE_STROKE}
                strokeLinecap="round"
              />
            ) : null}
          </g>
        </g>
        {g.dots ? <path className="saya-dots" d={g.dots} fill={palette.base} /> : null}
        {g.badge ? <path className="saya-badge" d={g.badge} fill={SAYA_BADGE} /> : null}
        {g.bang ? <path d={g.bang} fill={SAYA_INK} /> : null}
        {g.zz ? (
          <path
            className="saya-zz"
            d={g.zz}
            fill="none"
            stroke={palette.base}
            strokeWidth={SAYA_ZZ_STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </g>
    </svg>
  )
}
