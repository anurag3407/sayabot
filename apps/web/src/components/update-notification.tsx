"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { RefreshCw, X } from "lucide-react"
import { cn } from "@/lib/format"

export interface VersionData {
  version: string
  gitCommit: string
  buildTime: string
  latestDesktopVersion: string
  latestMobileVersion: string
  dmgUrl: string
  apkUrl: string
  releaseNotes?: string
}

interface UpdateContextType {
  updateReady: boolean
  dismissed: boolean
  checking: boolean
  lastChecked: Date | null
  versionData: VersionData | null
  checkForUpdates: () => Promise<boolean>
  restartToUpdate: () => void
  dismiss: () => void
}

const UpdateContext = createContext<UpdateContextType | null>(null)

const INITIAL_VERSION = "1.0.1"

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [updateReady, setUpdateReady] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [checking, setChecking] = useState(false)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [versionData, setVersionData] = useState<VersionData | null>(null)
  const [initialCommit, setInitialCommit] = useState<string | null>(null)

  const checkForUpdates = async (): Promise<boolean> => {
    setChecking(true)
    try {
      const res = await fetch(`/api/version?t=${Date.now()}`, {
        cache: "no-store",
      })
      if (!res.ok) return false
      const data: VersionData = await res.json()
      setVersionData(data)
      setLastChecked(new Date())

      // Record initial commit on first check
      if (!initialCommit && data.gitCommit) {
        setInitialCommit(data.gitCommit)
        return false
      }

      // If remote commit is newer or version differs, update is ready
      const isNewCommit = initialCommit && data.gitCommit && data.gitCommit !== initialCommit
      const isNewVersion = data.version && data.version !== INITIAL_VERSION

      if (isNewCommit || isNewVersion) {
        setUpdateReady(true)
        setDismissed(false)
        return true
      }
      return false
    } catch (err) {
      console.warn("[Sayabot] Version check failed:", err)
      return false
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    // Initial check on mount
    void checkForUpdates()

    // Poll every 5 minutes
    const interval = setInterval(() => {
      void checkForUpdates()
    }, 5 * 60 * 1000)

    // Check when user returns to tab
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkForUpdates()
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    // Listen to Serwist/Service Worker update events
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        setUpdateReady(true)
        setDismissed(false)
      })
    }

    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [initialCommit])

  const restartToUpdate = () => {
    // 1. If running inside Electron desktop shell
    const electronBridge = (window as any).sayabotDesktop
    if (electronBridge?.restartApp) {
      try {
        electronBridge.restartApp()
        return
      } catch (e) {
        console.warn("[Sayabot] Electron restart error:", e)
      }
    }

    // 2. If Service Worker is waiting, tell it to take over
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg?.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" })
        }
      })
    }

    // 3. Clear transient caches & reload fresh page
    try {
      if (typeof window !== "undefined" && "caches" in window) {
        caches.keys().then((keys) => {
          for (const key of keys) {
            caches.delete(key)
          }
        })
      }
    } catch {
      // ignore
    }

    window.location.reload()
  }

  const dismiss = () => {
    setDismissed(true)
  }

  return (
    <UpdateContext.Provider
      value={{
        updateReady,
        dismissed,
        checking,
        lastChecked,
        versionData,
        checkForUpdates,
        restartToUpdate,
        dismiss,
      }}
    >
      {children}
      <UpdateToast />
    </UpdateContext.Provider>
  )
}

export function useAppUpdate() {
  const context = useContext(UpdateContext)
  if (!context) {
    return {
      updateReady: false,
      dismissed: false,
      checking: false,
      lastChecked: null,
      versionData: null,
      checkForUpdates: async () => false,
      restartToUpdate: () => window.location.reload(),
      dismiss: () => {},
    }
  }
  return context
}

export function UpdateToast() {
  const { updateReady, dismissed, restartToUpdate, dismiss, versionData } = useAppUpdate()

  if (!updateReady || dismissed) return null

  const targetVersion = versionData?.version ? `v${versionData.version}` : "v1.0.2"

  return (
    <div
      role="alert"
      className={cn(
        "fixed bottom-6 right-6 z-[100] flex max-w-sm items-center gap-3.5 rounded-2xl border border-emerald-500/30 bg-[#070a07]/95 px-4 py-3 shadow-[0_16px_48px_rgba(0,0,0,0.8)] backdrop-blur-xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-4",
      )}
    >
      <div className="relative flex h-3 w-3 shrink-0 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-[12.5px] font-semibold text-text">Sayabot update ready</p>
          <span className="font-mono text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded font-medium">
            {targetVersion}
          </span>
        </div>
        <p className="text-[11px] text-muted truncate">
          A new version has been deployed.
        </p>
      </div>

      <div className="flex items-center gap-2 pl-1">
        <button
          type="button"
          onClick={restartToUpdate}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:scale-95 px-2.5 py-1.5 text-[11.5px] font-semibold text-black transition-all shadow-sm cursor-pointer"
        >
          <RefreshCw className="h-3 w-3" />
          Restart to update
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss notification"
          className="rounded-md p-1 text-muted hover:text-text hover:bg-white/5 transition-colors cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
