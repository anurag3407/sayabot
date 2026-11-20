import React, { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Linking, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { CameraView, useCameraPermissions } from "expo-camera"
import { SafeAreaView } from "react-native-safe-area-context"
import { X } from "lucide-react-native"
import { codeFromScan, extractServerFromScan, type PairLink } from "../core/pair-link"
import { colors } from "../theme"

interface PairScannerProps {
  visible: boolean
  busy: boolean
  error: string | null
  mode?: "pair" | "server"
  onClose: () => void
  onScan: (link: PairLink) => void
  onScanServer?: (serverUrl: string) => void
  onTypeInstead?: () => void
}

/** Full-screen camera for the QR shown under Settings → Phones → Add phone. */
export function PairScanner({
  visible,
  busy,
  error,
  mode = "pair",
  onClose,
  onScan,
  onScanServer,
  onTypeInstead,
}: PairScannerProps) {
  const [permission, requestPermission] = useCameraPermissions()
  const locked = useRef(false)
  const asked = useRef(false)
  const [mountError, setMountError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) {
      locked.current = false
      asked.current = false
      setMountError(null)
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
        {mountError ? (
          <View style={styles.denied}>
            <Text style={styles.deniedTitle}>Camera could not start</Text>
            <Text style={styles.deniedBody}>{mountError}</Text>
            <TouchableOpacity
              style={styles.allowBtn}
              onPress={() => {
                setMountError(null)
                void requestPermission()
              }}
            >
              <Text style={styles.allowText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.allowBtn, { marginTop: 4, backgroundColor: "transparent" }]}
              onPress={() => void Linking.openSettings()}
            >
              <Text style={[styles.allowText, { color: colors.primary }]}>Open Settings</Text>
            </TouchableOpacity>
          </View>
        ) : !permission ? (
          <View style={styles.denied}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : granted ? (
          <CameraView
            style={[StyleSheet.absoluteFill, styles.camera]}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onMountError={(e) => setMountError(e.message ?? "Camera could not be started")}
            onBarcodeScanned={
              busy
                ? undefined
                : (event) => {
                    if (locked.current) return
                    if (mode === "server") {
                      const server = extractServerFromScan(event.data)
                      if (!server) return
                      locked.current = true
                      if (onScanServer) {
                        onScanServer(server)
                      } else {
                        onScan({ code: "", server })
                      }
                      return
                    }

                    const link = codeFromScan(event.data)
                    if (link) {
                      locked.current = true
                      onScan(link)
                      return
                    }

                    const server = extractServerFromScan(event.data)
                    if (server && onScanServer) {
                      locked.current = true
                      onScanServer(server)
                    }
                  }
            }
          />
        ) : (
          <View style={styles.denied}>
            <Text style={styles.deniedTitle}>The camera is needed to scan the QR</Text>
            <Text style={styles.deniedBody}>
              {mode === "server"
                ? "Allow camera access to scan the server QR code on your computer."
                : "Allow camera access, or type the 8-character code shown under the QR on your computer."}
            </Text>
            {permission && !permission.canAskAgain ? (
              <TouchableOpacity style={styles.allowBtn} onPress={() => void Linking.openSettings()}>
                <Text style={styles.allowText}>Open Settings</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.allowBtn} onPress={() => void requestPermission()}>
                <Text style={styles.allowText}>Allow camera</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {granted ? (
          <View pointerEvents="none" style={styles.frameWrap}>
            <View style={styles.frame} />
            <Text style={styles.hint}>
              {mode === "server"
                ? "Point at the QR to detect server address"
                : "Point at the QR on your computer"}
            </Text>
          </View>
        ) : null}

        <SafeAreaView style={styles.chrome} edges={["top", "bottom"]} pointerEvents="box-none">
          <View style={styles.topBar}>
            <Text style={styles.title}>
              {mode === "server" ? "Scan to detect server" : "Scan to connect"}
            </Text>
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
            {onTypeInstead && mode !== "server" ? (
              <TouchableOpacity
                onPress={onTypeInstead}
                accessibilityLabel="Type the code instead"
                style={styles.typeBtn}
              >
                <Text style={styles.typeText}>Type the code instead</Text>
              </TouchableOpacity>
            ) : null}
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
  camera: {
    flex: 1,
    width: "100%",
    height: "100%",
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
