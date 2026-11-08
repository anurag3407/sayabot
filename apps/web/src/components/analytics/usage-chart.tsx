"use client"

import React, { useId, useMemo, useRef, useState } from "react"
import { formatNumber, formatTokens, formatUsd } from "@/lib/format"
import { ProviderIcon } from "@/components/room/model-picker/provider-icons"

export interface ChartSeries {
  id: string
  label: string
  color: string
  icon?: string
}

export interface ChartDataPoint {
  periodKey: string
  periodLabel: string
  timestampMs?: number
  values: Record<string, number>
  total: number
}

interface Point {
  x: number
  y: number
}

function monotoneTangents(points: readonly Point[]): number[] {
  const count = points.length
  if (count < 2) return [0]

  const slopes: number[] = []
  for (let i = 0; i < count - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]
    const dx = (p2?.x ?? 0) - (p1?.x ?? 0)
    const dy = (p2?.y ?? 0) - (p1?.y ?? 0)
    slopes.push(dx === 0 ? 0 : dy / dx)
  }

  const tangents: number[] = Array.from({ length: count }, () => 0)
  tangents[0] = slopes[0] ?? 0
  tangents[count - 1] = slopes[count - 2] ?? 0

  for (let i = 1; i < count - 1; i++) {
    const prev = slopes[i - 1] ?? 0
    const next = slopes[i] ?? 0
    tangents[i] = prev * next <= 0 ? 0 : (prev + next) / 2
  }

  for (let i = 0; i < count - 1; i++) {
    const slope = slopes[i] ?? 0
    if (slope === 0) {
      tangents[i] = 0
      tangents[i + 1] = 0
      continue
    }
    const a = (tangents[i] ?? 0) / slope
    const b = (tangents[i + 1] ?? 0) / slope
    const magnitude = a * a + b * b
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude)
      tangents[i] = scale * a * slope
      tangents[i + 1] = scale * b * slope
    }
  }

  return tangents
}

interface CurveSegment {
  from: Point
  c1: Point
  c2: Point
  to: Point
}

function smoothCurve(points: readonly Point[]): CurveSegment[] {
  if (points.length < 2) return []
  const tangents = monotoneTangents(points)
  const segments: CurveSegment[] = []

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    if (!from || !to) continue
    const dx = to.x - from.x
    segments.push({
      from,
      c1: { x: from.x + dx / 3, y: from.y + ((tangents[i] ?? 0) * dx) / 3 },
      c2: { x: to.x - dx / 3, y: to.y - ((tangents[i + 1] ?? 0) * dx) / 3 },
      to,
    })
  }
  return segments
}

function curvePath(segments: readonly CurveSegment[]): string {
  const first = segments[0]
  if (!first) return ""
  let path = `M${first.from.x.toFixed(2)},${first.from.y.toFixed(2)}`
  for (const segment of segments) {
    path += ` C${segment.c1.x.toFixed(2)},${segment.c1.y.toFixed(2)} ${segment.c2.x.toFixed(2)},${segment.c2.y.toFixed(2)} ${segment.to.x.toFixed(2)},${segment.to.y.toFixed(2)}`
  }
  return path
}

function niceScale(peak: number, count: number): { max: number; ticks: number[] } {
  if (peak <= 0) return { max: 100, ticks: [0, 25, 50, 75, 100] }
  const rawStep = peak / count
  const magnitude = 10 ** Math.floor(Math.log10(rawStep || 1))
  const normalized = rawStep / magnitude
  const step = (normalized > 5 ? 10 : normalized > 2 ? 5 : normalized > 1 ? 2 : 1) * magnitude
  const max = Math.ceil(peak / step) * step
  const ticks: number[] = []
  for (let val = 0; val <= max + step * 1e-6; val += step) {
    ticks.push(val)
  }
  return { max: Math.max(max, step * count), ticks }
}

const VIEW_WIDTH = 800
const VIEW_HEIGHT = 240
const PLOT_TOP = 16
const PLOT_BOTTOM = 220
const TICK_COUNT = 4

