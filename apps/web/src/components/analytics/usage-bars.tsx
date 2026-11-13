"use client"

import { useState, type KeyboardEvent } from "react"
import { cn } from "@/lib/format"
import type { SeriesPoint } from "@/lib/usage-summary"

/**
 * Categorical slots validated for the dark surface (#141415): lightness band, chroma,
 * colour-blind separation and 3:1 contrast all pass in this order. Slot 6 folds the rest.
 */
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"]
export const OTHER_COLOR = "#55555c"

export function seriesColor(index: number, id: string): string {
  return id === "other" ? OTHER_COLOR : (SERIES_COLORS[index] ?? OTHER_COLOR)
}

function niceMax(peak: number): number {
  if (peak <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(peak))
  const step = [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= peak) ?? 10
  return step * magnitude
}

/** Stacked bars, one per day or hour. Hover, tap or use arrow keys to read a bar. */
export function UsageBars({
  points,
  series,
  format,
  label,
  hourly,
}: {
  points: SeriesPoint[]
  series: { id: string; label: string }[]
  format: (value: number) => string
  label: string
  hourly: boolean
}) {
  const [active, setActive] = useState<number | null>(null)
  const max = niceMax(Math.max(0, ...points.map((point) => point.total)))
  const ticks = [max, max / 2]
  const labelEvery = Math.max(1, Math.ceil(points.length / 7))
  const shown = active !== null ? points[active] : null

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!points.length) return
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault()
      const step = event.key === "ArrowRight" ? 1 : -1
      setActive((current) =>
        Math.min(points.length - 1, Math.max(0, (current ?? (step > 0 ? -1 : points.length)) + step)),
      )
    } else if (event.key === "Escape") {
      setActive(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {series.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Legend">
          {series.map((item, index) => (
            <li key={item.id} className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-[3px]"
                style={{ backgroundColor: seriesColor(index, item.id) }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative">
        <div
          role="group"
          aria-label={`${label}. Use the left and right arrow keys to read each bar.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          onMouseLeave={() => setActive(null)}
          className="relative h-[200px] rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {ticks.map((tick) => (
            <div
              key={tick}
              aria-hidden="true"
              className="absolute inset-x-0 border-t border-dashed border-line"
              style={{ bottom: `${(tick / max) * 100}%` }}
            >
              <span className="absolute -top-2.5 right-0 bg-ink pl-1.5 text-[11px] text-faint">
                {format(tick)}
              </span>
            </div>
          ))}
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 border-t border-line-strong" />

          <div className="absolute inset-0 flex items-end gap-[2px] pr-12">
            {points.map((point, index) => (
              <div
                key={point.key}
                className="relative flex h-full min-w-0 flex-1 cursor-default items-end justify-center"
                onMouseEnter={() => setActive(index)}
                onClick={() => setActive(index)}
              >
                <div
                  className={cn(
                    "flex w-full max-w-[28px] flex-col-reverse gap-[2px] transition-opacity",
                    active !== null && active !== index && "opacity-45",
                  )}
                  style={{ height: `${(point.total / max) * 100}%` }}
                >
                  {series.map((item, seriesIndex) => {
                    const value = point.values[item.id] ?? 0
                    if (value <= 0) return null
                    return (
                      <div
                        key={item.id}
                        className="w-full first:rounded-b-[2px] last:rounded-t-[4px]"
                        style={{
                          flexGrow: value,
                          flexBasis: 0,
                          minHeight: 2,
                          backgroundColor: seriesColor(seriesIndex, item.id),
                        }}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {shown && active !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 w-52 rounded-xl border border-line-strong bg-panel px-3 py-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
            style={{
              left: `clamp(0px, calc(${((active + 0.5) / points.length) * 100}% - 104px), calc(100% - 208px))`,
            }}
          >
            <p className="text-[12px] text-faint">{shown.longLabel}</p>
            <p className="mt-0.5 text-[15px] font-semibold text-text">
              {shown.total > 0 ? format(shown.total) : "Nothing"}
            </p>
            {series.length > 1 && shown.total > 0 ? (
              <ul className="mt-1.5 space-y-1">
                {series.map((item, index) => {
                  const value = shown.values[item.id] ?? 0
                  if (value <= 0) return null
                  return (
                    <li key={item.id} className="flex items-center gap-2 text-[12px]">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: seriesColor(index, item.id) }}
                      />
                      <span className="min-w-0 flex-1 truncate text-muted">{item.label}</span>
                      <span className="text-text">{format(value)}</span>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div aria-hidden="true" className="flex gap-[2px] pr-12">
        {points.map((point, index) => (
          <span key={point.key} className="relative min-w-0 flex-1 text-center">
            {index === points.length - 1 ||
            (index % labelEvery === 0 && points.length - 1 - index >= labelEvery * 0.75) ? (
              <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-faint">
                {index === points.length - 1 ? (hourly ? "Now" : "Today") : point.label}
              </span>
            ) : null}
          </span>
        ))}
      </div>
      <div className="h-3" aria-hidden="true" />
    </div>
  )
}
