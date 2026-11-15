import { Platform } from "react-native"

/**
 * Legacy palette for the older screens (Tasks, Settings, Computers). Same keys as before,
 * now in Sayabot's own palette (cool graphite + iris) so every screen matches the new design system
 * in src/ui. New screens use useTheme() from src/ui/theme instead.
 */
export const colors = {
  background: "#09090b",
  backgroundSecondary: "#111114",
  surface: "#17171b",
  surfaceLight: "#1c1c21",
  surfaceElevated: "#1f1f24",

  border: "#2a2a31",
  borderSubtle: "#232329",
  borderLight: "#34343c",

  primary: "#9d8cff",
  primaryBright: "#b6a9ff",
  primaryDark: "#6d5ce8",
  primaryMuted: "rgba(157, 140, 255, 0.14)",
  primaryGlow: "rgba(157, 140, 255, 0.25)",

  bubbleHuman: "#241f45",
  bubbleHumanBorder: "#3a3270",
  bubbleAgent: "#1c1c21",
  bubbleAgentBorder: "#2a2a31",
  bubbleSystem: "#141416",

  textPrimary: "#ededf0",
  textSecondary: "#a3a3ad",
  textMuted: "#8b8b96",
  textInverse: "#09090b",
  textPlaceholder: "#6d6d75",

  accentCyan: "#5b9df5",
  accentGold: "#f2c14e",
  accentWarning: "#e6bc6a",
  accentDanger: "#f0776f",
  accentDangerBg: "#3b1e1e",
  accentPurple: "#b79cf0",
  accentBlue: "#5b9df5",

  overlay: "rgba(0, 0, 0, 0.72)",
  codeBg: "#08080a",
}

export type ThemeMode = "system" | "light" | "dark" | "oled" | "emerald"

export function paletteFor(mode: ThemeMode) {
  if (mode === "oled") {
    return {
      ...colors,
      background: "#000000",
      backgroundSecondary: "#000000",
      surface: "#050505",
      surfaceLight: "#121212",
      border: "#1c1c1c",
      borderSubtle: "#161616",
      bubbleAgent: "#0f1418",
      bubbleAgentBorder: "#1c252c",
    }
  }
  if (mode === "emerald") {
    return {
      ...colors,
      background: "#071410",
      backgroundSecondary: "#0b1c16",
      surface: "#10261e",
      surfaceLight: "#163228",
      border: "#1b3a2f",
      borderSubtle: "#142d24",
      bubbleAgent: "#0e241c",
      bubbleAgentBorder: "#194032",
    }
  }
  return colors
}

export const fonts = {
  mono: Platform.OS === "ios" ? "Menlo" : "monospace",
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
}

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  full: 9999,
}
