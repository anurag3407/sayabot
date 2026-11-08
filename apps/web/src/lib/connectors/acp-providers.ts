import type { ModelOption } from "./types"

/**
 * OpenCode Zen & Go Subscriptions
 * From ACP Registry: https://github.com/agentclientprotocol/registry/tree/main/opencode
 */
export const OPENCODE_MODELS: ModelOption[] = [
  {
    id: "opencode/zen-1",
    label: "OpenCode Zen 1 (Reasoning)",
    provider: "opencode",
    providerGroup: "OpenCode · Zen Subscription",
    route: "Zen",
    supportsTools: true,
    supportsEffort: true,
    contextWindow: 200000,
    description: "Flagship architectural & high-reasoning coding engine",
  },
  {
    id: "opencode/zen-coder",
    label: "OpenCode Zen Coder",
    provider: "opencode",
    providerGroup: "OpenCode · Zen Subscription",
    route: "Zen",
    supportsTools: true,
    supportsEffort: true,
    contextWindow: 128000,
    description: "Precision code generation and complex refactoring",
  },
  {
    id: "opencode/go",
    label: "OpenCode Go (Instant)",
    provider: "opencode",
    providerGroup: "OpenCode · Go Subscription",
    route: "Go",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 128000,
    description: "Ultra-low-latency high-throughput stream for coding tasks",
  },
  {
    id: "opencode/turbo-pro",
    label: "OpenCode Turbo Pro",
    provider: "opencode",
    providerGroup: "OpenCode · Go Subscription",
    route: "Go",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 200000,
    description: "Large-context turbo code completion and editing",
  },
]

/**
 * Command Code (Cohere / Cortex)
 * From ACP Registry: https://github.com/agentclientprotocol/registry/tree/main/cortex-code
 */
export const COMMAND_CODE_MODELS: ModelOption[] = [
  {
    id: "command-a-code",
    label: "Command A-Code (Autonomous)",
    provider: "command-code",
    providerGroup: "Command Code · Cohere",
    route: "Agent",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 128000,
    description: "Cohere's dedicated autonomous agentic software development model",
  },
  {
    id: "command-r-plus",
    label: "Command R+ Enterprise",
    provider: "command-code",
    providerGroup: "Command Code · Cohere",
    route: "Enterprise",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 128000,
    description: "State of the art enterprise RAG and multi-step tool use",
  },
  {
    id: "command-r",
    label: "Command R Multilingual",
    provider: "command-code",
    providerGroup: "Command Code · Cohere",
    route: "Balanced",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 128000,
    description: "Scalable multilingual tool execution and generation",
  },
  {
    id: "command-r7b",
    label: "Command R 7B",
    provider: "command-code",
    providerGroup: "Command Code · Cohere",
    route: "Fast",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 128000,
    description: "Lightweight, low-latency code reasoning and execution",
  },
]

/**
 * DeepSeek V3 & R1 Reasoning
 */
export const DEEPSEEK_MODELS: ModelOption[] = [
  {
    id: "deepseek-reasoner",
    label: "DeepSeek R1 (Thinking CoT)",
    provider: "deepseek",
    providerGroup: "DeepSeek · Reasoning",
    route: "R1",
    supportsTools: true,
    supportsEffort: true,
    contextWindow: 65536,
    description: "Frontier open-weights reasoning model with chain-of-thought",
  },
  {
    id: "deepseek-chat",
    label: "DeepSeek V3 (671B MoE)",
    provider: "deepseek",
    providerGroup: "DeepSeek · Core",
    route: "V3",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 128000,
    description: "Leading 671B Mixture-of-Experts general intelligence and coding",
  },
  {
    id: "deepseek-coder",
    label: "DeepSeek Coder V2.5",
    provider: "deepseek",
    providerGroup: "DeepSeek · Core",
    route: "Coder",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 128000,
    description: "Specialized programming, synthesis, and debugging",
  },
]

/**
 * MiniMax Code (Hailuo AI)
 * From ACP Registry: https://github.com/agentclientprotocol/registry/tree/main/minimax-code
 */
export const MINIMAX_MODELS: ModelOption[] = [
  {
    id: "MiniMax-Text-01",
    label: "MiniMax-Text-01 (1M Context)",
    provider: "minimax",
    providerGroup: "MiniMax · Hailuo",
    route: "1M Context",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 1000000,
    description: "Ultra-long 1,000,000 token context window with linear processing",
  },
  {
    id: "abab6.5s-chat",
    label: "MiniMax abab 6.5s",
    provider: "minimax",
    providerGroup: "MiniMax · Hailuo",
    route: "Fast",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 245760,
    description: "High-speed multi-turn chat and tool invocation",
  },
  {
    id: "abab7-chat-preview",
    label: "MiniMax abab 7 Preview",
    provider: "minimax",
    providerGroup: "MiniMax · Hailuo",
    route: "Next-Gen",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 245760,
    description: "Next-generation foundation mixture-of-experts model",
  },
]

