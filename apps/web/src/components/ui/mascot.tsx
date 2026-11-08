import { useId, type CSSProperties, type ReactNode, type Ref } from "react"

export type MascotShape = "squircle" | "pentagon" | "pill" | "triangle" | "dome" | "cloud"
export type MascotMood = "idle" | "happy" | "sleep" | "busy" | "alert"

const SHAPES: MascotShape[] = ["squircle", "pentagon", "pill", "triangle", "dome", "cloud"]
const COLORS = [
  "var(--color-m-pink)",
  "var(--color-m-yellow)",
  "var(--color-m-teal)",
  "var(--color-m-blue)",
  "var(--color-m-lilac)",
  "var(--color-m-coral)",
]

type Antenna = "orb" | "twin" | "loop" | "sprout"
type Ears = "pods" | "fins" | "none"
type Eyes = "pill" | "round" | "wide"

const ANTENNAS: Antenna[] = ["orb", "twin", "loop", "sprout"]
const EYES: Eyes[] = ["pill", "round", "wide"]

/** The named cast is art-directed. Everyone else gets a stable generated look. */
const CAST: Record<string, { shape: MascotShape; color: string; antenna: Antenna }> = {
  Saya: { shape: "squircle", color: "var(--color-accent)", antenna: "orb" },
  "Claude Code": { shape: "cloud", color: "var(--color-m-yellow)", antenna: "orb" },
  Codex: { shape: "pentagon", color: "var(--color-m-blue)", antenna: "twin" },
  Hermes: { shape: "triangle", color: "var(--color-m-pink)", antenna: "sprout" },
  Cursor: { shape: "pill", color: "var(--color-m-lilac)", antenna: "loop" },
  Pip: { shape: "dome", color: "var(--color-m-lilac)", antenna: "sprout" },
  Moss: { shape: "pill", color: "var(--color-m-teal)", antenna: "sprout" },
  Juno: { shape: "pentagon", color: "var(--color-m-yellow)", antenna: "orb" },
  Tofu: { shape: "cloud", color: "var(--color-m-blue)", antenna: "loop" },
  Nori: { shape: "squircle", color: "var(--color-m-teal)", antenna: "loop" },
  Bean: { shape: "triangle", color: "var(--color-m-coral)", antenna: "orb" },
  Olive: { shape: "dome", color: "var(--color-m-teal)", antenna: "twin" },
  Miso: { shape: "pentagon", color: "var(--color-m-coral)", antenna: "twin" },
}

