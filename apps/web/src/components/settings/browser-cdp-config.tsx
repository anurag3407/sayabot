"use client"

import { useState } from "react"
import { Globe, Code2, KeyRound, MessageSquare, Monitor, ShieldCheck, Terminal, Zap } from "lucide-react"

export function BrowserCdpConfig() {
  const [activeTab, setActiveTab] = useState<"overview" | "tools" | "vault">("tools")

  const tools = [
    {
      name: "browser_exec(code, language)",
      badge: "High-Level Python / JS",
      icon: Code2,
      description:
        "Executes model-generated Python or JavaScript code snippets using pre-imported browser helpers (page.goto, page.click, page.screenshot, page.evaluate). Returns stdout, logs, and evaluated return values.",
      example: "page.goto('https://github.com')\npage.click('a.HeaderMenu-link--sign-in')\nreturn page.title()",
    },
    {
      name: "browser_cdp(method, params)",
      badge: "Direct Chrome DevTools Protocol",
      icon: Terminal,
      description:
        "Direct low-level JSON-RPC calls to Chrome DevTools Protocol. Full control over DOM inspection, network interception, cookie extraction, emulation overrides, and memory heap tracing.",
      example: 'await cdp("Network.getCookies", { urls: ["https://app.example.com"] })',
    },
    {
      name: "browser_dialog(action, promptText)",
      badge: "Modal Interception",
      icon: MessageSquare,
      description:
        "Intercepts and interacts with JavaScript modal dialogs: window.alert(), window.confirm(), window.prompt(), or beforeunload exit gates.",
      example: 'browser_dialog(action="accept", promptText="Approved by Agent")',
    },
    {
      name: "browser_vault(secret_name, selector)",
      badge: "Zero-Token-Leakage Auto-fill",
      icon: KeyRound,
      description:
        "Safely auto-fills credentials (passwords, API tokens, 2FA codes) into browser input fields without exposing the secret to the model conversation context.",
      example: 'browser_vault(secret_name="PROD_ADMIN_PASSWORD", selector="input[type=password]", submit=True)',
    },
  ]

  return (
    <div className="rounded-lg border border-line bg-raised/20 p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-semibold text-text">Browser Automation & CDP Toolset</h3>
              <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 font-mono text-[10px] text-emerald-400 font-medium">
                Active in "browser" profile
              </span>
            </div>
            <p className="text-[11px] text-muted">
              Drives persistent Chromium instances using Chrome DevTools Protocol (CDP) inside per-agent containers.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 font-mono text-[11px] text-faint">
          <Monitor className="h-3.5 w-3.5 text-accent" />
          <span>computerd :4100</span>
        </div>
      </div>

      {/* Navigation Pills */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setActiveTab("tools")}
          className={`px-3 py-1 rounded text-[12px] font-medium transition-colors ${
            activeTab === "tools"
              ? "bg-raised text-text font-semibold border border-line"
              : "text-muted hover:text-text"
          }`}
        >
          Built-in CDP Tools (4)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("vault")}
          className={`px-3 py-1 rounded text-[12px] font-medium transition-colors ${
            activeTab === "vault"
              ? "bg-raised text-text font-semibold border border-line"
              : "text-muted hover:text-text"
          }`}
        >
          Zero-Token-Leakage Security
        </button>
      </div>

      {/* Tools View */}
      {activeTab === "tools" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {tools.map((tool) => {
            const Icon = tool.icon
            return (
              <div
                key={tool.name}
                className="rounded-md border border-line bg-raised/40 p-3.5 flex flex-col justify-between space-y-2.5"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[12px] font-semibold text-accent flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5" />
                      {tool.name}
                    </span>
                    <span className="font-mono text-[10px] rounded bg-panel px-1.5 py-0.5 text-muted border border-line">
                      {tool.badge}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-muted leading-relaxed">{tool.description}</p>
                </div>

                <div className="rounded bg-void/80 p-2 border border-line/60">
                  <span className="font-mono text-[10px] text-faint block mb-0.5">Example Model Call:</span>
                  <pre className="font-mono text-[11px] text-emerald-400 overflow-x-auto whitespace-pre-wrap select-all">
                    {tool.example}
                  </pre>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Zero Token Leakage Security View */}
      {activeTab === "vault" && (
        <div className="rounded-md border border-line bg-raised/30 p-4 space-y-3">
          <div className="flex items-center gap-2 text-text font-semibold text-[13px]">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            How browser_vault Protects Outbound Credentials
          </div>
          <p className="text-[12px] text-muted leading-relaxed">
            In standard coding agents, if a model needs to log into a staging portal or SaaS product, the
            developer must pass the plaintext password into the prompt context. This risks token leakage to
            the LLM provider and exposes secrets in chat histories.
          </p>
          <div className="grid gap-2 sm:grid-cols-3 pt-1">
            <div className="rounded border border-line bg-void/50 p-3 text-[11px]">
              <b className="text-text block mb-1">1. Encrypted Storage</b>
              Secrets remain sealed at rest with AES-256-GCM in Sayabot's Secret Vault.
            </div>
            <div className="rounded border border-line bg-void/50 p-3 text-[11px]">
              <b className="text-text block mb-1">2. Blind Injection</b>
              Sayabot's computerd daemon injects the decrypted secret directly into the DOM input field.
            </div>
            <div className="rounded border border-line bg-void/50 p-3 text-[11px]">
              <b className="text-text block mb-1">3. Masked Context</b>
              The model only sees:
              <code className="text-emerald-400 block mt-1 font-mono text-[10px]">
                {`{ ok: true, injected: true, selector: "#pass" }`}
              </code>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
