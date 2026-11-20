import { unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import { sayaGeometry } from "../../../packages/core/src/mascot.ts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, "..")

// 1. Get official mascot geometry
const geom = sayaGeometry("ghost", "idle")

// Width and height of DMG window
const W = 660
const H = 400

// Target icon centers (must strictly match apps/desktop/package.json)
const LEFT_CENTER_X = 160
const LEFT_CENTER_Y = 205
const RIGHT_CENTER_X = 500
const RIGHT_CENTER_Y = 205

// Card dimensions
const CARD_SIZE = 120
const CARD_RX = 24
const RING_RADIUS = 44

function generateSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <!-- Solid geometric dot pattern (no gradients) -->
    <pattern id="dotGrid" width="22" height="22" patternUnits="userSpaceOnUse">
      <circle cx="11" cy="11" r="1" fill="#1A1729" />
    </pattern>
  </defs>

  <!-- Solid background -->
  <rect width="${W}" height="${H}" fill="#0C0A13" />
  <rect width="${W}" height="${H}" fill="url(#dotGrid)" />

  <!-- Top Center Icon: Pure mascot SVG without any background rectangle or border -->
  <g transform="translate(330, 46)">
    <!-- Official Sayabot Mascot Geometry (pure solid colors, no background) -->
    <g transform="scale(0.72) translate(-50, -49)">
      <!-- Saaya (shadow layer) translated down by 6 units -->
      <path d="${geom.shell}" fill="#6B59D6" transform="translate(0, 6)" />
      <!-- Base shell -->
      <path d="${geom.shell}" fill="#9D8CFF" />
      <!-- Visor -->
      <rect x="${geom.visor.x}" y="${geom.visor.y}" width="${geom.visor.w}" height="${geom.visor.h}" rx="${geom.visor.r}" fill="#17141F" />
      <!-- Eyes -->
      <path d="${geom.eyesFill}" fill="#ECE8FF" />
    </g>
  </g>

  <!-- Typography Header: Solid white and solid muted violet -->
  <text x="330" y="98" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif" font-size="20" font-weight="700" text-anchor="middle" letter-spacing="-0.3">Install Sayabot</text>
  <text x="330" y="120" fill="#8E8A9F" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', sans-serif" font-size="12" font-weight="400" text-anchor="middle">Drag the Sayabot icon into Applications to complete installation</text>

  <!-- Left Drop Target (Sayabot Icon at 160, 205): Transparent card outline, dashed inner guide (no bg fill) -->
  <g transform="translate(${LEFT_CENTER_X}, ${LEFT_CENTER_Y})">
    <rect x="-${CARD_SIZE / 2}" y="-${CARD_SIZE / 2}" width="${CARD_SIZE}" height="${CARD_SIZE}" rx="${CARD_RX}" fill="none" stroke="#262238" stroke-width="1.5" />
    <circle cx="0" cy="0" r="${RING_RADIUS}" fill="none" stroke="#36304E" stroke-width="1.5" stroke-dasharray="4, 4" />
  </g>

  <!-- Right Drop Target (Applications at 500, 205): Transparent card outline, dashed inner guide (no bg fill) -->
  <g transform="translate(${RIGHT_CENTER_X}, ${RIGHT_CENTER_Y})">
    <rect x="-${CARD_SIZE / 2}" y="-${CARD_SIZE / 2}" width="${CARD_SIZE}" height="${CARD_SIZE}" rx="${CARD_RX}" fill="none" stroke="#262238" stroke-width="1.5" />
    <circle cx="0" cy="0" r="${RING_RADIUS}" fill="none" stroke="#36304E" stroke-width="1.5" stroke-dasharray="4, 4" />
  </g>

  <!-- Center Action & Connector Line: Solid colors only -->
  <g>
    <!-- Left connector segment -->
    <line x1="228" y1="205" x2="272" y2="205" stroke="#2B273F" stroke-width="2" />
    <circle cx="228" cy="205" r="3.5" fill="#7C5CFC" />

    <!-- Right connector segment & Arrow -->
    <line x1="388" y1="205" x2="426" y2="205" stroke="#2B273F" stroke-width="2" />
    <!-- Arrowhead -->
    <path d="M424 199 L432 205 L424 211 Z" fill="#7C5CFC" />

    <!-- Center Pill: Solid background, solid border, solid text -->
    <rect x="272" y="191" width="116" height="28" rx="14" fill="#161426" stroke="#332E4D" stroke-width="1.5" />
    <text x="330" y="209" fill="#A79BFF" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif" font-size="10" font-weight="700" letter-spacing="1.5" text-anchor="middle">DRAG &amp; DROP</text>
  </g>

  <!-- Bottom Divider: Solid 1px line -->
  <line x1="36" y1="356" x2="624" y2="356" stroke="#1B1829" stroke-width="1" />

  <!-- Footer Text: Solid muted neutral -->
  <text x="36" y="377" fill="#5F5A72" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif" font-size="10.5" font-weight="400">Universal Binary (Apple Silicon &amp; Intel) • macOS 13+</text>
  <text x="624" y="377" fill="#5F5A72" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif" font-size="10.5" font-weight="400" text-anchor="end">sayabot.in • Sayalabs Studio</text>
</svg>`
}

const svgContent = generateSvg()
const svgPath = join(rootDir, "build", "dmg-background.svg")
writeFileSync(svgPath, svgContent)
console.log(`Generated SVG: ${svgPath}`)

// HTML wrapper for pixel-perfect headless Chrome rendering
const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: ${W}px;
      height: ${H}px;
      overflow: hidden;
      background: #0C0A13;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    svg {
      display: block;
      width: ${W}px;
      height: ${H}px;
    }
  </style>
</head>
<body>
  ${svgContent}
</body>
</html>`

const htmlPath = join(rootDir, "build", "dmg-background.html")
writeFileSync(htmlPath, htmlContent)
console.log(`Generated HTML: ${htmlPath}`)

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const outPng1x = join(rootDir, "build", "dmg-background.png")
const outPng2x = join(rootDir, "build", "dmg-background@2x.png")

// Render 1x (660x400)
console.log("Rendering 1x PNG...")
execFileSync(chromePath, [
  "--headless",
  "--disable-gpu",
  `--screenshot=${outPng1x}`,
  `--window-size=${W},${H}`,
  htmlPath
])

// Render 2x (1320x800)
console.log("Rendering 2x PNG...")
execFileSync(chromePath, [
  "--headless",
  "--disable-gpu",
  `--screenshot=${outPng2x}`,
  `--window-size=${W},${H}`,
  "--force-device-scale-factor=2",
  htmlPath
])

// Set DPI metadata using macOS sips
execFileSync("sips", ["-s", "dpiWidth", "72", "-s", "dpiHeight", "72", outPng1x])
execFileSync("sips", ["-s", "dpiWidth", "144", "-s", "dpiHeight", "144", outPng2x])

// Clean up temporary HTML
unlinkSync(htmlPath)

console.log("DMG background images generated successfully!")
