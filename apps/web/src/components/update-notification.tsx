"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowDownToLine, RefreshCw, X } from "lucide-react"
import { showToast } from "@/components/ui/toast"
import { onWebUpdate } from "@/lib/web-update"
import { cn } from "@/lib/format"

/**
 * Two kinds of update, kept apart so each says something true:
 * - the website was deployed again: reload the page to get it (browser and Mac app alike);
 * - a newer Sayabot for Mac is out: the Mac app downloads, checks and installs it, and this
 *   shows its progress. Older Mac apps without that bridge keep their own dialog.
 */

/** Mirrors UpdateState in apps/desktop/src/updater.ts. */
export type DesktopUpdateState =
  | { status: "idle"; current: string; latest: string | null; checkedAt: number | null }
  | { status: "checking"; current: string; latest: string | null }
  | { status: "available"; current: string; latest: string; notes: string }
  | { status: "downloading"; current: string; latest: string; percent: number | null }
  | { status: "installing"; current: string; latest: string }
  | { status: "error"; current: string; latest: string | null; message: string }

interface DesktopUpdateBridge {
  getVersion?: () => Promise<string>
  checkForUpdates?: (manual?: boolean) => Promise<unknown>
  getUpdateState?: () => Promise<DesktopUpdateState>
  installUpdate?: () => Promise<DesktopUpdateState>
  onUpdateState?: (callback: (state: DesktopUpdateState) => void) => () => void
}

function desktopBridge(): DesktopUpdateBridge | null {
  if (typeof window === "undefined") return null
  return (window as unknown as { sayabotDesktop?: DesktopUpdateBridge }).sayabotDesktop ?? null
}

interface UpdateContextType {
  /** Something to act on: a newer website, or a Mac update ready to install. */
  updateReady: boolean
  checking: boolean
  /** The Mac app's version, inside the Mac app; null in a browser. */
  appVersion: string | null
  desktop: DesktopUpdateState | null
  checkForUpdates: () => Promise<void>
  /** Installs the Mac update when there is one, otherwise reloads for the newer website. */
  applyUpdate: () => void
}

const UpdateContext = createContext<UpdateContextType | null>(null)

const POLL_MS = 5 * 60_000

async function readCommit(): Promise<string | null> {
  try {
    const res = await fetch(`/api/version?t=${Date.now()}`, { cache: "no-store" })
    if (!res.ok) return null
    const data = (await res.json()) as { gitCommit?: unknown }
    return typeof data.gitCommit === "string" && data.gitCommit ? data.gitCommit : null
  } catch {
    return null
  }
}

function reloadPage() {
  navigator.serviceWorker
    ?.getRegistration()
    .then((reg) => reg?.waiting?.postMessage({ type: "SKIP_WAITING" }))
    .catch(() => undefined)
  window.location.reload()
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [webUpdate, setWebUpdate] = useState(false)
  const [webDismissed, setWebDismissed] = useState(false)
  const [checking, setChecking] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [desktop, setDesktop] = useState<DesktopUpdateState | null>(null)
  const [laterVersion, setLaterVersion] = useState<string | null>(null)
  // The deploy this page was loaded from; a different one later means a newer website.
  const loadedCommit = useRef<string | null>(null)

  const checkWeb = useCallback(async (): Promise<boolean> => {
    const commit = await readCommit()
    if (!commit) return false
    if (!loadedCommit.current) {
      loadedCommit.current = commit
      return false
    }
    if (commit === loadedCommit.current) return false
    setWebUpdate(true)
    setWebDismissed(false)
    return true
  }, [])

  useEffect(() => {
    void checkWeb()
    const timer = window.setInterval(() => void checkWeb(), POLL_MS)
    const onVisible = () => document.visibilityState === "visible" && void checkWeb()
    document.addEventListener("visibilitychange", onVisible)
    const stop = onWebUpdate(() => {
      setWebUpdate(true)
      setWebDismissed(false)
    })
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
      stop()
    }
  }, [checkWeb])

  useEffect(() => {
    const bridge = desktopBridge()
    if (!bridge) return
    void bridge.getVersion?.().then(setAppVersion, () => undefined)
    if (!bridge.onUpdateState || !bridge.getUpdateState) return
    void bridge.getUpdateState().then(setDesktop, () => undefined)
    return bridge.onUpdateState(setDesktop)
  }, [])

  const checkForUpdates = useCallback(async () => {
    const bridge = desktopBridge()
    setChecking(true)
    try {
      const web = await checkWeb()
      if (bridge?.checkForUpdates) {
        // The Mac app answers in its own dialog (up to date, available, or why it failed).
        await bridge.checkForUpdates(true)
        return
      }
      showToast({
        message: web ? "A newer Sayabot is out. Reload to get it." : "You have the newest Sayabot.",
        tone: web ? "neutral" : "success",
      })
    } finally {
      setChecking(false)
    }
  }, [checkWeb])

  const desktopReady = desktop?.status === "available"
  const applyUpdate = useCallback(() => {
    const bridge = desktopBridge()
    if (desktopReady && bridge?.installUpdate) void bridge.installUpdate()
    else reloadPage()
  }, [desktopReady])

  return (
    <UpdateContext.Provider
      value={{
        updateReady: webUpdate || desktopReady,
        checking,
        appVersion,
        desktop,
        checkForUpdates,
        applyUpdate,
      }}
    >
      {children}
      <UpdateToast
        desktop={desktop}
        laterVersion={laterVersion}
        onLater={setLaterVersion}
        webUpdate={webUpdate && !webDismissed}
        onDismissWeb={() => setWebDismissed(true)}
      />
    </UpdateContext.Provider>
  )
}

