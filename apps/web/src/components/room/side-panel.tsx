"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition, type ComponentType, type ReactNode } from "react"
import {
  Box,
  CircleOff,
  Cloud,
  Monitor,
  Plus,
  Server,
  ShieldAlert,
  Sparkles,
  X,
  Zap,
} from "lucide-react"
import { setAgentWorksOnAction } from "@/lib/actions/agents"
import { WorksOnPicker } from "@/components/agents/works-on-picker"
import { ToolCallsList } from "@/components/room/tool-call-card"
import { Mascot } from "@/components/ui/mascot"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"
import type { RoomAgentView, ToolCallView } from "@/lib/types"

export type SideTab = "screen" | "activity" | "canvas" | "routines"

export interface RoomRoutine {
  id: string
  name: string
  schedule: string
  enabled: boolean
  nextRunAt: string | null
  lastStatus: string | null
  agentName: string | null
}

type Icon = ComponentType<{ className?: string }>

/** The screen preview's icon for each Works on value. The picker itself is WorksOnPicker. */
const PLACES: { value: string; label: string; hint: string; icon: Icon }[] = [
  { value: "auto", label: "Auto", hint: "Uses whatever is ready", icon: Sparkles },
  { value: "boat", label: "Cloud desktop", hint: "Hosted, sleeps when idle", icon: Cloud },
  { value: "local_vm", label: "Private desktop", hint: "Sealed box on your Mac", icon: Box },
  { value: "this_computer", label: "This computer", hint: "Your screen and apps", icon: Monitor },
  { value: "vps", label: "Your server", hint: "Docker on a VPS you own", icon: Server },
  { value: "e2b", label: "E2B sandbox", hint: "Cloud Linux, pauses when idle", icon: Cloud },
  { value: "off", label: "No desktop", hint: "Chat and tools only", icon: CircleOff },
]

function readWorksOn(params: Record<string, unknown>): { worksOn: string; thisComputer: boolean } {
  const worksOn = typeof params.worksOn === "string" ? params.worksOn : "auto"
  const computer = (params.computer as Record<string, unknown> | undefined) ?? {}
  return { worksOn, thisComputer: computer.thisComputer === true }
}

