import { useId } from "react"
import { SAYA_INK, SAYA_SAAYA_OFFSET, SAYA_TONES, sayaGeometry } from "@sayabot/core"

const ghost = sayaGeometry("ghost", "idle")
const tone = SAYA_TONES.lilac

/**
 * Sayabot app icon: Saya the ghost (the family's face) on an ink tile, drawn from the shared
 * mascot geometry. Same mark as the exported icons in assets/branding/saya-icon
 * (pnpm --filter @sayabot/web brand:icons).
 */
export function SayabotMark({ className = "h-8 w-8" }: { className?: string }) {
  const p = `mk${useId().replace(/[^a-zA-Z0-9]/g, "")}`
  const { x, y, w, h, r } = ghost.visor
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false">
      <title>Sayabot</title>
      <defs>
        <linearGradient id={`${p}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f1a33" />
          <stop offset="1" stopColor="#0b0a10" />
        </linearGradient>
        <radialGradient id={`${p}gl`} cx="0.5" cy="0.62" r="0.5">
          <stop offset="0" stopColor={tone.base} stopOpacity="0.42" />
          <stop offset="1" stopColor={tone.base} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" rx="22.4" fill={`url(#${p}bg)`} />
      <rect width="100" height="100" rx="22.4" fill={`url(#${p}gl)`} />
      <g transform="translate(10.94 7.81) scale(0.78125)">
        <path d={ghost.shell} fill={tone.shade} transform={`translate(0 ${SAYA_SAAYA_OFFSET})`} />
        <path d={ghost.shell} fill={tone.base} />
        <rect x={x} y={y} width={w} height={h} rx={r} fill={SAYA_INK} />
        {ghost.eyesFill ? <path d={ghost.eyesFill} fill={tone.eye} /> : null}
      </g>
    </svg>
  )
}

export const MeshMark = SayabotMark
