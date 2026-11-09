import type { SVGProps } from "react"

type IconProps = SVGProps<SVGSVGElement>

function base(props: IconProps) {
  return {
    width: 18,
    height: 18,
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  }
}

export function SendIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 10h12" />
      <path d="M10 5l5.5 5-5.5 5" />
    </svg>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 4v12M4 10h12" />
    </svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 8l5 5 5-5" />
    </svg>
  )
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 12l5-5 5 5" />
    </svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 10.5l3.5 3.5L16 6" />
    </svg>
  )
}

export function StopIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="6" y="6" width="8" height="8" />
    </svg>
  )
}

export function ReplyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 5L3 10l5 5" />
      <path d="M3 10h8.5A5.5 5.5 0 0 1 17 15.5V16" />
    </svg>
  )
}

export function HistoryIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 10a6 6 0 1 0 1.8-4.3" />
      <path d="M4 4v4h4" />
      <path d="M10 7v3.5l2.5 1.5" />
    </svg>
  )
}

export function CanvasIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="14" height="12" />
      <path d="M3 8h14M8 8v8" />
    </svg>
  )
}

export function RoomsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3" width="6" height="6" />
      <rect x="11" y="3" width="6" height="6" />
      <rect x="3" y="11" width="6" height="6" />
      <rect x="11" y="11" width="6" height="6" />
    </svg>
  )
}

export function AgentsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="14" cy="14" r="2.5" />
      <path d="M8.5 6h3A2.5 2.5 0 0 1 14 8.5v3" />
      <path d="M6 8.5v3A2.5 2.5 0 0 0 8.5 14h3" />
    </svg>
  )
}

export function AnalyticsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 16h14" />
      <path d="M5 13V9M9 13V5M13 13v-3M17 13V7" />
    </svg>
  )
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 3l6 2.5v4.5c0 3.5-2.4 5.8-6 7-3.6-1.2-6-3.5-6-7V5.5L10 3z" />
      <path d="M7.5 10l1.8 1.8 3.4-3.6" />
    </svg>
  )
}

export function SlidersIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 6h5M12 6h5M3 14h9M16 14h1" />
      <rect x="8" y="4" width="3" height="4" />
      <rect x="13" y="12" width="3" height="4" />
    </svg>
  )
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 5h14M3 10h14M3 15h14" />
    </svg>
  )
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="7" y="7" width="9" height="9" />
      <path d="M13 7V4H4v9h3" />
    </svg>
  )
}

export function KeyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="7" cy="12" r="3" />
      <path d="M9.5 10L16 3.5M13 6l2 2M11 8l2 2" />
    </svg>
  )
}

export function BotIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="6" width="12" height="10" />
      <path d="M10 3v3M7 10h.01M13 10h.01M7 14h6" />
    </svg>
  )
}

export function ToolsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13.5 3.5a4 4 0 0 0-5 5L3 14v3h3l5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-2.5 2.5-2.5z" />
    </svg>
  )
}

export function LogoutIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 4H4v12h4" />
      <path d="M8 10h9M14 7l3 3-3 3" />
    </svg>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="9" r="6" />
      <path d="M13.5 13.5L17 17" />
    </svg>
  )
}

export function TraceIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 14l4-4 3 3 5-6" />
      <circle cx="4" cy="14" r="1.5" />
      <circle cx="8" cy="10" r="1.5" />
      <circle cx="11" cy="13" r="1.5" />
      <circle cx="16" cy="7" r="1.5" />
    </svg>
  )
}

