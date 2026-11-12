import { useColorScheme } from "react-native"
import { useSettings } from "../hooks/useSettings"

/**
 * Sayabot mobile design tokens. Warm ink and coral, matching the web app, in light and dark.
 * Screens read colours through useTheme(), never hex values.
 */

export interface Theme {
  dark: boolean
  bg: string
  surface: string
  card: string
  raised: string
  line: string
  lineStrong: string
  text: string
  muted: string
  faint: string
  accent: string
  accentPressed: string
  accentSoft: string
  onAccent: string
  ok: string
  okSoft: string
  warn: string
  warnSoft: string
  danger: string
  dangerSoft: string
  overlay: string
  bubbleMine: string
  bubbleMineText: string
  bubbleTheirs: string
}

export const darkTheme: Theme = {
  dark: true,
  bg: "#0b0b0c",
  surface: "#121214",
  card: "#18181b",
  raised: "#222225",
  line: "#26262a",
  lineStrong: "#36363c",
  text: "#f4f3f1",
  muted: "#a9a9b0",
  faint: "#7c7c85",
  accent: "#ff5d6c",
  accentPressed: "#ff7a86",
  accentSoft: "rgba(255, 93, 108, 0.14)",
  onAccent: "#0b0b0c",
  ok: "#7fce95",
  okSoft: "rgba(127, 206, 149, 0.14)",
  warn: "#e6bc6a",
  warnSoft: "rgba(230, 188, 106, 0.14)",
  danger: "#f0776f",
  dangerSoft: "rgba(240, 119, 111, 0.14)",
  overlay: "rgba(0, 0, 0, 0.6)",
  bubbleMine: "#ff5d6c",
  bubbleMineText: "#160a0c",
  bubbleTheirs: "#1c1c1f",
}

export const lightTheme: Theme = {
  dark: false,
  bg: "#f6f5f3",
  surface: "#ffffff",
  card: "#ffffff",
  raised: "#efeeeb",
  line: "#e7e5e1",
  lineStrong: "#d6d3ce",
  text: "#18181b",
  muted: "#5e5e66",
  faint: "#8b8b93",
  accent: "#e5485a",
  accentPressed: "#cf3a4c",
  accentSoft: "rgba(229, 72, 90, 0.1)",
  onAccent: "#ffffff",
  ok: "#2e9a59",
  okSoft: "rgba(46, 154, 89, 0.12)",
  warn: "#b07619",
  warnSoft: "rgba(176, 118, 25, 0.12)",
  danger: "#d64545",
  dangerSoft: "rgba(214, 69, 69, 0.1)",
  overlay: "rgba(20, 20, 24, 0.35)",
  bubbleMine: "#e5485a",
  bubbleMineText: "#ffffff",
  bubbleTheirs: "#ffffff",
}

export function useTheme(): Theme {
  const scheme = useColorScheme()
  const { settings } = useSettings()
  const mode = settings.themeMode
  if (mode === "light") return lightTheme
  if (mode === "system") return scheme === "light" ? lightTheme : darkTheme
  if (mode === "oled") return { ...darkTheme, bg: "#000000", surface: "#050505", card: "#0d0d0f" }
  return darkTheme
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 }
export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 }

/** Pastels that give each agent its own identity (never status). */
export const IDENTITY = ["#ee5fb8", "#f2c14e", "#4fcdb0", "#5b9df5", "#b79cf0", "#ff7a70", "#7fce95", "#f59e6b"]

export function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
