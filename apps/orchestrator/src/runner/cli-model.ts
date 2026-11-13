import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
  SharedV4Warning,
} from "@ai-sdk/provider"
import { cliAgentFolder, type CliRunnerConfig } from "./cli-agent"
import { runCliProcess } from "./cli"

/**
 * Claude Code / Codex / Cursor on this computer as an AI SDK model, so every background job that
 * calls generateText / generateObject (moderator, memory, verify, subagents) works with no key.
 * Text and JSON only: the app's own tools stay inside the app, and AI SDK tools are reported as
 * unsupported (callers then get a plain text answer).
 */

function partText(part: unknown): string {
  if (!part || typeof part !== "object") return ""
  const p = part as { type?: string; text?: string; toolName?: string; output?: unknown }
  if (p.type === "text" || p.type === "reasoning") return p.text ?? ""
  if (p.type === "tool-call") return `[called ${p.toolName ?? "a tool"}]`
  if (p.type === "tool-result")
    return `[${p.toolName ?? "tool"} result] ${JSON.stringify(p.output ?? null).slice(0, 4_000)}`
  if (p.type === "file") return "[file]"
  return ""
}

/** System messages become the system prompt; the rest a plain transcript. */
export function flattenPrompt(prompt: LanguageModelV4Prompt): { system: string; prompt: string } {
  const system: string[] = []
  const turns: string[] = []
  for (const message of prompt) {
    if (message.role === "system") {
      system.push(message.content)
      continue
    }
    const text = message.content.map(partText).filter(Boolean).join("\n")
    if (!text) continue
    turns.push(prompt.length > 2 ? `${message.role.toUpperCase()}:\n${text}` : text)
  }
  return { system: system.join("\n\n"), prompt: turns.join("\n\n") }
}

function usageOf(
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number } | null,
): LanguageModelV4Usage {
  return {
    inputTokens: {
      total: usage ? usage.inputTokens + usage.cachedInputTokens : undefined,
      noCache: usage?.inputTokens,
      cacheRead: usage?.cachedInputTokens,
      cacheWrite: undefined,
    },
    outputTokens: { total: usage?.outputTokens, text: usage?.outputTokens, reasoning: undefined },
  }
}

export function createCliLanguageModel(
  config: CliRunnerConfig,
  folderName = "background",
): LanguageModelV4 {
  const generate = async (
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4GenerateResult> => {
    const warnings: SharedV4Warning[] = []
    if (options.tools?.length) {
      warnings.push({
        type: "unsupported",
        feature: "tools",
        details: "Local apps answer in text only here",
      })
    }
    const flat = flattenPrompt(options.prompt)
    let prompt = flat.prompt
    if (options.responseFormat?.type === "json") {
      prompt += `\n\nAnswer with only one JSON value, no prose and no code fences.${
        options.responseFormat.schema
          ? ` It must match this JSON schema:\n${JSON.stringify(options.responseFormat.schema)}`
          : ""
      }`
    }
    const out = await runCliProcess({
      config,
      system: flat.system || "You are a helpful assistant inside Sayabot.",
      prompt,
      folder: cliAgentFolder(folderName),
      signal: options.abortSignal,
      timeoutMs: 5 * 60_000,
    })
    if (!out.ok) throw new Error(out.error ?? "The app gave no answer")
    let text = out.text
    if (options.responseFormat?.type === "json") {
      const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
      if (fenced?.[1]) text = fenced[1].trim()
    }
    return {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: usageOf(out.usage),
      response: { modelId: out.model, timestamp: new Date() },
      warnings,
    }
  }

  return {
    specificationVersion: "v4",
    provider: config.app,
    modelId: config.model ?? "default",
    supportedUrls: {},
    doGenerate: generate,
    doStream: async (options) => {
      const result = await generate(options)
      const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("")
      const parts: LanguageModelV4StreamPart[] = [
        { type: "stream-start", warnings: result.warnings },
        { type: "response-metadata", modelId: result.response?.modelId },
        { type: "text-start", id: "0" },
        { type: "text-delta", id: "0", delta: text },
        { type: "text-end", id: "0" },
        { type: "finish", usage: result.usage, finishReason: result.finishReason },
      ]
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            for (const part of parts) controller.enqueue(part)
            controller.close()
          },
        }),
      }
    },
  }
}