/**
 * xAI Grok
 * From ACP Registry: https://github.com/agentclientprotocol/registry/tree/main/grok-build
 */
export const GROK_MODELS: ModelOption[] = [
  {
    id: "grok-3-beta",
    label: "Grok 3 (Frontier Reasoning)",
    provider: "grok",
    providerGroup: "xAI · Grok Super",
    route: "Grok 3",
    supportsTools: true,
    supportsEffort: true,
    contextWindow: 131072,
    description: "Frontier reasoning model with real-time knowledge synthesis",
  },
  {
    id: "grok-3-mini-beta",
    label: "Grok 3 Mini (Fast CoT)",
    provider: "grok",
    providerGroup: "xAI · Grok Super",
    route: "Fast",
    supportsTools: true,
    supportsEffort: true,
    contextWindow: 131072,
    description: "High-speed reasoning with chain-of-thought verification",
  },
  {
    id: "grok-2-1212",
    label: "Grok 2 Vision",
    provider: "grok",
    providerGroup: "xAI · Grok Super",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 131072,
    description: "Multimodal image and visual layout understanding",
  },
]

/**
 * Moonshot AI / Kimi Code
 * From ACP Registry: https://github.com/agentclientprotocol/registry/tree/main/kimi-code
 */
export const KIMI_MODELS: ModelOption[] = [
  {
    id: "kimi-k1.5-preview",
    label: "Kimi k1.5 Multimodal Reasoning",
    provider: "kimi",
    providerGroup: "Moonshot AI · Kimi",
    route: "k1.5",
    supportsTools: true,
    supportsEffort: true,
    contextWindow: 200000,
    description: "Long-horizon visual and linguistic reasoning",
  },
  {
    id: "moonshot-v1-auto",
    label: "Moonshot v1 Auto Context",
    provider: "kimi",
    providerGroup: "Moonshot AI · Kimi",
    route: "Auto",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 128000,
    description: "Dynamic context scaling up to 128,000 tokens",
  },
  {
    id: "moonshot-v1-128k",
    label: "Moonshot v1 128k",
    provider: "kimi",
    providerGroup: "Moonshot AI · Kimi",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 128000,
  },
]

/**
 * Alibaba Qwen Code / DashScope
 * From ACP Registry: https://github.com/agentclientprotocol/registry/tree/main/qwen-code
 */
export const QWEN_MODELS: ModelOption[] = [
  {
    id: "qwen-coder-plus",
    label: "Qwen 2.5 Coder Plus",
    provider: "qwen",
    providerGroup: "Alibaba · Qwen Code",
    route: "Coder",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 128000,
    description: "World-class coding benchmark performance for full-stack engineering",
  },
  {
    id: "qwen-max",
    label: "Qwen Max 2.5 (Flagship)",
    provider: "qwen",
    providerGroup: "Alibaba · Qwen Code",
    route: "Max",
    supportsTools: true,
    supportsEffort: true,
    contextWindow: 131072,
    description: "Complex reasoning, math, and multi-step orchestration",
  },
  {
    id: "qwq-32b-preview",
    label: "QwQ 32B (Open Reasoning)",
    provider: "qwen",
    providerGroup: "Alibaba · Qwen Code",
    route: "Reasoning",
    supportsTools: true,
    supportsEffort: true,
    contextWindow: 65536,
    description: "Competitive reasoning and mathematical deduction",
  },
  {
    id: "qwen-plus",
    label: "Qwen Plus High Speed",
    provider: "qwen",
    providerGroup: "Alibaba · Qwen Code",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 128000,
  },
]

/**
 * Cursor Agent Subscription
 * From ACP Registry: https://github.com/agentclientprotocol/registry/tree/main/cursor
 */
export const CURSOR_MODELS: ModelOption[] = [
  {
    id: "cursor-fast",
    label: "Cursor Fast (Tab & Stream)",
    provider: "cursor",
    providerGroup: "Cursor · Pro Subscription",
    route: "Pro",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 128000,
    description: "Cursor Pro optimized speculative decoding and fast completions",
  },
  {
    id: "cursor-small",
    label: "Cursor Small",
    provider: "cursor",
    providerGroup: "Cursor · Pro Subscription",
    route: "Fast",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 65536,
    description: "Low-latency edits and diff applications",
  },
]
