"use client"

import { createScope, type Scope } from "animejs"
import { useEffect, type DependencyList, type RefObject } from "react"

const QUERIES = {
  motion: "(prefers-reduced-motion: no-preference)",
  desktop: "(min-width: 1024px)",
  fine: "(pointer: fine)",
}

export interface MotionContext {
  scope: Scope
  root: HTMLElement
  desktop: boolean
  fine: boolean
  /** Every element under the section root matching `selector`. */
  all: <T extends Element = HTMLElement>(selector: string) => T[]
}

/** `fonts.ready` can resolve before a lazy face starts loading, so ask for it first. */
async function fontsSettled() {
  await document.fonts.load('800 1em "Anybody Variable"').catch(() => undefined)
  do {
    await document.fonts.ready
  } while (document.fonts.status === "loading")
}

/**
 * Defers work until web fonts settle. splitText measures line breaks, and
 * running it mid-load makes it re-split its own output.
 */
export function afterFonts(scope: Scope, run: () => void | (() => void)) {
  let live = true
  let cleanup: void | (() => void)
  void fontsSettled().then(() => {
    if (live) scope.add(() => void (cleanup = run()))
  })
  return () => {
    live = false
    if (cleanup) cleanup()
  }
}

/**
 * Runs anime.js setup inside a scope tied to a section root. Skipped entirely
 * for reduced motion, so the server markup (always the finished state) stands.
 * Re-runs when a media query flips and reverts inline styles on unmount.
 */
export function useAnime(
  root: RefObject<HTMLElement | null>,
  setup: (context: MotionContext) => void | (() => void),
  deps: DependencyList = [],
) {
  useEffect(() => {
    const element = root.current
    if (!element) return
    const scope = createScope({ root: element, mediaQueries: QUERIES }).add((self) => {
      if (!self?.matches.motion) return
      return setup({
        scope: self,
        root: element,
        desktop: Boolean(self.matches.desktop),
        fine: Boolean(self.matches.fine),
        all: <T extends Element = HTMLElement>(selector: string) => Array.from(element.querySelectorAll<T>(selector)),
      })
    })
    return () => {
      scope.revert()
    }
    // The caller owns the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
