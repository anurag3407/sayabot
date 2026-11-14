import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  PanResponder,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import * as Clipboard from "expo-clipboard"
import * as DocumentPicker from "expo-document-picker"
import * as ImagePicker from "expo-image-picker"
import { ArrowDown, ArrowUp, Camera, ChevronLeft, Copy, CornerUpLeft, FileText, Hash, ImageIcon, Plus, ShieldAlert, SquareTerminal, X } from "lucide-react-native"
import { attachmentMarkdown, uploadToRoom, type Picked } from "../core/api"
import { TerminalDrawer } from "../components/chat/TerminalDrawer"
import { useInbox } from "../hooks/useInbox"
import { useRoomAgents } from "../hooks/useRoomAgents"
import { useRoomRealtime } from "../hooks/useRoomRealtime"
import { QuestionCard } from "./InboxScreen"
import { Button, Group, IconButton, Row } from "../ui/controls"
import { haptic } from "../ui/haptics"
import { Mascot } from "../ui/Mascot"
import { RichText } from "../ui/RichText"
import { Sheet } from "../ui/Sheet"
import { Text } from "../ui/Text"
import { radius, space, useTheme } from "../ui/theme"
import type { Message } from "../types"

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return "Today"
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday"
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })
}

function TypingDots() {
  const theme = useTheme()
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current]
  useEffect(() => {
    const anims = dots.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(v, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 320, useNativeDriver: true }),
          Animated.delay(280 - i * 140),
        ]),
      ),
    )
    anims.forEach((a) => a.start())
    return () => anims.forEach((a) => a.stop())
  }, [])
  return (
    <View style={{ flexDirection: "row", gap: 5, paddingVertical: 6 }} accessibilityLabel="Typing">
      {dots.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: theme.muted,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
            transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
          }}
        />
      ))}
    </View>
  )
}

type Item = { kind: "day"; key: string; label: string } | { kind: "msg"; key: string; message: Message; first: boolean; last: boolean }