export function useAppUpdate(): UpdateContextType {
  const context = useContext(UpdateContext)
  return (
    context ?? {
      updateReady: false,
      checking: false,
      appVersion: null,
      desktop: null,
      checkForUpdates: async () => {},
      applyUpdate: () => window.location.reload(),
    }
  )
}

const card =
  "fixed bottom-5 right-5 z-[100] flex w-[min(92vw,360px)] items-start gap-3 rounded-2xl border border-line-strong bg-panel/95 px-4 py-3 shadow-[0_16px_48px_rgba(0,0,0,0.6)] backdrop-blur-xl"
const primary =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-text px-2.5 py-1.5 text-[12px] font-semibold text-void transition-colors hover:bg-white"
const quiet = "rounded-md p-1 text-faint transition-colors hover:bg-raised hover:text-text"

function UpdateToast({
  desktop,
  laterVersion,
  onLater,
  webUpdate,
  onDismissWeb,
}: {
  desktop: DesktopUpdateState | null
  laterVersion: string | null
  onLater: (version: string) => void
  webUpdate: boolean
  onDismissWeb: () => void
}) {
  const install = () => void desktopBridge()?.installUpdate?.()

  if (desktop?.status === "downloading" || desktop?.status === "installing") {
    const percent = desktop.status === "downloading" ? desktop.percent : 100
    return (
      <div role="status" className={card}>
        <ArrowDownToLine className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-text">
            {desktop.status === "installing"
              ? `Installing Sayabot ${desktop.latest}…`
              : `Downloading Sayabot ${desktop.latest}${percent !== null ? ` · ${percent}%` : "…"}`}
          </p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
            <div
              className={cn("h-full rounded-full bg-accent transition-[width]", percent === null && "w-1/3 animate-pulse")}
              style={percent !== null ? { width: `${Math.max(3, percent)}%` } : undefined}
            />
          </div>
          <p className="mt-1.5 text-[11.5px] text-faint">
            {desktop.status === "installing"
              ? "Sayabot closes and reopens by itself in a moment."
              : "Keep working. Sayabot restarts by itself when it is ready."}
          </p>
        </div>
      </div>
    )
  }

  if (desktop?.status === "error" && desktop.latest && laterVersion !== `error:${desktop.latest}`) {
    return (
      <div role="alert" className={card}>
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-danger" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-text">Sayabot {desktop.latest} didn&apos;t install</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{desktop.message}</p>
          <button type="button" onClick={install} className={cn(primary, "mt-2")}>
            <RefreshCw className="h-3 w-3" />
            Try again
          </button>
        </div>
        <button type="button" onClick={() => onLater(`error:${desktop.latest}`)} aria-label="Dismiss" className={quiet}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  if (desktop?.status === "available" && laterVersion !== desktop.latest) {
    return (
      <div role="alert" className={card}>
        <span className="relative mt-1 flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-text">Sayabot {desktop.latest} for Mac is ready</p>
          <p className="mt-0.5 text-[12px] text-muted">
            You have {desktop.current}. It installs in about a minute and reopens by itself.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={install} className={primary}>
              <ArrowDownToLine className="h-3 w-3" />
              Install
            </button>
            <button
              type="button"
              onClick={() => onLater(desktop.latest)}
              className="rounded-lg px-2 py-1.5 text-[12px] text-muted hover:text-text"
            >
              Later
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (webUpdate) {
    return (
      <div role="alert" className={cn(card, "items-center")}>
        <span className="h-2 w-2 shrink-0 rounded-full bg-ok" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-text">Sayabot was updated</p>
          <p className="text-[12px] text-muted">Reload to get the newest version.</p>
        </div>
        <button type="button" onClick={reloadPage} className={primary}>
          <RefreshCw className="h-3 w-3" />
          Reload
        </button>
        <button type="button" onClick={onDismissWeb} aria-label="Dismiss" className={quiet}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return null
}
