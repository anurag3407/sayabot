/** Starting points for the model field. The field stays free text, so any model id still works. */
export const MODEL_SUGGESTIONS: Record<string, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"],
  anthropic: ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"],
  google: ["gemini-2.5-flash", "gemini-2.5-pro"],
  groq: ["llama-3.3-70b-versatile"],
  cerebras: ["llama-3.3-70b"],
  openrouter: [
    "nvidia/nemotron-3-super-120b-a12b:free",
    "google/gemma-4-31b-it:free",
    "qwen/qwen-2.5-72b-instruct:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "anthropic/claude-3.7-sonnet",
  ],
  copilot: ["auto", "claude-3.5-sonnet", "gpt-4o", "o1-preview"],
  "openai-compatible": [],
}

export function defaultModel(provider: string): string {
  return MODEL_SUGGESTIONS[provider]?.[0] ?? ""
}
