"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createBotFromTemplate } from "@/lib/actions/agents"
import type { AgentCapabilities } from "@sayabot/core"
import { DEFAULT_CAPABILITIES } from "@sayabot/core"

export interface TemplateSummary {
  id: string
  slug: string
  name: string
  description: string
  category: string
  defaultCapabilities: AgentCapabilities
  defaultModel: string
  systemPrompt: string
  secretSlots: Array<{
    name: string
    label: string
    required?: boolean
    allowedHosts?: string[]
  }>
  starterTasks: Array<{
    title: string
    description?: string
  }>
}

export interface ProviderKeySummary {
  id: string
  provider: string
  label: string
}

export interface RoomSummary {
  id: string
  name: string
}

export interface VaultSecretSummary {
  id: string
  label: string
  kind: string
  last4: string
}

interface Props {
  orgSlug: string
  templates: TemplateSummary[]
  providerKeys: ProviderKeySummary[]
  rooms: RoomSummary[]
  vaultSecrets: VaultSecretSummary[]
}

const CAPABILITY_DESCRIPTIONS: Record<keyof AgentCapabilities, { label: string; desc: string }> = {
  canvas: { label: "Canvas Editing", desc: "Read and write real-time collaborative room canvas documents" },
  tasks: { label: "Task Coordination", desc: "Create, assign, unblock, and report on task board items" },
  sandbox: { label: "Code Sandbox", desc: "Run code snippets in a throwaway container" },
  webSearch: { label: "Web Search", desc: "Allow bot to query current web information" },
  document: { label: "Document & OCR", desc: "Extract tables and text from PDFs, bank statements, and financial documents" },
  github: { label: "GitHub Bridge", desc: "Search repositories, read code, and inspect PRs" },
  postgres: { label: "Postgres Inspector", desc: "Read schemas and execute analytical queries" },
  mcp: { label: "MCP Tools", desc: "Access room-level Model Context Protocol servers" },
  computer: { label: "Persistent Computer", desc: "Dedicated Linux container with persistent disk" },
  secrets: { label: "Secret Broker", desc: "Safely inject authorized API tokens into outbound HTTPS requests" },
  memory: { label: "Durable Memory", desc: "Store and recall facts, preferences, and decisions across turns" },
  subagents: { label: "Spawn Subagents", desc: "Spawn parallel child subagents for focused reading and research tasks" },
  cron: { label: "Cron & Automations", desc: "Autonomous self-scheduling, recurring tasks, and routine management" },
  connectors: { label: "Workspace Connectors", desc: "Access Google Drive, Slack, and GitHub with granular scoping" },
}

