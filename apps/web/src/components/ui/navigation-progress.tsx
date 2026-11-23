"use client"

import { useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"

let activeNavTimer: NodeJS.Timeout | null = null
let completeNavTimer: NodeJS.Timeout | null = null
const navListeners: Set<(active: boolean) => void> = new Set()

export function startNavigationProgress() {
  if (completeNavTimer) {
    clearTimeout(completeNavTimer)
    completeNavTimer = null
  }
  navListeners.forEach((fn) => fn(true))
}

export function doneNavigationProgress() {
  navListeners.forEach((fn) => fn(false))
}

export function NavigationProgress() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [navigating, setNavigating] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const listener = (active: boolean) => {
      if (active) {
        if (completeNavTimer) {
          clearTimeout(completeNavTimer)
          completeNavTimer = null
        }
        setNavigating(true)
        setProgress(30)
        if (activeNavTimer) clearTimeout(activeNavTimer)
        activeNavTimer = setTimeout(() => {
          setProgress(75)
        }, 120)
      } else {
        setProgress(100)
        if (completeNavTimer) clearTimeout(completeNavTimer)
        completeNavTimer = setTimeout(() => {
          setNavigating(false)
          setProgress(0)
          completeNavTimer = null
        }, 200)
      }
    }
    navListeners.add(listener)
    return () => {
      navListeners.delete(listener)
    }
  }, [])

  // When pathname or searchParams changes, navigation completed!
  useEffect(() => {
    setProgress(100)
    if (completeNavTimer) clearTimeout(completeNavTimer)
    completeNavTimer = setTimeout(() => {
      setNavigating(false)
      setProgress(0)
      completeNavTimer = null
    }, 180)
    return () => {
      if (completeNavTimer) {
        clearTimeout(completeNavTimer)
        completeNavTimer = null
      }
    }
  }, [pathname, searchParams])

  // Intercept click on links to give 0ms instant feedback
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return
      }
      const anchor = (e.target as HTMLElement | null)?.closest("a")
      if (!anchor) return
      const href = anchor.getAttribute("href")
      if (
        !href ||
        href.startsWith("#") ||
        href.startsWith("javascript:") ||
        anchor.target === "_blank"
      ) {
        return
      }
      try {
        const url = new URL(anchor.href, window.location.href)
        if (url.origin !== window.location.origin) return
        if (url.pathname === window.location.pathname && url.search === window.location.search) {
          return
        }
        startNavigationProgress()
      } catch {
        // ignore
      }
    }
    document.addEventListener("click", onClick, { capture: true })
    return () => document.removeEventListener("click", onClick, { capture: true })
  }, [])

  if (!navigating && progress === 0) return null

  return (
    <div
      aria-hidden="true"
      className="fixed left-0 top-0 z-[9999] h-[2.5px] w-full pointer-events-none overflow-hidden bg-transparent"
    >
      <div
        className="h-full bg-gradient-to-r from-accent via-indigo-400 to-accent shadow-[0_0_10px_rgba(157,140,255,0.8)] transition-all duration-300 ease-out"
        style={{
          width: `${progress}%`,
          opacity: progress === 100 ? 0 : 1,
          transitionProperty: "width, opacity",
        }}
      />
    </div>
  )
}
