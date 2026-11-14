"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { createAgent } from "@/lib/actions/agents"
import { deleteProviderKey, saveProviderKey, testProviderKey } from "@/lib/actions/keys"
import { finishOnboardingAction, setupWorkspaceAction } from "@/lib/actions/onboarding"
import { addAgentToRoom } from "@/lib/actions/rooms"
import { Button } from "@/components/ui/button"
import { Field, HelpText, Input, Select, Textarea } from "@/components/ui/field"
import { InlineAlert } from "@/components/ui/empty"
import { handleFromName } from "@/lib/agent-handle"
import { cn, PROVIDER_LABELS } from "@/lib/format"
import { defaultModel, MODEL_SUGGESTIONS } from "@/lib/model-options"

const STEP_TITLES = [
  "Name your workspace",
  "Connect an AI model",
  "Create your first agent",
] as const

const TEMPLATES = [
  {
    key: "assistant",
    label: "Team assistant",
    name: "Assistant",
    prompt:
      "You are a helpful teammate. Answer clearly and briefly. Ask a question when the request is unclear.",
  },
  {
    key: "reviewer",
    label: "Reviewer",
    name: "Reviewer",
    prompt:
      "You review plans and drafts. Point out risks, gaps and unclear decisions, and suggest a concrete fix for each one.",
  },
  {
    key: "writer",
    label: "Writer",
    name: "Writer",
    prompt:
      "You turn rough notes into clear writing. Keep the author's meaning, use plain language, and keep it short.",
  },
] as const

function StepRail({ step }: { step: number }) {
  return (
    <ol className="space-y-px">
      {STEP_TITLES.map((title, index) => {
        const state = index < step ? "done" : index === step ? "current" : "upcoming"
        return (
          <li
            key={title}
            aria-current={index === step ? "step" : undefined}
            className={cn(
              "flex items-center gap-3 border-l-2 py-2 pl-3 font-mono text-[12px] transition-colors",
              state === "current"
                ? "border-accent text-text"
                : state === "done"
                  ? "border-line-strong text-muted"
                  : "border-line text-faint",
            )}
          >
            <span
              className={cn(
                "grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px]",
                state === "current"
                  ? "border-accent text-accent"
                  : state === "done"
                    ? "border-line-strong text-muted"
                    : "border-line text-faint",
              )}
            >
              {state === "done" ? "✓" : index + 1}
            </span>
            <span className="truncate">{title}</span>
          </li>
        )
      })}
    </ol>
  )
}

