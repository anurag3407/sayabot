import React, { useEffect, useRef } from "react"
import { Animated, Easing, View } from "react-native"
import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg"
import { hashString, IDENTITY, useTheme } from "./theme"

/**
 * Each agent's face: a soft shape in its own colour with two eyes, seeded from its handle so
 * it never changes. A coral ring pulses while it works; a dot shows it's waiting on you.
 */
export function Mascot({
  seed,
  size = 44,
  working = false,
  waiting = false,
}: {
  seed: string
  size?: number
  working?: boolean
  waiting?: boolean
}) {
  const theme = useTheme()
  const h = hashString(seed || "agent")
  const color = IDENTITY[h % IDENTITY.length]!
  const shape = (h >> 3) % 4
  const eyeGap = 9 + ((h >> 5) % 4)
  const pulse = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!working) return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [working, pulse])

  const ring = size + 8
  return (
    <View style={{ width: ring, height: ring, alignItems: "center", justifyContent: "center" }}>
      {working ? (
        <Animated.View
          style={{
            position: "absolute",
            width: ring,
            height: ring,
            borderRadius: ring / 2,
            borderWidth: 2,
            borderColor: theme.accent,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] }) }],
          }}
        />
      ) : null}
      <Svg width={size} height={size} viewBox="0 0 48 48">
        {shape === 0 ? <Rect x="4" y="5" width="40" height="38" rx="15" fill={color} /> : null}
        {shape === 1 ? <Circle cx="24" cy="25" r="20" fill={color} /> : null}
        {shape === 2 ? <Path d="M24 4 L44 18 L37 43 L11 43 L4 18 Z" fill={color} strokeLinejoin="round" stroke={color} strokeWidth="4" /> : null}
        {shape === 3 ? <Ellipse cx="24" cy="26" rx="21" ry="17" fill={color} /> : null}
        <Ellipse cx={24 - eyeGap / 2} cy="24" rx="2.6" ry="3.6" fill="#1b1b1f" />
        <Ellipse cx={24 + eyeGap / 2} cy="24" rx="2.6" ry="3.6" fill="#1b1b1f" />
        <Circle cx={24 - eyeGap / 2 + 0.9} cy="22.6" r="0.9" fill="#ffffff" />
        <Circle cx={24 + eyeGap / 2 + 0.9} cy="22.6" r="0.9" fill="#ffffff" />
      </Svg>
      {waiting ? (
        <View
          style={{
            position: "absolute",
            right: 2,
            top: 2,
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: theme.warn,
            borderWidth: 2,
            borderColor: theme.bg,
          }}
        />
      ) : null}
    </View>
  )
}

/** A person's initials in a neutral circle. */
export function PersonAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const theme = useTheme()
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.raised,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg width={size} height={size} style={{ position: "absolute" }} />
      <Animated.Text style={{ color: theme.text, fontWeight: "600", fontSize: size * 0.38 }}>{initials || "?"}</Animated.Text>
    </View>
  )
}
