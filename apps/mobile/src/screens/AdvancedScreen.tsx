import React, { useState } from "react"
import { Alert, ScrollView, TextInput, View } from "react-native"
import { BellRing, DownloadCloud, Server, Wifi } from "lucide-react-native"
import { disablePush, enablePush } from "../core/push"
import { useAppUpdates } from "../hooks/useAppUpdates"
import { useSettings } from "../hooks/useSettings"
import { Button, Group, Row, ToggleRow } from "../ui/controls"
import { Text } from "../ui/Text"
import { radius, space, useTheme } from "../ui/theme"

/** The few technical settings people occasionally need, in plain words. */
export function AdvancedScreen() {
  const theme = useTheme()
  const { settings, updateSettings, runDiagnostics, gatewayPing, databasePing, testingConnection, resetAll } = useSettings()
  const { isChecking, isUpdateAvailable, latestVersion, currentVersion, checkForUpdates } = useAppUpdates()
  const [server, setServer] = useState(settings.webApiUrl)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushNote, setPushNote] = useState<string | null>(null)

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Group title="Notifications" footer={pushNote ?? "Questions and approvals reach this phone, with Answer and Allow right on the alert."}>
        <ToggleRow
          icon={<BellRing size={16} color={theme.text} />}
          title="Alerts on this phone"
          value={settings.pushNotifications}
          onChange={async (on) => {
            setPushBusy(true)
            try {
              if (on) await enablePush()
              else await disablePush()
              await updateSettings({ pushNotifications: on })
              setPushNote(on ? "Alerts are on." : "Alerts are off for this phone.")
            } catch (err) {
              setPushNote(err instanceof Error ? err.message : "Couldn't change alerts")
            } finally {
              setPushBusy(false)
            }
          }}
        />
        {pushBusy ? <Row title="Working…" chevron={false} /> : null}
      </Group>

      <Group title="Server" footer="Only change this if your workspace runs on your own server.">
        <View style={{ padding: space.lg, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Server size={16} color={theme.muted} />
            <TextInput
              value={server}
              onChangeText={setServer}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={{ flex: 1, height: 44, borderRadius: radius.md, backgroundColor: theme.raised, paddingHorizontal: 12, color: theme.text }}
            />
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              title="Save"
              size="sm"
              disabled={server.trim() === settings.webApiUrl}
              onPress={() => {
                const next = server.trim().replace(/\/+$/, "")
                if (!/^https?:\/\//i.test(next)) return Alert.alert("Use an address that starts with https://")
                void updateSettings({ webApiUrl: next })
              }}
            />
            <Button title="Test connection" size="sm" variant="secondary" loading={testingConnection} icon={<Wifi size={14} color={theme.text} />} onPress={() => void runDiagnostics(server.trim())} />
          </View>
          {gatewayPing || databasePing ? (
            <Text variant="footnote" tone={gatewayPing?.ok && databasePing?.ok ? "ok" : "danger"}>
              Server {gatewayPing?.ok ? `OK (${gatewayPing.latencyMs} ms)` : "unreachable"} · Data {databasePing?.ok ? `OK (${databasePing.latencyMs} ms)` : "unreachable"}
            </Text>
          ) : null}
        </View>
      </Group>

      <Group title="App Updates" footer={`Installed version: v${currentVersion}`}>
        <Row
          icon={<DownloadCloud size={16} color={theme.text} />}
          title="Check for updates"
          subtitle={
            isChecking
              ? "Checking for updates…"
              : isUpdateAvailable
                ? `Update available (v${latestVersion})`
                : "You are on the latest version"
          }
          onPress={() => void checkForUpdates(true)}
        />
      </Group>

      <Group>
        <Row
          title="Reset this app"
          subtitle="Clears settings on this phone. Your chats and agents are safe."
          destructive
          chevron={false}
          onPress={() =>
            Alert.alert("Reset Sayabot on this phone?", "Your workspace isn't affected.", [
              { text: "Cancel", style: "cancel" },
              { text: "Reset", style: "destructive", onPress: () => void resetAll() },
            ])
          }
        />
      </Group>
    </ScrollView>
  )
}