export function BotWizard({ orgSlug, templates, providerKeys, rooms, vaultSecrets }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)

  // Step 1: Template
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateSummary | null>(
    templates.find((t) => t.slug === "coder") || templates[0] || null,
  )

  // Step 2: Identity, Model, Capabilities
  const [handle, setHandle] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [selectedKeyId, setSelectedKeyId] = useState<string>(providerKeys[0]?.id || "")
  const [model, setModel] = useState("anthropic/claude-3-7-sonnet")
  const [capabilities, setCapabilities] = useState<AgentCapabilities>(
    selectedTemplate?.defaultCapabilities ?? { ...DEFAULT_CAPABILITIES },
  )

  // Step 3: Secrets mapping (slotName -> vaultSecretId)
  const [secretBindings, setSecretBindings] = useState<Record<string, string>>({})

  // Step 4: Rooms & Starter Task
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>(rooms[0] ? [rooms[0].id] : [])
  const [starterTaskTitle, setStarterTaskTitle] = useState("")
  const [starterTaskDescription, setStarterTaskDescription] = useState("")

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleSelectTemplate(tpl: TemplateSummary) {
    setSelectedTemplate(tpl)
    if (!handle) setHandle(tpl.slug)
    if (!displayName) setDisplayName(tpl.name)
    if (tpl.defaultModel) setModel(tpl.defaultModel)
    if (tpl.defaultCapabilities) setCapabilities({ ...tpl.defaultCapabilities })
  }

  function toggleCapability(key: keyof AgentCapabilities) {
    setCapabilities((prev) => {
      if (key === "computer") {
        return { ...prev, computer: prev.computer ? false : { profile: "standard" } }
      }
      return { ...prev, [key]: !prev[key] }
    })
  }

  function toggleRoom(roomId: string) {
    setSelectedRoomIds((prev) =>
      prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId],
    )
  }

  async function handleSubmit() {
    setLoading(true)
    setError(null)

    const formData = new FormData()
    formData.append("orgSlug", orgSlug)
    if (selectedTemplate) formData.append("templateId", selectedTemplate.id)
    formData.append("handle", handle || selectedTemplate?.slug || "my-bot")
    formData.append("displayName", displayName || selectedTemplate?.name || "My Bot")
    if (selectedKeyId) formData.append("providerKeyId", selectedKeyId)
    formData.append("model", model)
    formData.append("capabilities", JSON.stringify(capabilities))
    if (selectedTemplate?.systemPrompt) formData.append("systemPrompt", selectedTemplate.systemPrompt)

    for (const rid of selectedRoomIds) {
      formData.append("roomIds", rid)
    }

    formData.append("secretBindings", JSON.stringify(secretBindings))
    if (starterTaskTitle) formData.append("starterTaskTitle", starterTaskTitle)
    if (starterTaskDescription) formData.append("starterTaskDescription", starterTaskDescription)

    try {
      const res = await createBotFromTemplate(null, formData)
      if (!res.ok) {
        setError(res.error || "Failed to create bot")
        setLoading(false)
        return
      }
      router.push(`/${orgSlug}/agents`)
      router.refresh()
    } catch (e: any) {
      setError(e.message || "Failed to submit")
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl py-6 px-4">
      {/* Step Indicators */}
      <div className="mb-8 flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Create a New Bot</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Step {step} of 4:{" "}
            {step === 1 && "Choose a template"}
            {step === 2 && "Configure model & capabilities"}
            {step === 3 && "Secret Broker & credentials"}
            {step === 4 && "Rooms & assignment"}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-mono">
          {[1, 2, 3, 4].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => s < step && setStep(s as any)}
              disabled={s > step}
              className={`h-7 w-7 rounded-full flex items-center justify-center font-medium transition-colors ${
                s === step
                  ? "bg-primary text-primary-foreground"
                  : s < step
                    ? "bg-muted text-foreground hover:bg-muted/80 cursor-pointer"
                    : "bg-muted/30 text-muted-foreground cursor-not-allowed"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-6 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Step 1: Templates */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {templates.map((tpl) => {
              const isSelected = selectedTemplate?.id === tpl.id
              return (
                <div
                  key={tpl.id}
                  onClick={() => handleSelectTemplate(tpl)}
                  className={`p-4 rounded-xl border text-left cursor-pointer transition-all ${
                    isSelected
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border bg-card hover:border-muted-foreground/30"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-foreground text-sm">{tpl.name}</span>
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {tpl.category}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {tpl.description}
                  </p>
                  {tpl.secretSlots.length > 0 && (
                    <div className="mt-3 flex items-center gap-1 text-[11px] text-faint">
                      <span>🔑 Needs {tpl.secretSlots.length} secret{tpl.secretSlots.length > 1 ? "s" : ""}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex justify-end pt-4">
            <button
              type="button"
              disabled={!selectedTemplate}
              onClick={() => setStep(2)}
              className="px-5 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 disabled:opacity-50"
            >
              Continue to Model & Capabilities →
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Model & Capabilities */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Handle</label>
              <div className="flex items-center rounded-lg border border-border bg-background px-3 py-1.5 focus-within:ring-1 focus-within:ring-primary">
                <span className="text-muted-foreground text-sm select-none">@</span>
                <input
                  type="text"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="bot-handle"
                  className="w-full bg-transparent px-1 text-sm outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="My Bot"
                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Provider Key</label>
              <select
                value={selectedKeyId}
                onChange={(e) => setSelectedKeyId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
              >
                {providerKeys.length === 0 ? (
                  <option value="">No provider keys added</option>
                ) : (
                  providerKeys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label} ({k.provider})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="anthropic/claude-3-7-sonnet">Claude 3.7 Sonnet (Recommended)</option>
                <option value="anthropic/claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                <option value="openai/gpt-4o">GPT-4o</option>
                <option value="openai/o3-mini">o3-mini</option>
                <option value="google/gemini-2.0-flash">Gemini 2.0 Flash</option>
                <option value="google/gemini-2.0-pro-exp-02-05">Gemini 2.0 Pro</option>
              </select>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-foreground mb-2">Capabilities</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {(Object.keys(CAPABILITY_DESCRIPTIONS) as Array<keyof AgentCapabilities>).map((key) => {
                const info = CAPABILITY_DESCRIPTIONS[key]
                const enabled = Boolean(capabilities[key])
                return (
                  <label
                    key={key}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      enabled ? "border-primary/50 bg-primary/5" : "border-border bg-card"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => toggleCapability(key)}
                      className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <div>
                      <div className="text-xs font-medium text-foreground">{info.label}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{info.desc}</div>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="flex justify-between pt-4">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="px-5 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90"
            >
              Continue to Secrets →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Secrets */}
      {step === 3 && (
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium text-foreground">Secret Broker Slots</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Secrets are safely brokered and never exposed in prompts or files.
            </p>
          </div>

          {selectedTemplate?.secretSlots.length === 0 ? (
            <div className="p-6 rounded-xl border border-border bg-muted/20 text-center text-sm text-muted-foreground">
              This template does not require any secret credentials.
            </div>
          ) : (
            <div className="space-y-3">
              {selectedTemplate?.secretSlots.map((slot) => {
                const boundValue = secretBindings[slot.name] || ""
                return (
                  <div key={slot.name} className="p-4 rounded-xl border border-border bg-card space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold text-foreground">{slot.name}</span>
                      <span className="text-[11px] text-muted-foreground">{slot.label}</span>
                    </div>
                    {slot.allowedHosts && slot.allowedHosts.length > 0 && (
                      <div className="text-[11px] text-faint">
                        Restricted to: {slot.allowedHosts.join(", ")}
                      </div>
                    )}
                    <select
                      value={boundValue}
                      onChange={(e) =>
                        setSecretBindings((prev) => ({ ...prev, [slot.name]: e.target.value }))
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="">(Select a Vault Secret)</option>
                      {vaultSecrets.map((sec) => (
                        <option key={sec.id} value={sec.id}>
                          {sec.label} (ending in {sec.last4})
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex justify-between pt-4">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => setStep(4)}
              className="px-5 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90"
            >
              Continue to Rooms & Tasks →
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Rooms & Starter Task */}
      {step === 4 && (
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium text-foreground mb-2">Invite to Rooms</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {rooms.map((room) => {
                const selected = selectedRoomIds.includes(room.id)
                return (
                  <label
                    key={room.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selected ? "border-primary/50 bg-primary/5" : "border-border bg-card"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleRoom(room.id)}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <span className="text-sm font-medium text-foreground">#{room.name}</span>
                  </label>
                )
              })}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-foreground mb-1">Starter Task (Optional)</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Assign an initial goal to wake the bot immediately upon creation.
            </p>
            <div className="space-y-2">
              <input
                type="text"
                value={starterTaskTitle}
                onChange={(e) => setStarterTaskTitle(e.target.value)}
                placeholder="Task title (e.g. Audit codebase for security risks)"
                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
              <textarea
                value={starterTaskDescription}
                onChange={(e) => setStarterTaskDescription(e.target.value)}
                placeholder="Details or deliverables expected..."
                rows={3}
                className="w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div className="flex justify-between pt-4">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted"
            >
              ← Back
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleSubmit}
              className="px-6 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Creating Bot..." : "Create Bot"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
