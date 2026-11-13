/** Splits chat text into blocks (pure, so it unit-tests without React Native). */

export type Block =
  | { t: "p"; text: string }
  | { t: "h"; text: string }
  | { t: "li"; text: string; mark: string }
  | { t: "code"; text: string }
  | { t: "quote"; text: string }
  | { t: "img"; alt: string; url: string }
  | { t: "file"; name: string; url: string }

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
    const img = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/)
    if (img) {
      flush()
      blocks.push({ t: "img", alt: img[1]!, url: img[2]! })
      continue
    }
    const file = line.trim().match(/^\[📎\s*([^\]]+)\]\(([^)\s]+)\)$/u)
    if (file) {
      flush()
      blocks.push({ t: "file", name: file[1]!, url: file[2]! })
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

