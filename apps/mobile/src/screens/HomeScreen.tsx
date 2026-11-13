import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  Animated,
  FlatList,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { BlurView } from "expo-blur"
import { Archive, Bell, ChevronDown, Hash, MessageCirclePlus, Pin, Plus, Search, X } from "lucide-react-native"
import { currentWebApiUrl } from "../core/settings"
import { supabase } from "../core/supabase"
import { shortTime, useHome, type HomeAgent, type HomeChat } from "../hooks/useHome"
import { applySettings } from "../hooks/useSettings"
import { Badge, Button, Chip, EmptyState, IconButton, Row, Group } from "../ui/controls"
import { haptic } from "../ui/haptics"
import { Mascot } from "../ui/Mascot"
import { Sheet } from "../ui/Sheet"
import { Text } from "../ui/Text"
import { radius, space, useTheme } from "../ui/theme"

function ChatAvatar({ chat, agents }: { chat: HomeChat; agents: Map<string, HomeAgent> }) {
  const theme = useTheme()
  const ids = chat.agentIds.filter((id) => agents.has(id))
  if (chat.kind === "dm" && ids[0]) {
    return <Mascot seed={agents.get(ids[0])!.handle} size={46} working={chat.workingAgentId === ids[0]} />
  }
  if (ids.length >= 2) {
    return (
      <View style={{ width: 54, height: 54 }}>
        <View style={{ position: "absolute", left: 0, top: 0 }}>
          <Mascot seed={agents.get(ids[0]!)!.handle} size={32} />
        </View>
        <View style={{ position: "absolute", right: 0, bottom: 0 }}>
          <Mascot seed={agents.get(ids[1]!)!.handle} size={32} working={Boolean(chat.workingAgentId)} />
        </View>
      </View>
    )
  }
  if (ids.length === 1) return <Mascot seed={agents.get(ids[0]!)!.handle} size={46} working={Boolean(chat.workingAgentId)} />
  return (
    <View style={{ width: 54, height: 54, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 46, height: 46, borderRadius: 16, backgroundColor: theme.raised, alignItems: "center", justifyContent: "center" }}>
        <Hash size={20} color={theme.muted} />
      </View>
    </View>
  )
}

