import { useState, useEffect, useCallback } from "react"
import { Alert, Linking } from "react-native"
import * as Updates from "expo-updates"
import Constants from "expo-constants"
import { ENV } from "../config/env"
import { useSettings } from "./useSettings"

export const CURRENT_APP_VERSION = Constants.expoConfig?.version ?? "1.1.0"

export interface UpdateStatus {
  isChecking: boolean
  isUpdateAvailable: boolean
  isDownloading: boolean
  isDownloaded: boolean
  updateType: "ota" | "apk" | null
  latestVersion?: string
  apkUrl?: string
  releaseNotes?: string
  errorMessage?: string
}

function parseSemver(v: string): [number, number, number] {
  const parts = v
    .replace(/^v/, "")
    .split(".")
    .map((x) => parseInt(x, 10) || 0)
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

function isNewerVersion(current: string, latest: string): boolean {
  const [cMaj, cMin, cPat] = parseSemver(current)
  const [lMaj, lMin, lPat] = parseSemver(latest)
  if (lMaj > cMaj) return true
  if (lMaj === cMaj && lMin > cMin) return true
  if (lMaj === cMaj && lMin === cMin && lPat > cPat) return true
  return false
}

export function useAppUpdates() {
  const { settings } = useSettings()
  const [status, setStatus] = useState<UpdateStatus>({
    isChecking: false,
    isUpdateAvailable: false,
    isDownloading: false,
    isDownloaded: false,
    updateType: null,
  })

  const checkForUpdates = useCallback(
    async (manual = false) => {
      setStatus((prev) => ({ ...prev, isChecking: true, errorMessage: undefined }))

      // 1. Check Expo OTA Updates (Over-The-Air)
      if (Updates.isEnabled) {
        try {
          const updateCheck = await Updates.checkForUpdateAsync()
          if (updateCheck.isAvailable) {
            setStatus((prev) => ({
              ...prev,
              isChecking: false,
              isDownloading: true,
              isUpdateAvailable: true,
              updateType: "ota",
            }))

            await Updates.fetchUpdateAsync()

            setStatus((prev) => ({
              ...prev,
              isDownloading: false,
              isDownloaded: true,
            }))

            Alert.alert(
              "Update Ready",
              "A new update has been downloaded. Restart Sayabot now to apply changes?",
              [
                { text: "Later", style: "cancel" },
                {
                  text: "Restart Now",
                  onPress: () => Updates.reloadAsync(),
                },
              ]
            )
            return
          }
        } catch (err: unknown) {
          console.warn("[Updates] OTA check skipped or failed:", err)
        }
      }

      // 2. Check Self-Hosted Backend for Full APK Releases
      const baseUrl = (settings.webApiUrl || ENV.WEB_API_URL).replace(/\/+$/, "")
      let fetchFailed = false
      try {
        const res = await fetch(`${baseUrl}/api/mobile/version`, {
          headers: { Accept: "application/json" },
        })

        if (res.ok) {
          const data = await res.json()
          if (data?.latestVersion && isNewerVersion(CURRENT_APP_VERSION, data.latestVersion)) {
            setStatus({
              isChecking: false,
              isUpdateAvailable: true,
              isDownloading: false,
              isDownloaded: false,
              updateType: "apk",
              latestVersion: data.latestVersion,
              apkUrl: data.apkUrl,
              releaseNotes: data.releaseNotes,
            })

            if (manual) {
              Alert.alert(
                `Version ${data.latestVersion} Available`,
                data.releaseNotes || "A new version of the Sayabot APK is available for download.",
                [
                  { text: "Later", style: "cancel" },
                  {
                    text: "Download APK",
                    onPress: () => {
                      const target = data.apkUrl?.startsWith("http")
                        ? data.apkUrl
                        : `${baseUrl}${data.apkUrl}`
                      Linking.openURL(target)
                    },
                  },
                ]
              )
            }
            return
          }
        } else {
          fetchFailed = true
        }
      } catch (err: unknown) {
        console.warn("[Updates] Self-hosted version check failed:", err)
        fetchFailed = true
      }

      setStatus((prev) => ({
        ...prev,
        isChecking: false,
        isUpdateAvailable: false,
        updateType: null,
      }))

      if (manual) {
        if (fetchFailed) {
          Alert.alert(
            "Update Check Failed",
            `Could not connect to update server at ${baseUrl}. Check your network connection.`
          )
        } else {
          Alert.alert(
            "Up to Date",
            `Sayabot is currently at the latest version (${CURRENT_APP_VERSION}).`
          )
        }
      }
    },
    [settings.webApiUrl]
  )

  const applyUpdate = useCallback(async () => {
    const baseUrl = (settings.webApiUrl || ENV.WEB_API_URL).replace(/\/+$/, "")
    if (status.updateType === "ota" && status.isDownloaded) {
      await Updates.reloadAsync()
    } else if (status.updateType === "apk" && status.apkUrl) {
      const target = status.apkUrl.startsWith("http")
        ? status.apkUrl
        : `${baseUrl}${status.apkUrl}`
      await Linking.openURL(target)
    }
  }, [status, settings.webApiUrl])

  useEffect(() => {
    // Run quiet background check on start (wait 2s after launch)
    const timer = setTimeout(() => {
      void checkForUpdates(false)
    }, 2000)
    return () => clearTimeout(timer)
  }, [checkForUpdates])

  return {
    ...status,
    currentVersion: CURRENT_APP_VERSION,
    checkForUpdates,
    applyUpdate,
  }
}
