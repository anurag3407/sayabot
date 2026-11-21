"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import {
  BarChart3,
  Bell,
  BookOpen,
  Brain,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Crown,
  Cpu,
  Folder,
  History,
  LayoutGrid,
  Library,
  Loader2,
  Monitor,
  RotateCcw,
  Search,
  Shield,
  Sparkles,
  UserRound,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react"
import {
  SAYA_SHAPE_INFO,
  SAYA_SHAPES,
  SAYA_TONES,
  SAYA_TONE_NAMES,
  desktopHome,
  parseCapabilities,
  replyStyleFromParams,
  worksOnFromParams,
  type AgentCapabilities,
  type ReplyStyle,
  type SayaShape,
  type SayaTone,
} from "@sayabot/core"
import { EFFORT_LABELS, EFFORT_LEVELS, type EffortLevel } from "@sayabot/llm/models/effort"
import {
  setAgentCapabilitiesAction,
  setAgentLookAction,
  setAgentModelAction,
  setAgentReplyStyleAction,
  setAgentStorageProviderAction,
  setAgentWorksOnAction,
  updateBotBasicsAction,
  updateBotPromptAction,
} from "@/lib/actions/agents"
import {
  RUNTIME_PROMPT_PRESETS,
  QUICK_RUNTIME_RULES,
  getCuratedBotTemplate,
} from "@/lib/curated-bot-templates"
import { issueAgentApiKey } from "@/lib/actions/bots"
import { setAlertModeAction, setAlertSoundAction } from "@/lib/actions/profile"
import { saveOrgSkillAction } from "@/lib/actions/skills"
import { deleteMemoryAction, rememberAction, togglePinMemoryAction } from "@/lib/actions/memory"
import { sendMessage } from "@/lib/actions/messages"
import { setRoomExecutionModeAction } from "@/lib/actions/room-state"
import { AGENT_MOODS, readAgentLook, type AgentLook, type AgentMood } from "@/lib/agent-look"
import { EnableAlerts } from "@/components/room/room-activity"
import { Mascot, resolveMascotLook } from "@/components/ui/mascot"
import { showToast } from "@/components/ui/toast"
import { RoomModelPicker } from "@/components/room/model-picker/room-model-picker"
import { WORKS_ON_OPTIONS } from "@/lib/works-on"
import { WorksOnPicker } from "@/components/agents/works-on-picker"
import { cn } from "@/lib/format"
import type { AgentView, RoomExecutionMode, ToolCallView } from "@/lib/types"
import type { RoomRoutine } from "@/components/room/side-panel"

export interface IdentityPreview {
  agentId: string
  name: string
  look: AgentLook
}

export interface OrgSkillView {
  id: string
  slug: string
  title: string
  description: string
}

export interface ConnectedAppView {
  agentId: string
  name: string
  source: string
}

export interface MemoryNoteView {
  id: string
  agentId: string
  title: string
  pinned: boolean
}

export interface AgentUsageView {
  requests: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  topModel: string | null
}

export type AlertMode = "all" | "mentions" | "off"

type SectionId =
  | "overview"
  | "identity"
  | "soul"
  | "skills"
  | "tools"
  | "memory"
  | "library"
  | "routines"
  | "computer"
  | "access"
  | "model"
  | "permissions"
  | "alerts"
  | "history"
  | "usage"

type Flag = Exclude<keyof AgentCapabilities, "computer">

type SectionGroup = "profile" | "abilities" | "runtime" | "activity"

const GROUPS: { id: SectionGroup; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "abilities", label: "Abilities" },
  { id: "runtime", label: "Runtime" },
  { id: "activity", label: "Activity" },
]

const SECTIONS: {
  id: SectionId
  label: string
  icon: LucideIcon
  keywords: string
  group: SectionGroup
}[] = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutGrid,
    keywords: "setup ideas start checklist",
    group: "profile",
  },
  {
    id: "identity",
    label: "Identity",
    icon: UserRound,
    keywords: "name shape colour color mascot avatar look expression face",
    group: "profile",
  },
  {
    id: "soul",
    label: "Persona",
    icon: Sparkles,
    keywords:
      "persona system prompt standing instructions rules personality reply style conversational soul runtime voice role",
    group: "profile",
  },
  {
    id: "skills",
    label: "Skills",
    icon: BookOpen,
    keywords: "command procedure learned skill import",
    group: "abilities",
  },
  {
    id: "tools",
    label: "Tools",
    icon: Wrench,
    keywords: "search canvas terminal github database apps capabilities",
    group: "abilities",
  },
  {
    id: "memory",
    label: "Memory",
    icon: Brain,
    keywords: "remember notes facts pin upkeep",
    group: "abilities",
  },
  {
    id: "library",
    label: "Library",
    icon: Library,
    keywords: "pages files what it remembers working folder",
    group: "abilities",
  },
  {
    id: "routines",
    label: "Routines",
    icon: CalendarClock,
    keywords: "schedule cron trigger",
    group: "abilities",
  },
  {
    id: "model",
    label: "Model",
    icon: Cpu,
    keywords: "effort thinking provider",
    group: "runtime",
  },
  {
    id: "computer",
    label: "Computer",
    icon: Monitor,
    keywords: "desktop works on screen sandbox",
    group: "runtime",
  },
  {
    id: "access",
    label: "Access",
    icon: Folder,
    keywords: "working folder connected apps api key cloud",
    group: "runtime",
  },
  {
    id: "permissions",
    label: "Permissions",
    icon: Shield,
    keywords: "approval secrets auto turbo review",
    group: "runtime",
  },
  {
    id: "alerts",
    label: "Voice & alerts",
    icon: Bell,
    keywords: "notifications voice mentions sound",
    group: "activity",
  },
  {
    id: "history",
    label: "History",
    icon: History,
    keywords: "activity steps tool calls",
    group: "activity",
  },
  {
    id: "usage",
    label: "Usage",
    icon: BarChart3,
    keywords: "tokens cost spend",
    group: "activity",
  },
]

const TOOLS: { key: Flag; label: string; detail: string }[] = [
  { key: "webSearch", label: "Web search", detail: "Look things up while it works" },
  { key: "document", label: "Documents", detail: "Read PDFs and files you attach" },
  { key: "canvas", label: "Canvas", detail: "Write pages and code in this chat" },
  { key: "tasks", label: "Tasks", detail: "Create and update to-dos" },
  { key: "sandbox", label: "Terminal", detail: "Run commands in its sandbox" },
  { key: "github", label: "GitHub", detail: "Work in repos it has been granted" },
  { key: "postgres", label: "Database", detail: "Query a database it has been granted" },
  { key: "mcp", label: "Apps", detail: "Use MCP apps turned on for this workspace" },
  {
    key: "connectors",
    label: "Connectors",
    detail: "Search Drive, Slack, and the other connectors",
  },
  {
    key: "storage",
    label: "Cloud storage",
    detail: "Upload, download and persist files in Supabase or S3",
  },
  { key: "subagents", label: "Helpers", detail: "Hand a side task to a helper" },
  { key: "cron", label: "Schedules", detail: "Run routines on a timer" },
  { key: "secrets", label: "Secrets", detail: "Use vault secrets it has been granted" },
]

const MODES: { id: RoomExecutionMode; label: string; detail: string }[] = [
  { id: "review_all", label: "Request review", detail: "Every step waits for your OK" },
  { id: "ask_risky", label: "Default", detail: "Asks before sensitive steps" },
  { id: "auto", label: "Auto", detail: "Read-only commands on your Mac run alone" },
  { id: "turbo", label: "Turbo", detail: "Every command and tool runs without asking" },
]

const field =
  "w-full rounded-xl border border-line bg-ink px-3.5 text-[14px] text-text outline-none placeholder:text-faint focus:border-line-strong disabled:opacity-60"

function readWorksOn(params: Record<string, unknown>): { worksOn: string; thisComputer: boolean } {
  const worksOn = typeof params.worksOn === "string" ? params.worksOn : "auto"
  const computer = (params.computer as Record<string, unknown> | undefined) ?? {}
  return { worksOn, thisComputer: computer.thisComputer === true }
}

function readEffort(params: Record<string, unknown>): string | null {
  return typeof params.effort === "string" ? params.effort : null
}

function Toggle({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean
  label: string
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40",
        checked ? "bg-accent" : "bg-line-strong",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
          checked ? "left-[22px]" : "left-0.5",
        )}
      />
    </button>
  )
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-line/60 bg-panel/60 p-3.5", className)}>
      {children}
    </div>
  )
}