function MessageRow({
  item,
  onLongPress,
  onReply,
  queued,
}: {
  item: Extract<Item, { kind: "msg" }>
  onLongPress: (m: Message) => void
  onReply: (m: Message) => void
  queued: boolean
}) {
  const theme = useTheme()
  const m = item.message
  // Swipe right to reply, like the messaging apps people already know.
  const dx = useRef(new Animated.Value(0)).current
  const fired = useRef(false)
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dx > 14 && Math.abs(g.dy) < 10,
      onPanResponderMove: (_e, g) => {
        const x = Math.max(0, Math.min(80, g.dx))
        dx.setValue(x)
        if (x > 60 && !fired.current) {
          fired.current = true
          haptic.select()
        }
      },
      onPanResponderRelease: () => {
        if (fired.current) onReply(m)
        fired.current = false
        Animated.spring(dx, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start()
      },
      onPanResponderTerminate: () => {
        fired.current = false
        Animated.spring(dx, { toValue: 0, useNativeDriver: true }).start()
      },
    }),
  ).current
  const mine = m.senderType === "human" && (m.senderName === "You" || m.id.startsWith("local-") || !m.metadata?.agentName)
  if (m.senderType === "system") {
    return (
      <View style={{ alignItems: "center", marginVertical: 8, paddingHorizontal: space.xl }}>
        <View style={{ backgroundColor: theme.raised, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text variant="caption" tone="muted" center>
            {m.content}
          </Text>
        </View>
      </View>
    )
  }
  const failed = Boolean(m.metadata?.failed)
  const sending = Boolean(m.metadata?.sending)
  const isAgent = m.senderType === "agent"
  return (
    <Animated.View
      {...pan.panHandlers}
      style={{ flexDirection: "row", justifyContent: mine ? "flex-end" : "flex-start", paddingHorizontal: space.md, marginTop: item.first ? 10 : 2, transform: [{ translateX: dx }] }}
    >
      <Animated.View style={{ position: "absolute", left: 6, top: "40%", opacity: dx.interpolate({ inputRange: [0, 60], outputRange: [0, 1] }) }}>
        <CornerUpLeft size={18} color={theme.muted} />
      </Animated.View>
      {!mine ? (
        <View style={{ width: 36, marginRight: 6, justifyContent: "flex-end" }}>
          {item.last && isAgent ? <Mascot seed={m.senderHandle ?? m.senderName ?? "agent"} size={28} working={m.status === "streaming"} /> : null}
        </View>
      ) : null}
      <View style={{ maxWidth: "80%" }}>
        {item.first && !mine ? (
          <Text variant="caption" tone="muted" weight="600" style={{ marginLeft: 12, marginBottom: 3 }}>
            {m.senderName ?? "Agent"}
          </Text>
        ) : null}
        <Pressable
          onLongPress={() => {
            haptic.press()
            onLongPress(m)
          }}
          delayLongPress={280}
          accessibilityRole="text"
          accessibilityHint="Long press for actions"
          style={{
            backgroundColor: mine ? theme.bubbleMine : theme.bubbleTheirs,
            borderRadius: 20,
            borderBottomRightRadius: mine && item.last ? 6 : 20,
            borderBottomLeftRadius: !mine && item.last ? 6 : 20,
            paddingHorizontal: 14,
            paddingVertical: 9,
            borderWidth: !mine && !theme.dark ? StyleSheet.hairlineWidth : 0,
            borderColor: theme.line,
            opacity: sending ? 0.7 : 1,
          }}
        >
          {m.status === "streaming" && !m.content ? (
            <TypingDots />
          ) : (
            <RichText text={m.content} mine={mine} color={mine ? theme.bubbleMineText : theme.text} />
          )}
        </Pressable>
        {item.last || failed ? (
          <Text variant="caption" tone={failed ? "danger" : "faint"} style={{ marginTop: 3, alignSelf: mine ? "flex-end" : "flex-start", marginHorizontal: 8 }}>
            {failed
              ? "Not sent · long press to copy"
              : sending
                ? "Sending…"
                : queued
                  ? "Queued · read after the current reply"
                : m.status === "error"
                  ? "Stopped with an error"
                  : new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  )
}

export function ChatScreen({ route, navigation }: any) {
  const { roomId = "", roomName = "chat", orgSlug = "" } = route?.params ?? {}
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { messages, loading, error, agentStatus, terminalLogs, approval, sendMessage, resolveApproval, clearTerminal } = useRoomRealtime(roomId, orgSlug)
  const { agents } = useRoomAgents(roomId)
  const { questions, answer } = useInbox(orgSlug)
  const roomQuestions = questions.filter((q) => q.roomId === roomId)
  const [draft, setDraft] = useState("")
  const [sendError, setSendError] = useState<string | null>(null)
  const [actionFor, setActionFor] = useState<Message | null>(null)
  const [questionsOpen, setQuestionsOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const [deciding, setDeciding] = useState(false)
  const [attachments, setAttachments] = useState<Picked[]>([])
  const [attachOpen, setAttachOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [queuedIds, setQueuedIds] = useState<string[]>([])
  const listRef = useRef<FlatList<Item>>(null)
  const inputRef = useRef<TextInput>(null)

  // Newest first for an inverted list, with day separators and grouped runs from one sender.
  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    const list = [...messages]
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]!
      const newer = list[i + 1]
      const older = list[i - 1]
      const sameAsOlder = older && older.senderType === m.senderType && older.senderId === m.senderId && older.senderName === m.senderName && dayLabel(older.createdAt) === dayLabel(m.createdAt)
      const sameAsNewer = newer && newer.senderType === m.senderType && newer.senderId === m.senderId && newer.senderName === m.senderName && dayLabel(newer.createdAt) === dayLabel(m.createdAt)
      out.push({ kind: "msg", key: m.id, message: m, first: !sameAsOlder, last: !sameAsNewer })
      if (!older || dayLabel(older.createdAt) !== dayLabel(m.createdAt)) out.push({ kind: "day", key: `day-${m.createdAt.slice(0, 10)}`, label: dayLabel(m.createdAt) })
    }
    return out
  }, [messages])

  const working = messages.some((m) => m.status === "streaming" && m.senderType === "agent")
  const subtitle = agentStatus ?? (working ? "Replying…" : agents.length ? agents.map((a) => a.displayName).join(", ") : "No agents yet")
  const mentionQuery = draft.match(/@([a-z0-9-]*)$/i)?.[1]?.toLowerCase()
  const mentionMatches = mentionQuery !== undefined ? agents.filter((a) => a.handle.toLowerCase().startsWith(mentionQuery)) : []

  useEffect(() => {
    if (!working) setQueuedIds([])
  }, [working])

  async function send() {
    const text = draft.trim()
    if (!text && !attachments.length) return
    setSendError(null)
    haptic.tap()
    try {
      let content = text
      if (attachments.length) {
        setUploading(true)
        const links: string[] = []
        for (const file of attachments) links.push(attachmentMarkdown(await uploadToRoom(roomId, file)))
        content = [text, ...links].filter(Boolean).join("\n")
        setAttachments([])
        setUploading(false)
      }
      setDraft("")
      const sent = await sendMessage(content)
      if (working && sent?.messageId) setQueuedIds((ids) => [...ids, sent.messageId!])
    } catch (err) {
      setUploading(false)
      setSendError(err instanceof Error ? err.message : "Couldn't send")
      haptic.warn()
    }
  }

  async function pickPhotos(camera: boolean) {
    setAttachOpen(false)
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) return setSendError(camera ? "Camera access is off for Sayabot in Settings." : "Photo access is off for Sayabot in Settings.")
    const res = camera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 4, quality: 0.8 })
    if (res.canceled) return
    setAttachments((a) =>
      [...a, ...res.assets.map((x) => ({ uri: x.uri, name: x.fileName ?? `photo-${Date.now()}.jpg`, type: x.mimeType ?? "image/jpeg", size: x.fileSize, isImage: true }))].slice(0, 6),
    )
  }

  async function pickFile() {
    setAttachOpen(false)
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
    if (res.canceled) return
    setAttachments((a) =>
      [...a, ...res.assets.map((x) => ({ uri: x.uri, name: x.name, type: x.mimeType ?? "application/octet-stream", size: x.size, isImage: (x.mimeType ?? "").startsWith("image/") }))].slice(0, 6),
    )
  }

  function replyTo(m: Message) {
    const quote = m.content.split("\n").slice(0, 2).join(" ").slice(0, 160)
    const who = m.senderType === "agent" && m.senderHandle ? `@${m.senderHandle} ` : ""
    setDraft(`> ${quote}\n${who}`)
    setTimeout(() => inputRef.current?.focus(), 200)
  }

  const headAgent = agents[0]
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View
        style={{
          paddingTop: insets.top,
          backgroundColor: theme.surface,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.line,
        }}
      >
        <View style={{ height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 6, gap: 6 }}>
          <IconButton label="Back" tint="transparent" icon={<ChevronLeft size={26} color={theme.text} />} onPress={() => navigation.goBack()} />
          {headAgent ? (
            <Mascot seed={headAgent.handle} size={34} working={working} />
          ) : (
            <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: theme.raised, alignItems: "center", justifyContent: "center" }}>
              <Hash size={18} color={theme.muted} />
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="headline" numberOfLines={1}>
              {roomName}
            </Text>
            <Text variant="caption" tone={working || agentStatus ? "accent" : "muted"} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
          {terminalLogs.length ? (
            <IconButton label="Computer output" icon={<SquareTerminal size={18} color={theme.text} />} onPress={() => setTerminalOpen(true)} />
          ) : null}
        </View>
        {roomQuestions.length ? (
          <Pressable
            onPress={() => setQuestionsOpen(true)}
            accessibilityRole="button"
            style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: space.lg, paddingVertical: 10, backgroundColor: theme.warnSoft }}
          >
            <Text variant="subhead" weight="600" style={{ flex: 1 }}>
              {roomQuestions[0]!.agentName} {roomQuestions.length > 1 ? `and others need ${roomQuestions.length} answers` : "has a question"}
            </Text>
            <Text variant="subhead" tone="warn" weight="700">
              Answer
            </Text>
          </Pressable>
        ) : null}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {loading && !messages.length ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={theme.accent} />
        ) : (
          <FlatList
            ref={listRef}
            inverted
            data={items}
            keyExtractor={(i) => i.key}
            contentContainerStyle={{ paddingVertical: space.md }}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onScroll={(e) => setAtBottom(e.nativeEvent.contentOffset.y < 80)}
            scrollEventThrottle={64}
            ListFooterComponent={
              !messages.length ? (
                <View style={{ alignItems: "center", padding: space.xxl, gap: 8, transform: [{ scaleY: -1 }] }}>
                  {headAgent ? <Mascot seed={headAgent.handle} size={56} /> : null}
                  <Text variant="headline" center>
                    Say hello
                  </Text>
                  <Text variant="subhead" tone="muted" center>
                    {agents.length ? `Mention ${agents.map((a) => `@${a.handle}`).join(" or ")} to get them going.` : "Add an agent to this chat from the web app."}
                  </Text>
                </View>
              ) : null
            }
            renderItem={({ item }) =>
              item.kind === "day" ? (
                <View style={{ alignItems: "center", marginVertical: 12 }}>
                  <Text variant="caption" tone="faint" weight="600">
                    {item.label}
                  </Text>
                </View>
              ) : (
                <MessageRow item={item} onLongPress={setActionFor} onReply={replyTo} queued={queuedIds.includes(item.message.id)} />
              )
            }
          />
        )}

        {!atBottom ? (
          <View style={{ position: "absolute", right: space.lg, bottom: 96 }}>
            <IconButton label="Jump to latest" icon={<ArrowDown size={18} color={theme.text} />} tint={theme.card} onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })} />
          </View>
        ) : null}

        {approval ? (
          <View style={{ marginHorizontal: space.md, marginBottom: 8, padding: space.md, borderRadius: radius.lg, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.warn, gap: 8 }}>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <ShieldAlert size={18} color={theme.warn} />
              <Text variant="subhead" weight="600" style={{ flex: 1 }}>
                {approvalTitle(approval.toolName, approval.args)}
              </Text>
            </View>
            <Text variant="caption" tone="muted" numberOfLines={3}>
              {JSON.stringify(withoutMacMarker(approval.args)).slice(0, 240)}
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button
                title="Allow"
                size="sm"
                loading={deciding}
                onPress={async () => {
                  setDeciding(true)
                  await resolveApproval(true).catch((e) => setSendError(e instanceof Error ? e.message : "Not saved"))
                  setDeciding(false)
                  haptic.success()
                }}
              />
              <Button
                title="Don't allow"
                size="sm"
                variant="secondary"
                disabled={deciding}
                onPress={async () => {
                  setDeciding(true)
                  await resolveApproval(false).catch((e) => setSendError(e instanceof Error ? e.message : "Not saved"))
                  setDeciding(false)
                }}
              />
            </View>
          </View>
        ) : null}

        {mentionMatches.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: space.md, paddingBottom: 6 }}>
            {mentionMatches.map((a) => (
              <Pressable
                key={a.id}
                onPress={() => {
                  haptic.select()
                  setDraft((d) => d.replace(/@([a-z0-9-]*)$/i, `@${a.handle} `))
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.card, borderRadius: radius.pill, paddingRight: 12, paddingLeft: 2, height: 34 }}
              >
                <Mascot seed={a.handle} size={22} />
                <Text variant="subhead">@{a.handle}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {sendError ? (
          <Text variant="caption" tone="danger" style={{ marginHorizontal: space.lg, marginBottom: 4 }}>
            {sendError}
          </Text>
        ) : null}
        {error && !messages.length ? (
          <Text variant="caption" tone="danger" style={{ marginHorizontal: space.lg, marginBottom: 4 }}>
            {error}
          </Text>
        ) : null}

        {attachments.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: space.md, paddingTop: 6 }}>
            {attachments.map((a, i) => (
              <View key={`${a.uri}-${i}`} style={{ width: 72, height: 72, borderRadius: 14, overflow: "hidden", backgroundColor: theme.card, alignItems: "center", justifyContent: "center" }}>
                {a.isImage ? (
                  <Image source={{ uri: a.uri }} style={{ width: 72, height: 72 }} />
                ) : (
                  <View style={{ alignItems: "center", gap: 4, padding: 6 }}>
                    <FileText size={20} color={theme.muted} />
                    <Text variant="caption" tone="muted" numberOfLines={2} center>
                      {a.name}
                    </Text>
                  </View>
                )}
                <Pressable
                  onPress={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                  accessibilityLabel={`Remove ${a.name}`}
                  style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" }}
                >
                  <X size={13} color="#fff" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}

        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: space.md, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 10), backgroundColor: theme.bg }}>
          <IconButton label="Attach" size={44} icon={<Plus size={22} color={theme.text} />} onPress={() => setAttachOpen(true)} />
          <View style={{ flex: 1, minHeight: 44, maxHeight: 140, borderRadius: 22, backgroundColor: theme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.lineStrong, paddingHorizontal: 16, justifyContent: "center" }}>
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              placeholder={agents.length ? `Message ${agents.length === 1 ? agents[0]!.displayName : "the room"}…` : "Message…"}
              placeholderTextColor={theme.faint}
              multiline
              style={{ color: theme.text, fontSize: 16, lineHeight: 21, paddingVertical: 10, maxHeight: 130 }}
              accessibilityLabel="Message"
            />
          </View>
          <Pressable
            onPress={send}
            disabled={(!draft.trim() && !attachments.length) || uploading}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: draft.trim() || attachments.length ? theme.accent : theme.raised,
              alignItems: "center",
              justifyContent: "center",
              transform: [{ scale: pressed ? 0.94 : 1 }],
            })}
          >
            {uploading ? <ActivityIndicator color={theme.onAccent} /> : <ArrowUp size={22} color={draft.trim() || attachments.length ? theme.onAccent : theme.faint} />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Sheet visible={Boolean(actionFor)} onClose={() => setActionFor(null)} height={0.36}>
        {actionFor ? (
          <Group>
            <Row
              icon={<Copy size={16} color={theme.text} />}
              title="Copy"
              onPress={async () => {
                await Clipboard.setStringAsync(actionFor.content)
                haptic.success()
                setActionFor(null)
              }}
            />
            <Row
              icon={<CornerUpLeft size={16} color={theme.text} />}
              title="Reply"
              onPress={() => {
                const m = actionFor
                setActionFor(null)
                replyTo(m)
              }}
            />
          </Group>
        ) : null}
      </Sheet>

      <Sheet visible={attachOpen} onClose={() => setAttachOpen(false)} title="Add to message" height={0.4}>
        <Group>
          <Row icon={<ImageIcon size={16} color={theme.text} />} title="Photos" subtitle="Up to 4 at a time" onPress={() => void pickPhotos(false)} />
          <Row icon={<Camera size={16} color={theme.text} />} title="Camera" onPress={() => void pickPhotos(true)} />
          <Row icon={<FileText size={16} color={theme.text} />} title="File" subtitle="PDF, documents, spreadsheets · up to 15 MB" onPress={() => void pickFile()} />
        </Group>
      </Sheet>

      <Sheet visible={questionsOpen} onClose={() => setQuestionsOpen(false)} title="Questions for you" height={0.85}>
        <View style={{ gap: 12 }}>
          {roomQuestions.map((q) => (
            <QuestionCard key={q.id} question={q} onAnswer={answer} />
          ))}
          {!roomQuestions.length ? (
            <Text variant="subhead" tone="muted" center>
              All answered. Thanks!
            </Text>
          ) : null}
        </View>
      </Sheet>

      <TerminalDrawer visible={terminalOpen} logs={terminalLogs} onClose={() => setTerminalOpen(false)} onClear={clearTerminal} />
    </View>
  )
}

