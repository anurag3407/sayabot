// Sayabot icon — "Sparkle Bubble": a chat bubble that woke up, with the AI sparkle as its cowlick.
// One geometry → iOS/Android full-bleed, macOS dock (Apple grid), maskable, favicon, mono.
// Run from repo root: node assets/branding/saaya-mark/build.cjs
const fs = require("fs")
const path = require("path")
const sharp = require("/Users/jarvis/saaya/node_modules/.pnpm/sharp@0.35.5_@types+node@24.19.2/node_modules/sharp")
const OUT = __dirname
const INK = "#1b1220"

const star = (cx, cy, R) =>
  `M${cx},${cy - R}Q${cx},${cy} ${cx + R},${cy}Q${cx},${cy} ${cx},${cy + R}Q${cx},${cy} ${cx - R},${cy}Q${cx},${cy} ${cx},${cy - R}Z`
const rr = (x, y, w, h, r) =>
  `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`

const defs = (p) => `<defs>
<linearGradient id="${p}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7886"/><stop offset="1" stop-color="#ee4157"/></linearGradient>
<linearGradient id="${p}body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffe8de"/></linearGradient>
<linearGradient id="${p}gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe9a8"/><stop offset="1" stop-color="#ffbf55"/></linearGradient>
<filter id="${p}sh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="26" stdDeviation="26" flood-color="#8a1426" flood-opacity=".35"/></filter>
<filter id="${p}tile" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#000" flood-opacity=".28"/></filter>
</defs>`

const BODY = `${rr(196, 318, 600, 470, 220)}M300,742C300,812 270,858 228,884C318,888 392,858 440,806Z`
const eyes = (x1, x2, y, w, h, glint = true) =>
  `<g fill="${INK}"><rect x="${x1 - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${w / 2}"/><rect x="${x2 - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${w / 2}"/></g>` +
  (glint ? `<g fill="#fff"><circle cx="${x1 + 10}" cy="${y - h * 0.24}" r="${w * 0.2}"/><circle cx="${x2 + 10}" cy="${y - h * 0.24}" r="${w * 0.2}"/></g>` : "")

// Characters — `p` prefixes gradient ids so several icons can share a page.
const art = {
  bubble: (p, small) =>
    `<g filter="url(#${p}sh)"><path d="${BODY}" fill="url(#${p}body)"/></g>` +
    (small
      ? eyes(424, 580, 552, 96, 168, false) +
        `<path d="${star(774, 278, 150)}" fill="url(#${p}gold)" stroke="#ef4f63" stroke-width="34" paint-order="stroke" stroke-linejoin="round"/>`
      : eyes(424, 584, 548, 76, 142) +
        `<g fill="#ff8a98" opacity=".55"><ellipse cx="338" cy="642" rx="46" ry="25"/><ellipse cx="668" cy="642" rx="46" ry="25"/></g>` +
        `<path d="${star(772, 284, 120)}" fill="url(#${p}gold)" stroke="#ef4f63" stroke-width="30" paint-order="stroke" stroke-linejoin="round"/>` +
        `<path d="${star(642, 194, 40)}" fill="#fff7f0"/>`),
  cursor: (p) =>
    `<g filter="url(#${p}sh)"><path d="M330,220L330,780Q330,840 380,812L500,722L580,872Q604,916 648,896L692,875Q736,854 714,810L636,660L792,644Q848,638 808,596L382,190Q330,152 330,220Z" fill="url(#${p}body)" stroke="url(#${p}body)" stroke-width="40" stroke-linejoin="round"/></g>` +
    eyes(434, 534, 500, 58, 110) +
    `<path d="${star(776, 262, 100)}" fill="url(#${p}gold)"/><path d="${star(864, 392, 36)}" fill="#fff7f0"/>`,
  prompt: (p) =>
    `<g filter="url(#${p}sh)"><path d="${rr(180, 260, 664, 560, 250)}" fill="url(#${p}body)"/></g>` +
    `<g fill="none" stroke="${INK}" stroke-width="58" stroke-linecap="round" stroke-linejoin="round"><path d="M342,530L404,462L466,530"/><path d="M558,530L620,462L682,530"/></g>` +
    `<rect x="460" y="612" width="104" height="54" rx="20" fill="${INK}"/>` +
    `<g fill="#ff8a98" opacity=".55"><ellipse cx="330" cy="622" rx="46" ry="25"/><ellipse cx="694" cy="622" rx="46" ry="25"/></g>` +
    `<path d="${star(812, 240, 94)}" fill="url(#${p}gold)" stroke="#ef4f63" stroke-width="26" paint-order="stroke" stroke-linejoin="round"/>`,
}

const svg = (inner, p) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><title>Sayabot</title>${defs(p)}${inner}</svg>\n`
const full = (a, p, small) => `<rect width="1024" height="1024" fill="url(#${p}bg)"/>${art[a](p, small)}`
const rounded = (a, p, small) =>
  `<clipPath id="${p}clip"><rect width="1024" height="1024" rx="229"/></clipPath><g clip-path="url(#${p}clip)">${full(a, p, small)}</g>`
// macOS Big Sur+ grid: 824 tile centered on 1024 canvas with a soft shadow.
const mac = (a, p) =>
  `<g filter="url(#${p}tile)"><g transform="translate(100 100) scale(${824 / 1024})">${rounded(a, p)}</g></g>`
const maskable = (a, p) =>
  `<rect width="1024" height="1024" fill="url(#${p}bg)"/><g transform="translate(92 92) scale(.82)">${art[a](p)}</g>`
const mono = (fill) =>
  `<mask id="m"><path d="${BODY}" fill="#fff"/>${eyes(424, 584, 548, 76, 142, false).replace(/fill="#1b1220"/, 'fill="#000"')}</mask>` +
  `<rect width="1024" height="1024" fill="${fill}" mask="url(#m)"/><path d="${star(772, 284, 120)}" fill="${fill}"/>`

const files = {
  "sayabot-icon": svg(full("bubble", "a"), "a"), // iOS / Android / PWA — OS masks it
  "sayabot-icon-rounded": svg(rounded("bubble", "a"), "a"), // previews, web
  "sayabot-icon-macos": svg(mac("bubble", "a"), "a"), // desktop dock (.icns source)
  "sayabot-icon-maskable": svg(maskable("bubble", "a"), "a"), // Android adaptive / PWA maskable
  "sayabot-icon-small": svg(rounded("bubble", "a", true), "a"), // favicon / ≤32px
  "sayabot-mono-white": svg(mono("#ffffff"), "a"), // Android notification icon
  "sayabot-mono-ink": svg(mono(INK), "a"),
  "alt-cursor-buddy": svg(rounded("cursor", "b"), "b"),
  "alt-prompt-pal": svg(rounded("prompt", "c"), "c"),
}

;(async () => {
  for (const [n, s] of Object.entries(files)) fs.writeFileSync(path.join(OUT, "svg", `${n}.svg`), s)
  const r = (n, size) => sharp(Buffer.from(files[n])).resize(size, size).png().toFile(path.join(OUT, "png", `${n}-${size}.png`))
  await Promise.all([
    ...[1024, 512, 192, 180].map((s) => r("sayabot-icon", s)),
    r("sayabot-icon-macos", 1024),
    r("sayabot-icon-maskable", 512),
    ...[64, 32, 16].map((s) => r("sayabot-icon-small", s)),
    r("sayabot-mono-white", 96),
    r("sayabot-icon-rounded", 1024),
  ])
  console.log("wrote", Object.keys(files).length, "svgs")
})()
