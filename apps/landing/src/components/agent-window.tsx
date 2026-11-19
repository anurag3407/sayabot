"use client"

import { useState, useRef, type CSSProperties } from "react"
import type { SayaMood, SayaShape } from "@sayabot/core/mascot"
import { useInView, useSequence } from "@/lib/motion"
import { CheckIcon, LockIcon, PhoneIcon, TerminalIcon } from "./icons"
import { Saya } from "./saya"

/** ms per beat: ask, start computer, run tests, patch, pass, approval, allowed. */
const BEATS = [1400, 1600, 1800, 1600, 1500, 3600, 3800] as const

interface SidebarAgent {
  id: string
  shape: SayaShape
  name: string
  role: string
  mood: SayaMood
  date: string
  note: string
}

const SIDEBAR_AGENTS: SidebarAgent[] = [
  {
    id: "block",
    shape: "block",
    name: "Block",
    role: "Engineer",
    mood: "working",
    date: "now",
    note: "Fixing checkout test",
  },
  {
    id: "ledger",
    shape: "ledger",
    name: "Ledger",
    role: "Bookkeeper",
    mood: "waiting",
    date: "18 Nov",
    note: "Send 3 reminders?",
  },
  {
    id: "bubble",
    shape: "bubble",
    name: "Bubble",
    role: "Inbox",
    mood: "done",
    date: "18 Nov",
    note: "Inbox at zero",
  },
  {
    id: "hoot",
    shape: "hoot",
    name: "Hoot",
    role: "Research",
    mood: "thinking",
    date: "17 Nov",
    note: "Reading 12 sources",
  },
  {
    id: "sprout",
    shape: "sprout",
    name: "Sprout",
    role: "Growth & SEO",
    mood: "sleeping",
    date: "16 Nov",
    note: "Mon 6:00",
  },
]

const TERMINAL_OUTPUT: { at: number; text: string; kind?: "cmd" | "bad" | "good" | "dim" }[] = [
  { at: 1, text: "~/shop $ git pull", kind: "cmd" },
  { at: 1, text: "Already up to date.", kind: "dim" },
  { at: 2, text: "~/shop $ pnpm test checkout", kind: "cmd" },
  { at: 2, text: "✗ cart total rounds 19.999 to 19.99", kind: "bad" },
  { at: 3, text: "~/shop $ apply patch src/cart.ts", kind: "cmd" },
  { at: 3, text: "+ return roundHalfUp(total, 2)", kind: "good" },
  { at: 4, text: "~/shop $ pnpm test", kind: "cmd" },
  { at: 4, text: "✓ 48 passed (2.1s)", kind: "good" },
  { at: 6, text: "~/shop $ gh pr create --fill", kind: "cmd" },
  { at: 6, text: "https://github.com/acme/shop/pull/212", kind: "dim" },
]

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

function InboxIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function ZapIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function CheckSquareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  )
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  )
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function StoreIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
      <path d="M2 7h20" />
    </svg>
  )
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  )
}

function PanelSplitIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </svg>
  )
}

function EllipsisIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
      <circle cx="5" cy="12" r="1.2" />
    </svg>
  )
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </svg>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function ToolsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  )
}

function BrainIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04" />
    </svg>
  )
}

function CpuIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M15 2v2M9 2v2M15 20v2M9 20v2M2 15h2M2 9h2M20 15h2M20 9h2" />
    </svg>
  )
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  )
}

function Step({
  show,
  done,
  children,
}: {
  show: boolean
  done: boolean
  children: React.ReactNode
}) {
  if (!show) return null
  return (
    <div className={`aw-step ${done ? "is-done" : ""}`}>
      <span className="aw-step-icon">{done ? <CheckIcon /> : <span className="aw-spinner" />}</span>
      <div className="aw-step-content">{children}</div>
    </div>
  )
}

