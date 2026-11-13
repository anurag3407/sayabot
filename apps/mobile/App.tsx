import React from "react"
import { StatusBar } from "expo-status-bar"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { ShareIntentProvider } from "expo-share-intent"
import { RootNavigator } from "./src/navigation/RootNavigator"
import { useTheme } from "./src/ui/theme"

function ThemedStatusBar() {
  const theme = useTheme()
  return <StatusBar style={theme.dark ? "light" : "dark"} />
}

export default function App() {
  return (
    <ShareIntentProvider options={{ resetOnBackground: true }}>
      <SafeAreaProvider>
        <ThemedStatusBar />
        <RootNavigator />
      </SafeAreaProvider>
    </ShareIntentProvider>
  )
}
