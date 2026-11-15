import { useCallback, useSyncExternalStore } from "react"
import { Alert, Platform } from "react-native"
import * as Updates from "expo-updates"
import Constants from "expo-constants"
import { ENV } from "../config/env"
import { useSettings } from "./useSettings"
import { isNewerVersion, resolveApkUrl } from "../core/app-version"
import { downloadAndInstallApk } from "../core/apk-install"

export const CURRENT_APP_VERSION = Constants.expoConfig?.version ?? "1.2.0"

export interface UpdateStatus {
  isChecking: boolean
  isUpdateAvailable: boolean
  isDownloading: boolean
  isDownloaded: boolean
  /** 0..1 while an APK downloads, otherwise null. */
  downloadProgress: number | null
  updateType: "ota" | "apk" | null
  latestVersion?: string
  apkUrl?: string
  releaseNotes?: string
  errorMessage?: string
  /** Hides the banner for this update until the next launch. */
  dismissed: boolean
  lastCheckedAt: number | null
}

// One store for the whole app: the root banner, More and Advanced all see the same update.
let state: UpdateStatus = {
  isChecking: false,
  isUpdateAvailable: false,
  isDownloading: false,
  isDownloaded: false,
  downloadProgress: null,
  updateType: null,
  dismissed: false,
  lastCheckedAt: null,
}
const listeners = new Set<() => void>()
function setState(patch: Partial<UpdateStatus>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const getSnapshot = () => state

let inflight: Promise<void> | null = null

async function installApk(serverBase: string) {
  if (!state.apkUrl || state.isDownloading) return
  const url = resolveApkUrl(serverBase, state.apkUrl)
  setState({ isDownloading: true, downloadProgress: 0, errorMessage: undefined })
  try {
    await downloadAndInstallApk(url, state.latestVersion ?? "latest", (fraction) =>
      setState({ downloadProgress: fraction }),
    )
  } catch (err: unknown) {
    setState({ errorMessage: err instanceof Error ? err.message : "Couldn't download the update" })
  } finally {
    setState({ isDownloading: false, downloadProgress: null })
  }
}

async function runCheck(serverBase: string, manual: boolean) {
  setState({ isChecking: true, errorMessage: undefined, lastCheckedAt: Date.now() })

  // 1. Over-the-air JS update: downloads silently, applies on restart (or the next launch).
  if (Updates.isEnabled) {
    try {
      const check = await Updates.checkForUpdateAsync()
      if (check.isAvailable) {
        setState({ isDownloading: true, isUpdateAvailable: true, updateType: "ota" })
        await Updates.fetchUpdateAsync()
        setState({ isChecking: false, isDownloading: false, isDownloaded: true })
        if (manual) {
          Alert.alert("Update ready", "Restart Sayabot to use the new version?", [
            { text: "Later", style: "cancel" },
            { text: "Restart", onPress: () => void Updates.reloadAsync() },
          ])
        }
        return
      }
    } catch (err: unknown) {
      console.warn("[Updates] OTA check skipped or failed:", err)
    }
  }

  // 2. A new APK (native changes). Android only: iOS updates come through the App Store.
  let fetchFailed = false
  if (Platform.OS === "android") {
    try {
      const res = await fetch(`${serverBase}/api/mobile/version`, {
        headers: { Accept: "application/json" },
      })
      if (res.ok) {
        const data = (await res.json()) as {
          latestVersion?: string
          apkUrl?: string
          releaseNotes?: string
        }
        if (
          data.latestVersion &&
          data.apkUrl &&
          isNewerVersion(CURRENT_APP_VERSION, data.latestVersion)
        ) {
          setState({
            isChecking: false,
            isUpdateAvailable: true,
            updateType: "apk",
            latestVersion: data.latestVersion,
            apkUrl: data.apkUrl,
            releaseNotes: data.releaseNotes,
          })
          if (manual) {
            Alert.alert(
              `Sayabot ${data.latestVersion} is available`,
              data.releaseNotes || "A new version of Sayabot is ready to install.",
              [
                { text: "Later", style: "cancel" },
                { text: "Install", onPress: () => void installApk(serverBase) },
              ],
            )
          }
          return
        }
      } else {
        fetchFailed = true
      }
    } catch (err: unknown) {
      console.warn("[Updates] Version check failed:", err)
      fetchFailed = true
    }
  }

  setState({ isChecking: false, isUpdateAvailable: false, updateType: null })
  if (manual) {
    if (fetchFailed) {
      Alert.alert(
        "Couldn't check for updates",
        `Couldn't reach ${serverBase}. Check your connection.`,
      )
    } else {
      Alert.alert("You're up to date", `Sayabot ${CURRENT_APP_VERSION} is the latest version.`)
    }
  }
}

export function useAppUpdates() {
  const { settings } = useSettings()
  const status = useSyncExternalStore(subscribe, getSnapshot)
  const serverBase = (settings.webApiUrl || ENV.WEB_API_URL).replace(/\/+$/, "")

  const checkForUpdates = useCallback(
    async (manual = false) => {
      if (inflight) {
        await inflight
        if (!manual) return
      }
      inflight = runCheck(serverBase, manual).finally(() => {
        inflight = null
      })
      await inflight
    },
    [serverBase],
  )

  const applyUpdate = useCallback(async () => {
    if (state.updateType === "ota" && state.isDownloaded) {
      await Updates.reloadAsync()
    } else if (state.updateType === "apk") {
      await installApk(serverBase)
    }
  }, [serverBase])

  const dismiss = useCallback(() => setState({ dismissed: true }), [])

  return {
    ...status,
    currentVersion: CURRENT_APP_VERSION,
    checkForUpdates,
    applyUpdate,
    dismiss,
  }
}
