/**
 * The Saya mascot family as pure geometry, so every surface (web, landing, mobile, brand
 * exports) draws the exact same bots. Nothing here renders: it returns SVG path strings on a
 * 100x100 grid that each platform paints with its own SVG primitives.
 *
 * Anatomy, back to front:
 *   saaya  the shell's silhouette again, 6 units lower, in the shade tone ("saaya" = shadow)
 *   shell  one rounded silhouette per shape, in the base tone
 *   detail optional shade accent drawn on the shell (Ledger's folded corner)
 *   visor  an ink pill, always the same height
 *   eyes   two marks in a pale tint of the shell; moods only change these
 *   extras thought dots, approval badge or "zz", top right and outside the shell
 */

export type SayaShape =
  "ghost" | "peak" | "ledger" | "bubble" | "hoot" | "bloom" | "sprout" | "block"
export type SayaMood = "idle" | "thinking" | "working" | "waiting" | "done" | "sleeping"
export type SayaTone = "lilac" | "coral" | "blue" | "yellow" | "teal" | "pink" | "green" | "orange"

export interface SayaPalette {
  /** Shell fill. */
  base: string
  /** The saaya (shadow layer) and accents. */
  shade: string
  /** Eye colour: a pale tint of the base. */
  eye: string
}

export interface SayaVisor {
  x: number
  y: number
  w: number
  h: number
  r: number
}

export interface SayaGeometry {
  /** Shell silhouette. Also drawn translated by `SAYA_SAAYA_OFFSET` in the shade tone. */
  shell: string
  /** Shade-coloured accent on top of the shell, if the shape has one. */
  detail: string | null
  visor: SayaVisor
  /** Filled eye marks (capsules, dashes, circles), or null when the mood draws lines. */
  eyesFill: string | null
  /** Stroked eye marks (happy or closed arcs), stroke width `SAYA_EYE_STROKE`. */
  eyesLine: string | null
  /** Thinking: three ascending dots, filled with the base tone. */
  dots: string | null
  /** Waiting: amber approval badge circle (`SAYA_BADGE`) and its ink "!" (`SAYA_INK`). */
  badge: string | null
  bang: string | null
  /** Sleeping: two "z" strokes in the base tone, stroke width `SAYA_ZZ_STROKE`. */
  zz: string | null
}

export const SAYA_SHAPES: readonly SayaShape[] = [
  "ghost",
  "peak",
  "ledger",
  "bubble",
  "hoot",
  "bloom",
  "sprout",
  "block",
]
export const SAYA_MOODS: readonly SayaMood[] = [
  "idle",
  "thinking",
  "working",
  "waiting",
  "done",
  "sleeping",
]
export const SAYA_TONE_NAMES: readonly SayaTone[] = [
  "lilac",
  "coral",
  "blue",
  "yellow",
  "teal",
  "pink",
  "green",
  "orange",
]

export const SAYA_TONES: Record<SayaTone, SayaPalette> = {
  lilac: { base: "#9d8cff", shade: "#6b59d6", eye: "#ece8ff" },
  coral: { base: "#ff7a70", shade: "#d24f46", eye: "#ffe4e0" },
  blue: { base: "#5b9df5", shade: "#346fc4", eye: "#e1edff" },
  yellow: { base: "#f2c14e", shade: "#c39024", eye: "#fff4d6" },
  teal: { base: "#4fcdb0", shade: "#2b9d84", eye: "#dcf8f0" },
  pink: { base: "#ee5fb8", shade: "#bd3b8b", eye: "#ffe1f3" },
  green: { base: "#8bd46e", shade: "#5ea346", eye: "#e9f8e2" },
  orange: { base: "#ff9f43", shade: "#d47720", eye: "#ffeedb" },
}

export const SAYA_INK = "#17141f"
export const SAYA_BADGE = "#ffb547"
export const SAYA_SAAYA_OFFSET = 6
export const SAYA_EYE_STROKE = 3
export const SAYA_ZZ_STROKE = 2.6

/** The shape's own name in the cast and its default tone. */
export const SAYA_SHAPE_INFO: Record<SayaShape, { name: string; role: string; tone: SayaTone }> = {
  ghost: { name: "Saya", role: "Assistant", tone: "lilac" },
  peak: { name: "Peak", role: "Chief of Staff", tone: "coral" },
  ledger: { name: "Ledger", role: "Bookkeeper", tone: "blue" },
  bubble: { name: "Bubble", role: "Inbox", tone: "yellow" },
  hoot: { name: "Hoot", role: "Research", tone: "teal" },
  bloom: { name: "Bloom", role: "Social media", tone: "pink" },
  sprout: { name: "Sprout", role: "Growth & SEO", tone: "green" },
  block: { name: "Block", role: "Engineer", tone: "orange" },
}

/** The rare mascot: prism shell and sparkles reserved for the orchestrator. */
export const RARE_MASCOT = "Nova"

