import React, { useMemo, useState } from "react"
import { Image, Linking, Modal, Platform, Pressable, ScrollView, Text as RNText, View, type TextStyle } from "react-native"
import { FileText, X } from "lucide-react-native"
import { accessTokenNow, isSayabotFile, signedInWebUrl } from "../core/api"
import { parseBlocks } from "../core/markdown"
import { useTheme } from "./theme"

/**
 * Light Markdown for chat: paragraphs, bullet/numbered lists, headings, ```code blocks```,
 * `inline code`, **bold**, _italic_, links and @mentions. Plain RN Text keeps long replies fast.
 */

const INLINE = /(\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*|`[^`]+`|_[^_\s][^_]*_|https?:\/\/[^\s)]+|@[a-z0-9][a-z0-9-]*)/gi

/** Our protected file links open signed in; other links open as they are. */
async function openLink(url: string) {
  if (isSayabotFile(url)) {
    const path = url.slice(url.indexOf("/api/files/"))
    return void Linking.openURL(await signedInWebUrl(path))
  }
  return void Linking.openURL(url)
}

function imageSource(url: string) {
  const token = accessTokenNow()
  return isSayabotFile(url) && token ? { uri: url, headers: { Authorization: `Bearer ${token}` } } : { uri: url }
}

function ChatImage({ url, alt }: { url: string; alt: string }) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const [ratio, setRatio] = useState(4 / 3)
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="imagebutton" accessibilityLabel={alt || "Image"}>
        <Image
          source={imageSource(url)}
          onLoad={(e) => {
            const { width, height } = e.nativeEvent.source
            if (width && height) setRatio(Math.max(0.5, Math.min(2, width / height)))
          }}
          style={{ width: 240, aspectRatio: ratio, borderRadius: 14, backgroundColor: theme.raised }}
          resizeMode="cover"
        />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center" }}>
          <Image source={imageSource(url)} style={{ width: "100%", height: "80%" }} resizeMode="contain" />
          <Pressable onPress={() => setOpen(false)} accessibilityLabel="Close" style={{ position: "absolute", top: 54, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}>
            <X size={22} color="#fff" />
          </Pressable>
        </View>
      </Modal>
    </>
  )
}

function Inline({ text, color, accent, codeBg, base }: { text: string; color: string; accent: string; codeBg: string; base: TextStyle }) {
  const parts = text.split(INLINE).filter((p) => p !== "")
  return (
    <RNText style={[base, { color }]}>
      {parts.map((part, i) => {
        const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
        if (link)
          return (
            <RNText key={i} style={{ color: accent, textDecorationLine: "underline" }} onPress={() => void openLink(link[2]!)}>
              {link[1]}
            </RNText>
          )
        if (part.startsWith("**") && part.endsWith("**")) return <RNText key={i} style={{ fontWeight: "700" }}>{part.slice(2, -2)}</RNText>
        if (part.startsWith("`") && part.endsWith("`"))
          return (
            <RNText key={i} style={{ fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: base.fontSize ? base.fontSize - 1.5 : 14, backgroundColor: codeBg }}>
              {` ${part.slice(1, -1)} `}
            </RNText>
          )
        if (part.startsWith("_") && part.endsWith("_") && part.length > 2) return <RNText key={i} style={{ fontStyle: "italic" }}>{part.slice(1, -1)}</RNText>
        if (/^https?:\/\//.test(part))
          return (
            <RNText key={i} style={{ color: accent, textDecorationLine: "underline" }} onPress={() => void openLink(part)}>
              {part}
            </RNText>
          )
        if (part.startsWith("@")) return <RNText key={i} style={{ color: accent, fontWeight: "600" }}>{part}</RNText>
        return part
      })}
    </RNText>
  )
}

export function RichText({ text, color, mine }: { text: string; color?: string; mine?: boolean }) {
  const theme = useTheme()
  const blocks = useMemo(() => parseBlocks(text), [text])
  const fg = color ?? theme.text
  const accent = mine ? fg : theme.accent
  const codeBg = mine ? "rgba(0,0,0,0.12)" : theme.raised
  const base: TextStyle = { fontSize: 16, lineHeight: 22 }
  return (
    <View style={{ gap: 6 }}>
      {blocks.map((b, i) => {
        if (b.t === "img") return <ChatImage key={i} url={b.url} alt={b.alt} />
        if (b.t === "file")
          return (
            <Pressable
              key={i}
              onPress={() => void openLink(b.url)}
              accessibilityRole="link"
              style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12, backgroundColor: mine ? "rgba(0,0,0,0.12)" : theme.raised }}
            >
              <FileText size={18} color={fg} />
              <RNText numberOfLines={1} style={{ color: fg, fontSize: 15, flexShrink: 1 }}>
                {b.name}
              </RNText>
            </Pressable>
          )
        if (b.t === "code")
          return (
            <ScrollView key={i} horizontal showsHorizontalScrollIndicator={false} style={{ backgroundColor: mine ? "rgba(0,0,0,0.14)" : theme.bg, borderRadius: 10 }}>
              <RNText selectable style={{ color: fg, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 13, lineHeight: 19, padding: 10 }}>
                {b.text}
              </RNText>
            </ScrollView>
          )
        if (b.t === "li")
          return (
            <View key={i} style={{ flexDirection: "row", gap: 8, paddingRight: 4 }}>
              <RNText style={[base, { color: fg, minWidth: 14 }]}>{b.mark}</RNText>
              <View style={{ flex: 1 }}>
                <Inline text={b.text} color={fg} accent={accent} codeBg={codeBg} base={base} />
              </View>
            </View>
          )
        if (b.t === "h") return <Inline key={i} text={b.text} color={fg} accent={accent} codeBg={codeBg} base={{ ...base, fontWeight: "700", fontSize: 17 }} />
        if (b.t === "quote")
          return (
            <View key={i} style={{ borderLeftWidth: 3, borderLeftColor: mine ? "rgba(0,0,0,0.25)" : theme.lineStrong, paddingLeft: 10 }}>
              <Inline text={b.text} color={mine ? fg : theme.muted} accent={accent} codeBg={codeBg} base={base} />
            </View>
          )
        return <Inline key={i} text={b.text} color={fg} accent={accent} codeBg={codeBg} base={base} />
      })}
    </View>
  )
}
