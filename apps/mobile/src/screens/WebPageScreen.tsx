import React, { useEffect, useRef, useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { WebView } from "react-native-webview"
import { ChevronLeft, RotateCw } from "lucide-react-native"
import { signedInWebUrl } from "../core/api"
import { IconButton } from "../ui/controls"
import { Text } from "../ui/Text"
import { useTheme } from "../ui/theme"

/**
 * A Sayabot web page inside the app, already signed in: remote desktop, Marketplace, Routines.
 * The session is handed over once in the URL fragment (never sent to the server in a query).
 */
export function WebPageScreen({ route, navigation }: any) {
  const { path = "/", title = "Sayabot" } = route?.params ?? {}
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const ref = useRef<WebView>(null)

  useEffect(() => {
    void signedInWebUrl(path).then(setUrl)
  }, [path])

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top, backgroundColor: theme.surface, borderBottomWidth: 0.5, borderBottomColor: theme.line }}>
        <View style={{ height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 6, gap: 6 }}>
          <IconButton label="Back" tint="transparent" icon={<ChevronLeft size={26} color={theme.text} />} onPress={() => navigation.goBack()} />
          <Text variant="headline" numberOfLines={1} style={{ flex: 1 }}>
            {title}
          </Text>
          <IconButton label="Reload" tint="transparent" icon={<RotateCw size={18} color={theme.text} />} onPress={() => ref.current?.reload()} />
        </View>
      </View>
      {url ? (
        <WebView
          ref={ref}
          source={{ uri: url }}
          onLoadEnd={() => setLoading(false)}
          style={{ flex: 1, backgroundColor: theme.bg }}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
          allowsBackForwardNavigationGestures
          setSupportMultipleWindows={false}
          pullToRefreshEnabled
          originWhitelist={["https://*", "http://*"]}
        />
      ) : null}
      {loading ? (
        <View style={{ position: "absolute", top: insets.top + 52, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }} pointerEvents="none">
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : null}
    </View>
  )
}
