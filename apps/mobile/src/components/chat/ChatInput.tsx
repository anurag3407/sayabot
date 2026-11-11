import React, { useState } from "react"
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native"
import {
  Bot,
  CheckSquare,
  HelpCircle,
  Send,
  Sparkles,
  Terminal,
  X,
} from "lucide-react-native"
import { useSettings } from "../../hooks/useSettings"
import { colors } from "../../theme"

interface ChatInputProps {
  onSend: (text: string) => Promise<void>
  disabled?: boolean
}

const QUICK_ACTIONS = [
  { label: "Help", prefix: "/help", icon: HelpCircle },
  { label: "@agent status", prefix: "@agent status", icon: Bot },
  { label: "Run bash", prefix: "Run command: ", icon: Terminal },
  { label: "New task", prefix: "Create task: ", icon: CheckSquare },
  { label: "Explain", prefix: "Please explain the current workspace architecture", icon: Sparkles },
]

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const { settings } = useSettings()
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [showCommands, setShowCommands] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const handlePressSend = async () => {
    if (!text.trim() || sending || disabled) return
    const content = text
    setText("")
    setSending(true)
    setError(null)
    if (settings.hapticsEnabled) Vibration.vibrate(12)
    try {
      await onSend(content)
    } catch (err: unknown) {
      setText((current) => (current.trim() ? current : content))
      setError(err instanceof Error ? err.message : "The message was not sent.")
    } finally {
      setSending(false)
    }
  }

  const handleSelectQuickAction = (prefix: string) => {
    setText((prev) => (prev ? `${prev} ${prefix}` : prefix))
  }

  const hasContent = Boolean(text.trim())

  return (
    <View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {showCommands ? (
      <View style={styles.quickBarContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickBar}
        >
          {QUICK_ACTIONS.map((action, i) => {
            const Icon = action.icon
            return (
              <TouchableOpacity
                key={i}
                style={styles.quickChip}
                onPress={() => handleSelectQuickAction(action.prefix)}
                activeOpacity={0.7}
              >
                <Icon size={12} color={colors.primaryBright} />
                <Text style={styles.quickChipText}>{action.label}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      </View>
      ) : null}

      {/* Main Input Row */}
      <View style={styles.container}>
        {/* WhatsApp Capsule Input Box */}
        <View style={styles.capsule}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => setShowCommands(!showCommands)}
            activeOpacity={0.7}
            accessibilityLabel={showCommands ? "Hide quick prompts" : "Show quick prompts"}
          >
            {showCommands ? (
              <X size={20} color={colors.textSecondary} />
            ) : (
              <Sparkles size={20} color={colors.textSecondary} />
            )}
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            placeholder="Message agent or type @mention..."
            placeholderTextColor={colors.textPlaceholder}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={10_000}
            editable={!disabled && !sending}
          />
        </View>

        {/* WhatsApp Detached Green Circle Action Button */}
        <TouchableOpacity
          style={[styles.actionCircle, (!hasContent || sending || disabled) && styles.actionCircleDisabled]}
          onPress={hasContent ? handlePressSend : undefined}
          disabled={disabled || sending || !hasContent}
          accessibilityLabel="Send message"
          activeOpacity={0.8}
        >
          <Send size={18} color={colors.textInverse} style={styles.sendIcon} />
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  errorText: {
    color: colors.accentDanger,
    fontSize: 12.5,
    paddingHorizontal: 14,
    paddingBottom: 4,
  },
  quickBarContainer: {
    backgroundColor: "transparent",
    paddingBottom: 4,
  },
  quickBar: {
    paddingHorizontal: 8,
    gap: 6,
  },
  quickChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  quickChipText: {
    color: colors.textSecondary,
    fontSize: 11.5,
    fontWeight: "600",
  },
  container: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 6,
    paddingVertical: 6,
    backgroundColor: "transparent",
    gap: 6,
  },
  capsule: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: colors.surfaceLight,
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 46,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  iconBtn: {
    padding: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 15.5,
    paddingVertical: 8,
    paddingHorizontal: 6,
    maxHeight: 110,
  },
  actionCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
  },
  actionCircleDisabled: {
    backgroundColor: colors.surfaceLight,
    opacity: 0.6,
  },
  sendIcon: {
    marginLeft: 2,
  },
})
