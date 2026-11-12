import * as Haptics from "expo-haptics"
import { loadSettings } from "../core/settings"

/** Feedback that respects the Haptics setting. Never throws (simulators, old devices). */
let enabled = true
void loadSettings().then((s) => (enabled = s.hapticsEnabled !== false))
export function setHapticsEnabled(value: boolean) {
  enabled = value
}

export const haptic = {
  tap: () => enabled && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  press: () => enabled && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
  select: () => enabled && void Haptics.selectionAsync().catch(() => {}),
  success: () => enabled && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  warn: () => enabled && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}),
}
