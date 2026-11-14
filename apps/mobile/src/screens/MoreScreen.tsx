import React from "react"
import { ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import * as LocalAuthentication from "expo-local-authentication"
import { BarChart3, Bot, CalendarClock, DownloadCloud, Fingerprint, Laptop, LogOut, Moon, Settings2, Smartphone, Store, Vibrate } from "lucide-react-native"
import { useAppUpdates } from "../hooks/useAppUpdates"
import { useAuth } from "../hooks/useAuth"
import { compactNumber, useHome } from "../hooks/useHome"
import { useSettings } from "../hooks/useSettings"
import { Group, Row, ToggleRow, Chip } from "../ui/controls"
import { setHapticsEnabled } from "../ui/haptics"
import { PersonAvatar } from "../ui/Mascot"
import { Text } from "../ui/Text"
import { space, useTheme } from "../ui/theme"

const ICON = { size: 16, color: "#ffffff" }

/** Everything that isn't a chat: workspace tools, this phone's settings, and your account. */
export function MoreScreen({ navigation }: any) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { data } = useHome()
  const { settings, updateSettings } = useSettings()
  const { signOut } = useAuth()
  const { isChecking, isUpdateAvailable, latestVersion, currentVersion, checkForUpdates } = useAppUpdates()
  const page = (path: string, title: string) => navigation.navigate("WebPage", { path: `/${data?.org.slug ?? settings.orgSlug}${path}`, title })
  const totals = (data?.agents ?? []).reduce(
    (acc, a) => ({ tokens: acc.tokens + (a.usage?.tokens ?? 0), cost: acc.cost + (a.usage?.costUsd ?? 0) }),
    { tokens: 0, cost: 0 },
  )

  async function toggleLock(on: boolean) {
    if (on) {
      const ok = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync())
      if (!ok) return
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: "Turn on app lock" })
      if (!res.success) return
    }
    await updateSettings({ appLock: on })
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: space.lg, paddingBottom: 120 }}>
      <Text variant="largeTitle" accessibilityRole="header" style={{ marginBottom: space.lg }}>
        More
      </Text>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: space.xl }}>
        <PersonAvatar name={data?.user.name ?? "You"} size={52} />
        <View style={{ flex: 1 }}>
          <Text variant="headline">{data?.user.name ?? "You"}</Text>
          <Text variant="footnote" tone="muted">
            {data?.user.email}
          </Text>
        </View>
      </View>

      <Group title={data?.org.name ?? "Workspace"}>
        <Row icon={<Laptop {...ICON} />} iconBg="#5b9df5" title="Computers" subtitle="Remote desktop and agents on your Mac" onPress={() => navigation.navigate("Computers")} />
        <Row icon={<BarChart3 {...ICON} />} iconBg="#4fcdb0" title="Usage" value={`${compactNumber(totals.tokens)} · $${totals.cost.toFixed(2)}`} onPress={() => navigation.navigate("Usage")} />
        <Row icon={<Bot {...ICON} />} iconBg="#b79cf0" title="Agents" subtitle="Models, create or invite" onPress={() => page("/agents", "Agents")} />
        <Row icon={<Store {...ICON} />} iconBg="#f2c14e" title="Marketplace" subtitle="Apps and ready-made agents" onPress={() => page("/marketplace", "Marketplace")} />
        <Row icon={<CalendarClock {...ICON} />} iconBg="#ff7a70" title="Routines" subtitle="Things agents do on a schedule" onPress={() => page("/cron", "Routines")} />
      </Group>

      <Group title="This phone">
        <View style={{ paddingHorizontal: space.lg, paddingVertical: 12, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: "#6d6d75", alignItems: "center", justifyContent: "center" }}>
              <Moon {...ICON} />
            </View>
            <Text variant="callout">Appearance</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {(["system", "light", "dark", "oled"] as const).map((mode) => (
              <Chip
                key={mode}
                label={mode === "system" ? "Automatic" : mode === "oled" ? "Black" : mode[0]!.toUpperCase() + mode.slice(1)}
                selected={settings.themeMode === mode}
                onPress={() => void updateSettings({ themeMode: mode })}
              />
            ))}
          </View>
        </View>
        <ToggleRow
          icon={<Vibrate {...ICON} />}
          iconBg="#ff7a70"
          title="Haptics"
          value={settings.hapticsEnabled}
          onChange={(v) => {
            setHapticsEnabled(v)
            void updateSettings({ hapticsEnabled: v })
          }}
        />
        <ToggleRow icon={<Fingerprint {...ICON} />} iconBg="#7fce95" title="App lock" subtitle="Face ID or fingerprint to open Sayabot" value={settings.appLock} onChange={(v) => void toggleLock(v)} />
        <Row
          icon={<DownloadCloud {...ICON} />}
          iconBg="#34d399"
          title="Check for updates"
          subtitle={
            isChecking
              ? "Checking for updates…"
              : isUpdateAvailable
                ? `Update available (v${latestVersion})`
                : `Sayabot v${currentVersion} (Latest)`
          }
          onPress={() => void checkForUpdates(true)}
        />
        <Row icon={<Smartphone {...ICON} />} iconBg="#ee5fb8" title="Phones signed in" onPress={() => page("/settings/phones", "Phones")} />
        <Row icon={<Settings2 {...ICON} />} iconBg="#85858d" title="Advanced" subtitle="Server address, notifications, diagnostics" onPress={() => navigation.navigate("AdvancedSettings")} />
      </Group>

      <Group>
        <Row icon={<LogOut size={16} color={theme.danger} />} title="Sign out" destructive chevron={false} onPress={() => void signOut()} />
      </Group>
    </ScrollView>
  )
}
