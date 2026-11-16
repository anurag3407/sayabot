"use client"

import { useRef, type CSSProperties, type ElementType, type ReactNode } from "react"
import { useInView } from "@/lib/motion"

/** Fades and lifts its children in the first time they scroll into view. */
export function Reveal({
  as: Tag = "div",
  index = 0,
  className = "",
  style,
  children,
}: {
  as?: ElementType
  index?: number
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const seen = useInView(ref, { once: true })
  return (
    <Tag
      ref={ref}
      className={`reveal ${seen ? "is-in" : ""} ${className}`}
      style={{ "--i": index, ...style } as CSSProperties}
    >
      {children}
    </Tag>
  )
}
