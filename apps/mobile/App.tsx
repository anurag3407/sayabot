import React, { useEffect, useState } from "react"
import { StatusBar } from "expo-status-bar"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { ShareIntentProvider } from "expo-share-intent"
import { RootNavigator } from "./src/navigation/RootNavigator"
import { useTheme } from "./src/ui/theme"
import { restoreServerClient } from "./src/core/supabase"

function ThemedStatusBar() {
  const theme = useTheme()
  return <StatusBar style={theme.dark ? "light" : "dark"} />
}

export default function App() {
  // The phone may be connected to a self-hosted server: use its Supabase before anything signs in.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void restoreServerClient().finally(() => setReady(true))
  }, [])
  if (!ready) return null

  return (
    <ShareIntentProvider options={{ resetOnBackground: true }}>
      <SafeAreaProvider>
        <ThemedStatusBar />
        <RootNavigator />
      </SafeAreaProvider>
    </ShareIntentProvider>
  )
}
