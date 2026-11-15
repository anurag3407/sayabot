import React, { useEffect, useRef } from "react"
import { AppState, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Download, RotateCw, X } from "lucide-react-native"
import { useAppUpdates } from "../hooks/useAppUpdates"
import { shouldQuietCheck } from "../core/app-version"
import { useTheme } from "../ui/theme"

/**
 * Mounted once at the app root. Checks for updates shortly after launch and whenever the app
 * comes back to the foreground (at most every 30 minutes), then offers a one-tap card:
 * "Restart" for a downloaded over-the-air update, "Install" for a new APK.
 */
export function UpdateBanner() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const {
    isUpdateAvailable,
    isDownloaded,
    isDownloading,
    downloadProgress,
    updateType,
    latestVersion,
    dismissed,
    lastCheckedAt,
    checkForUpdates,
    applyUpdate,
    dismiss,
  } = useAppUpdates()

  const lastChecked = useRef(lastCheckedAt)
  lastChecked.current = lastCheckedAt

  useEffect(() => {
    const timer = setTimeout(() => void checkForUpdates(false), 3000)
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && shouldQuietCheck(lastChecked.current, Date.now())) {
        void checkForUpdates(false)
      }
    })
    return () => {
      clearTimeout(timer)
      sub.remove()
    }
  }, [checkForUpdates])

  const ready = updateType === "ota" ? isDownloaded : updateType === "apk" && isUpdateAvailable
  if (!ready || dismissed) return null

  const title =
    updateType === "ota"
      ? "Update ready"
      : isDownloading
        ? (downloadProgress ?? 0) >= 1
          ? "Opening the installer…"
          : `Downloading ${Math.round((downloadProgress ?? 0) * 100)}%`
        : `Sayabot ${latestVersion ?? ""} is available`.trim()
  const action = updateType === "ota" ? "Restart" : isDownloading ? null : "Install"

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8 }]}>
      <View
        style={[styles.card, { backgroundColor: theme.raised, borderColor: theme.lineStrong }]}
        accessibilityLiveRegion="polite"
      >
        {updateType === "ota" ? (
          <RotateCw size={16} color={theme.accent} />
        ) : (
          <Download size={16} color={theme.accent} />
        )}
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {title}
        </Text>
        {action ? (
          <TouchableOpacity
            onPress={() => void applyUpdate()}
            style={[styles.action, { backgroundColor: theme.accent }]}
            activeOpacity={0.85}
          >
            <Text style={[styles.actionText, { color: theme.onAccent }]}>{action}</Text>
          </TouchableOpacity>
        ) : null}
        {!isDownloading ? (
          <TouchableOpacity onPress={dismiss} hitSlop={10} accessibilityLabel="Not now">
            <X size={16} color={theme.muted} />
          </TouchableOpacity>
        ) : null}
      </View>
      {isDownloading ? (
        <View style={[styles.track, { backgroundColor: theme.line }]}>
          <View
            style={[
              styles.fill,
              {
                backgroundColor: theme.accent,
                width: `${Math.round((downloadProgress ?? 0) * 100)}%`,
              },
            ]}
          />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 1000,
    elevation: 12,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 14,
    paddingRight: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
  },
  action: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
  },
  actionText: {
    fontSize: 13,
    fontWeight: "700",
  },
  track: {
    height: 3,
    borderRadius: 2,
    marginHorizontal: 14,
    marginTop: -3,
    overflow: "hidden",
  },
  fill: {
    height: 3,
  },
})
