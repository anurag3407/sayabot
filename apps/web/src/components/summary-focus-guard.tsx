"use client"

import { useEffect } from "react"

/**
 * Chromium paints the keyboard focus ring on a <summary> even when it was clicked with the mouse,
 * which left a thick ring around every dropdown and disclosure after a click. Mark summaries
 * that were pressed with a pointer; globals.css hides the ring for those. Keyboard focus (Tab,
 * or any key on the summary) clears the mark, so keyboard users still see it.
 */
export function SummaryFocusGuard() {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const summary = (event.target as Element | null)?.closest?.("summary")
      summary?.setAttribute("data-pointer", "")
    }
    const clear = (event: Event) => {
      const target = event.target as Element | null
      if (target?.tagName === "SUMMARY") target.removeAttribute("data-pointer")
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", clear, true)
    document.addEventListener("focusout", clear, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", clear, true)
      document.removeEventListener("focusout", clear, true)
    }
  }, [])
  return null
}
