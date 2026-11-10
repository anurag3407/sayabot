import React, { useRef } from "react"
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { Terminal, Trash2, X } from "lucide-react-native"
import { colors, fonts } from "../../theme"

interface TerminalDrawerProps {
  visible: boolean
  logs: string[]
  onClose: () => void
  onClear: () => void
}

export function TerminalDrawer({ visible, logs, onClose, onClear }: TerminalDrawerProps) {
  const scrollRef = useRef<ScrollView>(null)

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <View style={styles.terminalIconBadge}>
                <Terminal size={14} color={colors.primaryBright} />
              </View>
              <View>
                <Text style={styles.title}>Agent Computer Terminal</Text>
                <Text style={styles.subtitle}>/home/bot • Persistent Docker Shell</Text>
              </View>
            </View>

            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={onClear}
                accessibilityLabel="Clear terminal"
              >
                <Trash2 size={16} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={onClose}
                accessibilityLabel="Close drawer"
              >
                <X size={18} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Console Output */}
          <ScrollView
            ref={scrollRef}
            style={styles.terminalBody}
            contentContainerStyle={styles.terminalContent}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {logs.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  $ Waiting for agent computer shell executions...
                </Text>
              </View>
            ) : (
              logs.map((chunk, index) => (
                <Text key={index} style={styles.logText} selectable>
                  {chunk}
                </Text>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
  },
  container: {
    height: "70%",
    backgroundColor: colors.codeBg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderColor: colors.borderSubtle,
    paddingBottom: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  terminalIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 1,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: colors.surface,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: colors.surface,
  },
  terminalBody: {
    flex: 1,
    marginTop: 8,
  },
  terminalContent: {
    paddingVertical: 8,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: "center",
  },
  emptyText: {
    color: colors.textMuted,
    fontFamily: fonts.mono,
    fontSize: 12,
    textAlign: "center",
  },
  logText: {
    color: "#4ade80",
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 2,
  },
})
