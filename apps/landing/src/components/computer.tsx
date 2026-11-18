"use client"

import { Reveal } from "./reveal"
import { Saya } from "./saya"
import {
  ClaudeLogo,
  CopilotLogo,
  CursorLogo,
  GeminiLogo,
  OpenAiLogo,
  OpenCodeLogo,
} from "./brand-logos"
import { CheckIcon, CloudIcon, LaptopIcon, ServerIcon, TerminalIcon } from "./icons"

export function Computer() {
  return (
    <section className="section" id="computer" aria-labelledby="computer-title">
      <div className="wrap">
        <div className="head-center">
          <Reveal>
            <span className="eyebrow">Computers</span>
            <h2 className="h2" id="computer-title">
              Every agent gets a computer.
            </h2>
            <p className="lede">
              A sandboxed Linux machine per agent, with a <code className="code">/home/bot</code> that
              survives restarts. Run them on your Mac, over SSH, or in isolated Docker containers.
            </p>
          </Reveal>
        </div>

        <div className="sandbox-trio">
          {/* Card 1: Dedicated sandboxes */}
          <Reveal className="sandbox-card" index={0}>
            <div className="sandbox-card-header">
              <span className="sandbox-tag">Execution Runtimes</span>
              <h3 className="sandbox-card-title">Dedicated sandboxes</h3>
              <p className="sandbox-card-sub">
                Your Mac, any remote Linux box over SSH, or ephemeral Docker sandboxes bounded strictly
                to <code className="code">/home/bot</code>.
              </p>
            </div>

            <div className="sandbox-machines">
              {/* Machine 1: Local Mac */}
              <div className="sandbox-box">
                <div className="sandbox-box-header">
                  <LaptopIcon className="sandbox-box-icon" />
                  <span className="sandbox-box-title">MacBook Pro</span>
                  <span className="sandbox-box-badge">This Mac · Local</span>
                </div>
                <div className="sandbox-item">
                  <div className="sandbox-saya-wrap">
                    <Saya shape="block" mood="working" live follow className="sandbox-saya-face" />
                  </div>
                  <div className="sandbox-item-text">
                    <div className="sandbox-item-top">
                      <span className="sandbox-item-name">Block</span>
                      <span className="sandbox-item-role">Engineer</span>
                      <span className="sandbox-item-engine">Claude Code</span>
                    </div>
                    <span className="sandbox-item-detail">Refactored auth migration, opened PR #84</span>
                  </div>
                </div>
                <div className="sandbox-item">
                  <div className="sandbox-saya-wrap">
                    <Saya shape="ghost" mood="waiting" live follow className="sandbox-saya-face" />
                  </div>
                  <div className="sandbox-item-text">
                    <div className="sandbox-item-top">
                      <span className="sandbox-item-name">Saya</span>
                      <span className="sandbox-item-role">Coordinator</span>
                      <span className="sandbox-item-engine">Codex</span>
                    </div>
                    <span className="sandbox-item-detail">Staged staging deploy, waiting on approval</span>
                  </div>
                </div>
              </div>

              {/* Machine 2: SSH Server */}
              <div className="sandbox-box">
                <div className="sandbox-box-header">
                  <ServerIcon className="sandbox-box-icon" />
                  <span className="sandbox-box-title">build-box</span>
                  <span className="sandbox-box-badge">Over SSH · 32 GB RAM</span>
                </div>
                <div className="sandbox-item">
                  <div className="sandbox-saya-wrap">
                    <Saya shape="sprout" mood="working" live follow className="sandbox-saya-face" />
                  </div>
                  <div className="sandbox-item-text">
                    <div className="sandbox-item-top">
                      <span className="sandbox-item-name">Sprout</span>
                      <span className="sandbox-item-role">CI Sentinel</span>
                      <span className="sandbox-item-engine">Gemini CLI</span>
                    </div>
                    <span className="sandbox-item-detail">Running 48 test suites in Docker</span>
                  </div>
                </div>
              </div>

              {/* Machine 3: Cloud VPS */}
              <div className="sandbox-box">
                <div className="sandbox-box-header">
                  <CloudIcon className="sandbox-box-icon" />
                  <span className="sandbox-box-title">cloud-vps</span>
                  <span className="sandbox-box-badge">Docker Daemon · /home/bot</span>
                </div>
                <div className="sandbox-item">
                  <div className="sandbox-saya-wrap">
                    <Saya shape="ledger" mood="thinking" live follow className="sandbox-saya-face" />
                  </div>
                  <div className="sandbox-item-text">
                    <div className="sandbox-item-top">
                      <span className="sandbox-item-name">Ledger</span>
                      <span className="sandbox-item-role">Finance</span>
                      <span className="sandbox-item-engine">Claude Code</span>
                    </div>
                    <span className="sandbox-item-detail">Reconciling 14 March receipts via broker</span>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>

          {/* Card 2: Any agent engine */}
          <Reveal className="sandbox-card" index={1}>
            <div className="sandbox-card-header">
              <span className="sandbox-tag">Model Independence</span>
              <h3 className="sandbox-card-title">Any agent engine</h3>
              <p className="sandbox-card-sub">
                Plug in Claude Code, Codex, Cursor, Gemini CLI, Copilot and 40+ more over MCP with the
                credentials you already have.
              </p>
            </div>

            <div className="sandbox-agent-block">
              <div className="sandbox-agent-bar">
                <span className="sandbox-agent-status">
                  <i className="sandbox-live-dot" /> MCP Gateway Active
                </span>
                <span className="sandbox-agent-spec">Standard CLI + stdio</span>
              </div>

              <div className="sandbox-pills-grid">
                <div className="sandbox-pill">
                  <ClaudeLogo size={16} />
                  <div className="sandbox-pill-text">
                    <strong>Claude Code</strong>
                    <small>Anthropic CLI</small>
                  </div>
                </div>
                <div className="sandbox-pill">
                  <OpenAiLogo size={16} fill="#FFFFFF" />
                  <div className="sandbox-pill-text">
                    <strong>Codex</strong>
                    <small>OpenAI Models</small>
                  </div>
                </div>
                <div className="sandbox-pill">
                  <GeminiLogo size={16} />
                  <div className="sandbox-pill-text">
                    <strong>Gemini CLI</strong>
                    <small>2M Token Context</small>
                  </div>
                </div>
                <div className="sandbox-pill">
                  <CursorLogo size={15} />
                  <div className="sandbox-pill-text">
                    <strong>Cursor</strong>
                    <small>IDE Bridge</small>
                  </div>
                </div>
                <div className="sandbox-pill">
                  <CopilotLogo size={17} />
                  <div className="sandbox-pill-text">
                    <strong>Copilot</strong>
                    <small>GitHub Engine</small>
                  </div>
                </div>
                <div className="sandbox-pill">
                  <OpenCodeLogo size={16} />
                  <div className="sandbox-pill-text">
                    <strong>OpenCode</strong>
                    <small>Local & Ollama</small>
                  </div>
                </div>
              </div>

              <div className="sandbox-agent-foot">
                <TerminalIcon className="sandbox-foot-icon" />
                <span>+ 40 more over standard Model Context Protocol</span>
              </div>
            </div>
          </Reveal>

          {/* Card 3: Free & Open Source */}
          <Reveal className="sandbox-card" index={2}>
            <div className="sandbox-card-header">
              <span className="sandbox-tag">Zero Markup</span>
              <h3 className="sandbox-card-title">Your subscription</h3>
              <p className="sandbox-card-sub">
                Sayabot has zero token markup, zero per-seat fees, and zero vendor lock-in. Pay your
                model provider directly.
              </p>
            </div>

            <div className="sandbox-sub-card">
              <div className="sandbox-sub-badge">AGPL-3.0 Open Source</div>
              <div className="sandbox-sub-price-row">
                <span className="sandbox-sub-price">$0</span>
                <span className="sandbox-sub-period">/ forever</span>
              </div>
              <div className="sandbox-sub-desc">
                For Sayabot core, desktop, web, and all features included.
              </div>

              <div className="sandbox-sub-items">
                <div className="sandbox-sub-item">
                  <div className="sandbox-sub-icon">
                    <ClaudeLogo size={18} />
                  </div>
                  <div className="sandbox-sub-item-text">
                    <strong>Claude Pro / API</strong>
                    <small>Billed directly to Anthropic</small>
                  </div>
                </div>
                <div className="sandbox-sub-item">
                  <div className="sandbox-sub-icon">
                    <OpenAiLogo size={18} fill="#18181b" />
                  </div>
                  <div className="sandbox-sub-item-text">
                    <strong>ChatGPT Plus / API</strong>
                    <small>Billed directly to OpenAI</small>
                  </div>
                </div>
                <div className="sandbox-sub-item">
                  <div className="sandbox-sub-icon">
                    <ServerIcon className="sandbox-sub-cloud-icon" />
                  </div>
                  <div className="sandbox-sub-item-text">
                    <strong>Your Own Hardware / VPS</strong>
                    <small>Self-host on your server, $0 fee</small>
                  </div>
                </div>
              </div>

              <div className="sandbox-sub-assurances">
                <span>
                  <CheckIcon className="sandbox-check-icon" /> Envelope-encrypted keys (AES-256)
                </span>
                <span>
                  <CheckIcon className="sandbox-check-icon" /> Free self-hosting on Docker
                </span>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
