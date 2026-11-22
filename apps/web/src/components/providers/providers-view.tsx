"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useActionState, useEffect, useRef, useState } from "react"
import { Blocks, ChevronRight, Laptop, Loader2, Plug, RefreshCw, Wrench } from "lucide-react"
import { saveProviderKey } from "@/lib/actions/keys"
import { ACCOUNT_PROVIDERS } from "@/lib/ai-accounts"
import { MAC_ACCESS_LABEL } from "@sayabot/core"
import {
  LOCAL_STATUS_LABEL,
  type LocalAgentReport,
  type LocalAgentsResponse,
} from "@/lib/local-agents-shared"
import { InviteBotDialog } from "@/components/room/invite-bot-dialog"
import { ManageAccountsModal } from "@/components/room/model-picker"
import { ProviderIcon } from "@/components/room/model-picker/provider-icons"
import { DeleteKeyButton, TestKeyButton } from "@/components/settings/key-actions"
import { Input, Select } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { InlineAlert } from "@/components/ui/empty"
import { showToast } from "@/components/ui/toast"
import { cn, effectiveProvider } from "@/lib/format"
import {
  cancelAgentSignIn,
  canSignInAgents,
  finishAgentSignIn,
  startAgentSignIn,
} from "@/lib/desktop-bridge"
import type { ActionResult, ProviderKeyView } from "@/lib/types"
import { ProviderCard, ProviderList, ProviderSection, StatusPill } from "./provider-card"

interface ProviderInfo {
  id: string
  name: string
  blurb: string
  keyUrl?: string
  needsBaseUrl?: boolean
  placeholder?: string
}

/** Every provider that takes a key or an address, from the one list the accounts dialog uses too. */
const PROVIDERS: ProviderInfo[] = ACCOUNT_PROVIDERS.filter(
  (spec) => spec.kind === "key" || spec.kind === "openrouter" || spec.kind === "custom",
).map((spec) => ({
  id: spec.id,
  name: spec.name,
  blurb: spec.blurb,
  keyUrl: spec.keyUrl,
  needsBaseUrl: spec.kind === "custom",
  placeholder: spec.id === "openai-compatible" ? "Key, if your server needs one" : spec.keyHint,
}))

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

