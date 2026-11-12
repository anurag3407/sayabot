import React from "react"
import { Text as RNText, type TextProps, type TextStyle } from "react-native"
import { useTheme, type Theme } from "./theme"

export type TextVariant = "largeTitle" | "title" | "headline" | "body" | "callout" | "subhead" | "footnote" | "caption"
export type TextTone = "text" | "muted" | "faint" | "accent" | "danger" | "ok" | "warn" | "onAccent"

const VARIANTS: Record<TextVariant, TextStyle> = {
  largeTitle: { fontSize: 32, lineHeight: 38, fontWeight: "800", letterSpacing: -0.6 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700", letterSpacing: -0.3 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 22 },
  callout: { fontSize: 15, lineHeight: 20 },
  subhead: { fontSize: 14, lineHeight: 19 },
  footnote: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16 },
}

function toneColor(theme: Theme, tone: TextTone): string {
  switch (tone) {
    case "muted":
      return theme.muted
    case "faint":
      return theme.faint
    case "accent":
      return theme.accent
    case "danger":
      return theme.danger
    case "ok":
      return theme.ok
    case "warn":
      return theme.warn
    case "onAccent":
      return theme.onAccent
    default:
      return theme.text
  }
}

/** All product text goes through this, so sizes and colours stay one system. */
export function Text({
  variant = "body",
  tone = "text",
  weight,
  center,
  style,
  ...rest
}: TextProps & { variant?: TextVariant; tone?: TextTone; weight?: TextStyle["fontWeight"]; center?: boolean }) {
  const theme = useTheme()
  return (
    <RNText
      {...rest}
      style={[VARIANTS[variant], { color: toneColor(theme, tone) }, weight ? { fontWeight: weight } : null, center ? { textAlign: "center" } : null, style]}
    />
  )
}
