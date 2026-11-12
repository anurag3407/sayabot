import React from "react"
import { Platform, StyleSheet } from "react-native"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { BlurView } from "expo-blur"
import { Bell, CheckSquare, Ellipsis, MessageCircle } from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { HomeScreen } from "../screens/HomeScreen"
import { InboxScreen } from "../screens/InboxScreen"
import { TasksScreen } from "../screens/TasksScreen"
import { MoreScreen } from "../screens/MoreScreen"
import { useInbox } from "../hooks/useInbox"
import { useSettings } from "../hooks/useSettings"
import { haptic } from "../ui/haptics"
import { useTheme } from "../ui/theme"

const Tab = createBottomTabNavigator()

/** Four places: chats, what needs you, work in progress, and everything else. */
export function TabNavigator() {
  const insets = useSafeAreaInsets()
  const theme = useTheme()
  const { settings } = useSettings()
  const { questions, approvals } = useInbox(settings.orgSlug)
  const waiting = questions.length + approvals

  return (
    <Tab.Navigator
      screenListeners={{ tabPress: () => haptic.select() }}
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: Platform.OS === "ios" ? "absolute" : "relative",
          backgroundColor: Platform.OS === "ios" ? "transparent" : theme.surface,
          borderTopColor: theme.line,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 56 + insets.bottom,
          paddingBottom: Math.max(6, insets.bottom),
          paddingTop: 6,
          elevation: 0,
        },
        tabBarBackground: () =>
          Platform.OS === "ios" ? <BlurView tint={theme.dark ? "dark" : "light"} intensity={80} style={StyleSheet.absoluteFill} /> : null,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.faint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        sceneStyle: { backgroundColor: theme.bg },
      }}
    >
      <Tab.Screen name="HomeTab" component={HomeScreen} options={{ tabBarLabel: "Chats", tabBarIcon: ({ color, size }) => <MessageCircle size={size} color={color} /> }} />
      <Tab.Screen
        name="InboxTab"
        component={InboxScreen}
        options={{
          tabBarLabel: "Inbox",
          tabBarIcon: ({ color, size }) => <Bell size={size} color={color} />,
          tabBarBadge: waiting ? waiting : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.accent, color: theme.onAccent, fontSize: 11 },
        }}
      />
      <Tab.Screen name="TasksTab" component={TasksScreen} options={{ tabBarLabel: "Tasks", tabBarIcon: ({ color, size }) => <CheckSquare size={size} color={color} /> }} />
      <Tab.Screen name="MoreTab" component={MoreScreen} options={{ tabBarLabel: "More", tabBarIcon: ({ color, size }) => <Ellipsis size={size} color={color} /> }} />
    </Tab.Navigator>
  )
}
