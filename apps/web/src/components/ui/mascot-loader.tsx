"use client"

import { useEffect, useState, type CSSProperties } from "react"
import { Mascot, RARE_MASCOT } from "@/components/ui/mascot"
import { cn } from "@/lib/format"

const CREW = ["Pip", RARE_MASCOT, "Moss"] as const

const DEFAULT_STEPS = ["Waking up your bots", "Syncing your chats", "Getting the canvas ready"]

/**
 * The Sayabot loader: three Sayas pass the lit lamp (the brand's "your turn") down the line while
 * the one holding it hops. The middle one is the rare orchestrator. Calm under reduced motion.
 */
export function MascotLoader({
  title = "Opening your workspace",
  steps = DEFAULT_STEPS,
  compact = false,
  className,
}: {
  title?: string
  steps?: string[]
  compact?: boolean
  className?: string
}) {
  const [turn, setTurn] = useState(0)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const lamp = window.setInterval(() => setTurn((value) => (value + 1) % CREW.length), 720)
    const words = window.setInterval(() => setStep((value) => (value + 1) % steps.length), 2200)
    return () => {
      window.clearInterval(lamp)
      window.clearInterval(words)
    }
  }, [steps.length])

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={title}
      className={cn("fade-in flex flex-col items-center justify-center text-center", className)}
    >
      <div
        className={cn("relative flex items-end", compact ? "gap-2" : "gap-4")}
        aria-hidden="true"
      >
        <span
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(157,140,255,0.22),transparent)]",
            compact ? "h-28 w-48" : "h-44 w-80",
          )}
        />
        {CREW.map((name, index) => {
          const center = index === 1
          const size = compact
            ? center
              ? "h-14 w-14"
              : "h-10 w-10"
            : center
              ? "h-24 w-24"
              : "h-16 w-16"
          return (
            <Mascot
              key={name}
              seed={name}
              live
              shadow
              lit={turn === index}
              mood={turn === index ? "happy" : "idle"}
              className={cn(size, "relative")}
              style={
                {
                  "--bob-delay": `${index * 0.45}s`,
                  "--blink-delay": `${index * 1.3}s`,
                } as CSSProperties
              }
            />
          )
        })}
      </div>

      <p
        className={cn(
          "font-medium tracking-[-0.01em] text-text",
          compact ? "mt-5 text-[15px]" : "mt-8 text-[20px]",
        )}
      >
        {title}
      </p>
      <p
        key={step}
        className={cn("fade-in text-muted", compact ? "mt-1 text-[12.5px]" : "mt-1.5 text-[14px]")}
      >
        {steps[step % steps.length]}…
      </p>

      <div
        className={cn(
          "relative mt-5 h-1 overflow-hidden rounded-full bg-white/[0.06]",
          compact ? "w-32" : "w-48",
        )}
        aria-hidden="true"
      >
        <span className="loader-sweep absolute inset-y-0 w-1/3 rounded-full bg-[linear-gradient(90deg,transparent,var(--color-accent),transparent)]" />
      </div>
    </div>
  )
}
