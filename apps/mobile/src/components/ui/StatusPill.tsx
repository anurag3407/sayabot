import React from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"
import { colors } from "../../theme"

interface StatusPillProps {
  label: string
  active?: boolean
  color?: string
}

export function StatusPill({ label, active = true, color = colors.primaryBright }: StatusPillProps) {
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      {active && <ActivityIndicator size="small" color={color} style={styles.spinner} />}
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  spinner: {
    marginRight: 6,
    transform: [{ scale: 0.7 }],
  },
  text: {
    fontSize: 12,
    fontWeight: "600",
  },
})