function LocalAgents({
  orgSlug,
  rooms,
  refreshKey,
}: {
  orgSlug: string
  rooms: { id: string; name: string }[]
  /** Bumped by "Check again" to look for agent apps once more. */
  refreshKey: number
}) {
  const [state, setState] = useState<LocalAgentsResponse | null>(null)
  const [inviting, setInviting] = useState<LocalAgentReport | null>(null)
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "")
  const room = rooms.find((r) => r.id === roomId)

  useEffect(() => {
    let cancelled = false
    setState(null)
    fetch("/api/providers/local", { cache: "no-store" })
      .then((res) =>
        res.ok ? (res.json() as Promise<LocalAgentsResponse>) : { available: false, agents: [] },
      )
      .then((data) => !cancelled && setState(data))
      .catch(() => !cancelled && setState({ available: false, agents: [] }))
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  if (!state) {
    return (
      <p className="rounded-xl border border-line bg-panel p-4 text-[13px] text-faint">
        Looking for agent apps on this computer…
      </p>
    )
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
          and sign in. Apps already signed in on your Mac, like Claude Code, Codex and Gemini CLI,
          show up here by themselves and answer on your own subscription, with no API key.
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
          No signed-in agent apps found{state.source === "mac" ? ` on ${state.hostName}` : ""}. Open
          Claude Code, Codex or Gemini CLI in a terminal once and sign in; it shows up here within a
          minute.
        </p>
      </>
    )
  }

  const sorted = state.agents
    .filter((agent) => agent.status !== "not_installed")
    .sort((a, b) => order(a.status) - order(b.status))
  const more = state.agents.filter((agent) => agent.status === "not_installed")
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
                    ? `Installed${agent.version ? ` · ${agent.version}` : ""}. ${agent.setupHint ?? "Open it once and sign in."}`
                    : agent.status === "installed"
                      ? `Installed${agent.version ? ` · ${agent.version}` : ""}`
                      : "Not on this computer"}
              </p>
              {agent.access ? (
                <p className="text-[11.5px] text-faint/80">{MAC_ACCESS_LABEL[agent.access]}</p>
              ) : null}
              {agent.policyNote ? (
                <p className="mt-0.5 text-[11.5px] leading-snug text-warn">{agent.policyNote}</p>
              ) : null}
              {agent.macSignIn && agent.status === "signed_out" && state.source === "mac" ? (
                <MacSignIn appName={agent.name} appId={agent.id} />
              ) : null}
            </div>
            <span
              className={cn(
                "hidden rounded-full px-2.5 py-1 text-[12px] sm:inline",
                STATUS_TONE[agent.status],
              )}
            >
              {LOCAL_STATUS_LABEL[agent.status]}
            </span>
            {agent.status === "ready" || agent.status === "installed" ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={!rooms.length}
                onClick={() => setInviting(agent)}
              >
                Add to a room
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {more.length ? <MoreProviders agents={more} /> : null}
      {inviting && rooms.length > 1 ? (
        <div className="mt-2 flex items-center gap-2 text-[13px] text-muted">
          <span>Room for {inviting.name}:</span>
          <Select
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
            className="max-w-xs"
            aria-label="Room"
          >
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

/**
 * Signs an app in on this Mac through its own login (Antigravity: Google). The Mac app opens the
 * Google page; the person pastes the code it shows back here. Only inside Sayabot for Mac.
 */
function MacSignIn({ appId, appName }: { appId: string; appName: string }) {
  const [available, setAvailable] = useState(false)
  const [phase, setPhase] = useState<"idle" | "starting" | "code" | "finishing" | "done">("idle")
  const [url, setUrl] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setAvailable(canSignInAgents())
    return () => cancelAgentSignIn()
  }, [])

  if (!available) return null
  if (phase === "done") {
    return (
      <p className="mt-1 text-[12px] text-ok">
        Signed in. {appName} shows as ready within a minute.
      </p>
    )
  }

  const start = async () => {
    setError(null)
    setPhase("starting")
    const started = await startAgentSignIn(appId)
    if (!started.ok) {
      setError(started.error)
      setPhase("idle")
      return
    }
    setUrl(started.url)
    setPhase("code")
  }

  const finish = async () => {
    setError(null)
    setPhase("finishing")
    const finished = await finishAgentSignIn(code)
    if (finished.ok) {
      setPhase("done")
      return
    }
    setError(finished.error)
    // A failed code ends the login; start again for a new link.
    setPhase("idle")
    setCode("")
    setUrl(null)
  }

  return (
    <div className="mt-2 space-y-1.5">
      {phase === "idle" || phase === "starting" ? (
        <Button size="sm" variant="secondary" disabled={phase === "starting"} onClick={start}>
          {phase === "starting" ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Sign in with Google
        </Button>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void finish()
          }}
        >
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Paste the code from the Google page"
            aria-label={`${appName} sign-in code`}
            className="h-8 min-w-0 flex-1 text-[12.5px]"
            autoFocus
          />
          <Button size="sm" type="submit" disabled={!code.trim() || phase === "finishing"}>
            {phase === "finishing" ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Finish
          </Button>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-muted underline underline-offset-2"
            >
              Open the Google page again
            </a>
          ) : null}
        </form>
      )}
      {error ? <p className="text-[12px] text-danger">{error}</p> : null}
    </div>
  )
}

