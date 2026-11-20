import Link from "next/link"
import type { ReactNode } from "react"
import { PublicShell } from "@/components/public/public-shell"

export function DocPage({
  eyebrow,
  title,
  lede,
  draft = false,
  children,
}: {
  eyebrow: string
  title: string
  lede: string
  draft?: boolean
  children: ReactNode
}) {
  return (
    <PublicShell>
      <article className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8">
        <p className="font-mono text-[12px] text-faint">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-medium tracking-[-0.02em]">{title}</h1>
        <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-muted">{lede}</p>
        {draft ? (
          <div className="mt-6 rounded-sm border border-[color-mix(in_srgb,var(--color-warn)_45%,transparent)] bg-panel px-3 py-2">
            <p className="font-mono text-[11px] leading-relaxed text-warn">
              Draft. This is a working draft for the operator of this deployment to review with
              counsel before publishing. It is not legal advice.
            </p>
          </div>
        ) : null}
        <div className="mt-8 space-y-8">{children}</div>
        <p className="mt-10 border-t border-line pt-4 font-mono text-[11px] leading-relaxed text-faint">
          <Link href="/" className="hover:text-text">
            back to sayabot
          </Link>{" "}
          ·{" "}
          <Link href="/security" className="hover:text-text">
            security
          </Link>{" "}
          ·{" "}
          <Link href="/privacy" className="hover:text-text">
            privacy
          </Link>{" "}
          ·{" "}
          <Link href="/terms" className="hover:text-text">
            terms
          </Link>
        </p>
      </article>
    </PublicShell>
  )
}

export function DocSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[16px] font-medium">{title}</h2>
      <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-muted">{children}</div>
    </section>
  )
}

export function DocList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 pl-5">
      {items.map((item) => (
        <li key={item} className="list-disc">
          {item}
        </li>
      ))}
    </ul>
  )
}