export function AgentWindow() {
  const box = useRef<HTMLDivElement>(null)
  const visible = useInView(box)
  const step = useSequence(BEATS, visible)
  const [selectedAgentId, setSelectedAgentId] = useState("block")
  const [rightTab, setRightTab] = useState<"computer" | "inspector">("computer")
  const [accordions, setAccordions] = useState<Record<string, boolean>>({
    tools: false,
    computer: true,
    memory: false,
    model: false,
    permissions: false,
    usage: false,
  })

  const toggleAccordion = (key: string) => {
    setAccordions((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const blockMood: SayaMood =
    step === 0 ? "thinking" : step === 5 ? "waiting" : step === 6 ? "done" : "working"

  return (
    <div className="aw-stage" ref={box}>
      <div className="aw card">
        <div className="beam" />

        <div className="aw-body">
          {/* LEFT COLUMN: REAL SAYABOT SIDEBAR */}
          <aside className="aw-side" aria-label="Sidebar">
            {/* Top row: Mac traffic lights & Workspace Switcher */}
            <div className="aw-side-top">
              <div className="aw-traffic" aria-hidden>
                <span className="aw-dot aw-dot-red" />
                <span className="aw-dot aw-dot-yellow" />
                <span className="aw-dot aw-dot-green" />
              </div>
              <div className="aw-ws-pill">
                <Saya shape="ghost" mood="idle" className="aw-ws-avatar" />
                <span className="aw-ws-name">My w...</span>
                <ChevronIcon className="aw-ws-chevron" />
                <span className="aw-ws-user-dot" title="Online" />
              </div>
              <button type="button" className="aw-side-action-btn" aria-label="Add new bot">
                <PlusIcon className="aw-icon-sm" />
              </button>
            </div>

            {/* Search Input */}
            <div className="aw-side-search-wrap">
              <div className="aw-side-search">
                <SearchIcon className="aw-icon-faint" />
                <span className="aw-side-search-ph">Search</span>
                <kbd className="aw-side-kbd">⌘K</kbd>
              </div>
            </div>

            {/* Inbox */}
            <div className="aw-side-nav-item">
              <span className="aw-inbox-badge-icon">
                <InboxIcon className="aw-icon-sm" />
              </span>
              <span className="aw-nav-label">Inbox</span>
              <span className="aw-count-pill">2</span>
            </div>

            {/* Scrollable Middle: Bots, Group Chats, Tools */}
            <div className="aw-side-scroll">
              {/* Bots Section */}
              <div className="aw-section">
                <div className="aw-section-header">
                  <span className="aw-section-title">
                    Bots <ChevronIcon className="aw-section-arrow" />
                  </span>
                  <span className="aw-section-plus">
                    <PlusIcon />
                  </span>
                </div>
                <div className="aw-bot-list">
                  {SIDEBAR_AGENTS.map((agent) => {
                    const isSelected = selectedAgentId === agent.id
                    const mood = agent.id === "block" ? blockMood : agent.mood
                    const note =
                      agent.id === "block"
                        ? step === 5
                          ? "Waiting on your yes"
                          : step === 6
                            ? "PR #212 opened"
                            : "Fixing checkout test"
                        : agent.note

                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => setSelectedAgentId(agent.id)}
                        className={`aw-bot-row ${isSelected ? "is-selected" : ""}`}
                      >
                        <Saya
                          shape={agent.shape}
                          mood={mood}
                          live={isSelected}
                          className="aw-bot-avatar"
                        />
                        <div className="aw-bot-meta">
                          <div className="aw-bot-top">
                            <span className="aw-bot-name">{agent.name}</span>
                            <span className="aw-bot-date">{agent.date}</span>
                          </div>
                          <span
                            className={`aw-bot-sub ${
                              agent.id === "block" && step === 5
                                ? "is-amber"
                                : agent.id === "block" && step === 6
                                  ? "is-green"
                                  : mood === "waiting"
                                    ? "is-amber"
                                    : ""
                            }`}
                          >
                            {note}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Group Chats Section */}
              <div className="aw-section">
                <div className="aw-section-header">
                  <span className="aw-section-title">
                    Group chats <ChevronIcon className="aw-section-arrow" />
                  </span>
                  <span className="aw-section-plus">
                    <PlusIcon />
                  </span>
                </div>
                <div className="aw-bot-row">
                  <div className="aw-group-avatar">G</div>
                  <div className="aw-bot-meta">
                    <div className="aw-bot-top">
                      <span className="aw-bot-name">General</span>
                      <span className="aw-bot-date">16 Nov</span>
                    </div>
                    <span className="aw-bot-sub">Welcome to General.</span>
                  </div>
                </div>
              </div>

              {/* Tools Section */}
              <div className="aw-section">
                <div className="aw-section-header">
                  <span className="aw-section-title">
                    Tools <ChevronIcon className="aw-section-arrow" />
                  </span>
                </div>
                <div className="aw-tools-menu">
                  <div className="aw-tool-item">
                    <ZapIcon className="aw-tool-icon" />
                    <span>Routines</span>
                  </div>
                  <div className="aw-tool-item">
                    <CheckSquareIcon className="aw-tool-icon" />
                    <span>To-dos</span>
                  </div>
                  <div className="aw-tool-item">
                    <FolderIcon className="aw-tool-icon" />
                    <span>Files</span>
                  </div>
                  <div className="aw-tool-item">
                    <UsersIcon className="aw-tool-icon" />
                    <span>Team</span>
                  </div>
                  <div className="aw-tool-item">
                    <StoreIcon className="aw-tool-icon" />
                    <span>Bot store</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom: Save Account Banner */}
            <div className="aw-save-account">
              <span className="aw-save-dot" />
              <div className="aw-save-text">
                <strong>Save your account</strong>
                <small>Keep your bots on your phone and the web</small>
              </div>
            </div>

            {/* Footer: User & Settings */}
            <div className="aw-side-footer">
              <div className="aw-user-badge">
                <div className="aw-user-avatar">ME</div>
                <span className="aw-user-name">member</span>
              </div>
              <button type="button" className="aw-footer-btn" aria-label="Settings">
                <SettingsIcon className="aw-icon-faint" />
              </button>
            </div>
          </aside>

          {/* CENTER COLUMN: ACTIVE CHAT & COMMAND STREAM */}
          <div className="aw-chat">
            {/* Header: Back arrow, Centered Pill with Avatar, Pencil & @handle, Right icons */}
            <div className="aw-chat-head">
              <button type="button" className="aw-head-back" aria-label="Back">
                <ArrowLeftIcon className="aw-icon-sm" />
              </button>

              <div className="aw-center-pill">
                <Saya shape="block" mood={blockMood} live className="aw-center-avatar" />
                <span className="aw-center-name">Block</span>
                <span className="aw-center-edit">
                  <PencilIcon className="aw-icon-xs" />
                </span>
                <span className="aw-center-handle">@block</span>
              </div>

              <div className="aw-head-right">
                <button
                  type="button"
                  onClick={() => setRightTab(rightTab === "computer" ? "inspector" : "computer")}
                  className="aw-panel-btn"
                  title="Toggle Inspector / Computer"
                  aria-label="Toggle Panel"
                >
                  <PanelSplitIcon className="aw-icon-sm" />
                </button>
                <button type="button" className="aw-options-btn" aria-label="More options">
                  <EllipsisIcon className="aw-icon-sm" />
                </button>
              </div>
            </div>

            {/* Chat Thread */}
            <div className="aw-thread">
              <div className="aw-thread-meta">
                <span>Sayabot 20:31 · Automated run</span>
              </div>

              {/* User Bubble */}
              <div className="aw-msg aw-you">Fix the flaky checkout test and open a PR.</div>

              {/* Bot Response & Live Actions */}
              {step >= 1 ? (
                <div className="aw-bot-msg-group">
                  <div className="aw-bot-msg-header">
                    <Saya shape="block" mood={blockMood} className="aw-bot-msg-avatar" />
                    <strong>Block</strong>
                    <span className="aw-bot-badge">Claude 3.7</span>
                  </div>
                  <div className="aw-msg aw-bot">On it. Starting my computer.</div>
                </div>
              ) : null}

              {/* Real-time Execution Steps */}
              <div className="aw-steps-stack">
                <Step show={step >= 1} done={step > 1}>
                  Computer started · <code>/home/bot/shop</code>
                </Step>
                <Step show={step >= 2} done={step > 2}>
                  Ran checkout tests · 1 failing
                </Step>
                <Step show={step >= 3} done={step > 3}>
                  Patched <code>src/cart.ts</code>
                </Step>
                <Step show={step >= 4} done={step > 4}>
                  All 48 tests pass (2.1s)
                </Step>
              </div>

              {/* Human Approval Gate Card (Interactive) */}
              {step === 5 ? (
                <div className="aw-approve">
                  <div className="aw-approve-head">
                    <LockIcon />
                    <span>Needs your approval</span>
                    <span className="aw-clock" style={{ "--t": `${BEATS[5]}ms` } as CSSProperties}>
                      5 min, then auto-deny
                    </span>
                  </div>
                  <p>
                    Open pull request <strong>#212</strong> on <strong>acme/shop</strong>?
                  </p>
                  <div className="aw-approve-actions">
                    <button type="button" className="aw-btn">
                      Deny
                    </button>
                    <button type="button" className="aw-btn aw-btn-yes">
                      Allow
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Completion Toast & Follow-up */}
              {step === 6 ? (
                <div className="aw-done-block">
                  <div className="aw-toast">
                    <PhoneIcon /> Allowed from your phone
                  </div>
                  <div className="aw-bot-msg-group">
                    <div className="aw-bot-msg-header">
                      <Saya shape="block" mood="done" className="aw-bot-msg-avatar" />
                      <strong>Block</strong>
                      <span className="aw-bot-badge is-green">Done</span>
                    </div>
                    <div className="aw-msg aw-bot">
                      Opened <span className="aw-link">PR #212</span>. Rounding fixed, tests green.
                      Watching CI and will notify you if review requests changes.
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Dashboard Composer */}
            <div className="aw-composer">
              <div className="aw-composer-input">Message Block, / for commands</div>
              <div className="aw-composer-bar">
                <div className="aw-composer-left">
                  <button type="button" className="aw-c-btn aw-c-plus" aria-label="Add attachment">
                    <PlusIcon className="aw-icon-xs" />
                  </button>
                  <div className="aw-c-pill">
                    <TerminalIcon className="aw-icon-xs" />
                    <span>cloud-box · Linux • ⌃</span>
                  </div>
                  <div className="aw-c-pill">
                    <ZapIcon className="aw-icon-xs" />
                    <span>Turbo ⌄</span>
                  </div>
                </div>
                <button type="button" className="aw-c-send" aria-label="Send message">
                  <SendIcon className="aw-icon-xs" />
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: REAL BOT INSPECTOR & COMPUTER PANE */}
          <div className="aw-panel" aria-label="Bot Inspector & Sandbox">
            {/* Inspector Top Bar */}
            <div className="aw-panel-head">
              <div className="aw-panel-title">
                <Saya shape="block" mood={blockMood} className="aw-panel-avatar" />
                <span className="aw-panel-name">Block</span>
              </div>
              <div className="aw-panel-tabs">
                <button
                  type="button"
                  onClick={() => setRightTab("computer")}
                  className={`aw-tab-btn ${rightTab === "computer" ? "is-active" : ""}`}
                >
                  Computer
                </button>
                <button
                  type="button"
                  onClick={() => setRightTab("inspector")}
                  className={`aw-tab-btn ${rightTab === "inspector" ? "is-active" : ""}`}
                >
                  Canvas
                </button>
                <button type="button" className="aw-tab-close" aria-label="Close inspector">
                  <CloseIcon className="aw-icon-xs" />
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="aw-panel-search-box">
              <SearchIcon className="aw-icon-faint" />
              <span>Search</span>
            </div>

            {/* Accordion Categories Matching Real Dashboard */}
            <div className="aw-accordion">
              {/* Tools Accordion */}
              <div className="aw-acc-item">
                <button
                  type="button"
                  onClick={() => toggleAccordion("tools")}
                  className="aw-acc-header"
                >
                  <div className="aw-acc-label">
                    <ToolsIcon className="aw-acc-icon" />
                    <span>Tools</span>
                  </div>
                  <span className="aw-acc-badge">3</span>
                  <ChevronIcon className={`aw-acc-chevron ${accordions.tools ? "is-open" : ""}`} />
                </button>
                {accordions.tools ? (
                  <div className="aw-acc-body">
                    <div className="aw-tool-chip">bash · container</div>
                    <div className="aw-tool-chip">git · github</div>
                    <div className="aw-tool-chip">pnpm · test</div>
                  </div>
                ) : null}
              </div>

              {/* Computer Accordion (Always Active with Sandbox Terminal) */}
              <div className="aw-acc-item is-open-box">
                <button
                  type="button"
                  onClick={() => toggleAccordion("computer")}
                  className="aw-acc-header"
                >
                  <div className="aw-acc-label">
                    <TerminalIcon className="aw-acc-icon" />
                    <span>Computer</span>
                  </div>
                  <span className="aw-live-dot" title="Running" />
                  <ChevronIcon
                    className={`aw-acc-chevron ${accordions.computer ? "is-open" : ""}`}
                  />
                </button>

                {accordions.computer ? (
                  <div className="aw-term-container">
                    <div className="aw-term-head">
                      <TerminalIcon className="aw-icon-xs" />
                      <span>block · /home/bot</span>
                      <span className="aw-term-status">docker</span>
                    </div>

                    <div className="aw-term">
                      {TERMINAL_OUTPUT.filter((line) => line.at <= step).map((line, index) => (
                        <div key={`${line.text}-${index}`} className={`aw-line ${line.kind ?? ""}`}>
                          {line.text}
                        </div>
                      ))}
                      <span className="aw-caret" />
                    </div>

                    <div className="aw-files">
                      <span className="aw-file">shop/</span>
                      <span className={`aw-file ${step >= 3 ? "is-hot" : ""}`}>src/cart.ts</span>
                      <span className="aw-file">notes.md</span>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Memory Accordion */}
              <div className="aw-acc-item">
                <button
                  type="button"
                  onClick={() => toggleAccordion("memory")}
                  className="aw-acc-header"
                >
                  <div className="aw-acc-label">
                    <BrainIcon className="aw-acc-icon" />
                    <span>Memory</span>
                  </div>
                  <span className="aw-acc-badge">4</span>
                  <ChevronIcon className={`aw-acc-chevron ${accordions.memory ? "is-open" : ""}`} />
                </button>
                {accordions.memory ? (
                  <div className="aw-acc-body">
                    <div className="aw-memory-row">• PR rules: require CI green</div>
                    <div className="aw-memory-row">• Tests: use pnpm test</div>
                  </div>
                ) : null}
              </div>

              {/* Model Accordion */}
              <div className="aw-acc-item">
                <button
                  type="button"
                  onClick={() => toggleAccordion("model")}
                  className="aw-acc-header"
                >
                  <div className="aw-acc-label">
                    <CpuIcon className="aw-acc-icon" />
                    <span>Model</span>
                  </div>
                  <span className="aw-acc-sub">Claude 3.7</span>
                  <ChevronIcon className={`aw-acc-chevron ${accordions.model ? "is-open" : ""}`} />
                </button>
              </div>

              {/* Permissions Accordion */}
              <div className="aw-acc-item">
                <button
                  type="button"
                  onClick={() => toggleAccordion("permissions")}
                  className="aw-acc-header"
                >
                  <div className="aw-acc-label">
                    <ShieldIcon className="aw-acc-icon" />
                    <span>Permissions</span>
                  </div>
                  <span className="aw-acc-sub">Approval for risky</span>
                  <ChevronIcon
                    className={`aw-acc-chevron ${accordions.permissions ? "is-open" : ""}`}
                  />
                </button>
              </div>

              {/* Voice & Alerts */}
              <div className="aw-acc-item">
                <div className="aw-acc-header">
                  <div className="aw-acc-label">
                    <BellIcon className="aw-acc-icon" />
                    <span>Voice &amp; alerts</span>
                  </div>
                  <ChevronIcon className="aw-acc-chevron" />
                </div>
              </div>

              {/* Usage Accordion */}
              <div className="aw-acc-item">
                <button
                  type="button"
                  onClick={() => toggleAccordion("usage")}
                  className="aw-acc-header"
                >
                  <div className="aw-acc-label">
                    <ChartIcon className="aw-acc-icon" />
                    <span>Usage</span>
                  </div>
                  <span className="aw-acc-sub">1.4k tokens</span>
                  <ChevronIcon className={`aw-acc-chevron ${accordions.usage ? "is-open" : ""}`} />
                </button>
              </div>
            </div>

            {/* Footer Link */}
            <div className="aw-panel-footer">
              <span>Secrets, connectors, and the full bot page</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
