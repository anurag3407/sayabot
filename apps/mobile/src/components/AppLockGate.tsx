import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { AppState, View } from "react-native"
import * as LocalAuthentication from "expo-local-authentication"
import { Lock } from "lucide-react-native"
import { useSettings } from "../hooks/useSettings"
import { Button } from "../ui/controls"
import { Text } from "../ui/Text"
import { useTheme } from "../ui/theme"

const RELOCK_AFTER_MS = 60_000

/** With App lock on, Sayabot asks for Face ID / fingerprint on open and after a minute away. */
export function AppLockGate({ children }: { children: ReactNode }) {
  const { settings, loading } = useSettings()
  const theme = useTheme()
  const [locked, setLocked] = useState(false)
  const leftAt = useRef<number | null>(null)
  const checkedOnce = useRef(false)

  const unlock = useCallback(async () => {
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Sayabot", fallbackLabel: "Use passcode" })
    if (res.success) setLocked(false)
  }, [])

  useEffect(() => {
    if (loading || checkedOnce.current) return
    checkedOnce.current = true
    if (settings.appLock) {
      setLocked(true)
      void unlock()
    }
  }, [loading, settings.appLock, unlock])

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (!settings.appLock) return
      if (state === "background") leftAt.current = Date.now()
      if (state === "active" && leftAt.current && Date.now() - leftAt.current > RELOCK_AFTER_MS) {
        setLocked(true)
        void unlock()
      }
    })
    return () => sub.remove()
  }, [settings.appLock, unlock])

  return (
    <View style={{ flex: 1 }}>
      {children}
      {locked ? (
        <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center", gap: 14, padding: 32 }}>
          <Lock size={40} color={theme.muted} />
          <Text variant="title" center>
            Sayabot is locked
          </Text>
          <Button title="Unlock" onPress={() => void unlock()} style={{ alignSelf: "stretch" }} />
        </View>
      ) : null}
    </View>
  )
}