/** The canonical named cast is art-directed. Everyone else gets a stable generated look. */
export const SAYA_CAST: Record<string, { shape: SayaShape; tone: SayaTone; rare?: boolean }> = {
  Saya: { shape: "ghost", tone: "lilac" },
  [RARE_MASCOT]: { shape: "ghost", tone: "lilac", rare: true },
  "Claude Code": { shape: "bubble", tone: "orange" },
  Codex: { shape: "block", tone: "blue" },
  Hermes: { shape: "peak", tone: "pink" },
  Cursor: { shape: "ledger", tone: "teal" },
  Pip: { shape: "hoot", tone: "yellow" },
  Moss: { shape: "sprout", tone: "green" },
  Juno: { shape: "peak", tone: "yellow" },
  Tofu: { shape: "bloom", tone: "blue" },
  Nori: { shape: "block", tone: "teal" },
  Bean: { shape: "bubble", tone: "coral" },
  Olive: { shape: "sprout", tone: "teal" },
  Miso: { shape: "ledger", tone: "coral" },
  Peak: { shape: "peak", tone: "coral" },
  Ledger: { shape: "ledger", tone: "blue" },
  Bubble: { shape: "bubble", tone: "yellow" },
  Hoot: { shape: "hoot", tone: "teal" },
  Bloom: { shape: "bloom", tone: "pink" },
  Sprout: { shape: "sprout", tone: "green" },
  Block: { shape: "block", tone: "orange" },
}

/** The face a name draws before anyone picks a shape or a colour. */
export function resolveMascotLook(seed: string): {
  shape: SayaShape
  tone: SayaTone
  cast: boolean
  rare?: boolean
} {
  if (!seed) return { shape: "ghost", tone: "lilac", cast: false }
  // Direct match
  const direct = SAYA_CAST[seed]
  if (direct) return { shape: direct.shape, tone: direct.tone, cast: true, rare: direct.rare }

  // Normalized match (case-insensitive, hyphens/underscores/spaces)
  const norm = seed.trim().toLowerCase().replace(/[-_]/g, " ")
  for (const [key, val] of Object.entries(SAYA_CAST)) {
    if (key.toLowerCase() === norm) {
      return { shape: val.shape, tone: val.tone, cast: true, rare: val.rare }
    }
  }

  // Common agent name heuristics
  if (norm.includes("claude")) return { shape: "bubble", tone: "orange", cast: true }
  if (norm.includes("codex") || norm.includes("gpt")) return { shape: "block", tone: "blue", cast: true }
  if (norm.includes("cursor")) return { shape: "ledger", tone: "teal", cast: true }
  if (norm.includes("hermes")) return { shape: "peak", tone: "pink", cast: true }
  if (norm.includes("gemini")) return { shape: "bloom", tone: "blue", cast: true }
  if (norm.includes("chief") || norm.includes("staff")) return { shape: "peak", tone: "coral", cast: true }
  if (norm.includes("saya")) return { shape: "ghost", tone: "lilac", cast: true }

  const picked = sayaPick(seed)
  return { shape: picked.shape, tone: picked.tone, cast: false }
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Clockwise rounded rectangle. Every subpath is clockwise so unions fill under nonzero. */
export function sayaRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  return (
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}` +
    `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  )
}

/** Clockwise circle. */
export function sayaCircle(cx: number, cy: number, r: number): string {
  return `M${r2(cx - r)} ${r2(cy)}A${r} ${r} 0 1 1 ${r2(cx + r)} ${r2(cy)}A${r} ${r} 0 1 1 ${r2(cx - r)} ${r2(cy)}Z`
}

/** A capsule: vertical when taller than wide, horizontal otherwise. */
function capsule(x: number, y: number, w: number, h: number): string {
  const r = Math.min(w, h) / 2
  if (w <= h) {
    return `M${r2(x)} ${r2(y + r)}a${r} ${r} 0 0 1 ${w} 0v${r2(h - 2 * r)}a${r} ${r} 0 0 1 ${-w} 0Z`
  }
  return `M${r2(x + r)} ${r2(y)}h${r2(w - 2 * r)}a${r} ${r} 0 0 1 0 ${h}h${r2(-(w - 2 * r))}a${r} ${r} 0 0 1 0 ${-h}Z`
}

function bloomShell(): string {
  let d = sayaCircle(50, 50, 25)
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4
    d += sayaCircle(r2(50 + 23 * Math.cos(a)), r2(50 + 23 * Math.sin(a)), 12)
  }
  return d
}

const ANATOMY: Record<
  SayaShape,
  { shell: string; detail?: string; visor: [number, number, number, number] }
