import React, { useEffect, useRef } from "react"
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { CameraView, useCameraPermissions } from "expo-camera"
import { SafeAreaView } from "react-native-safe-area-context"
import { X } from "lucide-react-native"
import { codeFromScan, type PairLink } from "../core/pair-link"
import { colors } from "../theme"

interface PairScannerProps {
  visible: boolean
  busy: boolean
  error: string | null
  onClose: () => void
  onScan: (link: PairLink) => void
  onTypeInstead: () => void
}

/** Full-screen camera for the QR shown under Settings → Phones → Add phone. */
export function PairScanner({
  visible,
  busy,
  error,
  onClose,
  onScan,
  onTypeInstead,
}: PairScannerProps) {
  const [permission, requestPermission] = useCameraPermissions()
  const locked = useRef(false)

  const asked = useRef(false)

  useEffect(() => {
    if (!visible) {
      locked.current = false
      asked.current = false
    }
  }, [visible])

  useEffect(() => {
    if (error) locked.current = false
  }, [error])

  useEffect(() => {
    if (!visible || !permission || permission.granted || !permission.canAskAgain || asked.current)
      return
    asked.current = true
    void requestPermission()
  }, [visible, permission, requestPermission])

  const granted = permission?.granted === true

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {!permission ? (
          <View style={styles.denied}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={
              busy
                ? undefined
                : (event) => {
                    if (locked.current) return
                    const link = codeFromScan(event.data)
                    if (!link) return
                    locked.current = true
                    onScan(link)
                  }
            }
          />
        ) : (
          <View style={styles.denied}>
            <Text style={styles.deniedTitle}>The camera is needed to scan the QR</Text>
            <Text style={styles.deniedBody}>
              Allow camera access, or type the 8-character code shown under the QR on your computer.
            </Text>
            {permission && !permission.canAskAgain ? null : (
              <TouchableOpacity style={styles.allowBtn} onPress={() => void requestPermission()}>
                <Text style={styles.allowText}>Allow camera</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {granted ? (
          <View pointerEvents="none" style={styles.frameWrap}>
            <View style={styles.frame} />
            <Text style={styles.hint}>Point at the QR on your computer</Text>
          </View>
        ) : null}

        <SafeAreaView style={styles.chrome} edges={["top", "bottom"]} pointerEvents="box-none">
          <View style={styles.topBar}>
            <Text style={styles.title}>Scan to connect</Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityLabel="Close scanner"
              style={styles.close}
            >
              <X size={22} color="#fff" />
            </TouchableOpacity>
          </View>
          <View style={styles.bottom}>
            {busy ? <ActivityIndicator color="#fff" /> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <TouchableOpacity
              onPress={onTypeInstead}
              accessibilityLabel="Type the code instead"
              style={styles.typeBtn}
            >
              <Text style={styles.typeText}>Type the code instead</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  denied: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  deniedTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  deniedBody: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  allowBtn: {
    marginTop: 8,
    backgroundColor: colors.primary,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  allowText: {
    color: colors.textInverse,
    fontWeight: "700",
  },
  frameWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  frame: {
    width: 240,
    height: 240,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: "#fff",
  },
  hint: {
    marginTop: 16,
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  chrome: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  title: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  close: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  bottom: {
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  error: {
    color: "#ffd0cc",
    fontSize: 14,
    textAlign: "center",
  },
  typeBtn: {
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  typeText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
})
