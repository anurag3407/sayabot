"use client"

import Link from "next/link"

/**
 * Shown to people who opened the desktop app without an account. Their bots, chats and
 * computers already belong to a real (anonymous) user, so saving the account keeps everything.
 */
export function GuestBanner({ orgSlug }: { orgSlug: string }) {
  const next = encodeURIComponent(`/${orgSlug}`)
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-line bg-raised px-4 py-2 text-[13px] md:mx-2 md:mb-2 md:rounded-xl md:border"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate text-muted">
        <span className="text-text">You're using Sayabot as a guest.</span> Save your account to
        keep your bots and use them on your phone or the web.
      </p>
      <Link
        href={`/auth/save-account?next=${next}`}
        className="shrink-0 rounded-sm bg-accent px-3 py-1.5 text-[12px] font-medium text-void hover:bg-[var(--color-accent-strong)]"
      >
        Save account
      </Link>
    </div>
  )
}
