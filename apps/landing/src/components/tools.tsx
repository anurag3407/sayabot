"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Reveal } from "./reveal"
import { Saya } from "./saya"
import {
  GitHubLogo,
  SlackLogo,
  GoogleDriveLogo,
  NotionLogo,
  LinearLogo,
  StripeLogo,
  SentryLogo,
  DiscordLogo,
  SupabaseLogo,
  GmailLogo,
  GoogleCalendarLogo,
  PostHogLogo,
  ClaudeLogo,
  OpenAiLogo,
  CursorLogo,
  GeminiLogo,
  HermesLogo,
  OpenCodeLogo,
  QwenLogo,
  CopilotLogo,
  ChatGptLogo,
} from "./brand-logos"

type OrbitalTool = {
  id: string
  name: string
  icon: (size?: number) => ReactNode
  x: number // in 1000x640 space
  y: number
  task: string
  stepIndex?: number
}

const ORBITAL_TOOLS: OrbitalTool[] = [
  {
    id: "slack",
    name: "Slack",
    icon: (s = 22) => <SlackLogo size={s} />,
    x: 180,
    y: 135,
    task: "Extracted crash trace & error payload from #prod-alerts",
    stepIndex: 0,
  },
  {
    id: "gmail",
    name: "Gmail",
    icon: (s = 22) => <GmailLogo size={s} />,
    x: 210,
    y: 50,
    task: "Drafted executive incident summary to enterprise customer success",
  },
  {
    id: "gcal",
    name: "Google Calendar",
    icon: (s = 22) => <GoogleCalendarLogo size={s} />,
    x: 360,
    y: 55,
    task: "Booked 15-min incident retro on the on-call team calendar",
  },
  {
    id: "linear",
    name: "Linear",
    icon: (s = 22) => <LinearLogo size={s} />,
    x: 640,
    y: 55,
    task: "Linked commit to ENG-1429 and moved issue to In Review",
  },
  {
    id: "sentry",
    name: "Sentry",
    icon: (s = 22) => <SentryLogo size={s} />,
    x: 820,
    y: 135,
    task: "Traced 504 gateway timeout in webhook delivery loop",
    stepIndex: 1,
  },
  {
    id: "stripe",
    name: "Stripe",
    icon: (s = 22) => <StripeLogo size={s} />,
    x: 910,
    y: 310,
    task: "Audited webhook signatures & replayed 6 stalled invoices",
  },
  {
    id: "discord",
    name: "Discord",
    icon: (s = 22) => <DiscordLogo size={s} />,
    x: 870,
    y: 480,
    task: "Broadcasted fix deployment to #announcements channel",
  },
  {
    id: "github",
    name: "GitHub",
    icon: (s = 22) => <GitHubLogo size={s} />,
    x: 730,
    y: 580,
    task: "Merged PR #284 · Exp backoff with jitter & retry limit",
    stepIndex: 2,
  },
  {
    id: "posthog",
    name: "PostHog",
    icon: (s = 22) => <PostHogLogo size={s} />,
    x: 500,
    y: 595,
    task: "Verified 0 dropped deliveries across 1,200 live retries",
    stepIndex: 3,
  },
  {
    id: "supabase",
    name: "Supabase",
    icon: (s = 22) => <SupabaseLogo size={s} />,
    x: 270,
    y: 580,
    task: "Executed Drizzle migration: added idx_webhook_retry_count",
  },
  {
    id: "gdrive",
    name: "Google Drive",
    icon: (s = 22) => <GoogleDriveLogo size={s} />,
    x: 130,
    y: 480,
    task: "Saved 30-second replay demo to Shared Engineering Drive",
  },
  {
    id: "notion",
    name: "Notion",
    icon: (s = 22) => <NotionLogo size={s} />,
    x: 90,
    y: 310,
    task: "Published incident post-mortem & RCA to Runbooks space",
  },
]

type WorkflowStep = {
  toolId: string
  toolName: string
  icon: (size?: number) => ReactNode
  text: string
}

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    toolId: "slack",
    toolName: "Slack",
    icon: (s = 18) => <SlackLogo size={s} />,
    text: "Extracted webhook error & payload from #prod-alerts",
  },
  {
    toolId: "sentry",
    toolName: "Sentry",
    icon: (s = 18) => <SentryLogo size={s} />,
    text: "Traced 504 gateway timeout in delivery loop",
  },
  {
    toolId: "github",
    toolName: "GitHub",
    icon: (s = 18) => <GitHubLogo size={s} />,
    text: "Merged PR #284 · Exp backoff with jitter & retry limit",
  },
  {
    toolId: "posthog",
    toolName: "PostHog",
    icon: (s = 18) => <PostHogLogo size={s} />,
    text: "Verified 0 dropped deliveries across 1,200 live retries",
  },
]

