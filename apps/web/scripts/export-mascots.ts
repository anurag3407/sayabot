/**
 * Exports the Saya family as standalone SVG files for branding (pnpm --filter @sayabot/web
 * brand:mascots). Renders the real <Mascot> component, then makes each file self-contained:
 * CSS variables and color-mix() become plain hex (so Figma, Illustrator and browsers agree),
 * ids are namespaced, and the canvas is padded so halos, extras and shadows are not clipped.
 *
 *   <name>.svg        static, halo lit: logos, stickers, print
 *   <name>-live.svg   animated with embedded CSS (hover, blink; the rare one also
 *                     shimmers and sparkles). Animates in <img>, browsers and most viewers.
 *
 * Output: apps/web/public/brand/mascots/ (served at /brand/mascots/*), and the live trio is
 * copied into the Mac app's renderer for its sign-in screens.
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Mascot, RARE_MASCOT, type MascotMood } from "../src/components/ui/mascot"

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, "../public/brand/mascots")
const DESKTOP = join(here, "../../desktop/src/renderer/mascots")

/** Mirrors the tokens in src/app/globals.css. */
const TOKENS: Record<string, string> = {
  "--color-accent": "#9d8cff",
  "--color-m-pink": "#ee5fb8",
  "--color-m-yellow": "#f2c14e",
  "--color-m-teal": "#4fcdb0",
  "--color-m-blue": "#5b9df5",
  "--color-m-lilac": "#b79cf0",
  "--color-m-coral": "#ff7a70",
  "--color-m-prism": "#a5b4fc",
}

/** Who is who. Third-party tool names in the in-app cast are left out of brand files. */
const CAST: { name: string; role: string }[] = [
  { name: "Saya", role: "The face of Sayabot" },
  { name: RARE_MASCOT, role: "Rare. Reserved for the orchestrator" },
  { name: "Pip", role: "Curious helper" },
  { name: "Moss", role: "Calm and steady" },
  { name: "Juno", role: "Organiser" },
  { name: "Tofu", role: "Soft-spoken researcher" },
  { name: "Nori", role: "Builder" },
  { name: "Bean", role: "Energetic doer" },
  { name: "Olive", role: "Careful reviewer" },
  { name: "Miso", role: "Friendly connector" },
]

// ---------- colour: CSS color-mix(in oklab, …) to hex ----------

type Rgb = [number, number, number]

function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "")
  const full = value.length === 3 ? [...value].map((c) => c + c).join("") : value
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as Rgb
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function toOklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function fromOklab([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => Math.min(1, Math.max(0, toGamma(c)))) as Rgb
}

function rgbToHex(rgb: Rgb): string {
  return `#${rgb
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`
}

function mixOklab(a: string, weight: number, b: string): string {
  const [x, y] = [toOklab(hexToRgb(a)), toOklab(hexToRgb(b))]
  return rgbToHex(fromOklab(x.map((v, i) => v * weight + y[i]! * (1 - weight)) as Rgb))
}

