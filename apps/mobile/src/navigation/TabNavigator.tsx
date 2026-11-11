import React from "react"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { MessageSquare, CheckSquare, Cpu, Settings } from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { RoomsScreen } from "../screens/RoomsScreen"
import { TasksScreen } from "../screens/TasksScreen"
import { ComputersScreen } from "../screens/ComputersScreen"
import { SettingsScreen } from "../screens/SettingsScreen"
import { usePalette } from "../hooks/usePalette"
import { colors } from "../theme"

const Tab = createBottomTabNavigator()

export function TabNavigator() {
  const insets = useSafeAreaInsets()
  const theme = usePalette()

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: colors.borderSubtle,
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingBottom: Math.max(8, insets.bottom),
          paddingTop: 8,
          elevation: 8,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.25,
          shadowRadius: 3,
        },
        tabBarActiveTintColor: colors.primaryBright,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
          marginTop: 2,
        },
      }}
    >
      <Tab.Screen
        name="RoomsTab"
        component={RoomsScreen}
        options={{
          tabBarLabel: "Chats",
          tabBarIcon: ({ color, size }) => <MessageSquare size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="TasksTab"
        component={TasksScreen}
        options={{
          tabBarLabel: "Tasks",
          tabBarIcon: ({ color, size }) => <CheckSquare size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="ComputersTab"
        component={ComputersScreen}
        options={{
          tabBarLabel: "Computers",
          tabBarIcon: ({ color, size }) => <Cpu size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{
          tabBarLabel: "Settings",
          tabBarIcon: ({ color, size }) => <Settings size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  )
}
