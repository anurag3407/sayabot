import React from "react"
import { StyleSheet, View, type ViewProps } from "react-native"
import { colors } from "../../theme"

interface GlassCardProps extends ViewProps {
  children: React.ReactNode
  variant?: "default" | "active" | "danger" | "terminal"
}

export function GlassCard({ children, style, variant = "default", ...props }: GlassCardProps) {
  return (
    <View style={[styles.card, styles[variant], style]} {...props}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    padding: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  default: {},
  active: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  danger: {
    borderColor: colors.accentDanger,
    backgroundColor: colors.accentDangerBg,
  },
  terminal: {
    borderColor: colors.borderSubtle,
    backgroundColor: colors.codeBg,
  },
})
