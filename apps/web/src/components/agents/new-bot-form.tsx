"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronDown, ExternalLink, KeyRound, Loader2 } from "lucide-react"
import { DEFAULT_CAPABILITIES, type AgentCapabilities } from "@sayabot/core"
import { createBotAction } from "@/lib/actions/agents"
import { connectAccountAction } from "@/lib/actions/keys"
import { ACCOUNT_PROVIDERS, type AccountProvider } from "@/lib/ai-accounts"
import { GroupIcon, useModelList } from "@/components/room/model-picker/model-list"
import { Mascot } from "@/components/ui/mascot"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"
import type { PickerGroup } from "@/lib/model-catalog"

export interface BotTemplate {
  id: string
  name: string
  description: string
  systemPrompt: string
  defaultCapabilities: Partial<AgentCapabilities> | null
}

const field =
  "w-full rounded-xl border border-line bg-raised px-3.5 text-[14.5px] text-text outline-none placeholder:text-faint focus:border-line-strong"
const label = "mb-2 block text-[13px] font-medium text-muted"

/** Providers you add with a pasted key, in the order most people look for them. */
const KEY_PROVIDERS = ["anthropic", "openai", "google", "openrouter", "deepseek", "grok", "groq", "kimi", "qwen", "minimax", "cerebras"]
  .map((id) => ACCOUNT_PROVIDERS.find((p) => p.id === id))
  .filter((p): p is AccountProvider => Boolean(p))

/** The few skills worth a switch; everything else keeps the bot's defaults. */
const SKILLS: { key: keyof AgentCapabilities; name: string; hint: string }[] = [
  { key: "webSearch", name: "Search the web", hint: "Look up current information" },
  { key: "memory", name: "Remember things", hint: "Keep facts and preferences between chats" },
  { key: "document", name: "Read files", hint: "PDFs, spreadsheets and images you send" },
  { key: "sandbox", name: "Run code", hint: "Try code in a throwaway sandbox" },
  { key: "connectors", name: "Use your apps", hint: "Drive, Slack, GitHub and other connected apps" },
  { key: "computer", name: "Own computer", hint: "A private Linux computer with its own disk" },
]

type Pick = { kind: "group"; groupKey: string } | { kind: "new"; providerId: string } | null

const groupKey = (group: PickerGroup) => group.keyId ?? `server:${group.provider}`

