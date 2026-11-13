import React, { useState } from "react"
import { FlatList, Image, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useShareIntentContext } from "expo-share-intent"
import { FileText, X } from "lucide-react-native"
import { attachmentMarkdown, uploadToRoom, type Picked } from "../core/api"
import { postRoomMessage } from "../core/room-message"
import { useHome } from "../hooks/useHome"
import { Button, IconButton, Row } from "../ui/controls"
import { haptic } from "../ui/haptics"
import { Mascot } from "../ui/Mascot"
import { Text } from "../ui/Text"
import { radius, space, useTheme } from "../ui/theme"

/** "Share to Sayabot" from any app: pick a chat, add a note, send. */
export function ShareTargetScreen({ navigation }: any) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { shareIntent, resetShareIntent } = useShareIntentContext()
  const { data } = useHome()
  const [chatId, setChatId] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const files: Picked[] = (shareIntent.files ?? []).map((f) => ({
    uri: f.path.startsWith("file://") || f.path.startsWith("content://") ? f.path : `file://${f.path}`,
    name: f.fileName || "file",
    type: f.mimeType || "application/octet-stream",
    size: f.size,
    isImage: (f.mimeType || "").startsWith("image/"),
  }))
  const sharedText = [shareIntent.text, shareIntent.webUrl].filter((t, i, a) => t && a.indexOf(t) === i).join("\n")
  const chats = data?.chats ?? []
  const agents = new Map((data?.agents ?? []).map((a) => [a.id, a]))

  function close() {
    resetShareIntent()
    navigation.goBack()
  }

  async function send() {
    const chat = chats.find((c) => c.id === chatId)
    if (!chat || !data) return
    setBusy(true)
    setError(null)
    try {
      const links: string[] = []
      for (const f of files.slice(0, 6)) links.push(attachmentMarkdown(await uploadToRoom(chat.id, f)))
      const content = [note.trim(), sharedText, ...links].filter(Boolean).join("\n")
      if (!content) throw new Error("Nothing to send")
      await postRoomMessage(data.org.slug, chat.id, content)
      haptic.success()
      resetShareIntent()
      navigation.replace("Chat", { roomId: chat.id, roomName: chat.name, orgSlug: data.org.slug })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send")
      haptic.warn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <View style={{ height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: space.md }}>
        <Text variant="headline" style={{ flex: 1, marginLeft: 6 }}>
          Send to a chat
        </Text>
        <IconButton label="Cancel" icon={<X size={18} color={theme.text} />} onPress={close} />
      </View>
      <View style={{ paddingHorizontal: space.lg, gap: 10 }}>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {files.map((f, i) =>
            f.isImage ? (
              <Image key={i} source={{ uri: f.uri }} style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: theme.raised }} />
            ) : (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderRadius: 12, backgroundColor: theme.card }}>
                <FileText size={16} color={theme.muted} />
                <Text variant="footnote" numberOfLines={1} style={{ maxWidth: 200 }}>
                  {f.name}
                </Text>
              </View>
            ),
          )}
        </View>
        {sharedText ? (
          <Text variant="subhead" tone="muted" numberOfLines={4} style={{ backgroundColor: theme.card, padding: 12, borderRadius: radius.md }}>
            {sharedText}
          </Text>
        ) : null}
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add a note, like “@hermes summarise this”"
          placeholderTextColor={theme.faint}
          multiline
          style={{ minHeight: 48, borderRadius: radius.md, backgroundColor: theme.raised, padding: 12, color: theme.text, fontSize: 16 }}
        />
      </View>
      <Text variant="footnote" tone="muted" style={{ marginHorizontal: space.lg, marginTop: space.lg, marginBottom: 6 }}>
        Choose a chat
      </Text>
      <FlatList
        data={chats}
        keyExtractor={(c) => c.id}
        style={{ flex: 1 }}
        renderItem={({ item }) => {
          const agent = item.agentIds.map((id) => agents.get(id)).find(Boolean)
          return (
            <Row
              icon={agent ? <Mascot seed={agent.handle} size={24} /> : undefined}
              iconBg="transparent"
              title={item.name}
              value={chatId === item.id ? "✓" : undefined}
              chevron={false}
              onPress={() => setChatId(item.id)}
            />
          )
        }}
      />
      {error ? (
        <Text variant="footnote" tone="danger" style={{ marginHorizontal: space.lg }}>
          {error}
        </Text>
      ) : null}
      <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.md }}>
        <Button title="Send" onPress={send} loading={busy} disabled={!chatId} size="lg" />
      </View>
    </View>
  )
}
