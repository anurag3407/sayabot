"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import {
  connectMarketplaceAppAction,
  disconnectMarketplaceServerAction,
  startMarketplaceSignInAction,
} from "@/lib/actions/marketplace"
import { BrandLogo } from "@/components/connectors/brand-logo"
import { brandLogo } from "@/lib/brand-logos"
import {
  APP_CATEGORIES,
  appForHost,
  FEATURED_APP_IDS,
  MARKETPLACE_APPS,
  type MarketplaceApp,
} from "@/lib/marketplace"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { CheckIcon, CloseIcon, PlusIcon, SearchIcon } from "@/components/ui/icons"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"
import { Bot, Cable } from "lucide-react"

export interface ServerSummary {
  id: string
  name: string
  host: string
  enabled: boolean
  catalogApp: string | null
  signIn: "ok" | "pending" | "signed_out" | null
}

async function beginSignIn(
  orgSlug: string,
  app: MarketplaceApp,
  serverId?: string,
): Promise<string | null> {
  const result = await startMarketplaceSignInAction({ orgSlug, appId: app.id, serverId })
  if (!result.ok) return result.error ?? `Could not start ${app.name} sign-in`
  const target = (result.data as { authorizationUrl?: string | null } | undefined)?.authorizationUrl
  if (target) {
    window.location.assign(target)
  } else {
    showToast({ tone: "success", message: result.message ?? `${app.name} connected` })
    window.location.reload()
  }
  return null
}

