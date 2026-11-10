import React, { useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Modal,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import {
  AlertCircle,
  Bot,
  CheckCheck,
  Hash,
  MessageSquare,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-react-native"
import { useRooms } from "../hooks/useRooms"
import { colors } from "../theme"
import type { Room, RoomKind, TurnMode } from "../types"

export function RoomsScreen({ navigation }: any) {
  const { rooms, orgSlug, loading, refresh, createRoom } = useRooms()
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [activeFilter, setActiveFilter] = useState<"all" | "dms" | "rooms" | "debates">("all")

  // New room modal
  const [newRoomModal, setNewRoomModal] = useState(false)
  const [newRoomName, setNewRoomName] = useState("")
  const [newRoomKind, setNewRoomKind] = useState<RoomKind>("public")
  const [newRoomTurnMode, setNewRoomTurnMode] = useState<TurnMode>("mentions")
  const [newRoomDirective, setNewRoomDirective] = useState("")
  const [creatingRoom, setCreatingRoom] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Header menu popup
  const [menuVisible, setMenuVisible] = useState(false)

  // Filter logic
  const filtered = rooms
    .filter((r) => {
      if (activeFilter === "dms") return r.kind === "dm"
      if (activeFilter === "rooms") return r.kind === "public" || r.kind === "private"
      if (activeFilter === "debates") return r.turnMode === "debate"
      return true
    })
    .filter((r) => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return r.name.toLowerCase().includes(q) || (r.systemDirective || "").toLowerCase().includes(q)
    })

  const handleCreateRoom = async () => {
    if (!newRoomName.trim()) {
      setCreateError("Please enter a room name.")
      return
    }

    setCreatingRoom(true)
    setCreateError(null)

    try {
      const room = await createRoom({
        name: newRoomName.trim(),
        kind: newRoomKind,
        turnMode: newRoomTurnMode,
        systemDirective: newRoomDirective.trim() || undefined,
      })

      setNewRoomModal(false)
      setNewRoomName("")
      setNewRoomDirective("")

      // Navigate straight into the newly created room
      navigation.navigate("Chat", {
        roomId: room.id,
        roomName: room.name,
        orgSlug,
      })
    } catch (err: any) {
      setCreateError(err?.message || "Failed to create room.")
    } finally {
      setCreatingRoom(false)
    }
  }

  const renderRoom = ({ item, index }: { item: Room; index: number }) => {
    const isDm = item.kind === "dm"
    const avatarColors = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4"]
    const accentColor = avatarColors[index % avatarColors.length]

    return (
      <TouchableOpacity
        style={styles.chatRow}
        activeOpacity={0.7}
        onPress={() =>
          navigation.navigate("Chat", {
            roomId: item.id,
            roomName: item.name,
            orgSlug,
          })
        }
      >
        {/* Contact / Agent Circular Avatar */}
        <View
          style={[
            styles.avatar,
            { backgroundColor: `${accentColor}18`, borderColor: accentColor },
          ]}
        >
          {isDm ? <Bot size={22} color={accentColor} /> : <Hash size={22} color={accentColor} />}
          <View style={styles.onlineDot} />
        </View>

        {/* Center Content */}
        <View style={styles.chatDetails}>
          <View style={styles.topRow}>
            <Text style={styles.contactName} numberOfLines={1}>
              {isDm ? `@${item.name}` : item.name}
            </Text>
            <Text style={styles.timeText}>Active</Text>
          </View>

          <View style={styles.bottomRow}>
            <View style={styles.snippetRow}>
              <CheckCheck size={14} color={colors.accentCyan} style={styles.checkIcon} />
              <Text style={styles.snippetText} numberOfLines={1}>
                {item.systemDirective || "Tap to collaborate with autonomous agents..."}
              </Text>
            </View>

            {item.turnMode === "debate" && (
              <View style={styles.badgeDebate}>
                <Zap size={10} color={colors.accentGold} />
                <Text style={styles.badgeDebateText}>DEBATE</Text>
              </View>
            )}

            {item.turnMode === "moderated" && (
              <View style={styles.badgeModerated}>
                <Shield size={10} color={colors.accentPurple} />
                <Text style={styles.badgeModeratedText}>MODERATED</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surface} />

      {/* WhatsApp Top Header Bar */}
      <View style={styles.topBar}>
        <View style={styles.headerLeft}>
          <Text style={styles.appTitle}>Sayabot</Text>
          <View style={styles.orgSlugPill}>
            <Text style={styles.orgSlugText}>@{orgSlug}</Text>
          </View>
        </View>

        <View style={styles.topActions}>
          <TouchableOpacity
            style={styles.topActionBtn}
            onPress={() => setSearchOpen(!searchOpen)}
          >
            <Search size={20} color={searchOpen ? colors.primaryBright : colors.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.topActionBtn}
            onPress={() => setMenuVisible(true)}
          >
            <MoreVertical size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Bar with Clear Button */}
      {searchOpen && (
        <View style={styles.searchBar}>
          <Search size={16} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search agents, rooms, or directives..."
            placeholderTextColor={colors.textPlaceholder}
            value={search}
            onChangeText={setSearch}
            autoFocus
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")} style={{ padding: 4 }}>
              <X size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Category Filter Pills Bar */}
      <View style={styles.filterBar}>
        {(
          [
            { id: "all", label: "All Chats" },
            { id: "dms", label: "Agents" },
            { id: "rooms", label: "Rooms" },
            { id: "debates", label: "Debates" },
          ] as const
        ).map((tab) => (
          <TouchableOpacity
            key={tab.id}
            style={[styles.filterChip, activeFilter === tab.id && styles.filterChipActive]}
            onPress={() => setActiveFilter(tab.id)}
          >
            <Text
              style={[
                styles.filterChipText,
                activeFilter === tab.id && styles.filterChipTextActive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Chat Rooms Feed */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderRoom}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconBadge}>
                <MessageSquare size={36} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>
                {search ? "No matching chats found" : "No conversation rooms yet"}
              </Text>
              <Text style={styles.emptyDescription}>
                {search
                  ? `No rooms or agents matching "${search}".`
                  : "Start by creating a collaborative agent room or direct agent chat."}
              </Text>
              <TouchableOpacity
                style={styles.emptyCreateBtn}
                onPress={() => setNewRoomModal(true)}
              >
                <Plus size={16} color={colors.textInverse} />
                <Text style={styles.emptyCreateBtnText}>Create First Room</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>Connecting to workspace rooms...</Text>
            </View>
          )
        }
      />

      {/* WhatsApp Green Floating Action Button (FAB) -> Opens New Room Modal */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.85}
        onPress={() => setNewRoomModal(true)}
      >
        <Plus size={24} color={colors.textInverse} />
      </TouchableOpacity>

      {/* ============================================================== */}
      {/* MODAL: CREATE NEW ROOM / AGENT CHAT                            */}
      {/* ============================================================== */}
      <Modal visible={newRoomModal} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitleRow}>
                <Sparkles size={18} color={colors.primaryBright} />
                <Text style={styles.modalTitle}>New Agent Room</Text>
              </View>
              <TouchableOpacity onPress={() => setNewRoomModal(false)}>
                <X size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {createError && (
              <View style={styles.errorAlert}>
                <AlertCircle size={14} color={colors.accentDanger} />
                <Text style={styles.errorAlertText}>{createError}</Text>
              </View>
            )}

            {/* Room Name Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Room / Channel Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. dev-standup, pair-code, research"
                placeholderTextColor={colors.textPlaceholder}
                value={newRoomName}
                onChangeText={setNewRoomName}
                autoCapitalize="none"
              />
            </View>

            {/* Room Kind (DM vs Group) */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Room Type</Text>
              <View style={styles.typeRow}>
                <TouchableOpacity
                  style={[styles.typeBtn, newRoomKind === "public" && styles.typeBtnActive]}
                  onPress={() => setNewRoomKind("public")}
                >
                  <Users
                    size={16}
                    color={newRoomKind === "public" ? colors.primaryBright : colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.typeBtnText,
                      newRoomKind === "public" && styles.typeBtnTextActive,
                    ]}
                  >
                    Group Room
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.typeBtn, newRoomKind === "dm" && styles.typeBtnActive]}
                  onPress={() => setNewRoomKind("dm")}
                >
                  <Bot
                    size={16}
                    color={newRoomKind === "dm" ? colors.primaryBright : colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.typeBtnText,
                      newRoomKind === "dm" && styles.typeBtnTextActive,
                    ]}
                  >
                    Agent DM
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Turn Mode Selector */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Coordination Mode</Text>
              <View style={styles.turnModeRow}>
                {(
                  [
                    { id: "mentions", label: "Mentions", desc: "Replies when @mentioned" },
                    { id: "debate", label: "Debate", desc: "Autonomous agent dialogue" },
                    { id: "moderated", label: "Moderated", desc: "Human reviews each turn" },
                  ] as const
                ).map((mode) => (
                  <TouchableOpacity
                    key={mode.id}
                    style={[
                      styles.turnModeBtn,
                      newRoomTurnMode === mode.id && styles.turnModeBtnActive,
                    ]}
                    onPress={() => setNewRoomTurnMode(mode.id)}
                  >
                    <Text
                      style={[
                        styles.turnModeText,
                        newRoomTurnMode === mode.id && styles.turnModeTextActive,
                      ]}
                    >
                      {mode.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* System Directive */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>System Directive (Prompt Instructions)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="e.g. You are an expert engineer. Run bash commands in /home/bot to verify before answering."
                placeholderTextColor={colors.textPlaceholder}
                value={newRoomDirective}
                onChangeText={setNewRoomDirective}
                multiline
                numberOfLines={3}
              />
            </View>

            {/* Actions */}
            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setNewRoomModal(false)}
                disabled={creatingRoom}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSubmitBtn}
                onPress={handleCreateRoom}
                disabled={creatingRoom}
              >
                {creatingRoom ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <>
                    <Plus size={16} color={colors.textInverse} />
                    <Text style={styles.modalSubmitText}>Create Room</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ============================================================== */}
      {/* POPUP MENU MODAL                                               */}
      {/* ============================================================== */}
      <Modal visible={menuVisible} animationType="fade" transparent>
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View style={styles.menuPopup}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false)
                setNewRoomModal(true)
              }}
            >
              <Plus size={17} color={colors.primaryBright} />
              <Text style={styles.menuItemText}>New Agent Room</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false)
                refresh()
              }}
            >
              <RefreshCw size={17} color={colors.accentCyan} />
              <Text style={styles.menuItemText}>Refresh List</Text>
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false)
                navigation.navigate("SettingsTab")
              }}
            >
              <Settings size={17} color={colors.textSecondary} />
              <Text style={styles.menuItemText}>Workspace Settings</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  appTitle: {
    color: colors.textPrimary,
    fontSize: 21,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  orgSlugPill: {
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  orgSlugText: {
    color: colors.primaryBright,
    fontSize: 11,
    fontWeight: "600",
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  topActionBtn: {
    padding: 4,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 15,
  },
  filterBar: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: 1,
    borderColor: colors.borderSubtle,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryBright,
  },
  filterChipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  filterChipTextActive: {
    color: colors.textInverse,
    fontWeight: "700",
  },
  listContent: {
    paddingBottom: 90,
  },
  chatRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
    borderWidth: 1,
    position: "relative",
  },
  onlineDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primaryBright,
    borderWidth: 2,
    borderColor: colors.background,
  },
  chatDetails: {
    flex: 1,
    justifyContent: "center",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  contactName: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
  },
  timeText: {
    color: colors.textSecondary,
    fontSize: 11.5,
    marginLeft: 8,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  snippetRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 4,
  },
  checkIcon: {
    marginRight: 1,
  },
  snippetText: {
    color: colors.textSecondary,
    fontSize: 13.5,
    flex: 1,
  },
  badgeDebate: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255, 210, 121, 0.12)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: colors.accentGold,
  },
  badgeDebateText: {
    color: colors.accentGold,
    fontSize: 9.5,
    fontWeight: "700",
  },
  badgeModerated: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(168, 85, 247, 0.12)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: colors.accentPurple,
  },
  badgeModeratedText: {
    color: colors.accentPurple,
    fontSize: 9.5,
    fontWeight: "700",
  },
  separator: {
    height: 1,
    backgroundColor: colors.borderSubtle,
    marginLeft: 78,
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
    textAlign: "center",
  },
  emptyDescription: {
    color: colors.textSecondary,
    fontSize: 13.5,
    textAlign: "center",
    lineHeight: 19,
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
  loadingContainer: {
    padding: 60,
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 13.5,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
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
  modalHeaderTitleRow: {
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
  typeRow: {
    flexDirection: "row",
    gap: 10,
  },
  typeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.surfaceLight,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  typeBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  typeBtnText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  typeBtnTextActive: {
    color: colors.primaryBright,
    fontWeight: "700",
  },
  turnModeRow: {
    flexDirection: "row",
    gap: 8,
  },
  turnModeBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  turnModeBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  turnModeText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  turnModeTextActive: {
    color: colors.textInverse,
    fontWeight: "700",
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

  // Popup Menu
  menuBackdrop: {
    flex: 1,
    backgroundColor: "transparent",
  },
  menuPopup: {
    position: "absolute",
    top: 50,
    right: 16,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 6,
    width: 200,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "500",
  },
  menuDivider: {
    height: 1,
    backgroundColor: colors.borderSubtle,
    marginVertical: 4,
  },
})
