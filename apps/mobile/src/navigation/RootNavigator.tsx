import React, { useEffect, useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { isDemoMode, setDemoMode, subscribeDemoMode } from "../core/session-mode"
import { useAuth } from "../hooks/useAuth"
import { AuthScreen } from "../screens/AuthScreen"
import { TabNavigator } from "./TabNavigator"
import { ChatScreen } from "../screens/ChatScreen"
import { colors } from "../theme"

const Stack = createNativeStackNavigator()

export function RootNavigator() {
  const { session, loading } = useAuth()
  const [demoMode, setDemo] = useState(isDemoMode)

  useEffect(() => subscribeDemoMode(setDemo), [])

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    )
  }

  const isAuthenticated = Boolean(session || demoMode)

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {!isAuthenticated ? (
          <Stack.Screen name="Auth">
            {() => <AuthScreen onEnterDemo={() => setDemoMode(true)} />}
          </Stack.Screen>
        ) : (
          <>
            <Stack.Screen name="MainTabs" component={TabNavigator} />
            <Stack.Screen
              name="Chat"
              component={ChatScreen}
              options={{ animation: "slide_from_right" }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  )
}