function AppTile({ app, size = 44 }: { app: MarketplaceApp; size?: number }) {
  if (brandLogo(app.id)) {
    return (
      <span
        aria-hidden
        className="grid shrink-0 place-items-center rounded-[12px] bg-white shadow-sm ring-1 ring-black/10"
        style={{ width: size, height: size }}
      >
        <BrandLogo id={app.id} size={Math.round(size * 0.58)} />
      </span>
    )
  }
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-[12px] font-semibold text-white shadow-sm"
      style={{ width: size, height: size, background: app.color, fontSize: size * 0.4 }}
    >
      {app.name
        .replace(/[^A-Za-z0-9]/g, "")
        .charAt(0)
        .toUpperCase()}
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
      if (auth.kind === "oauth") {
        const problem = await beginSignIn(orgSlug, app)
        if (problem) setError(problem)
        return
      }
      const result = await connectMarketplaceAppAction({
        orgSlug,
        appId: app.id,
        secret,
        personalUrl,
      })
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

  const needsInput =
    auth.kind === "token" || auth.kind === "url-key" || auth.kind === "personal-url"
  const canSubmit =
    auth.kind === "none" ||
    auth.kind === "oauth" ||
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
              No account needed. Every agent in this workspace that has MCP tools turned on can use
              it.
            </p>
          ) : null}
          {auth.kind === "oauth" ? (
            <div className="space-y-2 rounded-lg bg-ink p-3 text-[13px] text-muted">
              <p>
                You&apos;ll go to {app.name} to sign in and choose what to share, then come straight
                back here. No keys to copy.
              </p>
              <p className="text-[12px] text-faint">
                Agents act as the account you sign in with. Anything that changes data in {app.name}{" "}
                waits for your OK in the Inbox; looking things up doesn&apos;t.
              </p>
            </div>
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
          {app.runOn === "desktop" ? (
            <p className="text-[12px] text-faint">
              This runs on a computer with the Sayabot app open. It can see what is on that
              computer, not the server.
            </p>
          ) : app.runOn === "server" ? (
            <p className="text-[12px] text-faint">
              The first time an agent uses it, Sayabot installs the program next to itself.
            </p>
          ) : null}
          {app.dangerousTools?.length &&
          !app.dangerousTools.some((name) => name.startsWith("@")) ? (
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
          <a
            href={app.docs}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] text-muted hover:text-text hover:underline"
          >
            {app.name} docs ↗
          </a>
          <Button variant="primary" disabled={pending || !canSubmit} onClick={connect}>
            {pending
              ? auth.kind === "oauth"
                ? "Opening…"
                : "Connecting…"
              : auth.kind === "oauth"
                ? `Sign in with ${app.name}`
                : "Connect"}
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
  onSignInAgain,
  busy,
}: {
  app: MarketplaceApp
  connected: ServerSummary | undefined
  canManage: boolean
  onConnect: () => void
  onDisconnect: (server: ServerSummary) => void
  onSignInAgain: (server: ServerSummary) => void
  busy: boolean
}) {
  const signedOut = connected?.signIn === "signed_out"
  const unfinished = connected?.signIn === "pending"
  return (
    <li className="group flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-raised">
      <AppTile app={app} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[14px] font-medium text-text">
          {app.name}
          {app.auth.kind === "none" ? (
            <span className="rounded-full bg-ok/10 px-1.5 py-0.5 text-[10px] font-medium text-ok">
              No sign-up
            </span>
          ) : null}
          {signedOut ? (
            <span className="rounded-full bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium text-warn">
              Signed out
            </span>
          ) : null}
        </p>
        <p className="truncate text-[13px] text-muted">{app.tagline}</p>
      </div>
      {connected && (signedOut || unfinished) ? (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={!canManage || busy}
            onClick={() => onSignInAgain(connected)}
          >
            {signedOut ? "Sign in again" : "Finish sign-in"}
          </Button>
          {canManage ? (
            <Button
              size="sm"
              variant="quiet"
              disabled={busy}
              onClick={() => onDisconnect(connected)}
              className="md:opacity-0 md:group-hover:opacity-100"
            >
              Remove
            </Button>
          ) : null}
        </div>
      ) : connected ? (
        <div className="flex items-center gap-1">
          <span className="inline-flex h-9 items-center gap-1 rounded-sm px-2 text-[13px] text-ok">
            <CheckIcon width={13} height={13} /> Connected
          </span>
          {canManage ? (
            <Button
              size="sm"
              variant="quiet"
              disabled={busy}
              onClick={() => onDisconnect(connected)}
              className="md:opacity-0 md:group-hover:opacity-100"
            >
              Remove
            </Button>
          ) : null}
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          disabled={!canManage}
          onClick={onConnect}
          title={canManage ? undefined : "Only workspace admins can connect apps"}
        >
          <PlusIcon width={13} height={13} /> {app.auth.kind === "oauth" ? "Sign in" : "Connect"}
        </Button>
      )}
    </li>
  )
}

export function ConnectorsView({
  orgSlug,
  canManage,
  servers,
  notice,
}: {
  orgSlug: string
  canManage: boolean
  servers: ServerSummary[]
  notice?: { tone: "success" | "danger"; message: string } | null
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [connecting, setConnecting] = useState<MarketplaceApp | null>(null)
  const [pending, startTransition] = useTransition()
  const [category, setCategory] = useState<string>("all")
  const shownNotice = useRef(false)

  useEffect(() => {
    if (!notice || shownNotice.current) return
    shownNotice.current = true
    showToast({ tone: notice.tone, message: notice.message, durationMs: 8_000 })
    router.replace(`/${orgSlug}/connectors`, { scroll: false })
  }, [notice, orgSlug, router])

  const q = query.trim().toLowerCase()
  const apps = useMemo(() => {
    const matched = MARKETPLACE_APPS.filter(
      (app) =>
        (category === "all" || app.category === category) &&
        (!q || app.name.toLowerCase().includes(q) || app.tagline.toLowerCase().includes(q)),
    )
    if (q || category !== "all") return matched
    const rank = (id: string) => {
      const index = FEATURED_APP_IDS.indexOf(id as (typeof FEATURED_APP_IDS)[number])
      return index === -1 ? FEATURED_APP_IDS.length : index
    }
    return [...matched].sort(
      (a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name, "en"),
    )
  }, [q, category])

  const appIds = useMemo(() => new Set(MARKETPLACE_APPS.map((app) => app.id)), [])
  const connectedFor = (app: MarketplaceApp) =>
    servers.find((server) => server.catalogApp === app.id) ??
    servers.find((server) => !server.catalogApp && appForHost(server.host)?.id === app.id)
  const catalogHosts = new Set(
    servers
      .filter((s) => (s.catalogApp && appIds.has(s.catalogApp)) || appForHost(s.host) !== null)
      .map((s) => s.id),
  )
  const custom = servers.filter((server) => !catalogHosts.has(server.id))

  function signInAgain(app: MarketplaceApp, server: ServerSummary) {
    startTransition(async () => {
      const problem = await beginSignIn(orgSlug, app, server.id)
      if (problem) showToast({ tone: "danger", message: problem })
    })
  }

  function disconnect(server: ServerSummary) {
    startTransition(async () => {
      const result = await disconnectMarketplaceServerAction({ orgSlug, serverId: server.id })
      showToast({
        tone: result.ok ? "neutral" : "danger",
        message: result.ok ? (result.message ?? "Removed") : (result.error ?? "Could not remove"),
      })
      router.refresh()
    })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
        <header>
          <div className="flex items-center gap-2 text-accent">
            <Cable className="h-5 w-5" />
            <span className="text-[13px] font-semibold uppercase tracking-wider">Connectors</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-text">
            Workspace Connectors
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Connect the external tools, services, and remote MCP servers your agents work with.
          </p>
        </header>

        {/* Navigation Switcher & Search Bar */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div
            role="tablist"
            aria-label="Workspace Store Navigation"
            className="flex rounded-lg border border-line bg-ink p-1"
          >
            <Link
              href={`/${orgSlug}/connectors`}
              role="tab"
              aria-selected={true}
              className="flex h-9 items-center gap-1.5 rounded-md bg-raised px-3.5 text-[13px] font-medium text-text transition-colors"
            >
              <Cable className="h-3.5 w-3.5" />
              Connectors
            </Link>
            <Link
              href={`/${orgSlug}/bot-store`}
              role="tab"
              aria-selected={false}
              className="flex h-9 items-center gap-1.5 rounded-md px-3.5 text-[13px] font-medium text-muted transition-colors hover:text-text"
            >
              <Bot className="h-3.5 w-3.5" />
              Bot store
            </Link>
          </div>

          <div className="relative flex-1">
            <SearchIcon
              width={15}
              height={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search connectors and MCP tools…"
              className="pl-9"
              aria-label="Search connectors"
            />
          </div>

          {canManage ? (
            <Link
              href={`/${orgSlug}/settings/tools`}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-sm border border-line-strong bg-raised px-3.5 text-[13px] font-medium text-text hover:bg-hover md:h-9"
            >
              <PlusIcon width={13} height={13} /> Add custom
            </Link>
          ) : null}
        </div>

        {/* Categories */}
        <div
          role="group"
          aria-label="Categories"
          className="-mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
        >
          {[{ id: "all", label: `All ${MARKETPLACE_APPS.length}` }, ...APP_CATEGORIES].map(
            (item) => (
              <button
                key={item.id}
                aria-pressed={category === item.id}
                onClick={() => setCategory(item.id)}
                className={cn(
                  "h-8 shrink-0 rounded-full border px-3 text-[12px] font-medium transition-colors",
                  category === item.id
                    ? "border-line-strong bg-raised text-text"
                    : "border-line text-muted hover:text-text",
                )}
              >
                {item.label}
              </button>
            ),
          )}
        </div>

        {/* Custom Connections and Catalog */}
        <div className="mt-8 space-y-9">
          {custom.length && !q ? (
            <section>
              <h2 className="text-[15px] font-medium text-text">Your custom connections</h2>
              <ul className="mt-2 grid gap-1 md:grid-cols-2">
                {custom.map((server) => (
                  <li
                    key={server.id}
                    className="flex items-center gap-3 rounded-xl p-3 hover:bg-raised"
                  >
                    <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-hover text-[16px] font-semibold text-text">
                      {server.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium text-text">{server.name}</p>
                      <p className="truncate text-[13px] text-muted">{server.host}</p>
                    </div>
                    <Link
                      href={`/${orgSlug}/settings/tools`}
                      className="text-[13px] text-muted hover:text-text"
                    >
                      Manage
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {APP_CATEGORIES.map((cat) => {
            const inCategory = apps.filter((app) => app.category === cat.id)
            if (!inCategory.length) return null
            return (
              <section key={cat.id} aria-labelledby={`cat-${cat.id}`}>
                <h2
                  id={`cat-${cat.id}`}
                  className="flex items-baseline gap-2 text-[15px] font-medium text-text"
                >
                  {cat.label}
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
                      onSignInAgain={(server) => signInAgain(app, server)}
                    />
                  ))}
                </ul>
              </section>
            )
          })}

          {!apps.length ? (
            <p className="rounded-xl border border-dashed border-line p-6 text-center text-[14px] text-faint">
              No connector matches &ldquo;{query}&rdquo;. You can still add any remote MCP server
              with Add custom.
            </p>
          ) : null}
        </div>

        {/* Footer Link to Bot Store */}
        <div className="mt-10 flex flex-col gap-2 rounded-xl border border-line bg-ink p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Bot className="h-4 w-4 text-muted" />
            <p className="text-[13px] text-muted">
              Looking for ready-made bots to automate your tasks and join your rooms?
            </p>
          </div>
          <Link
            href={`/${orgSlug}/bot-store`}
            className="shrink-0 text-[13px] font-medium text-accent hover:underline"
          >
            Explore Bot Store →
          </Link>
        </div>
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
