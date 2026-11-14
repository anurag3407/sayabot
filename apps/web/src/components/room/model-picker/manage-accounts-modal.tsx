"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { Check, Copy, ExternalLink, Loader2, Terminal, X } from "lucide-react"
import { GroupIcon, useModelList } from "./model-picker-dropdown"
import { updateHostSettingsAction } from "@/lib/actions/desktop"
import { connectAccountAction, deleteProviderKey } from "@/lib/actions/keys"
import {
  ACCOUNT_PROVIDERS,
  type AccountProvider,
  type OpenRouterAuthMessage,
} from "@/lib/ai-accounts"
import { cn } from "@/lib/format"
import type { PickerGroup } from "@/lib/model-catalog"
import type { DeviceCodeFlow } from "@/lib/connectors/types"

/**
 * Manage AI accounts: connect a provider to the workspace and see what is connected. Everything
 * is saved on the server as an encrypted provider key (or, for a ChatGPT, Claude or Cursor plan,
 * read from the app signed in on the server), so a connected account shows up in every picker
 * and every agent can use it. No key is kept in, or sent back to, the browser.
 */

const field =
  "h-10 w-full rounded-xl border border-line bg-raised px-3 text-[14px] text-text outline-none placeholder:text-faint focus:border-line-strong"
const primary =
  "inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-text px-4 text-[13.5px] font-medium text-void transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
const secondary =
  "inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-raised px-4 text-[13.5px] font-medium text-text transition-colors hover:bg-hover disabled:opacity-50"

type Notice = { tone: "ok" | "error"; text: string } | null

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null
  return (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-lg px-3 py-2 text-[13px] leading-snug",
        notice.tone === "ok" ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger",
      )}
    >
      {notice.text}
    </p>
  )
}

/** The accounts of one provider already saved in the workspace, each with Disconnect. */
function ConnectedList({
  orgSlug,
  groups,
  canManage,
  onChanged,
}: {
  orgSlug: string
  groups: PickerGroup[]
  canManage: boolean
  onChanged: () => void
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  if (!groups.length) return null
  return (
    <div className="space-y-1.5">
      <p className="text-[12px] font-medium text-faint">Connected</p>
      {groups.map((group) => (
        <div
          key={group.keyId}
          className="flex items-center gap-3 rounded-xl bg-raised/60 px-3 py-2.5"
        >
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-ok/15 text-ok">
            <Check className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] text-text">{group.label}</span>
            <span className="block truncate text-[12px] text-faint">
              {group.detail} · {group.models.length} models
            </span>
          </span>
          {canManage && group.keyId ? (
            confirming === group.keyId ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const keyId = group.keyId
                      if (!keyId) return
                      const result = await deleteProviderKey({ orgSlug, keyId })
                      if (!result.ok) setError(result.error ?? "Could not disconnect")
                      setConfirming(null)
                      onChanged()
                    })
                  }
                  className="h-8 rounded-lg bg-danger/15 px-3 text-[12.5px] font-medium text-danger hover:bg-danger/25"
                >
                  {pending ? "Removing…" : "Remove key"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="h-8 rounded-lg px-2 text-[12.5px] text-faint hover:text-text"
                >
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(group.keyId)}
                className="h-8 rounded-lg px-3 text-[12.5px] text-muted hover:bg-hover hover:text-text"
              >
                Disconnect
              </button>
            )
          ) : null}
        </div>
      ))}
      {confirming ? (
        <p className="text-[12px] text-faint">
          Agents set to this account stop answering until they get another model.
        </p>
      ) : null}
      {error ? <p className="text-[12px] text-danger">{error}</p> : null}
    </div>
  )
}

