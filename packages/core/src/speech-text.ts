// Converts Markdown syntax into natural, human-friendly spoken text
// and segments text into low-latency speech utterances.

const ENDS_SENTENCE = /[.!?:;]\s*$/

function describeCodeBlock(fence: string): string {
  const lang = fence.trim().split(/\s+/)[0]?.replace(/[^a-z0-9+#]/gi, "") ?? ""
  const spoken: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    py: "Python",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    json: "JSON",
    yml: "YAML",
    yaml: "YAML",
    sql: "SQL",
    rs: "Rust",
    go: "Go",
    swift: "Swift",
    diff: "diff",
    html: "HTML",
    css: "CSS",
  }
  const name = spoken[lang.toLowerCase()]
  return name ? `. (a ${name} code block) ` : ". (a code block) "
}

function stripEmphasis(text: string): string {
  // Strip bold and italics: **text**, *text*, __text__, _text_
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1")
}

function shortenPaths(text: string): string {
  // Replace long paths like 'src/lib/tts/index.ts' with 'index.ts'
  return text.replace(/(?:[\w.@-]+\/){1,}([\w.-]+\.\w{1,6})\b/g, "$1")
}

/**
 * Normalizes raw markdown text into smooth, speakable prose:
 * - Replaces code blocks with short spoken descriptors
 * - Strips syntax markers (*, _, ~, #)
 * - Converts markdown tables into comma-separated phrases
 * - Shortens deep file paths to their base names
 * - Replaces raw URLs with "a link"
 * - Strips emojis so speech synthesizers don't speak Unicode names
 */
export function speakable(input: string): string {
  if (!input) return ""
  let text = input

  // Fenced code blocks first
  text = text.replace(/```([^\n]*)\n[\s\S]*?(?:```|$)/g, (_m, fence: string) => describeCodeBlock(fence))
  text = text.replace(/~~~([^\n]*)\n[\s\S]*?(?:~~~|$)/g, (_m, fence: string) => describeCodeBlock(fence))

  text = stripEmphasis(text)

  // Images before links
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => {
    const description = alt.trim()
    return description ? `. (image: ${description}) ` : ". (an image) "
  })

  // Links: keep anchor text, replace raw URLs with "a link"
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  text = text.replace(/<https?:\/\/[^>\s]+>/g, " a link ")
  text = text.replace(/\bhttps?:\/\/\S+/g, " a link ")

  // Tables: remove separator rows, turn data rows into comma-separated spoken text
  text = text.replace(/^\s*\|?[\s:-]*\|[\s|:-]*$/gm, "")
  text = text.replace(/^\s*\|(.+)\|\s*$/gm, (_m, row: string) =>
    row
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(", "),
  )

  // Inline code: short snippets (<= 40 chars) stay; long snippets become "that snippet"
  text = text.replace(/`([^`\n]+)`/g, (_m, code: string) => (code.length <= 40 ? code : " that snippet "))

  // Headings
  text = text.replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, (_m, head: string) =>
    ENDS_SENTENCE.test(head) ? head : `${head.trim()}.`,
  )

  // Lists, blockquotes, horizontal rules
  text = text.replace(/^\s*[-*+]\s+/gm, "")
  text = text.replace(/^\s*\d+[.)]\s+/gm, "")
  text = text.replace(/^\s*>\s?/gm, "")
  text = text.replace(/^\s*(?:[-*_]\s*){3,}$/gm, "")

  // Strikethrough
  text = text.replace(/~~(.*?)~~/g, "$1")

  // Checkboxes
  text = text.replace(/\[[ xX]\]\s*/g, "")

  text = shortenPaths(text)

  // Emojis: strip unicode emoji ranges so speech synthesizers don't awkwardly read them
  text = text.replace(
    // eslint-disable-next-line no-misleading-character-class
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu,
    "",
  )

  // Clean whitespace and punctuation
  text = text.replace(/\n{2,}/g, ". ")
  text = text.replace(/\n/g, ". ")
  text = text.replace(/\s+/g, " ")
  text = text.replace(/\s+([.,!?;:])/g, "$1")
  text = text.replace(/(?:\.\s*){2,}/g, ". ")
  text = text.replace(/,\s*\./g, ".")
  text = text.trim()

  return /[\p{L}\p{N}]/u.test(text) ? text : ""
}

/**
 * The first spoken block bounds time-to-first-audio (TTFB), so the voice path caps it
 * tighter (<= 90 chars) than subsequent utterances (up to ~320 chars).
 */
export const VOICE_FIRST_BLOCK_MAX_CHARS = 90

const BOUNDARY = /(?<!\b(?:e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|No|approx))(?<![.\d])([.!?])(["')\]]*)\s+/g

export interface UtteranceOptions {
  minChars?: number
  maxChars?: number
  firstBlockMaxChars?: number
}

/**
 * Segments speakable text into discrete sentence chunks for streaming TTS playback.
 * The first block is constrained to firstBlockMaxChars (default 90) to ensure
 * instantaneous playback while subsequent blocks prefetch in the background.
 */
export function toUtterances(input: string, options: UtteranceOptions = {}): string[] {
  const text = speakable(input)
  if (!text) return []

  const { minChars = 12, maxChars = 320, firstBlockMaxChars = VOICE_FIRST_BLOCK_MAX_CHARS } = options

  const MARK = "\u0000"
  const sentences = text
    .replace(BOUNDARY, `$1$2${MARK}`)
    .split(MARK)
    .map((s) => s.trim())
    .filter(Boolean)

  if (sentences.length === 0) return []

  const result: string[] = []
  let buffer = ""
  let isFirst = true

  for (const sentence of sentences) {
    const currentMax = isFirst && firstBlockMaxChars ? firstBlockMaxChars : maxChars

    if (!buffer) {
      if (sentence.length > currentMax) {
        // Long sentence needs sub-chunking on commas or word boundaries
        const subChunks = chunkLongSentence(sentence, currentMax)
        for (const sub of subChunks) {
          result.push(sub)
          isFirst = false
        }
      } else {
        buffer = sentence
      }
      continue
    }

    if (buffer.length + 1 + sentence.length <= currentMax) {
      buffer = `${buffer} ${sentence}`
    } else {
      result.push(buffer)
      isFirst = false
      if (sentence.length > maxChars) {
        const subChunks = chunkLongSentence(sentence, maxChars)
        for (const sub of subChunks) {
          result.push(sub)
        }
        buffer = ""
      } else {
        buffer = sentence
      }
    }
  }

  if (buffer) {
    result.push(buffer)
  }

  // Merge any trailing block that is too short with previous block if possible
  if (result.length > 1 && result[result.length - 1]!.length < minChars) {
    const last = result.pop()!
    result[result.length - 1] = `${result[result.length - 1]} ${last}`
  }

  return result
}

function chunkLongSentence(sentence: string, maxChars: number): string[] {
  const chunks: string[] = []
  const parts = sentence.split(/([,;:]\s+)/)
  let current = ""

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (current.length + part.length <= maxChars) {
      current += part
    } else {
      if (current.trim()) chunks.push(current.trim())
      if (part.length > maxChars) {
        // Fallback: split on word spaces
        const words = part.split(/\s+/)
        let wordBuf = ""
        for (const w of words) {
          if (wordBuf.length + 1 + w.length <= maxChars) {
            wordBuf = wordBuf ? `${wordBuf} ${w}` : w
          } else {
            if (wordBuf.trim()) chunks.push(wordBuf.trim())
            wordBuf = w
          }
        }
        current = wordBuf
      } else {
        current = part
      }
    }
  }

  if (current.trim()) chunks.push(current.trim())
  return chunks.length ? chunks : [sentence]
}
