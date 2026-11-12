import React from "react"
import { ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Activity, ChevronLeft, Cpu, Hash, MessageCircle } from "lucide-react-native"
import { compactNumber, shortTime, useHome, type HomeAgent } from "../hooks/useHome"
import { Button, Group, IconButton, Row } from "../ui/controls"
import { Mascot } from "../ui/Mascot"
import { Text } from "../ui/Text"
import { space, useTheme } from "../ui/theme"

/** An agent's own page: who it is, what it runs on, what it's used, and where it works. */
export function AgentProfileScreen({ route, navigation }: any) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { data } = useHome()
  const initial = route?.params?.agent as HomeAgent
  const orgSlug = route?.params?.orgSlug as string
  const agent = data?.agents.find((a) => a.id === initial?.id) ?? initial
  if (!agent) return null
  const chats = (data?.chats ?? []).filter((c) => agent.roomIds.includes(c.id) || c.agentIds.includes(agent.id))
  const working = chats.find((c) => c.id === agent.workingRoomId)

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top, paddingHorizontal: 6, height: insets.top + 52, justifyContent: "center" }}>
        <IconButton label="Back" tint="transparent" icon={<ChevronLeft size={26} color={theme.text} />} onPress={() => navigation.goBack()} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + 40 }}>
        <View style={{ alignItems: "center", gap: 6, marginBottom: space.xl }}>
          <Mascot seed={agent.handle} size={96} working={Boolean(agent.workingRoomId)} />
          <Text variant="title" center>
            {agent.name}
          </Text>
          <Text variant="subhead" tone="muted" center>
            @{agent.handle} · {agent.kind === "external" ? "Invited" : "Made here"}
          </Text>
          {agent.about ? (
            <Text variant="callout" tone="muted" center style={{ marginTop: 4 }}>
              {agent.about}
            </Text>
          ) : null}
          {working ? (
            <Text variant="footnote" tone="accent" weight="600" style={{ marginTop: 4 }}>
              Working in {working.name} now
            </Text>
          ) : null}
          {chats[0] ? (
            <Button
              title="Message"
              icon={<MessageCircle size={18} color={theme.onAccent} />}
              style={{ marginTop: space.md, alignSelf: "stretch" }}
              onPress={() => navigation.navigate("Chat", { roomId: chats[0]!.id, roomName: chats[0]!.name, orgSlug })}
            />
          ) : null}
        </View>

        <Group title="Thinks with">
          <Row icon={<Cpu size={16} color={theme.text} />} title={agent.model} subtitle={agent.kind === "external" ? "Its own app's model and subscription" : "Change it in the web app under Agents"} chevron={false} />
        </Group>

        <Group title="Last 30 days" footer={agent.kind === "external" || /computer/.test(agent.model) ? "Runs on its own subscription, so tokens aren't billed here." : undefined}>
          <Row icon={<Activity size={16} color={theme.text} />} title="Runs" value={agent.usage ? agent.usage.runs.toLocaleString() : "0"} chevron={false} />
          <Row title="Tokens" value={agent.usage ? compactNumber(agent.usage.tokens) : "0"} chevron={false} />
          <Row title="Spend" value={agent.usage ? `$${agent.usage.costUsd.toFixed(2)}` : "$0.00"} chevron={false} />
          {agent.usage?.lastAt ? <Row title="Last active" value={shortTime(agent.usage.lastAt)} chevron={false} /> : null}
        </Group>

        <Group title={`In ${chats.length} ${chats.length === 1 ? "chat" : "chats"}`}>
          {chats.map((c) => (
            <Row key={c.id} icon={<Hash size={16} color={theme.text} />} title={c.name} subtitle={c.lastMessage?.preview} onPress={() => navigation.navigate("Chat", { roomId: c.id, roomName: c.name, orgSlug })} />
          ))}
        </Group>
      </ScrollView>
    </View>
  )
}
