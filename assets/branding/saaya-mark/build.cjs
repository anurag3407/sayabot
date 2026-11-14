// Sayabot mark — "Saaya" (the shadow you cast).
// A hand-shadow puppet, mid-sentence, inside a pool of light: your hand, your intent, given a life
// of its own. Builds every SVG master + PNG export from one geometry.
// Run from repo root: node assets/branding/saaya-mark/build.cjs
const fs = require("fs")
const path = require("path")
const sharp = require(
  "/Users/jarvis/saaya/node_modules/.pnpm/sharp@0.35.5_@types+node@24.19.2/node_modules/sharp",
)

const OUT = __dirname
const SVG = path.join(OUT, "svg")
const PNG = path.join(OUT, "png")
for (const d of [SVG, PNG]) fs.mkdirSync(d, { recursive: true })

const C = {
  red: "#ff5d6c", // app primary — the field
  ink: "#1b1220", // the shadow
  cream: "#fff4ea", // the light
}

// ── Geometry (1024 grid) ─────────────────────────────────────────────────────
const DISC = { cx: 530, cy: 480, r: 330 }
const ARM = "M168,1300L240,1060C290,880 340,730 372,620L552,620C532,750 516,900 516,1060L496,1300Z"
const HAND = [
  `<path d="${ARM}" stroke-width="40" stroke-linejoin="round"/>`,
  `<rect x="340" y="250" width="240" height="410" rx="110"/>`, // palm / back of head
  `<rect x="440" y="250" width="350" height="96" rx="48"/>`, // index
  `<rect x="440" y="346" width="400" height="96" rx="48"/>`, // middle — the longest, the "snout"
  `<rect x="440" y="442" width="370" height="96" rx="48"/>`, // ring
  `<rect x="440" y="580" width="300" height="92" rx="46" transform="rotate(16 460 600)"/>`, // thumb — the jaw, open
]
const GAPS = "M596,346H780M596,442H800" // finger seams: light leaking between fingers
const EYE = (small) => (small ? { cx: 544, cy: 302, r: 36 } : { cx: 540, cy: 304, r: 27 })

// Hand group; `see` is what shows through the eye + seams (the light behind).
const hand = ({ ink, see, small = false, stroke = true }) => {
  const e = EYE(small)
  return (
    `<g fill="${ink}" stroke="${stroke ? ink : "none"}">${HAND.join("")}</g>` +
    (small ? "" : `<path d="${GAPS}" stroke="${see}" stroke-width="14" stroke-linecap="round" fill="none"/>`) +
    `<circle cx="${e.cx}" cy="${e.cy}" r="${e.r}" fill="${see}"/>`
  )
}

// Silhouette with eye + seams knocked out (true transparency) for mono / notification use.
const handMask = (fill, small = false) => {
  const e = EYE(small)
  return (
    `<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">` +
    `<g fill="#fff" stroke="#fff">${HAND.join("")}</g>` +
    (small ? "" : `<path d="${GAPS}" stroke="#000" stroke-width="14" stroke-linecap="round"/>`) +
    `<circle cx="${e.cx}" cy="${e.cy}" r="${e.r}" fill="#000"/></mask>` +
    `<rect width="1024" height="1024" fill="${fill}" mask="url(#m)"/>`
  )
}

const doc = (inner, title = "Sayabot") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">` +
  `<title>${title}</title>${inner}</svg>\n`

const disc = (fill) => `<circle cx="${DISC.cx}" cy="${DISC.cy}" r="${DISC.r}" fill="${fill}"/>`
// Clip the forearm to the tile so the rounded-square preview stays clean.
const tile = (inner, { rounded, field }) =>
  rounded
    ? `<clipPath id="t"><rect width="1024" height="1024" rx="229"/></clipPath><g clip-path="url(#t)"><rect width="1024" height="1024" fill="${field}"/>${inner}</g>`
    : `<rect width="1024" height="1024" fill="${field}"/>${inner}`

// Maskable / adaptive: shrink the art into the 80% safe zone.
const safe = (inner, s = 0.84) =>
  `<g transform="translate(${512 * (1 - s)} ${512 * (1 - s) + 40}) scale(${s})">${inner}</g>`