/** Steps from an agent running on someone's Mac carry a hidden marker with the Mac's name. */
function macHostName(args: unknown): string | null {
  const mark = args && typeof args === "object" ? (args as Record<string, unknown>)._mac : null
  const name = mark && typeof mark === "object" ? (mark as Record<string, unknown>).hostName : null
  return typeof name === "string" ? name : null
}

function withoutMacMarker(args: unknown): unknown {
  if (!args || typeof args !== "object" || !("_mac" in args)) return args
  const { _mac: _hidden, ...rest } = args as Record<string, unknown>
  return rest
}

function approvalTitle(toolName: string, args: unknown): string {
  const host = macHostName(args)
  if (!host) return `An agent wants to run “${toolName.replace(/_/g, " ")}”`
  const input = (args ?? {}) as Record<string, unknown>
  const command = typeof input.command === "string" ? input.command : null
  const file = typeof input.file_path === "string" ? input.file_path.split("/").pop() : null
  if (toolName === "Bash" && command) return `Run “${command.slice(0, 80)}” on ${host}?`
  if (file) return `${toolName === "Write" ? "Write" : "Edit"} ${file} on ${host}?`
  return `Use ${toolName.replace(/^mcp__\w+__/, "").replace(/_/g, " ")} on ${host}?`
}
