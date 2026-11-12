import React, { useState } from "react"
import { View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import * as LocalAuthentication from "expo-local-authentication"
import { useSettings } from "../hooks/useSettings"
import { Button, Chip } from "../ui/controls"
import { haptic } from "../ui/haptics"
import { Mascot } from "../ui/Mascot"
import { Text } from "../ui/Text"
import { space, useTheme } from "../ui/theme"

const STEPS = ["hello", "how", "look"] as const

/** A short first-run: what Sayabot is, how it works from the phone, and making it yours. */
export function OnboardingScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { settings, updateSettings } = useSettings()
  const [step, setStep] = useState(0)
  const current = STEPS[step]!

  async function finish() {
    haptic.success()
    await updateSettings({ onboarded: true })
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16, paddingHorizontal: space.xl }}>
      <View style={{ flexDirection: "row", gap: 6, justifyContent: "center" }}>
        {STEPS.map((s, i) => (
          <View key={s} style={{ width: i === step ? 22 : 7, height: 7, borderRadius: 4, backgroundColor: i <= step ? theme.accent : theme.lineStrong }} />
        ))}
      </View>

      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: 14 }}>
        {current === "hello" ? (
          <>
            <View style={{ flexDirection: "row", marginBottom: 8 }}>
              <Mascot seed="hermes" size={72} />
              <Mascot seed="scout" size={72} working />
              <Mascot seed="writer" size={72} />
            </View>
            <Text variant="largeTitle" center>
              Your AI team, in your pocket
            </Text>
            <Text variant="body" tone="muted" center>
              Your agents work in chats, like teammates. They ask when they need you, and you answer from here.
            </Text>
          </>
        ) : null}
        {current === "how" ? (
          <>
            <Text variant="title" center>
              Three things you'll do most
            </Text>
            {[
              ["Answer", "When an agent needs a fact or a yes/no, it shows in your Inbox. Answer once; it remembers."],
              ["Hand out work", "New task → pick who should do it. They start right away, even on your own computer."],
              ["Check in", "Open a chat to see what's happening. A pulsing ring means an agent is working."],
            ].map(([title, body]) => (
              <View key={title} style={{ alignSelf: "stretch", backgroundColor: theme.card, borderRadius: 18, padding: space.lg, gap: 4 }}>
                <Text variant="headline">{title}</Text>
                <Text variant="subhead" tone="muted">
                  {body}
                </Text>
              </View>
            ))}
          </>
        ) : null}
        {current === "look" ? (
          <>
            <Text variant="title" center>
              Make it yours
            </Text>
            <Text variant="subhead" tone="muted" center>
              You can change these any time in More.
            </Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 8 }}>
              {(["system", "light", "dark"] as const).map((mode) => (
                <Chip key={mode} label={mode === "system" ? "Automatic" : mode[0]!.toUpperCase() + mode.slice(1)} selected={settings.themeMode === mode} onPress={() => void updateSettings({ themeMode: mode })} />
              ))}
            </View>
            <Chip
              label={settings.appLock ? "App lock on" : "Lock with Face ID / fingerprint"}
              selected={settings.appLock}
              onPress={async () => {
                if (settings.appLock) return void updateSettings({ appLock: false })
                const ok = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync())
                if (!ok) return
                const res = await LocalAuthentication.authenticateAsync({ promptMessage: "Turn on app lock" })
                if (res.success) void updateSettings({ appLock: true })
              }}
            />
          </>
        ) : null}
      </View>

      <Button title={step < STEPS.length - 1 ? "Continue" : "Get started"} size="lg" onPress={() => (step < STEPS.length - 1 ? setStep(step + 1) : void finish())} />
      {step < STEPS.length - 1 ? <Button title="Skip" variant="ghost" onPress={() => void finish()} style={{ marginTop: 6 }} /> : null}
    </View>
  )
}
