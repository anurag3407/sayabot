import React, { useEffect, useRef, useState } from "react"
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  ArrowDown,
  ArrowLeft,
  Bot,
  MoreVertical,
  Settings,
  Sparkles,
  Terminal,
  Trash2,
} from "lucide-react-native"
import { useRoomRealtime } from "../hooks/useRoomRealtime"
import { MessageBubble } from "../components/chat/MessageBubble"
import { TerminalDrawer } from "../components/chat/TerminalDrawer"
import { ApprovalCard } from "../components/chat/ApprovalCard"
import { ChatInput } from "../components/chat/ChatInput"
import { useSettings } from "../hooks/useSettings"
import { usePalette } from "../hooks/usePalette"
import { colors } from "../theme"

export function ChatScreen({ route, navigation }: any) {
  const { roomId, roomName, orgSlug } = route.params
  const {
    messages,
    loading,
    error,
    agentStatus,
    terminalLogs,
    approval,
    sendMessage,
    resolveApproval,
    clearTerminal,
  } = useRoomRealtime(roomId, orgSlug)

  const [terminalVisible, setTerminalVisible] = useState(false)
  const [menuVisible, setMenuVisible] = useState(false)
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const listRef = useRef<FlatList>(null)
  const { settings } = useSettings()
  const theme = usePalette()

  useEffect(() => {
    if (settings.autoOpenTerminal && terminalLogs.length > 0) setTerminalVisible(true)
  }, [settings.autoOpenTerminal, terminalLogs.length])

  const subtitle = agentStatus ?? "Idle"

  const scrollToBottom = () => {
    listRef.current?.scrollToEnd({ animated: true })
    setShowScrollBottom(false)
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.surface }]}>
      <StatusBar barStyle="light-content" backgroundColor={theme.surface} />
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >

      {/* WhatsApp Chat Room Header */}
      <View style={[styles.header, { backgroundColor: theme.surface }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <ArrowLeft size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          {/* Contact Avatar */}
          <View style={styles.headerAvatar}>
            <Bot size={20} color={colors.primaryBright} />
            {agentStatus ? <View style={styles.avatarOnlineDot} /> : null}
          </View>

          {/* Contact Name & Subtitle */}
          <View style={styles.contactDetails}>
            <Text style={styles.contactName} numberOfLines={1}>
              #{roomName}
            </Text>
            <View style={styles.statusRow}>
              {agentStatus && <View style={styles.pulsingDot} />}
              <Text
                style={[
                  styles.contactStatus,
                  agentStatus ? styles.statusTyping : styles.statusOnline,
                ]}
                numberOfLines={1}
              >
                {subtitle}
              </Text>
            </View>
          </View>
        </View>

        {/* Header Right Actions */}
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.terminalIconBtn, terminalLogs.length > 0 && styles.terminalActive]}
            onPress={() => setTerminalVisible(true)}
          >
            <Terminal size={19} color={terminalLogs.length > 0 ? colors.primaryBright : colors.textSecondary} />
            {terminalLogs.length > 0 && (
              <View style={styles.terminalBadge}>
                <Text style={styles.terminalBadgeCount}>{Math.min(99, terminalLogs.length)}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.moreBtn} onPress={() => setMenuVisible(true)}>
            <MoreVertical size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Chat Wallpaper Container */}
      <View style={[styles.wallpaper, { backgroundColor: theme.background }]}>
        {/* Human In The Loop Danger Tool Approval Card */}
        {approval && <ApprovalCard approval={approval} onResolve={resolveApproval} />}

        {/* Messages Feed */}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={styles.messageFeed}
          onScroll={(e) => {
            const offsetY = e.nativeEvent.contentOffset.y
            const contentHeight = e.nativeEvent.contentSize.height
            const layoutHeight = e.nativeEvent.layoutMeasurement.height
            const distanceFromBottom = contentHeight - layoutHeight - offsetY
            setShowScrollBottom(distanceFromBottom > 150)
          }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            !loading ? (
              <View style={styles.emptyContainer}>
                <View style={styles.encryptionPill}>
                  <Sparkles size={16} color={colors.accentGold} style={{ marginBottom: 4 }} />
                  <Text style={styles.encryptionText}>
                    {error
                      ? error
                      : "Messages here are shared with the people and agents in this room."}
                  </Text>
                </View>
              </View>
            ) : null
          }
        />

        {/* Floating Scroll to Bottom Button */}
        {showScrollBottom && (
          <TouchableOpacity
            style={styles.scrollBottomBtn}
            onPress={scrollToBottom}
            activeOpacity={0.8}
          >
            <ArrowDown size={18} color={colors.textPrimary} />
          </TouchableOpacity>
        )}

        {/* Bottom Input Bar with Quick Prompts */}
        <ChatInput onSend={sendMessage} />
      </View>

      {/* Slide-Up Terminal Drawer (Output from /home/bot) */}
      <TerminalDrawer
        visible={terminalVisible}
        logs={terminalLogs}
        onClose={() => setTerminalVisible(false)}
        onClear={clearTerminal}
      />

      {/* Popup Menu */}
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
                setTerminalVisible(true)
              }}
            >
              <Terminal size={16} color={colors.primaryBright} />
              <Text style={styles.menuItemText}>Computer Terminal</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false)
                clearTerminal()
              }}
            >
              <Trash2 size={16} color={colors.accentDanger} />
              <Text style={styles.menuItemText}>Clear Terminal Logs</Text>
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false)
                navigation.navigate("MainTabs", { screen: "SettingsTab" })
              }}
            >
              <Settings size={16} color={colors.textSecondary} />
              <Text style={styles.menuItemText}>Settings</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  keyboard: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: colors.borderSubtle,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 8,
  },
  backBtn: {
    padding: 6,
  },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  avatarOnlineDot: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primaryBright,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  contactDetails: {
    flex: 1,
    justifyContent: "center",
  },
  contactName: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 1,
  },
  pulsingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primaryBright,
  },
  contactStatus: {
    fontSize: 12,
  },
  statusOnline: {
    color: colors.textSecondary,
  },
  statusTyping: {
    color: colors.primaryBright,
    fontWeight: "600",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingRight: 4,
  },
  terminalIconBtn: {
    padding: 6,
    position: "relative",
  },
  terminalActive: {
    borderRadius: 6,
    backgroundColor: colors.surfaceLight,
  },
  terminalBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  terminalBadgeCount: {
    color: colors.textInverse,
    fontSize: 9,
    fontWeight: "800",
  },
  moreBtn: {
    padding: 6,
  },
  wallpaper: {
    flex: 1,
    backgroundColor: colors.background,
  },
  datePill: {
    alignSelf: "center",
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  dateText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  messageFeed: {
    paddingVertical: 6,
  },
  emptyContainer: {
    padding: 24,
    alignItems: "center",
    marginTop: 20,
  },
  encryptionPill: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    maxWidth: "90%",
    alignItems: "center",
  },
  encryptionText: {
    color: colors.accentGold,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },
  scrollBottomBtn: {
    position: "absolute",
    right: 16,
    bottom: 70,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },

  // Popup Menu
  menuBackdrop: {
    flex: 1,
    backgroundColor: "transparent",
  },
  menuPopup: {
    position: "absolute",
    top: 50,
    right: 12,
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
