import React, { type ReactNode } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Switch, View, type ViewStyle } from "react-native"
import { ChevronRight } from "lucide-react-native"
import { haptic } from "./haptics"
import { Text } from "./Text"
import { radius, space, useTheme } from "./theme"

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger"

export function Button({
  title,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
  size = "md",
  style,
  accessibilityLabel,
}: {
  title: string
  onPress?: () => void
  variant?: ButtonVariant
  icon?: ReactNode
  loading?: boolean
  disabled?: boolean
  size?: "sm" | "md" | "lg"
  style?: ViewStyle
  accessibilityLabel?: string
}) {
  const theme = useTheme()
  const bg =
    variant === "primary" ? theme.accent : variant === "secondary" ? theme.raised : variant === "danger" ? theme.dangerSoft : "transparent"
  const fg = variant === "primary" ? theme.onAccent : variant === "danger" ? theme.danger : variant === "ghost" ? theme.accent : theme.text
  const height = size === "sm" ? 36 : size === "lg" ? 54 : 46
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={() => {
        haptic.tap()
        onPress?.()
      }}
      style={({ pressed }) => [
        {
          height,
          borderRadius: radius.pill,
          paddingHorizontal: size === "sm" ? 14 : 20,
          backgroundColor: bg,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon}
      {!loading ? (
        <Text variant={size === "sm" ? "subhead" : "headline"} weight="600" style={{ color: fg }}>
          {title}
        </Text>
      ) : null}
    </Pressable>
  )
}

/** Round icon button for headers and toolbars. */
export function IconButton({
  icon,
  onPress,
  label,
  size = 40,
  tint,
}: {
  icon: ReactNode
  onPress: () => void
  label: string
  size?: number
  tint?: string
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={() => {
        haptic.tap()
        onPress()
      }}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tint ?? theme.raised,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {icon}
    </Pressable>
  )
}

/** iOS-style grouped list: soft corners, inset hairlines, an optional caption above. */
export function Group({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const theme = useTheme()
  const items = React.Children.toArray(children).filter(Boolean)
  return (
    <View style={{ marginBottom: space.xl }}>
      {title ? (
        <Text variant="footnote" tone="muted" style={{ marginLeft: space.lg, marginBottom: 6 }}>
          {title}
        </Text>
      ) : null}
      <View style={{ backgroundColor: theme.card, borderRadius: radius.lg, overflow: "hidden" }}>
        {items.map((child, i) => (
          <View key={i}>
            {child}
            {i < items.length - 1 ? (
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.line, marginLeft: 56 }} />
            ) : null}
          </View>
        ))}
      </View>
      {footer ? (
        <Text variant="caption" tone="faint" style={{ marginHorizontal: space.lg, marginTop: 6 }}>
          {footer}
        </Text>
      ) : null}
    </View>
  )
}

export function Row({
  icon,
  iconBg,
  title,
  subtitle,
  value,
  onPress,
  chevron = Boolean(onPress),
  destructive,
  right,
}: {
  icon?: ReactNode
  iconBg?: string
  title: string
  subtitle?: string
  value?: string
  onPress?: () => void
  chevron?: boolean
  destructive?: boolean
  right?: ReactNode
}) {
  const theme = useTheme()
  return (
    <Pressable
      disabled={!onPress}
      onPress={() => {
        haptic.select()
        onPress?.()
      }}
      accessibilityRole={onPress ? "button" : undefined}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        minHeight: 52,
        paddingHorizontal: space.lg,
        paddingVertical: 10,
        gap: 12,
        backgroundColor: pressed ? theme.raised : "transparent",
      })}
    >
      {icon ? (
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            backgroundColor: iconBg ?? theme.raised,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="callout" tone={destructive ? "danger" : "text"} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="callout" tone="muted" numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right}
      {chevron ? <ChevronRight size={18} color={theme.faint} /> : null}
    </Pressable>
  )
}

export function ToggleRow({
  icon,
  iconBg,
  title,
  subtitle,
  value,
  onChange,
}: {
  icon?: ReactNode
  iconBg?: string
  title: string
  subtitle?: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  const theme = useTheme()
  return (
    <Row
      icon={icon}
      iconBg={iconBg}
      title={title}
      subtitle={subtitle}
      chevron={false}
      right={
        <Switch
          value={value}
          onValueChange={(v) => {
            haptic.select()
            onChange(v)
          }}
          trackColor={{ true: theme.accent, false: theme.lineStrong }}
          thumbColor="#ffffff"
          accessibilityLabel={title}
        />
      }
    />
  )
}

export function Badge({ count, tone = "accent" }: { count: number; tone?: "accent" | "warn" | "muted" }) {
  const theme = useTheme()
  if (!count) return null
  const bg = tone === "accent" ? theme.accent : tone === "warn" ? theme.warn : theme.raised
  const fg = tone === "muted" ? theme.muted : theme.onAccent
  return (
    <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Text variant="caption" weight="700" style={{ color: fg }}>
        {count > 99 ? "99+" : count}
      </Text>
    </View>
  )
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: ReactNode }) {
  const theme = useTheme()
  return (
    <Pressable
      onPress={() => {
        haptic.select()
        onPress?.()
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 34,
        paddingHorizontal: 14,
        borderRadius: radius.pill,
        backgroundColor: selected ? theme.accent : theme.raised,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {icon}
      <Text variant="subhead" weight="600" style={{ color: selected ? theme.onAccent : theme.text }}>
        {label}
      </Text>
    </Pressable>
  )
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: "center", paddingHorizontal: 32, paddingVertical: 48, gap: 10 }}>
      {icon}
      <Text variant="headline" center>
        {title}
      </Text>
      {body ? (
        <Text variant="subhead" tone="muted" center>
          {body}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
    </View>
  )
}
