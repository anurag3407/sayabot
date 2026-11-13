import React, { useCallback, useEffect, useState } from "react"
import { RefreshControl, ScrollView, View } from "react-native"
import { Cloud, Laptop, MonitorPlay } from "lucide-react-native"
import { api } from "../core/api"
import { useSettings } from "../hooks/useSettings"
import { Button, EmptyState, Group, Row } from "../ui/controls"
import { Text } from "../ui/Text"
import { space, useTheme } from "../ui/theme"

interface Mac {
  id: string
  name: string
  platform: string
  online: boolean
  mine: boolean
  ownerName: string | null
  permissions: Record<string, string>
  localAgents: Array<{ id: string; name: string; status: string }>
  settings: { runnerEnabled?: boolean; askOnComputer?: boolean }
}
interface CloudComputer {
  agentId: string
  name: string
  status: string
  diskUsedMb: number
  diskMb: number
}

/** Your Macs (open the screen, run agents there) and agents' own cloud computers. */
export function ComputersScreen({ navigation }: any) {
  const theme = useTheme()
  const { settings } = useSettings()
  const [macs, setMacs] = useState<Mac[]>([])
  const [cloud, setCloud] = useState<CloudComputer[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api<{ macs: Mac[]; cloud: CloudComputer[] }>(`/api/mobile/computers?orgSlug=${encodeURIComponent(settings.orgSlug)}`)
      setMacs(data.macs)
      setCloud(data.cloud)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load computers")
    } finally {
      setLoaded(true)
    }
  }, [settings.orgSlug])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 15_000)
    return () => clearInterval(t)
  }, [load])

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} />}
    >
      {error ? (
        <Text variant="footnote" tone="danger" style={{ marginBottom: space.md }}>
          {error}
        </Text>
      ) : null}

      <Group title="Your Macs" footer="Open Sayabot for Mac on a computer and sign in. It shows up here.">
        {macs.length === 0 && loaded ? <Row title="No computers yet" subtitle="Install Sayabot for Mac to see and control it from here." chevron={false} /> : null}
        {macs.map((mac) => (
          <View key={mac.id} style={{ padding: space.lg, gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: theme.raised, alignItems: "center", justifyContent: "center" }}>
                <Laptop size={20} color={theme.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="headline">{mac.name}</Text>
                <Text variant="footnote" tone={mac.online ? "ok" : "faint"}>
                  {mac.online ? "Online" : "Offline"}
                  {!mac.mine && mac.ownerName ? ` · ${mac.ownerName}'s` : ""}
                  {mac.settings.runnerEnabled ? " · runs agents" : ""}
                </Text>
              </View>
            </View>
            {mac.localAgents.length ? (
              <Text variant="caption" tone="muted">
                Signed in here: {mac.localAgents.filter((a) => a.status === "ready").map((a) => a.name).join(", ") || "none yet"}
              </Text>
            ) : null}
            {mac.mine && (mac.permissions.screen !== "granted" || mac.permissions.accessibility !== "granted") ? (
              <Text variant="caption" tone="warn">
                On the Mac, allow Screen Recording and Accessibility for Sayabot to see and control it.
              </Text>
            ) : null}
            <Button
              title={mac.online ? "Open screen" : "Offline"}
              size="sm"
              disabled={!mac.online}
              icon={<MonitorPlay size={16} color={theme.onAccent} />}
              onPress={() => navigation.navigate("WebPage", { path: `/${settings.orgSlug}/remote/${mac.id}`, title: mac.name })}
            />
          </View>
        ))}
      </Group>

      <Group title="Agents' cloud computers">
        {cloud.length === 0 && loaded ? <Row title="None running" subtitle="Agents with a computer get one when they first need it." chevron={false} /> : null}
        {cloud.map((c) => (
          <Row
            key={c.agentId}
            icon={<Cloud size={16} color={theme.text} />}
            title={c.name}
            subtitle={`${c.status === "running" ? "Running" : c.status === "none" ? "Not started" : c.status} · ${Math.round(c.diskUsedMb)} of ${Math.round(c.diskMb / 1024)} GB used`}
            chevron={false}
          />
        ))}
      </Group>
      {!loaded ? <EmptyState title="Loading…" /> : null}
    </ScrollView>
  )
}
