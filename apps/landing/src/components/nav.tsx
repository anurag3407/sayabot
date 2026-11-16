"use client"

import { useEffect, useState } from "react"
import { LINKS } from "@/lib/links"
import { GitHubIcon } from "./icons"
import { Saya } from "./saya"

const ITEMS = [
  { href: "#agents", label: "Agents" },
  { href: "#how", label: "How it works" },
  { href: "#computer", label: "Computers" },
  { href: "#features", label: "Features" },
  { href: "#download", label: "Download" },
]

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header className={`nav ${scrolled ? "nav-scrolled" : ""}`}>
      <div className="wrap nav-inner">
        <a href="#top" className="nav-brand" aria-label="Sayabot home">
          <Saya shape="ghost" follow className="nav-mark" />
          <span>Sayabot</span>
        </a>
        <nav className="nav-links" aria-label="Sections">
          {ITEMS.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="nav-actions">
          <a
            className="nav-icon"
            href={LINKS.github}
            target="_blank"
            rel="noreferrer"
            aria-label="Sayabot on GitHub"
          >
            <GitHubIcon />
          </a>
          <a className="btn btn-primary btn-sm" href={LINKS.app}>
            Open web app
          </a>
        </div>
      </div>
    </header>
  )
}