/** Paste a key (or, for a custom server, an address). Checked on the server before it is kept. */
function KeyForm({
  orgSlug,
  provider,
  onConnected,
}: {
  orgSlug: string
  provider: AccountProvider
  onConnected: () => void
}) {
  const [apiKey, setApiKey] = useState("")
  const [label, setLabel] = useState("")
  const [baseUrl, setBaseUrl] = useState(
    provider.id === "openai-compatible" ? "http://localhost:11434/v1" : "",
  )
  const [notice, setNotice] = useState<Notice>(null)
  const [pending, startTransition] = useTransition()
  const custom = provider.kind === "custom"

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        setNotice(null)
        startTransition(async () => {
          const result = await connectAccountAction({
            orgSlug,
            provider: provider.id,
            apiKey,
            label: label || undefined,
            baseUrl: custom ? baseUrl : null,
          })
          if (!result.ok) {
            setNotice({ tone: "error", text: result.error ?? "Could not connect" })
            return
          }
          setApiKey("")
          setLabel("")
          setNotice({ tone: "ok", text: result.message ?? "Connected" })
          onConnected()
        })
      }}
    >
      {custom ? (
        <label className="block space-y-1.5">
          <span className="text-[12.5px] text-muted">Address</span>
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://… or http://localhost:11434/v1"
            className={field}
            required
            inputMode="url"
          />
          <span className="block text-[12px] text-faint">
            The server running Sayabot calls this address, so localhost means that computer.
          </span>
        </label>
      ) : null}
      <label className="block space-y-1.5">
        <span className="text-[12.5px] text-muted">
          API key{provider.id === "openai-compatible" ? " (leave empty if it needs none)" : ""}
        </span>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={provider.keyHint ?? "Paste the key"}
          autoComplete="off"
          spellCheck={false}
          className={cn(field, "font-mono text-[13px]")}
          required={provider.id !== "openai-compatible"}
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-[12.5px] text-muted">Name (optional)</span>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={provider.name}
          maxLength={60}
          className={field}
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {pending ? "Checking the key…" : "Connect"}
        </button>
        {provider.keyUrl ? (
          <a
            href={provider.keyUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-text"
          >
            Get a key <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
      <NoticeLine notice={notice} />
    </form>
  )
}

function OpenRouterSignIn({ orgSlug, onConnected }: { orgSlug: string; onConnected: () => void }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const data = event.data as Partial<OpenRouterAuthMessage> | null
      if (data?.type !== "OPENROUTER_AUTH_SUCCESS") return
      setBusy(false)
      setNotice({
        tone: "ok",
        text: data.freeTier
          ? "Connected · free tier"
          : `Connected as ${data.label ?? "OpenRouter"}`,
      })
      onConnected()
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [onConnected])

  async function start() {
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch(`/api/connectors/openrouter/oauth?org=${encodeURIComponent(orgSlug)}`)
      const data = (await res.json().catch(() => ({}))) as { authUrl?: string; error?: string }
      if (!res.ok || !data.authUrl) throw new Error(data.error ?? "Could not start the sign-in")
      const popup = window.open(data.authUrl, "openrouter_oauth", "width=600,height=720")
      if (!popup) window.location.href = data.authUrl
    } catch (cause) {
      setBusy(false)
      setNotice({ tone: "error", text: cause instanceof Error ? cause.message : "Could not start" })
    }
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={() => void start()} disabled={busy} className={primary}>
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <GroupIcon provider="openrouter" size={16} />
        )}
        {busy ? "Waiting for OpenRouter…" : "Sign in with OpenRouter"}
      </button>
      <NoticeLine notice={notice} />
    </div>
  )
}

function CopilotSignIn({ orgSlug, onConnected }: { orgSlug: string; onConnected: () => void }) {
  const [flow, setFlow] = useState<DeviceCodeFlow | null>(null)
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [starting, setStarting] = useState(false)
  const timer = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }, [])
  useEffect(() => stop, [stop])

  function poll(deviceCode: string, interval: number) {
    timer.current = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/connectors/copilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceCode, org: orgSlug }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          status?: string
          label?: string
          error?: string
        }
        if (data.status === "complete") {
          setFlow(null)
          setNotice({ tone: "ok", text: `Connected · ${data.label ?? "GitHub Copilot"}` })
          onConnected()
          return
        }
        if (!res.ok || data.status === "error") {
          setFlow(null)
          setNotice({ tone: "error", text: data.error ?? "GitHub did not finish the sign-in" })
          return
        }
        if (data.status === "expired" || data.status === "denied") {
          setFlow(null)
          setNotice({
            tone: "error",
            text: data.status === "expired" ? "The code expired. Start again." : "GitHub said no.",
          })
          return
        }
        poll(deviceCode, data.status === "slow_down" ? interval + 5 : interval)
      } catch {
        poll(deviceCode, interval)
      }
    }, interval * 1000)
  }

  async function start() {
    stop()
    setStarting(true)
    setNotice(null)
    try {
      const res = await fetch("/api/connectors/copilot")
      const data = (await res.json().catch(() => ({}))) as DeviceCodeFlow & { error?: string }
      if (!res.ok || !data.userCode) throw new Error(data.error ?? "Could not start the sign-in")
      setFlow(data)
      poll(data.deviceCode, data.interval || 5)
    } catch (cause) {
      setNotice({ tone: "error", text: cause instanceof Error ? cause.message : "Could not start" })
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="space-y-3">
      {flow ? (
        <div className="space-y-3 rounded-xl bg-raised/60 p-4">
          <p className="text-[13.5px] text-muted">
            Open GitHub, enter this code and approve. This window finishes on its own.
          </p>
          <div className="flex items-center gap-2">
            <code className="rounded-lg bg-void px-3 py-2 font-mono text-[18px] tracking-[0.2em] text-text">
              {flow.userCode}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(flow.userCode)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1500)
              }}
              className={secondary}
              aria-label="Copy the code"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
            <a href={flow.verificationUri} target="_blank" rel="noreferrer" className={primary}>
              Open GitHub <ExternalLink className="h-4 w-4" />
            </a>
          </div>
          <p className="flex items-center gap-2 text-[12.5px] text-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for GitHub…
          </p>
        </div>
      ) : (
        <button type="button" onClick={() => void start()} disabled={starting} className={primary}>
          {starting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GroupIcon provider="copilot" size={16} />
          )}
          Sign in with GitHub
        </button>
      )}
      <NoticeLine notice={notice} />
    </div>
  )
}

