# Saya Mascot Geometry

`@sayabot/core/mascot` is the single source of truth for the Saya mascot family: pure geometry, no rendering. Every surface draws the same bots from it, including the web `Mascot`, the in-app `SayabotMark`, the landing page's `Saya`, the mobile `Mascot` and the exported brand files and app icons. It returns SVG path strings on a 100×100 grid that each platform paints with its own primitives (React DOM SVG or `react-native-svg`).

Source files: `packages/core/src/mascot.ts`, `packages/core/src/mascot.test.ts` (re-exported from `packages/core/src/index.ts`; also exposed as the `@sayabot/core/mascot` subpath in `packages/core/package.json`).

## Anatomy

Back to front:

| Layer | What it is | Colour |
| :-- | :-- | :-- |
| saaya | The shell's silhouette again, translated down by `SAYA_SAAYA_OFFSET` (6 units). "Saaya" means shadow | `palette.shade` |
| shell | One rounded silhouette per shape | `palette.base` |
| detail | Optional accent on the shell (only Ledger's folded corner) | `palette.shade` |
| visor | An ink pill, `SAYA_INK` (`#17141f`) | ink |
| eyes | Two marks; moods only change these | `palette.eye` |
| extras | Thought dots, approval badge + "!", or "zz", top right, outside the shell | base / `SAYA_BADGE` (`#ffb547`) |

Every multi-part shell (Bubble's tail, Hoot's tufts, Sprout's leaves, Bloom's lobes, Block's ports) is a union of **clockwise** subpaths, so one `<path>` with the default nonzero fill rule never punches holes. `mascot.test.ts` pins the winding of the hand-reversed subpaths.

## Shapes, tones and moods

```ts
type SayaShape = "ghost" | "peak" | "ledger" | "bubble" | "hoot" | "bloom" | "sprout" | "block"
type SayaMood = "idle" | "thinking" | "working" | "waiting" | "done" | "sleeping"
type SayaTone = "lilac" | "coral" | "blue" | "yellow" | "teal" | "pink" | "green" | "orange"
```

- `SAYA_SHAPE_INFO[shape]` gives each shape's cast name, role and default tone: Saya (ghost, Assistant, lilac), Peak (Chief of Staff, coral), Ledger (Bookkeeper, blue), Bubble (Inbox, yellow), Hoot (Research, teal), Bloom (Social media, pink), Sprout (Growth & SEO, green), Block (Engineer, orange).
- `SAYA_TONES[tone]` is a `{ base, shade, eye }` palette. The six original brand pastels plus green `#8bd46e` and orange `#ff9f43`.
- Moods: `idle` tall capsule eyes · `thinking` eyes up-right plus three ascending dots · `working` horizontal dashes · `waiting` round eyes looking left plus the amber badge and "!" · `done` happy arcs (stroked, `SAYA_EYE_STROKE` = 3) · `sleeping` closed arcs plus "zz" (stroked, `SAYA_ZZ_STROKE` = 2.6).

## API

| Export | Purpose |
| :-- | :-- |
| `sayaGeometry(shape, mood = "idle"): SayaGeometry` | `{ shell, detail, visor: {x,y,w,h,r}, eyesFill, eyesLine, dots, badge, bang, zz }`. Absent parts are `null` |
| `sayaPick(seed)` | Stable `{ shape, tone }` for any seed (an agent's name or handle) |
| `sayaHash(seed)` | The FNV-1a hash behind `sayaPick` |
| `sayaCircle(cx, cy, r)` / `sayaRoundedRect(x, y, w, h, r)` | Clockwise path helpers used by the shells |
| `SAYA_SHAPES`, `SAYA_MOODS`, `SAYA_TONE_NAMES` | Ordered lists |
| `SAYA_INK`, `SAYA_BADGE`, `SAYA_SAAYA_OFFSET`, `SAYA_EYE_STROKE`, `SAYA_ZZ_STROKE` | Shared constants |

Rendering one mascot:

```tsx
import { SAYA_INK, SAYA_SAAYA_OFFSET, SAYA_TONES, sayaGeometry } from "@sayabot/core/mascot"

const g = sayaGeometry("ledger", "waiting")
const t = SAYA_TONES.blue
<svg viewBox="0 0 100 100">
  <path d={g.shell} fill={t.shade} transform={`translate(0 ${SAYA_SAAYA_OFFSET})`} />
  <path d={g.shell} fill={t.base} />
  {g.detail && <path d={g.detail} fill={t.shade} />}
  <rect x={g.visor.x} y={g.visor.y} width={g.visor.w} height={g.visor.h} rx={g.visor.r} fill={SAYA_INK} />
  {g.eyesFill && <path d={g.eyesFill} fill={t.eye} />}
  {g.badge && <path d={g.badge} fill="#ffb547" />}
  {g.bang && <path d={g.bang} fill={SAYA_INK} />}
</svg>
```

## Consumers

- Web: `apps/web/src/components/ui/mascot.tsx` (seeded `Mascot`, maps the app moods `happy/sleep/busy/alert` onto `done/sleeping/working/waiting`) and `landing/mesh-mark.tsx` (`SayabotMark`).
- Landing: `apps/landing/src/components/saya.tsx`, `final-cta.tsx`.
- Mobile: `apps/mobile/src/ui/Mascot.tsx`. `metro.config.js` aliases the `@sayabot/core/mascot` subpath to the source file because Expo 52's Metro ignores package `exports`.
- Brand exports: `apps/web/scripts/export-mascots.ts` (`brand:mascots`) and `export-icons.ts` (`brand:icons`).

## Related docs

- [web/pages/ui-shell-and-kit](../web/pages/ui-shell-and-kit.md): `Mascot`, `LiveMascot`, brand and icon exports
- [mobile/settings-and-ui-kit](../mobile/settings-and-ui-kit.md): the mobile `Mascot`
- [landing/overview](../landing/overview.md): the public landing site
