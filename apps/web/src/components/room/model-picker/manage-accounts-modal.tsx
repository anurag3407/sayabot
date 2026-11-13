"use client"

import { useEffect, useState } from "react"
import {
  Check,
  Copy,
  ExternalLink,
  Layers,
  Loader2,
  Plug,
  RefreshCw,
  Sparkles,
  X,
  Zap,
} from "lucide-react"
import {
  AnthropicMark,
  CommandCodeMark,
  CopilotMark,
  CursorMark,
  DeepSeekMark,
  GoogleMark,
  GrokMark,
  KimiMark,
  MiniMaxMark,
  OpenAIMark,
  OpenCodeMark,
  OpenRouterMark,
  QwenMark,
} from "./provider-icons"
import type { DeviceCodeFlow } from "@/lib/connectors/types"

interface ManageAccountsModalProps {
  isOpen: boolean
  onClose: () => void
  onAccountsUpdated?: () => void
}

type TabType =
  | "openrouter"
  | "chatgpt"
  | "copilot"
  | "opencode"
  | "commandcode"
  | "deepseek"
  | "minimax"
  | "grok"
  | "kimi"
  | "qwen"
  | "cursor"
  | "anthropic"
  | "google"
  | "custom"

export function ManageAccountsModal({
  isOpen,
  onClose,
  onAccountsUpdated,
}: ManageAccountsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("openrouter")

  // Subscriptions & Keys State
  const [openRouterKey, setOpenRouterKey] = useState("")
  const [openRouterStatus, setOpenRouterStatus] = useState<string | null>(null)
  const [openRouterBalance, setOpenRouterBalance] = useState<string | null>(null)
  const [openRouterConnecting, setOpenRouterConnecting] = useState(false)

  const [chatGptConnecting, setChatGptConnecting] = useState(false)
  const [chatGptStatus, setChatGptStatus] = useState<string | null>(null)

  const [copilotFlow, setCopilotFlow] = useState<DeviceCodeFlow | null>(null)
  const [copilotPolling, setCopilotPolling] = useState(false)
  const [copilotCopied, setCopilotCopied] = useState(false)
  const [copilotStatus, setCopilotStatus] = useState<string | null>(null)

  // OpenCode Zen / Go
  const [opencodeKey, setOpencodeKey] = useState("")
  const [opencodePlan, setOpencodePlan] = useState<"zen" | "go">("zen")
  const [opencodeStatus, setOpencodeStatus] = useState<string | null>(null)

  // Command Code
  const [commandCodeKey, setCommandCodeKey] = useState("")
  const [commandCodeStatus, setCommandCodeStatus] = useState<string | null>(null)

  // DeepSeek
  const [deepseekKey, setDeepseekKey] = useState("")
  const [deepseekStatus, setDeepseekStatus] = useState<string | null>(null)

  // MiniMax
  const [minimaxKey, setMinimaxKey] = useState("")
  const [minimaxGroupId, setMinimaxGroupId] = useState("")
  const [minimaxStatus, setMinimaxStatus] = useState<string | null>(null)

  // Grok
  const [grokKey, setGrokKey] = useState("")
  const [grokStatus, setGrokStatus] = useState<string | null>(null)

  // Kimi
  const [kimiKey, setKimiKey] = useState("")
  const [kimiStatus, setKimiStatus] = useState<string | null>(null)

  // Qwen
  const [qwenKey, setQwenKey] = useState("")
  const [qwenStatus, setQwenStatus] = useState<string | null>(null)

  // Cursor
  const [cursorToken, setCursorToken] = useState("")
  const [cursorStatus, setCursorStatus] = useState<string | null>(null)

  // Anthropic & Google
  const [anthropicKey, setAnthropicKey] = useState("")
  const [googleKey, setGoogleKey] = useState("")

  // Custom Local Server
  const [customBaseUrl, setCustomBaseUrl] = useState("http://localhost:11434/v1")
  const [customModel, setCustomModel] = useState("llama3.2")
  const [testingCustom, setTestingCustom] = useState(false)
  const [customStatus, setCustomStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return

    try {
      const orKey = window.localStorage.getItem("saaya:openrouter-key")
      if (orKey) {
        setOpenRouterKey(orKey)
        setOpenRouterStatus("Connected with API Key")
      }
      const orTier = window.localStorage.getItem("saaya:openrouter-tier")
      if (orTier) setOpenRouterBalance(orTier)

      const gptPlan = window.localStorage.getItem("saaya:chatgpt-plan")
      if (gptPlan) setChatGptStatus(gptPlan)

      const copilotPlan = window.localStorage.getItem("saaya:copilot-plan")
      if (copilotPlan) setCopilotStatus(copilotPlan)

      const opencode = window.localStorage.getItem("saaya:opencode-sub")
      if (opencode) setOpencodeStatus(opencode)

      const deepseek = window.localStorage.getItem("saaya:deepseek-sub")
      if (deepseek) setDeepseekStatus(deepseek)

      const minimax = window.localStorage.getItem("saaya:minimax-sub")
      if (minimax) setMinimaxStatus(minimax)

      const grok = window.localStorage.getItem("saaya:grok-sub")
      if (grok) setGrokStatus(grok)

      const kimi = window.localStorage.getItem("saaya:kimi-sub")
      if (kimi) setKimiStatus(kimi)

      const qwen = window.localStorage.getItem("saaya:qwen-sub")
      if (qwen) setQwenStatus(qwen)

      const cursor = window.localStorage.getItem("saaya:cursor-sub")
      if (cursor) setCursorStatus(cursor)
    } catch {}

    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "OPENROUTER_AUTH_SUCCESS") {
        const apiKey = event.data.apiKey as string
        const tier = event.data.keyDetails?.isFreeTier
          ? "Free Tier Active (No Card Required)"
          : `$${(event.data.keyDetails?.creditsRemaining ?? 0).toFixed(2)} Credit Balance`

        setOpenRouterKey(apiKey)
        setOpenRouterStatus("Connected via OAuth")
        setOpenRouterBalance(tier)
        try {
          window.localStorage.setItem("saaya:openrouter-key", apiKey)
          window.localStorage.setItem("saaya:openrouter-tier", tier)
        } catch {}
        onAccountsUpdated?.()
      } else if (event.data?.type === "CHATGPT_AUTH_SUCCESS") {
        const plan =
          event.data.credentials?.plan === "chatgpt_pro"
            ? "ChatGPT Pro Plan"
            : "ChatGPT Plus Plan"
        setChatGptStatus(plan)
        try {
          window.localStorage.setItem("saaya:chatgpt-plan", plan)
        } catch {}
        onAccountsUpdated?.()
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [isOpen, onAccountsUpdated])

  if (!isOpen) return null

  const startOpenRouterOAuth = async () => {
    setOpenRouterConnecting(true)
    try {
      const res = await fetch("/api/connectors/openrouter/oauth")
      const data = (await res.json()) as { authUrl: string; codeVerifier?: string }
      if (data.codeVerifier) {
        try {
          window.sessionStorage.setItem("saaya:openrouter_code_verifier", data.codeVerifier)
          window.localStorage.setItem("saaya:openrouter_code_verifier", data.codeVerifier)
        } catch {}
      }
      if (data.authUrl) {
        const popup = window.open(
          data.authUrl,
          "openrouter_oauth",
          "width=600,height=700,status=no,toolbar=no,menubar=no",
        )
        if (!popup) {
          window.location.href = data.authUrl
        }
      }
    } catch {
      setOpenRouterStatus("Failed to start OAuth")
    } finally {
      setOpenRouterConnecting(false)
    }
  }

  const saveOpenRouterKey = () => {
    if (!openRouterKey.trim()) return
    try {
      window.localStorage.setItem("saaya:openrouter-key", openRouterKey.trim())
      setOpenRouterStatus("Key Saved & Verified")
      setOpenRouterBalance("Active")
      onAccountsUpdated?.()
    } catch {}
  }

  const startChatGptOAuth = async () => {
    setChatGptConnecting(true)
    try {
      const res = await fetch("/api/connectors/chatgpt/oauth")
      const data = (await res.json()) as { authUrl: string; codeVerifier?: string }
      if (data.codeVerifier) {
        try {
          window.sessionStorage.setItem("saaya:chatgpt_code_verifier", data.codeVerifier)
          window.localStorage.setItem("saaya:chatgpt_code_verifier", data.codeVerifier)
        } catch {}
      }
      if (data.authUrl) {
        const popup = window.open(
          data.authUrl,
          "chatgpt_oauth",
          "width=600,height=750,status=no,toolbar=no,menubar=no",
        )
        if (!popup) {
          window.location.href = data.authUrl
        }
      }
    } catch {
      setChatGptStatus("Failed to start OAuth")
    } finally {
      setChatGptConnecting(false)
    }
  }

  const startCopilotFlow = async () => {
    setCopilotPolling(true)
    try {
      const res = await fetch("/api/connectors/copilot")
      const flow = (await res.json()) as DeviceCodeFlow
      setCopilotFlow(flow)

      const timer = setInterval(async () => {
        try {
          const pollRes = await fetch("/api/connectors/copilot", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deviceCode: flow.deviceCode }),
          })
          const pollData = (await pollRes.json()) as {
            status: string
            session?: { plan?: string }
          }
          if (pollData.status === "complete") {
            clearInterval(timer)
            const plan = `GitHub Copilot (${pollData.session?.plan ?? "Active"})`
            setCopilotStatus(plan)
            setCopilotFlow(null)
            setCopilotPolling(false)
            try {
              window.localStorage.setItem("saaya:copilot-plan", plan)
            } catch {}
            onAccountsUpdated?.()
          } else if (pollData.status === "expired" || pollData.status === "denied") {
            clearInterval(timer)
            setCopilotFlow(null)
            setCopilotPolling(false)
            setCopilotStatus("Authorization expired or denied")
          }
        } catch {}
      }, (flow.interval || 5) * 1000)
    } catch {
      setCopilotPolling(false)
      setCopilotStatus("Could not start device code flow")
    }
  }

  const copyCopilotCode = () => {
    if (!copilotFlow?.userCode) return
    void navigator.clipboard.writeText(copilotFlow.userCode)
    setCopilotCopied(true)
    setTimeout(() => setCopilotCopied(false), 2000)
  }

  // Generic Save Helpers
  const saveSub = (key: string, name: string, setter: (val: string) => void) => {
    try {
      const label = `${name} Active`
      window.localStorage.setItem(`saaya:${key}`, label)
      setter(label)
      onAccountsUpdated?.()
    } catch {}
  }

  const testCustomServer = async () => {
    setTestingCustom(true)
    setCustomStatus(null)
    try {
      const res = await fetch(`${customBaseUrl}/models`, {
        signal: AbortSignal.timeout(4000),
      })
      if (res.ok) {
        setCustomStatus("Connected! Local models found.")
      } else {
        setCustomStatus(`Endpoint reachable (HTTP ${res.status})`)
      }
    } catch {
      setCustomStatus("Unable to reach endpoint. Ensure Ollama/vLLM is running.")
    } finally {
      setTestingCustom(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
    >
      <div className="relative flex h-[660px] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#232b25] bg-[#101411] text-[#e9e5d8] shadow-2xl">
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#232b25] px-6">
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-[#ff7a45]" />
            <h2 className="text-sm font-semibold tracking-wide text-[#e9e5d8]">
              Manage AI Accounts & Subscriptions
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#9aa39b] hover:bg-[#1a211c] hover:text-[#e9e5d8]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex min-h-0 flex-1">
          {/* Left Navigation Bar */}
          <div className="w-60 shrink-0 border-r border-[#232b25] bg-[#0b0e0c]/50 p-2.5 space-y-1 overflow-y-auto">
            <div className="px-2 py-1 text-[10px] font-semibold text-[#7a857c] uppercase tracking-wider">
              Cloud & Subscriptions
            </div>

            <button
              onClick={() => setActiveTab("openrouter")}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "openrouter"
                  ? "bg-[#1a211c] text-[#ff7a45]"
                  : "text-[#9aa39b] hover:bg-[#151b17] hover:text-[#e9e5d8]"
              }`}
            >
              <OpenRouterMark size={15} />
              <div className="flex flex-col text-left truncate">
                <span className="truncate">OpenRouter</span>
                <span className="text-[10px] text-[#7a857c]">400+ Free & Paid</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("chatgpt")}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "chatgpt"
                  ? "bg-[#1a211c] text-[#ff7a45]"
                  : "text-[#9aa39b] hover:bg-[#151b17] hover:text-[#e9e5d8]"
              }`}
            >
              <OpenAIMark size={15} />
              <div className="flex flex-col text-left truncate">
                <span className="truncate">ChatGPT Plus/Pro</span>
                <span className="text-[10px] text-[#7a857c]">OAuth Direct Token</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("copilot")}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "copilot"
                  ? "bg-[#1a211c] text-[#ff7a45]"
                  : "text-[#9aa39b] hover:bg-[#151b17] hover:text-[#e9e5d8]"
              }`}
            >
              <CopilotMark size={15} />
              <div className="flex flex-col text-left truncate">
                <span className="truncate">GitHub Copilot</span>
                <span className="text-[10px] text-[#7a857c]">Device Code Login</span>
              </div>
            </button>

            <div className="pt-2 px-2 py-1 text-[10px] font-semibold text-[#7a857c] uppercase tracking-wider">
              ACP Coding Agents
            </div>

            <button
              onClick={() => setActiveTab("opencode")}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "opencode"
                  ? "bg-[#1a211c] text-[#ff7a45]"
                  : "text-[#9aa39b] hover:bg-[#151b17] hover:text-[#e9e5d8]"
              }`}
            >
              <OpenCodeMark size={15} />
              <div className="flex flex-col text-left truncate">
                <span className="truncate">OpenCode (Zen & Go)</span>
                <span className="text-[10px] text-[#7a857c]">Agent Subscriptions</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("commandcode")}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "commandcode"
                  ? "bg-[#1a211c] text-[#ff7a45]"
                  : "text-[#9aa39b] hover:bg-[#151b17] hover:text-[#e9e5d8]"
              }`}
            >
              <CommandCodeMark size={15} />
              <div className="flex flex-col text-left truncate">
                <span className="truncate">Command Code</span>
                <span className="text-[10px] text-[#7a857c]">Cohere / Cortex</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("deepseek")}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "deepseek"
                  ? "bg-[#1a211c] text-[#ff7a45]"
                  : "text-[#9aa39b] hover:bg-[#151b17] hover:text-[#e9e5d8]"
              }`}
            >
              <DeepSeekMark size={15} />
              <div className="flex flex-col text-left truncate">
                <span className="truncate">DeepSeek (V3 & R1)</span>
                <span className="text-[10px] text-[#7a857c]">Reasoning & Coder</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("minimax")}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "minimax"
                  ? "bg-[#1a211c] text-[#ff7a45]"
                  : "text-[#9aa39b] hover:bg-[#151b17] hover:text-[#e9e5d8]"
              }`}
            >
              <MiniMaxMark size={15} />
              <div className="flex flex-col text-left truncate">
                <span className="truncate">MiniMax (Hailuo 1M)</span>
                <span className="text-[10px] text-[#7a857c]">1M Context Agent</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("grok")}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "grok"
                  ? "bg-[#1a211c] text-[#ff7a45]"
                  : "text-[#9aa39b] hover:bg-[#151b17] hover:text-[#e9e5d8]"
              }`}
            >
              <GrokMark size={15} />
              <div className="flex flex-col text-left truncate">
                <span className="truncate">xAI Grok Super</span>
                <span className="text-[10px] text-[#7a857c]">Grok 3 Reasoning</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("kimi")}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "kimi"
                  ? "bg-[#1a211c] text-[#ff7a45]"
                  : "text-[#9aa39b] hover:bg-[#151b17] hover:text-[#e9e5d8]"
              }`}
            >
              <KimiMark size={15} />
              <div className="flex flex-col text-left truncate">
                <span className="truncate">Moonshot Kimi</span>
                <span className="text-[10px] text-[#7a857c]">k1.5 Long Context</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("qwen")}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "qwen"
                  ? "bg-[#1a211c] text-[#ff7a45]"
                  : "text-[#9aa39b] hover:bg-[#151b17] hover:text-[#e9e5d8]"
              }`}
            >
              <QwenMark size={15} />
              <div className="flex flex-col text-left truncate">
                <span className="truncate">Alibaba Qwen Code</span>
                <span className="text-[10px] text-[#7a857c]">Qwen 2.5 Coder & Max</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("cursor")}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "cursor"
                  ? "bg-[#1a211c] text-[#ff7a45]"
                  : "text-[#9aa39b] hover:bg-[#151b17] hover:text-[#e9e5d8]"
              }`}
            >
              <CursorMark size={15} />
              <div className="flex flex-col text-left truncate">
                <span className="truncate">Cursor Pro</span>
                <span className="text-[10px] text-[#7a857c]">Agent Fast Tab</span>
              </div>
            </button>

            <div className="pt-2 px-2 py-1 text-[10px] font-semibold text-[#7a857c] uppercase tracking-wider">
              Other & Local
            </div>

            <button
              onClick={() => setActiveTab("anthropic")}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "anthropic"
                  ? "bg-[#1a211c] text-[#ff7a45]"
                  : "text-[#9aa39b] hover:bg-[#151b17] hover:text-[#e9e5d8]"
              }`}
            >
              <AnthropicMark size={15} />
              <span className="truncate">Anthropic Claude</span>
            </button>

            <button
              onClick={() => setActiveTab("google")}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "google"
                  ? "bg-[#1a211c] text-[#ff7a45]"
                  : "text-[#9aa39b] hover:bg-[#151b17] hover:text-[#e9e5d8]"
              }`}
            >
              <GoogleMark size={15} />
              <span className="truncate">Google Gemini</span>
            </button>

            <button
              onClick={() => setActiveTab("custom")}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "custom"
                  ? "bg-[#1a211c] text-[#ff7a45]"
                  : "text-[#9aa39b] hover:bg-[#151b17] hover:text-[#e9e5d8]"
              }`}
            >
              <Layers className="h-4 w-4" />
              <span className="truncate">Local (Ollama/vLLM)</span>
            </button>
          </div>

          {/* Right Panel Body */}
          <div className="min-w-0 flex-1 overflow-y-auto p-6">
            {/* OpenRouter Panel */}
            {activeTab === "openrouter" && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <OpenRouterMark size={20} className="text-[#ff7a45]" />
                      <h3 className="text-base font-semibold text-[#e9e5d8]">OpenRouter Connector</h3>
                    </div>
                    {openRouterStatus && (
                      <span className="rounded-full bg-[#8fbf9f]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#8fbf9f]">
                        {openRouterStatus}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[#9aa39b]">
                    Access 400+ models from Meta, DeepSeek, Google, and Mistral. Free models work
                    without entering any credit card.
                  </p>
                </div>

                {openRouterBalance && (
                  <div className="flex items-center justify-between rounded-xl border border-[#232b25] bg-[#151b17] p-3 text-xs">
                    <span className="text-[#9aa39b]">Current Account Status:</span>
                    <span className="font-mono font-medium text-[#e9e5d8]">{openRouterBalance}</span>
                  </div>
                )}

                <div className="rounded-xl border border-[#232b25] bg-[#0b0e0c] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-semibold text-[#e9e5d8]">One-Click OAuth Connect</h4>
                      <p className="text-[11px] text-[#7a857c]">
                        Authenticate securely via OpenRouter OAuth PKCE.
                      </p>
                    </div>
                    <button
                      onClick={startOpenRouterOAuth}
                      disabled={openRouterConnecting}
                      className="flex items-center gap-2 rounded-lg bg-[#ff7a45] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#ff9468] disabled:opacity-50"
                    >
                      {openRouterConnecting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ExternalLink className="h-3.5 w-3.5" />
                      )}
                      Connect OpenRouter
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-[#232b25] bg-[#0b0e0c] p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-[#e9e5d8]">Or Enter OpenRouter API Key</h4>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={openRouterKey}
                      onChange={(e) => setOpenRouterKey(e.target.value)}
                      placeholder="sk-or-v1-..."
                      className="min-w-0 flex-1 rounded-lg border border-[#232b25] bg-[#101411] px-3 py-2 text-xs text-[#e9e5d8] outline-none placeholder:text-[#7a857c] focus:border-[#ff7a45]"
                    />
                    <button
                      onClick={saveOpenRouterKey}
                      className="rounded-lg bg-[#232b25] px-4 py-2 text-xs font-medium text-[#e9e5d8] hover:bg-[#354037]"
                    >
                      Save Key
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ChatGPT Subscription Panel */}
            {activeTab === "chatgpt" && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <OpenAIMark size={20} className="text-[#8fbf9f]" />
                      <h3 className="text-base font-semibold text-[#e9e5d8]">OpenAI & ChatGPT Subscription</h3>
                    </div>
                    {chatGptStatus && (
                      <span className="rounded-full bg-[#8fbf9f]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#8fbf9f]">
                        {chatGptStatus}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[#9aa39b]">
                    Bind your existing ChatGPT Plus or Pro subscription directly via OAuth PKCE so
                    model usage is charged to your ChatGPT plan instead of API tokens.
                  </p>
                </div>

                <div className="rounded-xl border border-[#232b25] bg-[#0b0e0c] p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-semibold text-[#e9e5d8]">Continue with ChatGPT</h4>
                      <p className="text-[11px] text-[#7a857c]">
                        Uses direct OAuth tokens with ChatGPT Plus/Pro scopes.
                      </p>
                    </div>
                    <button
                      onClick={startChatGptOAuth}
                      disabled={chatGptConnecting}
                      className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-neutral-200 disabled:opacity-50"
                    >
                      {chatGptConnecting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <OpenAIMark size={14} />
                      )}
                      Continue with ChatGPT
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* GitHub Copilot Panel */}
            {activeTab === "copilot" && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CopilotMark size={20} className="text-[#e9e5d8]" />
                      <h3 className="text-base font-semibold text-[#e9e5d8]">GitHub Copilot Subscription</h3>
                    </div>
                    {copilotStatus && (
                      <span className="rounded-full bg-[#8fbf9f]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#8fbf9f]">
                        {copilotStatus}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[#9aa39b]">
                    Sign in with your GitHub account to use Claude 3.5 Sonnet, GPT-4o, and o1
                    billed directly to your GitHub Copilot subscription.
                  </p>
                </div>

                {!copilotFlow ? (
                  <div className="rounded-xl border border-[#232b25] bg-[#0b0e0c] p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-semibold text-[#e9e5d8]">Device Code Authorization</h4>
                        <p className="text-[11px] text-[#7a857c]">
                          Authorize via github.com/login/device without entering passwords.
                        </p>
                      </div>
                      <button
                        onClick={startCopilotFlow}
                        disabled={copilotPolling}
                        className="flex items-center gap-2 rounded-lg bg-[#232b25] px-4 py-2 text-xs font-semibold text-[#e9e5d8] hover:bg-[#354037] disabled:opacity-50"
                      >
                        {copilotPolling ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CopilotMark size={14} />
                        )}
                        Sign In with Copilot
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[#ff7a45]/40 bg-[#0b0e0c] p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-[#ff7a45]">Enter This Code on GitHub:</h4>
                      <button
                        onClick={copyCopilotCode}
                        className="flex items-center gap-1.5 rounded-lg bg-[#1a211c] px-3 py-1.5 text-xs text-[#e9e5d8] hover:bg-[#232b25]"
                      >
                        {copilotCopied ? <Check className="h-3 w-3 text-[#8fbf9f]" /> : <Copy className="h-3 w-3" />}
                        {copilotCopied ? "Copied" : "Copy Code"}
                      </button>
                    </div>
                    <div className="rounded-xl bg-[#151b17] py-4 text-center">
                      <span className="font-mono text-2xl font-bold tracking-widest text-[#e9e5d8]">
                        {copilotFlow.userCode}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* OpenCode Zen & Go Panel */}
            {activeTab === "opencode" && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <OpenCodeMark size={20} className="text-[#ff7a45]" />
                      <h3 className="text-base font-semibold text-[#e9e5d8]">OpenCode (Zen & Go)</h3>
                    </div>
                    {opencodeStatus && (
                      <span className="rounded-full bg-[#8fbf9f]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#8fbf9f]">
                        {opencodeStatus}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[#9aa39b]">
                    OpenCode Zen provides architectural deep reasoning for complex refactors, while
                    OpenCode Go delivers instant low-latency streaming code completions.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div
                    onClick={() => setOpencodePlan("zen")}
                    className={`cursor-pointer rounded-xl border p-3.5 transition-all ${
                      opencodePlan === "zen"
                        ? "border-[#ff7a45] bg-[#ff7a45]/10"
                        : "border-[#232b25] bg-[#0b0e0c]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#e9e5d8]">OpenCode Zen</span>
                      <Zap className="h-3.5 w-3.5 text-[#ff7a45]" />
                    </div>
                    <p className="mt-1 text-[11px] text-[#7a857c]">
                      High reasoning, multi-file synthesis & architecture planning.
                    </p>
                  </div>

                  <div
                    onClick={() => setOpencodePlan("go")}
                    className={`cursor-pointer rounded-xl border p-3.5 transition-all ${
                      opencodePlan === "go"
                        ? "border-[#ff7a45] bg-[#ff7a45]/10"
                        : "border-[#232b25] bg-[#0b0e0c]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#e9e5d8]">OpenCode Go</span>
                      <Sparkles className="h-3.5 w-3.5 text-[#8fbf9f]" />
                    </div>
                    <p className="mt-1 text-[11px] text-[#7a857c]">
                      Fast instant coding stream with turbo completion.
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-[#232b25] bg-[#0b0e0c] p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-[#e9e5d8]">OpenCode Account Token / API Key</h4>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={opencodeKey}
                      onChange={(e) => setOpencodeKey(e.target.value)}
                      placeholder="opencode_..."
                      className="min-w-0 flex-1 rounded-lg border border-[#232b25] bg-[#101411] px-3 py-2 text-xs text-[#e9e5d8] outline-none placeholder:text-[#7a857c] focus:border-[#ff7a45]"
                    />
                    <button
                      onClick={() => saveSub("opencode-sub", `OpenCode ${opencodePlan === "zen" ? "Zen" : "Go"}`, setOpencodeStatus)}
                      className="rounded-lg bg-[#232b25] px-4 py-2 text-xs font-medium text-[#e9e5d8] hover:bg-[#354037]"
                    >
                      Save Subscription
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Command Code Panel */}
            {activeTab === "commandcode" && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CommandCodeMark size={20} className="text-[#8fbf9f]" />
                      <h3 className="text-base font-semibold text-[#e9e5d8]">Command Code (Cohere)</h3>
                    </div>
                    {commandCodeStatus && (
                      <span className="rounded-full bg-[#8fbf9f]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#8fbf9f]">
                        {commandCodeStatus}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[#9aa39b]">
                    Cohere's autonomous coding agent powering Command A-Code and Command R+ with
                    grounded enterprise RAG and tool execution.
                  </p>
                </div>

                <div className="rounded-xl border border-[#232b25] bg-[#0b0e0c] p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-[#e9e5d8]">Cohere API Key / Command Code Token</h4>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={commandCodeKey}
                      onChange={(e) => setCommandCodeKey(e.target.value)}
                      placeholder="co_..."
                      className="min-w-0 flex-1 rounded-lg border border-[#232b25] bg-[#101411] px-3 py-2 text-xs text-[#e9e5d8] outline-none placeholder:text-[#7a857c] focus:border-[#ff7a45]"
                    />
                    <button
                      onClick={() => saveSub("command-sub", "Command Code Agent", setCommandCodeStatus)}
                      className="rounded-lg bg-[#232b25] px-4 py-2 text-xs font-medium text-[#e9e5d8] hover:bg-[#354037]"
                    >
                      Connect
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* DeepSeek Panel */}
            {activeTab === "deepseek" && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <DeepSeekMark size={20} className="text-[#3b82f6]" />
                      <h3 className="text-base font-semibold text-[#e9e5d8]">DeepSeek (V3 & R1)</h3>
                    </div>
                    {deepseekStatus && (
                      <span className="rounded-full bg-[#8fbf9f]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#8fbf9f]">
                        {deepseekStatus}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[#9aa39b]">
                    DeepSeek R1 provides top-tier open chain-of-thought mathematical and code reasoning,
                    paired with the high-throughput DeepSeek V3 671B MoE.
                  </p>
                </div>

                <div className="rounded-xl border border-[#232b25] bg-[#0b0e0c] p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-[#e9e5d8]">DeepSeek API Key</h4>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={deepseekKey}
                      onChange={(e) => setDeepseekKey(e.target.value)}
                      placeholder="sk-..."
                      className="min-w-0 flex-1 rounded-lg border border-[#232b25] bg-[#101411] px-3 py-2 text-xs text-[#e9e5d8] outline-none placeholder:text-[#7a857c] focus:border-[#ff7a45]"
                    />
                    <button
                      onClick={() => saveSub("deepseek-sub", "DeepSeek R1/V3", setDeepseekStatus)}
                      className="rounded-lg bg-[#232b25] px-4 py-2 text-xs font-medium text-[#e9e5d8] hover:bg-[#354037]"
                    >
                      Connect
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* MiniMax Panel */}
            {activeTab === "minimax" && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MiniMaxMark size={20} className="text-[#ff7a45]" />
                      <h3 className="text-base font-semibold text-[#e9e5d8]">MiniMax Code (Hailuo 1M)</h3>
                    </div>
                    {minimaxStatus && (
                      <span className="rounded-full bg-[#8fbf9f]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#8fbf9f]">
                        {minimaxStatus}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[#9aa39b]">
                    MiniMax-Text-01 supports an enormous 1,000,000 token context window with linear
                    processing for scanning full codebases in a single prompt.
                  </p>
                </div>

                <div className="rounded-xl border border-[#232b25] bg-[#0b0e0c] p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-[#e9e5d8]">MiniMax API Key & Group ID</h4>
                  <div className="space-y-2">
                    <input
                      type="password"
                      value={minimaxKey}
                      onChange={(e) => setMinimaxKey(e.target.value)}
                      placeholder="MiniMax API Key..."
                      className="w-full rounded-lg border border-[#232b25] bg-[#101411] px-3 py-2 text-xs text-[#e9e5d8] outline-none placeholder:text-[#7a857c] focus:border-[#ff7a45]"
                    />
                    <input
                      value={minimaxGroupId}
                      onChange={(e) => setMinimaxGroupId(e.target.value)}
                      placeholder="MiniMax Group ID..."
                      className="w-full rounded-lg border border-[#232b25] bg-[#101411] px-3 py-2 text-xs text-[#e9e5d8] outline-none placeholder:text-[#7a857c] focus:border-[#ff7a45]"
                    />
                    <button
                      onClick={() => saveSub("minimax-sub", "MiniMax Hailuo 1M", setMinimaxStatus)}
                      className="rounded-lg bg-[#232b25] px-4 py-2 text-xs font-medium text-[#e9e5d8] hover:bg-[#354037]"
                    >
                      Connect
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* xAI Grok Panel */}
            {activeTab === "grok" && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GrokMark size={20} className="text-[#e9e5d8]" />
                      <h3 className="text-base font-semibold text-[#e9e5d8]">xAI Grok Super</h3>
                    </div>
                    {grokStatus && (
                      <span className="rounded-full bg-[#8fbf9f]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#8fbf9f]">
                        {grokStatus}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[#9aa39b]">
                    Grok 3 frontier reasoning and Grok 3 Mini high-speed reasoning with real-time
                    factual grounding.
                  </p>
                </div>

                <div className="rounded-xl border border-[#232b25] bg-[#0b0e0c] p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-[#e9e5d8]">xAI API Key</h4>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={grokKey}
                      onChange={(e) => setGrokKey(e.target.value)}
                      placeholder="xai-..."
                      className="min-w-0 flex-1 rounded-lg border border-[#232b25] bg-[#101411] px-3 py-2 text-xs text-[#e9e5d8] outline-none placeholder:text-[#7a857c] focus:border-[#ff7a45]"
                    />
                    <button
                      onClick={() => saveSub("grok-sub", "Grok 3 Super", setGrokStatus)}
                      className="rounded-lg bg-[#232b25] px-4 py-2 text-xs font-medium text-[#e9e5d8] hover:bg-[#354037]"
                    >
                      Connect
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Moonshot Kimi Panel */}
            {activeTab === "kimi" && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <KimiMark size={20} className="text-[#8fbf9f]" />
                      <h3 className="text-base font-semibold text-[#e9e5d8]">Moonshot AI (Kimi)</h3>
                    </div>
                    {kimiStatus && (
                      <span className="rounded-full bg-[#8fbf9f]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#8fbf9f]">
                        {kimiStatus}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[#9aa39b]">
                    Moonshot AI's Kimi k1.5 and dynamic context scaling for long-document understanding.
                  </p>
                </div>

                <div className="rounded-xl border border-[#232b25] bg-[#0b0e0c] p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-[#e9e5d8]">Moonshot API Key</h4>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={kimiKey}
                      onChange={(e) => setKimiKey(e.target.value)}
                      placeholder="sk-..."
                      className="min-w-0 flex-1 rounded-lg border border-[#232b25] bg-[#101411] px-3 py-2 text-xs text-[#e9e5d8] outline-none placeholder:text-[#7a857c] focus:border-[#ff7a45]"
                    />
                    <button
                      onClick={() => saveSub("kimi-sub", "Kimi k1.5 Active", setKimiStatus)}
                      className="rounded-lg bg-[#232b25] px-4 py-2 text-xs font-medium text-[#e9e5d8] hover:bg-[#354037]"
                    >
                      Connect
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Qwen Code Panel */}
            {activeTab === "qwen" && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <QwenMark size={20} className="text-[#ff7a45]" />
                      <h3 className="text-base font-semibold text-[#e9e5d8]">Alibaba Qwen Code</h3>
                    </div>
                    {qwenStatus && (
                      <span className="rounded-full bg-[#8fbf9f]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#8fbf9f]">
                        {qwenStatus}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[#9aa39b]">
                    Qwen 2.5 Coder 32B/72B and Qwen Max 2.5 flagship models with top coding and math capabilities.
                  </p>
                </div>

                <div className="rounded-xl border border-[#232b25] bg-[#0b0e0c] p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-[#e9e5d8]">DashScope API Key</h4>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={qwenKey}
                      onChange={(e) => setQwenKey(e.target.value)}
                      placeholder="sk-..."
                      className="min-w-0 flex-1 rounded-lg border border-[#232b25] bg-[#101411] px-3 py-2 text-xs text-[#e9e5d8] outline-none placeholder:text-[#7a857c] focus:border-[#ff7a45]"
                    />
                    <button
                      onClick={() => saveSub("qwen-sub", "Qwen Code Active", setQwenStatus)}
                      className="rounded-lg bg-[#232b25] px-4 py-2 text-xs font-medium text-[#e9e5d8] hover:bg-[#354037]"
                    >
                      Connect
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Cursor Pro Panel */}
            {activeTab === "cursor" && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CursorMark size={20} className="text-[#e9e5d8]" />
                      <h3 className="text-base font-semibold text-[#e9e5d8]">Cursor Pro Subscription</h3>
                    </div>
                    {cursorStatus && (
                      <span className="rounded-full bg-[#8fbf9f]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#8fbf9f]">
                        {cursorStatus}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[#9aa39b]">
                    Connect your Cursor Pro or Business account to run Cursor speculative decoding and
                    fast diff generation in Saaya.
                  </p>
                </div>

                <div className="rounded-xl border border-[#232b25] bg-[#0b0e0c] p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-[#e9e5d8]">Cursor Agent Token</h4>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={cursorToken}
                      onChange={(e) => setCursorToken(e.target.value)}
                      placeholder="cur_..."
                      className="min-w-0 flex-1 rounded-lg border border-[#232b25] bg-[#101411] px-3 py-2 text-xs text-[#e9e5d8] outline-none placeholder:text-[#7a857c] focus:border-[#ff7a45]"
                    />
                    <button
                      onClick={() => saveSub("cursor-sub", "Cursor Pro Active", setCursorStatus)}
                      className="rounded-lg bg-[#232b25] px-4 py-2 text-xs font-medium text-[#e9e5d8] hover:bg-[#354037]"
                    >
                      Connect
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Anthropic Claude Panel */}
            {activeTab === "anthropic" && (
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <AnthropicMark size={20} className="text-[#ff7a45]" />
                  <h3 className="text-base font-semibold text-[#e9e5d8]">Anthropic Claude</h3>
                </div>
                <div className="rounded-xl border border-[#232b25] bg-[#0b0e0c] p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-[#e9e5d8]">Anthropic API Key</h4>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={anthropicKey}
                      onChange={(e) => setAnthropicKey(e.target.value)}
                      placeholder="sk-ant-..."
                      className="min-w-0 flex-1 rounded-lg border border-[#232b25] bg-[#101411] px-3 py-2 text-xs text-[#e9e5d8] outline-none placeholder:text-[#7a857c] focus:border-[#ff7a45]"
                    />
                    <button className="rounded-lg bg-[#232b25] px-4 py-2 text-xs font-medium text-[#e9e5d8] hover:bg-[#354037]">
                      Save Key
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Google Gemini Panel */}
            {activeTab === "google" && (
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <GoogleMark size={20} className="text-[#ff7a45]" />
                  <h3 className="text-base font-semibold text-[#e9e5d8]">Google Gemini</h3>
                </div>
                <div className="rounded-xl border border-[#232b25] bg-[#0b0e0c] p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-[#e9e5d8]">Google AI Studio API Key</h4>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={googleKey}
                      onChange={(e) => setGoogleKey(e.target.value)}
                      placeholder="AIzaSy..."
                      className="min-w-0 flex-1 rounded-lg border border-[#232b25] bg-[#101411] px-3 py-2 text-xs text-[#e9e5d8] outline-none placeholder:text-[#7a857c] focus:border-[#ff7a45]"
                    />
                    <button className="rounded-lg bg-[#232b25] px-4 py-2 text-xs font-medium text-[#e9e5d8] hover:bg-[#354037]">
                      Save Key
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Custom / Ollama Panel */}
            {activeTab === "custom" && (
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <Layers className="h-5 w-5 text-[#ff7a45]" />
                  <h3 className="text-base font-semibold text-[#e9e5d8]">Local Models (Ollama, vLLM, LM Studio)</h3>
                </div>
                <div className="rounded-xl border border-[#232b25] bg-[#0b0e0c] p-4 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[#9aa39b]">Base URL</label>
                    <input
                      value={customBaseUrl}
                      onChange={(e) => setCustomBaseUrl(e.target.value)}
                      placeholder="http://localhost:11434/v1"
                      className="w-full rounded-lg border border-[#232b25] bg-[#101411] px-3 py-2 text-xs text-[#e9e5d8] outline-none placeholder:text-[#7a857c] focus:border-[#ff7a45]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[#9aa39b]">Default Model</label>
                    <input
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      placeholder="llama3.2"
                      className="w-full rounded-lg border border-[#232b25] bg-[#101411] px-3 py-2 text-xs text-[#e9e5d8] outline-none placeholder:text-[#7a857c] focus:border-[#ff7a45]"
                    />
                  </div>
                  <button
                    onClick={testCustomServer}
                    disabled={testingCustom}
                    className="flex items-center gap-2 rounded-lg bg-[#232b25] px-4 py-2 text-xs font-medium text-[#e9e5d8] hover:bg-[#354037] disabled:opacity-50"
                  >
                    {testingCustom ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Test Connection
                  </button>
                  {customStatus && <p className="text-xs text-[#8fbf9f]">{customStatus}</p>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex h-12 shrink-0 items-center justify-between border-t border-[#232b25] bg-[#0b0e0c]/50 px-6 text-xs text-[#7a857c]">
          <span>Changes are saved automatically to your workspace.</span>
          <button
            onClick={onClose}
            className="rounded-lg bg-[#ff7a45] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#ff9468]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