/** A plan used through its app on the server: nothing to save here, only to sign in there. */
/** A computer group (one of the person's Macs) where this app is signed in right now. */
function signedInOn(group: PickerGroup, appId: string): boolean {
  return group.models.some((m) => m.id === appId && !/not signed in/i.test(m.label))
}

function AppPlan({
  orgSlug,
  provider,
  group,
  macs,
  onChanged,
}: {
  orgSlug: string
  provider: AccountProvider
  /** The app signed in on the server itself (self-hosted on your own computer). */
  group: PickerGroup | undefined
  /** The person's own Macs (Sayabot for Mac) where the app is signed in. */
  macs: PickerGroup[]
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const app = provider.app
  if (!app) return null
  const ready = Boolean(group && !/isn't signed in/i.test(group.detail))

  const turnOnRunner = (mac: PickerGroup) => {
    const hostId = mac.keyId?.replace(/^host:/, "")
    if (!hostId) return
    setError(null)
    startTransition(async () => {
      const result = await updateHostSettingsAction({ orgSlug, hostId, runnerEnabled: true })
      if (!result.ok) setError(result.error ?? result.message ?? "Could not turn it on")
      else onChanged()
    })
  }

  return (
    <div className="space-y-3">
      {ready && group ? (
        <div className="flex items-center gap-3 rounded-xl bg-ok/10 px-3 py-2.5 text-ok">
          <Check className="h-4 w-4 shrink-0" />
          <span className="min-w-0 text-[13.5px]">
            Ready: {group.detail} · {group.models.length} models
          </span>
        </div>
      ) : null}
      {macs.map((mac) =>
        mac.runnerEnabled ? (
          <div
            key={mac.keyId}
            className="flex items-center gap-3 rounded-xl bg-ok/10 px-3 py-2.5 text-ok"
          >
            <Check className="h-4 w-4 shrink-0" />
            <span className="min-w-0 text-[13.5px]">
              Ready on {mac.label}: agents set to run there use your {app.plan} plan.
            </span>
          </div>
        ) : (
          <div key={mac.keyId} className="space-y-2.5 rounded-xl bg-raised/60 p-4">
            <p className="text-[13.5px] leading-relaxed text-text">
              Found on {mac.label}: {provider.name.replace(/ plan$/, "")} is signed in there.
            </p>
            <p className="text-[12.5px] leading-relaxed text-faint">
              Let agents run on that Mac to use your plan. Their work happens on the Mac, with the
              apps signed in there. You can turn this off in Settings → Computers.
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={() => turnOnRunner(mac)}
              className="inline-flex items-center gap-2 rounded-full bg-text px-4 py-2 text-[13px] font-medium text-void disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Use it from {mac.label}
            </button>
          </div>
        ),
      )}
      {error ? <p className="text-[12.5px] text-danger">{error}</p> : null}
      {!ready && !macs.length ? (
        <div className="space-y-2 rounded-xl bg-raised/60 p-4 text-[13.5px] leading-relaxed text-muted">
          <p>
            Works with {app.plan}. Install Sayabot for Mac, then sign in once on that Mac, in a
            terminal:
          </p>
          <code className="flex items-center gap-2 rounded-lg bg-void px-3 py-2 font-mono text-[13px] text-text">
            <Terminal className="h-4 w-4 text-faint" />
            {app.command}
          </code>
          <p className="text-[12.5px] text-faint">
            Sayabot for Mac finds it on its own and it shows up here. No key needed: it uses your
            own subscription.
          </p>
        </div>
      ) : null}
    </div>
  )
}

export function ManageAccountsModal({
  orgSlug,
  isOpen,
  onClose,
  initialProvider = "openrouter",
}: {
  orgSlug: string
  isOpen: boolean
  onClose: () => void
  initialProvider?: string
}) {
  const { list, loading, reload } = useModelList(orgSlug)
  const [activeId, setActiveId] = useState(initialProvider)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    setActiveId(initialProvider)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    dialogRef.current?.focus()
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isOpen, initialProvider, onClose])

  const refresh = useCallback(() => void reload(), [reload])

  if (!isOpen) return null
  const groups = list?.groups ?? []
  const canManage = Boolean(list?.canManage)
  const active = ACCOUNT_PROVIDERS.find((p) => p.id === activeId) ?? ACCOUNT_PROVIDERS[0]
  if (!active) return null

  // Plans signed in on the person's own Macs (reported by Sayabot for Mac), not only the server.
  const macsWith = (provider: AccountProvider) =>
    provider.kind === "app" && provider.app
      ? groups.filter((g) => g.section === "computer" && signedInOn(g, provider.app?.id ?? ""))
      : []
  const connectedOf = (provider: AccountProvider) =>
    provider.kind === "app"
      ? groups.filter((g) => g.keyId === `cli:${provider.app?.id}`)
      : groups.filter((g) => g.section === "key" && g.provider === provider.id)
  const isConnected = (provider: AccountProvider) =>
    connectedOf(provider).length > 0 || macsWith(provider).some((mac) => mac.runnerEnabled)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-void/75 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-accounts-title"
        tabIndex={-1}
        className="flex h-[min(600px,calc(100dvh-32px))] w-full max-w-3xl overflow-hidden rounded-2xl border border-line-strong bg-panel text-text shadow-[0_24px_64px_rgba(0,0,0,0.6)] outline-none"
      >
        <nav
          aria-label="AI accounts"
          className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-void/50 p-2"
        >
          <p className="px-2.5 pb-1.5 pt-2 text-[12px] font-medium text-faint">AI accounts</p>
          {ACCOUNT_PROVIDERS.map((provider) => {
            const connected = isConnected(provider)
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => setActiveId(provider.id)}
                aria-current={provider.id === active.id ? "true" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] transition-colors",
                  provider.id === active.id
                    ? "bg-raised text-text"
                    : "text-muted hover:bg-raised/60 hover:text-text",
                )}
              >
                <GroupIcon provider={provider.id} size={16} />
                <span className="min-w-0 flex-1 truncate">{provider.name}</span>
                {connected ? (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-ok" aria-label="Connected" />
                ) : null}
              </button>
            )
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-raised">
              <GroupIcon provider={active.id} />
            </span>
            <div className="min-w-0 flex-1">
              <h2
                id="manage-accounts-title"
                className="text-[16px] font-semibold tracking-[-0.01em]"
              >
                {active.name}
              </h2>
              <p className="text-[13px] text-faint">{active.blurb}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-raised hover:text-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {!list && loading ? (
              <p className="flex items-center gap-2 text-[13px] text-faint">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking what is connected…
              </p>
            ) : null}

            {active.kind === "app" ? (
              <AppPlan
                orgSlug={orgSlug}
                provider={active}
                group={connectedOf(active)[0]}
                macs={macsWith(active)}
                onChanged={refresh}
              />
            ) : (
              <>
                <ConnectedList
                  orgSlug={orgSlug}
                  groups={connectedOf(active)}
                  canManage={canManage}
                  onChanged={refresh}
                />
                {list && !canManage ? (
                  <p className="rounded-xl bg-raised/60 px-3 py-2.5 text-[13.5px] text-muted">
                    Only workspace admins can connect AI accounts. Ask one to add {active.name}.
                  </p>
                ) : list ? (
                  <div className="space-y-4">
                    {active.kind === "openrouter" ? (
                      <OpenRouterSignIn orgSlug={orgSlug} onConnected={refresh} />
                    ) : null}
                    {active.kind === "copilot" ? (
                      <CopilotSignIn orgSlug={orgSlug} onConnected={refresh} />
                    ) : null}
                    {active.kind === "openrouter" ? (
                      <p className="text-[12px] font-medium text-faint">Or paste a key</p>
                    ) : null}
                    {active.kind !== "copilot" ? (
                      <KeyForm
                        key={active.id}
                        orgSlug={orgSlug}
                        provider={active}
                        onConnected={refresh}
                      />
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>

          <p className="shrink-0 border-t border-line px-5 py-3 text-[12px] text-faint">
            Keys are encrypted on the server and never shown again. Every agent in the workspace can
            be set to use them.
          </p>
        </div>
      </div>
    </div>
  )
}
