"use client"

import { useEffect } from "react"
import { gsap, MOTION, ScrollTrigger, SplitText, useGSAP } from "./gsap"

/**
 * The page-wide motion layer. Sections opt in with attributes:
 * data-split (headline word rise), data-reveal (fade up, batched),
 * data-parallax="-40" (scrubbed y), data-tilt (pointer tilt).
 * Mounted after the sections so it can sort every trigger once.
 */
export function LandingMotion() {
  useGSAP(() => {
    const mm = gsap.matchMedia()
    mm.add(MOTION, () => {
      gsap.to(".l-progress", {
        scaleX: 1,
        ease: "none",
        scrollTrigger: { start: 0, end: "max", scrub: 0.3 },
      })

      gsap.utils.toArray<HTMLElement>("[data-split]").forEach((element) => {
        SplitText.create(element, {
          type: "words,lines",
          mask: "lines",
          linesClass: "l-split-line",
          autoSplit: true,
          onSplit: (self) =>
            gsap.from(self.words, {
              yPercent: 112,
              stagger: 0.035,
              duration: 0.95,
              ease: "expo.out",
              scrollTrigger: { trigger: element, start: "top 90%", once: true },
            }),
        })
      })

      gsap.set("[data-reveal]", { autoAlpha: 0, y: 32 })
      ScrollTrigger.batch("[data-reveal]", {
        start: "top 92%",
        once: true,
        onEnter: (batch) =>
          gsap.to(batch, { autoAlpha: 1, y: 0, stagger: 0.07, duration: 0.8, clearProps: "transform,visibility,opacity" }),
      })

      gsap.utils.toArray<HTMLElement>("[data-parallax]").forEach((element) => {
        gsap.to(element, {
          y: Number(element.dataset.parallax),
          ease: "none",
          scrollTrigger: { trigger: element, start: "top bottom", end: "bottom top", scrub: 0.6 },
        })
      })

      ScrollTrigger.sort()
      ScrollTrigger.refresh()
    })
  })

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (!fine) return

    const onMove = (event: PointerEvent) => {
      const target = event.target as Element | null
      const spot = target?.closest<HTMLElement>(".l-spot")
      if (spot) {
        const rect = spot.getBoundingClientRect()
        spot.style.setProperty("--mx", `${event.clientX - rect.left}px`)
        spot.style.setProperty("--my", `${event.clientY - rect.top}px`)
      }
      const tilt = calm ? null : target?.closest<HTMLElement>("[data-tilt]")
      if (tilt) {
        const rect = tilt.getBoundingClientRect()
        gsap.to(tilt, {
          rotateY: ((event.clientX - rect.left) / rect.width - 0.5) * 9,
          rotateX: ((event.clientY - rect.top) / rect.height - 0.5) * -9,
          transformPerspective: 900,
          duration: 0.4,
          overwrite: "auto",
        })
      }
    }
    const onOut = (event: PointerEvent) => {
      const tilt = (event.target as Element | null)?.closest<HTMLElement>("[data-tilt]")
      if (tilt && !tilt.contains(event.relatedTarget as Node | null)) {
        gsap.to(tilt, { rotateX: 0, rotateY: 0, duration: 0.6, overwrite: "auto" })
      }
    }
    document.addEventListener("pointermove", onMove, { passive: true })
    document.addEventListener("pointerout", onOut, { passive: true })
    return () => {
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerout", onOut)
    }
  }, [])

  return null
}
