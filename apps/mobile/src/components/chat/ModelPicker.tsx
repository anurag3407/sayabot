import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native"
import { Check, ChevronUp, RefreshCw } from "lucide-react-native"
import { api } from "../../core/api"
import {
  buttonLabel,
  contextLabel,
  effortOptions,
  EFFORT_LABELS,
  fitEffort,
  money,
  SECTION_ORDER,
  SECTION_TITLE,
  type ModelValue,
  type PickerGroup,
  type PickerModel,
  type PickerSection,
  type RoomBotModel,
} from "../../core/model-choice"
import { Chip, Group, IconButton, Row } from "../../ui/controls"
import { haptic } from "../../ui/haptics"
import { refreshHome } from "../../hooks/useHome"
import { Mascot } from "../../ui/Mascot"
import { Sheet } from "../../ui/Sheet"
import { Text } from "../../ui/Text"
import { radius, space, useTheme } from "../../ui/theme"

interface Lists {
  groups: PickerGroup[]
  bots: RoomBotModel[]
  canEdit: boolean
}

const lastLists = new Map<string, { at: number; lists: Lists }>()
const FRESH_MS = 60_000

const TINT: Record<string, string> = {
  anthropic: "#d4a574",
  openai: "#10a37f",
  google: "#4285f4",
  groq: "#f55036",
  openrouter: "#6467f2",
  xai: "#c8c8d0",
  grok: "#c8c8d0",
  deepseek: "#4d6bfe",
  minimax: "#e85d4c",
  qwen: "#615ced",
  moonshot: "#1a1a1a",
  cerebras: "#f5a623",
  cloudflare: "#f6821f",
  ollama: "#fff",
  copilot: "#e8e8e8",
}

function ProviderMark({
  provider,
  label,
  size = 30,
}: {
  provider: string
  label: string
  size?: number
}) {
  const theme = useTheme()
  const tint = TINT[provider] ?? theme.accent
  const letter = (label.replace(/^the /i, "").trim()[0] ?? "?").toUpperCase()
  const light = tint === "#fff" || tint === "#c8c8d0" || tint === "#e8e8e8"
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        backgroundColor: tint,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        weight="700"
        style={{
          color: light ? "#111" : "#fff",
          fontSize: size < 24 ? 11 : 13,
          lineHeight: size < 24 ? 13 : 16,
        }}
      >
        {letter}
      </Text>
    </View>
  )
}

function modelMeta(model: PickerModel): string | undefined {
  const bits: string[] = []
  const ctx = contextLabel(model.contextWindow)
  if (ctx) bits.push(ctx)
  if (model.free) bits.push("Free")
  else if (model.price)
    bits.push(`$${money(model.price.inputPerMillion)} / $${money(model.price.outputPerMillion)}`)
  if (model.orgBlocked) bits.push("Blocked by org")
  if (model.needsCliUpdate) bits.push("Update app")
  if (model.listing === "new") bits.push("New")
  return bits.length ? bits.join(" · ") : undefined
}

/**
 * Model picker for a chat (every bot in the room) or one agent's default.
 * The trigger is whatever the screen already uses — a composer chip, or the profile row.
 */
