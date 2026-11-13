import React, { useEffect, useMemo, useState } from "react"
import { FlatList, Pressable, RefreshControl, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { CheckCircle2, CircleDashed, CircleDot, Hash, OctagonAlert, Plus } from "lucide-react-native"
import { postRoomMessage } from "../core/room-message"
import { supabase } from "../core/supabase"
import { delegationMessage } from "../core/workspace-draft"
import { shortTime, useHome, type HomeAgent } from "../hooks/useHome"
import { useTasks } from "../hooks/useTasks"
import { Button, Chip, EmptyState, IconButton } from "../ui/controls"
import { haptic } from "../ui/haptics"
import { Mascot } from "../ui/Mascot"
import { Sheet } from "../ui/Sheet"
import { Text } from "../ui/Text"
import { radius, space, useTheme } from "../ui/theme"
import type { TaskItem } from "../types"

type Filter = "active" | "stuck" | "done"

function StatusIcon({ status }: { status: TaskItem["status"] }) {
  const theme = useTheme()
  if (status === "done") return <CheckCircle2 size={20} color={theme.ok} />
  if (status === "stuck" || status === "blocked") return <OctagonAlert size={20} color={theme.warn} />
  if (status === "in_progress") return <CircleDot size={20} color={theme.accent} />
  return <CircleDashed size={20} color={theme.faint} />
}

const STATUS_LABEL: Record<string, string> = {
  open: "Not started",
  in_progress: "In progress",
  stuck: "Stuck",
  blocked: "Stuck",
  done: "Done",
}

/** Work handed to agents: what's moving, what's stuck, what's done, and a quick way to delegate. */
export function TasksScreen({ navigation, route }: any) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { tasks, loading, refresh, createTask } = useTasks()
  const { data } = useHome()
  const [filter, setFilter] = useState<Filter>("active")
  const [refreshing, setRefreshing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<TaskItem | null>(null)
  useEffect(() => {
    if (route?.params?.action === "new-task") setCreating(true)
  }, [route?.params?.at, route?.params?.action])
  const agents = useMemo(() => new Map((data?.agents ?? []).map((a) => [a.id, a])), [data])
  const rooms = useMemo(() => new Map((data?.chats ?? []).filter((c) => c.kind !== "dm").map((c) => [c.id, c])), [data])

  const counts = {
    active: tasks.filter((t) => t.status === "open" || t.status === "in_progress").length,
    stuck: tasks.filter((t) => t.status === "stuck" || t.status === "blocked").length,
    done: tasks.filter((t) => t.status === "done").length,
  }
  const shown = tasks.filter((t) =>
    filter === "active" ? t.status === "open" || t.status === "in_progress" : filter === "stuck" ? t.status === "stuck" || t.status === "blocked" : t.status === "done",
  )

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <FlatList
        data={shown}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: space.lg, paddingBottom: 140, gap: 10 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={theme.accent}
            onRefresh={async () => {
              setRefreshing(true)
              await refresh()
              setRefreshing(false)
            }}
          />
        }
        ListHeaderComponent={
          <View style={{ marginBottom: space.md }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text variant="largeTitle" accessibilityRole="header" style={{ flex: 1 }}>
                Tasks
              </Text>
              <IconButton label="New task" icon={<Plus size={20} color={theme.onAccent} />} tint={theme.accent} onPress={() => setCreating(true)} />
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: space.md }}>
              <Chip label={`Active ${counts.active || ""}`.trim()} selected={filter === "active"} onPress={() => setFilter("active")} />
              <Chip label={`Stuck ${counts.stuck || ""}`.trim()} selected={filter === "stuck"} onPress={() => setFilter("stuck")} />
              <Chip label="Done" selected={filter === "done"} onPress={() => setFilter("done")} />
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon={<CheckCircle2 size={40} color={theme.faint} />}
              title={filter === "active" ? "Nothing in progress" : filter === "stuck" ? "Nothing is stuck" : "Nothing finished yet"}
              body={filter === "active" ? "Hand an agent something to do, and it shows up here." : undefined}
              action={filter === "active" ? <Button title="New task" onPress={() => setCreating(true)} /> : undefined}
            />
          )
        }
        renderItem={({ item }) => {
          const agent = item.assigneeAgentId ? agents.get(item.assigneeAgentId) : undefined
          const room = item.roomId ? rooms.get(item.roomId) : undefined
          return (
            <Pressable
              onPress={() => {
                haptic.tap()
                setDetail(item)
              }}
              accessibilityRole="button"
              style={({ pressed }) => ({ backgroundColor: theme.card, borderRadius: radius.lg, padding: space.lg, gap: 8, opacity: pressed ? 0.85 : 1 })}
            >
              <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                <StatusIcon status={item.status} />
                <Text variant="callout" weight="600" style={{ flex: 1 }} numberOfLines={3}>
                  {item.title}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 30 }}>
                {agent ? <Mascot seed={agent.handle} size={20} working={item.status === "in_progress"} /> : null}
                <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                  {[agent ? agent.name : "Any agent", room ? `#${room.name}` : null, STATUS_LABEL[item.status], item.updatedAt ? shortTime(item.updatedAt) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              {item.unblockNeeds && (item.status === "stuck" || item.status === "blocked") ? (
                <Text variant="caption" tone="warn" style={{ paddingLeft: 30 }}>
                  Needs: {item.unblockNeeds.replace(/_/g, " ")}
                </Text>
              ) : null}
            </Pressable>
          )
        }}
      />

      <NewTaskSheet
        visible={creating}
        onClose={() => setCreating(false)}
        orgSlug={data?.org.slug ?? ""}
        rooms={[...rooms.values()].map((r) => ({ id: r.id, name: r.name, agentIds: r.agentIds }))}
        agents={data?.agents ?? []}
        create={async (input) => {
          const { data: org } = await supabase.from("orgs").select("id").eq("slug", data?.org.slug ?? "").maybeSingle()
          if (!org?.id) throw new Error("No workspace")
          await createTask({ orgId: org.id, ...input })
        }}
        onDone={() => {
          setCreating(false)
          void refresh()
        }}
      />

      <Sheet visible={Boolean(detail)} onClose={() => setDetail(null)} title={detail ? STATUS_LABEL[detail.status] : ""} height={0.6}>
        {detail ? (
          <View style={{ gap: space.md }}>
            <Text variant="title">{detail.title}</Text>
            {detail.description ? (
              <Text variant="body" tone="muted">
                {detail.description}
              </Text>
            ) : null}
            {detail.assigneeAgentId && agents.get(detail.assigneeAgentId) ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Mascot seed={agents.get(detail.assigneeAgentId)!.handle} size={32} />
                <Text variant="callout">{agents.get(detail.assigneeAgentId)!.name} is on it</Text>
              </View>
            ) : (
              <Text variant="callout" tone="muted">
                Waiting for an agent to pick it up
              </Text>
            )}
            {detail.roomId && rooms.get(detail.roomId) ? (
              <Button
                title={`Open #${rooms.get(detail.roomId)!.name}`}
                variant="secondary"
                icon={<Hash size={16} color={theme.text} />}
                onPress={() => {
                  const room = rooms.get(detail.roomId!)!
                  setDetail(null)
                  navigation.navigate("Chat", { roomId: room.id, roomName: room.name, orgSlug: data?.org.slug })
                }}
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </View>
  )
}

function NewTaskSheet({
  visible,
  onClose,
  orgSlug,
  rooms,
  agents,
  create,
  onDone,
}: {
  visible: boolean
  onClose: () => void
  orgSlug: string
  rooms: Array<{ id: string; name: string; agentIds: string[] }>
  agents: HomeAgent[]
  create: (input: { roomId: string; title: string; description?: string; priority?: "low" | "medium" | "high" | "urgent"; assigneeAgentId?: string | null }) => Promise<void>
  onDone: () => void
}) {
  const theme = useTheme()
  const [title, setTitle] = useState("")
  const [details, setDetails] = useState("")
  const [roomId, setRoomId] = useState<string | null>(rooms[0]?.id ?? null)
  const [who, setWho] = useState<string | null>(null)
  const [urgent, setUrgent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!roomId && rooms[0]) setRoomId(rooms[0].id)
  }, [rooms, roomId])
  const roomAgents = agents.filter((a) => rooms.find((r) => r.id === roomId)?.agentIds.includes(a.id))

  async function submit() {
    if (!roomId) return
    setBusy(true)
    setError(null)
    try {
      await create({ roomId, title: title.trim(), description: details.trim() || undefined, priority: urgent ? "urgent" : "medium", assigneeAgentId: who })
      const agent = agents.find((a) => a.id === who)
      if (agent) await postRoomMessage(orgSlug, roomId, delegationMessage(agent.handle, title, details)).catch(() => {})
      haptic.success()
      setTitle("")
      setDetails("")
      setWho(null)
      setUrgent(false)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the task")
      haptic.warn()
    } finally {
      setBusy(false)
    }
  }

  const field = { borderRadius: radius.md, backgroundColor: theme.raised, paddingHorizontal: 14, color: theme.text, fontSize: 16 } as const
  return (
    <Sheet visible={visible} onClose={onClose} title="New task" height={0.85}>
      <TextInput value={title} onChangeText={setTitle} placeholder="What needs doing?" placeholderTextColor={theme.faint} autoFocus style={{ ...field, height: 50 }} />
      <TextInput
        value={details}
        onChangeText={setDetails}
        placeholder="Details, links, what done looks like (optional)"
        placeholderTextColor={theme.faint}
        multiline
        style={{ ...field, minHeight: 90, paddingTop: 12, marginTop: 10, textAlignVertical: "top" }}
      />
      <Text variant="footnote" tone="muted" style={{ marginTop: space.lg, marginBottom: 8 }}>
        In which chat?
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {rooms.map((r) => (
          <Chip key={r.id} label={`#${r.name}`} selected={r.id === roomId} onPress={() => { setRoomId(r.id); setWho(null) }} />
        ))}
      </View>
      <Text variant="footnote" tone="muted" style={{ marginTop: space.lg, marginBottom: 8 }}>
        Who should do it?
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Chip label="Any agent" selected={who === null} onPress={() => setWho(null)} />
        {roomAgents.map((a) => (
          <Chip key={a.id} label={a.name} selected={who === a.id} icon={<Mascot seed={a.handle} size={18} />} onPress={() => setWho(a.id)} />
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: space.lg }}>
        <Chip label={urgent ? "Urgent ✓" : "Mark urgent"} selected={urgent} onPress={() => setUrgent(!urgent)} />
      </View>
      {error ? (
        <Text variant="footnote" tone="danger" style={{ marginTop: space.md }}>
          {error}
        </Text>
      ) : null}
      <Button title={who ? "Hand it over" : "Add task"} onPress={submit} loading={busy} disabled={!title.trim() || !roomId} style={{ marginTop: space.xl }} />
    </Sheet>
  )
}
