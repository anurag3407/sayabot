import React, { useState } from "react"
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import * as Clipboard from "expo-clipboard"
import { Check, Copy, Terminal } from "lucide-react-native"
import { useSettings } from "../../hooks/useSettings"
import { colors, fonts } from "../../theme"
import type { Message } from "../../types"

interface MessageBubbleProps {
  message: Message
}

function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString)
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  } catch {
    return ""
  }
}

/**
 * Splits message text into regular prose and fenced markdown code blocks.
 */
function parseMessageContent(raw: string) {
  const parts: Array<{ type: "text" | "code"; content: string; lang?: string }> = []
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codeBlockRegex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        content: raw.slice(lastIndex, match.index),
      })
    }

    parts.push({
      type: "code",
      lang: match[1] || "text",
      content: (match[2] ?? "").trim(),
    })

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < raw.length) {
    parts.push({
      type: "text",
      content: raw.slice(lastIndex),
    })
  }

  return parts
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isAgent = message.senderType === "agent"
  const isSystem = message.senderType === "system"
  const { settings } = useSettings()
  const [copiedCodeIndex, setCopiedCodeIndex] = useState<number | null>(null)
  const fontSize = settings.fontSize === "compact" ? 14 : settings.fontSize === "large" ? 18 : 15

  if (isSystem) {
    return (
      <View style={styles.systemPill}>
        <Text style={styles.systemText}>{message.content}</Text>
      </View>
    )
  }

  const timeStr = formatTime(message.createdAt)
  const senderTag = isAgent
    ? message.senderHandle
      ? `@${message.senderHandle}`
      : message.senderName || "Agent"
    : null

  const contentBlocks = parseMessageContent(message.content)

  const handleCopyCode = async (index: number, content: string) => {
    try {
      await Clipboard.setStringAsync(content)
      setCopiedCodeIndex(index)
      setTimeout(() => setCopiedCodeIndex(null), 2000)
    } catch {
      setCopiedCodeIndex(null)
    }
  }

  return (
    <View style={[styles.row, isAgent ? styles.rowAgent : styles.rowHuman]}>
      <View style={[styles.bubble, isAgent ? styles.bubbleAgent : styles.bubbleHuman]}>
        {/* Agent Name Tag inside bubble */}
        {isAgent && senderTag && (
          <View style={styles.agentTagRow}>
            <Text style={styles.agentSenderTag}>{senderTag}</Text>
            {message.metadata?.model ? (
              <View style={styles.modelPill}>
                <Text style={styles.modelPillText}>
                  {String(message.metadata.model).split("/").pop()}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Content with Code Blocks */}
        {contentBlocks.map((block, idx) => {
          if (block.type === "code") {
            const isCopied = copiedCodeIndex === idx
            return (
              <View key={idx} style={styles.codeContainer}>
                <View style={styles.codeHeader}>
                  <View style={styles.codeHeaderTitleRow}>
                    <Terminal size={12} color={colors.primaryBright} />
                    <Text style={styles.codeLangText}>{block.lang?.toUpperCase() || "CODE"}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.codeCopyBtn}
                    onPress={() => void handleCopyCode(idx, block.content)}
                    accessibilityLabel="Copy code"
                  >
                    {isCopied ? (
                      <Check size={12} color={colors.primaryBright} />
                    ) : (
                      <Copy size={12} color={colors.textSecondary} />
                    )}
                    <Text style={[styles.codeCopyText, isCopied && styles.codeCopyTextActive]}>
                      {isCopied ? "Copied" : "Copy"}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.codeBodyText} selectable>
                  {block.content}
                </Text>
              </View>
            )
          }

          return (
            <Text key={idx} style={[styles.content, { fontSize, lineHeight: fontSize + 6 }]}>
              {block.content}
              {message.status === "streaming" && (
                <Text style={styles.streamingCursor}> ▋</Text>
              )}
            </Text>
          )
        })}

        {/* Bottom Timestamp & Delivery Status */}
        <View style={styles.metaRow}>
          <Text style={styles.timeText}>{timeStr}</Text>
          {!isAgent && message.status !== "error" ? (
            <Check size={14} color={colors.textSecondary} style={styles.tickIcon} />
          ) : null}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    marginVertical: 3,
    paddingHorizontal: 8,
  },
  rowAgent: {
    justifyContent: "flex-start",
  },
  rowHuman: {
    justifyContent: "flex-end",
  },
  bubble: {
    maxWidth: "85%",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    borderRadius: 12,
    minWidth: 80,
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
  },
  bubbleAgent: {
    backgroundColor: colors.bubbleAgent,
    borderTopLeftRadius: 2,
    borderWidth: 1,
    borderColor: colors.bubbleAgentBorder,
  },
  bubbleHuman: {
    backgroundColor: colors.bubbleHuman,
    borderTopRightRadius: 2,
    borderWidth: 1,
    borderColor: colors.bubbleHumanBorder,
  },
  agentTagRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
    gap: 8,
  },
  agentSenderTag: {
    color: colors.primaryBright,
    fontSize: 12.5,
    fontWeight: "700",
  },
  modelPill: {
    backgroundColor: "rgba(37, 211, 102, 0.12)",
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  modelPillText: {
    color: colors.primaryBright,
    fontSize: 9.5,
    fontWeight: "600",
  },
  content: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 21,
  },
  streamingCursor: {
    color: colors.primaryBright,
    fontWeight: "900",
  },
  codeContainer: {
    backgroundColor: colors.codeBg,
    borderRadius: 8,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
  },
  codeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#111822",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  codeHeaderTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  codeLangText: {
    color: colors.textSecondary,
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  codeCopyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.surface,
  },
  codeCopyText: {
    color: colors.textSecondary,
    fontSize: 10.5,
    fontWeight: "600",
  },
  codeCopyTextActive: {
    color: colors.primaryBright,
  },
  codeBodyText: {
    color: "#5eead4",
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
    padding: 10,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    alignSelf: "flex-end",
    marginTop: 4,
    marginLeft: 12,
    gap: 3,
  },
  timeText: {
    color: colors.textSecondary,
    fontSize: 10.5,
  },
  tickIcon: {
    marginLeft: 1,
  },
  systemPill: {
    alignSelf: "center",
    backgroundColor: colors.bubbleSystem,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    maxWidth: "85%",
  },
  systemText: {
    color: colors.textSecondary,
    fontSize: 11.5,
    textAlign: "center",
    lineHeight: 16,
  },
})