type CliAgent = {
  name: string
  icon: ReactNode
}

const CLIS: CliAgent[] = [
  { name: "Claude Code", icon: <ClaudeLogo /> },
  { name: "Codex", icon: <OpenAiLogo /> },
  { name: "Cursor", icon: <CursorLogo /> },
  { name: "Gemini CLI", icon: <GeminiLogo /> },
  { name: "Hermes", icon: <HermesLogo /> },
  { name: "OpenCode", icon: <OpenCodeLogo /> },
  { name: "Qwen Code", icon: <QwenLogo /> },
  { name: "Copilot", icon: <CopilotLogo /> },
  { name: "ChatGPT", icon: <ChatGptLogo /> },
]

/**
 * Calculates a smooth cubic or quadratic connector curve from the card boundary
 * to the center of the orbital tool node in a 1000x640 coordinate space.
 */
function getRayPath(nodeX: number, nodeY: number) {
  const cardCx = 500
  const cardCy = 320
  const halfW = 225
  const halfH = 185

  const dx = nodeX - cardCx
  const dy = nodeY - cardCy

  let ax = cardCx
  let ay = cardCy

  if (Math.abs(dx) * halfH > Math.abs(dy) * halfW) {
    if (dx > 0) {
      ax = cardCx + halfW
      ay = cardCy + (halfW * dy) / dx
    } else {
      ax = cardCx - halfW
      ay = cardCy - (halfW * dy) / dx
    }
  } else {
    if (dy > 0) {
      ay = cardCy + halfH
      ax = cardCx + (halfH * dx) / dy
    } else {
      ay = cardCy - halfH
      ax = cardCx - (halfH * dx) / dy
    }
  }

  // Clamp anchors away from very sharp corners
  ax = Math.max(cardCx - halfW + 16, Math.min(cardCx + halfW - 16, ax))
  ay = Math.max(cardCy - halfH + 16, Math.min(cardCy + halfH - 16, ay))

  // Gentle natural curve
  const mx = (ax + nodeX) / 2
  const my = (ay + nodeY) / 2 + (nodeY < cardCy ? 12 : -12)

  return `M ${ax.toFixed(1)} ${ay.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${nodeX.toFixed(1)} ${nodeY.toFixed(1)}`
}