export function AgentConfigPanel({
  orgSlug,
  roomId,
  agents,
  agentId,
  onAgentChange,
  canEdit,
  routines,
  toolCalls,
  canvasCount,
  executionMode,
  pendingApprovals,
  skills,
  apps,
  usage,
  alerts,
  sound,
  memoryNotes,
  onClose,
  onOpenWorkspace,
  onIdentityPreview,
}: {
  orgSlug: string
  roomId: string
  agents: AgentView[]
  agentId: string
  onAgentChange: (agentId: string) => void
  canEdit: boolean
  routines: RoomRoutine[]
  toolCalls: ToolCallView[]
  canvasCount: number
  executionMode: RoomExecutionMode
  pendingApprovals: number
  skills: OrgSkillView[]
  apps: ConnectedAppView[]
  usage: Record<string, AgentUsageView>
  alerts: AlertMode
  sound: boolean
  memoryNotes: MemoryNoteView[]
  onClose: () => void
  onOpenWorkspace: (tab: "canvas" | "activity" | "screen") => void
  onIdentityPreview?: (preview: IdentityPreview | null) => void
}) {
  const router = useRouter()
  const agent = agents.find((item) => item.id === agentId) ?? agents[0]
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<SectionId | null>("overview")
  const [name, setName] = useState(agent?.displayName ?? "")
  const [prompt, setPrompt] = useState(agent?.systemPrompt ?? "")
  const [caps, setCaps] = useState<AgentCapabilities>(() => parseCapabilities(agent?.capabilities))
  const [place, setPlace] = useState(() => readWorksOn(agent?.params ?? {}))
  const [effort, setEffort] = useState<string | null>(() => readEffort(agent?.params ?? {}))
  const [replyStyle, setReplyStyle] = useState<ReplyStyle>(() =>
    replyStyleFromParams(agent?.params ?? {}),
  )
  const [alertMode, setAlertMode] = useState<AlertMode>(alerts)
  const [soundOn, setSoundOn] = useState(sound)
  const [storageProvider, setStorageProvider] = useState<string>(
    () =>
      ((agent?.params as Record<string, unknown> | undefined)?.storageProvider as string) ||
      "default",
  )
  const [savingStorageProvider, startStorageProvider] = useTransition()
  const [commandName, setCommandName] = useState("")
  const [commandDetail, setCommandDetail] = useState("")
  const [commandBody, setCommandBody] = useState("")
  const [savedSkills, setSavedSkills] = useState<OrgSkillView[]>([])
  const [issuedKey, setIssuedKey] = useState<string | null>(null)
  const [notes, setNotes] = useState<MemoryNoteView[]>(memoryNotes)
  const [noteText, setNoteText] = useState("")
  const [extraRoutines, setExtraRoutines] = useState<RoomRoutine[]>([])
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleName, setScheduleName] = useState("")
  const [scheduleWhen, setScheduleWhen] = useState("")
  const [schedulePrompt, setSchedulePrompt] = useState("")
  const [pickedLook, setPickedLook] = useState<{ id: string; look: AgentLook } | null>(null)
  const [mode, setMode] = useState<RoomExecutionMode>(executionMode)
  const [error, setError] = useState<string | null>(null)
  const [savingBasics, startBasics] = useTransition()
  const [savingCaps, startCaps] = useTransition()
  const [savingLook, startLook] = useTransition()
  const [savingPlace, startPlace] = useTransition()
  const [savingEffort, startEffort] = useTransition()
  const [savingStyle, startStyle] = useTransition()
  const [savingSkill, startSkill] = useTransition()
  const [savingAlerts, startAlerts] = useTransition()
  const [issuingKey, startKey] = useTransition()
  const [savingNote, startNote] = useTransition()
  const [savingSchedule, startSchedule] = useTransition()
  const [savingMode, startMode] = useTransition()
  const [settingUp, startSetup] = useTransition()
  const [savingPrompt, startPrompt] = useTransition()
  const [quickRuleText, setQuickRuleText] = useState("")
  const refs = useRef<Partial<Record<SectionId, HTMLElement | null>>>({})
  const searchRef = useRef<HTMLInputElement>(null)
  const loadedAgentId = useRef<string | null>(null)

  useEffect(() => {
    if (!agent || loadedAgentId.current === agent.id) return
    loadedAgentId.current = agent.id
    setName(agent.displayName)
    setPrompt(agent.systemPrompt)
    setCaps(parseCapabilities(agent.capabilities))
    setPlace(readWorksOn(agent.params))
    setEffort(readEffort(agent.params))
    setReplyStyle(replyStyleFromParams(agent.params))
    setStorageProvider(
      ((agent.params as Record<string, unknown> | undefined)?.storageProvider as string) ||
        "default",
    )
    setIssuedKey(null)
    setError(null)
  }, [agent])

  useEffect(() => {
    setAlertMode(alerts)
  }, [alerts])

  useEffect(() => {
    setSoundOn(sound)
  }, [sound])

  useEffect(() => {
    setMode(executionMode)
  }, [executionMode])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (query) {
        setQuery("")
        return
      }
      onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, query])

  const previewLook =
    agent && pickedLook?.id === agent.id
      ? pickedLook.look
      : agent
        ? readAgentLook(agent.params)
        : null
  const lookShape = previewLook?.shape ?? null
  const lookTone = previewLook?.tone ?? null
  const lookMood = previewLook?.mood ?? null

  useEffect(() => {
    if (!onIdentityPreview) return
    if (!agent) {
      onIdentityPreview(null)
      return
    }
    onIdentityPreview({
      agentId: agent.id,
      name: name.trim() || agent.displayName,
      look: { shape: lookShape, tone: lookTone, mood: lookMood },
    })
  }, [onIdentityPreview, agent, name, lookShape, lookTone, lookMood])

  useEffect(() => {
    return () => onIdentityPreview?.(null)
  }, [onIdentityPreview])

  const needle = query.trim().toLowerCase()
  const visible = useMemo(
    () =>
      SECTIONS.filter((section) => {
        if (!needle) return true
        return `${section.label} ${section.keywords}`.toLowerCase().includes(needle)
      }),
    [needle],
  )

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center bg-ink p-6 text-[13px] text-faint">
        This chat has no bot to configure.
      </div>
    )
  }

  const bot = agent
  const savedLook = readAgentLook(bot.params)
  const look = pickedLook?.id === bot.id ? pickedLook.look : savedLook
  const face = visibleFace(bot.displayName, look)
  const shape = face.shape
  const tone = face.tone
  const llm = bot.kind === "llm"
  const busy =
    savingBasics ||
    savingCaps ||
    savingLook ||
    savingPlace ||
    savingEffort ||
    savingMode ||
    savingNote
  const agentRoutines = [...extraRoutines, ...routines].filter(
    (routine, index, all) =>
      all.findIndex((item) => item.id === routine.id) === index &&
      (routine.agentId === bot.id || routine.agentId === null),
  )
  const worksLabel = WORKS_ON_OPTIONS.find((option) => option[0] === place.worksOn)?.[1] ?? "Auto"
  const recent = toolCalls.slice(0, 6)

  function go(id: SectionId) {
    setQuery("")
    setOpen(id)
    requestAnimationFrame(() => {
      refs.current[id]?.scrollIntoView({ block: "start", behavior: "smooth" })
    })
  }

  function saveBasics(nextName = name, nextPrompt = prompt) {
    if (!canEdit) return
    const trimmed = nextName.trim()
    if (!trimmed) {
      setName(bot.displayName)
      return
    }
    if (trimmed === bot.displayName && nextPrompt.trim() === bot.systemPrompt.trim()) return
    setError(null)
    startBasics(async () => {
      const result = await updateBotBasicsAction({
        orgSlug,
        agentId: bot.id,
        name: trimmed,
        systemPrompt: nextPrompt,
      })
      if (!result.ok) {
        setError(result.error ?? "Could not save")
        showToast({ tone: "danger", message: result.error ?? "Could not save" })
        return
      }
      showToast({ message: "Saved" })
      router.refresh()
    })
  }

  function savePrompt(nextPrompt = prompt) {
    const trimmed = nextPrompt.trim()
    if (trimmed === (bot.systemPrompt ?? "").trim()) return
    setError(null)
    startPrompt(async () => {
      const result = await updateBotPromptAction({
        orgSlug,
        agentId: bot.id,
        systemPrompt: trimmed,
        roomId,
      })
      if (!result.ok) {
        setError(result.error ?? "Could not update prompt")
        showToast({ tone: "danger", message: result.error ?? "Could not update prompt" })
        return
      }
      bot.systemPrompt = trimmed
      setPrompt(trimmed)
      showToast({
        tone: "success",
        message: `Persona updated for @${bot.handle} · Active on next turn`,
      })
      router.refresh()
    })
  }

  function appendPromptRule(rule: string) {
    const cleanRule = rule.trim()
    if (!cleanRule) return
    const current = prompt.trim()
    const next = current ? `${current}\n- ${cleanRule}` : `- ${cleanRule}`
    setPrompt(next)
  }

  function applyPreset(presetPrompt: string, mode: "append" | "replace") {
    if (mode === "replace") {
      setPrompt(presetPrompt)
    } else {
      const current = prompt.trim()
      setPrompt(current ? `${current}\n\n${presetPrompt}` : presetPrompt)
    }
  }

  function resetToTemplate() {
    const match = getCuratedBotTemplate(bot.handle) || getCuratedBotTemplate(bot.displayName)
    if (match) {
      setPrompt(match.systemPrompt)
      showToast({ message: `Loaded ${match.name} template prompt (click Update to save)` })
    }
  }

  function saveCaps(next: AgentCapabilities) {
    if (!canEdit || !llm) return
    const previous = caps
    setCaps(next)
    startCaps(async () => {
      const result = await setAgentCapabilitiesAction({
        orgSlug,
        agentId: bot.id,
        capabilities: next,
      })
      if (!result.ok) {
        setCaps(previous)
        showToast({ tone: "danger", message: result.error ?? "Could not save" })
        return
      }
      router.refresh()
    })
  }

  function saveLook(
    nextShape: SayaShape,
    nextTone: SayaTone,
    nextMood: AgentMood | null = look.mood,
  ) {
    if (!canEdit) return
    const previous = look
    setPickedLook({ id: bot.id, look: { shape: nextShape, tone: nextTone, mood: nextMood } })
    startLook(async () => {
      const result = await setAgentLookAction({
        orgSlug,
        agentId: bot.id,
        shape: nextShape,
        tone: nextTone,
        ...(nextMood ? { mood: nextMood } : {}),
      })
      if (!result.ok) {
        setPickedLook({ id: bot.id, look: previous })
        showToast({ tone: "danger", message: result.error ?? "Could not save" })
        return
      }
      router.refresh()
    })
  }

  function handleStorageProviderChange(nextProvider: string) {
    if (!bot) return
    const prev = storageProvider
    setStorageProvider(nextProvider)
    startStorageProvider(async () => {
      const res = await setAgentStorageProviderAction({
        orgSlug,
        agentId: bot.id,
        storageProvider: nextProvider,
      })
      if (!res.ok) {
        setStorageProvider(prev)
        showToast({ tone: "danger", message: res.error ?? "Failed to save storage provider" })
      } else {
        showToast({
          tone: "success",
          message:
            nextProvider === "default"
              ? "Using workspace default storage"
              : "Assigned cloud storage provider",
        })
      }
    })
  }

  function savePlace(next: { worksOn: string; thisComputer: boolean }) {
    if (!canEdit) return
    const previous = place
    setPlace(next)
    startPlace(async () => {
      const result = await setAgentWorksOnAction({
        orgSlug,
        agentId: bot.id,
        worksOn: next.worksOn,
        thisComputer: next.thisComputer,
      })
      if (!result.ok) {
        setPlace(previous)
        showToast({ tone: "danger", message: result.error ?? "Could not save" })
        return
      }
      showToast({ message: result.message ?? "Saved" })
      router.refresh()
    })
  }

  function saveEffort(next: string | null) {
    if (!canEdit || !llm) return
    const previous = effort
    setEffort(next)
    startEffort(async () => {
      const result = await setAgentModelAction({
        orgSlug,
        agentId: bot.id,
        providerKeyId: bot.providerKeyId,
        model: bot.model,
        effort: next,
      })
      if (!result.ok) {
        setEffort(previous)
        showToast({ tone: "danger", message: result.error ?? "Could not change the effort" })
      }
    })
  }

  function saveReplyStyle(next: ReplyStyle) {
    if (!canEdit || !llm) return
    const previous = replyStyle
    setReplyStyle(next)
    startStyle(async () => {
      const result = await setAgentReplyStyleAction({
        orgSlug,
        agentId: bot.id,
        replyStyle: next,
      })
      if (!result.ok) {
        setReplyStyle(previous)
        showToast({ tone: "danger", message: result.error ?? "Could not save the reply style" })
        return
      }
      showToast({ message: result.message ?? "Saved" })
    })
  }

  function saveCommand() {
    if (!canEdit) return
    startSkill(async () => {
      const result = await saveOrgSkillAction({
        orgSlug,
        name: commandName,
        description: commandDetail,
        body: commandBody,
      })
      if (!result.ok) {
        showToast({ tone: "danger", message: result.error ?? "Could not save the skill" })
        return
      }
      const slug = typeof result.data?.slug === "string" ? result.data.slug : commandName
      const skillId = typeof result.data?.skillId === "string" ? result.data.skillId : slug
      setSavedSkills((current) => [
        {
          id: skillId,
          slug,
          title: commandName.trim().replace(/^\//, "") || slug,
          description: commandDetail.trim(),
        },
        ...current,
      ])
      setCommandName("")
      setCommandDetail("")
      setCommandBody("")
      showToast({ message: result.message ?? "Saved" })
    })
  }

  function saveAlerts(next: AlertMode) {
    const previous = alertMode
    setAlertMode(next)
    startAlerts(async () => {
      const result = await setAlertModeAction(next)
      if (!result.ok) {
        setAlertMode(previous)
        showToast({ tone: "danger", message: result.error ?? "Could not save alerts" })
        return
      }
      showToast({ message: result.message ?? "Saved" })
    })
  }

  function createSchedule() {
    const name = scheduleName.trim()
    const when = scheduleWhen.trim()
    const promptText = schedulePrompt.trim()
    if (!name || !when || !promptText) return
    startSchedule(async () => {
      const response = await fetch(`/api/workspaces/${orgSlug}/routines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          schedule_expr: when,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          agent_id: bot.id,
          room_id: roomId,
          prompt: promptText,
        }),
      })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
        routine?: {
          id?: string
          name?: string
          human_schedule?: string
          next_run_at?: string | null
        }
      } | null
      if (!response.ok || !payload?.routine?.id) {
        showToast({ tone: "danger", message: payload?.error ?? "Could not create the schedule" })
        return
      }
      setExtraRoutines((current) => [
        {
          id: payload.routine?.id ?? name,
          name: payload.routine?.name ?? name,
          schedule: payload.routine?.human_schedule ?? when,
          enabled: true,
          nextRunAt: payload.routine?.next_run_at ?? null,
          lastStatus: null,
          agentId: bot.id,
          agentName: name.trim() || bot.displayName,
        },
        ...current,
      ])
      setScheduleName("")
      setScheduleWhen("")
      setSchedulePrompt("")
      setScheduleOpen(false)
      showToast({ message: "Schedule saved" })
      router.refresh()
    })
  }

  function saveSound(next: boolean) {
    const previous = soundOn
    setSoundOn(next)
    startAlerts(async () => {
      const result = await setAlertSoundAction(next)
      if (!result.ok) {
        setSoundOn(previous)
        showToast({ tone: "danger", message: result.error ?? "Could not save the sound" })
        return
      }
      showToast({ message: result.message ?? "Saved" })
    })
  }

  function issueKey() {
    if (!canEdit) return
    startKey(async () => {
      const result = await issueAgentApiKey({
        orgSlug,
        agentId: bot.id,
        label: "sidebar",
      })
      if (!result.ok) {
        showToast({ tone: "danger", message: result.error ?? "Could not issue a key" })
        return
      }
      const token = typeof result.data?.token === "string" ? result.data.token : null
      setIssuedKey(token)
      showToast({ message: "Copy the key now. It is not shown again." })
    })
  }

  function addNote() {
    const body = noteText.trim()
    if (!canEdit || !llm || !body) return
    startNote(async () => {
      const result = await rememberAction({
        orgSlug,
        roomId,
        agentId: bot.id,
        scope: "agent",
        body,
      })
      if (!result.ok) {
        showToast({ tone: "danger", message: result.error ?? "Could not save the note" })
        return
      }
      const id =
        typeof result.data?.memoryId === "string" ? result.data.memoryId : crypto.randomUUID()
      setNotes((current) => [
        { id, agentId: bot.id, title: body.replace(/\n/g, " ").slice(0, 80), pinned: false },
        ...current,
      ])
      setNoteText("")
      showToast({ message: "Saved to memory" })
    })
  }

  function pinNote(note: MemoryNoteView) {
    const next = !note.pinned
    setNotes((current) =>
      current.map((item) => (item.id === note.id ? { ...item, pinned: next } : item)),
    )
    startNote(async () => {
      const result = await togglePinMemoryAction(orgSlug, note.id, next)
      if (!result.ok) {
        setNotes((current) =>
          current.map((item) => (item.id === note.id ? { ...item, pinned: note.pinned } : item)),
        )
        showToast({ tone: "danger", message: result.error ?? "Could not update the note" })
      }
    })
  }

  function removeNote(note: MemoryNoteView) {
    setNotes((current) => current.filter((item) => item.id !== note.id))
    startNote(async () => {
      const result = await deleteMemoryAction(orgSlug, note.id)
      if (!result.ok) {
        setNotes((current) => [note, ...current])
        showToast({ tone: "danger", message: result.error ?? "Could not remove the note" })
      }
    })
  }

  function saveMode(next: RoomExecutionMode) {
    const previous = mode
    setMode(next)
    startMode(async () => {
      const result = await setRoomExecutionModeAction({ orgSlug, roomId, mode: next })
      if (!result.ok) {
        setMode(previous)
        showToast({ tone: "danger", message: result.error ?? "Could not save" })
        return
      }
      showToast({ message: result.message ?? "Saved" })
    })
  }

  function setupWithBot() {
    startSetup(async () => {
      const result = await sendMessage({
        orgSlug,
        roomId,
        content: `@${bot.handle} Help me set you up. Ask a few short questions, one at a time, about what you should do, what you should remember, and which tools you need. Then propose a persona I can save: who you are, your voice and your focus.`,
        clientId: crypto.randomUUID(),
      })
      if (!result.ok) {
        showToast({ tone: "danger", message: result.error ?? "Could not start setup" })
        return
      }
      showToast({ message: `${bot.displayName} will ask a few questions` })
      go("soul")
    })
  }

  const ideas: { id: SectionId; label: string; done: boolean }[] = [
    {
      id: "identity",
      label: "Give it a name and a look",
      done: name.trim().length > 0 && Boolean(look.shape || look.tone),
    },
    {
      id: "soul",
      label: "Write its persona",
      done: prompt.trim().length > 40,
    },
    {
      id: "computer",
      label: "Choose where it works",
      done: place.worksOn !== "auto" || Boolean(caps.computer),
    },
    {
      id: "tools",
      label: "Turn on the tools it needs",
      done: llm && TOOLS.some((tool) => caps[tool.key]),
    },
    { id: "routines", label: "Add a schedule or a trigger", done: agentRoutines.length > 0 },
  ]

  function sectionBody(id: SectionId) {
    if (id === "overview") {
      return (
        <div className="space-y-3">
          <Card>
            <p className="text-[15px] font-semibold text-text">Setup ideas</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Optional ways to customize this bot. You can start chatting now.
            </p>
            <ul className="mt-3 divide-y divide-line">
              {ideas.map((idea) => (
                <li key={idea.id}>
                  <button
                    type="button"
                    onClick={() => go(idea.id)}
                    className="flex w-full items-center gap-3 py-2.5 text-left"
                  >
                    <span
                      className={cn(
                        "grid h-5 w-5 shrink-0 place-items-center rounded-full border",
                        idea.done ? "border-accent bg-accent text-void" : "border-line-strong",
                      )}
                    >
                      {idea.done ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 text-[14px] text-text">{idea.label}</span>
                    <ChevronDown className="h-4 w-4 -rotate-90 text-faint" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                disabled={settingUp}
                onClick={setupWithBot}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-3.5 text-[13.5px] font-semibold text-void hover:opacity-90 disabled:opacity-50"
              >
                {settingUp ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Set up with the bot
              </button>
              <p className="text-[12.5px] leading-snug text-muted">
                It asks a few questions and helps you set it up.
              </p>
            </div>
          </Card>
          <Card>
            <p className="text-[15px] font-medium text-text">{name.trim() || bot.displayName}</p>
            <p className="mt-0.5 text-[12.5px] text-faint">@{bot.handle}</p>
          </Card>
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-semibold text-text">Persona</p>
                  <span className="inline-flex items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-[10.5px] font-medium text-ok">
                    <span className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse" />
                    Live
                  </span>
                </div>
                <p className="mt-2 line-clamp-3 rounded-xl border border-line bg-raised/50 p-2.5 font-mono text-[12px] leading-relaxed text-text">
                  {prompt.trim() || "No persona yet. Sayabot's harness still gives it the operating rules."}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2.5">
              <span className="text-[11.5px] text-faint">
                {prompt.trim()
                  ? `${prompt.trim().split(/\s+/).filter(Boolean).length} words · ${prompt.trim().length} chars`
                  : "Empty prompt"}
              </span>
              <button
                type="button"
                onClick={() => go("soul")}
                className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"
              >
                Edit persona →
              </button>
            </div>
          </Card>
          <Card>
            <button
              type="button"
              onClick={() => go(agentRoutines.length ? "routines" : "skills")}
              className="w-full text-left"
            >
              <p className="text-[13px] font-medium text-muted">Does</p>
              <p className="mt-1 text-[14px] text-text">
                {(() => {
                  if (agentRoutines.length) {
                    return agentRoutines
                      .map((routine) => routine.name)
                      .slice(0, 2)
                      .join(", ")
                  }
                  const known = new Set(skills.map((skill) => skill.slug))
                  const learned = [
                    ...savedSkills.filter((skill) => !known.has(skill.slug)),
                    ...skills,
                  ]
                  return learned.length
                    ? learned
                        .map((skill) => skill.title)
                        .slice(0, 2)
                        .join(", ")
                    : "Nothing scheduled or learned yet."
                })()}
              </p>
            </button>
          </Card>
          <Card>
            <button type="button" onClick={() => go("access")} className="w-full text-left">
              <p className="text-[13px] font-medium text-muted">Can reach</p>
              <p className="mt-1 text-[14px] leading-relaxed text-text">
                Works on: {worksLabel}.
                {apps.some((app) => app.agentId === bot.id)
                  ? ` ${apps.filter((app) => app.agentId === bot.id).length} connected apps.`
                  : " Availability is checked when a task starts."}
              </p>
            </button>
          </Card>
        </div>
      )
    }

    if (id === "identity") {
      return (
        <div className="space-y-4">
          <div className="flex justify-center py-2">
            <Mascot
              {...faceProps(bot.displayName, look)}
              mood={look.mood ?? "idle"}
              live
              className="h-24 w-24"
            />
          </div>
          <div>
            <label
              htmlFor={`bot-name-${bot.id}`}
              className="mb-1.5 block text-[12px] font-medium tracking-wide text-faint"
            >
              NAME
            </label>
            <input
              id={`bot-name-${bot.id}`}
              value={name}
              maxLength={60}
              disabled={!canEdit || savingBasics}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => saveBasics()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  saveBasics()
                }
              }}
              className={cn(field, "h-11")}
            />
            <p className="mt-1.5 text-[12.5px] text-faint">
              @{bot.handle} stays, so mentions keep working.
            </p>
            {error ? (
              <p role="alert" className="mt-1.5 text-[13px] text-danger">
                {error}
              </p>
            ) : null}
          </div>
          <div>
            <p className="mb-2 text-[12px] font-medium tracking-wide text-faint">SHAPE</p>
            <div className="grid grid-cols-4 gap-2">
              {SAYA_SHAPES.map((item) => {
                const selected = shape === item
                const previewTone = look.tone ?? tone
                return (
                  <button
                    key={item}
                    type="button"
                    disabled={!canEdit || savingLook}
                    aria-pressed={selected}
                    title={SAYA_SHAPE_INFO[item].name}
                    onClick={() => saveLook(item, look.tone ?? tone)}
                    className={cn(
                      "grid place-items-center rounded-2xl bg-ink py-2",
                      selected ? "ring-2 ring-accent" : "ring-1 ring-line hover:ring-line-strong",
                    )}
                  >
                    <Mascot
                      seed={bot.displayName}
                      shape={item}
                      color={SAYA_TONES[previewTone].base}
                      className="h-10 w-10"
                    />
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[12px] font-medium tracking-wide text-faint">EXPRESSION</p>
            <div className="grid grid-cols-6 gap-1.5">
              {AGENT_MOODS.map((item) => {
                const selected = (look.mood ?? "idle") === item
                return (
                  <button
                    key={item}
                    type="button"
                    disabled={!canEdit || savingLook}
                    aria-label={item}
                    aria-pressed={selected}
                    title={item}
                    onClick={() => saveLook(shape, tone, item)}
                    className={cn(
                      "grid place-items-center rounded-xl bg-ink py-1.5",
                      selected ? "ring-2 ring-accent" : "ring-1 ring-line hover:ring-line-strong",
                    )}
                  >
                    <Mascot
                      seed={bot.displayName}
                      shape={shape}
                      color={SAYA_TONES[tone].base}
                      mood={item}
                      className="h-8 w-8"
                    />
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[12px] font-medium tracking-wide text-faint">COLOR</p>
            <div className="flex flex-wrap gap-2">
              {SAYA_TONE_NAMES.map((item) => {
                const selected = tone === item
                return (
                  <button
                    key={item}
                    type="button"
                    disabled={!canEdit || savingLook}
                    aria-label={item}
                    aria-pressed={selected}
                    onClick={() => saveLook(shape, item)}
                    className={cn(
                      "h-8 w-8 rounded-full",
                      selected
                        ? "ring-2 ring-text ring-offset-2 ring-offset-ink"
                        : "ring-1 ring-white/10",
                    )}
                    style={{ background: SAYA_TONES[item].base }}
                  />
                )
              })}
            </div>
          </div>
        </div>
      )
    }

    if (id === "soul") {
      const isDirty = prompt.trim() !== (bot.systemPrompt ?? "").trim()
      const wordCount = prompt.trim() ? prompt.trim().split(/\s+/).filter(Boolean).length : 0
      const charCount = prompt.length
      const templateMatch =
        getCuratedBotTemplate(bot.handle) || getCuratedBotTemplate(bot.displayName)

      return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[14px] font-semibold text-text">Persona</p>
                {isDirty ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-medium text-warn">
                    <span className="h-1.5 w-1.5 rounded-full bg-warn" />
                    Unsaved changes
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-medium text-ok">
                    <span className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse" />
                    Active at runtime
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
                Who @{bot.handle} is: its voice, role and focus. Sayabot&apos;s harness adds the operating rules (tools, approvals, honesty) on top.
                Updating this takes effect immediately on its next turn.
              </p>
            </div>
          </div>

          {/* Quick Presets Toolbar */}
          <div className="rounded-xl border border-line bg-panel/50 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
                <Zap className="h-3.5 w-3.5 text-accent" />
                Quick Runtime Presets
              </span>
              {templateMatch ? (
                <button
                  type="button"
                  onClick={resetToTemplate}
                  className="flex items-center gap-1 text-[11.5px] text-faint hover:text-text transition-colors"
                  title={`Reset to original ${templateMatch.name} template prompt`}
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset to {templateMatch.name}
                </button>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {RUNTIME_PROMPT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.prompt, "append")}
                  title={`${preset.tagline}\n(Click to append to prompt)`}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-raised px-2.5 py-1 text-[11.5px] font-medium text-muted hover:border-line-strong hover:text-text transition-colors"
                >
                  + {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt Textarea */}
          <div className="space-y-1.5">
            <textarea
              value={prompt}
              disabled={savingPrompt || savingBasics}
              onChange={(event) => setPrompt(event.target.value)}
              rows={10}
              maxLength={20000}
              placeholder="You are Scout, a sharp market researcher. You speak plainly, cite sources, and…"
              className={cn(
                field,
                "resize-y py-3 font-mono text-[13px] leading-relaxed",
                isDirty ? "border-accent/40 focus:border-accent" : "",
              )}
            />
            <div className="flex items-center justify-between px-1 text-[11.5px] text-faint">
              <span>
                {wordCount} {wordCount === 1 ? "word" : "words"} · {charCount.toLocaleString()} /
                20,000 chars
              </span>
              {isDirty ? (
                <span className="text-warn font-medium">Remember to apply changes below</span>
              ) : (
                <span className="text-ok">Bot is using this prompt</span>
              )}
            </div>
          </div>

          {/* Quick Rule Appender */}
          <div className="space-y-2 rounded-xl border border-line/60 bg-panel/30 p-3">
            <p className="text-[12px] font-medium text-muted">
              Append a runtime rule or constraint
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={quickRuleText}
                onChange={(e) => setQuickRuleText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    if (quickRuleText.trim()) {
                      appendPromptRule(quickRuleText)
                      setQuickRuleText("")
                    }
                  }
                }}
                placeholder="e.g. Always respond in tight bullet points"
                className={cn(field, "h-9 text-[12.5px]")}
              />
              <button
                type="button"
                disabled={!quickRuleText.trim()}
                onClick={() => {
                  appendPromptRule(quickRuleText)
                  setQuickRuleText("")
                }}
                className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl bg-raised px-3 text-[12px] font-medium text-text hover:bg-hover disabled:opacity-40"
              >
                + Add Rule
              </button>
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              {QUICK_RUNTIME_RULES.slice(0, 3).map((rule) => (
                <button
                  key={rule}
                  type="button"
                  onClick={() => appendPromptRule(rule)}
                  className="rounded-md border border-line/50 px-2 py-0.5 text-[11px] text-faint hover:border-line-strong hover:text-text transition-colors"
                >
                  + {rule.slice(0, 42)}…
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          ) : null}

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-1">
            {isDirty ? (
              <button
                type="button"
                onClick={() => setPrompt(bot.systemPrompt ?? "")}
                disabled={savingPrompt}
                className="inline-flex items-center gap-1 text-[12.5px] text-faint hover:text-text transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Discard changes
              </button>
            ) : (
              <span className="text-[12px] text-faint">
                Changes apply instantly to the next message
              </span>
            )}

            <button
              type="button"
              disabled={savingPrompt || !isDirty}
              onClick={() => savePrompt()}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-4 text-[13px] font-semibold text-void hover:opacity-90 disabled:opacity-40 transition-all shadow-sm"
            >
              {savingPrompt ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              Update Runtime Prompt
            </button>
          </div>
          <div
            className="rounded-2xl border border-line bg-panel/50 p-3.5"
            role="radiogroup"
            aria-label="Reply style"
          >
            <p className="text-[14px] font-medium text-text">Reply style</p>
            <p className="mt-0.5 text-[12.5px] text-faint">How this bot writes back to you.</p>
            {(
              [
                ["default", "Default", "Full answers, formatted however the bot sees fit."],
                [
                  "conversational",
                  "Conversational",
                  "Short, plain replies, often with one follow-up question.",
                ],
              ] as const
            ).map(([value, label, detail]) => {
              const selected = replyStyle === value
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!canEdit || !llm || savingStyle}
                  onClick={() => saveReplyStyle(value)}
                  className={cn(
                    "mt-2 flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left",
                    selected ? "bg-raised ring-1 ring-accent" : "hover:bg-raised",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                      selected ? "border-accent" : "border-line-strong",
                    )}
                    aria-hidden
                  >
                    {selected ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
                  </span>
                  <span>
                    <span className="block text-[14px] text-text">{label}</span>
                    <span className="block text-[12.5px] leading-relaxed text-faint">{detail}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )
    }

    if (id === "skills") {
      const known = new Set(skills.map((skill) => skill.slug))
      const learned = [...savedSkills.filter((skill) => !known.has(skill.slug)), ...skills]
      return (
        <div className="space-y-3">
          <Card>
            <p className="text-[15px] font-semibold text-text">Learned skills</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Procedures this workspace saved. The bot loads one by name while it works. A saved
              skill is not a chat shortcut.
            </p>
            {learned.length === 0 ? (
              <p className="mt-3 text-[13px] text-faint">No skills saved yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {learned.map((skill) => (
                  <li key={skill.id} className="py-2.5">
                    <p className="text-[14px] text-text">{skill.title}</p>
                    <p className="text-[12.5px] text-faint">{skill.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {canEdit ? (
            <Card>
              <p className="text-[15px] font-semibold text-text">Write a command</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                A short name for something you ask often. Ask the bot to use it by name.
              </p>
              <input
                value={commandName}
                onChange={(event) => setCommandName(event.target.value)}
                maxLength={80}
                placeholder="name"
                className={cn(field, "mt-3 font-mono")}
              />
              <input
                value={commandDetail}
                onChange={(event) => setCommandDetail(event.target.value)}
                maxLength={200}
                placeholder="What it does, in one line"
                className={cn(field, "mt-2")}
              />
              <textarea
                value={commandBody}
                onChange={(event) => setCommandBody(event.target.value)}
                rows={5}
                maxLength={32000}
                placeholder="What the bot should do."
                className={cn(field, "mt-2 resize-y py-3 leading-relaxed")}
              />
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  disabled={
                    savingSkill ||
                    !commandName.trim() ||
                    !commandDetail.trim() ||
                    !commandBody.trim()
                  }
                  onClick={saveCommand}
                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-4 text-[13px] font-semibold text-void disabled:opacity-40"
                >
                  {savingSkill ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Save command
                </button>
              </div>
            </Card>
          ) : null}
        </div>
      )
    }

    if (id === "tools") {
      if (!llm) {
        return (
          <p className="text-[13px] leading-relaxed text-muted">
            This bot runs in its own app, so its tools live there.
          </p>
        )
      }
      return (
        <div className="space-y-4">
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {TOOLS.map((tool) => (
              <li key={tool.key} className="flex items-center gap-3 bg-panel/50 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] text-text">{tool.label}</p>
                  <p className="text-[12.5px] text-faint">{tool.detail}</p>
                </div>
                <Toggle
                  checked={Boolean(caps[tool.key])}
                  label={tool.label}
                  disabled={!canEdit || savingCaps}
                  onChange={(on) => saveCaps({ ...caps, [tool.key]: on })}
                />
              </li>
            ))}
          </ul>

          {caps.storage ? (
            <Card className="space-y-3.5 border-accent/25 bg-accent/[0.03]">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Cloud className="h-4 w-4 text-accent" />
                    <p className="text-[14px] font-semibold text-text">Cloud storage</p>
                  </div>
                  <p className="mt-0.5 text-[12px] text-muted">
                    Choose which cloud storage provider this agent reads and writes files to.
                  </p>
                </div>
                <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10.5px] font-medium text-accent">
                  {storageProvider === "default" ? "Workspace default" : storageProvider}
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase tracking-wider text-faint mb-1.5">
                  Assigned Storage
                </label>
                <select
                  value={storageProvider}
                  disabled={!canEdit || savingStorageProvider}
                  onChange={(e) => handleStorageProviderChange(e.target.value)}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-text focus:border-accent focus:outline-none"
                >
                  <option value="default">Workspace Default (Auto)</option>
                  <optgroup label="Available Storage Connectors">
                    <option value="supabase">Supabase Storage</option>
                    <option value="cloudflare_r2">Cloudflare R2</option>
                    <option value="backblaze_b2">Backblaze B2</option>
                    <option value="huggingface">Hugging Face Hub</option>
                    <option value="s3_storage">Custom S3 / MinIO</option>
                  </optgroup>
                </select>
                <p className="mt-1.5 text-[11px] text-muted">
                  Connect new storage providers or configure buckets in{" "}
                  <Link
                    href={`/${orgSlug}/settings/storage`}
                    className="text-accent hover:underline font-medium"
                  >
                    Settings → Storage
                  </Link>
                  .
                </p>
              </div>
            </Card>
          ) : null}
        </div>
      )
    }

    if (id === "memory") {
      const botNotes = notes
        .filter((note) => note.agentId === bot.id)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned))
      return (
        <div className="space-y-3">
          <Card>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-text">Let this bot use memory</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  Notes it keeps between tasks. Off stops new memory. Notes already saved stay here.
                </p>
              </div>
              <Toggle
                checked={caps.memory}
                label="Memory"
                disabled={!canEdit || !llm || savingCaps}
                onChange={(on) => saveCaps({ ...caps, memory: on })}
              />
            </div>
            {!llm ? (
              <p className="mt-2 text-[12.5px] text-faint">
                Invited bots keep memory in their own app.
              </p>
            ) : null}
          </Card>
          {llm ? (
            <Card>
              <p className="text-[15px] font-medium text-text">Notes</p>
              {botNotes.length === 0 ? (
                <p className="mt-2 text-[13px] text-faint">Nothing saved yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line">
                  {botNotes.map((note) => (
                    <li key={note.id} className="flex items-start gap-2 py-2.5">
                      <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-text">
                        {note.pinned ? <span className="mr-1 text-faint">Pinned</span> : null}
                        {note.title}
                      </p>
                      {canEdit ? (
                        <span className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => pinNote(note)}
                            className="text-[12px] text-muted hover:text-text"
                          >
                            {note.pinned ? "Unpin" : "Pin"}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeNote(note)}
                            className="text-[12px] text-muted hover:text-danger"
                          >
                            Remove
                          </button>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit ? (
                <div className="mt-3 flex gap-2">
                  <input
                    value={noteText}
                    onChange={(event) => setNoteText(event.target.value)}
                    maxLength={2048}
                    placeholder="A fact this bot should keep"
                    className={field}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        addNote()
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={savingNote || !noteText.trim()}
                    onClick={addNote}
                    className="inline-flex h-10 shrink-0 items-center rounded-xl bg-accent px-3 text-[13px] font-semibold text-void disabled:opacity-40"
                  >
                    {savingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                  </button>
                </div>
              ) : null}
            </Card>
          ) : null}
          <Card>
            <p className="text-[15px] font-medium text-text">Upkeep</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Every few hours, expired episode notes are pruned and withdrawn notes are removed.
              That runs for the whole workspace.
            </p>
            {caps.computer ? (
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                A copy is also written on this bot&apos;s computer at /home/bot/.saaya/memory/.
              </p>
            ) : null}
          </Card>
          <Link
            href={`/${orgSlug}/settings/storage`}
            className="inline-flex text-[13px] text-accent hover:underline"
          >
            See how much memory this workspace stores
          </Link>
        </div>
      )
    }

    if (id === "library") {
      const rows: { label: string; value: string; onClick: () => void }[] = [
        {
          label: "What it remembers",
          value: notes.some((note) => note.agentId === bot.id)
            ? `${notes.filter((note) => note.agentId === bot.id).length} notes`
            : caps.memory
              ? "Nothing yet"
              : "Off",
          onClick: () => go("memory"),
        },
        {
          label: "Skills",
          value: (() => {
            const known = new Set(skills.map((skill) => skill.slug))
            const count =
              skills.length + savedSkills.filter((skill) => !known.has(skill.slug)).length
            return count ? String(count) : "None"
          })(),
          onClick: () => go("skills"),
        },
        {
          label: "Tools",
          value: llm ? `${TOOLS.filter((tool) => caps[tool.key]).length} on` : "Own app",
          onClick: () => go("tools"),
        },
        {
          label: "Working place",
          value: worksLabel,
          onClick: () => go("computer"),
        },
        {
          label: "Pages in this chat",
          value: canvasCount ? String(canvasCount) : "None",
          onClick: () => onOpenWorkspace("canvas"),
        },
      ]
      return (
        <div className="space-y-3">
          <p className="text-[13px] text-muted">
            Pages, files, and apps this bot makes show up in the chat.
          </p>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {rows.map((row) => (
              <li key={row.label}>
                <button
                  type="button"
                  onClick={row.onClick}
                  className="flex w-full items-center gap-3 bg-panel/50 px-3.5 py-3 text-left hover:bg-raised"
                >
                  <span className="min-w-0 flex-1 text-[14px] font-medium text-text">
                    {row.label}
                  </span>
                  <span className="text-[13px] text-faint">{row.value}</span>
                  <ChevronDown className="h-4 w-4 -rotate-90 text-faint" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )
    }

    if (id === "routines") {
      return (
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setScheduleOpen((open) => !open)}
              className="inline-flex h-10 flex-1 items-center justify-center rounded-xl bg-accent text-[13.5px] font-semibold text-void hover:opacity-90"
            >
              + Create schedule
            </button>
            <Link
              href={`/${orgSlug}/cron`}
              className="inline-flex h-10 items-center rounded-xl bg-raised px-3 text-[13px] font-medium text-text hover:bg-hover"
            >
              Run logs
            </Link>
          </div>
          {scheduleOpen ? (
            <Card>
              <input
                value={scheduleName}
                onChange={(event) => setScheduleName(event.target.value)}
                maxLength={80}
                placeholder="Name"
                className={field}
              />
              <input
                value={scheduleWhen}
                onChange={(event) => setScheduleWhen(event.target.value)}
                maxLength={80}
                placeholder="When, like daily at 9am"
                className={cn(field, "mt-2")}
              />
              <textarea
                value={schedulePrompt}
                onChange={(event) => setSchedulePrompt(event.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="What this bot should do"
                className={cn(field, "mt-2 resize-y py-3 leading-relaxed")}
              />
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  disabled={
                    savingSchedule ||
                    !scheduleName.trim() ||
                    !scheduleWhen.trim() ||
                    !schedulePrompt.trim()
                  }
                  onClick={createSchedule}
                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-4 text-[13px] font-semibold text-void disabled:opacity-40"
                >
                  {savingSchedule ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Save schedule
                </button>
              </div>
            </Card>
          ) : null}
          {agentRoutines.length ? (
            <ul className="space-y-2">
              {agentRoutines.map((routine) => (
                <li
                  key={routine.id}
                  className="rounded-xl border border-line bg-panel/60 px-3.5 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn("h-2 w-2 rounded-full", routine.enabled ? "bg-ok" : "bg-faint")}
                    />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text">
                      {routine.name}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[12.5px] text-faint">{routine.schedule}</p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-2xl border border-dashed border-line-strong px-4 py-8 text-center">
              <p className="text-[14px] text-muted">No schedules yet.</p>
              <p className="mx-auto mt-1 max-w-[260px] text-[12.5px] leading-relaxed text-faint">
                Or just ask in the chat, like “every weekday at 9, send me the news in my field”.
              </p>
            </div>
          )}
        </div>
      )
    }

    if (id === "computer") {
      const hint = WORKS_ON_OPTIONS.find((option) => option[0] === place.worksOn)?.[2]
      return (
        <div className="space-y-4">
          <div>
            <p className="text-[15px] font-medium text-text">Where {bot.displayName} works</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{hint}</p>
            <div className="mt-3">
              <WorksOnPicker
                orgSlug={orgSlug}
                worksOn={place.worksOn}
                canAdmin={canEdit}
                disabled={!canEdit || savingPlace}
                onChange={(worksOn) => savePlace({ ...place, worksOn })}
              />
            </div>
            {place.worksOn === "this_computer" ? (
              <label className="mt-3 flex items-center gap-2 text-[13px] text-muted">
                <input
                  type="checkbox"
                  checked={place.thisComputer}
                  disabled={!canEdit || savingPlace}
                  onChange={(event) => savePlace({ ...place, thisComputer: event.target.checked })}
                />
                This computer can use the Mac screen
              </label>
            ) : null}
          </div>
          <Card>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-text">Persistent computer</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  A private Linux machine for this bot, with its own files under /home/bot.
                </p>
              </div>
              <Toggle
                checked={Boolean(caps.computer)}
                label="Persistent computer"
                disabled={!canEdit || !llm || savingCaps}
                onChange={(on) =>
                  saveCaps({
                    ...caps,
                    computer: on
                      ? { profile: caps.computer ? caps.computer.profile : "standard" }
                      : false,
                  })
                }
              />
            </div>
            {caps.computer ? (
              <div className="mt-3 flex gap-1.5">
                {(["standard", "browser"] as const).map((profile) => (
                  <button
                    key={profile}
                    type="button"
                    disabled={!canEdit || savingCaps}
                    aria-pressed={caps.computer ? caps.computer.profile === profile : false}
                    onClick={() => saveCaps({ ...caps, computer: { profile } })}
                    className={cn(
                      "rounded-full px-3 py-1 text-[12.5px]",
                      caps.computer && caps.computer.profile === profile
                        ? "bg-raised text-text ring-1 ring-accent"
                        : "text-muted hover:bg-raised",
                    )}
                  >
                    {profile === "standard" ? "Standard" : "Browser"}
                  </button>
                ))}
              </div>
            ) : null}
          </Card>
          <Link
            href={`/${orgSlug}/settings/computers`}
            className="inline-flex text-[13px] text-accent hover:underline"
          >
            Open computers
          </Link>
        </div>
      )
    }

    if (id === "model") {
      if (!llm) {
        return <p className="text-[13px] text-muted">This bot uses its own app&apos;s model.</p>
      }
      return (
        <div className="space-y-4">
          <Card>
            <p className="text-[13px] text-muted">Default model</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              This bot starts on {bot.model || "the server default"}. A pick for only this chat
              stays here when the bot's model changes later.
            </p>
            <div className="mt-3">
              <RoomModelPicker
                orgSlug={orgSlug}
                roomId={roomId}
                placement="inline"
                listen={false}
              />
            </div>
          </Card>
          <div>
            <p className="text-[15px] font-medium text-text">Effort</p>
            <p className="mt-1 text-[13px] text-muted">
              How hard this bot thinks. Default lets the provider choose.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={!canEdit || savingEffort}
                aria-pressed={effort === null}
                onClick={() => saveEffort(null)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[12.5px]",
                  effort === null
                    ? "bg-ink text-text ring-1 ring-accent"
                    : "bg-panel text-muted hover:text-text",
                )}
              >
                Default
              </button>
              {EFFORT_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  disabled={!canEdit || savingEffort}
                  aria-pressed={effort === level}
                  onClick={() => saveEffort(level)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[12.5px]",
                    effort === level
                      ? "bg-ink text-text ring-1 ring-accent"
                      : "bg-panel text-muted hover:text-text",
                  )}
                >
                  {EFFORT_LABELS[level as EffortLevel]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )
    }

    if (id === "permissions") {
      return (
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-muted">
            How this chat asks before a bot acts. Auto and Turbo only loosen the Mac of the person
            who picks them.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={savingMode}
                aria-pressed={mode === item.id}
                onClick={() => saveMode(item.id)}
                className={cn(
                  "rounded-xl px-3 py-2 text-left",
                  mode === item.id ? "bg-raised ring-1 ring-accent" : "bg-panel hover:bg-raised",
                )}
              >
                <span className="block text-[13px] font-medium text-text">{item.label}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-faint">
                  {item.detail}
                </span>
              </button>
            ))}
          </div>
          <Link
            href={`/${orgSlug}/settings/vault`}
            className="inline-flex text-[13px] text-accent hover:underline"
          >
            Secrets in the vault
          </Link>
        </div>
      )
    }

    if (id === "history") {
      if (!recent.length) {
        return <p className="py-6 text-center text-[13px] text-faint">No steps yet in this chat.</p>
      }
      return (
        <ul className="space-y-1.5">
          {recent.map((call) => (
            <li key={call.id} className="flex items-center gap-2 rounded-xl bg-panel/60 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-text">
                {call.toolName}
              </span>
              <span className="shrink-0 text-[12px] text-faint">
                {call.status.replaceAll("_", " ")}
              </span>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => onOpenWorkspace("activity")}
              className="px-1 py-1 text-[13px] text-accent hover:underline"
            >
              Open activity
            </button>
          </li>
        </ul>
      )
    }

    if (id === "access") {
      const surface = worksOnFromParams({ worksOn: place.worksOn })
      const home = desktopHome(surface)
      const botApps = apps.filter((app) => app.agentId === bot.id)
      return (
        <div className="space-y-3">
          <Card>
            <p className="text-[15px] font-semibold text-text">Working folder</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              {surface === "off"
                ? "This bot is not using a computer, so it has no folder."
                : surface === "auto"
                  ? "Chosen when a task starts. Boat and E2B use /home/user. A local desktop or VPS uses /home/bot."
                  : `Shell and files run in ${home}.`}
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => go("computer")}
                className="text-[13px] font-medium text-accent hover:underline"
              >
                Change where it works
              </button>
              <button
                type="button"
                onClick={() => onOpenWorkspace("screen")}
                className="text-[13px] font-medium text-accent hover:underline"
              >
                Open the screen
              </button>
            </div>
          </Card>
          <Card>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-text">Connected apps</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  Let this bot use Drive, Slack, and the other apps connected to the workspace.
                </p>
              </div>
              {llm ? (
                <Toggle
                  checked={caps.connectors}
                  label="Connected apps"
                  disabled={!canEdit || savingCaps}
                  onChange={(on) => saveCaps({ ...caps, connectors: on })}
                />
              ) : null}
            </div>
            {!llm ? (
              <p className="mt-2 text-[12.5px] text-faint">
                This bot uses the apps in its own app.
              </p>
            ) : null}
            {botApps.length === 0 ? (
              <p className="mt-3 text-[13px] text-faint">No apps connected yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {botApps.map((app) => (
                  <li
                    key={`${app.agentId}-${app.source}-${app.name}`}
                    className="py-2 text-[14px] text-text"
                  >
                    {app.name}
                    <span className="ml-2 text-[12px] text-faint">
                      {app.source.replaceAll("_", " ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={`/${orgSlug}/settings/connectors`}
              className="mt-3 inline-flex text-[13px] font-medium text-accent hover:underline"
            >
              Connect an app
            </Link>
          </Card>
          <Card>
            <p className="text-[15px] font-semibold text-text">Bot API</p>
            {bot.kind === "external" ? (
              <>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  Apps call this bot with a key. The key is shown once.
                </p>
                {bot.webhookUrl ? (
                  <p className="mt-2 break-all text-[12.5px] text-muted">
                    Sayabot calls <span className="font-mono text-text">{bot.webhookUrl}</span>
                  </p>
                ) : null}
                {issuedKey ? (
                  <div className="mt-3 flex gap-2">
                    <input
                      readOnly
                      value={issuedKey}
                      className={cn(field, "font-mono text-[12px]")}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(issuedKey).then(
                          () => showToast({ message: "Key copied" }),
                          () =>
                            showToast({
                              tone: "danger",
                              message: "Could not copy. Select the key instead.",
                            }),
                        )
                      }}
                      className="inline-flex h-10 shrink-0 items-center rounded-xl bg-raised px-3 text-[13px] font-medium text-text"
                    >
                      Copy
                    </button>
                  </div>
                ) : null}
                {canEdit ? (
                  <button
                    type="button"
                    disabled={issuingKey}
                    onClick={issueKey}
                    className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl bg-raised px-3 text-[13px] font-medium text-text"
                  >
                    {issuingKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    New key
                  </button>
                ) : null}
              </>
            ) : (
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                This bot answers in the chat. API keys are for bots that run in their own app.
              </p>
            )}
          </Card>
        </div>
      )
    }

    if (id === "alerts") {
      return (
        <Card>
          <p className="text-[15px] font-semibold text-text">Voice & alerts</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            When you get notified. This follows you across the workspace. This bot does not have its
            own voice.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(
              [
                ["all", "All"],
                ["mentions", "Mentions"],
                ["off", "Off"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                disabled={savingAlerts}
                aria-pressed={alertMode === value}
                onClick={() => saveAlerts(value)}
                className={cn(
                  "h-8 rounded-full px-3 text-[13px]",
                  alertMode === value
                    ? "bg-accent text-void"
                    : "bg-raised text-muted hover:text-text",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3 border-t border-line pt-3">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] text-text">Play a sound</p>
              <p className="text-[12.5px] text-faint">When an alert arrives in this workspace.</p>
            </div>
            <Toggle
              checked={soundOn}
              label="Play a sound"
              disabled={savingAlerts || alertMode === "off"}
              onChange={saveSound}
            />
          </div>
          <div className="mt-3">
            <EnableAlerts enabled={alertMode !== "off"} />
          </div>
        </Card>
      )
    }

    const spent = usage[bot.id]
    if (!spent || spent.requests === 0) {
      return (
        <Card>
          <p className="text-[14px] text-muted">No usage recorded yet for this bot.</p>
          <Link
            href={`/${orgSlug}/analytics`}
            className="mt-3 inline-flex text-[13px] font-medium text-accent hover:underline"
          >
            Open usage
          </Link>
        </Card>
      )
    }
    return (
      <Card>
        <p className="text-[13px] text-faint">Last 30 days</p>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <dt className="text-[12px] text-faint">Requests</dt>
            <dd className="text-[16px] text-text">{spent.requests.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-faint">Cost</dt>
            <dd className="text-[16px] text-text">${spent.costUsd.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-faint">Input tokens</dt>
            <dd className="text-[16px] text-text">{spent.inputTokens.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-faint">Output tokens</dt>
            <dd className="text-[16px] text-text">{spent.outputTokens.toLocaleString()}</dd>
          </div>
        </dl>
        {spent.topModel ? (
          <p className="mt-3 text-[12.5px] text-faint">Most used model: {spent.topModel}</p>
        ) : null}
        <Link
          href={`/${orgSlug}/analytics`}
          className="mt-3 inline-flex text-[13px] font-medium text-accent hover:underline"
        >
          Open usage
        </Link>
      </Card>
    )
  }

  const isLead = parseCapabilities(bot.capabilities).orchestrator === true
  const enabledToolCount = TOOLS.filter((tool) => caps[tool.key]).length
  const spentForSummary = usage[bot.id]
  const modeLabel = MODES.find((item) => item.id === mode)?.label ?? "Default"
  const summary: Partial<Record<SectionId, string>> = {
    identity: name.trim() || bot.displayName,
    soul: prompt.trim() ? `${prompt.trim().split(/\s+/).length} words` : "Not set",
    skills: skills.length ? `${skills.length}` : undefined,
    tools: `${enabledToolCount} on`,
    memory: notes.length ? `${notes.length} notes` : undefined,
    routines: agentRoutines.length ? `${agentRoutines.length} active` : "None",
    model: bot.model ? (bot.model.split("/").pop() ?? bot.model) : "Pick one",
    computer: caps.computer ? caps.computer.profile : place.worksOn === "off" ? "Off" : "Auto",
    permissions: modeLabel,
    alerts: alertMode === "all" ? "All" : alertMode === "off" ? "Off" : "Mentions",
    usage: spentForSummary?.requests ? `$${spentForSummary.costUsd.toFixed(2)}` : undefined,
  }

  function toggleSection(sectionId: SectionId, expanded: boolean) {
    const opening = Boolean(needle) || !expanded
    if (needle) {
      setQuery("")
      setOpen(sectionId)
    } else {
      setOpen(expanded ? null : sectionId)
    }
    if (opening) {
      requestAnimationFrame(() => {
        refs.current[sectionId]?.scrollIntoView({ block: "nearest", behavior: "smooth" })
      })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink" data-testid="bot-config-panel">
      {/* Who you are editing: a real header, not a row in the list. */}
      <div className="relative shrink-0 overflow-hidden border-b border-line/60">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_10%_0%,rgba(157,140,255,0.16),transparent_60%)]"
        />
        <div className="relative flex items-start gap-3 px-4 pb-3 pt-3.5">
          <span className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-panel ring-1 ring-inset ring-line">
            <Mascot {...faceProps(bot.displayName, look)} crown={isLead} live className="h-11 w-11" />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className="min-w-0 truncate text-[17px] font-semibold tracking-[-0.015em] text-text">
                {name.trim() || bot.displayName}
              </h2>
              {isLead ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.06em] text-warn">
                  <Crown className="h-2.5 w-2.5" aria-hidden="true" />
                  Orchestrator
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[12.5px] text-faint">@{bot.handle}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => toggleSection("model", open === "model")}
                className="inline-flex max-w-[180px] items-center gap-1 truncate rounded-full bg-panel px-2 py-0.5 text-[11.5px] text-muted ring-1 ring-inset ring-line transition-colors hover:text-text"
              >
                <Cpu className="h-3 w-3 shrink-0" />
                <span className="truncate">{summary.model}</span>
              </button>
              <button
                type="button"
                onClick={() => toggleSection("tools", open === "tools")}
                className="inline-flex items-center gap-1 rounded-full bg-panel px-2 py-0.5 text-[11.5px] text-muted ring-1 ring-inset ring-line transition-colors hover:text-text"
              >
                <Wrench className="h-3 w-3" />
                {enabledToolCount} tools
              </button>
              <button
                type="button"
                onClick={() => toggleSection("permissions", open === "permissions")}
                className="inline-flex items-center gap-1 rounded-full bg-panel px-2 py-0.5 text-[11.5px] text-muted ring-1 ring-inset ring-line transition-colors hover:text-text"
              >
                <Shield className="h-3 w-3" />
                {modeLabel}
              </button>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => onOpenWorkspace("canvas")}
              className="relative rounded-lg px-2 py-1 text-[12.5px] text-muted hover:bg-panel hover:text-text"
            >
              Canvas
              {pendingApprovals ? (
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />
              ) : null}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close bot settings"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-panel hover:text-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {agents.length > 1 ? (
          <div
            className="relative flex gap-1 overflow-x-auto px-4 pb-2.5 [scrollbar-width:none]"
            role="tablist"
            aria-label="Bot"
          >
            {agents.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={item.id === bot.id}
                onClick={() => onAgentChange(item.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-[12.5px] transition-colors",
                  item.id === bot.id
                    ? "bg-raised text-text ring-1 ring-inset ring-line-strong"
                    : "text-muted hover:bg-panel",
                )}
              >
                <Mascot
                  {...(item.id === bot.id ? faceProps(bot.displayName, look) : mascotFace(item))}
                  crown={parseCapabilities(item.capabilities).orchestrator === true}
                  className="h-5 w-5"
                />
                {item.id === bot.id ? name.trim() || item.displayName : item.displayName}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="shrink-0 px-4 pb-1 pt-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search settings"
            aria-label="Search bot settings"
            className="h-9 w-full rounded-xl border border-line bg-panel pl-9 pr-3 text-[13.5px] text-text outline-none placeholder:text-faint focus:border-accent/40"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Mascot seed="Hoot" mood="thinking" className="h-10 w-10" />
            <p className="text-[13px] text-faint">Nothing in these settings matches.</p>
          </div>
        ) : (
          GROUPS.map((group) => {
            const items = visible.filter((section) => section.group === group.id)
            if (!items.length) return null
            return (
              <div key={group.id} className="mt-4 first:mt-2">
                <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                  {group.label}
                </p>
                <div className="overflow-hidden rounded-2xl border border-line/80 bg-panel/40">
                  {items.map((section, index) => {
                    const Icon = section.icon
                    const expanded = needle ? true : open === section.id
                    const hint = summary[section.id]
                    return (
                      <section
                        key={section.id}
                        ref={(node) => {
                          refs.current[section.id] = node
                        }}
                        className={cn(index > 0 && "border-t border-line/60")}
                      >
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => toggleSection(section.id, expanded)}
                          className={cn(
                            "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                            expanded ? "bg-raised/50" : "hover:bg-raised/30",
                          )}
                        >
                          <span
                            className={cn(
                              "grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors",
                              expanded ? "bg-accent/15 text-accent" : "bg-raised text-muted",
                            )}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1 text-[13.5px] font-medium text-text">
                            {section.label}
                          </span>
                          {hint && !expanded ? (
                            <span className="max-w-[45%] truncate text-[12px] text-faint">
                              {hint}
                            </span>
                          ) : null}
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 shrink-0 text-faint transition-transform duration-200",
                              expanded && "rotate-90",
                            )}
                          />
                        </button>
                        {expanded ? (
                          <div className="fade-in border-t border-line/60 bg-ink/40 px-3 pb-4 pt-3">
                            {sectionBody(section.id)}
                          </div>
                        ) : null}
                      </section>
                    )
                  })}
                </div>
              </div>
            )
          })
        )}
        <div className="mt-5 flex items-center justify-between gap-3 px-1">
          <Link
            href={`/${orgSlug}/agents/${bot.id}`}
            className="text-[12.5px] font-medium text-accent hover:underline"
          >
            Secrets, connectors & full bot page →
          </Link>
          {busy ? (
            <span className="flex items-center gap-1.5 text-[12px] text-faint">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function visibleFace(seed: string, look: AgentLook): { shape: SayaShape; tone: SayaTone } {
  const fallback = resolveMascotLook(seed)
  const shape = look.shape ?? fallback.shape
  const tone =
    look.tone ?? (look.shape && !fallback.cast ? SAYA_SHAPE_INFO[shape].tone : fallback.tone)
  return { shape, tone }
}

function faceProps(seed: string, look: AgentLook) {
  return {
    seed,
    ...(look.shape ? { shape: look.shape } : {}),
    ...(look.tone ? { color: SAYA_TONES[look.tone].base } : {}),
    ...(look.mood ? { mood: look.mood } : {}),
  }
}

function mascotFace(agent: AgentView) {
  return faceProps(agent.displayName, readAgentLook(agent.params))
}
