import React, { useEffect, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  AlertCircle,
  CheckSquare,
  Clock,
  Flag,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react-native"
import { useTasks } from "../hooks/useTasks"
import { useRooms } from "../hooks/useRooms"
import { useRoomAgents } from "../hooks/useRoomAgents"
import { postRoomMessage } from "../core/room-message"
import { delegationMessage } from "../core/workspace-draft"
import { useSettings } from "../hooks/useSettings"
import { useAuth } from "../hooks/useAuth"
import { usePalette } from "../hooks/usePalette"
import { TaskCard } from "../components/tasks/TaskCard"
import { colors } from "../theme"

export function TasksScreen() {
  const { settings } = useSettings()
  const { session, signOut } = useAuth()
  const theme = usePalette()
  const { tasks, loading, error, refresh, createTask } = useTasks()
  const { rooms, orgId } = useRooms(settings.orgSlug)
  const [filter, setFilter] = useState<"all" | "in_progress" | "blocked" | "done">("all")
  const [roomId, setRoomId] = useState<string | null>(null)

  // Create Task Modal
  const [createModal, setCreateModal] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent">("medium")
  const [budgetTurns, setBudgetTurns] = useState(12)
  const [creating, setCreating] = useState(false)
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const { agents: roomAgents } = useRoomAgents(roomId)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (roomId && rooms.some((room) => room.id === roomId)) return
    setRoomId(rooms[0]?.id ?? null)
  }, [rooms, roomId])

  const filtered = tasks.filter((t) => {
    if (filter === "all") return true
    if (filter === "blocked") return t.status === "blocked" || t.status === "stuck"
    return t.status === filter
  })

  useEffect(() => {
    setAssigneeId(null)
  }, [roomId])

  const handleCreateTask = async () => {
    if (!title.trim()) {
      setErrorMsg("Please enter a task title.")
      return
    }
    if (!orgId || !roomId) {
      setErrorMsg("Create a room first. A task has to live in one.")
      return
    }

    setCreating(true)
    setErrorMsg(null)

    try {
      await createTask({
        orgId,
        roomId,
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        budgetTurns,
        assigneeAgentId: assigneeId,
      })

      // Wake the agent now rather than at its next check-in.
      const assignee = roomAgents.find((agent) => agent.id === assigneeId)
      if (assignee && settings.orgSlug) {
        await postRoomMessage(
          settings.orgSlug,
          roomId,
          delegationMessage(assignee.handle, title, description),
        ).catch(() => {
          // The task is on the board either way; the agent picks it up at its next check.
        })
      }

      setCreateModal(false)
      setAssigneeId(null)
      setTitle("")
      setDescription("")
      setPriority("medium")
      setBudgetTurns(12)
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to create task.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={theme.surface} />

      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.surface }]}>
        <View>
          <Text style={styles.title}>Autonomous Tasks</Text>
          <Text style={styles.subtitle}>Work you hand to an agent</Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={refresh}>
          <RefreshCw size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Filter Tabs */}
      <View style={styles.tabsRow}>
        {(["all", "in_progress", "blocked", "done"] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, filter === tab && styles.tabActive]}
            onPress={() => setFilter(tab)}
          >
            <Text style={[styles.tabText, filter === tab && styles.tabTextActive]}>
              {tab.replace("_", " ").toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Task List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TaskCard task={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconBadge}>
                <CheckSquare size={36} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>{error ? "Tasks are unavailable" : "No tasks in this view"}</Text>
              <Text style={styles.emptySubtitle}>
                {error ?? "Create a task in a room. It stays open until someone moves it."}
              </Text>
              <TouchableOpacity
                style={styles.emptyCreateBtn}
                onPress={() => (session ? setCreateModal(true) : void signOut())}
              >
                {session ? <Plus size={16} color={colors.textInverse} /> : null}
                <Text style={styles.emptyCreateBtnText}>{session ? "Create a task" : "Sign in"}</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
      />

      {/* FAB: Create Task */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.85}
        onPress={() => setCreateModal(true)}
      >
        <Plus size={24} color={colors.textInverse} />
      </TouchableOpacity>

      {/* Create Task Modal */}
      <Modal visible={createModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalScroll}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Sparkles size={18} color={colors.primaryBright} />
                <Text style={styles.modalTitle}>New Autonomous Task</Text>
              </View>
              <TouchableOpacity onPress={() => setCreateModal(false)}>
                <X size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {errorMsg && (
              <View style={styles.errorAlert}>
                <AlertCircle size={14} color={colors.accentDanger} />
                <Text style={styles.errorAlertText}>{errorMsg}</Text>
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Task Title</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Audit security dependencies and create report"
                placeholderTextColor={colors.textPlaceholder}
                value={title}
                onChangeText={setTitle}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Description / Instructions</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Detailed instructions for the agent computer run..."
                placeholderTextColor={colors.textPlaceholder}
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Room</Text>
              {rooms.length === 0 ? (
                <Text style={styles.roomHint}>Create a room before adding a task.</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.priorityRow}>
                  {rooms.map((room) => {
                    const selected = room.id === roomId
                    return (
                      <TouchableOpacity
                        key={room.id}
                        style={[styles.priorityBtn, selected && styles.priorityBtnActive]}
                        onPress={() => setRoomId(room.id)}
                      >
                        <Text style={[styles.priorityBtnText, selected && styles.priorityBtnTextActive]}>
                          {room.name}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </ScrollView>
              )}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Who should do it?</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.priorityRow}>
                <TouchableOpacity
                  style={[styles.priorityBtn, assigneeId === null && styles.priorityBtnActive]}
                  onPress={() => setAssigneeId(null)}
                >
                  <Text style={[styles.priorityBtnText, assigneeId === null && styles.priorityBtnTextActive]}>
                    Any agent
                  </Text>
                </TouchableOpacity>
                {roomAgents.map((agent) => {
                  const selected = agent.id === assigneeId
                  return (
                    <TouchableOpacity
                      key={agent.id}
                      style={[styles.priorityBtn, selected && styles.priorityBtnActive]}
                      onPress={() => setAssigneeId(agent.id)}
                    >
                      <Sparkles size={12} color={selected ? colors.textInverse : colors.textSecondary} />
                      <Text style={[styles.priorityBtnText, selected && styles.priorityBtnTextActive]}>
                        {agent.displayName}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>
              <Text style={styles.roomHint}>
                {assigneeId
                  ? "It gets a message now and works on it from wherever it runs, like your computer."
                  : "The first agent free in the room claims it."}
              </Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Priority</Text>
              <View style={styles.priorityRow}>
                {(["low", "medium", "high", "urgent"] as const).map((p) => {
                  const isSelected = priority === p
                  return (
                    <TouchableOpacity
                      key={p}
                      style={[styles.priorityBtn, isSelected && styles.priorityBtnActive]}
                      onPress={() => setPriority(p)}
                    >
                      <Flag
                        size={12}
                        color={isSelected ? colors.textInverse : colors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.priorityBtnText,
                          isSelected && styles.priorityBtnTextActive,
                        ]}
                      >
                        {p.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>

            <View style={styles.rowBetween}>
              <View style={styles.rowLead}>
                <Clock size={16} color={colors.textSecondary} />
                <View>
                  <Text style={styles.rowTitle}>Budget Limit (Turns)</Text>
                  <Text style={styles.rowSubtitle}>Max model turns allowed for task</Text>
                </View>
              </View>
              <View style={styles.stepperContainer}>
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => setBudgetTurns(Math.max(3, budgetTurns - 1))}
                >
                  <Text style={styles.stepperText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue}>{budgetTurns}</Text>
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => setBudgetTurns(Math.min(50, budgetTurns + 1))}
                >
                  <Text style={styles.stepperText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setCreateModal(false)}
                disabled={creating}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSubmitBtn}
                onPress={handleCreateTask}
                disabled={creating || rooms.length === 0}
              >
                {creating ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <>
                    <Plus size={16} color={colors.textInverse} />
                    <Text style={styles.modalSubmitText}>Create task</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "700",
  },
  subtitle: {
    color: colors.primaryBright,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  refreshBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
  },
  tabsRow: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderColor: colors.borderSubtle,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  tabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryBright,
  },
  tabText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
  tabTextActive: {
    color: colors.textInverse,
  },
  listContent: {
    padding: 12,
    paddingBottom: 90,
  },
  fab: {
    position: "absolute",
    right: 18,
    bottom: 22,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
  },
  emptyContainer: {
    padding: 40,
    alignItems: "center",
    gap: 12,
  },
  emptyIconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 4,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "700",
  },
  emptySubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
    maxWidth: 280,
  },
  emptyCreateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 8,
  },
  emptyCreateBtnText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: "700",
  },

  // Modal styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
  },
  modalScroll: {
    flexGrow: 1,
    justifyContent: "flex-end",
  },
  roomHint: {
    color: colors.textSecondary,
    fontSize: 12.5,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
  },
  errorAlert: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.accentDangerBg,
    padding: 10,
    borderRadius: 8,
  },
  errorAlertText: {
    color: colors.accentDanger,
    fontSize: 12.5,
    fontWeight: "600",
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  textArea: {
    minHeight: 70,
    textAlignVertical: "top",
  },
  priorityRow: {
    flexDirection: "row",
    gap: 8,
  },
  priorityBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  priorityBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryBright,
  },
  priorityBtnText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
  priorityBtnTextActive: {
    color: colors.textInverse,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowLead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  rowSubtitle: {
    color: colors.textSecondary,
    fontSize: 11.5,
  },
  stepperContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  stepperBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  stepperText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  stepperValue: {
    color: colors.primaryBright,
    fontSize: 14,
    fontWeight: "700",
    paddingHorizontal: 8,
  },
  modalActionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  modalCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modalCancelText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
  modalSubmitBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 10,
  },
  modalSubmitText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: "700",
  },
})
