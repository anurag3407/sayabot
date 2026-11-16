import type { ReactNode } from "react"
import { cn } from "@/lib/format"

export type ProviderStatusTone = "ok" | "warn" | "idle"

const TONE: Record<ProviderStatusTone, string> = {
  ok: "bg-ok/10 text-ok",
  warn: "bg-warn/10 text-warn",
  idle: "bg-raised text-faint",
}

export function StatusPill({ tone, children }: { tone: ProviderStatusTone; children: ReactNode }) {
  return (
    <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11.5px]", TONE[tone])}>
      {children}
    </span>
  )
}

/** One provider in Settings → AI providers: what it is, its status, and the controls to set it up. */
export function ProviderCard({
  icon,
  title,
  subtitle,
  status,
  children,
  footnote,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  status?: ReactNode
  children?: ReactNode
  footnote?: ReactNode
}) {
  return (
    <li className="px-4 py-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-raised text-text">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[14px] font-medium text-text">{title}</p>
            {status}
          </div>
          <p className="mt-0.5 text-[12.5px] text-faint">{subtitle}</p>
          {children ? <div className="mt-3">{children}</div> : null}
          {footnote ? (
            <div className="mt-2 text-[12px] leading-relaxed text-faint">{footnote}</div>
          ) : null}
        </div>
      </div>
    </li>
  )
}

/** A titled group of provider cards, with an anchor for the section index. */
export function ProviderSection({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-24">
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h3 id={`${id}-heading`} className="text-[15px] font-medium text-text">
            {title}
          </h3>
          <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function ProviderList({ children }: { children: ReactNode }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
      {children}
    </ul>
  )
}