function ChatRow({
  chat,
  agents,
  onPress,
  onLongPress,
}: {
  chat: HomeChat
  agents: Map<string, HomeAgent>
  onPress: () => void
  onLongPress: () => void
}) {
  const theme = useTheme()
  const working = chat.workingAgentId ? agents.get(chat.workingAgentId) : null
  const preview = working
    ? `${working.name} is working…`
    : chat.lastMessage
      ? `${chat.lastMessage.senderName && chat.kind !== "dm" ? `${chat.lastMessage.senderName}: ` : ""}${chat.lastMessage.preview || "…"}`
      : "No messages yet"
  return (
    <Pressable
      onPress={() => {
        haptic.tap()
        onPress()
      }}
      onLongPress={() => {
        haptic.press()
        onLongPress()
      }}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityLabel={`${chat.name}. ${preview}${chat.unread ? `. ${chat.unread} unread` : ""}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: space.lg,
        paddingVertical: 10,
        backgroundColor: pressed ? theme.raised : "transparent",
      })}
    >
      <ChatAvatar chat={chat} agents={agents} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {chat.pinned ? <Pin size={12} color={theme.faint} /> : null}
          <Text variant="headline" numberOfLines={1} style={{ flex: 1 }} weight={chat.unread ? "700" : "600"}>
            {chat.name}
          </Text>
          <Text variant="caption" tone={chat.unread ? "accent" : "faint"}>
            {shortTime(chat.lastMessage?.at ?? chat.updatedAt)}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
          <Text variant="subhead" tone={working ? "accent" : chat.unread ? "text" : "muted"} numberOfLines={2} style={{ flex: 1 }}>
            {preview}
          </Text>
          {chat.questions ? (
            <View style={{ paddingHorizontal: 7, height: 20, borderRadius: 10, backgroundColor: theme.warnSoft, justifyContent: "center" }}>
              <Text variant="caption" tone="warn" weight="700">
                {chat.questions} ?
              </Text>
            </View>
          ) : null}
          <Badge count={chat.unread} tone={chat.muted ? "muted" : "accent"} />
        </View>
      </View>
    </Pressable>
  )
}

export function HomeScreen({ navigation, route }: any) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { data, loading, error, refresh } = useHome()
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState("")
  const [searchFocused, setSearchFocused] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [actionsFor, setActionsFor] = useState<HomeChat | null>(null)
  const scrollY = useRef(new Animated.Value(0)).current
  // Home-screen shortcut "New chat".
  useEffect(() => {
    if (route?.params?.action === "new-chat") setNewChatOpen(true)
  }, [route?.params?.at, route?.params?.action])

  const agents = useMemo(() => new Map((data?.agents ?? []).map((a) => [a.id, a])), [data])
  const orgSlug = data?.org.slug ?? ""
  const needs = (data?.needsYou.questions ?? 0) + (data?.needsYou.approvals ?? 0)
  const q = query.trim().toLowerCase()
  const chats = data?.chats ?? []
  const results = q
    ? {
        chats: chats.filter((c) => c.name.toLowerCase().includes(q) || c.lastMessage?.preview.toLowerCase().includes(q)),
        agents: (data?.agents ?? []).filter((a) => a.name.toLowerCase().includes(q) || a.handle.includes(q)),
      }
    : null

  const openChat = (chat: { id: string; name: string }) => navigation.navigate("Chat", { roomId: chat.id, roomName: chat.name, orgSlug })
  const openAgent = (agent: HomeAgent) => navigation.navigate("AgentProfile", { agent, orgSlug })

  async function setRead(chat: HomeChat, patch: { pinned?: boolean; archived?: boolean; markRead?: boolean }) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from("room_reads").upsert(
      {
        user_id: user.id,
        room_id: chat.id,
        ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
        ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
        ...(patch.markRead ? { last_read_at: new Date().toISOString() } : {}),
      },
      { onConflict: "user_id,room_id" },
    )
    haptic.success()
    void refresh()
  }

  const smallTitleOpacity = scrollY.interpolate({ inputRange: [40, 70], outputRange: [0, 1], extrapolate: "clamp" })
  const headerHeight = insets.top + 52

  const header = (
    <View>
      <View style={{ height: headerHeight }} />
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
        <Pressable
          onPress={() => (data?.orgs.length ?? 0) > 1 && setWorkspaceOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Workspace ${data?.org.name ?? ""}`}
          style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" }}
        >
          <Text variant="footnote" tone="muted" weight="600">
            {data?.org.name ?? "Sayabot"}
          </Text>
          {(data?.orgs.length ?? 0) > 1 ? <ChevronDown size={14} color={theme.muted} /> : null}
        </Pressable>
        <Text variant="largeTitle" accessibilityRole="header">
          Chats
        </Text>
      </View>

      {needs ? (
        <Pressable
          onPress={() => {
            haptic.tap()
            navigation.navigate("InboxTab")
          }}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginHorizontal: space.lg,
            marginBottom: space.lg,
            padding: space.lg,
            borderRadius: radius.lg,
            backgroundColor: theme.accentSoft,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" }}>
            <Bell size={18} color={theme.onAccent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="headline">
              {needs} {needs === 1 ? "thing needs" : "things need"} you
            </Text>
            <Text variant="footnote" tone="muted">
              {[
                data?.needsYou.questions ? `${data.needsYou.questions} ${data.needsYou.questions === 1 ? "question" : "questions"}` : null,
                data?.needsYou.approvals ? `${data.needsYou.approvals} waiting for your OK` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
          <Text variant="subhead" tone="accent" weight="700">
            Open
          </Text>
        </Pressable>
      ) : null}

      {(data?.agents.length ?? 0) > 0 ? (
        <View style={{ marginBottom: space.md }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.md, gap: 4 }}>
            {(data?.agents ?? []).map((agent) => (
              <Pressable
                key={agent.id}
                onPress={() => {
                  haptic.tap()
                  openAgent(agent)
                }}
                accessibilityRole="button"
                accessibilityLabel={`${agent.name}${agent.workingRoomId ? ", working" : ""}`}
                style={{ width: 72, alignItems: "center", gap: 4 }}
              >
                <Mascot seed={agent.handle} size={52} working={Boolean(agent.workingRoomId)} />
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {agent.name}
                </Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => void Linking.openURL(`${currentWebApiUrl()}/${orgSlug}/agents`)}
              accessibilityRole="button"
              accessibilityLabel="Add an agent"
              style={{ width: 72, alignItems: "center", gap: 4 }}
            >
              <View style={{ width: 60, height: 60, alignItems: "center", justifyContent: "center" }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, borderStyle: "dashed", borderColor: theme.lineStrong, alignItems: "center", justifyContent: "center" }}>
                  <Plus size={20} color={theme.muted} />
                </View>
              </View>
              <Text variant="caption" tone="faint">
                Add
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      ) : null}
      {error && !data ? (
        <Text variant="footnote" tone="danger" style={{ marginHorizontal: space.lg, marginBottom: space.md }}>
          {error}
        </Text>
      ) : null}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Animated.FlatList
        data={results ? [] : chats}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <ChatRow chat={item} agents={agents} onPress={() => openChat(item)} onLongPress={() => setActionsFor(item)} />
        )}
        ListEmptyComponent={
          loading && !data ? null : (
            <EmptyState
              icon={<MessageCirclePlus size={40} color={theme.faint} />}
              title="Start your first chat"
              body="Make a room, add an agent or two, and tell them what you need."
              action={<Button title="New chat" onPress={() => setNewChatOpen(true)} />}
            />
          )
        }
        contentContainerStyle={{ paddingBottom: 140 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={theme.accent}
            progressViewOffset={headerHeight}
            onRefresh={async () => {
              setRefreshing(true)
              await refresh()
              setRefreshing(false)
            }}
          />
        }
        keyboardShouldPersistTaps="handled"
      />

      {/* Compact bar: small title fades in once the big title scrolls under it. */}
      <View style={[StyleSheet.absoluteFillObject, { height: headerHeight, bottom: undefined }]} pointerEvents="box-none">
        <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: smallTitleOpacity }]} pointerEvents="none">
          {Platform.OS === "ios" ? (
            <BlurView tint={theme.dark ? "dark" : "light"} intensity={60} style={StyleSheet.absoluteFillObject} />
          ) : (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.bg, opacity: 0.96 }]} />
          )}
          <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: theme.line }} />
        </Animated.View>
        <View style={{ marginTop: insets.top, height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg }}>
          <Animated.View style={{ flex: 1, opacity: smallTitleOpacity }}>
            <Text variant="headline" center>
              Chats
            </Text>
          </Animated.View>
          <View style={{ position: "absolute", right: space.lg }}>
            <IconButton label="New chat" icon={<MessageCirclePlus size={19} color={theme.text} />} onPress={() => setNewChatOpen(true)} />
          </View>
        </View>
      </View>

      {/* Search results replace the list in place while typing. */}
      {results ? (
        <View style={[StyleSheet.absoluteFillObject, { top: headerHeight, backgroundColor: theme.bg }]}>
          <FlatList
            data={[...results.agents.map((a) => ({ type: "agent" as const, a })), ...results.chats.map((c) => ({ type: "chat" as const, c }))]}
            keyExtractor={(item) => (item.type === "agent" ? `a-${item.a.id}` : `c-${item.c.id}`)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 160 }}
            ListEmptyComponent={<EmptyState title="Nothing found" body={`No chat or agent matches “${query}”.`} />}
            renderItem={({ item }) =>
              item.type === "agent" ? (
                <Row
                  icon={<Mascot seed={item.a.handle} size={26} />}
                  iconBg="transparent"
                  title={item.a.name}
                  subtitle={`@${item.a.handle} · ${item.a.model}`}
                  onPress={() => {
                    Keyboard.dismiss()
                    openAgent(item.a)
                  }}
                />
              ) : (
                <ChatRow
                  chat={item.c}
                  agents={agents}
                  onPress={() => {
                    Keyboard.dismiss()
                    openChat(item.c)
                  }}
                  onLongPress={() => setActionsFor(item.c)}
                />
              )
            }
          />
        </View>
      ) : null}

      {/* Bottom search: where the thumb is, riding on the keyboard. */}
      <View style={{ position: "absolute", left: space.lg, right: space.lg, bottom: space.md, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View
          style={{
            flex: 1,
            height: 48,
            borderRadius: radius.pill,
            overflow: "hidden",
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.lineStrong,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            gap: 8,
          }}
        >
          {Platform.OS === "ios" ? (
            <BlurView tint={theme.dark ? "dark" : "light"} intensity={70} style={StyleSheet.absoluteFillObject} />
          ) : (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.card, opacity: 0.97 }]} />
          )}
          <Search size={17} color={theme.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search chats and agents"
            placeholderTextColor={theme.faint}
            style={{ flex: 1, color: theme.text, fontSize: 16 }}
            returnKeyType="search"
            accessibilityLabel="Search chats and agents"
          />
        </View>
        {searchFocused || query ? (
          <IconButton
            label="Close search"
            icon={<X size={18} color={theme.text} />}
            size={48}
            tint={theme.card}
            onPress={() => {
              setQuery("")
              Keyboard.dismiss()
            }}
          />
        ) : null}
      </View>

      <Sheet visible={workspaceOpen} onClose={() => setWorkspaceOpen(false)} title="Workspaces" height={0.5}>
        <Group>
          {(data?.orgs ?? []).map((org) => (
            <Row
              key={org.id}
              title={org.name}
              subtitle={org.slug}
              value={org.slug === orgSlug ? "Current" : undefined}
              onPress={async () => {
                setWorkspaceOpen(false)
                await applySettings({ orgSlug: org.slug })
              }}
            />
          ))}
        </Group>
      </Sheet>

      <Sheet visible={Boolean(actionsFor)} onClose={() => setActionsFor(null)} title={actionsFor?.name} height={0.42}>
        {actionsFor ? (
          <Group>
            <Row
              icon={<Pin size={16} color={theme.text} />}
              title={actionsFor.pinned ? "Unpin" : "Pin to top"}
              onPress={() => {
                const chat = actionsFor
                setActionsFor(null)
                void setRead(chat, { pinned: !chat.pinned })
              }}
            />
            <Row
              icon={<Bell size={16} color={theme.text} />}
              title="Mark as read"
              onPress={() => {
                const chat = actionsFor
                setActionsFor(null)
                void setRead(chat, { markRead: true })
              }}
            />
            <Row
              icon={<Archive size={16} color={theme.danger} />}
              title="Archive"
              destructive
              onPress={() => {
                const chat = actionsFor
                setActionsFor(null)
                void setRead(chat, { archived: true })
              }}
            />
          </Group>
        ) : null}
      </Sheet>

      <NewChatSheet
        visible={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        agents={data?.agents ?? []}
        orgSlug={orgSlug}
        onCreated={(room) => {
          setNewChatOpen(false)
          void refresh()
          openChat(room)
        }}
      />
    </View>
  )
}