export function ModelPicker({
  orgSlug,
  roomId,
  agentId,
  onSaved,
  trigger,
}: {
  orgSlug: string
  /** Set for the chat composer: picks apply to this room. */
  roomId?: string
  /** Set on an agent page: changes that bot's model everywhere. */
  agentId?: string
  onSaved?: () => void
  trigger: (props: {
    label: string
    overridden: boolean
    canEdit: boolean | null
    open: () => void
  }) => ReactNode
}) {
  const theme = useTheme()
  const cacheKey = `${orgSlug}/${roomId ?? ""}/${agentId ?? ""}`
  const [open, setOpen] = useState(false)
  const [lists, setLists] = useState<Lists | null>(() => lastLists.get(cacheKey)?.lists ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [botId, setBotId] = useState<string | null>(agentId ?? null)
  const [scope, setScope] = useState<"chat" | "default">(roomId ? "chat" : "default")
  const [section, setSection] = useState<PickerSection | null>(null)
  const [keyId, setKeyId] = useState<string | null | undefined>(undefined)
  const [query, setQuery] = useState("")
  const [showAll, setShowAll] = useState(false)
  const [custom, setCustom] = useState("")
  const [effort, setEffort] = useState<string | null>(null)

  const load = useCallback(
    async (refresh = false) => {
      const cached = lastLists.get(cacheKey)
      if (!refresh && cached && Date.now() - cached.at < FRESH_MS) {
        setLists(cached.lists)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const query = new URLSearchParams({ orgSlug, ...(refresh ? { refresh: "1" } : {}) })
        if (roomId) query.set("roomId", roomId)
        else if (agentId) query.set("agentId", agentId)
        const next = await api<Lists>(`/api/mobile/models?${query}`)
        lastLists.set(cacheKey, { at: Date.now(), lists: next })
        setLists(next)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load the model list")
      } finally {
        setLoading(false)
      }
    },
    [agentId, cacheKey, orgSlug, roomId],
  )

  useEffect(() => {
    void load(false)
  }, [load])

  const editable = useMemo(() => {
    const all = (lists?.bots ?? []).filter((b) => b.editable)
    if (!roomId && agentId) return all.filter((b) => b.id === agentId)
    return all
  }, [lists, agentId, roomId])
  const bot = editable.find((b) => b.id === botId) ?? editable[0]
  const effective = bot ? (bot.chat ?? bot.bot) : null
  const label = buttonLabel(lists?.groups ?? [], effective)

  const groups = lists?.groups ?? []
  const sections = SECTION_ORDER.filter((s) => groups.some((g) => g.section === s))
  const activeSection =
    section && sections.includes(section)
      ? section
      : (groups.find((g) => g.keyId === effective?.keyId)?.section ?? sections[0] ?? null)
  const inSection = groups.filter((g) => g.section === activeSection)
  const active =
    inSection.find((g) => g.keyId === (keyId === undefined ? effective?.keyId : keyId)) ??
    inSection[0]
  const q = query.trim().toLowerCase()
  const visibleModels = (active?.models ?? []).filter(
    (m) => !q || m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
  )
  const folded = !q && visibleModels.length > 6 && !showAll
  const shown = folded
    ? visibleModels.filter((m) => m.listing !== "older").slice(0, 6)
    : visibleModels.filter((m) => q || showAll || m.listing !== "older")
  const levels = effortOptions(
    active,
    active?.models.find((m) => m.id === (effective?.model ?? "")),
  )

  async function save(next: ModelValue | null) {
    if (!bot || !lists?.canEdit || saving) return
    const before = lists
    const target = bot.id
    const patched: Lists = {
      ...lists,
      bots: lists.bots.map((b) =>
        b.id !== target
          ? b
          : next === null
            ? { ...b, chat: null }
            : scope === "default" || !roomId
              ? { ...b, bot: next, chat: null }
              : { ...b, chat: next },
      ),
    }
    setLists(patched)
    lastLists.set(cacheKey, { at: Date.now(), lists: patched })
    setSaving(true)
    setError(null)
    try {
      await api(`/api/mobile/models`, {
        body: {
          orgSlug,
          agentId: bot.id,
          ...(roomId ? { roomId, scope: next ? scope : "chat", clear: next === null } : {}),
          keyId: next?.keyId ?? null,
          model: next?.model ?? null,
          effort: next?.effort ?? null,
        },
      })
      haptic.success()
      setOpen(false)
      lastLists.delete(cacheKey)
      onSaved?.()
    } catch (cause) {
      setLists(before)
      lastLists.set(cacheKey, { at: Date.now(), lists: before })
      setError(cause instanceof Error ? cause.message : "Could not change the model")
    } finally {
      setSaving(false)
    }
  }

  function pick(modelId: string | null) {
    if (!active) return
    const fitted = fitEffort(groups, active.keyId, modelId, effort)
    void save({ keyId: active.keyId, model: modelId, effort: fitted })
  }

  if (lists && editable.length === 0) return null

  return (
    <>
      {trigger({
        label,
        overridden: Boolean(bot?.chat),
        canEdit: lists ? lists.canEdit : null,
        open: () => {
          setEffort(effective?.effort ?? null)
          setKeyId(undefined)
          setOpen(true)
        },
      })}
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={bot ? bot.displayName : "Model"}
        height={0.92}
        right={
          <IconButton
            label="Refresh models"
            size={36}
            icon={
              loading ? (
                <ActivityIndicator color={theme.text} />
              ) : (
                <RefreshCw size={16} color={theme.text} />
              )
            }
            onPress={() => void load(true)}
          />
        }
      >
        {editable.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
          >
            {editable.map((b) => {
              const on = b.id === bot?.id
              return (
                <Pressable
                  key={b.id}
                  onPress={() => {
                    setBotId(b.id)
                    setKeyId(undefined)
                    setEffort((b.chat ?? b.bot).effort)
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingRight: 12,
                    paddingLeft: 4,
                    height: 40,
                    borderRadius: radius.pill,
                    backgroundColor: on ? theme.accentSoft : theme.raised,
                  }}
                >
                  <Mascot seed={b.handle} size={28} shadow={true} />
                  <Text variant="subhead" weight="600">
                    {b.displayName}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        ) : null}

        {roomId && bot ? (
          <View style={{ gap: 8, marginBottom: space.md }}>
            <Pressable
              disabled={!lists?.canEdit || saving || !bot.chat}
              onPress={() => void save(null)}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}
            >
              <Text variant="subhead" weight="600" style={{ flex: 1 }}>
                Use {bot.displayName}'s model
              </Text>
              {!bot.chat ? <Check size={16} color={theme.text} /> : null}
            </Pressable>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Chip
                label="Only this chat"
                selected={scope === "chat"}
                onPress={() => setScope("chat")}
              />
              <Chip
                label="Everywhere"
                selected={scope === "default"}
                onPress={() => setScope("default")}
              />
            </View>
          </View>
        ) : null}

        {!lists?.canEdit && lists ? (
          <Text variant="caption" tone="muted" style={{ marginBottom: 8 }}>
            Only workspace admins can change models.
          </Text>
        ) : null}
        {error ? (
          <Text variant="caption" tone="danger" style={{ marginBottom: 8 }}>
            {error}
          </Text>
        ) : null}
        {loading && !lists ? (
          <ActivityIndicator color={theme.accent} style={{ marginVertical: 24 }} />
        ) : null}

        {sections.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
          >
            {sections.map((s) => (
              <Chip
                key={s}
                label={SECTION_TITLE[s]}
                selected={s === activeSection}
                onPress={() => {
                  setSection(s)
                  setKeyId(undefined)
                  setShowAll(false)
                  setQuery("")
                }}
              />
            ))}
          </ScrollView>
        ) : null}

        {inSection.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
          >
            {inSection.map((g) => (
              <Chip
                key={g.keyId ?? "server"}
                label={g.hostName ? `${g.label}` : g.label}
                selected={g.keyId === active?.keyId}
                icon={<ProviderMark provider={g.provider} label={g.label} size={18} />}
                onPress={() => {
                  setKeyId(g.keyId)
                  setShowAll(false)
                }}
              />
            ))}
          </ScrollView>
        ) : null}

        {active ? (
          <View style={{ marginBottom: 8 }}>
            <Text variant="caption" tone="muted">
              {[active.detail, active.account, active.version ? `v${active.version}` : null]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            {active.notice ? (
              <Text variant="caption" tone="danger">
                {active.notice}
              </Text>
            ) : null}
            {active.runnerEnabled === false ? (
              <Text variant="caption" tone="warn">
                Turn on “Run agents on this computer” in Settings → Computers.
              </Text>
            ) : null}
            {active.plan?.error ? (
              <Text variant="caption" tone="faint">
                {active.plan.error}
              </Text>
            ) : active.plan?.windows.length ? (
              <Text variant="caption" tone="faint">
                {(active.plan.plan ? `${active.plan.plan} · ` : "") +
                  active.plan.windows
                    .slice(0, 2)
                    .map((w) => `${w.label} ${Math.round(w.usedPercent)}%`)
                    .join(" · ")}
              </Text>
            ) : null}
          </View>
        ) : null}

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search models"
          placeholderTextColor={theme.faint}
          style={{
            height: 40,
            borderRadius: radius.md,
            backgroundColor: theme.card,
            color: theme.text,
            paddingHorizontal: 14,
            marginBottom: 12,
          }}
        />

        <Group>
          {shown.map((m) => {
            const selected =
              active?.keyId === effective?.keyId && (m.id || null) === (effective?.model || null)
            const blocked = Boolean(m.orgBlocked)
            return (
              <Row
                key={m.id || "auto"}
                icon={
                  active ? <ProviderMark provider={active.provider} label={m.label} /> : undefined
                }
                iconBg="transparent"
                title={m.label || "Automatic"}
                subtitle={modelMeta(m)}
                chevron={false}
                right={selected ? <Check size={16} color={theme.text} /> : undefined}
                onPress={
                  lists?.canEdit && !blocked && !saving ? () => pick(m.id || null) : undefined
                }
              />
            )
          })}
          {!shown.length && !loading ? <Row title="No models" chevron={false} /> : null}
        </Group>
        {folded ? (
          <Pressable
            onPress={() => setShowAll(true)}
            style={{ marginTop: -space.md, marginBottom: space.lg }}
          >
            <Text variant="subhead" tone="accent" weight="600">
              Show all {visibleModels.length} models
            </Text>
          </Pressable>
        ) : null}

        {active && (active.section === "key" || active.section === "subscription") ? (
          <View style={{ flexDirection: "row", gap: 8, marginBottom: space.lg }}>
            <TextInput
              value={custom}
              onChangeText={setCustom}
              placeholder="Other model id"
              placeholderTextColor={theme.faint}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                flex: 1,
                height: 40,
                borderRadius: radius.md,
                backgroundColor: theme.card,
                color: theme.text,
                paddingHorizontal: 14,
              }}
            />
            <Chip label="Use" onPress={() => custom.trim() && pick(custom.trim())} />
          </View>
        ) : null}

        {levels.length ? (
          <View style={{ marginBottom: space.lg }}>
            <Text variant="footnote" tone="muted" style={{ marginBottom: 8 }}>
              Thinking effort. Tap the model again to keep this level.
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              <Chip label="Default" selected={effort === null} onPress={() => setEffort(null)} />
              {levels.map((level) => (
                <Chip
                  key={level}
                  label={EFFORT_LABELS[level] ?? level}
                  selected={effort === level}
                  onPress={() => setEffort(level)}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}
      </Sheet>
    </>
  )
}

/** Composer chip: the model this chat answers with. */
export function ChatModelButton({ orgSlug, roomId }: { orgSlug: string; roomId: string }) {
  const theme = useTheme()
  return (
    <ModelPicker
      orgSlug={orgSlug}
      roomId={roomId}
      onSaved={() => void refreshHome()}
      trigger={({ label, overridden, open }) => (
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={`Model, ${label}`}
          style={({ pressed }) => ({
            alignSelf: "flex-start",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginLeft: space.md,
            marginBottom: 4,
            paddingHorizontal: 12,
            height: 32,
            borderRadius: radius.pill,
            backgroundColor: pressed ? theme.raised : theme.card,
            borderWidth: 1,
            borderColor: overridden ? theme.accent : theme.lineStrong,
          })}
        >
          {overridden ? (
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.accent }} />
          ) : (
            <ChevronUp size={14} color={theme.muted} />
          )}
          <Text variant="caption" weight="600" numberOfLines={1} style={{ maxWidth: 220 }}>
            {label}
          </Text>
        </Pressable>
      )}
    />
  )
}
