import React, { useMemo } from "react"
import { Linking, Platform, ScrollView, Text as RNText, View, type TextStyle } from "react-native"
import { useTheme } from "./theme"

/**
 * Light Markdown for chat: paragraphs, bullet/numbered lists, headings, ```code blocks```,
 * `inline code`, **bold**, _italic_, links and @mentions. Plain RN Text keeps long replies fast.
 */

type Block =
  | { t: "p"; text: string }
  | { t: "h"; text: string }
  | { t: "li"; text: string; mark: string }
  | { t: "code"; text: string }
  | { t: "quote"; text: string }

export function parseBlocks(input: string): Block[] {
  const blocks: Block[] = []
  const lines = input.replace(/\r\n/g, "\n").split("\n")
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ t: "p", text: para.join("\n") })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim().startsWith("```")) {
      flush()
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) code.push(lines[i++]!)
      blocks.push({ t: "code", text: code.join("\n") })
      continue
    }
    const li = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/)
    if (li) {
      flush()
      blocks.push({ t: "li", mark: /\d/.test(li[1]!) ? li[1]! : "•", text: li[2]! })
      continue
    }
    const h = line.match(/^#{1,4}\s+(.*)$/)
    if (h) {
      flush()
      blocks.push({ t: "h", text: h[1]! })
      continue
    }
    if (line.startsWith("> ")) {
      flush()
      blocks.push({ t: "quote", text: line.slice(2) })
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    para.push(line)
  }
  flush()
  return blocks
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|_[^_\s][^_]*_|https?:\/\/[^\s)]+|@[a-z0-9][a-z0-9-]*)/gi

function Inline({ text, color, accent, codeBg, base }: { text: string; color: string; accent: string; codeBg: string; base: TextStyle }) {
  const parts = text.split(INLINE).filter((p) => p !== "")
  return (
    <RNText style={[base, { color }]}>
      {parts.map((part, i) => {
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
            <RNText key={i} style={{ color: accent, textDecorationLine: "underline" }} onPress={() => void Linking.openURL(part)}>
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
