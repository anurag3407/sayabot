import React, { useEffect, useState } from "react"
import { ActivityIndicator, View } from "react-native"
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
import { SettingsScreen } from "../screens/SettingsScreen"
import { AppLockGate } from "../components/AppLockGate"
import { useSettings } from "../hooks/useSettings"
import { useTheme } from "../ui/theme"

const Stack = createNativeStackNavigator()

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
      <NavigationContainer theme={navTheme}>
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
              <Stack.Screen
                name="Computers"
                component={ComputersScreen}
                options={{ headerShown: true, title: "Computers", headerBackTitle: "More", headerTintColor: theme.accent, headerStyle: { backgroundColor: theme.surface }, headerTitleStyle: { color: theme.text } }}
              />
              <Stack.Screen
                name="AdvancedSettings"
                component={SettingsScreen}
                options={{ headerShown: true, title: "Advanced", headerBackTitle: "More", headerTintColor: theme.accent, headerStyle: { backgroundColor: theme.surface }, headerTitleStyle: { color: theme.text } }}
              />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </AppLockGate>
  )
}