export function UsageChart({
  points,
  series,
  metric = "tokens",
}: {
  points: ChartDataPoint[]
  series: ChartSeries[]
  metric?: "tokens" | "cost" | "perf"
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const gradientPrefix = useId().replace(/:/g, "_")

  const peak = useMemo(() => {
    let max = 0
    for (const pt of points) {
      for (const s of series) {
        const val = pt.values[s.id] ?? 0
        if (val > max) max = val
      }
    }
    return max
  }, [points, series])

  const scale = useMemo(() => niceScale(peak, TICK_COUNT), [peak])

  const valueToY = (value: number) => {
    if (scale.max <= 0) return PLOT_BOTTOM
    const clamped = Math.max(0, Math.min(value, scale.max))
    return PLOT_BOTTOM - (clamped / scale.max) * (PLOT_BOTTOM - PLOT_TOP)
  }

  const stepX = points.length < 2 ? 0 : VIEW_WIDTH / (points.length - 1)

  const seriesPaths = useMemo(() => {
    return series.map((s) => {
      const coordPoints: Point[] = points.map((pt, i) => ({
        x: i * stepX,
        y: valueToY(pt.values[s.id] ?? 0),
      }))

      const segments = smoothCurve(coordPoints)
      const line = curvePath(segments)
      const area = line ? `${line} L${(points.length - 1) * stepX},${PLOT_BOTTOM} L0,${PLOT_BOTTOM} Z` : ""
      const totalSeriesVal = points.reduce((acc, p) => acc + (p.values[s.id] ?? 0), 0)

      return {
        series: s,
        line,
        area,
        coordPoints,
        total: totalSeriesVal,
      }
    }).sort((a, b) => b.total - a.total)
  }, [points, series, stepX, scale.max])

  const formatValue = (val: number) => {
    if (metric === "cost") return formatUsd(val)
    if (metric === "perf") return `${Math.round(val)} ms`
    return formatTokens(val)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current || points.length === 0) return
    const rect = containerRef.current.getBoundingClientRect()
    const relX = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const index = Math.round((relX / rect.width) * (points.length - 1))
    setHoverIndex(index)
    setTooltipPos({ x: relX, y: e.clientY - rect.top })
  }

  const handlePointerLeave = () => {
    setHoverIndex(null)
    setTooltipPos(null)
  }

  // Label ticks on X axis (first, middle, last)
  const xTicks = useMemo(() => {
    if (points.length <= 1) return points.map((p, i) => ({ label: p.periodLabel, x: 0 }))
    if (points.length <= 4) {
      return points.map((p, i) => ({ label: p.periodLabel, x: i * stepX }))
    }
    const result: { label: string; x: number }[] = []
    const indices = [0, Math.floor(points.length / 2), points.length - 1]
    for (const idx of indices) {
      if (points[idx]) {
        result.push({ label: points[idx].periodLabel, x: idx * stepX })
      }
    }
    return result
  }, [points, stepX])

  const hoveredPoint = hoverIndex !== null ? points[hoverIndex] : null

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className="relative w-full select-none"
    >
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="h-full w-full overflow-visible"
        preserveAspectRatio="none"
      >
        <defs>
          {series.map((s) => (
            <linearGradient
              key={s.id}
              id={`${gradientPrefix}-gradient-${s.id}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="85%" stopColor={s.color} stopOpacity="0.02" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {/* Horizontal grid lines & Y ticks */}
        {scale.ticks.map((tickVal) => {
          const y = valueToY(tickVal)
          return (
            <g key={tickVal}>
              <line
                x1={0}
                y1={y}
                x2={VIEW_WIDTH}
                y2={y}
                stroke="#232b25"
                strokeDasharray="2 4"
                strokeWidth={1}
              />
              <text
                x={4}
                y={y - 4}
                fill="#65726a"
                fontSize={10}
                fontFamily="var(--font-mono)"
                className="select-none"
              >
                {formatValue(tickVal)}
              </text>
            </g>
          )
        })}

        {/* Area gradients */}
        {seriesPaths.map(({ series: s, area }) => (
          <path
            key={`area-${s.id}`}
            d={area}
            fill={`url(#${gradientPrefix}-gradient-${s.id})`}
            className="transition-opacity duration-200"
          />
        ))}

        {/* Spline Lines */}
        {seriesPaths.map(({ series: s, line }) => (
          <path
            key={`line-${s.id}`}
            d={line}
            fill="none"
            stroke={s.color}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-all duration-200"
          />
        ))}

        {/* Hover Crosshair & Dots */}
        {hoverIndex !== null && (
          <g>
            <line
              x1={hoverIndex * stepX}
              y1={PLOT_TOP}
              x2={hoverIndex * stepX}
              y2={PLOT_BOTTOM}
              stroke="#65726a"
              strokeDasharray="3 3"
              strokeWidth={1.2}
            />
            {seriesPaths.map(({ series: s, coordPoints }) => {
              const pt = coordPoints[hoverIndex]
              if (!pt) return null
              return (
                <circle
                  key={`dot-${s.id}`}
                  cx={pt.x}
                  cy={pt.y}
                  r={4.5}
                  fill={s.color}
                  stroke="#070907"
                  strokeWidth={2}
                />
              )
            })}
          </g>
        )}

        {/* X Axis Time Labels */}
        {xTicks.map((tick, i) => (
          <text
            key={i}
            x={tick.x}
            y={VIEW_HEIGHT - 4}
            textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
            fill="#7a857c"
            fontSize={11}
            fontFamily="var(--font-mono)"
          >
            {tick.label}
          </text>
        ))}
      </svg>

      {/* Floating Interactive Tooltip */}
      {hoveredPoint && tooltipPos && (
        <div
          className="pointer-events-none absolute z-30 min-w-[180px] -translate-x-1/2 -translate-y-full rounded-lg border border-line-strong bg-panel/95 p-3 text-xs shadow-2xl backdrop-blur-md transition-all"
          style={{
            left: `${Math.max(100, Math.min(containerRef.current ? containerRef.current.clientWidth - 100 : 0, tooltipPos.x))}px`,
            top: `${Math.max(70, tooltipPos.y - 12)}px`,
          }}
        >
          <div className="mb-2 font-mono text-[11px] font-medium text-faint">
            {hoveredPoint.periodLabel}
          </div>
          <div className="space-y-1.5">
            {series.map((s) => {
              const val = hoveredPoint.values[s.id] ?? 0
              if (val === 0 && series.length > 3) return null
              return (
                <div key={s.id} className="flex items-center justify-between gap-3 font-mono">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-muted">{s.label}</span>
                  </div>
                  <span className="font-medium text-text">{formatValue(val)}</span>
                </div>
              )
            })}
            <div className="mt-2 flex items-center justify-between border-t border-line pt-1.5 font-mono">
              <span className="text-faint">Total</span>
              <span className="font-semibold text-text">
                {formatValue(hoveredPoint.total)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