> = {
  ghost: {
    shell:
      "M22 74V46A28 28 0 0 1 78 46V74A9.333 9.333 0 0 1 59.333 74A9.333 9.333 0 0 1 40.667 74A9.333 9.333 0 0 1 22 74Z",
    visor: [30, 40, 40, 20],
  },
  peak: {
    shell:
      "M50 18C56 18 59 22 63 29L82 64C87 73 82 82 71 82H29C18 82 13 73 18 64L37 29C41 22 44 18 50 18Z",
    visor: [30, 54, 40, 20],
  },
  ledger: {
    shell:
      "M34 16H60Q63 16 65.2 18.2L77.8 30.8Q80 33 80 36V70A14 14 0 0 1 66 84H34A14 14 0 0 1 20 70V30A14 14 0 0 1 34 16Z",
    detail: "M61 17V28Q61 35 68 35H79Z",
    visor: [28, 47, 44, 20],
  },
  bubble: {
    shell: sayaRoundedRect(16, 20, 68, 52, 26) + "M48 70L25.4 85.6Q22.4 87.5 23 84L28 64Z",
    visor: [30, 36, 40, 20],
  },
  hoot: {
    shell:
      sayaCircle(50, 55, 29) +
      "M28 42L23.5 19Q23 14.5 27 16.5L45 28Z" +
      "M72 42L55 28L73 16.5Q77 14.5 76.5 19Z",
    visor: [30, 47, 40, 20],
  },
  bloom: { shell: bloomShell(), visor: [30, 42, 40, 20] },
  sprout: {
    shell:
      sayaCircle(50, 57, 27) +
      "M50 32C50 21 58 13 71 13C71 25 62 32 50 32Z" +
      "M50 32C40 32 33 27 33 18C43 18 49 24 50 32Z",
    visor: [30, 52, 40, 20],
  },
  block: {
    shell:
      sayaRoundedRect(18, 20, 64, 62, 24) +
      sayaRoundedRect(11, 42, 9, 18, 4.5) +
      sayaRoundedRect(80, 42, 9, 18, 4.5),
    visor: [28, 43, 44, 22],
  },
}

/** Geometry for one shape in one mood, on the 100x100 grid. */
export function sayaGeometry(shape: SayaShape, mood: SayaMood = "idle"): SayaGeometry {
  const anatomy = ANATOMY[shape] ?? ANATOMY.ghost
  const [x, y, w, h] = anatomy.visor
  const visor: SayaVisor = { x, y, w, h, r: h / 2 }
  const cx = x + w / 2
  const cy = y + h / 2
  const gap = w / 4.4
  const L = r2(cx - gap)
  const R = r2(cx + gap)
  let eyesFill: string | null = null
  let eyesLine: string | null = null

  switch (mood) {
    case "thinking":
      eyesFill = capsule(L - 0.5, cy - 6, 5, 7.5) + capsule(R - 0.5, cy - 6, 5, 7.5)
      break
    case "working":
      eyesFill = capsule(L - 4.5, cy - 1.6, 9, 3.2) + capsule(R - 4.5, cy - 1.6, 9, 3.2)
      break
    case "waiting":
      eyesFill = sayaCircle(L - 1.5, cy, 3.8) + sayaCircle(R - 1.5, cy, 3.8)
      break
    case "done":
      eyesLine = [L, R]
        .map((e) => `M${r2(e - 4)} ${cy + 2}Q${e} ${cy - 4.5} ${r2(e + 4)} ${cy + 2}`)
        .join("")
      break
    case "sleeping":
      eyesLine = [L, R]
        .map((e) => `M${r2(e - 4)} ${cy - 1}Q${e} ${cy + 4} ${r2(e + 4)} ${cy - 1}`)
        .join("")
      break
    default:
      eyesFill = capsule(L - 2.5, cy - 4.5, 5, 9) + capsule(R - 2.5, cy - 4.5, 5, 9)
  }

  return {
    shell: anatomy.shell,
    detail: anatomy.detail ?? null,
    visor,
    eyesFill,
    eyesLine,
    dots:
      mood === "thinking"
        ? sayaCircle(80, 24, 2.4) + sayaCircle(86.5, 16, 3.2) + sayaCircle(93, 7, 3.8)
        : null,
    badge: mood === "waiting" ? sayaCircle(84, 18, 9.5) : null,
    bang:
      mood === "waiting"
        ? sayaRoundedRect(82.5, 11.5, 3, 8, 1.5) + sayaCircle(84, 23.2, 1.7)
        : null,
    zz: mood === "sleeping" ? "M82 16h8l-8 9h8M74 6h5l-5 5.5h5" : null,
  }
}

/** FNV-1a, so a seed (an agent's name) always lands on the same look. */
export function sayaHash(seed: string): number {
  let value = 2166136261
  for (let index = 0; index < seed.length; index++) {
    value ^= seed.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

/** A stable shape and tone for any seed. */
export function sayaPick(seed: string): { shape: SayaShape; tone: SayaTone } {
  const value = sayaHash(seed || "sayabot")
  return {
    shape: SAYA_SHAPES[value % SAYA_SHAPES.length] ?? "ghost",
    tone: SAYA_TONE_NAMES[(value >>> 4) % SAYA_TONE_NAMES.length] ?? "lilac",
  }
}
