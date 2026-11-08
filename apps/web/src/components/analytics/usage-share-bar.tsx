"use client"

import React, { useState } from "react"
import { formatPercent } from "@/lib/format"

export interface ShareSegment {
  readonly label: string
  readonly value: number
  readonly color: string
  readonly description?: string
}

export function UsageShareBar({
  label,
  segments,
  format,
  aside,
}: {
  readonly label: string
  readonly segments: readonly ShareSegment[]
  readonly format: (value: number) => string
  readonly aside?: React.ReactNode
}) {
  const visible = segments.filter((s) => s.value > 0)
  const total = visible.reduce((sum, s) => sum + s.value, 0)
  const [hoveredSegment, setHoveredSegment] = useState<ShareSegment | null>(null)

  if (total <= 0) return null

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-text">{label}</h3>
        {aside}
      </div>

      {/* Proportional Segmented Bar */}
      <div
        role="img"
        aria-label={`${label}: ${visible.map((s) => `${s.label} ${format(s.value)}`).join(", ")}`}
        className="relative flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-line"
      >
        {visible.map((segment) => {
          const pct = segment.value / total
          return (
            <div
              key={segment.label}
              onMouseEnter={() => setHoveredSegment(segment)}
              onMouseLeave={() => setHoveredSegment(null)}
              className="relative h-full cursor-pointer transition-all hover:brightness-110"
              style={{
                flex: `${segment.value} 1 0`,
                backgroundColor: segment.color,
                minWidth: "4px",
              }}
            />
          )
        })}
      </div>

      {/* Hover Info or Default Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
        {visible.map((segment) => {
          const share = segment.value / total
          const isHovered = hoveredSegment?.label === segment.label
          return (
            <span
              key={segment.label}
              onMouseEnter={() => setHoveredSegment(segment)}
              onMouseLeave={() => setHoveredSegment(null)}
              className={`flex items-center gap-1.5 transition-opacity ${
                hoveredSegment && !isHovered ? "opacity-40" : "opacity-100"
              }`}
            >
              <span
                aria-hidden
                className="size-2 rounded-sm"
                style={{ backgroundColor: segment.color }}
              />
              <span className="text-muted">{segment.label}</span>
              <span className="font-mono font-medium text-text">{format(segment.value)}</span>
              <span className="font-mono text-[11px] text-faint">({formatPercent(share)})</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
