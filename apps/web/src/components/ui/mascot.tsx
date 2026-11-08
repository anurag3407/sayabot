import { useId, type CSSProperties, type ReactNode, type Ref } from "react"

export type MascotShape = "squircle" | "pentagon" | "pill" | "triangle" | "dome" | "cloud"
export type MascotMood = "idle" | "happy" | "sleep" | "busy"

const SHAPES: MascotShape[] = ["squircle", "pentagon", "pill", "triangle", "dome", "cloud"]
const COLORS = [
  "var(--color-m-pink)",
  "var(--color-m-yellow)",
  "var(--color-m-teal)",
  "var(--color-m-blue)",
  "var(--color-m-lilac)",
  "var(--color-m-coral)",
]

function hash(seed: string): number {
  let value = 2166136261
  for (let index = 0; index < seed.length; index++) {
    value ^= seed.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

/** Face geometry per body, in the 100x100 viewBox. */
const FACE: Record<MascotShape, { y: number; gap: number }> = {
  squircle: { y: 46, gap: 15 },
  pentagon: { y: 50, gap: 14 },
  pill: { y: 50, gap: 17 },
  triangle: { y: 62, gap: 12 },
  dome: { y: 50, gap: 15 },
  cloud: { y: 54, gap: 15 },
}

function Body({ shape, paint }: { shape: MascotShape; paint: string }) {
  const round = { fill: paint, stroke: paint, strokeLinejoin: "round" as const }
  switch (shape) {
    case "squircle":
      return <rect x="13" y="13" width="74" height="74" rx="27" fill={paint} />
    case "pentagon":
      return <polygon points="50,17 84,41 71,82 29,82 16,41" strokeWidth="12" {...round} />
    case "pill":
      return <rect x="6" y="26" width="88" height="50" rx="25" fill={paint} />
    case "triangle":
      return <polygon points="50,20 86,80 14,80" strokeWidth="14" {...round} />
    case "dome":
      return <path d="M18 84 V50 a32 32 0 0 1 64 0 V84 Z" strokeWidth="8" {...round} />
    case "cloud":
      return (
        <g fill={paint}>
          <circle cx="31" cy="60" r="23" />
          <circle cx="69" cy="60" r="23" />
          <circle cx="50" cy="40" r="26" />
          <rect x="31" y="50" width="38" height="33" />
        </g>
      )
  }
}

/**
 * The Sayabot mascots. Give it a `seed` (an agent's name) and that agent keeps
 * the same body and colour everywhere it appears. Set `--lx` / `--ly` on the
 * svg to steer the pupils.
 */
export function Mascot({
  seed = "sayabot",
  shape,
  color,
  mood = "idle",
  fuzzy = false,
  blink = false,
  label,
  className,
  style,
  svgRef,
  children,
}: {
  seed?: string
  shape?: MascotShape
  color?: string
  mood?: MascotMood
  /** Felt texture. Costs a filter, so keep it to large, few mascots. */
  fuzzy?: boolean
  blink?: boolean
  label?: string
  className?: string
  style?: CSSProperties
  svgRef?: Ref<SVGSVGElement>
  children?: ReactNode
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "")
  const value = hash(seed)
  const bodyShape = shape ?? SHAPES[value % SHAPES.length]!
  const base = color ?? COLORS[(value >>> 4) % COLORS.length]!
  const { y, gap } = FACE[bodyShape]
  const left = 50 - gap
  const right = 50 + gap
  const ink = "#16131a"
  const pupilShift = mood === "busy" ? 3 : 0

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      className={className}
      style={{ overflow: "visible", flex: "none", ...style }}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}g`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" style={{ stopColor: `color-mix(in oklab, ${base} 72%, white)` }} />
          <stop offset="0.55" style={{ stopColor: base }} />
          <stop offset="1" style={{ stopColor: `color-mix(in oklab, ${base} 78%, #1a0f24)` }} />
        </linearGradient>
        {fuzzy ? (
          <filter id={`${id}f`} x="-12%" y="-12%" width="124%" height="124%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={value % 90} result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.4" result="body" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.55 -0.2" result="speck" />
            <feComposite in="speck" in2="body" operator="in" result="fur" />
            <feMerge>
              <feMergeNode in="body" />
              <feMergeNode in="fur" />
            </feMerge>
          </filter>
        ) : null}
      </defs>

      <g filter={fuzzy ? `url(#${id}f)` : undefined}>
        <Body shape={bodyShape} paint={`url(#${id}g)`} />
      </g>

      {mood === "happy" ? (
        <g fill="none" stroke={ink} strokeWidth="4.5" strokeLinecap="round">
          <path d={`M${left - 7} ${y + 3} q7 -11 14 0`} />
          <path d={`M${right - 7} ${y + 3} q7 -11 14 0`} />
        </g>
      ) : mood === "sleep" ? (
        <g fill="none" stroke={ink} strokeWidth="4.5" strokeLinecap="round">
          <path d={`M${left - 7} ${y} q7 6 14 0`} />
          <path d={`M${right - 7} ${y} q7 6 14 0`} />
        </g>
      ) : (
        <g className={blink ? "mascot-eyes" : undefined}>
          <ellipse cx={left} cy={y} rx="9" ry="11" fill="#fffaf2" />
          <ellipse cx={right} cy={y} rx="9" ry="11" fill="#fffaf2" />
          <g style={{ transform: "translate(var(--lx, 0px), var(--ly, 0px))", transition: "transform 0.25s ease-out" }}>
            <ellipse cx={left} cy={y + 1 + pupilShift} rx="4.6" ry="5.8" fill={ink} />
            <ellipse cx={right} cy={y + 1 + pupilShift} rx="4.6" ry="5.8" fill={ink} />
          </g>
        </g>
      )}
      <path d={`M${50 - 4} ${y + 12} q4 3.5 8 0`} fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
      {children}
    </svg>
  )
}
