import React, { useEffect, useRef } from "react"
import { Animated, Easing, View } from "react-native"
import Svg, { Path, Rect } from "react-native-svg"
import {
  SAYA_BADGE,
  SAYA_EYE_STROKE,
  SAYA_INK,
  SAYA_SAAYA_OFFSET,
  SAYA_TONES,
  sayaGeometry,
  sayaPick,
} from "@sayabot/core/mascot"
import { useTheme } from "./theme"

/**
 * Each agent's face: a Saya from the shared family (same geometry as web), seeded from its
 * handle so it never changes. An accent ring pulses while it works; the approval badge shows
 * it's waiting on you.
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
  const { shape, tone } = sayaPick(seed || "agent")
  const palette = SAYA_TONES[tone]
  const g = sayaGeometry(shape, waiting ? "waiting" : working ? "working" : "idle")
  const pulse = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!working) return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
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
            transform: [
              { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] }) },
            ],
          }}
        />
      ) : null}
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Path d={g.shell} fill={palette.shade} translateY={SAYA_SAAYA_OFFSET} />
        <Path d={g.shell} fill={palette.base} />
        {g.detail ? <Path d={g.detail} fill={palette.shade} /> : null}
        <Rect
          x={g.visor.x}
          y={g.visor.y}
          width={g.visor.w}
          height={g.visor.h}
          rx={g.visor.r}
          fill={SAYA_INK}
        />
        {g.eyesFill ? <Path d={g.eyesFill} fill={palette.eye} /> : null}
        {g.eyesLine ? (
          <Path
            d={g.eyesLine}
            fill="none"
            stroke={palette.eye}
            strokeWidth={SAYA_EYE_STROKE}
            strokeLinecap="round"
          />
        ) : null}
        {g.badge ? <Path d={g.badge} fill={SAYA_BADGE} /> : null}
        {g.bang ? <Path d={g.bang} fill={SAYA_INK} /> : null}
      </Svg>
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
      <Animated.Text style={{ color: theme.text, fontWeight: "600", fontSize: size * 0.38 }}>
        {initials || "?"}
      </Animated.Text>
    </View>
  )
}
