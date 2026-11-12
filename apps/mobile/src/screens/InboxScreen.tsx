import React, { useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { Bell, CheckCircle2 } from "lucide-react-native"
import { useInbox, type InboxQuestion } from "../hooks/useInbox"
import { useSettings } from "../hooks/useSettings"
import { useTheme, type Theme } from "../ui/theme"

function when(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function QuestionCard({
  question,
  onAnswer,
}: {
  question: InboxQuestion
  onAnswer: (input: { taskId: string; answer?: string; itemAnswers?: Record<string, string>; alsoPost?: boolean }) => Promise<string>
}) {
  const t = useTheme()
  const styles = makeStyles(t)
  const [values, setValues] = useState<Record<string, string>>({})
  const [note, setNote] = useState("")
  const [alsoPost, setAlsoPost] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const open = question.items.filter((i) => !i.answer)
  const filled = Object.values(values).filter((v) => v.trim()).length
  const canSend = question.items.length ? filled > 0 || note.trim().length > 0 : note.trim().length > 0

  const send = async (quick?: string) => {
    setBusy(true)
    setError(null)
    try {
      const message = await onAnswer({
        taskId: question.id,
        answer: quick ?? note,
        itemAnswers: question.items.length ? values : undefined,
        alsoPost,
      })
      setStatus(message)
      setValues({})
      setNote("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send")
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {question.agentName} {question.items.length > 1 ? "needs a few answers" : "has a question"}
      </Text>
      <Text style={styles.meta}>
        {when(question.updatedAt)} · {question.roomName}
        {question.askedCount > 1 ? ` · asked ${question.askedCount} times` : ""}
      </Text>
      <Text style={styles.question}>{question.title}</Text>
      {question.description ? (
        <TouchableOpacity onPress={() => setExpanded((v) => !v)} activeOpacity={0.8}>
          <Text style={styles.body} numberOfLines={expanded ? undefined : 4}>
            {question.description}
          </Text>
          {question.description.length > 200 ? <Text style={styles.more}>{expanded ? "Show less" : "Read more"}</Text> : null}
        </TouchableOpacity>
      ) : null}

      {question.items.map((item, index) =>
        item.answer ? (
          <View key={item.key} style={styles.answered}>
            <CheckCircle2 size={16} color={t.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.itemQ}>{item.question}</Text>
              <Text style={styles.itemA}>{item.answer}</Text>
            </View>
          </View>
        ) : (
          <View key={item.key} style={styles.item}>
            <Text style={styles.itemQ}>
              {index + 1}. {item.question}
            </Text>
            {item.hint ? <Text style={styles.hint}>{item.hint}</Text> : null}
            {item.options.length ? (
              <View style={styles.chips}>
                {item.options.map((option) => {
                  const selected = values[item.key] === option
                  return (
                    <TouchableOpacity
                      key={option}
                      style={[styles.chip, selected && styles.chipOn]}
                      onPress={() => setValues((v) => ({ ...v, [item.key]: option }))}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{option}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            ) : null}
            <TextInput
              style={styles.input}
              value={values[item.key] ?? ""}
              onChangeText={(text) => setValues((v) => ({ ...v, [item.key]: text }))}
              placeholder="Your answer"
              placeholderTextColor={t.faint}
            />
          </View>
        ),
      )}

      {!question.items.length && question.options.length ? (
        <View style={styles.chips}>
          {question.options.map((option) => (
            <TouchableOpacity key={option} style={styles.chip} disabled={busy} onPress={() => void send(option)}>
              <Text style={styles.chipText}>{option}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <TextInput
        style={[styles.input, styles.note]}
        value={note}
        onChangeText={setNote}
        placeholder={question.items.length ? "Anything else? (optional)" : "Your answer"}
        placeholderTextColor={t.faint}
        multiline
      />

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Also post my answer in the group chat</Text>
        <Switch value={alsoPost} onValueChange={setAlsoPost} trackColor={{ true: t.accent, false: t.line }} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status ? <Text style={styles.ok}>{status}</Text> : null}

      <TouchableOpacity style={[styles.send, (!canSend || busy) && styles.sendOff]} disabled={!canSend || busy} onPress={() => void send()}>
        {busy ? (
          <ActivityIndicator color={t.onAccent} />
        ) : (
          <Text style={styles.sendText}>
            {question.items.length && filled && filled < open.length ? `Send ${filled} of ${open.length}` : "Send"}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  )
}

export function InboxScreen() {
  const { settings } = useSettings()
  const t = useTheme()
  const theme = { background: t.bg, surface: t.surface }
  const styles = makeStyles(t)
  const { questions, approvals, loading, error, refresh, answer } = useInbox(settings.orgSlug)
  const [refreshing, setRefreshing] = useState(false)

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <StatusBar barStyle={t.dark ? "light-content" : "dark-content"} backgroundColor={theme.surface} />
      <View style={[styles.header, { backgroundColor: theme.surface }]}>
        <Text style={styles.title}>Inbox</Text>
        <Text style={styles.subtitle}>
          {questions.length
            ? `${questions.length} ${questions.length === 1 ? "question" : "questions"} waiting on you`
            : "Your agents ask here when they need you"}
          {approvals ? ` · ${approvals} waiting for your OK` : ""}
        </Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={t.accent} />
        ) : (
          <FlatList
            data={questions}
            keyExtractor={(q) => q.id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                tintColor={t.accent}
                onRefresh={async () => {
                  setRefreshing(true)
                  await refresh()
                  setRefreshing(false)
                }}
              />
            }
            ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Bell size={36} color={t.faint} />
                <Text style={styles.emptyTitle}>You&apos;re all caught up</Text>
                <Text style={styles.emptyBody}>When an agent needs a decision or a fact from you, it shows up here.</Text>
              </View>
            }
            renderItem={({ item }) => <QuestionCard question={item} onAnswer={answer} />}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: t.line },
  title: { color: t.text, fontSize: 22, fontWeight: "700" },
  subtitle: { color: t.muted, fontSize: 13, marginTop: 2 },
  list: { padding: 12, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: t.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: t.line },
  cardTitle: { color: t.text, fontSize: 15, fontWeight: "600" },
  meta: { color: t.faint, fontSize: 12, marginTop: 2 },
  question: { color: t.text, fontSize: 15, marginTop: 10, lineHeight: 21 },
  body: { color: t.muted, fontSize: 14, marginTop: 6, lineHeight: 20 },
  more: { color: t.accent, fontSize: 13, marginTop: 4, fontWeight: "600" },
  item: { backgroundColor: t.raised, borderRadius: 12, padding: 10, marginTop: 10 },
  answered: { flexDirection: "row", gap: 8, backgroundColor: t.raised, borderRadius: 12, padding: 10, marginTop: 10 },
  itemQ: { color: t.text, fontSize: 14 },
  itemA: { color: t.text, fontSize: 14, fontWeight: "600", marginTop: 2 },
  hint: { color: t.faint, fontSize: 12, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: { borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: t.accent, borderColor: t.accent },
  chipText: { color: t.muted, fontSize: 13 },
  chipTextOn: { color: t.onAccent, fontWeight: "600" },
  input: {
    backgroundColor: t.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.line,
    color: t.text,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    marginTop: 8,
  },
  note: { minHeight: 60, textAlignVertical: "top", marginTop: 12 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10, gap: 10 },
  switchLabel: { color: t.muted, fontSize: 13, flex: 1 },
  send: { backgroundColor: t.accent, borderRadius: 12, paddingVertical: 12, alignItems: "center", marginTop: 12 },
  sendOff: { opacity: 0.45 },
  sendText: { color: t.onAccent, fontWeight: "700", fontSize: 15 },
  error: { color: t.danger, fontSize: 13, marginTop: 8 },
  ok: { color: t.accent, fontSize: 13, marginTop: 8 },
  empty: { alignItems: "center", marginTop: 80, gap: 8, paddingHorizontal: 32 },
  emptyTitle: { color: t.text, fontSize: 17, fontWeight: "600" },
  emptyBody: { color: t.muted, fontSize: 14, textAlign: "center" },
})
}
