import AsyncStorage from "@react-native-async-storage/async-storage"
import Constants from "expo-constants"
import * as Device from "expo-device"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"
import { api } from "./api"
import { navigateWhenReady } from "./nav"

/**
 * Phone alerts. A question has Answer (type a reply right in the notification) and Open; an
 * approval has Allow and Don't allow. Answers and decisions go straight to Sayabot.
 */

const TOKEN_KEY = "@sayabot/push_token"
const WORKING_ID = "agent-working"

Notifications.setNotificationHandler({
  handleNotification: async (n) => ({
    // Don't pop the "agent is working" status over the app while it's open.
    shouldShowAlert: n.request.identifier !== WORKING_ID,
    shouldPlaySound: n.request.identifier !== WORKING_ID,
    shouldSetBadge: true,
  }),
})

export async function configureNotifications(): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("agents", {
      name: "Questions and approvals",
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: "#ff5d6c",
      vibrationPattern: [0, 180, 120, 180],
    })
    await Notifications.setNotificationChannelAsync("status", {
      name: "Agent activity",
      importance: Notifications.AndroidImportance.LOW,
      showBadge: false,
    })
  }
  await Notifications.setNotificationCategoryAsync("question", [
    {
      identifier: "answer",
      buttonTitle: "Answer",
      textInput: { submitButtonTitle: "Send", placeholder: "Your answer" },
      options: { opensAppToForeground: true },
    },
    { identifier: "open", buttonTitle: "Open", options: { opensAppToForeground: true } },
  ])
  await Notifications.setNotificationCategoryAsync("approval", [
    { identifier: "allow", buttonTitle: "Allow", options: { opensAppToForeground: true } },
    { identifier: "deny", buttonTitle: "Don't allow", options: { opensAppToForeground: true, isDestructive: true } },
  ])
}

export async function enablePush(prompt = true): Promise<boolean> {
  if (!Device.isDevice) throw new Error("Alerts need a real phone, not a simulator.")
  let { status } = await Notifications.getPermissionsAsync()
  if (status !== "granted" && prompt) status = (await Notifications.requestPermissionsAsync()).status
  if (status !== "granted") return false
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data
  await api("/api/mobile/push", { body: { token, platform: Platform.OS } })
  await AsyncStorage.setItem(TOKEN_KEY, token)
  return true
}

export async function disablePush(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY)
  if (token) await api("/api/mobile/push", { method: "DELETE", body: { token } }).catch(() => {})
  await AsyncStorage.removeItem(TOKEN_KEY)
}

interface AlertData {
  kind?: "approval" | "request"
  refId?: string | null
  roomId?: string
  orgSlug?: string
}

/** Acts on a tapped alert or one of its buttons. */
export async function handleNotificationResponse(response: Notifications.NotificationResponse): Promise<void> {
  const data = (response.notification.request.content.data ?? {}) as AlertData
  const action = response.actionIdentifier
  try {
    if (action === "answer" && data.refId && data.orgSlug && response.userText?.trim()) {
      await api("/api/mobile/inbox/answer", { body: { orgSlug: data.orgSlug, taskId: data.refId, answer: response.userText.trim(), alsoPost: false } })
      await Notifications.scheduleNotificationAsync({ content: { title: "Answer sent", body: response.userText.trim().slice(0, 100) }, trigger: null })
      return
    }
    if ((action === "allow" || action === "deny") && data.refId) {
      await api(`/api/v1/tools/${data.refId}/approve`, { body: { approved: action === "allow" } })
      return
    }
  } catch {
    // Fall through and open the app so the person can act there.
  }
  if (data.kind === "request") navigateWhenReady("MainTabs", { screen: "InboxTab" })
  else if (data.roomId) navigateWhenReady("Chat", { roomId: data.roomId, roomName: "Chat", orgSlug: data.orgSlug })
}

/** Android: an ongoing "Hermes is working…" notification while the app is in the background. */
export async function showWorkingStatus(text: string | null): Promise<void> {
  if (Platform.OS !== "android") return
  if (!text) {
    await Notifications.dismissNotificationAsync(WORKING_ID).catch(() => {})
    return
  }
  await Notifications.scheduleNotificationAsync({
    identifier: WORKING_ID,
    content: { title: "Sayabot", body: text, sticky: true, autoDismiss: false, priority: "low" },
    trigger: { channelId: "status" } as Notifications.NotificationTriggerInput,
  }).catch(() => {})
}
