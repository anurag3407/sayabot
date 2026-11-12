import React, { useEffect, useRef, type ReactNode } from "react"
import { Animated, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Text } from "./Text"
import { radius, space, useTheme } from "./theme"

/**
 * Bottom sheet: grabber, title, drag down (or tap outside) to close. Content scrolls inside a
 * stable height so the sheet never jumps as content changes.
 */
export function Sheet({
  visible,
  onClose,
  title,
  height = 0.6,
  children,
  right,
}: {
  visible: boolean
  onClose: () => void
  title?: string
  height?: number
  children: ReactNode
  right?: ReactNode
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const drag = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) drag.setValue(0)
  }, [visible, drag])

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 110 || g.vy > 1.2) onClose()
        else Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start()
      },
    }),
  ).current

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: theme.overlay }} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Animated.View
            style={{
              height: `${Math.round(height * 100)}%` as `${number}%`,
              minHeight: 280,
              backgroundColor: theme.surface,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingBottom: insets.bottom,
              transform: [{ translateY: drag }],
            }}
          >
            <View {...pan.panHandlers} style={{ paddingTop: 8, paddingBottom: 6, paddingHorizontal: space.lg }}>
              <View style={{ alignSelf: "center", width: 38, height: 5, borderRadius: 3, backgroundColor: theme.lineStrong }} />
              {title ? (
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 12 }}>
                  <Text variant="headline" style={{ flex: 1 }}>
                    {title}
                  </Text>
                  {right}
                </View>
              ) : null}
            </View>
            <ScrollView
              contentContainerStyle={{ padding: space.lg, paddingTop: 8 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            >
              {children}
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}
