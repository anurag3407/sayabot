import { Platform } from "react-native"

/**
 * Legacy palette for the older screens (Tasks, Settings, Computers). Same keys as before,
 * now in Sayabot's own brand (warm ink + coral) so every screen matches the new design system
 * in src/ui. New screens use useTheme() from src/ui/theme instead.
 */
export const colors = {
  background: "#0b0b0c",
  backgroundSecondary: "#111113",
  surface: "#161618",
  surfaceLight: "#1c1c1f",
  surfaceElevated: "#232326",

  border: "#2a2a2e",
  borderSubtle: "#212124",
  borderLight: "#3a3a40",

  primary: "#ff5d6c",
  primaryBright: "#ff7a86",
  primaryDark: "#c63e4f",
  primaryMuted: "rgba(255, 93, 108, 0.14)",
  primaryGlow: "rgba(255, 93, 108, 0.25)",

  bubbleHuman: "#3a1b20",
  bubbleHumanBorder: "#5a2a31",
  bubbleAgent: "#1c1c1f",
  bubbleAgentBorder: "#2a2a2e",
  bubbleSystem: "#141416",

  textPrimary: "#f4f3f1",
  textSecondary: "#a9a9b0",
  textMuted: "#85858d",
  textInverse: "#0b0b0c",
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
