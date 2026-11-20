/**
 * Exports the Saya app icon everywhere it ships (pnpm --filter @sayabot/web brand:icons).
 * One mark, drawn from the shared mascot geometry in @sayabot/core: Saya the ghost on an
 * ink tile. Writes:
 *
 *   assets/branding/saya-icon/       source SVGs (rounded, square, mac, maskable, glyph)
 *   apps/web/public/                 icon.svg, favicon.ico, icon-192/512, apple-touch, maskable
 *   apps/landing/public/             icon.svg, favicon.ico, apple-touch-icon.png, og.png
 *   apps/desktop/assets/icon.png     macOS icon (padded squircle), then build/icon.ico
 *   apps/desktop/src/renderer/mark.svg
 *   apps/mobile/assets/              icon, adaptive-icon, splash-icon, favicon, mark, notification-icon
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import {
  SAYA_INK,
  SAYA_SAAYA_OFFSET,
  SAYA_SHAPE_INFO,
  SAYA_SHAPES,
  SAYA_TONES,
  sayaGeometry,
  type SayaShape,
} from "@sayabot/core"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const out = (...parts: string[]) => join(root, ...parts)

const TILE_TOP = "#1f1a33"
const TILE_BOTTOM = "#0b0a10"
const GLOW = "#9d8cff"

/** One mascot as SVG markup, scaled so its shell is `width` px wide and centred on (cx, cy). */
function mascot(
  shape: SayaShape,
  cx: number,
  cy: number,
  width: number,
  opts: { glyph?: boolean } = {},
): string {
  const g = sayaGeometry(shape, "idle")
  const tone = SAYA_TONES[SAYA_SHAPE_INFO[shape].tone]
  const s = width / 64
  // Shell spans roughly 18..84 (+6 saaya); centre on the visual middle of shell + saaya.
  const tx = cx - 50 * s
  const ty = cy - 54 * s
  const t = `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(4)})`
  const { x, y, w, h, r } = g.visor
  if (opts.glyph) {
    // Android notification icons are alpha-only: white silhouette, visor cut out, eyes back in.
    return (
      `<defs><mask id="m"><rect width="100%" height="100%" fill="#000"/>` +
      `<path d="${g.shell}" fill="#fff" transform="${t}"/>` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#000" transform="${t}"/>` +
      `<path d="${g.eyesFill}" fill="#fff" transform="${t}"/></mask></defs>` +
      `<rect width="100%" height="100%" fill="#fff" mask="url(#m)"/>`
    )
  }
  return (
    `<g transform="${t}">` +
    `<path d="${g.shell}" fill="${tone.shade}" transform="translate(0 ${SAYA_SAAYA_OFFSET})"/>` +
    `<path d="${g.shell}" fill="${tone.base}"/>` +
    (g.detail ? `<path d="${g.detail}" fill="${tone.shade}"/>` : "") +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${SAYA_INK}"/>` +
    `<path d="${g.eyesFill}" fill="${tone.eye}"/>` +
    `</g>`
  )
}

/** The tile: ink gradient, a soft lilac glow under Saya, and Saya. */
function icon({
  size = 1024,
  inset = 0,
  radius = 0,
  mascotScale = 0.5,
  shadow = false,
}: {
  size?: number
  inset?: number
  radius?: number
  mascotScale?: number
  shadow?: boolean
}): string {
  const box = size - inset * 2
  const c = size / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    `<title>Sayabot</title><defs>` +
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${TILE_TOP}"/><stop offset="1" stop-color="${TILE_BOTTOM}"/></linearGradient>` +
    `<radialGradient id="glow" cx="0.5" cy="0.62" r="0.5"><stop offset="0" stop-color="${GLOW}" stop-opacity="0.42"/><stop offset="1" stop-color="${GLOW}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="pool"><stop offset="0" stop-color="${GLOW}" stop-opacity="0.55"/><stop offset="1" stop-color="${GLOW}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.16"/><stop offset="0.4" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    (shadow
      ? `<filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="${size * 0.012}" stdDeviation="${size * 0.018}" flood-color="#000" flood-opacity="0.45"/></filter>`
      : "") +
    `</defs>` +
    `<g${shadow ? ' filter="url(#sh)"' : ""}>` +
    `<rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${radius}" fill="url(#bg)"/>` +
    `<rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${radius}" fill="url(#glow)"/>` +
    (radius
      ? `<rect x="${inset + 1.5}" y="${inset + 1.5}" width="${box - 3}" height="${box - 3}" rx="${radius - 1.5}" fill="none" stroke="url(#rim)" stroke-width="3"/>`
      : "") +
    `</g>` +
    `<ellipse cx="${c}" cy="${inset + box * 0.84}" rx="${box * mascotScale * 0.42}" ry="${box * 0.035}" fill="url(#pool)"/>` +
    mascot("ghost", c, inset + box * 0.5, box * mascotScale) +
    `</svg>`
  )
}

