import { z } from "zod"
import type { ToolSpec } from "../audited"
import { resolveToolCredential, type OrgToolConfig } from "../secrets"

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
}

export function cleanHtmlToMarkdown(html: string): { title: string; content: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const rawTitle = titleMatch?.[1]
  const title = rawTitle ? decodeEntities(rawTitle.replace(/<[^>]+>/g, "").trim()) : "Untitled Web Page"

  // 1. Remove non-content tags
  let clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, "")
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")

  // 2. Headings h1-h6
  clean = clean.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => {
    const hashes = "#".repeat(Number(level))
    return `\n\n${hashes} ${text.replace(/<[^>]+>/g, "").trim()}\n\n`
  })

  // 3. Links
  clean = clean.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const t = text.replace(/<[^>]+>/g, "").trim()
    return t ? `[${t}](${href})` : ""
  })

  // 4. List items
  clean = clean.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => {
    return `\n- ${text.replace(/<[^>]+>/g, "").trim()}`
  })

  // 5. Paragraphs and breaks
  clean = clean.replace(/<p[^>]*>/gi, "\n\n").replace(/<\/p>/gi, "")
  clean = clean.replace(/<br\s*\/?>/gi, "\n")
  clean = clean.replace(/<hr\s*\/?>/gi, "\n---\n")

  // 6. Bold & Italics
  clean = clean.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
  clean = clean.replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")

  // 7. Strip remaining HTML tags
  clean = clean.replace(/<[^>]+>/g, " ")

  // 8. Decode basic entities
  clean = clean
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")

  // 9. Normalize whitespace
  clean = clean
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim()

  return { title, content: clean }
}

export function webFetchTool(
  optionsOrOrgId?: { orgId?: string; agentId?: string } | string,
  maybeAgentId?: string,
): ToolSpec {
  const orgId = typeof optionsOrOrgId === "string" ? optionsOrOrgId : optionsOrOrgId?.orgId
  const agentId = typeof optionsOrOrgId === "string" ? maybeAgentId : optionsOrOrgId?.agentId

  return {
    name: "web_fetch",
    description:
      "Fetch and read the content of any public web page URL as clean Markdown or text. Use when you need the complete content of an article, documentation page, or URL found during search.",
    schema: z.object({
      url: z.string().url(),
      format: z.enum(["markdown", "text", "html"]).optional().default("markdown"),
      maxChars: z.number().int().min(500).max(100_000).optional().default(40_000),
    }),
    dangerous: false,
    execute: async (input: { url: string; format?: "markdown" | "text" | "html"; maxChars?: number }, signal?: AbortSignal) => {
      let config: OrgToolConfig | null = null
      if (orgId) {
        config = await resolveToolCredential({ orgId, agentId, tool: "web_search" }).catch(() => null)
      }

      // If TinyFish is configured with API key, use TinyFish Fetch for browser-rendered multi-page extraction
      if (config?.provider === "tinyfish" && config.apiKey) {
        try {
          const tfRes = await fetch("https://api.fetch.tinyfish.ai/", {
            method: "POST",
            headers: {
              "X-API-Key": config.apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              urls: [input.url],
              format: input.format === "html" ? "html" : "markdown",
            }),
            signal,
          })
          if (tfRes.ok) {
            const data = (await tfRes.json()) as any
            const item = data?.results?.[0] || data?.[0]
            if (item?.content) {
              const max = input.maxChars ?? 40_000
              const content = item.content.slice(0, max)
              return {
                url: input.url,
                title: item.title || "Web Page",
                content,
                length: content.length,
                provider: "tinyfish_fetch",
              }
            }
          }
        } catch {}
      }

      // Native clean fetch
      const response = await fetch(input.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal,
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch web page (${response.status} ${response.statusText}): ${input.url}`)
      }

      const contentType = response.headers.get("content-type") || ""
      const rawText = await response.text()
      const max = input.maxChars ?? 40_000

      if (contentType.includes("application/json") || contentType.includes("text/plain")) {
        const content = rawText.slice(0, max)
        return {
          url: input.url,
          title: input.url,
          content,
          length: content.length,
        }
      }

      const { title, content: extracted } = cleanHtmlToMarkdown(rawText)
      const content = extracted.length > max ? `${extracted.slice(0, max)}\n\n[... content truncated ...]` : extracted

      return {
        url: input.url,
        title,
        content,
        length: content.length,
      }
    },
  }
}
