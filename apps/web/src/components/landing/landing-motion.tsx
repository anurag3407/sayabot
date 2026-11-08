"use client"

import { animate, createAnimatable, createScope, onScroll, splitText, stagger, type Scope } from "animejs"
import { useEffect } from "react"
import { afterFonts } from "./motion"

/**
 * The page-wide motion layer. Sections opt in with attributes:
 * data-split (headline word rise), data-reveal (rise and settle),
 * data-parallax="-40" (scrubbed y), data-tilt (pointer tilt in 3D).
 * Mounted after the sections so everything is in the DOM.
 */
export function LandingMotion() {
  useEffect(() => {
    const page = document.querySelector<HTMLElement>(".l-page")
    if (!page) return
    let observer: IntersectionObserver | undefined

    const scope: Scope = createScope({
      root: page,
      mediaQueries: { motion: "(prefers-reduced-motion: no-preference)", fine: "(pointer: fine)" },
    }).add((self) => {
      if (!self?.matches.motion) return

      animate(".l-progress", {
        scaleX: [0, 1],
        ease: "linear",
        autoplay: onScroll({ target: page, enter: "top top", leave: "bottom bottom", sync: true }),
      })

      const onScreen = (element: Element) => element.getBoundingClientRect().top < window.innerHeight * 0.9

      let splits: { element: HTMLElement; split: ReturnType<typeof splitText> }[] = []
      const stopFonts = afterFonts(self, () => {
        splits = Array.from(page.querySelectorAll<HTMLElement>("[data-split]")).map((element) => {
          const split = splitText(element, { lines: { wrap: "clip" }, words: { class: "l-split-word" } })
          split.addEffect(({ words }: { words: HTMLElement[] }) => {
            if (element.dataset.played) return
            words.forEach((word) => (word.style.transform = "translateY(112%)"))
          })
          observer?.observe(element)
          return { element, split }
        })
      })

      const reveals = Array.from(page.querySelectorAll<HTMLElement>("[data-reveal]")).filter((element) => !onScreen(element))
      reveals.forEach((element) => {
        element.style.opacity = "0"
        element.style.transform = "translateY(36px) scale(0.985)"
      })

      observer = new IntersectionObserver(
        (entries) => {
          const entering = entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target as HTMLElement)
          if (!entering.length) return
          entering.forEach((element) => observer?.unobserve(element))

          const headings = entering.filter((element) => element.hasAttribute("data-split"))
          const blocks = entering.filter((element) => element.hasAttribute("data-reveal"))
          headings.forEach((element) => {
            const match = splits.find((item) => item.element === element)
            if (!match) return
            element.dataset.played = "true"
            animate(match.split.words as HTMLElement[], {
              translateY: ["112%", "0%"],
              duration: 1050,
              delay: stagger(42),
              ease: "out(4)",
            })
          })
          if (blocks.length) {
            animate(blocks, {
              opacity: 1,
              translateY: 0,
              scale: 1,
              duration: 850,
              delay: stagger(70),
              ease: "out(3.4)",
              onComplete: () => blocks.forEach((element) => (element.style.transform = "")),
            })
          }
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
      )
      reveals.forEach((element) => observer?.observe(element))

      page.querySelectorAll<HTMLElement>("[data-parallax]").forEach((element) => {
        animate(element, {
          translateY: [0, Number(element.dataset.parallax)],
          ease: "linear",
          autoplay: onScroll({ target: element, enter: "bottom top", leave: "top bottom", sync: true }),
        })
      })

      return () => {
        observer?.disconnect()
        stopFonts()
        splits.forEach(({ split }) => split.revert())
      }
    })

    const fine = window.matchMedia("(pointer: fine)").matches
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const tilts = new WeakMap<HTMLElement, ReturnType<typeof createAnimatable>>()
    const tiltOf = (element: HTMLElement) => {
      let tilt = tilts.get(element)
      if (!tilt) {
        tilt = createAnimatable(element, { rotateX: 450, rotateY: 450, ease: "out(3)" })
        element.style.transformStyle = "preserve-3d"
        tilts.set(element, tilt)
      }
      return tilt
    }
    const set = (tilt: ReturnType<typeof createAnimatable>, key: "rotateX" | "rotateY", value: number) =>
      (tilt[key] as unknown as (next: number) => unknown)(value)

    const onMove = (event: PointerEvent) => {
      const target = event.target as Element | null
      const spot = target?.closest<HTMLElement>(".l-spot")
      if (spot) {
        const rect = spot.getBoundingClientRect()
        spot.style.setProperty("--mx", `${event.clientX - rect.left}px`)
        spot.style.setProperty("--my", `${event.clientY - rect.top}px`)
      }
      const tiltTarget = calm ? null : target?.closest<HTMLElement>("[data-tilt]")
      if (tiltTarget) {
        const rect = tiltTarget.getBoundingClientRect()
        const tilt = tiltOf(tiltTarget)
        set(tilt, "rotateY", ((event.clientX - rect.left) / rect.width - 0.5) * 10)
        set(tilt, "rotateX", ((event.clientY - rect.top) / rect.height - 0.5) * -10)
      }
    }
    const onOut = (event: PointerEvent) => {
      const element = (event.target as Element | null)?.closest<HTMLElement>("[data-tilt]")
      if (element && !element.contains(event.relatedTarget as Node | null)) {
        const tilt = tiltOf(element)
        set(tilt, "rotateX", 0)
        set(tilt, "rotateY", 0)
      }
    }
    if (fine) {
      document.addEventListener("pointermove", onMove, { passive: true })
      document.addEventListener("pointerout", onOut, { passive: true })
    }

    return () => {
      scope.revert()
      if (fine) {
        document.removeEventListener("pointermove", onMove)
        document.removeEventListener("pointerout", onOut)
      }
    }
  }, [])

  return null
}