function hash(seed: string): number {
  let value = 2166136261
  for (let index = 0; index < seed.length; index++) {
    value ^= seed.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

function roundedRect(x: number, y: number, w: number, h: number, r: number) {
  return `M${x + r} ${y}H${x + w - r}a${r} ${r} 0 0 1 ${r} ${r}V${y + h - r}a${r} ${r} 0 0 1 ${-r} ${r}H${x + r}a${r} ${r} 0 0 1 ${-r} ${-r}V${y + r}a${r} ${r} 0 0 1 ${r} ${-r}Z`
}

/**
 * Every Saya shares one anatomy: a shell, a dark visor, two lit eyes and an
 * antenna lamp. The shell silhouette is what tells them apart at avatar size.
 */
const ANATOMY: Record<
  MascotShape,
  {
    shell: string
    visor: [x: number, y: number, w: number, h: number, r: number]
    top: number
    ears: Ears
    earX: [number, number]
  }
> = {
  squircle: { shell: roundedRect(14, 24, 72, 66, 27), visor: [23, 35, 54, 42, 18], top: 24, ears: "pods", earX: [8, 86] },
  pill: { shell: roundedRect(6, 35, 88, 52, 26), visor: [15, 43, 70, 36, 18], top: 35, ears: "none", earX: [0, 0] },
  dome: {
    shell: "M18 77V54a32 32 0 0 1 64 0v23a13 13 0 0 1-13 13H31a13 13 0 0 1-13-13Z",
    visor: [26, 43, 48, 37, 17],
    top: 22,
    ears: "fins",
    earX: [11, 83],
  },
  pentagon: {
    shell: "M42 24Q50 19.5 58 24L82 38Q88 42 88 49V67Q88 74 82 78L58 91Q50 95.5 42 91L18 78Q12 74 12 67V49Q12 42 18 38Z",
    visor: [22, 41, 56, 36, 15],
    top: 21,
    ears: "none",
    earX: [0, 0],
  },
  triangle: {
    shell: "M50 22C66 22 72 36 78 52C84 66 92 72 88 82C85 90 76 91 66 91H34C24 91 15 90 12 82C8 72 16 66 22 52C28 36 34 22 50 22Z",
    visor: [27, 50, 46, 33, 15],
    top: 22,
    ears: "none",
    earX: [0, 0],
  },
  cloud: {
    shell: "M26 90C13 90 6 80 6 69C6 58 13 51 22 50C22 36 34 26 50 26C66 26 78 36 78 50C87 51 94 58 94 69C94 80 87 90 74 90Z",
    visor: [23, 47, 54, 36, 16],
    top: 26,
    ears: "none",
    earX: [0, 0],
  },
}

const INK = "#0e0b12"
const LAMP = "#ffd08a"

function AntennaArt({ kind, top, paint }: { kind: Antenna; top: number; paint: string }) {
  const lamp = (cx: number, cy: number, r: number) => (
    <g>
      <circle className="saya-halo" cx={cx} cy={cy} r={r * 2.5} fill={LAMP} />
      <circle className="saya-lamp" cx={cx} cy={cy} r={r} />
      <circle cx={cx - r * 0.32} cy={cy - r * 0.36} r={r * 0.3} fill="#fff" opacity="0.75" />
    </g>
  )
  const y = top + 2
  switch (kind) {
    case "twin":
      return (
        <g>
          <path d={`M43 ${y}L37 ${y - 13}M57 ${y}L63 ${y - 13}`} stroke={paint} strokeWidth="3.4" strokeLinecap="round" fill="none" />
          {lamp(36, y - 16, 4.4)}
          {lamp(64, y - 16, 4.4)}
        </g>
      )
    case "loop":
      return (
        <g>
          <path d={`M50 ${y}V${y - 8}`} stroke={paint} strokeWidth="3.4" strokeLinecap="round" />
          <circle cx="50" cy={y - 14} r="6.6" fill="none" stroke={paint} strokeWidth="3.2" />
          {lamp(50, y - 14, 3.4)}
        </g>
      )
    case "sprout":
      return (
        <g>
          <path d={`M50 ${y}C50 ${y - 7} 47 ${y - 10} 44 ${y - 13}`} stroke={paint} strokeWidth="3.4" strokeLinecap="round" fill="none" />
          <path d={`M50 ${y - 6}C52 ${y - 13} 60 ${y - 16} 67 ${y - 15}C66 ${y - 8} 58 ${y - 3} 50 ${y - 6}Z`} fill={paint} />
          {lamp(42, y - 16, 4.8)}
        </g>
      )
    default:
      return (
        <g>
          <path d={`M50 ${y}V${y - 12}`} stroke={paint} strokeWidth="3.6" strokeLinecap="round" />
          {lamp(50, y - 16, 5.6)}
        </g>
      )
  }
}

function EarArt({ kind, xs, y, paint }: { kind: Ears; xs: [number, number]; y: number; paint: string }) {
  if (kind === "pods") {
    return (
      <g fill={paint}>
        <rect x={xs[0]} y={y - 11} width="7" height="22" rx="3.5" />
        <rect x={xs[1] - 1} y={y - 11} width="7" height="22" rx="3.5" />
      </g>
    )
  }
  if (kind === "fins") {
    return (
      <g fill={paint}>
        <path d={`M${xs[0] + 8} ${y - 12}Q${xs[0] - 7} ${y - 8} ${xs[0] - 4} ${y + 11}Q${xs[0] + 3} ${y + 8} ${xs[0] + 8} ${y + 9}Z`} />
        <path d={`M${xs[1] - 2} ${y - 12}Q${xs[1] + 13} ${y - 8} ${xs[1] + 10} ${y + 11}Q${xs[1] + 3} ${y + 8} ${xs[1] - 2} ${y + 9}Z`} />
      </g>
    )
  }
  return null
}

function Face({
  mood,
  eyes,
  cx,
  cy,
  gap,
  glow,
  blink,
}: {
  mood: MascotMood
  eyes: Eyes
  cx: number
  cy: number
  gap: number
  glow: string
  blink: boolean
}) {
  const left = cx - gap
  const right = cx + gap
  const arcs = (dir: 1 | -1, dim = 1) => (
    <g fill="none" stroke={glow} strokeWidth="4.2" strokeLinecap="round" opacity={dim}>
      <path d={`M${left - 6.5} ${cy + dir * 2.5}q6.5 ${dir * -9.5} 13 0`} />
      <path d={`M${right - 6.5} ${cy + dir * 2.5}q6.5 ${dir * -9.5} 13 0`} />
    </g>
  )
  if (mood === "happy") return arcs(1)
  if (mood === "sleep") return arcs(-1, 0.55)

  const size =
    mood === "busy"
      ? { rx: 5.6, ry: 2.6 }
      : mood === "alert"
        ? { rx: 7.2, ry: 8.6 }
        : eyes === "round"
          ? { rx: 6.4, ry: 6.8 }
          : eyes === "wide"
            ? { rx: 8, ry: 5.4 }
            : { rx: 5, ry: 8.2 }
  return (
    <g className={blink ? "mascot-eyes" : undefined}>
      <g style={{ transform: "translate(var(--lx, 0px), var(--ly, 0px))", transition: "transform 0.22s ease-out" }}>
        <ellipse cx={left} cy={cy} rx={size.rx + 3.6} ry={size.ry + 3.6} fill={glow} opacity="0.2" />
        <ellipse cx={right} cy={cy} rx={size.rx + 3.6} ry={size.ry + 3.6} fill={glow} opacity="0.2" />
        <ellipse cx={left} cy={cy} rx={size.rx} ry={size.ry} fill={glow} />
        <ellipse cx={right} cy={cy} rx={size.rx} ry={size.ry} fill={glow} />
        <ellipse cx={left - size.rx * 0.28} cy={cy - size.ry * 0.38} rx={size.rx * 0.3} ry={size.ry * 0.26} fill="#fff" opacity="0.9" />
        <ellipse cx={right - size.rx * 0.28} cy={cy - size.ry * 0.38} rx={size.rx * 0.3} ry={size.ry * 0.26} fill="#fff" opacity="0.9" />
      </g>
    </g>
  )
}

/**
 * The Sayas: one family of small visor-faced bots. Give it a `seed` (an agent's
 * name) and that agent keeps the same shell, antenna, eyes and colour
 * everywhere it appears. `lit` turns on the antenna lamp, which across the
 * brand means exactly one thing: it is this agent's turn. Set `--lx` / `--ly`
 * on the svg to steer the eyes.
 */
export function Mascot({
  seed = "sayabot",
  shape,
  color,
  mood = "idle",
  antenna,
  lit = false,
  figure = false,
  shadow = false,
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
  antenna?: Antenna
  /** Antenna lamp on: this agent holds the turn. */
  lit?: boolean
  /** Full character with torso and floating hands (viewBox 100x146). */
  figure?: boolean
  /** The soft pool of colour a Saya hovers over. */
  shadow?: boolean
  blink?: boolean
  label?: string
  className?: string
  style?: CSSProperties
  svgRef?: Ref<SVGSVGElement>
  children?: ReactNode
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "")
  const value = hash(seed)
  const known = CAST[seed]
  const bodyShape = shape ?? known?.shape ?? SHAPES[value % SHAPES.length]!
  const base = color ?? known?.color ?? COLORS[(value >>> 4) % COLORS.length]!
  const antennaKind = antenna ?? known?.antenna ?? ANTENNAS[(value >>> 8) % ANTENNAS.length]!
  const eyeKind = EYES[(value >>> 11) % EYES.length]!
  const body = ANATOMY[bodyShape]
  const [vx, vy, vw, vh, vr] = body.visor
  const cx = vx + vw / 2
  const cy = vy + vh / 2 - 1
  const gap = Math.min(vw * 0.25, 15)
  const glow = `color-mix(in oklab, ${base} 28%, #fff8ee)`
  const paint = `url(#${id}s)`
  const darker = `color-mix(in oklab, ${base} 66%, #1a0f24)`

  const shell = (
    <g className="saya-head">
      <AntennaArt kind={antennaKind} top={body.top} paint={darker} />
      <EarArt kind={body.ears} xs={body.earX} y={cy} paint={darker} />
      <path d={body.shell} fill={paint} />
      <g clipPath={`url(#${id}c)`}>
        <ellipse cx="30" cy={body.top + 8} rx="46" ry="30" fill={`url(#${id}h)`} />
        <ellipse cx="50" cy="104" rx="66" ry="30" fill={`url(#${id}d)`} />
        <path d={body.shell} fill="none" stroke="#fff" strokeOpacity="0.32" strokeWidth="1.6" />
      </g>
      <rect x={vx - 1.5} y={vy - 1} width={vw + 3} height={vh + 3.4} rx={vr + 1.5} fill={darker} opacity="0.7" />
      <rect x={vx} y={vy} width={vw} height={vh} rx={vr} fill={`url(#${id}v)`} />
      <path
        d={`M${vx + vr * 0.72} ${vy + 3.6}H${vx + vw * 0.52}Q${vx + vw * 0.4} ${vy + vh * 0.3} ${vx + 4.6} ${vy + vh * 0.42}Q${vx + 2.6} ${vy + 8} ${vx + vr * 0.72} ${vy + 3.6}Z`}
        fill="#fff"
        opacity="0.1"
      />
      <ellipse cx={cx - gap - 7} cy={cy + 10.5} rx="4.4" ry="2.2" fill={base} opacity="0.5" />
      <ellipse cx={cx + gap + 7} cy={cy + 10.5} rx="4.4" ry="2.2" fill={base} opacity="0.5" />
      <Face mood={mood} eyes={eyeKind} cx={cx} cy={cy - 1} gap={gap} glow={glow} blink={blink} />
      {mood === "sleep" || mood === "busy" ? null : (
        <path
          d={mood === "alert" ? `M${cx - 2.4} ${cy + 12.6}a2.4 2.2 0 1 0 4.8 0a2.4 2.2 0 1 0 -4.8 0Z` : `M${cx - 3.6} ${cy + 11}q3.6 3.6 7.2 0`}
          fill={mood === "alert" ? glow : "none"}
          stroke={mood === "alert" ? "none" : glow}
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}
    </g>
  )

  return (
    <svg
      ref={svgRef}
      viewBox={figure ? "0 0 100 146" : "0 0 100 100"}
      data-lit={lit ? "true" : undefined}
      className={className}
      style={{ overflow: "visible", flex: "none", ...style }}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}s`} x1="0.2" y1="0" x2="0.75" y2="1">
          <stop offset="0" style={{ stopColor: `color-mix(in oklab, ${base} 70%, #fff)` }} />
          <stop offset="0.52" style={{ stopColor: base }} />
          <stop offset="1" style={{ stopColor: `color-mix(in oklab, ${base} 70%, #1a0f24)` }} />
        </linearGradient>
        <radialGradient id={`${id}h`}>
          <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}d`}>
          <stop offset="0" stopColor="#190b26" stopOpacity="0.5" />
          <stop offset="1" stopColor="#190b26" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}v`} cx="0.42" cy="0.3" r="0.95">
          <stop offset="0" stopColor="#2b2536" />
          <stop offset="0.6" stopColor="#14111b" />
          <stop offset="1" stopColor={INK} />
        </radialGradient>
        <radialGradient id={`${id}g`}>
          <stop offset="0" style={{ stopColor: base, stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: base, stopOpacity: 0 }} />
        </radialGradient>
        <clipPath id={`${id}c`}>
          <path d={body.shell} />
        </clipPath>
      </defs>

      {shadow ? (
        <ellipse className="saya-shadow" cx="50" cy={figure ? 140 : 96} rx="44" ry="7.5" fill={`url(#${id}g)`} />
      ) : null}

      {figure ? (
        <g className="saya-body">
          <path d="M34 86H66C72 86 74 92 74 98C74 114 66 126 50 126C34 126 26 114 26 98C26 92 28 86 34 86Z" fill={paint} />
          <ellipse cx="50" cy="124" rx="24" ry="9" fill={darker} opacity="0.55" />
          <circle cx="50" cy="104" r="6.4" fill={INK} />
          <circle className="saya-halo" cx="50" cy="104" r="11" fill={LAMP} />
          <circle className="saya-lamp" cx="50" cy="104" r="3.6" />
          <g className="saya-hand saya-hand-l">
            <ellipse cx="16" cy="104" rx="8" ry="9.5" fill={paint} />
          </g>
          <g className="saya-hand saya-hand-r">
            <ellipse cx="84" cy="104" rx="8" ry="9.5" fill={paint} />
          </g>
        </g>
      ) : null}
      {shell}
      {children}
    </svg>
  )
}