/** Apps Sayabot can run that aren't on this computer yet: what each needs, and how to install it. */
function MoreProviders({ agents }: { agents: LocalAgentReport[] }) {
  return (
    <details className="group mt-2 rounded-xl border border-line bg-panel">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] text-muted hover:text-text">
        <span>More providers</span>
        <span className="text-faint">
          {agents.length}{" "}
          <span className="inline-block transition-transform group-open:rotate-90">›</span>
        </span>
      </summary>
      <ul className="divide-y divide-line border-t border-line">
        {agents.map((agent) => (
          <li key={agent.id} className="flex items-start gap-3 px-4 py-3">
            <Tile icon={agent.icon} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-text">{agent.name}</p>
              {agent.access ? (
                <p className="text-[12px] text-faint">{MAC_ACCESS_LABEL[agent.access]}</p>
              ) : null}
              {agent.install ? (
                <code className="mt-1 block truncate rounded-md bg-raised px-2 py-1 font-mono text-[11.5px] text-muted">
                  {agent.install}
                </code>
              ) : null}
              {agent.setupHint ? (
                <p className="mt-1 text-[11.5px] text-faint">Then: {agent.setupHint}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </details>
  )
}

function order(status: string): number {
  return status === "ready" ? 0 : status === "signed_out" ? 1 : status === "installed" ? 2 : 3
}

function nextLabel(info: ProviderInfo, keys: ProviderKeyView[]): string {
  return keys.length ? `${info.name} ${keys.length + 1}` : `My ${info.name}`
}

/** One API key provider: paste a key, get one, save. Saved keys list below with test and remove. */
function ApiKeyRow({
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
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    saveProviderKey,
    null,
  )
  const ref = useRef<HTMLFormElement>(null)
  const router = useRouter()
  useEffect(() => {
    if (!state?.ok) return
    ref.current?.reset()
    showToast({ tone: "success", message: state.message ?? "Key saved" })
    router.refresh()
  }, [state, router])
  const used = keys.reduce((n, k) => n + (agentCounts[k.id] ?? 0), 0)
  const status = keys.length ? (
    <StatusPill tone="ok">
      {keys.length === 1 ? "Ready" : `${keys.length} keys`} ·{" "}
      {used ? `${used} ${used === 1 ? "bot" : "bots"}` : "no bots yet"}
    </StatusPill>
  ) : (
    <StatusPill tone="idle">Not set up</StatusPill>
  )
  const isServer = Boolean(info.needsBaseUrl)
  return (
    <ProviderCard
      icon={<ProviderIcon provider={info.id} size={18} />}
      title={isServer ? info.name : `${info.name} API key`}
      subtitle={info.blurb}
      status={status}
    >
      {keys.length ? (
        <ul className="mb-3 space-y-2">
          {keys.map((key) => (
            <li
              key={key.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-ink px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-text">{key.label}</p>
                <p className="truncate text-[11px] text-faint">
                  {key.last4 ? `•••• ${key.last4}` : "no key"}
                  {key.baseUrl ? ` · ${key.baseUrl}` : ""} · {agentCounts[key.id] ?? 0} bots
                </p>
              </div>
              <TestKeyButton
                orgSlug={orgSlug}
                keyId={key.id}
                provider={effectiveProvider(key.provider, key.baseUrl)}
              />
              <DeleteKeyButton orgSlug={orgSlug} keyId={key.id} />
            </li>
          ))}
        </ul>
      ) : null}
      <form ref={ref} action={formAction} className="space-y-2">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="provider" value={info.id} />
        <input type="hidden" name="label" value={nextLabel(info, keys)} />
        {isServer ? (
          <Input
            name="baseUrl"
            placeholder={
              info.id === "cloudflare"
                ? "https://api.cloudflare.com/client/v4/accounts/<id>/ai/v1"
                : "http://localhost:1234/v1"
            }
            required={info.id === "openai-compatible"}
            aria-label={`${info.name} address`}
            spellCheck={false}
          />
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            name="apiKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required={info.id !== "openai-compatible"}
            placeholder={info.placeholder ?? (keys.length ? "Paste another key" : "Paste your key")}
            aria-label={`${info.name} key`}
            className="sm:flex-1"
          />
          <div className="flex items-center gap-2">
            {info.keyUrl ? (
              <a
                href={info.keyUrl}
                target="_blank"
                rel="noreferrer"
                className="px-1 text-[12.5px] text-muted hover:text-text hover:underline"
              >
                Get a key ↗
              </a>
            ) : null}
            <Button size="sm" variant="primary" type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
        {state && !state.ok ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      </form>
    </ProviderCard>
  )
}

const SECTIONS = [
  ["providers", "Providers"],
  ["ai-providers", "AI providers"],
  ["model-servers", "Your own model servers"],
  ["apps", "Apps and tools"],
] as const

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
  computers?: unknown
}) {
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const router = useRouter()
  const keysFor = (id: string) =>
    keys.filter((k) => effectiveProvider(k.provider, k.baseUrl) === id)
  const apiProviders = PROVIDERS.filter((p) => !p.needsBaseUrl)
  const servers = PROVIDERS.filter((p) => p.needsBaseUrl)
  // Ready first, the way people scan for what is already working.
  const ordered = [...apiProviders].sort(
    (a, b) => Number(keysFor(b.id).length > 0) - Number(keysFor(a.id).length > 0),
  )

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-[18px] font-semibold text-text">AI providers</h2>
        <p className="mt-1 text-[13px] text-muted">
          What your bots think with, and how to connect your own models.
        </p>
        <nav aria-label="Sections" className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="shrink-0 rounded-full border border-line px-3 py-1 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-text"
            >
              {label}
            </a>
          ))}
        </nav>
      </div>

      <ProviderSection
        id="providers"
        title="Providers"
        description="Agent apps signed in on this computer answer on your own subscription, with no API key."
        action={
          <Button size="sm" variant="ghost" onClick={() => setRefreshKey((n) => n + 1)}>
            <RefreshCw className="h-3.5 w-3.5" />
            Check again
          </Button>
        }
      >
        <LocalAgents orgSlug={orgSlug} rooms={rooms} refreshKey={refreshKey} />
        <button
          type="button"
          onClick={() => setAccountsOpen(true)}
          className="mt-2 flex w-full items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-left hover:bg-raised"
        >
          <span className="flex -space-x-2">
            <Tile icon="openai" />
            <Tile icon="copilot" />
            <Tile icon="openrouter" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium text-text">Sign in with a plan you pay for</p>
            <p className="text-[12px] text-faint">
              ChatGPT, GitHub Copilot, OpenRouter: sign in once and use the models in your plan
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-faint" />
        </button>
      </ProviderSection>

      <ProviderSection
        id="ai-providers"
        title="AI providers"
        description="Keys for the models your bots run on."
      >
        <ProviderList>
          {ordered.map((info) => (
            <ApiKeyRow
              key={info.id}
              info={info}
              orgSlug={orgSlug}
              keys={keysFor(info.id)}
              agentCounts={agentCounts}
            />
          ))}
        </ProviderList>
      </ProviderSection>

      <ProviderSection
        id="model-servers"
        title="Your own model servers"
        description="LM Studio, Ollama, vLLM and servers that speak the OpenAI API."
      >
        <ProviderList>
          {servers.map((info) => (
            <ApiKeyRow
              key={info.id}
              info={info}
              orgSlug={orgSlug}
              keys={keysFor(info.id)}
              agentCounts={agentCounts}
            />
          ))}
        </ProviderList>
      </ProviderSection>

      <ProviderSection id="apps" title="Apps and tools" description="Connected apps and research.">
        <ProviderList>
          {(
            [
              ["connectors", "Connected apps", "Gmail, Slack, GitHub, Drive and more", Plug],
              [
                "tools",
                "Tools and MCP servers",
                "Web search, MCP servers and built-in tools",
                Wrench,
              ],
              ["bots", "Your own bots", "Bring a bot you run yourself into rooms", Blocks],
            ] as const
          ).map(([segment, title, subtitle, Icon]) => (
            <ProviderCard
              key={segment}
              icon={<Icon className="h-4 w-4" />}
              title={title}
              subtitle={subtitle}
              status={
                <Link
                  href={`/${orgSlug}/settings/${segment}`}
                  className="text-[12.5px] font-medium text-accent hover:underline"
                >
                  Open →
                </Link>
              }
            />
          ))}
        </ProviderList>
      </ProviderSection>

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
