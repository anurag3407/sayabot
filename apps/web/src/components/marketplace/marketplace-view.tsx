"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import { connectMarketplaceAppAction, disconnectMarketplaceServerAction } from "@/lib/actions/marketplace"
import {
  APP_CATEGORIES,
  hostMatchesApp,
  MARKETPLACE_APPS,
  type MarketplaceApp,
} from "@/lib/marketplace"
import { Mascot } from "@/components/ui/mascot"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { CheckIcon, CloseIcon, PlusIcon, SearchIcon } from "@/components/ui/icons"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"

interface ServerSummary {
  id: string
  name: string
  host: string
  enabled: boolean
}

interface TemplateSummary {
  id: string
  slug: string
  name: string
  description: string
  category: string
}

function AppTile({ app, size = 44 }: { app: MarketplaceApp; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-[12px] font-semibold text-white shadow-sm"
      style={{ width: size, height: size, background: app.color, fontSize: size * 0.4 }}
    >
      {app.name.replace(/[^A-Za-z0-9]/g, "").charAt(0).toUpperCase()}
    </span>
  )
}

function ConnectDialog({
  app,
  orgSlug,
  onClose,
  onConnected,
}: {
  app: MarketplaceApp
  orgSlug: string
  onClose: () => void
  onConnected: () => void
}) {
  const [secret, setSecret] = useState("")
  const [personalUrl, setPersonalUrl] = useState("")
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const auth = app.auth

  function connect() {
    setError(null)
    startTransition(async () => {
      const result = await connectMarketplaceAppAction({ orgSlug, appId: app.id, secret, personalUrl })
      if (!result.ok) {
        setError(result.error ?? "Could not connect")
        return
      }
      showToast({
        tone: result.data?.reachable === false ? "warning" : "success",
        message: result.message ?? `${app.name} connected`,
      })
      onConnected()
    })
  }

  const needsInput = auth.kind === "token" || auth.kind === "url-key" || auth.kind === "personal-url"
  const canSubmit =
    auth.kind === "none" ||
    (auth.kind === "token" && (auth.optional || secret.trim())) ||
    (auth.kind === "url-key" && secret.trim()) ||
    (auth.kind === "personal-url" && personalUrl.trim())

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-void/70 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        className="w-full max-w-md rounded-t-xl border border-line bg-panel p-5 shadow-2xl sm:rounded-xl sm:p-6"
      >
        <div className="flex items-start gap-3">
          <AppTile app={app} />
          <div className="min-w-0 flex-1">
            <h2 id="connect-title" className="text-[17px] font-semibold text-text">
              Connect {app.name}
            </h2>
            <p className="text-[13px] text-muted">{app.tagline}</p>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}>
            <CloseIcon width={14} height={14} />
          </Button>
        </div>

        <div className="mt-5 space-y-3">
          {auth.kind === "none" ? (
            <p className="rounded-lg bg-ink p-3 text-[13px] text-muted">
              No account needed. Every agent in this workspace that has MCP tools turned on can use it.
            </p>
          ) : null}
          {auth.kind === "token" || auth.kind === "url-key" ? (
            <div>
              <label htmlFor="app-secret" className="text-[13px] font-medium text-text">
                {auth.label}
              </label>
              <Input
                id="app-secret"
                type="password"
                autoComplete="off"
                className="mt-1.5"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder="Paste it here"
                autoFocus
              />
              <p className="mt-1.5 text-[12px] text-faint">{auth.help}</p>
            </div>
          ) : null}
          {auth.kind === "personal-url" ? (
            <div>
              <label htmlFor="app-url" className="text-[13px] font-medium text-text">
                {auth.label}
              </label>
              <Input
                id="app-url"
                type="url"
                className="mt-1.5"
                value={personalUrl}
                onChange={(event) => setPersonalUrl(event.target.value)}
                placeholder={auth.placeholder}
                autoFocus
              />
              <p className="mt-1.5 text-[12px] text-faint">{auth.help}</p>
            </div>
          ) : null}
          {needsInput ? (
            <p className="text-[12px] text-faint">
              Stored encrypted. Agents use it through Sayabot and never see it.
            </p>
          ) : null}
          {app.dangerousTools?.length ? (
            <p className="text-[12px] text-faint">
              Actions that change things ({app.dangerousTools.slice(0, 3).join(", ")}
              {app.dangerousTools.length > 3 ? "…" : ""}) will wait for your OK in the Inbox.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <a href={app.docs} target="_blank" rel="noreferrer" className="text-[13px] text-muted hover:text-text hover:underline">
            {app.name} docs ↗
          </a>
          <Button variant="primary" disabled={pending || !canSubmit} onClick={connect}>
            {pending ? "Connecting…" : "Connect"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function AppRow({
  app,
  connected,
  canManage,
  onConnect,
  onDisconnect,
  busy,
}: {
  app: MarketplaceApp
  connected: ServerSummary | undefined
  canManage: boolean
  onConnect: () => void
  onDisconnect: (server: ServerSummary) => void
  busy: boolean
}) {
  const soon = app.auth.kind === "oauth"
  return (
    <li className="group flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-raised">
      <AppTile app={app} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[14px] font-medium text-text">
          {app.name}
          {app.auth.kind === "none" ? (
            <span className="rounded-full bg-ok/10 px-1.5 py-0.5 text-[10px] font-medium text-ok">No sign-up</span>
          ) : null}
        </p>
        <p className="truncate text-[13px] text-muted">{app.tagline}</p>
      </div>
      {connected ? (
        <div className="flex items-center gap-1">
          <span className="inline-flex h-9 items-center gap-1 rounded-sm px-2 text-[13px] text-ok">
            <CheckIcon width={13} height={13} /> Connected
          </span>
          {canManage ? (
            <Button size="sm" variant="quiet" disabled={busy} onClick={() => onDisconnect(connected)} className="md:opacity-0 md:group-hover:opacity-100">
              Remove
            </Button>
          ) : null}
        </div>
      ) : soon ? (
        <span className="shrink-0 rounded-sm border border-line px-2.5 py-1.5 text-[12px] text-faint">Coming soon</span>
      ) : (
        <Button size="sm" variant="secondary" disabled={!canManage} onClick={onConnect} title={canManage ? undefined : "Only workspace admins can connect apps"}>
          <PlusIcon width={13} height={13} /> Connect
        </Button>
      )}
    </li>
  )
}

export function MarketplaceView({
  orgSlug,
  canManage,
  servers,
  templates,
  initialTab,
}: {
  orgSlug: string
  canManage: boolean
  servers: ServerSummary[]
  templates: TemplateSummary[]
  initialTab: "apps" | "agents"
}) {
  const router = useRouter()
  const [tab, setTab] = useState<"apps" | "agents">(initialTab)
  const [query, setQuery] = useState("")
  const [connecting, setConnecting] = useState<MarketplaceApp | null>(null)
  const [pending, startTransition] = useTransition()

  const q = query.trim().toLowerCase()
  const apps = useMemo(
    () =>
      MARKETPLACE_APPS.filter(
        (app) => !q || app.name.toLowerCase().includes(q) || app.tagline.toLowerCase().includes(q),
      ),
    [q],
  )
  const connectedFor = (app: MarketplaceApp) => servers.find((server) => hostMatchesApp(server.host, app))
  const catalogHosts = new Set(servers.filter((s) => MARKETPLACE_APPS.some((app) => hostMatchesApp(s.host, app))).map((s) => s.id))
  const custom = servers.filter((server) => !catalogHosts.has(server.id))
  const agentTemplates = templates.filter(
    (t) => t.slug !== "blank" && (!q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)),
  )

  function disconnect(server: ServerSummary) {
    startTransition(async () => {
      const result = await disconnectMarketplaceServerAction({ orgSlug, serverId: server.id })
      showToast({ tone: result.ok ? "neutral" : "danger", message: result.ok ? (result.message ?? "Removed") : (result.error ?? "Could not remove") })
      router.refresh()
    })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-text">Marketplace</h1>
          <p className="mt-1 text-[14px] text-muted">
            {tab === "apps"
              ? "Connect the tools and services your agents work with."
              : "Ready-made agents with a job to do. Add one and it joins your rooms."}
          </p>
        </header>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div role="tablist" aria-label="Marketplace" className="flex rounded-lg border border-line bg-ink p-1">
            {(["apps", "agents"] as const).map((value) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "h-9 rounded-md px-4 text-[13px] font-medium transition-colors",
                  tab === value ? "bg-raised text-text" : "text-muted hover:text-text",
                )}
              >
                {value === "apps" ? "Apps" : "Agents"}
              </button>
            ))}
          </div>
          <div className="relative flex-1">
            <SearchIcon width={15} height={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === "apps" ? "Search apps" : "Search agents"}
              className="pl-9"
              aria-label="Search"
            />
          </div>
          {tab === "apps" && canManage ? (
            <Link
              href={`/${orgSlug}/settings/tools`}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-sm border border-line-strong bg-raised px-3.5 text-[13px] font-medium text-text hover:bg-hover md:h-9"
            >
              <PlusIcon width={13} height={13} /> Add custom
            </Link>
          ) : null}
        </div>

        {tab === "apps" ? (
          <div className="mt-8 space-y-9">
            {custom.length && !q ? (
              <section>
                <h2 className="text-[15px] font-medium text-text">Your custom connections</h2>
                <ul className="mt-2 grid gap-1 md:grid-cols-2">
                  {custom.map((server) => (
                    <li key={server.id} className="flex items-center gap-3 rounded-xl p-3 hover:bg-raised">
                      <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-hover text-[16px] font-semibold text-text">
                        {server.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium text-text">{server.name}</p>
                        <p className="truncate text-[13px] text-muted">{server.host}</p>
                      </div>
                      <Link href={`/${orgSlug}/settings/tools`} className="text-[13px] text-muted hover:text-text">
                        Manage
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {APP_CATEGORIES.map((category) => {
              const inCategory = apps.filter((app) => app.category === category.id)
              if (!inCategory.length) return null
              return (
                <section key={category.id} aria-labelledby={`cat-${category.id}`}>
                  <h2 id={`cat-${category.id}`} className="flex items-baseline gap-2 text-[15px] font-medium text-text">
                    {category.label}
                    <span className="text-[13px] font-normal text-faint">{inCategory.length}</span>
                  </h2>
                  <ul className="mt-2 grid gap-1 md:grid-cols-2">
                    {inCategory.map((app) => (
                      <AppRow
                        key={app.id}
                        app={app}
                        connected={connectedFor(app)}
                        canManage={canManage}
                        busy={pending}
                        onConnect={() => setConnecting(app)}
                        onDisconnect={disconnect}
                      />
                    ))}
                  </ul>
                </section>
              )
            })}
            {!apps.length ? (
              <p className="rounded-xl border border-dashed border-line p-6 text-center text-[14px] text-faint">
                No app matches &ldquo;{query}&rdquo;. You can still add any MCP server with Add custom.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-8">
            <ul className="grid gap-1 md:grid-cols-2">
              {agentTemplates.map((template) => (
                <li key={template.id} className="flex items-center gap-3 rounded-xl p-3 hover:bg-raised">
                  <Mascot seed={template.slug} className="h-11 w-11 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-text">
                      {template.name} <span className="font-normal text-faint">by Sayabot</span>
                    </p>
                    <p className="truncate text-[13px] text-muted">{template.description}</p>
                  </div>
                  <Link
                    href={`/${orgSlug}/agents/new?template=${encodeURIComponent(template.slug)}`}
                    className="inline-flex h-10 shrink-0 items-center gap-1 rounded-sm border border-line-strong bg-raised px-3 text-[13px] font-medium text-text hover:bg-hover md:h-8"
                  >
                    <PlusIcon width={13} height={13} /> Add
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-8 rounded-xl border border-line bg-panel p-5">
              <p className="text-[15px] font-medium text-text">Already use an agent somewhere else?</p>
              <p className="mt-1 text-[13px] text-muted">
                Hermes, Claude Code, Codex, Cursor and others can join a room as they are. Open a room and press{" "}
                <span className="text-text">Add agent</span>: you paste one message into the agent, approve it, and it&apos;s
                in.
              </p>
              <Link href={`/${orgSlug}`} className="mt-3 inline-flex text-[13px] font-medium text-accent hover:underline">
                Go to your rooms →
              </Link>
            </div>
          </div>
        )}
      </div>

      {connecting ? (
        <ConnectDialog
          app={connecting}
          orgSlug={orgSlug}
          onClose={() => setConnecting(null)}
          onConnected={() => {
            setConnecting(null)
            router.refresh()
          }}
        />
      ) : null}
    </div>
  )
}