/** Mascot alone on transparent (splash, adaptive foreground) or as a white glyph. */
function bare(size: number, scale: number, glyph = false): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    mascot("ghost", size / 2, size / 2, size * scale, { glyph }) +
    `</svg>`
  )
}

/** The social card: the cast on a floor, the name and the line. */
function ogCard(): string {
  const W = 1200
  const H = 630
  const shapes = SAYA_SHAPES.filter((shape) => shape !== "ghost")
  const order: SayaShape[] = [
    shapes[5]!,
    shapes[2]!,
    shapes[1]!,
    "ghost",
    shapes[6]!,
    shapes[3]!,
    shapes[0]!,
  ]
  const gap = 150
  const start = W / 2 - gap * 3
  const cast = order
    .map((shape, index) => {
      const big = shape === "ghost"
      return mascot(shape, start + index * gap, big ? 430 : 452, big ? 150 : 100)
    })
    .join("")
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<defs><radialGradient id="g" cx="0.5" cy="0.78" r="0.6"><stop offset="0" stop-color="${GLOW}" stop-opacity="0.32"/><stop offset="1" stop-color="${GLOW}" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="#08080a"/><rect width="${W}" height="${H}" fill="url(#g)"/>` +
    `<text x="${W / 2}" y="150" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="700" font-size="92" letter-spacing="-3" fill="#f4f3f8">Sayabot</text>` +
    `<text x="${W / 2}" y="214" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="34" fill="#a6a4b0">Remote agents that keep working while you're away</text>` +
    `<line x1="120" y1="520" x2="${W - 120}" y2="520" stroke="#ffffff" stroke-opacity="0.08"/>` +
    cast +
    `</svg>`
  )
}

/** PNG-in-ICO with several sizes (Vista+ format; every browser and Windows reads it). */
async function ico(svg: string, sizes: number[]): Promise<Buffer> {
  const pngs = await Promise.all(
    sizes.map((size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()),
  )
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let offset = 6 + 16 * pngs.length
  const entries = pngs.map((png, index) => {
    const size = sizes[index]!
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...pngs])
}

async function png(svg: string, file: string, size?: number | [number, number]) {
  mkdirSync(dirname(file), { recursive: true })
  let pipeline = sharp(Buffer.from(svg), { density: 288 })
  if (size)
    pipeline = Array.isArray(size) ? pipeline.resize(size[0], size[1]) : pipeline.resize(size, size)
  await pipeline.png().toFile(file)
}

async function webp(svg: string, file: string, size?: number | [number, number]) {
  mkdirSync(dirname(file), { recursive: true })
  let pipeline = sharp(Buffer.from(svg), { density: 288 })
  if (size)
    pipeline = Array.isArray(size) ? pipeline.resize(size[0], size[1]) : pipeline.resize(size, size)
  await pipeline.webp({ lossless: true }).toFile(file)
}

function svgFile(svg: string, file: string) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${svg}\n`)
}

// ---------- the variants ----------

const rounded = icon({ radius: 229, mascotScale: 0.5 })
const circle = icon({ radius: 512, mascotScale: 0.5 })
const square = icon({ mascotScale: 0.5 })
const mac = icon({ inset: 100, radius: 185, mascotScale: 0.5, shadow: true })
const maskable = icon({ mascotScale: 0.38 })
const adaptive = bare(1024, 0.42)
const splash = bare(1024, 0.5)
const glyph = bare(96, 0.7, true)

/** Favicon: Mascot alone on transparent background, scaled to fill the icon without tile. */
function faviconBare(size = 1024, scale = 0.94): string {
  const g = sayaGeometry("ghost", "idle")
  const tone = SAYA_TONES.lilac
  const s = (size * scale) / 64
  // Ghost shell: X from 22 to 78 (width 56), Y from 18 to 80 with shadow (height 62)
  // Center is at X=50, Y=49. Centering on (size/2, size/2):
  const tx = (size / 2 - 50 * s).toFixed(2)
  const ty = (size / 2 - 49 * s).toFixed(2)
  const t = `translate(${tx} ${ty}) scale(${s.toFixed(4)})`
  const { x, y, w, h, r } = g.visor

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    `<title>Sayabot</title>` +
    `<g transform="${t}">` +
    `<path d="${g.shell}" fill="${tone.shade}" transform="translate(0 ${SAYA_SAAYA_OFFSET})"/>` +
    `<path d="${g.shell}" fill="${tone.base}"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${SAYA_INK}"/>` +
    `<path d="${g.eyesFill}" fill="${tone.eye}"/>` +
    `</g>` +
    `</svg>`
  )
}

