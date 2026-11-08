import type { ReactNode } from "react"

/** One heading block for every chapter, so left edges and rhythm always line up. */
export function SectionHead({
  act,
  label,
  title,
  lead,
  center = false,
  className = "",
}: {
  act?: string
  label: string
  title: ReactNode
  lead?: ReactNode
  center?: boolean
  className?: string
}) {
  return (
    <header className={`${center ? "mx-auto text-center" : ""} ${className}`}>
      <span className="l-eyebrow" data-reveal>
        {act ? <b>{act}</b> : null}
        {label}
      </span>
      <h2 className={`l-h2 mt-5 max-w-[17ch] ${center ? "mx-auto" : ""}`} data-split>
        {title}
      </h2>
      {lead ? (
        <p className={`l-lead mt-6 max-w-[52ch] ${center ? "mx-auto" : ""}`} data-reveal>
          {lead}
        </p>
      ) : null}
    </header>
  )
}
