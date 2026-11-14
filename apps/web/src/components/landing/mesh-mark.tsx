import { useId } from "react"

/**
 * Sayabot app icon: a chat bubble with a face and a gold AI sparkle.
 * Source of truth: assets/branding/saaya-mark/svg/sayabot-icon-rounded.svg
 */
export function SayabotMark({ className = "h-8 w-8" }: { className?: string }) {
  const p = `mk${useId().replace(/:/g, "")}`
  return (
    <svg viewBox="0 0 1024 1024" className={className} aria-hidden="true" focusable="false">
      <title>Sayabot</title>
      <defs>
        <linearGradient id={`${p}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff7886" />
          <stop offset="1" stopColor="#ee4157" />
        </linearGradient>
        <linearGradient id={`${p}body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#ffe8de" />
        </linearGradient>
        <linearGradient id={`${p}gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe9a8" />
          <stop offset="1" stopColor="#ffbf55" />
        </linearGradient>
        <filter id={`${p}sh`} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="26" stdDeviation="26" floodColor="#8a1426" floodOpacity="0.35" />
        </filter>
        <clipPath id={`${p}clip`}>
          <rect width="1024" height="1024" rx="229" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${p}clip)`}>
        <rect width="1024" height="1024" fill={`url(#${p}bg)`} />
        <g filter={`url(#${p}sh)`}>
          <path
            d="M416,318H576A220,220 0 0 1 796,538V568A220,220 0 0 1 576,788H416A220,220 0 0 1 196,568V538A220,220 0 0 1 416,318ZM300,742C300,812 270,858 228,884C318,888 392,858 440,806Z"
            fill={`url(#${p}body)`}
          />
        </g>
        <g fill="#1b1220">
          <rect x="386" y="477" width="76" height="142" rx="38" />
          <rect x="546" y="477" width="76" height="142" rx="38" />
        </g>
        <g fill="#fff">
          <circle cx="434" cy="513.92" r="15.2" />
          <circle cx="594" cy="513.92" r="15.2" />
        </g>
        <g fill="#ff8a98" opacity="0.55">
          <ellipse cx="338" cy="642" rx="46" ry="25" />
          <ellipse cx="668" cy="642" rx="46" ry="25" />
        </g>
        <path
          d="M772,164Q772,284 892,284Q772,284 772,404Q772,284 652,284Q772,284 772,164Z"
          fill={`url(#${p}gold)`}
          stroke="#ef4f63"
          strokeWidth="30"
          paintOrder="stroke"
          strokeLinejoin="round"
        />
        <path d="M642,154Q642,194 682,194Q642,194 642,234Q642,194 602,194Q642,194 642,154Z" fill="#fff7f0" />
      </g>
    </svg>
  )
}

export const MeshMark = SayabotMark
