import React from "react"
import { StatusBar } from "expo-status-bar"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { RootNavigator } from "./src/navigation/RootNavigator"
import { useTheme } from "./src/ui/theme"

function ThemedStatusBar() {
  const theme = useTheme()
  return <StatusBar style={theme.dark ? "light" : "dark"} />
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemedStatusBar />
      <RootNavigator />
    </SafeAreaProvider>
  )
}
