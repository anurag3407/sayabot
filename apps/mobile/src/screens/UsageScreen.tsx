import React, { useCallback, useEffect, useState } from "react"
import { RefreshControl, ScrollView, View } from "react-native"
import Svg, { Rect } from "react-native-svg"
import { api } from "../core/api"
import { compactNumber } from "../hooks/useHome"
import { useSettings } from "../hooks/useSettings"
import { Chip, Group, Row } from "../ui/controls"
import { Mascot } from "../ui/Mascot"
import { Text } from "../ui/Text"
import { radius, space, useTheme } from "../ui/theme"

interface UsageData {
  days: number
  totals: { tokens: number; costUsd: number; runs: number; cachedTokens: number }
  series: Array<{ day: string; tokens: number; cost: number; runs: number }>
  agents: Array<{ id: string; handle: string; name: string; tokens: number; runs: number; costUsd: number }>
  models: Array<{ model: string; provider: string; tokens: number; costUsd: number }>
}

function Bars({ values, color, height = 120 }: { values: number[]; color: string; height?: number }) {
  const theme = useTheme()
  const max = Math.max(1, ...values)
  const w = 100 / Math.max(1, values.length)
  return (
    <Svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
      {values.map((v, i) => {
        const h = v ? Math.max(2, (v / max) * (height - 4)) : 1
        return <Rect key={i} x={i * w + w * 0.15} y={height - h} width={w * 0.7} height={h} rx={Math.min(1.5, w * 0.3)} fill={v ? color : theme.line} />
      })}
    </Svg>
  )
}

/** Usage on the phone: exact totals, a daily chart in your time zone, and who used what. */
export function UsageScreen() {
  const theme = useTheme()
  const { settings } = useSettings()
  const [days, setDays] = useState(30)
  const [metric, setMetric] = useState<"tokens" | "cost">("tokens")
  const [data, setData] = useState<UsageData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await api<UsageData>(`/api/mobile/usage?orgSlug=${encodeURIComponent(settings.orgSlug)}&days=${days}&tzOffset=${new Date().getTimezoneOffset()}`))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load usage")
    }
  }, [settings.orgSlug, days])

  useEffect(() => {
    void load()
  }, [load])

  const values = (data?.series ?? []).map((d) => (metric === "tokens" ? d.tokens : d.cost))
  const maxAgent = Math.max(1, ...(data?.agents ?? []).map((a) => a.tokens))
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} />}
    >
      <View style={{ flexDirection: "row", gap: 8, marginBottom: space.lg }}>
        {[7, 30, 90].map((d) => (
          <Chip key={d} label={`${d} days`} selected={days === d} onPress={() => setDays(d)} />
        ))}
      </View>
      {error ? (
        <Text variant="footnote" tone="danger">
          {error}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 10, marginBottom: space.lg }}>
        {[
          ["Tokens", compactNumber(data?.totals.tokens ?? 0)],
          ["Spend", `$${(data?.totals.costUsd ?? 0).toFixed(2)}`],
          ["Runs", compactNumber(data?.totals.runs ?? 0)],
        ].map(([label, value]) => (
          <View key={label} style={{ flex: 1, backgroundColor: theme.card, borderRadius: radius.lg, padding: space.md }}>
            <Text variant="caption" tone="muted">
              {label}
            </Text>
            <Text variant="title">{value}</Text>
          </View>
        ))}
      </View>

      <View style={{ backgroundColor: theme.card, borderRadius: radius.lg, padding: space.lg, marginBottom: space.xl }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.md }}>
          <Text variant="headline" style={{ flex: 1 }}>
            Per day
          </Text>
          <Chip label="Tokens" selected={metric === "tokens"} onPress={() => setMetric("tokens")} />
          <View style={{ width: 6 }} />
          <Chip label="Cost" selected={metric === "cost"} onPress={() => setMetric("cost")} />
        </View>
        <Bars values={values} color={theme.accent} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
          <Text variant="caption" tone="faint">
            {data?.series[0]?.day.slice(5)}
          </Text>
          <Text variant="caption" tone="faint">
            Today
          </Text>
        </View>
      </View>

      <Group title="By agent">
        {(data?.agents ?? []).map((a) => (
          <View key={a.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: space.lg, paddingVertical: 10 }}>
            <Mascot seed={a.handle} size={28} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="callout">{a.name}</Text>
              <View style={{ height: 5, borderRadius: 3, backgroundColor: theme.raised, overflow: "hidden" }}>
                <View style={{ height: 5, width: `${Math.max(2, (a.tokens / maxAgent) * 100)}%`, backgroundColor: theme.accent }} />
              </View>
            </View>
            <Text variant="footnote" tone="muted">
              {compactNumber(a.tokens)} · ${a.costUsd.toFixed(2)}
            </Text>
          </View>
        ))}
        {!data?.agents.length ? <Row title="No usage yet" chevron={false} /> : null}
      </Group>

      <Group title="Top models">
        {(data?.models ?? []).map((m) => (
          <Row key={`${m.provider}:${m.model}`} title={m.model} subtitle={m.provider} value={`${compactNumber(m.tokens)} · $${m.costUsd.toFixed(2)}`} chevron={false} />
        ))}
      </Group>
    </ScrollView>
  )
}