function NewChatSheet({
  visible,
  onClose,
  agents,
  orgSlug,
  onCreated,
}: {
  orgSlug: string
  visible: boolean
  onClose: () => void
  agents: HomeAgent[]
  onCreated: (room: { id: string; name: string }) => void
}) {
  const theme = useTheme()
  const [name, setName] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error("Sign in first")
      const { data: org } = await supabase.from("orgs").select("id").eq("slug", orgSlug).maybeSingle()
      const orgId = org?.id
      if (!orgId) throw new Error("No workspace found")
      const clean = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48)
      if (!clean) throw new Error("Give it a name, like job-hunt")
      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .insert({ org_id: orgId, name: clean, kind: "private", turn_mode: "mentions", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", created_by: user.id })
        .select("id, name")
        .single()
      if (roomError || !room) throw roomError ?? new Error("Could not create the chat")
      await supabase.from("room_members").insert({ room_id: room.id, user_id: user.id, role: "admin" })
      if (picked.length) {
        await supabase.from("room_agents").insert(picked.map((agentId, position) => ({ room_id: room.id, agent_id: agentId, position })))
      }
      haptic.success()
      setName("")
      setPicked([])
      onCreated(room)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the chat")
      haptic.warn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="New chat" height={0.7}>
      <Text variant="footnote" tone="muted" style={{ marginBottom: 6 }}>
        Name
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Like job-hunt"
        placeholderTextColor={theme.faint}
        autoFocus
        style={{ height: 48, borderRadius: radius.md, backgroundColor: theme.raised, paddingHorizontal: 14, color: theme.text, fontSize: 16 }}
      />
      {agents.length ? (
        <>
          <Text variant="footnote" tone="muted" style={{ marginTop: space.lg, marginBottom: 8 }}>
            Who should be in it?
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {agents.map((agent) => {
              const on = picked.includes(agent.id)
              return (
                <Chip
                  key={agent.id}
                  label={agent.name}
                  selected={on}
                  icon={<Mascot seed={agent.handle} size={18} />}
                  onPress={() => setPicked((p) => (on ? p.filter((id) => id !== agent.id) : [...p, agent.id]))}
                />
              )
            })}
          </View>
        </>
      ) : null}
      {error ? (
        <Text variant="footnote" tone="danger" style={{ marginTop: space.md }}>
          {error}
        </Text>
      ) : null}
      <Button title="Create chat" onPress={create} loading={busy} disabled={!name.trim()} style={{ marginTop: space.xl }} />
    </Sheet>
  )
}

