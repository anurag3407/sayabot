"use client"

import { useEffect, useRef } from "react"
import { showToast } from "./ui/toast"

export function PwaUpdatePrompt() {
  const hasPrompted = useRef(false)

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      Boolean((window as any).sayabotDesktop) ||
      process.env.NODE_ENV === "development"
    ) {
      return
    }

    const notifyUpdate = () => {
      if (hasPrompted.current) return
      hasPrompted.current = true

      showToast({
        message: "A new version of Sayabot is available.",
        tone: "neutral",
        action: {
          label: "Refresh to Update",
          onClick: () => {
            if ("serviceWorker" in navigator) {
              navigator.serviceWorker.getRegistration().then((reg) => {
                if (reg?.waiting) {
                  reg.waiting.postMessage({ type: "SKIP_WAITING" })
                }
              })
            }
            window.location.reload()
          },
        },
        durationMs: 30_000,
      })
    }

    let intervalId: NodeJS.Timeout | undefined

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        // 1. Detect if an update is found during installation
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing
          if (!newWorker) return

          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              notifyUpdate()
            }
          })
        })

        // 2. Poll for updates periodically (every 30 minutes)
        intervalId = setInterval(() => {
          reg.update().catch(() => {})
        }, 30 * 60 * 1000)

        // 3. Check for update when user refocuses the tab / Mac app
        const handleVisibilityChange = () => {
          if (document.visibilityState === "visible") {
            reg.update().catch(() => {})
          }
        }
        document.addEventListener("visibilitychange", handleVisibilityChange)

        return () => {
          document.removeEventListener("visibilitychange", handleVisibilityChange)
        }
      })
      .catch((err) => {
        console.warn("[PWA] Service worker registration failed:", err)
      })

    // 4. Controller change listener (triggered when skipWaiting takes effect)
    const handleControllerChange = () => {
      notifyUpdate()
    }
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange)

    return () => {
      if (intervalId) clearInterval(intervalId)
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange)
    }
  }, [])

  return null
}
