import { useId, type CSSProperties, type ReactNode, type Ref } from "react"
import {
  RARE_MASCOT,
  SAYA_BADGE,
  SAYA_CAST,
  SAYA_EYE_STROKE,
  SAYA_INK,
  SAYA_SAAYA_OFFSET,
  SAYA_SHAPE_INFO,
  SAYA_TONES,
  SAYA_ZZ_STROKE,
  resolveMascotLook,
  sayaGeometry,
  sayaPick,
  type SayaMood,
  type SayaShape,
  type SayaTone,
} from "@sayabot/core"

export type MascotShape = SayaShape
/** App moods. The older names map onto the Saya family's moods (happy = done, busy = working…). */
export type MascotMood = "idle" | "happy" | "sleep" | "busy" | "alert" | "thinking"

const MOOD: Record<MascotMood, SayaMood> = {
  idle: "idle",
  happy: "done",
  sleep: "sleeping",
  busy: "working",
  alert: "waiting",
  thinking: "thinking",
}

export { RARE_MASCOT, resolveMascotLook }
const CAST = SAYA_CAST

/** A four-point sparkle centred on (x, y). */
function sparkle(x: number, y: number, size: number) {
  return `M${x} ${y - size}Q${x} ${y} ${x + size} ${y}Q${x} ${y} ${x} ${y + size}Q${x} ${y} ${x - size} ${y}Q${x} ${y} ${x} ${y - size}Z`
}

/**
 * The Sayas: one family of soft, visor-faced bots drawn from the shared geometry in
 * `@sayabot/core`. Give it a `seed` (an agent's name) and that agent keeps the same shape and
 * colour everywhere it appears. Each one casts its own saaya (the darker layer underneath).
 * `lit` glows a halo behind it, which across the brand means exactly one thing: it is this
 * agent's turn. Set `--lx` / `--ly` on the svg to steer the eyes.
 */
export function Mascot({
  seed = "sayabot",
  shape,
  color,
  mood = "idle",
  lit = false,
  figure = false,
  shadow = false,
  blink = false,
  live = false,
  rare,
  label,
  className,
  style,
  svgRef,
  children,
}: {
  seed?: string
  shape?: MascotShape
  /** Any CSS colour for the shell; the saaya and eyes are mixed from it. */
  color?: string
  mood?: MascotMood
  /** Halo on: this agent holds the turn. */
  lit?: boolean
  /** Standing on a floor with headroom for mood extras (viewBox 100x146). */
  figure?: boolean
  /** The soft pool of colour a Saya hovers over. */
  shadow?: boolean
  blink?: boolean
  /** Alive: hovers and blinks. Respects reduced motion. */
  live?: boolean
  /** The rare prism Saya (iridescent shell, sparkles). Defaults on for the rare cast member. */
  rare?: boolean
  label?: string
  className?: string
  style?: CSSProperties
  svgRef?: Ref<SVGSVGElement>
  children?: ReactNode
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "")
  const known = CAST[seed]
  const resolved = resolveMascotLook(seed)
  const bodyShape = shape ?? resolved.shape
  const tone =
    SAYA_TONES[resolved.cast ? resolved.tone : shape ? SAYA_SHAPE_INFO[shape].tone : resolved.tone]
  const base = color ?? tone.base
  const shade = color ? `color-mix(in oklab, ${color} 68%, #1a0f24)` : tone.shade
  const eye = color ? `color-mix(in oklab, ${color} 18%, #fff)` : tone.eye
  const isRare = rare ?? Boolean(known?.rare)
  const blinking = blink || live
  const g = sayaGeometry(bodyShape, MOOD[mood] ?? "idle")
  const { x, y, w, h, r } = g.visor
  const shell = isRare ? `url(#${id}p)` : base
  const halo = isRare ? "#c4b5fd" : base

  const art = (
    <g className="saya-head">
      <ellipse className="saya-halo" cx="50" cy="52" rx="46" ry="44" fill={`url(#${id}g)`} />
      <path
        d={g.shell}
        fill={isRare ? "#7c6fd6" : shade}
        transform={`translate(0 ${SAYA_SAAYA_OFFSET})`}
      />
      <path d={g.shell} fill={shell} className={isRare ? "saya-prism" : undefined} />
      {g.detail ? <path d={g.detail} fill={isRare ? "#7c6fd6" : shade} /> : null}
      <rect x={x} y={y} width={w} height={h} rx={r} fill={SAYA_INK} />
      <g className={blinking ? "mascot-eyes" : undefined}>
        <g
          style={{
            transform: "translate(var(--lx, 0px), var(--ly, 0px))",
            transition: "transform 0.22s ease-out",
          }}
        >
          {g.eyesFill ? <path d={g.eyesFill} fill={eye} /> : null}
          {g.eyesLine ? (
            <path
              d={g.eyesLine}
              fill="none"
              stroke={eye}
              strokeWidth={SAYA_EYE_STROKE}
              strokeLinecap="round"
            />
          ) : null}
        </g>
      </g>
      {g.dots ? <path d={g.dots} fill={base} /> : null}
      {g.badge ? <path d={g.badge} fill={SAYA_BADGE} /> : null}
      {g.bang ? <path d={g.bang} fill={SAYA_INK} /> : null}
      {g.zz ? (
        <path
          d={g.zz}
          fill="none"
          stroke={base}
          strokeWidth={SAYA_ZZ_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </g>
  )

  return (
    <svg
      ref={svgRef}
      viewBox={figure ? "0 0 100 146" : "0 0 100 100"}
      data-lit={lit ? "true" : undefined}
      data-mood={live ? mood : undefined}
      className={[live ? "saya-live" : null, className].filter(Boolean).join(" ") || undefined}
      style={{ overflow: "visible", flex: "none", ...style }}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      focusable="false"
    >
      <defs>
        <radialGradient id={`${id}g`}>
          <stop offset="0" stopColor={halo} stopOpacity="0.7" />
          <stop offset="1" stopColor={halo} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}s`}>
          <stop offset="0" stopColor={halo} stopOpacity="0.45" />
          <stop offset="1" stopColor={halo} stopOpacity="0" />
        </radialGradient>
        {isRare ? (
          <linearGradient id={`${id}p`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fbcfe8" />
            <stop offset="0.35" stopColor="#c4b5fd" />
            <stop offset="0.65" stopColor="#93c5fd" />
            <stop offset="1" stopColor="#86efac" />
          </linearGradient>
        ) : null}
      </defs>

      {shadow ? (
        <ellipse
          className="saya-shadow"
          cx="50"
          cy={figure ? 140 : 97}
          rx="40"
          ry="6.5"
          fill={`url(#${id}s)`}
        />
      ) : null}
      {figure ? <g transform="translate(-10 22) scale(1.2)">{art}</g> : art}
      {isRare ? (
        <g fill="#fff">
          <path className="saya-spark" d={sparkle(8, 34, 5)} />
          <path className="saya-spark" d={sparkle(93, 40, 4)} fill="#fde68a" />
          <path className="saya-spark" d={sparkle(96, 78, 3.4)} />
          <path className="saya-spark" d={sparkle(4, 80, 3.6)} fill="#c4b5fd" />
        </g>
      ) : null}
      {children}
    </svg>
  )
}