function ScreenTab({
  orgSlug,
  agents,
  canAdmin,
}: {
  orgSlug: string
  agents: RoomAgentView[]
  canAdmin: boolean
}) {
  const router = useRouter()
  const [agentId, setAgentId] = useState(agents[0]?.agent.id ?? null)
  const agent = agents.find((item) => item.agent.id === agentId)?.agent ?? agents[0]?.agent
  const saved = agent ? readWorksOn(agent.params) : { worksOn: "auto", thisComputer: false }
  // Shown at once; the server copy catches up on refresh.
  const [local, setLocal] = useState<Record<string, { worksOn: string; thisComputer: boolean }>>({})
  const current = (agent && local[agent.id]) || saved
  const [pending, startTransition] = useTransition()

  if (!agent) {
    return (
      <p className="px-2 py-10 text-center text-[13px] leading-relaxed text-faint">
        Add a bot to this chat to give it a computer.
      </p>
    )
  }

  function save(next: { worksOn: string; thisComputer: boolean }) {
    if (!agent) return
    const previous = current
    setLocal((all) => ({ ...all, [agent.id]: next }))
    startTransition(async () => {
      const result = await setAgentWorksOnAction({
        orgSlug,
        agentId: agent.id,
        worksOn: next.worksOn,
        thisComputer: next.thisComputer,
      })
      if (!result.ok) {
        setLocal((all) => ({ ...all, [agent.id]: previous }))
        showToast({ tone: "danger", message: result.error ?? "Could not save" })
        return
      }
      showToast({ tone: "success", message: result.message ?? "Saved" })
      router.refresh()
    })
  }

  const PlaceIcon = PLACES.find((item) => item.value === current.worksOn)?.icon ?? Sparkles
  const needsPermission = current.worksOn === "this_computer" && !current.thisComputer

  return (
    <div className="space-y-4">
      {agents.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Bot">
          {agents.map(({ agent: item }) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === agent.id}
              onClick={() => setAgentId(item.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-[12.5px]",
                item.id === agent.id ? "bg-raised text-text" : "text-muted hover:bg-panel",
              )}
            >
              <Mascot seed={item.displayName} className="h-5 w-5" />
              {item.displayName}
            </button>
          ))}
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-[13px] text-muted">{agent.displayName}&apos;s screen</p>
        <div className="flex min-h-[188px] flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-panel/60 px-6 py-8 text-center">
          {current.worksOn === "off" ? (
            <>
              <CircleOff className="h-6 w-6 text-faint" />
              <p className="max-w-[280px] text-[13px] leading-relaxed text-muted">
                {agent.displayName} has no desktop yet. Pick a place below and it can open websites and apps for you.
              </p>
            </>
          ) : (
            <>
              <PlaceIcon className="h-6 w-6 text-muted" />
              <p className="max-w-[300px] text-[13px] leading-relaxed text-muted">
                When {agent.displayName} uses its computer you can watch here live, and take over any time.
              </p>
              <Link
                href={`/${orgSlug}/agents/${agent.id}`}
                className="rounded-xl bg-raised px-3.5 py-2 text-[13px] font-medium text-text transition-colors hover:bg-hover"
              >
                Open live view
              </Link>
            </>
          )}
        </div>
      </div>

      {needsPermission ? (
        <div className="rounded-2xl border border-warn/40 bg-warn/[0.07] p-4">
          <div className="flex gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-text">Allow control of this computer</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                {agent.displayName} will see your screen and use your apps. Your Mac also asks for Screen
                Recording and Accessibility in System Settings → Privacy &amp; Security.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!canAdmin || pending}
                  onClick={() => save({ worksOn: "this_computer", thisComputer: true })}
                  className="rounded-full bg-text px-3.5 py-1.5 text-[13px] font-medium text-void hover:bg-white disabled:opacity-50"
                >
                  Allow
                </button>
                <button
                  type="button"
                  disabled={!canAdmin || pending}
                  onClick={() => save({ worksOn: "auto", thisComputer: false })}
                  className="rounded-full px-3 py-1.5 text-[13px] text-muted hover:text-text disabled:opacity-50"
                >
                  Not now
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-line bg-panel/60 p-4">
        <p className="text-[15px] font-medium text-text">Works on</p>
        <p className="mt-0.5 text-[13px] text-faint">Choose where {agent.displayName} works.</p>
        <div className="mt-3">
          <WorksOnPicker
            orgSlug={orgSlug}
            worksOn={current.worksOn}
            canAdmin={canAdmin}
            disabled={!canAdmin || pending}
            onChange={(worksOn) => save({ worksOn, thisComputer: current.thisComputer })}
          />
        </div>
        {!canAdmin ? (
          <p className="mt-2 text-[12px] text-faint">Only workspace admins can change this.</p>
        ) : null}
      </div>
    </div>
  )
}

function ActivityTab({
  orgSlug,
  calls,
  canAdmin,
  viewerId,
  agentName,
}: {
  orgSlug: string
  calls: ToolCallView[]
  canAdmin: boolean
  viewerId: string
  agentName: string | null
}) {
  const waiting = calls.filter((call) => call.status === "pending_approval")
  const rest = calls
    .filter((call) => call.status !== "pending_approval")
    .slice()
    .reverse()
    .slice(0, 40)

  if (!calls.length) {
    return (
      <div className="px-4 py-12 text-center">
        <Zap className="mx-auto h-6 w-6 text-faint" />
        <p className="mx-auto mt-3 max-w-[280px] text-[13px] leading-relaxed text-faint">
          Every step a bot takes shows up here: searches, files, its computer. Anything risky waits for your OK first.
        </p>
      </div>
    )
  }

  return (
    <div>
      {waiting.length ? (
        <p className="mb-1 text-[13px] font-medium text-accent">
          {waiting.length === 1 ? "1 step is waiting for you" : `${waiting.length} steps are waiting for you`}
        </p>
      ) : null}
      <ToolCallsList
        calls={[...waiting, ...rest]}
        orgSlug={orgSlug}
        canApprove={canAdmin}
        agentName={agentName}
        viewerId={viewerId}
      />
    </div>
  )
}

