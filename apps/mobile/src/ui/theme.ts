import { useColorScheme } from "react-native"
import { useSettings } from "../hooks/useSettings"

/**
 * Sayabot mobile design tokens. Cool graphite and iris, matching the web app, in light and dark.
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
  bg: "#09090b",
  surface: "#111114",
  card: "#17171b",
  raised: "#1f1f24",
  line: "#232329",
  lineStrong: "#34343c",
  text: "#ededf0",
  muted: "#a3a3ad",
  faint: "#8b8b96",
  accent: "#9d8cff",
  accentPressed: "#b6a9ff",
  accentSoft: "rgba(157, 140, 255, 0.14)",
  onAccent: "#09090b",
  ok: "#6fd39a",
  okSoft: "rgba(111, 211, 154, 0.14)",
  warn: "#e8c06a",
  warnSoft: "rgba(232, 192, 106, 0.14)",
  danger: "#f2756e",
  dangerSoft: "rgba(242, 117, 110, 0.14)",
  overlay: "rgba(0, 0, 0, 0.6)",
  bubbleMine: "#9d8cff",
  bubbleMineText: "#0f0b24",
  bubbleTheirs: "#1c1c21",
}

export const lightTheme: Theme = {
  dark: false,
  bg: "#f5f5f7",
  surface: "#ffffff",
  card: "#ffffff",
  raised: "#ededf1",
  line: "#e4e4ea",
  lineStrong: "#d2d2db",
  text: "#18181b",
  muted: "#5c5c66",
  faint: "#7a7a85",
  accent: "#6d5ce8",
  accentPressed: "#5b4bd6",
  accentSoft: "rgba(109, 92, 232, 0.1)",
  onAccent: "#ffffff",
  ok: "#2e9a59",
  okSoft: "rgba(46, 154, 89, 0.12)",
  warn: "#a06a12",
  warnSoft: "rgba(176, 118, 25, 0.12)",
  danger: "#d64545",
  dangerSoft: "rgba(214, 69, 69, 0.1)",
  overlay: "rgba(20, 20, 24, 0.35)",
  bubbleMine: "#6d5ce8",
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