export function NewBotForm({
  orgSlug,
  templates,
  initialTemplateId,
  roomId,
  roomName,
}: {
  orgSlug: string
  templates: BotTemplate[]
  /** From the Marketplace: start from this template. */
  initialTemplateId?: string
  /** From a group chat's "Add bot": the new bot joins that chat too. */
  roomId?: string
  roomName?: string
}) {
  const router = useRouter()
  const initial = templates.find((t) => t.id === initialTemplateId)
  const { list, loading, error: listError, reload } = useModelList(orgSlug)
  const [name, setName] = useState(initial?.name ?? "")
  const [instructions, setInstructions] = useState(initial?.systemPrompt ?? "")
  const [templateId, setTemplateId] = useState<string | null>(initial?.id ?? null)
  const [pick, setPick] = useState<Pick>(null)
  const [model, setModel] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [skills, setSkills] = useState<AgentCapabilities>({
    ...DEFAULT_CAPABILITIES,
    ...(initial?.defaultCapabilities ?? {}),
  })
  const [showSkills, setShowSkills] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connecting, startConnect] = useTransition()
  const [creating, startCreate] = useTransition()

  // Ready-to-use accounts: the server's own models, saved keys, signed-in apps and your Mac.
  const ready = useMemo(() => (list?.groups ?? []).filter((g) => g.models.length > 0), [list])
  const connected = new Set(ready.filter((g) => g.section === "key").map((g) => g.provider))
  const addable = KEY_PROVIDERS.filter((p) => !connected.has(p.id))
  const selectedGroup = pick?.kind === "group" ? ready.find((g) => groupKey(g) === pick.groupKey) : undefined
  const newProvider = pick?.kind === "new" ? ACCOUNT_PROVIDERS.find((p) => p.id === pick.providerId) : undefined

  // Preselect the first account that works, so most people only type a name.
  useEffect(() => {
    const first = ready[0]
    if (pick || !first) return
    setPick({ kind: "group", groupKey: groupKey(first) })
    setModel(first.models[0]?.id ?? "")
  }, [ready, pick])

  function chooseGroup(group: PickerGroup) {
    setPick({ kind: "group", groupKey: groupKey(group) })
    setModel(group.models[0]?.id ?? "")
    setError(null)
  }

  function chooseTemplate(template: BotTemplate) {
    if (templateId === template.id) {
      setTemplateId(null)
      return
    }
    setTemplateId(template.id)
    if (!name.trim()) setName(template.name)
    setInstructions(template.systemPrompt)
    setSkills({ ...DEFAULT_CAPABILITIES, ...(template.defaultCapabilities ?? {}) })
  }

  function connect() {
    if (!newProvider) return
    setError(null)
    startConnect(async () => {
      const result = await connectAccountAction({ orgSlug, provider: newProvider.id, apiKey })
      if (!result.ok) {
        setError(result.error ?? "That key didn't work")
        return
      }
      const keyId = typeof result.data?.keyId === "string" ? result.data.keyId : null
      setApiKey("")
      showToast({ message: `${newProvider.name} connected` })
      await reload(true)
      if (keyId) {
        setPick({ kind: "group", groupKey: keyId })
        setModel("")
      }
    })
  }

  // After connecting, pick the new account's first model once its list arrives.
  useEffect(() => {
    if (selectedGroup && !model && selectedGroup.models[0]) setModel(selectedGroup.models[0].id)
  }, [selectedGroup, model])

  function create() {
    setError(null)
    if (!name.trim()) {
      setError("Give your bot a name")
      return
    }
    if (!selectedGroup) {
      setError(newProvider ? `Connect ${newProvider.name} first` : "Choose which AI your bot runs on")
      return
    }
    startCreate(async () => {
      const result = await createBotAction({
        orgSlug,
        name,
        instructions,
        keyId: selectedGroup.keyId,
        model: model || null,
        templateId,
        capabilities: skills,
        roomId: roomId ?? null,
      })
      if (!result.ok) {
        setError(result.error ?? "Could not make the bot")
        return
      }
      if (result.warning) showToast({ message: result.warning })
      const path = typeof result.data?.path === "string" ? result.data.path : `/${orgSlug}`
      router.push(path)
      router.refresh()
    })
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-10 sm:px-6">
      <div className="mb-8 flex items-center gap-4">
        <Mascot seed={name.trim() || "new bot"} mood={name.trim() ? "happy" : "idle"} className="h-16 w-16 shrink-0" />
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-text">New bot</h1>
          <p className="mt-0.5 text-[14px] text-faint">
            {roomName ? `It will join ${roomName} and get its own chat with you.` : "Name it, pick its AI, and start chatting."}
          </p>
        </div>
      </div>

      <div className="space-y-7">
        <div>
          <label htmlFor="bot-name" className={label}>Name</label>
          <input
            id="bot-name"
            autoFocus
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="e.g. Research Buddy"
            className={cn(field, "h-12 text-[16px]")}
          />
        </div>

        <div>
          <label htmlFor="bot-instructions" className={label}>What should it do? <span className="text-faint">(optional)</span></label>
          {templates.length ? (
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  title={template.description}
                  onClick={() => chooseTemplate(template)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[12.5px] transition-colors",
                    templateId === template.id
                      ? "border-accent bg-accent/10 text-text"
                      : "border-line text-muted hover:border-line-strong hover:text-text",
                  )}
                >
                  {template.name}
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            id="bot-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={4}
            placeholder="You help me research topics and write short, clear summaries with sources."
            className={cn(field, "resize-y py-3 leading-relaxed")}
          />
        </div>

        <div>
          <span className={label}>AI provider</span>
          {loading && !list ? (
            <div className="flex items-center gap-2 rounded-xl border border-line px-3.5 py-3 text-[13.5px] text-faint">
              <Loader2 className="h-4 w-4 animate-spin" /> Looking for your AI accounts…
            </div>
          ) : null}
          {listError && !list ? <p className="text-[13px] text-danger">{listError}</p> : null}

          {ready.length ? (
            <div className="space-y-1.5">
              {ready.map((group) => {
                const active = pick?.kind === "group" && pick.groupKey === groupKey(group)
                return (
                  <button
                    key={groupKey(group)}
                    type="button"
                    onClick={() => chooseGroup(group)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors",
                      active ? "border-accent bg-accent/5" : "border-line hover:border-line-strong",
                    )}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-raised">
                      <GroupIcon provider={group.provider} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-text">{group.label}</span>
                      <span className="block truncate text-[12px] text-faint">{group.detail}</span>
                    </span>
                    {active ? <Check className="h-4 w-4 shrink-0 text-accent" /> : null}
                  </button>
                )
              })}
            </div>
          ) : null}

          {list ? (
            <div className={cn(ready.length && "mt-4")}>
              <p className="mb-2 text-[12.5px] text-faint">
                {ready.length ? "Or add another provider with an API key" : "Add a provider with an API key to get started"}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {addable.map((provider) => {
                  const active = pick?.kind === "new" && pick.providerId === provider.id
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => {
                        setPick({ kind: "new", providerId: provider.id })
                        setApiKey("")
                        setError(null)
                      }}
                      className={cn(
                        "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors",
                        active ? "border-accent bg-accent/10 text-text" : "border-line text-muted hover:border-line-strong hover:text-text",
                      )}
                    >
                      <GroupIcon provider={provider.id} size={16} />
                      {provider.name}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          {newProvider ? (
            <div className="mt-3 rounded-xl border border-line bg-panel p-3.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[13.5px] font-medium text-text">
                  <KeyRound className="h-4 w-4 text-faint" /> {newProvider.name} API key
                </span>
                {newProvider.keyUrl ? (
                  <a
                    href={newProvider.keyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[12.5px] text-muted hover:text-text"
                  >
                    Get a key <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && apiKey.trim() && connect()}
                  placeholder={newProvider.keyHint ?? "Paste your API key"}
                  className={cn(field, "h-10 flex-1")}
                />
                <button
                  type="button"
                  disabled={connecting || apiKey.trim().length < 8}
                  onClick={connect}
                  className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-text px-4 text-[13.5px] font-medium text-void hover:bg-white disabled:opacity-50"
                >
                  {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Connect
                </button>
              </div>
              <p className="mt-2 text-[12px] text-faint">Saved encrypted for this workspace. Every bot can use it.</p>
            </div>
          ) : null}
        </div>

        {selectedGroup && selectedGroup.models.length > 1 ? (
          <div>
            <label htmlFor="bot-model" className={label}>Model</label>
            <select
              id="bot-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={cn(field, "h-11 appearance-none")}
            >
              {selectedGroup.models.map((m) => (
                <option key={m.id || "auto"} value={m.id}>
                  {m.label}
                  {m.free ? " · free" : ""}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div>
          <button
            type="button"
            onClick={() => setShowSkills((open) => !open)}
            aria-expanded={showSkills}
            className="flex items-center gap-1 text-[13px] font-medium text-muted hover:text-text"
          >
            What it can do
            <ChevronDown className={cn("h-4 w-4 transition-transform", !showSkills && "-rotate-90")} />
          </button>
          {showSkills ? (
            <div className="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {SKILLS.map((skill) => {
                const on = Boolean(skills[skill.key])
                return (
                  <label
                    key={skill.key}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                      on ? "border-line-strong bg-raised/60" : "border-line",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setSkills((prev) => ({
                          ...prev,
                          [skill.key]: skill.key === "computer" ? (prev.computer ? false : { profile: "standard" }) : !prev[skill.key],
                        }))
                      }
                      className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
                    />
                    <span>
                      <span className="block text-[13.5px] text-text">{skill.name}</span>
                      <span className="block text-[12px] leading-snug text-faint">{skill.hint}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-[13.5px] text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end">
          <button
            type="button"
            disabled={creating || !name.trim() || !selectedGroup}
            onClick={create}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-6 text-[14.5px] font-semibold text-void transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {creating ? "Making your bot…" : "Create bot"}
          </button>
        </div>
      </div>
    </div>
  )
}