const faviconMark = faviconBare(1024, 0.94)

const ANDROID_DENSITIES = [
  { name: "mdpi", icon: 48, foreground: 108, splash: 288 },
  { name: "hdpi", icon: 72, foreground: 162, splash: 432 },
  { name: "xhdpi", icon: 96, foreground: 216, splash: 576 },
  { name: "xxhdpi", icon: 144, foreground: 324, splash: 864 },
  { name: "xxxhdpi", icon: 192, foreground: 432, splash: 1152 },
]

const brand = out("assets/branding/saya-icon")
svgFile(rounded, join(brand, "saya-icon-rounded.svg"))
svgFile(square, join(brand, "saya-icon-square.svg"))
svgFile(mac, join(brand, "saya-icon-mac.svg"))
svgFile(maskable, join(brand, "saya-icon-maskable.svg"))
svgFile(glyph, join(brand, "saya-glyph.svg"))
writeFileSync(
  join(brand, "README.md"),
  `# Saya app icon

Generated by \`pnpm --filter @sayabot/web brand:icons\` (apps/web/scripts/export-icons.ts) from the
shared mascot geometry in \`packages/core/src/mascot.ts\`. Do not edit by hand; change the script and
re-run it. It also writes every platform's icon files (web, landing, desktop, mobile).

| File | Use |
| :-- | :-- |
| \`saya-icon-rounded.svg\` | Web favicon / PWA "any" icon, desktop renderer mark |
| \`saya-icon-square.svg\` | Full-bleed tile for iOS / Android launchers (the OS masks it) |
| \`saya-icon-mac.svg\` | macOS icon: padded squircle with shadow |
| \`saya-icon-maskable.svg\` | PWA maskable icon (Saya inside the safe zone) |
| \`saya-glyph.svg\` | Alpha-only glyph for Android notifications |
`,
)

await Promise.all([
  // web
  Promise.resolve(svgFile(faviconMark, out("apps/web/public/icon.svg"))),
  png(rounded, out("apps/web/public/icon-192.png"), 192),
  png(rounded, out("apps/web/public/icon-512.png"), 512),
  png(square, out("apps/web/public/apple-touch-icon.png"), 180),
  png(maskable, out("apps/web/public/maskable-512.png"), 512),
  ico(faviconMark, [16, 32, 48]).then((buffer) =>
    writeFileSync(out("apps/web/public/favicon.ico"), buffer),
  ),
  // landing
  Promise.resolve(svgFile(faviconMark, out("apps/landing/public/icon.svg"))),
  png(square, out("apps/landing/public/apple-touch-icon.png"), 180),
  ico(faviconMark, [16, 32, 48]).then((buffer) =>
    writeFileSync(out("apps/landing/public/favicon.ico"), buffer),
  ),
  png(ogCard(), out("apps/landing/public/og.png"), [1200, 630]),
  // desktop (bare mascot on transparent background so dragged icon has no bg tile)
  png(bare(1024, 0.82), out("apps/desktop/assets/icon.png"), 1024),
  Promise.resolve(svgFile(rounded, out("apps/desktop/src/renderer/mark.svg"))),
  ico(bare(1024, 0.82), [16, 32, 48, 256]).then((buffer) =>
    writeFileSync(out("apps/desktop/build/icon.ico"), buffer),
  ),
  // mobile (assets and native Android mipmaps)
  png(square, out("apps/mobile/assets/icon.png"), 1024),
  png(adaptive, out("apps/mobile/assets/adaptive-icon.png"), 1024),
  png(splash, out("apps/mobile/assets/splash-icon.png"), 1024),
  png(faviconMark, out("apps/mobile/assets/favicon.png"), 48),
  png(rounded, out("apps/mobile/assets/mark.png"), 256),
  png(glyph, out("apps/mobile/assets/notification-icon.png"), 96),
  ...ANDROID_DENSITIES.flatMap((d) => [
    webp(
      adaptive,
      out(`apps/mobile/android/app/src/main/res/mipmap-${d.name}/ic_launcher_foreground.webp`),
      d.foreground,
    ),
    webp(
      rounded,
      out(`apps/mobile/android/app/src/main/res/mipmap-${d.name}/ic_launcher.webp`),
      d.icon,
    ),
    webp(
      circle,
      out(`apps/mobile/android/app/src/main/res/mipmap-${d.name}/ic_launcher_round.webp`),
      d.icon,
    ),
    png(
      splash,
      out(`apps/mobile/android/app/src/main/res/drawable-${d.name}/splashscreen_logo.png`),
      d.splash,
    ),
  ]),
])

console.log("Wrote the Saya icon to web, landing, desktop, mobile and assets/branding/saya-icon")
