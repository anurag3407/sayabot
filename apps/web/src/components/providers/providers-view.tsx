"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { ChevronRight, Laptop } from "lucide-react"
import { saveProviderKey } from "@/lib/actions/keys"
import { LOCAL_STATUS_LABEL, type LocalAgentReport, type LocalAgentsResponse } from "@/lib/local-agents-shared"
import { InviteBotDialog } from "@/components/room/invite-bot-dialog"
import { ManageAccountsModal } from "@/components/room/model-picker"
import { ProviderIcon } from "@/components/room/model-picker/provider-icons"
import { DeleteKeyButton, TestKeyButton } from "@/components/settings/key-actions"
import { ActionForm } from "@/components/ui/action-form"
import { Field, Input, Select } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { cn, effectiveProvider } from "@/lib/format"
import type { ProviderKeyView } from "@/lib/types"

interface ProviderInfo {
  id: string
  name: string
  blurb: string
  keyUrl?: string
  needsBaseUrl?: boolean
  placeholder?: string
}

const PROVIDERS: ProviderInfo[] = [
  { id: "anthropic", name: "Anthropic", blurb: "Claude models", keyUrl: "https://console.anthropic.com/settings/keys", placeholder: "sk-ant-…" },
  { id: "openai", name: "OpenAI", blurb: "GPT models", keyUrl: "https://platform.openai.com/api-keys", placeholder: "sk-…" },
  { id: "google", name: "Google", blurb: "Gemini models", keyUrl: "https://aistudio.google.com/apikey", placeholder: "AIza…" },
  { id: "openrouter", name: "OpenRouter", blurb: "400+ models, many free", keyUrl: "https://openrouter.ai/keys", placeholder: "sk-or-…" },
  { id: "groq", name: "Groq", blurb: "Very fast open models", keyUrl: "https://console.groq.com/keys", placeholder: "gsk_…" },
  { id: "cerebras", name: "Cerebras", blurb: "Very fast open models", keyUrl: "https://cloud.cerebras.ai", placeholder: "csk-…" },
  { id: "copilot", name: "GitHub Copilot", blurb: "Models in your Copilot plan" },
  { id: "cloudflare", name: "Cloudflare", blurb: "Workers AI and AI Gateway", needsBaseUrl: true },
  {
    id: "openai-compatible",
    name: "Your own server",
    blurb: "Ollama, LM Studio, vLLM or any OpenAI-compatible API",
    needsBaseUrl: true,
    placeholder: "Leave empty if it has none",
  },
]

const STATUS_TONE: Record<string, string> = {
  ready: "bg-ok/10 text-ok",
  signed_out: "bg-warn/10 text-warn",
  installed: "bg-raised text-muted",
  not_installed: "bg-raised text-faint",
}

function Tile({ icon }: { icon: string }) {
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-raised text-text">
      <ProviderIcon provider={icon} size={20} />
    </span>
  )
}

