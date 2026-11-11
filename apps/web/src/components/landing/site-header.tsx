"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { ArrowRight, ArrowUpRight, Menu, X } from "lucide-react"
import { SayabotMark } from "./sayabot-mark"

const NAV = [
  { href: "/#collab", label: "Collaboration" },
  { href: "/#features", label: "Features" },
  { href: "/download", label: "Download" },
  { href: "/#mcp", label: "MCP" },
  { href: "/#how", label: "How it works" },
  { href: "/#compare", label: "Compare" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/help", label: "Docs" },
]

export function SiteHeader() {
  const ref = useRef<HTMLElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => el.toggleAttribute("data-scrolled", window.scrollY > 24)
    update()
    window.addEventListener("scroll", update, { passive: true })
    return () => window.removeEventListener("scroll", update)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <header ref={ref} className="l-header fixed inset-x-0 top-0 z-50">
      <div className="l-header-bar">
        <div className="flex h-14 items-center justify-between pl-4 pr-2 sm:pl-5">
          <Link href="/" className="flex items-center gap-2" aria-label="Sayabot home">
            <SayabotMark className="h-7 w-7" />
            <span className="text-[20px] font-[800] leading-none text-text" style={{ fontFamily: "'Anybody Variable', var(--font-sans)", fontStretch: "80%" }}>sayabot</span>
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-6 lg:flex">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="l-navlink">
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
            <Link href="/login" className="hidden h-9 items-center rounded-lg px-3 text-[13px] text-muted transition-colors hover:text-text sm:inline-flex">
              Sign in
            </Link>
            <Link href="/signup" className="l-btn l-btn-primary !h-10 !px-4 !text-[13.5px]">
              Get started
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-text lg:hidden"
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label={open ? "Close menu" : "Open menu"}
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {open && (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="mx-3 mt-2 rounded-2xl border border-line bg-ink/95 p-2 backdrop-blur-xl lg:hidden"
        >
          {[...NAV, { href: "/login", label: "Sign in" }].map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between rounded-xl px-4 py-3 text-[15px] text-text hover:bg-raised"
            >
              {item.label}
              <ArrowUpRight className="h-4 w-4 text-faint" />
            </a>
          ))}
        </nav>
      )}
    </header>
  )
}