export function Tools() {
  const [activeStep, setActiveStep] = useState(0)
  const [selectedBonusTool, setSelectedBonusTool] = useState<OrbitalTool | null>(null)
  const [isPaused, setIsPaused] = useState(false)

  // Auto-advance through the workflow steps
  useEffect(() => {
    if (isPaused || selectedBonusTool) return

    const timer = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % WORKFLOW_STEPS.length)
    }, 3800)

    return () => clearInterval(timer)
  }, [isPaused, selectedBonusTool])

  // Determine which orbital tool is currently active
  const activeToolId = selectedBonusTool
    ? selectedBonusTool.id
    : WORKFLOW_STEPS[activeStep]?.toolId || "slack"

  const activeNode = ORBITAL_TOOLS.find((node) => node.id === activeToolId) || ORBITAL_TOOLS[0]

  const handleNodeClick = (node: OrbitalTool) => {
    if (node.stepIndex !== undefined) {
      setActiveStep(node.stepIndex)
      setSelectedBonusTool(null)
    } else {
      setSelectedBonusTool(node)
    }
  }

  return (
    <section className="section tools" aria-labelledby="tools-title">
      <div className="wrap head-center">
        <Reveal>
          <h2 className="h2 tools-title" id="tools-title">
            <span className="tools-pill">
              <Saya shape="block" follow className="tools-pill-face" />
              Agents
            </span>{" "}
            work with your tools.
          </h2>
          <p className="lede">
            Connect an app once for the whole workspace, then grant each agent exactly what it may
            touch. Read-only by default.
          </p>
        </Reveal>
      </div>

      {/* Radial Connector Constellation Hub */}
      <div
        className="constellation-hub"
        aria-label="Interactive multi-tool orchestration hub"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        {/* SVG Connector Canvas */}
        <svg
          className="constellation-svg"
          viewBox="0 0 1000 640"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="beamGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#9d8cff" stopOpacity="0.2" />
              <stop offset="70%" stopColor="#c5bbff" stopOpacity="1" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
            </linearGradient>
            <filter id="glowFilter" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Dotted static rays to all 11 nodes */}
          {ORBITAL_TOOLS.map((node) => {
            const isActive = node.id === activeToolId
            return (
              <path
                key={`ray-${node.id}`}
                d={getRayPath(node.x, node.y)}
                className={`constellation-ray ${isActive ? "is-active" : ""}`}
              />
            )
          })}

          {/* Active traveling glowing beam */}
          {activeNode && (
            <path
              d={getRayPath(activeNode.x, activeNode.y)}
              className="constellation-beam"
              filter="url(#glowFilter)"
            />
          )}
        </svg>

        {/* Central Agent Orchestration Card */}
        <div className="constellation-card">
          {/* Card Top Bar */}
          <div className="constellation-card-header">
            <div className="constellation-agent-wrap">
              <Saya
                shape="ghost"
                tone="lilac"
                mood={isPaused ? "idle" : activeStep === 3 ? "done" : "working"}
                live
                className="constellation-mascot"
              />
              <div className="constellation-agent-meta">
                <span className="constellation-agent-name">
                  Scout <span className="constellation-agent-badge">Orchestrator</span>
                </span>
                <span className="constellation-agent-status">
                  <span className="status-pulse-dot" />
                  working
                </span>
              </div>
            </div>
            <div className="constellation-tag">Autonomous Run</div>
          </div>

          {/* User Request Bubble with Inline Badges */}
          <div className="constellation-prompt-box">
            <div className="constellation-prompt-avatar" aria-hidden="true">
              A
            </div>
            <p className="constellation-prompt-copy">
              Alex reported a webhook timeout in{" "}
              <span className="tool-chip tool-chip-slack">
                <SlackLogo size={13} /> Slack
              </span>
              . Trace exception in{" "}
              <span className="tool-chip tool-chip-sentry">
                <SentryLogo size={13} /> Sentry
              </span>
              , patch retry backoff on{" "}
              <span className="tool-chip tool-chip-github">
                <GitHubLogo size={13} /> GitHub
              </span>
              , and verify metrics in{" "}
              <span className="tool-chip tool-chip-posthog">
                <PostHogLogo size={13} /> PostHog
              </span>
              .
            </p>
          </div>

          {/* Multi-Step Checklist */}
          <div className="constellation-steps" role="list" aria-label="Workflow execution steps">
            {WORKFLOW_STEPS.map((step, idx) => {
              const isCurrent = activeStep === idx && !selectedBonusTool
              const isCompleted =
                activeStep > idx || (activeStep === WORKFLOW_STEPS.length - 1 && idx === activeStep)

              return (
                <button
                  key={step.toolId}
                  type="button"
                  className={`constellation-step-item ${isCurrent ? "is-current" : ""} ${
                    isCompleted ? "is-completed" : ""
                  }`}
                  onClick={() => {
                    setActiveStep(idx)
                    setSelectedBonusTool(null)
                  }}
                >
                  <span className="step-tool-icon">{step.icon(17)}</span>
                  <span className="step-tool-text">{step.text}</span>
                  <span className="step-tool-indicator">
                    {isCompleted ? (
                      <svg className="step-check-svg" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M3.5 8.5L6.5 11.5L12.5 4.5"
                          stroke="#3ECF8E"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : isCurrent ? (
                      <span className="step-pulse-ring" />
                    ) : (
                      <span className="step-pending-dot" />
                    )}
                  </span>
                </button>
              )
            })}

            {/* Bonus Clicked Tool Row */}
            {selectedBonusTool && (
              <div className="constellation-step-item is-bonus is-current">
                <span className="step-tool-icon">{selectedBonusTool.icon(17)}</span>
                <span className="step-tool-text">{selectedBonusTool.task}</span>
                <span className="step-tool-indicator">
                  <svg className="step-check-svg" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M3.5 8.5L6.5 11.5L12.5 4.5"
                      stroke="#9D8CFF"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Orbital App Nodes (Positioned radially around the card) */}
        <div className="constellation-nodes" aria-label="Connected tools orbit">
          {ORBITAL_TOOLS.map((node) => {
            const isActive = node.id === activeToolId
            return (
              <button
                key={node.id}
                type="button"
                className={`constellation-node-btn ${isActive ? "is-active" : ""}`}
                style={{
                  left: `${(node.x / 1000) * 100}%`,
                  top: `${(node.y / 640) * 100}%`,
                }}
                onClick={() => handleNodeClick(node)}
                aria-label={`${node.name}: ${node.task}`}
              >
                {isActive && <span className="constellation-node-halo" aria-hidden="true" />}
                <span className="constellation-node-circle">{node.icon(25)}</span>
                <span className="constellation-node-label">{node.name}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* MCP marqee footer */}
      <div className="wrap">
        <p className="tools-cli-label">
          …and bring the agents you already pay for, over one MCP invite link
        </p>
      </div>
      <div className="marquee" aria-label="Agent clients that can join">
        <div className="marquee-track">
          {[...CLIS, ...CLIS].map((cli, index) => (
            <span
              key={`${cli.name}-${index}`}
              className="marquee-item"
              aria-hidden={index >= CLIS.length}
            >
              <span className="marquee-icon">{cli.icon}</span>
              {cli.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
