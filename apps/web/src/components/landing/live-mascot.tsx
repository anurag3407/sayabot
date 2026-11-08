"use client"

import { useEffect, useRef, useState, type ComponentProps, type CSSProperties, type RefObject } from "react"
import { Mascot } from "@/components/ui/mascot"

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

function useLookAt(ref: RefObject<SVGSVGElement | null>) {
  useEffect(() => {
    const element = ref.current
    if (!element || !window.matchMedia("(pointer: fine)").matches) return
    const watch: Watcher = (x, y) => {
      const rect = element.getBoundingClientRect()
      if (rect.bottom < 0 || rect.top > window.innerHeight) return
      const dx = x - (rect.left + rect.width / 2)
      const dy = y - (rect.top + rect.height / 2)
      const reach = Math.min(Math.hypot(dx, dy), 360) / 360
      const angle = Math.atan2(dy, dx)
      element.style.setProperty("--lx", `${(Math.cos(angle) * reach * 3.4).toFixed(2)}px`)
      element.style.setProperty("--ly", `${(Math.sin(angle) * reach * 4).toFixed(2)}px`)
    }
    if (watchers.size === 0) window.addEventListener("pointermove", onPointerMove, { passive: true })
    watchers.add(watch)
    return () => {
      watchers.delete(watch)
      if (watchers.size === 0) window.removeEventListener("pointermove", onPointerMove)
    }
  }, [ref])
}

/** A mascot whose eyes follow the pointer. Tap or hover makes it smile. */
export function LiveMascot({
  float = false,
  delay = 0,
  className = "",
  style,
  mood,
  ...props
}: Omit<ComponentProps<typeof Mascot>, "svgRef"> & { float?: boolean; delay?: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState(false)
  useLookAt(ref)
  return (
    <span
      className={`inline-block ${float ? "l-float" : ""} ${className}`}
      style={{ "--bob-delay": `${delay}s`, "--blink-delay": `${delay * 1.7}s`, ...style } as CSSProperties}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <Mascot svgRef={ref} blink mood={hover ? "happy" : mood} className="block h-full w-full" {...props} />
    </span>
  )
}

/** True while the element is on screen, so loops only run when someone can see them. */
export function useInView<T extends Element>(ref: RefObject<T | null>, margin = "0px"): boolean {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)), {
      rootMargin: margin,
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, margin])
  return inView
}
