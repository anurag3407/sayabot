import React, { useEffect, useRef, useState } from "react"
import { ActivityIndicator, AppState, View } from "react-native"
import * as Notifications from "expo-notifications"
import * as QuickActions from "expo-quick-actions"
import { useQuickActionCallback } from "expo-quick-actions/hooks"
import { useShareIntentContext } from "expo-share-intent"
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { isDemoMode, setDemoMode, subscribeDemoMode } from "../core/session-mode"
import { useAuth } from "../hooks/useAuth"
import { AuthScreen } from "../screens/AuthScreen"
import { TabNavigator } from "./TabNavigator"
import { ChatScreen } from "../screens/ChatScreen"
import { AgentProfileScreen } from "../screens/AgentProfileScreen"
import { ComputersScreen } from "../screens/ComputersScreen"
import { OnboardingScreen } from "../screens/OnboardingScreen"
import { AdvancedScreen } from "../screens/AdvancedScreen"
import { ShareTargetScreen } from "../screens/ShareTargetScreen"
import { UsageScreen } from "../screens/UsageScreen"
import { WebPageScreen } from "../screens/WebPageScreen"
import { flushPendingNavigation, navigateWhenReady, navigationRef } from "../core/nav"
import { configureNotifications, enablePush, handleNotificationResponse, showWorkingStatus } from "../core/push"
import { useHome } from "../hooks/useHome"
import { AppLockGate } from "../components/AppLockGate"
import { useSettings } from "../hooks/useSettings"
import { useTheme } from "../ui/theme"

const Stack = createNativeStackNavigator()

/** Phone-level integrations that need to run once the person is signed in. */
function SignedInEffects() {
  const { settings } = useSettings()
  const { data } = useHome()
  const { hasShareIntent } = useShareIntentContext()
  const appState = useRef(AppState.currentState)

  // Push: categories, taps and button presses (including the one that launched the app).
  useEffect(() => {
    void configureNotifications()
    const sub = Notifications.addNotificationResponseReceivedListener((r) => void handleNotificationResponse(r))
    void Notifications.getLastNotificationResponseAsync().then((r) => r && void handleNotificationResponse(r))
    return () => sub.remove()
  }, [])
  useEffect(() => {
    if (settings.pushNotifications) void enablePush(false).catch(() => {})
  }, [settings.pushNotifications])

  // Home-screen shortcuts (long-press the app icon).
  useEffect(() => {
    void QuickActions.setItems([
      { id: "new-chat", title: "New chat", icon: "compose" },
      { id: "inbox", title: "Inbox", icon: "symbol:bell" },
      { id: "new-task", title: "New task", icon: "task" },
    ]).catch(() => {})
  }, [])
  useQuickActionCallback((action) => {
    if (action.id === "inbox") navigateWhenReady("MainTabs", { screen: "InboxTab" })
    if (action.id === "new-chat") navigateWhenReady("MainTabs", { screen: "HomeTab", params: { action: "new-chat", at: Date.now() } })
    if (action.id === "new-task") navigateWhenReady("MainTabs", { screen: "TasksTab", params: { action: "new-task", at: Date.now() } })
  })

  // "Share to Sayabot" from another app.
  useEffect(() => {
    if (hasShareIntent) navigateWhenReady("ShareTarget")
  }, [hasShareIntent])

  // Android: show who is working while the app is in the background.
  const working = (data?.agents ?? []).filter((a) => a.workingRoomId)
  const workingText = working.length
    ? `${working.map((a) => a.name).join(", ")} ${working.length === 1 ? "is" : "are"} working${
        working[0] ? ` in ${data?.chats.find((c) => c.id === working[0]!.workingRoomId)?.name ?? "a chat"}` : ""
      }…`
    : null
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      appState.current = next
      void showWorkingStatus(next === "background" ? workingText : null)
    })
    if (appState.current === "background") void showWorkingStatus(workingText)
    return () => sub.remove()
  }, [workingText])

  return null
}

export function RootNavigator() {
  const { session, loading } = useAuth()
  const [demoMode, setDemo] = useState(isDemoMode)
  const theme = useTheme()
  const { settings, loading: settingsLoading } = useSettings()
  const navTheme = {
    ...(theme.dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(theme.dark ? DarkTheme : DefaultTheme).colors,
      background: theme.bg,
      card: theme.surface,
      text: theme.text,
      border: theme.line,
      primary: theme.accent,
    },
  }

  useEffect(() => subscribeDemoMode(setDemo), [])

  if (loading || settingsLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    )
  }

  const isAuthenticated = Boolean(session || demoMode)

  return (
    <AppLockGate>
      <NavigationContainer theme={navTheme} ref={navigationRef} onReady={flushPendingNavigation}>
        {isAuthenticated && session && settings.onboarded ? <SignedInEffects /> : null}
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.bg },
            animation: "slide_from_right",
            fullScreenGestureEnabled: true,
          }}
        >
          {!isAuthenticated ? (
            <Stack.Screen name="Auth">
              {() => <AuthScreen onEnterDemo={() => setDemoMode(true)} />}
            </Stack.Screen>
          ) : !settings.onboarded && session ? (
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          ) : (
            <>
              <Stack.Screen name="MainTabs" component={TabNavigator} />
              <Stack.Screen name="Chat" component={ChatScreen} />
              <Stack.Screen name="AgentProfile" component={AgentProfileScreen} />
              <Stack.Screen name="WebPage" component={WebPageScreen} />
              <Stack.Screen name="ShareTarget" component={ShareTargetScreen} options={{ presentation: "modal", animation: "slide_from_bottom" }} />
              <Stack.Screen
                name="Usage"
                component={UsageScreen}
                options={{ headerShown: true, title: "Usage", headerBackTitle: "More", headerTintColor: theme.accent, headerStyle: { backgroundColor: theme.surface }, headerTitleStyle: { color: theme.text } }}
              />
              <Stack.Screen
                name="Computers"
                component={ComputersScreen}
                options={{ headerShown: true, title: "Computers", headerBackTitle: "More", headerTintColor: theme.accent, headerStyle: { backgroundColor: theme.surface }, headerTitleStyle: { color: theme.text } }}
              />
              <Stack.Screen
                name="AdvancedSettings"
                component={AdvancedScreen}
                options={{ headerShown: true, title: "Advanced", headerBackTitle: "More", headerTintColor: theme.accent, headerStyle: { backgroundColor: theme.surface }, headerTitleStyle: { color: theme.text } }}
              />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </AppLockGate>
  )
}
