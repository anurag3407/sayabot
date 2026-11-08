"use client"

import Lenis from "lenis"
import { useEffect, type ReactNode } from "react"

/** Lenis inertia scrolling. Skipped entirely for reduced motion. */
export function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const lenis = new Lenis({ lerp: 0.11, allowNestedScroll: true, autoRaf: true })

    // Same-page hash links glide instead of jumping.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return
      const link = (event.target as Element | null)?.closest?.("a[href*='#']")
      if (!(link instanceof HTMLAnchorElement)) return
      const url = new URL(link.href)
      if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash) return
      const target = document.getElementById(decodeURIComponent(url.hash.slice(1)))
      if (!target) return
      event.preventDefault()
      lenis.scrollTo(target, { offset: 0, duration: 1.4 })
      history.replaceState(null, "", url.hash)
    }
    document.addEventListener("click", onClick)

    return () => {
      document.removeEventListener("click", onClick)
      lenis.destroy()
    }
  }, [])

  return <>{children}</>
}