const files = {
  // App icon — full-bleed square; iOS / Android / macOS apply their own mask.
  "sayabot-app-icon": doc(tile(disc(C.cream) + hand({ ink: C.ink, see: C.cream }), { field: C.red })),
  "sayabot-app-icon-rounded": doc(
    tile(disc(C.cream) + hand({ ink: C.ink, see: C.cream }), { field: C.red, rounded: true }),
  ),
  // ≤ 32 px: seams dropped, eye enlarged so it survives.
  "sayabot-app-icon-small": doc(
    tile(disc(C.cream) + hand({ ink: C.ink, see: C.cream, small: true }), { field: C.red }),
  ),
  "sayabot-app-icon-maskable": doc(
    `<rect width="1024" height="1024" fill="${C.red}"/>` +
      safe(disc(C.cream) + hand({ ink: C.ink, see: C.cream })),
  ),
  // Dark-mode icon variant.
  "sayabot-app-icon-dark": doc(tile(disc(C.red) + hand({ ink: C.ink, see: C.red }), { field: C.ink })),
  // Symbol on transparent — for light UI: red light pool, ink shadow.
  "sayabot-symbol": doc(
    `<clipPath id="c"><circle cx="${DISC.cx}" cy="${DISC.cy}" r="${DISC.r}"/></clipPath>` +
      disc(C.red) +
      `<g clip-path="url(#c)">${hand({ ink: C.ink, see: C.red })}</g>`,
  ),
  // Symbol for dark UI.
  "sayabot-symbol-dark": doc(
    `<clipPath id="c"><circle cx="${DISC.cx}" cy="${DISC.cy}" r="${DISC.r}"/></clipPath>` +
      disc(C.red) +
      `<g clip-path="url(#c)">${hand({ ink: C.ink, see: C.red })}</g>`,
  ),
  // One-colour silhouettes (Android notification icon, embossing, stamps).
  "sayabot-hand-ink": doc(handMask(C.ink)),
  "sayabot-hand-white": doc(handMask("#ffffff")),
  "sayabot-hand-red": doc(handMask(C.red)),
}

async function main() {
  for (const [name, svg] of Object.entries(files)) fs.writeFileSync(path.join(SVG, `${name}.svg`), svg)

  const r = (name, size) =>
    sharp(Buffer.from(files[name])).resize(size, size).png().toFile(path.join(PNG, `${name}-${size}.png`))
  await Promise.all([
    r("sayabot-app-icon", 1024),
    r("sayabot-app-icon", 512),
    r("sayabot-app-icon", 192),
    r("sayabot-app-icon", 180),
    r("sayabot-app-icon-small", 64),
    r("sayabot-app-icon-small", 32),
    r("sayabot-app-icon-small", 16),
    r("sayabot-app-icon-maskable", 512),
    r("sayabot-app-icon-rounded", 1024),
    r("sayabot-app-icon-dark", 1024),
    r("sayabot-symbol", 512),
    r("sayabot-hand-white", 96),
  ])

  // Size-test sheet: rounded icon 256/128/64, small master 32/16, dark + symbol.
  const comps = []
  let x = 30
  const put = async (name, s, top = 30) => {
    comps.push({ input: await sharp(Buffer.from(files[name])).resize(s, s).png().toBuffer(), left: x, top: top + (256 - s) / 2 })
    x += s + 36
  }
  await put("sayabot-app-icon-rounded", 256)
  await put("sayabot-app-icon-rounded", 128)
  await put("sayabot-app-icon-rounded", 64)
  await put("sayabot-app-icon-small", 32)
  await put("sayabot-app-icon-small", 16)
  await put("sayabot-app-icon-dark", 160)
  await put("sayabot-symbol", 160)
  await put("sayabot-hand-ink", 120)
  await sharp({ create: { width: x, height: 316, channels: 4, background: "#f4f1ec" } })
    .composite(comps)
    .png()
    .toFile(path.join(PNG, "size-test.png"))
  console.log(`wrote ${Object.keys(files).length} svgs`)
}
main()
