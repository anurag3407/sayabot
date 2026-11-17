/**
 * Model reasoning stays out of the answer until someone opens it.
 *
 * Producers (`appendThinking`) fold a reasoning channel into the same text the room already
 * streams, inside `<think>` … `</think>`. The chat (`splitThinking`) pulls those blocks back
 * out so the reply shows a single line, and the reasoning only after a click.
 */

export interface ThinkingFold {
  /** A `<think>` block is still open in the text built so far. */
  open: boolean
}

export interface SplitThinking {
  /** Reasoning, in order, with blocks separated by a blank line. */
  thinking: string
  /** The reply with every think block removed. */
  answer: string
  /** The last think block has not closed yet. */
  open: boolean
}

const OPEN =
  /<(think|thinking|reasoning|thought|antthinking)\b[^>]*>|<\|\s*think\s*\|>/gi

function closerFor(name: string): RegExp {
  if (name === "pipe") return /<\|\s*\/\s*think\s*\|>/i
  return new RegExp(`</${name}\\s*>`, "i")
}

const CLOSE_NAMES = ["think", "thinking", "reasoning", "thought", "antthinking"]

/** Hide a half-arrived close tag so it doesn't flash at the end of the reasoning. */
function trimPartialClose(text: string): string {
  return text
    .replace(/<\/[a-z]*$/i, (tag) => {
      const name = tag.slice(2).toLowerCase()
      return name === "" || CLOSE_NAMES.some((known) => known.startsWith(name)) ? "" : tag
    })
    .replace(/<\|\s*\/?\s*(?:t|th|thi|thin|think)?$/i, "")
}

/**
 * Hide a half-arrived open tag at the end of the answer (`<thi`) so the reply doesn't
 * flash the marker before the block is recognized.
 */
function stripDanglingOpen(text: string): { text: string; dangling: boolean } {
  const match = text.match(
    /<(?:think|thinking|reasoning|thought|antthinking)\b[^>]*$|<(?:t|th|thi|thin|think|thinki|thinkin|thinking|r|re|rea|reas|reaso|reason|reasoni|reasonin|reasoning|ant|antt|antth|antthi|antthin|antthink|antthinki|antthinkin|antthinking)$|<\|\s*(?:t|th|thi|thin|think)?$/i,
  )
  if (!match || match.index === undefined) return { text, dangling: false }
  return { text: text.slice(0, match.index).replace(/[ \t]+$/, ""), dangling: true }
}

function tidy(text: string): string {
  const collapsed = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
  if (!collapsed.trim()) return ""
  return collapsed.replace(/^\n+/, "").replace(/\n+$/, "")
}

/** Pull reasoning blocks out of a reply, including one that is still streaming. */
export function splitThinking(content: string): SplitThinking {
  const blocks: string[] = []
  let answer = ""
  let cursor = 0
  let open = false
  const re = new RegExp(OPEN.source, "gi")
  let match: RegExpExecArray | null
  while ((match = re.exec(content))) {
    answer += content.slice(cursor, match.index)
    const name = (match[1] ?? "pipe").toLowerCase()
    const start = match.index + match[0].length
    const rest = content.slice(start)
    const end = closerFor(name).exec(rest)
    if (!end) {
      blocks.push(trimPartialClose(rest))
      open = true
      cursor = content.length
      break
    }
    blocks.push(rest.slice(0, end.index))
    cursor = start + end.index + end[0].length
    re.lastIndex = cursor
  }
  if (!open) answer += content.slice(cursor)
  const dangling = stripDanglingOpen(answer)
  if (dangling.dangling) open = true
  return {
    thinking: tidy(
      blocks
        .map((block) => block.trim())
        .filter(Boolean)
        .join("\n\n"),
    ),
    answer: tidy(dangling.text),
    open,
  }
}

/**
 * Append either more reasoning or more answer. Returns only the new characters, so a
 * streaming reply can keep growing without rewriting what was already sent.
 */
export function appendThinking(
  fold: ThinkingFold,
  kind: "thinking" | "answer",
  text: string,
): { fold: ThinkingFold; delta: string } {
  if (!text) return { fold, delta: "" }
  if (kind === "thinking") {
    return { fold: { open: true }, delta: fold.open ? text : `<think>\n${text}` }
  }
  return { fold: { open: false }, delta: fold.open ? `\n</think>\n\n${text}` : text }
}

/** Close a think block that is still open. Empty when the reply is already on the answer. */
export function closeThinking(fold: ThinkingFold): { fold: ThinkingFold; delta: string } {
  if (!fold.open) return { fold, delta: "" }
  return { fold: { open: false }, delta: "\n</think>\n\n" }
}

/** The saved reply: reasoning first, then the answer, both omitted when empty. */
export function formatReply(thinking: string, answer: string): string {
  const thought = thinking.trim()
  const body = answer.trim()
  if (!thought) return body
  if (!body) return `<think>\n${thought}\n</think>`
  return `<think>\n${thought}\n</think>\n\n${body}`
}
