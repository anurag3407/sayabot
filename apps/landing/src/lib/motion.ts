"use client"

import { useEffect, useState, type RefObject } from "react"

/** True while the element is on screen (or once, with `once`), so loops only run when seen. */
export function useInView<T extends Element>(
  ref: RefObject<T | null>,
  { once = false, margin = "0px 0px -10% 0px" }: { once?: boolean; margin?: string } = {},
): boolean {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = Boolean(entry?.isIntersecting)
        if (visible && once) {
          setInView(true)
          observer.disconnect()
          return
        }
        if (!once) setInView(visible)
      },
      { rootMargin: margin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, once, margin])
  return inView
}

/**
 * Steps through `durations` (ms per step) on a loop while `active`. Returns the current step.
 * Reduced motion jumps straight to the last step and holds it.
 */
export function useSequence(
  durations: readonly number[],
  active: boolean,
  resetKey: unknown = null,
): number {
  const [step, setStep] = useState(0)
  useEffect(() => {
    setStep(0)
  }, [resetKey])
  useEffect(() => {
    if (!active) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(durations.length - 1)
      return
    }
    const timer = window.setTimeout(
      () => setStep((current) => (current + 1) % durations.length),
      durations[step] ?? 1000,
    )
    return () => window.clearTimeout(timer)
  }, [active, step, durations])
  return step
}

type Watcher = (x: number, y: number) => void
const watchers = new Set<Watcher>()
let frame = 0
let pointerX = 0
let pointerY = 0

function onPointerMove(event: PointerEvent) {
  pointerX = event.clientX
  pointerY = event.clientY
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    watchers.forEach((watch) => watch(pointerX, pointerY))
  })
}

/** Steers a mascot's eyes toward the pointer through `--lx` / `--ly` on the svg. */
export function useLookAt(ref: RefObject<SVGSVGElement | null>, enabled = true) {
  useEffect(() => {
    const element = ref.current
    if (!element || !enabled || !window.matchMedia("(pointer: fine)").matches) return
    const watch: Watcher = (x, y) => {
      const rect = element.getBoundingClientRect()
      if (rect.bottom < 0 || rect.top > window.innerHeight) return
      const dx = x - (rect.left + rect.width / 2)
      const dy = y - (rect.top + rect.height / 2)
      const reach = Math.min(Math.hypot(dx, dy), 420) / 420
      const angle = Math.atan2(dy, dx)
      element.style.setProperty("--lx", `${(Math.cos(angle) * reach * 5).toFixed(2)}px`)
      element.style.setProperty("--ly", `${(Math.sin(angle) * reach * 3.2).toFixed(2)}px`)
    }
    if (watchers.size === 0)
      window.addEventListener("pointermove", onPointerMove, { passive: true })
    watchers.add(watch)
    return () => {
      watchers.delete(watch)
      if (watchers.size === 0) window.removeEventListener("pointermove", onPointerMove)
    }
  }, [ref, enabled])
}
