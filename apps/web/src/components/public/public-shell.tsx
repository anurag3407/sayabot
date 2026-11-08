import type { ReactNode } from "react"
import "@fontsource-variable/anybody/wdth.css"
import "@/components/landing/landing.css"
import { SiteHeader } from "@/components/landing/site-header"
import { SiteFooterLinks } from "@/components/landing/site-footer"

/** Chrome for every public page: same header, footer and tokens as the landing page. */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="l-public flex min-h-dvh flex-col bg-void text-text">
      <SiteHeader />
      <main id="main-content" className="flex-1 pt-24 sm:pt-28">
        {children}
      </main>
      <footer className="mt-16 bg-void pt-4">
        <SiteFooterLinks />
      </footer>
    </div>
  )
}
