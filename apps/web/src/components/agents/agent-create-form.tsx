"use client"

import Link from "next/link"
import { useActionState, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createAgent, testAgent } from "@/lib/actions/agents"
import { Button } from "@/components/ui/button"
import { Field, HelpText, Input, Select, Textarea } from "@/components/ui/field"
import { InlineAlert } from "@/components/ui/empty"
import { CopyButton } from "@/components/copy-button"
import { showToast } from "@/components/ui/toast"
import { handleFromName } from "@/lib/agent-handle"
import { defaultModel, MODEL_SUGGESTIONS } from "@/lib/model-options"
import type { ActionResult, McpServerView, ProviderKeyView } from "@/lib/types"

export function AgentCreateForm({
  orgSlug,
  keys,
  mcpServers,
  rooms,
  initialRoomId = "",
  hasServerModel,
}: {
  orgSlug: string
  keys: ProviderKeyView[]
  mcpServers: McpServerView[]
  rooms: { id: string; name: string }[]
  initialRoomId?: string
  hasServerModel: boolean
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createAgent, null)
  const [kind, setKind] = useState("llm")
  const [displayName, setDisplayName] = useState("")
  const [handle, setHandle] = useState("")
  const [handleEdited, setHandleEdited] = useState(false)
  const [keyId, setKeyId] = useState(keys[0]?.id ?? "")
  const [model, setModel] = useState(keys[0] ? defaultModel(keys[0].provider) : "")
  const [testResult, setTestResult] = useState<ActionResult | null>(null)
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)

  const provider = keys.find((key) => key.id === keyId)?.provider ?? null
  const suggestions = useMemo(
    () => (provider ? (MODEL_SUGGESTIONS[provider] ?? []) : []),
    [provider],
  )
  const noModelAvailable = kind === "llm" && keys.length === 0 && !hasServerModel

  useEffect(() => {
    if (!state?.ok) return
    formRef.current?.reset()
    setKind("llm")
    setDisplayName("")
    setHandle("")
    setHandleEdited(false)
    if (state.message) showToast({ message: state.message, tone: "success" })
    router.refresh()
    const agentId = typeof state.data?.agentId === "string" ? state.data.agentId : null
    if (agentId && state.data?.kind === "llm") {
      // Finding out now beats a failed reply in the room later.
      setTestResult(null)
      void testAgent(orgSlug, agentId).then(setTestResult)
    }
  }, [state, router, orgSlug])

  const webhookSecret =
    state?.ok && typeof state.data?.webhookSecret === "string" ? state.data.webhookSecret : null

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="orgSlug" value={orgSlug} />
      {state && !state.ok ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      {testResult ? (
        <InlineAlert tone={testResult.ok ? "success" : "danger"}>
          {testResult.ok
            ? `Test passed. ${testResult.message ?? ""}`
            : `The agent was created, but its test failed. ${testResult.error ?? ""} Fix it with “Edit agent” below.`}
        </InlineAlert>
      ) : null}
      {webhookSecret ? (
        <div className="rounded-sm border border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] bg-accent-soft p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[11px] text-accent">
              webhook secret, shown once. Store it with your bot.
            </p>
            <CopyButton text={webhookSecret} label="copy secret" />
          </div>
          <code className="mt-1 block break-all font-mono text-[12px] text-text">
            {webhookSecret}
          </code>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="name" htmlFor="agent-display">
          <Input
            id="agent-display"
            name="displayName"
            required
            maxLength={60}
            placeholder="Reviewer"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value)
              if (!handleEdited) setHandle(handleFromName(event.target.value))
            }}
          />
        </Field>
        <Field label="@handle" htmlFor="agent-handle" hint="how people mention it">
          <Input
            id="agent-handle"
            name="handle"
            required
            placeholder="reviewer"
            value={handle}
            onChange={(event) => {
              setHandle(event.target.value.toLowerCase())
              setHandleEdited(true)
            }}
          />
        </Field>
      </div>

      <Field label="type" htmlFor="agent-kind">
        <Select
          id="agent-kind"
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="llm">AI model (uses an API key)</option>
          <option value="external">
            Bring your own bot (ChatGPT, Claude, Gemini, Cursor via MCP, or a webhook)
          </option>
        </Select>
      </Field>

      {noModelAvailable ? (
        <InlineAlert tone="warning">
          Add an API key first, so this agent has a model to use.{" "}
          <Link href={`/${orgSlug}/settings/keys`} className="underline underline-offset-2">
            Add a provider key
          </Link>
        </InlineAlert>
      ) : null}

      {kind === "llm" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="API key" htmlFor="agent-key">
              <Select
                id="agent-key"
                name="providerKeyId"
                value={keyId}
                onChange={(event) => {
                  const next = event.target.value
                  setKeyId(next)
                  const nextProvider = keys.find((key) => key.id === next)?.provider
                  setModel(nextProvider ? defaultModel(nextProvider) : "")
                }}
              >
                {keys.map((key) => (
                  <option key={key.id} value={key.id}>
                    {key.label} · {key.provider} · •••• {key.last4}
                  </option>
                ))}
                {hasServerModel ? <option value="">Server default model</option> : null}
              </Select>
            </Field>
            <Field label="model" htmlFor="agent-model" hint={keyId ? "required" : "optional"}>
              <Input
                id="agent-model"
                name="model"
                list="agent-model-options"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="Pick or type a model id"
              />
              <datalist id="agent-model-options">
                {suggestions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </Field>
          </div>
          <Field label="what is this agent for?" htmlFor="agent-prompt" hint="its instructions">
            <Textarea
              id="agent-prompt"
              name="systemPrompt"
              className="min-h-28"
              placeholder="You review proposals for missing migrations and rollback steps."
            />
          </Field>
        </>
      ) : (
        <Field
          label="webhook url"
          htmlFor="agent-webhook"
          hint="optional. Leave empty to connect from ChatGPT, Claude, Gemini or Cursor over MCP (Settings → Bots)"
        >
          <Input
            id="agent-webhook"
            name="webhookUrl"
            placeholder="https://bot.example.com/hooks/sayabot"
          />
        </Field>
      )}

      {rooms.length ? (
        <Field label="add to room" htmlFor="agent-room" hint="optional">
          <Select id="agent-room" name="roomId" defaultValue={initialRoomId}>
            <option value="">Not yet</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <details className="rounded-sm border border-line bg-panel/50 px-3 py-2">
        <summary className="cursor-pointer py-1 font-mono text-[12px] text-muted hover:text-text">
          Advanced
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="model parameters (JSON)" htmlFor="agent-params" hint="optional">
            <Textarea
              id="agent-params"
              name="params"
              className="min-h-20 font-mono text-[12px]"
              defaultValue="{}"
            />
          </Field>
          <fieldset>
            <legend className="mb-1.5 font-mono text-[12px] text-muted">
              MCP servers it can use
            </legend>
            {mcpServers.length === 0 ? (
              <p className="text-[12px] text-faint">No MCP servers added yet.</p>
            ) : (
              <div className="space-y-1 border border-line bg-panel p-2">
                {mcpServers.map((server) => (
                  <label
                    key={server.id}
                    className="flex items-center justify-between gap-2 text-[12px] text-muted"
                  >
                    <span>
                      {server.name}
                      {server.enabled ? "" : " (disabled)"}
                    </span>
                    <input
                      type="checkbox"
                      name="toolIds"
                      value={server.id}
                      className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                    />
                  </label>
                ))}
              </div>
            )}
            <HelpText>Leave all unchecked to allow every enabled server.</HelpText>
          </fieldset>
        </div>
      </details>

      <Button type="submit" size="sm" variant="primary" disabled={pending || noModelAvailable}>
        {pending ? "Creating…" : "Create agent"}
      </Button>
    </form>
  )
}
