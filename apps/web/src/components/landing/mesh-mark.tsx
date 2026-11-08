/**
 * The Sayabot mark: Saya, the first of the family, with the lamp on.
 * The lit lamp is the whole brand in one dot: one voice at a time.
 */
export function SayabotMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={className} aria-hidden="true" focusable="false" fill="none">
      <title>Sayabot</title>
      <rect x="120" y="30" width="16" height="44" rx="8" fill="#c63e4f" />
      <circle cx="128" cy="30" r="26" fill="#ffd08a" />
      <rect x="10" y="118" width="26" height="72" rx="13" fill="#c63e4f" />
      <rect x="220" y="118" width="26" height="72" rx="13" fill="#c63e4f" />
      <rect x="28" y="62" width="200" height="184" rx="76" fill="#ff5d6c" />
      <rect x="54" y="92" width="148" height="122" rx="50" fill="#0e0b12" />
      <rect x="86" y="122" width="28" height="56" rx="14" fill="#fff4ea" />
      <rect x="142" y="122" width="28" height="56" rx="14" fill="#fff4ea" />
    </svg>
  )
}

export const MeshMark = SayabotMark