function RoutinesTab({ orgSlug, routines }: { orgSlug: string; routines: RoomRoutine[] }) {
  return (
    <div className="space-y-3">
      {routines.length ? (
        <ul className="space-y-2">
          {routines.map((routine) => (
            <li key={routine.id} className="rounded-xl border border-line bg-panel/60 px-3.5 py-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn("h-2 w-2 shrink-0 rounded-full", routine.enabled ? "bg-ok" : "bg-faint")}
                  aria-label={routine.enabled ? "On" : "Paused"}
                />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text">{routine.name}</span>
                {routine.lastStatus === "error" ? (
                  <span className="shrink-0 text-[11.5px] text-danger">Last run failed</span>
                ) : null}
              </div>
              <p className="mt-1 truncate text-[12.5px] text-faint">
                {routine.schedule}
                {routine.agentName ? ` · ${routine.agentName}` : ""}
                {routine.enabled && routine.nextRunAt
                  ? ` · next ${new Date(routine.nextRunAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed border-line-strong px-4 py-8 text-center">
          <p className="text-[14px] font-medium text-text">No routines in this chat</p>
          <p className="mx-auto mt-1 max-w-[280px] text-[13px] leading-relaxed text-faint">
            Just ask in the chat, like &ldquo;every weekday at 9, send me the news in my field&rdquo;.
          </p>
        </div>
      )}
      <Link
        href={`/${orgSlug}/cron`}
        className="flex items-center justify-center gap-1.5 rounded-xl bg-raised px-3 py-2 text-[13px] font-medium text-text transition-colors hover:bg-hover"
      >
        <Plus className="h-4 w-4" />
        Open routines
      </Link>
    </div>
  )
}

/**
 * The chat's right-hand panel: the bot's screen and where it works, every step it takes, the
 * shared canvas, and the routines that post here. One place instead of four settings pages.
 */
export function RoomSidePanel({
  tab,
  onTabChange,
  onClose,
  orgSlug,
  agents,
  canAdmin,
  viewerId,
  toolCalls,
  routines,
  canvas,
}: {
  tab: SideTab
  onTabChange: (tab: SideTab) => void
  onClose: () => void
  orgSlug: string
  agents: RoomAgentView[]
  canAdmin: boolean
  viewerId: string
  toolCalls: ToolCallView[]
  routines: RoomRoutine[]
  canvas: ReactNode
}) {
  const waiting = toolCalls.filter((call) => call.status === "pending_approval").length
  const tabs: { id: SideTab; label: string; badge?: number }[] = [
    ...(agents.length ? [{ id: "screen" as const, label: "Screen" }] : []),
    { id: "activity", label: "Activity", badge: waiting },
    { id: "canvas", label: "Canvas" },
    { id: "routines", label: "Routines" },
  ]
  const shown = tabs.some((item) => item.id === tab) ? tab : "activity"

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto rounded-full bg-panel p-1 [scrollbar-width:none]" role="tablist" aria-label="Panel">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={shown === item.id}
              onClick={() => onTabChange(item.id)}
              className={cn(
                "relative flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition-colors",
                shown === item.id ? "bg-raised font-medium text-text shadow-[0_0_0_1px_var(--color-line-strong)]" : "text-muted hover:text-text",
              )}
            >
              {item.label}
              {item.badge ? (
                <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-void">
                  {item.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          title="Close panel"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-panel hover:text-text"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {shown === "canvas" ? (
        <div className="min-h-0 flex-1 overflow-hidden border-t border-line">{canvas}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2">
          {shown === "screen" ? <ScreenTab orgSlug={orgSlug} agents={agents} canAdmin={canAdmin} /> : null}
          {shown === "activity" ? (
            <ActivityTab
              orgSlug={orgSlug}
              calls={toolCalls}
              canAdmin={canAdmin}
              viewerId={viewerId}
              agentName={agents.length === 1 ? (agents[0]?.agent.displayName ?? null) : null}
            />
          ) : null}
          {shown === "routines" ? <RoutinesTab orgSlug={orgSlug} routines={routines} /> : null}
        </div>
      )}
    </div>
  )
}
