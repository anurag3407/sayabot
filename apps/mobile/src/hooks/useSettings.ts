import { useCallback, useEffect, useState } from "react"
import {
  type AppSettings,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  resetSettings,
  pingGateway,
  pingDatabase,
  type PingResult,
} from "../core/settings"

// Global listeners for reactive cross-component synchronization
type Listener = (settings: AppSettings) => void
const listeners = new Set<Listener>()

let cachedSettings: AppSettings = { ...DEFAULT_SETTINGS }
let hasInitialized = false

function notifyListeners(newSettings: AppSettings) {
  cachedSettings = newSettings
  listeners.forEach((listener) => listener(newSettings))
}

export function useSettings() {
  const [settings, setLocalSettings] = useState<AppSettings>(cachedSettings)
  const [loading, setLoading] = useState(!hasInitialized)
  const [gatewayPing, setGatewayPing] = useState<PingResult | null>(null)
  const [databasePing, setDatabasePing] = useState<PingResult | null>(null)
  const [testingConnection, setTestingConnection] = useState(false)

  useEffect(() => {
    const handleUpdate = (updated: AppSettings) => {
      setLocalSettings(updated)
    }

    listeners.add(handleUpdate)

    if (!hasInitialized) {
      loadSettings().then((loaded) => {
        hasInitialized = true
        notifyListeners(loaded)
        setLoading(false)
      })
    } else {
      setLocalSettings(cachedSettings)
      setLoading(false)
    }

    return () => {
      listeners.delete(handleUpdate)
    }
  }, [])

  const updateSettings = useCallback(async (partial: Partial<AppSettings>) => {
    const next = await saveSettings(partial)
    notifyListeners(next)
    return next
  }, [])

  const resetAll = useCallback(async () => {
    const fresh = await resetSettings()
    notifyListeners(fresh)
    return fresh
  }, [])

  const runDiagnostics = useCallback(async (customUrl?: string) => {
    setTestingConnection(true)
    try {
      const [gw, db] = await Promise.all([
        pingGateway(customUrl || cachedSettings.webApiUrl),
        pingDatabase(),
      ])
      setGatewayPing(gw)
      setDatabasePing(db)
      return { gateway: gw, database: db }
    } finally {
      setTestingConnection(false)
    }
  }, [])

  return {
    settings,
    loading,
    updateSettings,
    resetAll,
    runDiagnostics,
    gatewayPing,
    databasePing,
    testingConnection,
  }
}
