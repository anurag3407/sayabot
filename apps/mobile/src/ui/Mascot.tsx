import React, { useEffect, useRef } from "react"
import { Animated, Easing, type StyleProp, View, type ViewStyle } from "react-native"
import Svg, {
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg"
import {
  SAYA_BADGE,
  SAYA_EYE_STROKE,
  SAYA_INK,
  SAYA_SAAYA_OFFSET,
  SAYA_SHAPE_INFO,
  SAYA_TONES,
  SAYA_ZZ_STROKE,
  resolveMascotLook,
  sayaGeometry,
  type SayaMood,
  type SayaShape,
  type SayaTone,
} from "@sayabot/core/mascot"
import { useTheme } from "./theme"

export type MascotMood = "idle" | "happy" | "sleep" | "busy" | "alert" | "thinking" | SayaMood

const MOOD_MAP: Record<string, SayaMood> = {
  idle: "idle",
  happy: "done",
  sleep: "sleeping",
  sleeping: "sleeping",
  busy: "working",
  working: "working",
  alert: "waiting",
  waiting: "waiting",
  thinking: "thinking",
  done: "done",
}

function sparkle(x: number, y: number, size: number) {
  return `M${x} ${y - size}Q${x} ${y} ${x + size} ${y}Q${x} ${y} ${x} ${y + size}Q${x} ${y} ${x - size} ${y}Q${x} ${y} ${x} ${y - size}Z`
}

export interface MascotProps {
  /** The agent's name or handle for deterministic look resolution */
  seed?: string
  /** Bounding square size in pixels (default 44) */
  size?: number
  /** Override the geometry shape */
  shape?: SayaShape
  /** Override the palette tone */
  tone?: SayaTone
  /** Custom base color */
  color?: string
  /** Explicit mood: idle, working, waiting, thinking, sleeping, done */
  mood?: MascotMood
  /** Working holds the turn: animated glow aura and dash eyes */
  working?: boolean
  /** Waiting on human approval: alert eyes + badge */
  waiting?: boolean
  /** Halo glowing behind: holding the turn */
  lit?: boolean
  /** Soft ambient floor shadow pool underneath */
  shadow?: boolean
  /** Live floating bob animation (default: true when working or lit) */
  live?: boolean
  /** The rare prism Saya with sparkles */
  rare?: boolean
  /** Container style overrides */
  style?: StyleProp<ViewStyle>
}

let mascotCounter = 0

/**
 * Sayabot mascot: authentic soft, visor-faced bot matching the desktop & web design 1:1.
 * Features canonical cast identity resolution, soft glowing radial turn halo,
 * subtle floating bob animation, saaya depth layer, and full mood geometry (thinking dots,
 * approval exclamation badge, sleeping ZZ).
 */
export function Mascot({
  seed = "agent",
  size = 44,
  shape,
  tone,
  color,
  mood = "idle",
  working = false,
  waiting = false,
  lit = false,
  shadow = false,
  live,
  rare,
  style,
}: MascotProps) {
  const instanceId = useRef(`sm_${++mascotCounter}`).current

  const resolved = resolveMascotLook(seed)
  const bodyShape = shape ?? resolved.shape
  const chosenTone =
    tone ?? (resolved.cast ? resolved.tone : shape ? SAYA_SHAPE_INFO[shape].tone : resolved.tone)
  const palette = SAYA_TONES[chosenTone] ?? SAYA_TONES.lilac

  const base = color ?? palette.base
  const shade = palette.shade
  const eye = palette.eye
  const isRare = rare ?? Boolean(resolved.rare)

  const effectiveMood: SayaMood = waiting
    ? "waiting"
    : working
      ? "working"
      : (MOOD_MAP[mood] ?? "idle")
  const isLit = lit || working
  const isLive = live ?? (working || isLit)

  const g = sayaGeometry(bodyShape, effectiveMood)

  const bobAnim = useRef(new Animated.Value(0)).current
  const pulseAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!isLive) {
      bobAnim.setValue(0)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bobAnim, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bobAnim, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [isLive, bobAnim])

  useEffect(() => {
    if (!isLit) {
      pulseAnim.setValue(0)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [isLit, pulseAnim])

  const bobY = isLive
    ? bobAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, -3],
      })
    : 0

  const haloId = `${instanceId}_h`
  const shadowId = `${instanceId}_s`
  const prismId = `${instanceId}_p`

  const haloColor = isRare ? "#c4b5fd" : base
  const containerSize = size + (isLit ? 10 : 4)

  return (
    <View
      style={[
        {
          width: containerSize,
          height: containerSize,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      {/* Soft atmospheric ambient glow when holding the turn or working */}
      {isLit ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            width: size + 12,
            height: size + 12,
            borderRadius: (size + 12) / 2,
            backgroundColor: base,
            opacity: pulseAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.12, 0.28],
            }),
            transform: [
              {
                scale: pulseAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.94, 1.08],
                }),
              },
            ],
          }}
        />
      ) : null}

      {/* Subtle turn pulse ring */}
      {working ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            width: size + 8,
            height: size + 8,
            borderRadius: (size + 8) / 2,
            borderWidth: 1.5,
            borderColor: base,
            opacity: pulseAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.35, 0.85],
            }),
            transform: [
              {
                scale: pulseAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.98, 1.05],
                }),
              },
            ],
          }}
        />
      ) : null}

      {/* Floating Mascot Body */}
      <Animated.View
        style={{
          width: size,
          height: size,
          transform: [{ translateY: bobY }],
        }}
      >
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id={haloId} cx="50%" cy="50%" rx="50%" ry="50%" fx="50%" fy="50%">
              <Stop offset="0%" stopColor={haloColor} stopOpacity="0.75" />
              <Stop offset="100%" stopColor={haloColor} stopOpacity="0" />
            </RadialGradient>
            <RadialGradient id={shadowId} cx="50%" cy="50%" rx="50%" ry="50%" fx="50%" fy="50%">
              <Stop offset="0%" stopColor={haloColor} stopOpacity="0.45" />
              <Stop offset="100%" stopColor={haloColor} stopOpacity="0" />
            </RadialGradient>
            {isRare ? (
              <LinearGradient id={prismId} x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#fbcfe8" />
                <Stop offset="35%" stopColor="#c4b5fd" />
                <Stop offset="65%" stopColor="#93c5fd" />
                <Stop offset="100%" stopColor="#86efac" />
              </LinearGradient>
            ) : null}
          </Defs>

          {/* Soft shadow pool underneath feet */}
          {shadow ? <Ellipse cx="50" cy="94" rx="36" ry="6" fill={`url(#${shadowId})`} /> : null}

          {/* Soft radial turn halo */}
          {isLit ? <Ellipse cx="50" cy="52" rx="46" ry="44" fill={`url(#${haloId})`} /> : null}

          {/* Saaya depth shadow layer */}
          <Path d={g.shell} fill={isRare ? "#7c6fd6" : shade} translateY={SAYA_SAAYA_OFFSET} />

          {/* Base body shell */}
          <Path d={g.shell} fill={isRare ? `url(#${prismId})` : base} />

          {/* Shell detail accent (e.g. Ledger folded edge) */}
          {g.detail ? <Path d={g.detail} fill={isRare ? "#7c6fd6" : shade} /> : null}

          {/* Visor */}
          <Rect
            x={g.visor.x}
            y={g.visor.y}
            width={g.visor.w}
            height={g.visor.h}
            rx={g.visor.r}
            fill={SAYA_INK}
          />

          {/* Eyes: filled or stroke marks */}
          {g.eyesFill ? <Path d={g.eyesFill} fill={eye} /> : null}
          {g.eyesLine ? (
            <Path
              d={g.eyesLine}
              fill="none"
              stroke={eye}
              strokeWidth={SAYA_EYE_STROKE}
              strokeLinecap="round"
            />
          ) : null}

          {/* Extra mood elements */}
          {g.dots ? <Path d={g.dots} fill={base} /> : null}
          {g.badge ? <Path d={g.badge} fill={SAYA_BADGE} /> : null}
          {g.bang ? <Path d={g.bang} fill={SAYA_INK} /> : null}
          {g.zz ? (
            <Path
              d={g.zz}
              fill="none"
              stroke={base}
              strokeWidth={SAYA_ZZ_STROKE}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}

          {/* Rare prism sparkles */}
          {isRare ? (
            <G fill="#fff">
              <Path d={sparkle(8, 34, 5)} />
              <Path d={sparkle(93, 40, 4)} fill="#fde68a" />
              <Path d={sparkle(96, 78, 3.4)} />
              <Path d={sparkle(4, 80, 3.6)} fill="#c4b5fd" />
            </G>
          ) : null}
        </Svg>
      </Animated.View>
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
        borderWidth: 1,
        borderColor: theme.line,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.Text style={{ color: theme.text, fontWeight: "600", fontSize: size * 0.38 }}>
        {initials || "?"}
      </Animated.Text>
    </View>
  )
}