function resolveColours(svg: string): string {
  let out = svg.replace(/var\((--[\w-]+)\)/g, (match, name: string) => TOKENS[name] ?? match)
  const mix = /color-mix\(in oklab,\s*(#[0-9a-fA-F]{3,6})\s+([\d.]+)%,\s*(#[0-9a-fA-F]{3,6})\)/
  while (mix.test(out)) {
    out = out.replace(mix, (_m, a: string, p: string, b: string) => mixOklab(a, Number(p) / 100, b))
  }
  return out
}

// ---------- making a file self-contained ----------

const LIVE_CSS = `
.saya-float{animation:saya-bob 3.6s ease-in-out infinite}
.mascot-eyes{transform-box:fill-box;transform-origin:center;animation:saya-blink 5.6s infinite}
.saya-halo{animation:saya-halo 1.8s ease-in-out infinite}
.saya-shadow{transform-box:fill-box;transform-origin:center;animation:saya-pool 3.6s ease-in-out infinite}
.saya-prism{animation:saya-prism 9s linear infinite}
.saya-spark{transform-box:fill-box;transform-origin:center;animation:saya-spark 2.4s ease-in-out infinite}
.saya-spark:nth-of-type(2){animation-delay:.8s}.saya-spark:nth-of-type(3){animation-delay:1.6s}.saya-spark:nth-of-type(4){animation-delay:1.2s}
@keyframes saya-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes saya-blink{0%,45%,49%,100%{transform:scaleY(1)}47%{transform:scaleY(.08)}}
@keyframes saya-halo{0%,100%{opacity:.32}50%{opacity:.12}}
@keyframes saya-pool{0%,100%{transform:scaleX(1);opacity:1}50%{transform:scaleX(.82);opacity:.6}}
@keyframes saya-prism{to{filter:hue-rotate(360deg)}}
@keyframes saya-spark{0%,100%{opacity:0;transform:scale(.4)}50%{opacity:1;transform:scale(1) rotate(45deg)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`

function finish(
  markup: string,
  prefix: string,
  { live, figure }: { live: boolean; figure: boolean },
): string {
  let svg = resolveColours(markup)
  // Namespaced ids, so several mascots can share one page or one design file.
  svg = svg
    .replace(/id="([^"]+)"/g, `id="${prefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
  // Halo glowing as a plain attribute (no stylesheet needed for static use).
  svg = svg.replace(/class="saya-halo"/g, `class="saya-halo" opacity="${live ? "0.32" : "0.24"}"`)
  // Gradient stops as attributes (design tools ignore some inline styles); the pointer-tracking
  // eye offset only means something inside the app.
  svg = svg.replace(/ style="([^"]*stop-color[^"]*)"/g, (_m, css: string) =>
    css
      .split(";")
      .filter(Boolean)
      .map((rule) => {
        const [key, value] = rule.split(":")
        return ` ${key?.trim()}="${value?.trim()}"`
      })
      .join(""),
  )
  svg = svg.replace(/ style="[^"]*var\(--l[xy][^"]*"/g, "")
  svg = svg.replace(/ (aria-hidden|focusable|data-lit|data-mood)="[^"]*"/g, "")
  svg = svg.replace(/class="saya-live"\s?/, "")
  const box = figure ? "-6 -6 112 158" : "-6 -6 112 116"
  const height = figure ? 704 : 512
  svg = svg.replace(
    /^<svg[^>]*>/,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="${Math.round((112 / (figure ? 158 : 116)) * height)}" height="${height}">` +
      (live ? `<style>${LIVE_CSS}</style>` : ""),
  )
  if (live)
    svg = svg.replace("</defs>", '</defs><g class="saya-float">').replace(/<\/svg>$/, "</g></svg>")
  return `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`
}

function render(
  name: string,
  opts: { mood?: MascotMood; live?: boolean; figure?: boolean } = {},
): string {
  const markup = renderToStaticMarkup(
    createElement(Mascot, {
      seed: name,
      lit: true,
      shadow: true,
      mood: opts.mood ?? "idle",
      live: opts.live,
      blink: opts.live,
      figure: opts.figure,
    }),
  )
  return finish(markup, slug(name), { live: Boolean(opts.live), figure: Boolean(opts.figure) })
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-")

function write(file: string, content: string) {
  writeFileSync(join(OUT, file), content)
}

// ---------- the files ----------

mkdirSync(OUT, { recursive: true })

for (const { name } of CAST) {
  write(`${slug(name)}.svg`, render(name))
  write(`${slug(name)}-live.svg`, render(name, { live: true }))
}

for (const name of ["Saya", RARE_MASCOT]) {
  write(`${slug(name)}-figure.svg`, render(name, { figure: true }))
  write(`${slug(name)}-figure-live.svg`, render(name, { figure: true, live: true }))
}

for (const mood of ["happy", "busy", "sleep", "alert", "thinking"] as const) {
  write(`saya-${mood}.svg`, render("Saya", { mood }))
}

// A contact sheet of the whole cast, names underneath.
const cell = 120
const columns = 5
const rows = Math.ceil(CAST.length / columns)
const tiles = CAST.map(({ name }, index) => {
  const inner = render(name)
    .replace(/^<\?xml[^>]*>\n/, "")
    .replace(
      / width="\d+" height="\d+"/,
      ` x="${(index % columns) * cell + 10}" y="${Math.floor(index / columns) * (cell + 24) + 10}" width="100" height="104"`,
    )
  const tx = (index % columns) * cell + 60
  const ty = Math.floor(index / columns) * (cell + 24) + 132
  return `${inner}<text x="${tx}" y="${ty}" text-anchor="middle" font-family="Geist, -apple-system, Helvetica, Arial, sans-serif" font-size="11" fill="#ededf0">${name}${name === RARE_MASCOT ? " ✦" : ""}</text>`
}).join("")
write(
  "cast.svg",
  `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${columns * cell} ${rows * (cell + 24) + 8}" width="${columns * cell * 2}" height="${(rows * (cell + 24) + 8) * 2}"><rect width="100%" height="100%" rx="16" fill="#09090b"/>${tiles}</svg>\n`,
)

write(
  "README.md",
  `# The Saya family

Sayabot's mascots, exported from \`apps/web/src/components/ui/mascot.tsx\` by
\`pnpm --filter @sayabot/web brand:mascots\`. Regenerate after changing the component; do not edit
these files by hand.

| File | Use |
| :-- | :-- |
| \`<name>.svg\` | Static, halo lit. Logos, stickers, social images, print. |
| \`<name>-live.svg\` | Animated with embedded CSS (hover, blink). Web and app screens. |
| \`saya-figure.svg\`, \`nova-figure.svg\` (+ \`-live\`) | Standing on a floor pool with headroom for mood extras. Hero art. |
| \`saya-{happy,busy,sleep,alert,thinking}.svg\` | Saya's moods for states and empty screens. |
| \`cast.svg\` | Contact sheet of the whole family. |

Every Saya is one soft shape, an ink visor and two lit eyes, over its own saaya (the darker
layer underneath). A lit halo means one thing across the brand: it is this agent's turn.

${CAST.map(({ name, role }) => `- **${name}**: ${role}`).join("\n")}
`,
)

// The Mac app's sign-in screens use the live trio.
mkdirSync(DESKTOP, { recursive: true })
for (const name of ["pip", slug(RARE_MASCOT), "moss"])
  copyFileSync(join(OUT, `${name}-live.svg`), join(DESKTOP, `${name}-live.svg`))

console.log(`Wrote ${CAST.length * 2 + 9 + 2} files to ${OUT}`)