function LocalAgents({ orgSlug, rooms }: { orgSlug: string; rooms: { id: string; name: string }[] }) {
  const [state, setState] = useState<LocalAgentsResponse | null>(null)
  const [inviting, setInviting] = useState<LocalAgentReport | null>(null)
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "")
  const room = rooms.find((r) => r.id === roomId)

  useEffect(() => {
    let cancelled = false
    fetch("/api/providers/local", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<LocalAgentsResponse>) : { available: false, agents: [] }))
      .then((data) => !cancelled && setState(data))
      .catch(() => !cancelled && setState({ available: false, agents: [] }))
    return () => {
      cancelled = true
    }
  }, [])

  if (!state) {
    return <p className="rounded-xl border border-line bg-panel p-4 text-[13px] text-faint">Looking for agent apps on this computer…</p>
  }
  if (!state.available) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-line bg-panel p-4">
        <Laptop className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
        <p className="text-[13px] leading-relaxed text-muted">
          Get the{" "}
          <Link href="/download" className="text-text underline-offset-2 hover:underline">
            Sayabot Mac app
          </Link>{" "}
          and sign in. Apps already signed in on your Mac, like Claude Code, Codex and Gemini CLI, show up here by
          themselves and answer on your own subscription, with no API key.
        </p>
      </div>
    )
  }

  const macHeader =
    state.source === "mac" ? (
      <p className="mb-2 flex flex-wrap items-center gap-x-1.5 text-[12px] text-faint">
        <Laptop className="h-3.5 w-3.5" />
        <span>
          Found by Sayabot on <span className="text-muted">{state.hostName}</span>
          {state.lastSeenAt ? ` · checked ${seenAgo(state.lastSeenAt)}` : ""}
        </span>
        {isStale(state.lastSeenAt) ? (
          <span className="text-warn">· open the Mac app to refresh this list</span>
        ) : null}
      </p>
    ) : null

  if (!state.agents.length) {
    return (
      <>
        {macHeader}
        <p className="rounded-xl border border-line bg-panel p-4 text-[13px] leading-relaxed text-muted">
          No signed-in agent apps found{state.source === "mac" ? ` on ${state.hostName}` : ""}. Open Claude Code, Codex or
          Gemini CLI in a terminal once and sign in; it shows up here within a minute.
        </p>
      </>
    )
  }

  const sorted = [...state.agents].sort((a, b) => order(a.status) - order(b.status))
  return (
    <>
      {macHeader}
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
        {sorted.map((agent) => (
          <li key={agent.id} className="flex items-center gap-3 px-4 py-3">
            <Tile icon={agent.icon} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-text">{agent.name}</p>
              <p className="text-[12px] text-faint">
                {agent.status === "ready"
                  ? [
                      agent.account ? agent.account : "Signed in",
                      agent.version,
                      agent.models?.length ? `${agent.models.length} models` : null,
                      "your own subscription",
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : agent.status === "signed_out"
                    ? `Installed${agent.version ? ` · ${agent.version}` : ""}. Open it once and sign in.`
                    : agent.status === "installed"
                      ? `Installed${agent.version ? ` · ${agent.version}` : ""}`
                      : "Not on this computer"}
              </p>
            </div>
            <span className={cn("hidden rounded-full px-2.5 py-1 text-[12px] sm:inline", STATUS_TONE[agent.status])}>
              {LOCAL_STATUS_LABEL[agent.status]}
            </span>
            {agent.status === "ready" || agent.status === "installed" ? (
              <Button size="sm" variant="secondary" disabled={!rooms.length} onClick={() => setInviting(agent)}>
                Add to a room
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {inviting && rooms.length > 1 ? (
        <div className="mt-2 flex items-center gap-2 text-[13px] text-muted">
          <span>Room for {inviting.name}:</span>
          <Select value={roomId} onChange={(event) => setRoomId(event.target.value)} className="max-w-xs" aria-label="Room">
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                #{r.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {inviting && room ? (
        <InviteBotDialog
          key={`${inviting.id}-${room.id}`}
          orgSlug={orgSlug}
          roomId={room.id}
          roomName={room.name}
          open
          onOpenChange={(value) => !value && setInviting(null)}
          hideTrigger
          initialApp={inviting.inviteApp}
          initialName={inviting.name}
        />
      ) : null}
    </>
  )
}

function seenAgo(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)} days ago`
}

/** The Mac app checks in every few seconds; ten quiet minutes means it isn't running. */
function isStale(iso: string | null | undefined): boolean {
  if (!iso) return true
  return Date.now() - Date.parse(iso) > 10 * 60_000
}

function order(status: string): number {
  return status === "ready" ? 0 : status === "signed_out" ? 1 : status === "installed" ? 2 : 3
}

function ProviderRow({
  info,
  orgSlug,
  keys,
  agentCounts,
}: {
  info: ProviderInfo
  orgSlug: string
  keys: ProviderKeyView[]
  agentCounts: Record<string, number>
}) {
  const [open, setOpen] = useState(false)
  const used = keys.reduce((n, k) => n + (agentCounts[k.id] ?? 0), 0)
  const connected = keys.length > 0
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised"
      >
        <Tile icon={info.id} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-text">{info.name}</p>
          <p className="truncate text-[12px] text-faint">
            {connected
              ? `${keys.length === 1 ? keys[0]!.label : `${keys.length} accounts`} · ${used ? `${used} ${used === 1 ? "agent" : "agents"}` : "no agents yet"}`
              : info.blurb}
          </p>
        </div>
        {connected ? <span className="rounded-full bg-ok/10 px-2.5 py-1 text-[12px] text-ok">Connected</span> : null}
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-faint transition-transform", open && "rotate-90")} />
      </button>
      {open ? (
        <div className="space-y-4 border-t border-line bg-ink px-4 py-4">
          {keys.length ? (
            <ul className="space-y-2">
              {keys.map((key) => (
                <li key={key.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-text">{key.label}</p>
                    <p className="text-[11px] text-faint">
                      •••• {key.last4}
                      {key.baseUrl ? ` · ${key.baseUrl}` : ""} · {agentCounts[key.id] ?? 0} agents
                    </p>
                  </div>
                  <TestKeyButton orgSlug={orgSlug} keyId={key.id} provider={effectiveProvider(key.provider, key.baseUrl)} />
                  <DeleteKeyButton orgSlug={orgSlug} keyId={key.id} />
                </li>
              ))}
            </ul>
          ) : null}
          <ActionForm action={saveProviderKey} submitLabel={keys.length ? "Add another account" : `Connect ${info.name}`} resetOnSuccess>
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="provider" value={info.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name it" htmlFor={`label-${info.id}`}>
                <Input id={`label-${info.id}`} name="label" required maxLength={60} defaultValue={keys.length ? "" : `My ${info.name}`} />
              </Field>
              <Field label="API key" htmlFor={`key-${info.id}`} hint="saved encrypted, never shown again">
                <Input
                  id={`key-${info.id}`}
                  name="apiKey"
                  type="password"
                  autoComplete="off"
                  required={info.id !== "openai-compatible"}
                  placeholder={info.placeholder ?? "Paste it here"}
                />
              </Field>
            </div>
            {info.needsBaseUrl ? (
              <Field label="Server address" htmlFor={`base-${info.id}`}>
                <Input id={`base-${info.id}`} name="baseUrl" placeholder="http://localhost:11434/v1" required={info.id === "openai-compatible"} />
              </Field>
            ) : null}
            {info.keyUrl ? (
              <a href={info.keyUrl} target="_blank" rel="noreferrer" className="text-[12px] text-muted hover:text-text hover:underline">
                Get a {info.name} key ↗
              </a>
            ) : null}
          </ActionForm>
        </div>
      ) : null}
    </li>
  )
}

export function ProvidersView({
  orgSlug,
  keys,
  agentCounts,
  rooms,
}: {
  orgSlug: string
  keys: ProviderKeyView[]
  agentCounts: Record<string, number>
  rooms: { id: string; name: string }[]
}) {
  const [accountsOpen, setAccountsOpen] = useState(false)
  const router = useRouter()
  const keysFor = (id: string) => keys.filter((k) => effectiveProvider(k.provider, k.baseUrl) === id)
  const connected = PROVIDERS.filter((p) => keysFor(p.id).length > 0)
  const others = PROVIDERS.filter((p) => keysFor(p.id).length === 0)

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-[18px] font-semibold text-text">AI providers</h2>
        <p className="mt-1 text-[13px] text-muted">
          What your agents think with. Use agent apps already signed in on this computer, or connect an account.
        </p>
      </div>

      <section aria-labelledby="local-heading">
        <h3 id="local-heading" className="mb-2 text-[14px] font-medium text-text">
          On this computer
        </h3>
        <LocalAgents orgSlug={orgSlug} rooms={rooms} />
      </section>

      <section aria-labelledby="subs-heading">
        <h3 id="subs-heading" className="mb-2 text-[14px] font-medium text-text">
          Sign in with a plan you pay for
        </h3>
        <button
          type="button"
          onClick={() => setAccountsOpen(true)}
          className="flex w-full items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-left hover:bg-raised"
        >
          <span className="flex -space-x-2">
            <Tile icon="openai" />
            <Tile icon="copilot" />
            <Tile icon="openrouter" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium text-text">ChatGPT, GitHub Copilot, OpenRouter</p>
            <p className="text-[12px] text-faint">Sign in once and use the models in your plan</p>
          </div>
          <ChevronRight className="h-4 w-4 text-faint" />
        </button>
      </section>

      {connected.length ? (
        <section aria-labelledby="connected-heading">
          <h3 id="connected-heading" className="mb-2 text-[14px] font-medium text-text">
            Connected
          </h3>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {connected.map((info) => (
              <ProviderRow key={info.id} info={info} orgSlug={orgSlug} keys={keysFor(info.id)} agentCounts={agentCounts} />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="other-heading">
        <h3 id="other-heading" className="mb-2 text-[14px] font-medium text-text">
          {connected.length ? "Other providers" : "Connect with an API key"}
        </h3>
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
          {others.map((info) => (
            <ProviderRow key={info.id} info={info} orgSlug={orgSlug} keys={[]} agentCounts={agentCounts} />
          ))}
        </ul>
      </section>

      <ManageAccountsModal
        orgSlug={orgSlug}
        isOpen={accountsOpen}
        onClose={() => {
          setAccountsOpen(false)
          router.refresh()
        }}
      />
    </div>
  )
}
