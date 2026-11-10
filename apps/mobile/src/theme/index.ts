import { Platform } from "react-native"

export const colors = {
  // Backgrounds
  background: "#0b141a",
  backgroundSecondary: "#121b22",
  surface: "#1f2c34",
  surfaceLight: "#202c33",
  surfaceElevated: "#233138",
  
  // Borders & Dividers
  border: "#2a3942",
  borderSubtle: "#222d34",
  borderLight: "#374248",
  
  // Brand & Emeralds
  primary: "#00a884",
  primaryBright: "#25d366",
  primaryDark: "#005c4b",
  primaryMuted: "rgba(0, 168, 132, 0.15)",
  primaryGlow: "rgba(37, 211, 102, 0.25)",
  
  // Chat Bubbles
  bubbleHuman: "#005c4b",
  bubbleHumanBorder: "#026d59",
  bubbleAgent: "#202c33",
  bubbleAgentBorder: "#2a3942",
  bubbleSystem: "#182229",

  // Typography
  textPrimary: "#e9edef",
  textSecondary: "#8696a0",
  textMuted: "#667781",
  textInverse: "#111b21",
  textPlaceholder: "#667781",

  // Accents & Badges
  accentCyan: "#53bdeb",
  accentGold: "#ffd279",
  accentWarning: "#eab308",
  accentDanger: "#f15c6d",
  accentDangerBg: "#3b1e1e",
  accentPurple: "#a855f7",
  accentBlue: "#3b82f6",

  // Overlays
  overlay: "rgba(0, 0, 0, 0.75)",
  codeBg: "#06090e",
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