export function OnboardingWizard({
  userName,
  defaultTimeZone,
  timeZones,
  hasServerModel,
  macApp = null,
  initialWorkspace = null,
}: {
  userName: string
  defaultTimeZone: string
  timeZones: string[]
  hasServerModel: boolean
  /** An app signed in on the person's Mac (Sayabot for Mac): agents can run there, no key. */
  macApp?: { hostName: string; appName: string } | null
  initialWorkspace?: { slug: string; roomId: string } | null
}) {
  const router = useRouter()
  const [step, setStep] = useState(initialWorkspace ? 1 : 0)
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [workspaceName, setWorkspaceName] = useState("")
  const [roomName, setRoomName] = useState("General")
  const [timezone, setTimezone] = useState(defaultTimeZone)

  const [provider, setProvider] = useState("openai")
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [model, setModel] = useState(defaultModel("openai"))
  const [connectedKeyId, setConnectedKeyId] = useState<string | null>(null)
  const [useServerModel, setUseServerModel] = useState(false)
  // With Claude Code (or Codex…) signed in on their Mac, no key is needed: agents run there.
  const [useMac, setUseMac] = useState(Boolean(macApp))

  const [template, setTemplate] = useState<(typeof TEMPLATES)[number]["key"]>("assistant")
  const [agentName, setAgentName] = useState<string>(TEMPLATES[0].name)
  const [agentPrompt, setAgentPrompt] = useState<string>(TEMPLATES[0].prompt)
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const timezoneTouched = useRef(false)

  const suggestions = useMemo(() => MODEL_SUGGESTIONS[provider] ?? [], [provider])
  const handle = handleFromName(agentName)

  useEffect(() => {
    if (timezoneTouched.current) return
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (local && timeZones.includes(local)) setTimezone(local)
  }, [timeZones])

  useEffect(() => {
    if (step > 0) headingRef.current?.focus()
  }, [step])

  function goToRoom(slug: string, path?: string) {
    router.push(path ?? `/${slug}`)
  }

  function createWorkspace() {
    setError(null)
    startTransition(async () => {
      if (workspace) {
        setStep(1)
        return
      }
      const form = new FormData()
      form.set("workspaceName", workspaceName)
      form.set("roomName", roomName)
      form.set("timezone", timezone)
      const result = await setupWorkspaceAction(null, form)
      if (!result.ok) {
        setError(result.error ?? "Could not create the workspace")
        return
      }
      const slug = typeof result.data?.orgSlug === "string" ? result.data.orgSlug : ""
      const roomId = typeof result.data?.roomId === "string" ? result.data.roomId : ""
      if (!slug || !roomId) {
        setError("The workspace was created but could not be opened. Reload to continue.")
        return
      }
      setWorkspace({ slug, roomId })
      setStep(1)
    })
  }

  function connectModel() {
    if (!workspace) return
    setError(null)
    if (connectedKeyId) {
      setStep(2)
      return
    }
    startTransition(async () => {
      setStatus("Saving your key…")
      const form = new FormData()
      form.set("orgSlug", workspace.slug)
      form.set("provider", provider)
      form.set("label", `${PROVIDER_LABELS[provider] ?? provider} key`)
      form.set("apiKey", apiKey)
      form.set("baseUrl", baseUrl)
      const saved = await saveProviderKey(null, form)
      const keyId = typeof saved.data?.keyId === "string" ? saved.data.keyId : null
      if (!saved.ok || !keyId) {
        setStatus(null)
        setError(saved.error ?? "Could not save the key")
        return
      }
      setStatus("Testing it with the model…")
      const tested = await testProviderKey(workspace.slug, keyId, model)
      setStatus(null)
      if (!tested.ok) {
        // A key that does not work should not linger and get picked by mistake.
        await deleteProviderKey({ orgSlug: workspace.slug, keyId })
        setError(`That did not work: ${tested.error ?? "the provider rejected the request"}`)
        return
      }
      setConnectedKeyId(keyId)
      setApiKey("")
      setStep(2)
    })
  }

  function createFirstAgent() {
    if (!workspace) return
    setError(null)
    startTransition(async () => {
      let agentId = createdAgentId
      if (!agentId) {
        const form = new FormData()
        form.set("orgSlug", workspace.slug)
        form.set("kind", "llm")
        form.set("displayName", agentName)
        form.set("handle", handle)
        form.set("systemPrompt", agentPrompt)
        form.set("params", "{}")
        if (connectedKeyId) {
          form.set("providerKeyId", connectedKeyId)
          form.set("model", model)
        }
        const created = await createAgent(null, form)
        agentId = typeof created.data?.agentId === "string" ? created.data.agentId : null
        if (!created.ok || !agentId) {
          setError(created.error ?? "Could not create the agent")
          return
        }
        setCreatedAgentId(agentId)
      }
      const link = new FormData()
      link.set("orgSlug", workspace.slug)
      link.set("roomId", workspace.roomId)
      link.set("agentId", agentId)
      const added = await addAgentToRoom(null, link)
      if (!added.ok && !added.error?.includes("already in this room")) {
        setError(added.error ?? "Could not add the agent to the room")
        return
      }
      await finish()
    })
  }

  async function finish() {
    if (!workspace) return
    const result = await finishOnboardingAction(workspace.slug, workspace.roomId)
    if (!result.ok) {
      setError(result.error ?? "Could not open the room")
      return
    }
    goToRoom(workspace.slug, typeof result.data?.path === "string" ? result.data.path : undefined)
  }

  function skipToRoom() {
    setError(null)
    startTransition(() => finish())
  }

  const canContinue =
    step === 0
      ? Boolean(workspace) || (workspaceName.trim().length >= 2 && roomName.trim().length >= 1)
      : step === 1
        ? Boolean(connectedKeyId) ||
          useServerModel ||
          useMac ||
          (apiKey.trim().length >= 8 && model.trim().length > 0)
        : agentName.trim().length >= 1 && handle.length >= 1

  function next() {
    if (step === 0) createWorkspace()
    else if (step === 1) {
      if (useServerModel || useMac) {
        setError(null)
        setStep(2)
      } else connectModel()
    } else createFirstAgent()
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[19rem_1fr]">
      <aside className="flex flex-col border-b border-line px-6 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))] lg:border-b-0 lg:border-r lg:px-8 lg:py-10">
        <div className="flex items-center gap-2.5">
          <span className="grid h-6 w-6 place-items-center bg-accent font-mono text-[13px] font-medium text-void">
            s
          </span>
          <span className="font-mono text-sm text-text">sayabot</span>
          <span className="ml-auto font-mono text-[11px] text-faint lg:hidden">
            step {step + 1} of {STEP_TITLES.length}
          </span>
        </div>
        <div className="mt-10 hidden lg:block">
          <p className="font-mono text-[11px] text-faint">
            step {step + 1} of {STEP_TITLES.length}
          </p>
          <h2 className="mt-2 text-[17px] font-medium tracking-[-0.01em]">
            {userName ? `Welcome, ${userName}` : "Welcome"}
          </h2>
          <p className="mt-2 max-w-[30ch] text-[12px] leading-relaxed text-muted">
            A couple of minutes from now, an agent will reply to you in your first room.
          </p>
          <div className="mt-8">
            <StepRail step={step} />
          </div>
        </div>
      </aside>

      <main id="main-content" className="flex flex-col px-6 py-8 sm:px-10 lg:px-14 lg:py-12">
        <div className="mx-auto w-full max-w-xl">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-medium tracking-[-0.02em] outline-none sm:text-3xl"
          >
            {STEP_TITLES[step]}
          </h1>

          <div className="mt-7">
            {step === 0 ? (
              <div className="space-y-5">
                <Field label="workspace name" htmlFor="workspace-name" hint="your team or company">
                  <Input
                    id="workspace-name"
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                    maxLength={60}
                    placeholder="Acme design team"
                    disabled={Boolean(workspace)}
                    autoFocus
                  />
                </Field>
                <Field label="first room" htmlFor="room-name" hint="where you and your agents talk">
                  <Input
                    id="room-name"
                    value={roomName}
                    onChange={(event) => setRoomName(event.target.value)}
                    maxLength={60}
                    disabled={Boolean(workspace)}
                  />
                </Field>
                <details className="rounded-sm border border-line bg-panel/50 px-3 py-2">
                  <summary className="cursor-pointer py-1 text-[12px] text-muted hover:text-text">
                    Time zone: {timezone.replaceAll("_", " ")}
                  </summary>
                  <div className="mt-2 pb-1">
                    <Field label="time zone" htmlFor="room-timezone">
                      <Select
                        id="room-timezone"
                        value={timezone}
                        disabled={Boolean(workspace)}
                        onChange={(event) => {
                          timezoneTouched.current = true
                          setTimezone(event.target.value)
                        }}
                      >
                        {timeZones.map((zone) => (
                          <option key={zone} value={zone}>
                            {zone.replaceAll("_", " ")}
                          </option>
                        ))}
                        {timeZones.includes(timezone) ? null : (
                          <option value={timezone}>{timezone}</option>
                        )}
                      </Select>
                    </Field>
                  </div>
                </details>
              </div>
            ) : null}

            {step === 1 ? (
              connectedKeyId ? (
                <InlineAlert tone="success">
                  Connected to {PROVIDER_LABELS[provider] ?? provider} using {model}.
                </InlineAlert>
              ) : (
                <div className="space-y-5">
                  {macApp ? (
                    <div className="space-y-2">
                      <button
                        type="button"
                        aria-pressed={useMac}
                        onClick={() => setUseMac(true)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-sm border p-3.5 text-left transition-colors",
                          useMac
                            ? "border-accent bg-accent/10"
                            : "border-line bg-panel hover:border-line-strong",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                            useMac ? "border-accent" : "border-line-strong",
                          )}
                        >
                          {useMac ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
                        </span>
                        <span>
                          <span className="block text-[13.5px] font-medium text-text">
                            Use {macApp.appName} on {macApp.hostName}
                            <span className="ml-2 font-mono text-[11px] text-accent">
                              no key needed
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">
                            Your agents run on your Mac with the {macApp.appName} you&apos;re
                            already signed in to, on your own subscription.
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={!useMac}
                        onClick={() => setUseMac(false)}
                        className="font-mono text-[12px] text-faint underline-offset-2 hover:text-text hover:underline"
                      >
                        {useMac
                          ? "Use an API key instead"
                          : `Selected: an API key. Back to ${macApp.appName}`}
                      </button>
                    </div>
                  ) : null}
                  {useMac ? null : (
                    <p className="max-w-[52ch] text-[13px] leading-relaxed text-muted">
                      Agents need an AI model to reply. Paste an API key from your provider. It is
                      encrypted, and we test it before moving on.
                    </p>
                  )}
                  {hasServerModel && !useMac ? (
                    <label className="flex items-start gap-2.5 rounded-sm border border-line bg-panel p-3 text-[13px] leading-relaxed text-text">
                      <input
                        type="checkbox"
                        checked={useServerModel}
                        onChange={(event) => setUseServerModel(event.target.checked)}
                        className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
                      />
                      <span>Use this server&apos;s shared model instead of my own key</span>
                    </label>
                  ) : null}
                  {useServerModel || useMac ? null : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="provider" htmlFor="onboarding-provider">
                          <Select
                            id="onboarding-provider"
                            value={provider}
                            onChange={(event) => {
                              setProvider(event.target.value)
                              setModel(defaultModel(event.target.value))
                            }}
                          >
                            {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="model" htmlFor="onboarding-model">
                          <Input
                            id="onboarding-model"
                            list="onboarding-model-options"
                            value={model}
                            onChange={(event) => setModel(event.target.value)}
                            placeholder="Pick or type a model id"
                          />
                          <datalist id="onboarding-model-options">
                            {suggestions.map((option) => (
                              <option key={option} value={option} />
                            ))}
                          </datalist>
                        </Field>
                      </div>
                      <Field label="API key" htmlFor="onboarding-key">
                        <Input
                          id="onboarding-key"
                          type="password"
                          autoComplete="off"
                          value={apiKey}
                          onChange={(event) => setApiKey(event.target.value)}
                          placeholder="Paste your key"
                        />
                      </Field>
                      {provider === "openai-compatible" ? (
                        <Field label="base URL" htmlFor="onboarding-base-url">
                          <Input
                            id="onboarding-base-url"
                            value={baseUrl}
                            onChange={(event) => setBaseUrl(event.target.value)}
                            placeholder="http://localhost:11434/v1"
                          />
                        </Field>
                      ) : null}
                    </>
                  )}
                </div>
              )
            ) : null}

            {step === 2 ? (
              <div className="space-y-5">
                <fieldset>
                  <legend className="mb-1.5 font-mono text-[12px] text-muted">start from</legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {TEMPLATES.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        aria-pressed={template === option.key}
                        onClick={() => {
                          setTemplate(option.key)
                          setAgentName(option.name)
                          setAgentPrompt(option.prompt)
                        }}
                        className={cn(
                          "rounded-sm border px-3 py-3 text-left text-[13px] transition-colors md:py-2.5",
                          template === option.key
                            ? "border-accent bg-raised text-text"
                            : "border-line bg-panel text-muted hover:bg-raised",
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <Field
                  label="name"
                  htmlFor="onboarding-agent-name"
                  hint={handle ? `mention it as @${handle}` : undefined}
                >
                  <Input
                    id="onboarding-agent-name"
                    value={agentName}
                    onChange={(event) => setAgentName(event.target.value)}
                    maxLength={60}
                    disabled={Boolean(createdAgentId)}
                  />
                </Field>
                <Field label="what is it for?" htmlFor="onboarding-agent-prompt">
                  <Textarea
                    id="onboarding-agent-prompt"
                    value={agentPrompt}
                    onChange={(event) => setAgentPrompt(event.target.value)}
                    rows={4}
                    disabled={Boolean(createdAgentId)}
                  />
                </Field>
                <HelpText>
                  Your room also runs two short stand-ups each weekday, at 9:00 and 17:00 in your
                  time zone. Agents in the room reply to them using your API credits. You can change
                  the times in room settings.
                </HelpText>
              </div>
            ) : null}

            {error ? (
              <div className="mt-5">
                <InlineAlert tone="danger">{error}</InlineAlert>
              </div>
            ) : null}
            {status ? (
              <p role="status" className="mt-5 font-mono text-[12px] text-muted">
                {status}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mx-auto mt-auto w-full max-w-xl pt-10">
          <div className="flex flex-wrap items-center gap-3 border-t border-line pb-[env(safe-area-inset-bottom)] pt-5">
            {step > 0 && !(step === 1 && initialWorkspace) ? (
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  setError(null)
                  setStep(step - 1)
                }}
                disabled={pending}
              >
                Back
              </Button>
            ) : null}
            <span className="ml-auto" />
            {step > 0 ? (
              <Button variant="quiet" size="md" onClick={skipToRoom} disabled={pending}>
                Skip for now
              </Button>
            ) : null}
            <Button variant="primary" size="lg" onClick={next} disabled={pending || !canContinue}>
              {pending
                ? (status ?? "Saving…")
                : step === 0
                  ? "Continue"
                  : step === 1
                    ? connectedKeyId || useServerModel || useMac
                      ? "Continue"
                      : "Connect and continue"
                    : "Create agent and open room"}
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
