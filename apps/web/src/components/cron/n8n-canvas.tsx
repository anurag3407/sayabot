"use client"

import { useEffect, useId, useRef, useState } from "react"
import {
  AlertCircle,
  Bot,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  History,
  LayoutGrid,
  List,
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { showToast } from "@/components/ui/toast"
import { Avatar } from "@/components/ui/avatar"
import { cn } from "@/lib/format"

export interface RoutineItem {
  id: string
  name: string
  description: string | null
  schedule_expr: string
  human_schedule: string
  timezone: string
  prompt: string
  enabled: boolean
  next_run_at: string | null
  last_run_at: string | null
  last_status: "idle" | "running" | "success" | "failed"
  last_error: string | null
  run_count: number
  metadata: Record<string, any>
  created_at: string
  agents?: {
    id: string
    handle: string
    display_name: string
    avatar_url: string | null
    model: string
  } | null
  rooms?: {
    id: string
    name: string
    kind: string
  } | null
}

export interface RoutineRun {
  id: string
  status: "running" | "success" | "failed"
  started_at: string
  finished_at: string | null
  output: string | null
  error: string | null
}

export interface N8nCanvasProps {
  orgSlug: string
  initialRoutines: RoutineItem[]
  availableAgents: {
    id: string
    handle: string
    displayName: string
    avatarUrl?: string | null
    model: string
  }[]
  availableRooms: { id: string; name: string; kind: string }[]
}

const PRESET_SCHEDULES = [
  { label: "Every 15 minutes", expr: "*/15 * * * *" },
  { label: "Every hour", expr: "0 * * * *" },
  { label: "Every 2 hours", expr: "0 */2 * * *" },
  { label: "Daily at 9:00 AM", expr: "0 9 * * *" },
  { label: "Every weekday at 9:00 AM", expr: "0 9 * * 1-5" },
  { label: "Weekly (Monday at 9:00 AM)", expr: "0 9 * * 1" },
]

export function N8nCanvas({
  orgSlug,
  initialRoutines,
  availableAgents,
  availableRooms,
}: N8nCanvasProps) {
  const [routines, setRoutines] = useState<RoutineItem[]>(initialRoutines)
  const [activeRoutineId, setActiveRoutineId] = useState<string | null>(
    initialRoutines[0]?.id ?? null,
  )
  const [viewMode, setViewMode] = useState<"canvas" | "list">("canvas")
  const [isInspectorOpen, setIsInspectorOpen] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<"params" | "runs">("params")
  const [runs, setRuns] = useState<RoutineRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [isExecutingNow, setIsExecutingNow] = useState(false)
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  // Canvas pan and zoom state
  const [pan, setPan] = useState({ x: 40, y: 40 })
  const [zoom, setZoom] = useState(1)
  const [isPanning, setIsPanning] = useState(false)
  const [startPan, setStartPan] = useState({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)

  const activeRoutine = routines.find((r) => r.id === activeRoutineId) || routines[0] || null

  // Fetch routine runs whenever active routine changes and inspector is on runs tab
  useEffect(() => {
    if (!activeRoutineId || !isInspectorOpen || inspectorTab !== "runs") return
    let active = true
    setRunsLoading(true)
    fetch(`/api/workspaces/${orgSlug}/routines/${activeRoutineId}`)
      .then((res) => res.json())
      .then((data) => {
        if (active && data.runs) {
          setRuns(data.runs)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setRunsLoading(false)
      })
    return () => {
      active = false
    }
  }, [activeRoutineId, isInspectorOpen, inspectorTab, orgSlug])

  // Mouse pan handlers
  function handleMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest(".no-pan")) return
    setIsPanning(true)
    setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isPanning) return
    setPan({
      x: e.clientX - startPan.x,
      y: e.clientY - startPan.y,
    })
  }

  function handleMouseUp() {
    setIsPanning(false)
  }

  function handleWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setZoom((z) => Math.min(Math.max(z + delta, 0.5), 1.8))
    }
  }

  async function handleToggleRoutine(routine: RoutineItem, e?: React.MouseEvent) {
    e?.stopPropagation()
    const nextEnabled = !routine.enabled
    try {
      const res = await fetch(`/api/workspaces/${orgSlug}/routines/${routine.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      })
      if (!res.ok) throw new Error("Failed to update routine status")
      const updated = await res.json()
      setRoutines((prev) =>
        prev.map((r) => (r.id === routine.id ? { ...r, ...updated.routine } : r)),
      )
      showToast({
        message: `Routine '${routine.name}' ${nextEnabled ? "resumed" : "paused"}.`,
        tone: "success",
      })
    } catch {
      showToast({ message: "Failed to update routine status", tone: "danger" })
    }
  }

  async function handleExecuteNow(routineId: string) {
    setIsExecutingNow(true)
    try {
      const res = await fetch(`/api/workspaces/${orgSlug}/routines/${routineId}/run`, {
        method: "POST",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Execution failed")
      showToast({
        message: `Workflow executed immediately! Agent turn enqueued.`,
        tone: "success",
      })
      // Refresh routine details
      const detailRes = await fetch(`/api/workspaces/${orgSlug}/routines/${routineId}`)
      const detail = await detailRes.json()
      if (detail.routine) {
        setRoutines((prev) =>
          prev.map((r) => (r.id === routineId ? { ...r, ...detail.routine } : r)),
        )
      }
      if (detail.runs) {
        setRuns(detail.runs)
      }
    } catch (err: any) {
      showToast({ message: err.message || "Failed to execute routine", tone: "danger" })
    } finally {
      setIsExecutingNow(false)
    }
  }

  async function handleDeleteRoutine(routineId: string) {
    if (!confirm("Are you sure you want to delete this scheduled routine?")) return
    try {
      const res = await fetch(`/api/workspaces/${orgSlug}/routines/${routineId}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to delete routine")
      setRoutines((prev) => prev.filter((r) => r.id !== routineId))
      setIsInspectorOpen(false)
      showToast({ message: "Routine deleted successfully", tone: "success" })
    } catch {
      showToast({ message: "Failed to delete routine", tone: "danger" })
    }
  }

  const filteredRoutines = routines.filter(
    (r) =>
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.schedule_expr.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.description && r.description.toLowerCase().includes(searchQuery.toLowerCase())),
  )

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-void text-text">
      {/* Top Workflow Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-line bg-panel/75 px-4 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent">
              <Zap className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight text-text">
                Cron Automations & Routines
              </h1>
              <p className="text-[12px] text-muted">
                Hermes-class scheduled autonomous agents & workflows
              </p>
            </div>
          </div>

          <div className="ml-4 hidden items-center gap-2 rounded-lg border border-line bg-subtle px-2 py-1 text-[12px] font-mono sm:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{routines.filter((r) => r.enabled).length} Active</span>
            <span className="text-muted">|</span>
            <span className="text-muted">{routines.length} Total</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search bar */}
          <div className="relative hidden md:block">
            <input
              type="text"
              placeholder="Search routines..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-44 rounded-lg border border-line bg-void/50 px-2.5 text-[12px] placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </div>

          {/* View mode toggle */}
          <div className="flex items-center rounded-lg border border-line bg-void/50 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("canvas")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition-colors",
                viewMode === "canvas" ? "bg-panel text-text shadow-xs" : "text-muted hover:text-text",
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>Canvas</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition-colors",
                viewMode === "list" ? "bg-panel text-text shadow-xs" : "text-muted hover:text-text",
              )}
            >
              <List className="h-3.5 w-3.5" />
              <span>List</span>
            </button>
          </div>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setIsCreatingNew(true)}
            className="flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Routine</span>
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="relative flex-1 overflow-hidden">
        {viewMode === "list" ? (
          /* Table List View */
          <div className="h-full overflow-y-auto p-6">
            <div className="mx-auto max-w-5xl rounded-xl border border-line bg-panel overflow-hidden shadow-xs">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-line bg-subtle/50 text-muted font-medium">
                  <tr>
                    <th className="px-4 py-3">Routine</th>
                    <th className="px-4 py-3">Schedule</th>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3">Destination</th>
                    <th className="px-4 py-3">Next Run</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {filteredRoutines.map((routine) => (
                    <tr
                      key={routine.id}
                      onClick={() => {
                        setActiveRoutineId(routine.id)
                        setIsInspectorOpen(true)
                      }}
                      className="cursor-pointer hover:bg-subtle/40 transition-colors"
                    >
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-text">{routine.name}</div>
                        {routine.description ? (
                          <div className="text-[11px] text-muted truncate max-w-[200px]">
                            {routine.description}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] text-amber-500">
                          <Clock className="h-3 w-3" />
                          <span>{routine.schedule_expr}</span>
                        </div>
                        <div className="text-[11px] text-muted">{routine.human_schedule}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5 text-text">
                          <Bot className="h-3.5 w-3.5 text-indigo-400" />
                          <span>@{routine.agents?.handle || "bot"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-muted">
                          #{routine.rooms?.name || "default room"}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-muted font-mono text-[11px]">
                        {routine.next_run_at
                          ? new Date(routine.next_run_at).toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "Paused"}
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            routine.enabled
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-line text-muted",
                          )}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              routine.enabled ? "bg-emerald-400" : "bg-muted",
                            )}
                          />
                          {routine.enabled ? "Active" : "Paused"}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            title="Execute now"
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleExecuteNow(routine.id)
                            }}
                            className="p-1 text-muted hover:text-accent rounded hover:bg-subtle"
                          >
                            <Play className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title={routine.enabled ? "Pause" : "Resume"}
                            onClick={(e) => void handleToggleRoutine(routine, e)}
                            className="p-1 text-muted hover:text-text rounded hover:bg-subtle"
                          >
                            {routine.enabled ? (
                              <Pause className="h-3.5 w-3.5" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredRoutines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted">
                        No routines found. Click &quot;New Routine&quot; to create your first automation.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* n8n-Styled Visual Canvas */
          <div
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            className="relative h-full w-full select-none overflow-hidden cursor-grab active:cursor-grabbing"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(255, 255, 255, 0.1) 1.2px, transparent 1.2px)",
              backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
              backgroundPosition: `${pan.x}px ${pan.y}px`,
            }}
          >
            {/* Routine Selector Bar when multiple routines exist */}
            {routines.length > 1 ? (
              <div className="no-pan absolute left-4 top-4 z-10 flex max-w-[calc(100%-100px)] gap-1.5 overflow-x-auto rounded-xl border border-line bg-panel/90 p-1.5 backdrop-blur-md shadow-lg">
                {routines.map((routine, idx) => (
                  <button
                    key={routine.id}
                    type="button"
                    onClick={() => {
                      setActiveRoutineId(routine.id)
                      setPan({ x: 40, y: -(idx * 260) + 60 })
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all whitespace-nowrap",
                      routine.id === activeRoutineId
                        ? "bg-accent/15 text-accent border border-accent/30 shadow-xs"
                        : "text-muted hover:bg-subtle hover:text-text border border-transparent",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        routine.enabled ? "bg-emerald-400" : "bg-muted",
                      )}
                    />
                    <span>{routine.name}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {/* Transform Canvas Surface */}
            <div
              className="absolute left-0 top-0 origin-top-left transition-transform duration-75 ease-out"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
            >
              {filteredRoutines.length > 0 ? (
                <div className="relative pt-12 pb-24 pl-8">
                  {/* SVG Bezier Connection Edges for all routines */}
                  <svg
                    className="pointer-events-none absolute left-0 top-0 overflow-visible"
                    style={{
                      width: "1200px",
                      height: `${Math.max(600, filteredRoutines.length * 260 + 100)}px`,
                      zIndex: 1,
                    }}
                  >
                    <defs>
                      <linearGradient id="edge-gradient-1" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#f59e0b" />
                        <stop offset="100%" stopColor="#6366f1" />
                      </linearGradient>
                      <linearGradient id="edge-gradient-2" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#6366f1" />
                        <stop offset="100%" stopColor="#10b981" />
                      </linearGradient>
                      <style>{`
                        @keyframes n8nFlow {
                          from { stroke-dashoffset: 24; }
                          to { stroke-dashoffset: 0; }
                        }
                        .n8n-flow-active {
                          animation: n8nFlow 1.2s linear infinite;
                        }
                      `}</style>
                    </defs>

                    {filteredRoutines.map((routine, idx) => {
                      const y = idx * 260 + 71 + 48
                      return (
                        <g
                          key={routine.id}
                          className={routine.enabled ? "opacity-100" : "opacity-35"}
                        >
                          {/* Edge 1: Schedule Trigger -> AI Agent Node */}
                          <path
                            d={`M 288 ${y} C 336 ${y}, 344 ${y}, 392 ${y}`}
                            fill="none"
                            stroke="url(#edge-gradient-1)"
                            strokeWidth="2.5"
                            strokeDasharray={routine.enabled ? "6 6" : undefined}
                            className={routine.enabled ? "n8n-flow-active" : undefined}
                          />

                          {/* Edge 2: AI Agent Node -> Room Delivery Node */}
                          <path
                            d={`M 680 ${y} C 728 ${y}, 736 ${y}, 784 ${y}`}
                            fill="none"
                            stroke="url(#edge-gradient-2)"
                            strokeWidth="2.5"
                            strokeDasharray={routine.enabled ? "6 6" : undefined}
                            className={routine.enabled ? "n8n-flow-active" : undefined}
                          />
                        </g>
                      )
                    })}
                  </svg>

                  {/* Node Workflow Chains Stack */}
                  <div className="space-y-12">
                    {filteredRoutines.map((routine) => {
                      const isSelected = routine.id === (activeRoutine?.id ?? activeRoutineId)
                      return (
                        <div key={routine.id} className="relative">
                          {/* Workflow Header Label */}
                          <div className="mb-2 flex items-center gap-2">
                            <span className="font-mono text-[11px] font-semibold text-muted uppercase tracking-wider">
                              Workflow:
                            </span>
                            <span className="text-[13px] font-bold text-text">
                              {routine.name}
                            </span>
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.2 text-[10px] font-medium",
                                routine.enabled
                                  ? "bg-emerald-500/15 text-emerald-400"
                                  : "bg-line text-muted",
                              )}
                            >
                              {routine.enabled ? "Active" : "Paused"}
                            </span>
                          </div>

                          <div className="flex items-start gap-24">
                            {/* 1. Trigger Node (Schedule / Cron) */}
                            <div
                              onClick={() => {
                                setActiveRoutineId(routine.id)
                                setIsInspectorOpen(true)
                                setInspectorTab("params")
                              }}
                              className={cn(
                                "no-pan relative w-72 rounded-2xl border bg-panel p-4 shadow-xl transition-all hover:scale-[1.02] cursor-pointer group",
                                isSelected
                                  ? "ring-2 ring-accent border-accent"
                                  : routine.enabled
                                    ? "border-amber-500/40 hover:border-amber-500 shadow-amber-500/5"
                                    : "border-line opacity-75",
                              )}
                              style={{ zIndex: 2 }}
                            >
                              {/* Output Port Pin (Right) */}
                              <div className="absolute -right-3 top-[71px] h-6 w-6 rounded-full border-2 border-amber-500 bg-void flex items-center justify-center shadow-md">
                                <span className="h-2 w-2 rounded-full bg-amber-500" />
                              </div>

                              {/* Header */}
                              <div className="flex items-center justify-between border-b border-line/60 pb-3">
                                <div className="flex items-center gap-2">
                                  <div className="grid h-7 w-7 place-items-center rounded-lg bg-amber-500/15 text-amber-500">
                                    <Clock className="h-4 w-4" />
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-mono uppercase tracking-wider text-amber-500 font-semibold">
                                      Trigger Node
                                    </span>
                                    <h3 className="text-[13px] font-semibold text-text">
                                      Schedule Trigger
                                    </h3>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    title="Execute now"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void handleExecuteNow(routine.id)
                                    }}
                                    className="p-1 text-muted hover:text-accent rounded hover:bg-subtle"
                                  >
                                    <Play className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    title={routine.enabled ? "Pause" : "Resume"}
                                    onClick={(e) => void handleToggleRoutine(routine, e)}
                                    className="p-1 text-muted hover:text-text rounded hover:bg-subtle"
                                  >
                                    {routine.enabled ? (
                                      <Pause className="h-3.5 w-3.5" />
                                    ) : (
                                      <Play className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </div>
                              </div>

                              {/* Node Body */}
                              <div className="mt-3 space-y-2">
                                <div className="rounded-lg bg-subtle p-2.5">
                                  <div className="flex items-center justify-between">
                                    <span className="font-mono text-[12px] font-bold text-amber-400">
                                      {routine.schedule_expr}
                                    </span>
                                    <span className="text-[10px] font-mono text-muted">
                                      {routine.timezone}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-[11px] text-text font-medium">
                                    {routine.human_schedule}
                                  </p>
                                </div>

                                <div className="flex items-center justify-between text-[11px] text-muted pt-1">
                                  <span>Next Execution:</span>
                                  <span className="font-mono text-text text-[11px]">
                                    {routine.next_run_at
                                      ? new Date(routine.next_run_at).toLocaleTimeString([], {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        })
                                      : "Paused"}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* 2. AI Agent Execution Node */}
                            <div
                              onClick={() => {
                                setActiveRoutineId(routine.id)
                                setIsInspectorOpen(true)
                                setInspectorTab("params")
                              }}
                              className={cn(
                                "no-pan relative w-72 rounded-2xl border bg-panel p-4 shadow-xl transition-all hover:scale-[1.02] cursor-pointer group",
                                isSelected
                                  ? "ring-2 ring-accent border-accent"
                                  : routine.enabled
                                    ? "border-indigo-500/40 hover:border-indigo-500 shadow-indigo-500/5"
                                    : "border-line opacity-75",
                              )}
                              style={{ zIndex: 2 }}
                            >
                              {/* Input Port Pin (Left) */}
                              <div className="absolute -left-3 top-[71px] h-6 w-6 rounded-full border-2 border-indigo-500 bg-void flex items-center justify-center shadow-md">
                                <span className="h-2 w-2 rounded-full bg-indigo-500" />
                              </div>

                              {/* Output Port Pin (Right) */}
                              <div className="absolute -right-3 top-[71px] h-6 w-6 rounded-full border-2 border-indigo-500 bg-void flex items-center justify-center shadow-md">
                                <span className="h-2 w-2 rounded-full bg-indigo-500" />
                              </div>

                              {/* Header */}
                              <div className="flex items-center justify-between border-b border-line/60 pb-3">
                                <div className="flex items-center gap-2">
                                  <div className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-500/15 text-indigo-400">
                                    <Bot className="h-4 w-4" />
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-400 font-semibold">
                                      Agent Node
                                    </span>
                                    <h3 className="text-[13px] font-semibold text-text">
                                      Autonomous Brain
                                    </h3>
                                  </div>
                                </div>
                                <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[10px] text-indigo-400">
                                  {routine.agents?.model || "model"}
                                </span>
                              </div>

                              {/* Node Body */}
                              <div className="mt-3 space-y-2">
                                <div className="flex items-center gap-2 rounded-lg bg-subtle p-2">
                                  <Avatar
                                    name={routine.agents?.display_name || "Bot"}
                                    kind="agent"
                                    src={routine.agents?.avatar_url || undefined}
                                    size="sm"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-[12px] font-medium text-text">
                                      {routine.agents?.display_name || "Assigned Agent"}
                                    </div>
                                    <div className="font-mono text-[10px] text-muted">
                                      @{routine.agents?.handle || "bot"}
                                    </div>
                                  </div>
                                </div>

                                <div className="rounded-lg bg-subtle/60 p-2 text-[11px] text-muted line-clamp-3 font-mono">
                                  {routine.prompt}
                                </div>
                              </div>
                            </div>

                            {/* 3. Output Delivery Node */}
                            <div
                              onClick={() => {
                                setActiveRoutineId(routine.id)
                                setIsInspectorOpen(true)
                                setInspectorTab("params")
                              }}
                              className={cn(
                                "no-pan relative w-72 rounded-2xl border bg-panel p-4 shadow-xl transition-all hover:scale-[1.02] cursor-pointer group",
                                isSelected
                                  ? "ring-2 ring-accent border-accent"
                                  : routine.enabled
                                    ? "border-emerald-500/40 hover:border-emerald-500 shadow-emerald-500/5"
                                    : "border-line opacity-75",
                              )}
                              style={{ zIndex: 2 }}
                            >
                              {/* Input Port Pin (Left) */}
                              <div className="absolute -left-3 top-[71px] h-6 w-6 rounded-full border-2 border-emerald-500 bg-void flex items-center justify-center shadow-md">
                                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                              </div>

                              {/* Header */}
                              <div className="flex items-center justify-between border-b border-line/60 pb-3">
                                <div className="flex items-center gap-2">
                                  <div className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400">
                                    <Send className="h-4 w-4" />
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-semibold">
                                      Action Node
                                    </span>
                                    <h3 className="text-[13px] font-semibold text-text">
                                      Room Delivery
                                    </h3>
                                  </div>
                                </div>
                                <span className="font-mono text-[11px] text-muted">
                                  {routine.run_count} runs
                                </span>
                              </div>

                              {/* Node Body */}
                              <div className="mt-3 space-y-2">
                                <div className="rounded-lg bg-subtle p-2.5">
                                  <span className="text-[10px] text-muted uppercase tracking-wider font-semibold">
                                    Target Channel
                                  </span>
                                  <div className="mt-0.5 text-[13px] font-semibold text-emerald-400">
                                    #{routine.rooms?.name || "default-room"}
                                  </div>
                                </div>

                                <div className="flex items-center justify-between text-[11px] text-muted pt-1">
                                  <span>Last Status:</span>
                                  <span
                                    className={cn(
                                      "font-medium capitalize",
                                      routine.last_status === "success"
                                        ? "text-emerald-400"
                                        : routine.last_status === "failed"
                                          ? "text-red-400"
                                          : "text-muted",
                                    )}
                                  >
                                    {routine.last_status}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="p-12 text-center text-muted">
                  <p>
                    No routines found. Click &quot;New Routine&quot; to build an automation workflow.
                  </p>
                </div>
              )}
            </div>

            {/* Bottom-right Zoom & Pan Controls */}
            <div className="no-pan absolute bottom-5 right-5 z-10 flex items-center gap-1 rounded-xl border border-line bg-panel/90 p-1 shadow-lg backdrop-blur-md">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(z + 0.1, 1.8))}
                className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-text"
                title="Zoom In"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <span className="w-10 text-center font-mono text-[11px] text-muted">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(z - 0.1, 0.5))}
                className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-text"
                title="Zoom Out"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <div className="h-3 w-px bg-line mx-0.5" />
              <button
                type="button"
                onClick={() => {
                  setPan({ x: 40, y: 40 })
                  setZoom(1)
                }}
                className="rounded-lg px-2 py-1 text-[11px] text-muted hover:bg-subtle hover:text-text font-medium"
              >
                Reset
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Slide-out Node / Routine Parameter Inspector Drawer */}
      {isInspectorOpen && activeRoutine ? (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-panel shadow-2xl animate-in slide-in-from-right duration-200">
          {/* Drawer Header */}
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1 pr-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    activeRoutine.enabled ? "bg-emerald-400" : "bg-muted",
                  )}
                />
                <h2 className="truncate text-[15px] font-semibold text-text">
                  {activeRoutine.name}
                </h2>
              </div>
              <p className="text-[11px] text-muted font-mono">{activeRoutine.human_schedule}</p>
            </div>

            <button
              type="button"
              onClick={() => setIsInspectorOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tab Switcher */}
          <div className="flex border-b border-line bg-subtle/40 px-5 pt-2">
            <button
              type="button"
              onClick={() => setInspectorTab("params")}
              className={cn(
                "border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
                inspectorTab === "params"
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-text",
              )}
            >
              Parameters & Nodes
            </button>
            <button
              type="button"
              onClick={() => setInspectorTab("runs")}
              className={cn(
                "border-b-2 px-3 py-2 text-[13px] font-medium transition-colors flex items-center gap-1.5",
                inspectorTab === "runs"
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-text",
              )}
            >
              <span>Execution Runs</span>
              <span className="rounded-full bg-subtle px-1.5 py-0.2 font-mono text-[10px]">
                {activeRoutine.run_count}
              </span>
            </button>
          </div>

          {/* Drawer Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {inspectorTab === "params" ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  const form = new FormData(e.currentTarget)
                  const name = form.get("name") as string
                  const schedule_expr = form.get("schedule_expr") as string
                  const agent_id = form.get("agent_id") as string
                  const room_id = form.get("room_id") as string
                  const prompt = form.get("prompt") as string
                  const timezone = form.get("timezone") as string

                  try {
                    const res = await fetch(
                      `/api/workspaces/${orgSlug}/routines/${activeRoutine.id}`,
                      {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          name,
                          schedule_expr,
                          agent_id,
                          room_id,
                          prompt,
                          timezone,
                        }),
                      },
                    )
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error || "Failed to update routine")
                    setRoutines((prev) =>
                      prev.map((r) => (r.id === activeRoutine.id ? { ...r, ...data.routine } : r)),
                    )
                    showToast({ message: "Routine updated successfully", tone: "success" })
                  } catch (err: any) {
                    showToast({ message: err.message || "Failed to save", tone: "danger" })
                  }
                }}
                className="space-y-4"
              >
                <Field label="Workflow Name" htmlFor="routine-name">
                  <Input
                    id="routine-name"
                    name="name"
                    defaultValue={activeRoutine.name}
                    required
                  />
                </Field>

                <Field label="Schedule Expression (Cron or Shorthand)" htmlFor="routine-schedule">
                  <Input
                    id="routine-schedule"
                    name="schedule_expr"
                    defaultValue={activeRoutine.schedule_expr}
                    required
                  />
                </Field>

                {/* Preset Chips */}
                <div className="space-y-1.5">
                  <span className="text-[11px] text-muted">Quick Schedule Presets:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_SCHEDULES.map((preset) => (
                      <button
                        key={preset.expr}
                        type="button"
                        onClick={() => {
                          const input = document.getElementById(
                            "routine-schedule",
                          ) as HTMLInputElement
                          if (input) input.value = preset.expr
                        }}
                        className="rounded-md border border-line bg-subtle px-2 py-1 text-[11px] text-text hover:border-accent hover:text-accent transition-colors"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <Field label="Timezone" htmlFor="routine-timezone">
                  <Select
                    id="routine-timezone"
                    name="timezone"
                    defaultValue={activeRoutine.timezone || "UTC"}
                  >
                    <option value="UTC">UTC (Universal Time)</option>
                    <option value="America/New_York">America/New York (EST/EDT)</option>
                    <option value="America/Los_Angeles">America/Los Angeles (PST/PDT)</option>
                    <option value="Europe/London">Europe/London (GMT/BST)</option>
                    <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                    <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                  </Select>
                </Field>

                <Field label="Assigned Autonomous Agent" htmlFor="routine-agent">
                  <Select
                    id="routine-agent"
                    name="agent_id"
                    defaultValue={activeRoutine.agents?.id || availableAgents[0]?.id}
                  >
                    {availableAgents.map((ag) => (
                      <option key={ag.id} value={ag.id}>
                        @{ag.handle} - {ag.displayName} ({ag.model})
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Delivery Room" htmlFor="routine-room">
                  <Select
                    id="routine-room"
                    name="room_id"
                    defaultValue={activeRoutine.rooms?.id || availableRooms[0]?.id || ""}
                  >
                    <option value="">Organization General Room</option>
                    {availableRooms.map((rm) => (
                      <option key={rm.id} value={rm.id}>
                        #{rm.name} ({rm.kind})
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label="Agent Task Prompt / Instructions"
                  htmlFor="routine-prompt"
                  hint="Instructions provided to the agent on trigger"
                >
                  <Textarea
                    id="routine-prompt"
                    name="prompt"
                    rows={5}
                    defaultValue={activeRoutine.prompt}
                    required
                    className="font-mono text-[12px]"
                  />
                </Field>

                <div className="pt-2 flex items-center gap-2">
                  <Button type="submit" variant="primary" className="flex-1">
                    Save Workflow
                  </Button>
                </div>
              </form>
            ) : (
              /* Execution Runs History */
              <div className="space-y-3">
                {runsLoading ? (
                  <div className="flex items-center justify-center py-8 text-muted">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : runs.length === 0 ? (
                  <div className="text-center py-8 text-muted text-[13px]">
                    No recorded executions yet. Click &quot;Execute Now&quot; to test run this workflow.
                  </div>
                ) : (
                  runs.map((run) => (
                    <div
                      key={run.id}
                      className="rounded-xl border border-line bg-subtle p-3 space-y-2 text-[12px]"
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                            run.status === "success"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : run.status === "failed"
                                ? "bg-red-500/15 text-red-400"
                                : "bg-amber-500/15 text-amber-400",
                          )}
                        >
                          {run.status === "success" ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : run.status === "failed" ? (
                            <AlertCircle className="h-3 w-3" />
                          ) : (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          )}
                          <span>{run.status}</span>
                        </span>

                        <span className="font-mono text-[11px] text-muted">
                          {new Date(run.started_at).toLocaleString()}
                        </span>
                      </div>

                      {run.output ? (
                        <div className="rounded bg-void/50 p-2 font-mono text-[11px] text-text break-words">
                          {run.output}
                        </div>
                      ) : null}

                      {run.error ? (
                        <div className="rounded bg-red-500/10 p-2 font-mono text-[11px] text-red-400 break-words">
                          {run.error}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Action Buttons: Execute Now, Pause, Delete */}
            <div className="border-t border-line pt-4 space-y-2">
              <Button
                type="button"
                variant="secondary"
                disabled={isExecutingNow}
                onClick={() => void handleExecuteNow(activeRoutine.id)}
                className="w-full flex items-center justify-center gap-2"
              >
                {isExecutingNow ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 text-emerald-400" />
                )}
                <span>Execute Workflow Now</span>
              </Button>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleToggleRoutine(activeRoutine)}
                  className="flex-1 flex items-center justify-center gap-1.5"
                >
                  {activeRoutine.enabled ? (
                    <>
                      <Pause className="h-3.5 w-3.5" />
                      <span>Pause Routine</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" />
                      <span>Resume Routine</span>
                    </>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleDeleteRoutine(activeRoutine.id)}
                  className="flex items-center justify-center gap-1.5 text-red-400 hover:text-red-300 hover:border-red-500/40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* New Routine Modal */}
      {isCreatingNew ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-line bg-panel p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent">
                  <Sparkles className="h-4 w-4" />
                </div>
                <h2 className="text-[16px] font-semibold text-text">Create Scheduled Routine</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsCreatingNew(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault()
                const form = new FormData(e.currentTarget)
                const name = form.get("name") as string
                const schedule_expr = form.get("schedule_expr") as string
                const agent_id = form.get("agent_id") as string
                const room_id = form.get("room_id") as string
                const prompt = form.get("prompt") as string
                const timezone = form.get("timezone") as string

                try {
                  const res = await fetch(`/api/workspaces/${orgSlug}/routines`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      name,
                      schedule_expr,
                      agent_id,
                      room_id,
                      prompt,
                      timezone,
                    }),
                  })
                  const data = await res.json()
                  if (!res.ok) throw new Error(data.error || "Failed to create routine")
                  setRoutines((prev) => [data.routine, ...prev])
                  setActiveRoutineId(data.routine.id)
                  setIsCreatingNew(false)
                  showToast({ message: "Routine created successfully!", tone: "success" })
                } catch (err: any) {
                  showToast({ message: err.message || "Failed to create", tone: "danger" })
                }
              }}
              className="space-y-3.5"
            >
              <Field label="Routine Name" htmlFor="new-name">
                <Input
                  id="new-name"
                  name="name"
                  placeholder="e.g. Daily Standup Briefing"
                  required
                />
              </Field>

              <Field
                label="Schedule"
                htmlFor="new-schedule"
                hint="Cron expr ('0 9 * * 1-5') or natural shorthand ('daily at 9am')"
              >
                <Input
                  id="new-schedule"
                  name="schedule_expr"
                  placeholder="daily at 9am"
                  required
                />
              </Field>

              <Field label="Timezone" htmlFor="new-timezone">
                <Select id="new-timezone" name="timezone" defaultValue="UTC">
                  <option value="UTC">UTC (Universal Time)</option>
                  <option value="America/New_York">America/New York (EST/EDT)</option>
                  <option value="America/Los_Angeles">America/Los Angeles (PST/PDT)</option>
                  <option value="Europe/London">Europe/London (GMT/BST)</option>
                  <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                  <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                </Select>
              </Field>

              <Field label="Target Agent" htmlFor="new-agent">
                <Select id="new-agent" name="agent_id" defaultValue={availableAgents[0]?.id}>
                  {availableAgents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      @{ag.handle} - {ag.displayName} ({ag.model})
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Target Room" htmlFor="new-room">
                <Select id="new-room" name="room_id" defaultValue="">
                  <option value="">General Room</option>
                  {availableRooms.map((rm) => (
                    <option key={rm.id} value={rm.id}>
                      #{rm.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Task Prompt Instructions" htmlFor="new-prompt">
                <Textarea
                  id="new-prompt"
                  name="prompt"
                  rows={4}
                  placeholder="Summarize uncompleted tasks, check git status, and post top 3 priorities for today."
                  required
                  className="font-mono text-[12px]"
                />
              </Field>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCreatingNew(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Create Routine
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
