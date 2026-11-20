"use client"

import { useEffect, useState } from "react"
import { DOWNLOADS, LINKS } from "@/lib/links"
import { AppleIcon, ServerIcon, GitHubIcon, ChevronDown, SparkIcon, ArrowUpRight } from "./icons"

export function LaunchBanner() {
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // Allow closing with Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        setOpen(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open])

  if (dismissed) return null

  return (
    <div
      className={`launch-banner-root ${open ? "is-open" : ""}`}
      role="region"
      aria-label="Announcement banner"
    >
      <div className="launch-bar">
        <div className="wrap launch-bar-inner">
          <div className="launch-badge">
            <span className="launch-pulse-dot" />
            <span className="launch-badge-text">v1.0 Launch</span>
          </div>

          <p className="launch-tagline">
            <span className="launch-tagline-main">Open-source remote AI agent workspace.</span>
            <span className="launch-tagline-sub">
              {" "}
              Persistent Linux sandboxes, multi-agent turns &amp; sealed secrets.
            </span>
          </p>

          <div className="launch-actions">
            <button
              type="button"
              className="launch-hub-trigger"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-controls="launch-hub-panel"
            >
              <span>{open ? "Close Launch Hub" : "Quick Links & Downloads"}</span>
              <ChevronDown className={`launch-hub-chevron ${open ? "is-rotated" : ""}`} />
            </button>

            <a
              href={LINKS.github}
              target="_blank"
              rel="noreferrer"
              className="launch-star-link"
              aria-label="Star Sayabot on GitHub"
            >
              <GitHubIcon className="launch-star-icon" />
              <span>Star</span>
            </a>

            <button
              type="button"
              className="launch-dismiss-btn"
              onClick={() => {
                setDismissed(true)
                setOpen(false)
              }}
              aria-label="Dismiss banner"
              title="Dismiss banner"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div
          id="launch-hub-panel"
          className="launch-hub-drawer"
          aria-label="Launch resources matrix"
        >
          <div className="wrap launch-hub-content">
            <div className="launch-hub-header">
              <div>
                <h3 className="launch-hub-title">Sayabot 1.0 Release Ecosystem</h3>
                <p className="launch-hub-sub">
                  Production binaries, architecture specs, and open-source documentation.
                </p>
              </div>
              <button
                type="button"
                className="launch-hub-close-text"
                onClick={() => setOpen(false)}
              >
                Press <kbd>Esc</kbd> or click to close
              </button>
            </div>

            <div className="launch-hub-grid">
              {/* Column 1: Native Apps */}
              <div className="launch-hub-col">
                <div className="launch-col-title">
                  <AppleIcon className="launch-col-icon" />
                  <span>Native Apps &amp; Clients</span>
                </div>
                <ul className="launch-link-list">
                  <li>
                    <a href={DOWNLOADS.macArm.href} onClick={() => setOpen(false)}>
                      <span className="launch-link-name">macOS (Apple Silicon)</span>
                      <span className="launch-link-tag">.dmg</span>
                    </a>
                  </li>
                  <li>
                    <a href={DOWNLOADS.macIntel.href} onClick={() => setOpen(false)}>
                      <span className="launch-link-name">macOS (Intel Core)</span>
                      <span className="launch-link-tag">.dmg</span>
                    </a>
                  </li>
                  <li>
                    <a href={DOWNLOADS.winX64.href} onClick={() => setOpen(false)}>
                      <span className="launch-link-name">Windows (x64 / ARM64)</span>
                      <span className="launch-link-tag">.exe</span>
                    </a>
                  </li>
                  <li>
                    <a href={DOWNLOADS.android.href} onClick={() => setOpen(false)}>
                      <span className="launch-link-name">Android Companion</span>
                      <span className="launch-link-tag">.apk</span>
                    </a>
                  </li>
                  <li>
                    <a href={LINKS.app} onClick={() => setOpen(false)}>
                      <span className="launch-link-name">Web App Console</span>
                      <span className="launch-link-tag">Browser</span>
                    </a>
                  </li>
                </ul>
              </div>

              {/* Column 2: Architecture Highlights */}
              <div className="launch-hub-col">
                <div className="launch-col-title">
                  <SparkIcon className="launch-col-icon" />
                  <span>Key Innovations</span>
                </div>
                <ul className="launch-feature-list">
                  <li>
                    <strong>Persistent Sandboxes:</strong> Isolated Linux Docker compute daemon
                    (`computerd`) bounded strictly to `/home/bot`.
                  </li>
                  <li>
                    <strong>Postgres Advisory Locks:</strong> Deterministic turn serialization per
                    room with zero state clobbering.
                  </li>
                  <li>
                    <strong>Envelope Encryption:</strong> AES-256-GCM zero-plaintext secrets vault
                    (`MESH_KEK`).
                  </li>
                  <li>
                    <strong>Human Danger Gates:</strong> Dangerous mutations wait for explicit
                    operator yes.
                  </li>
                </ul>
              </div>

              {/* Column 3: Guides & Docs */}
              <div className="launch-hub-col">
                <div className="launch-col-title">
                  <ServerIcon className="launch-col-icon" />
                  <span>Deployment &amp; Specs</span>
                </div>
                <ul className="launch-link-list">
                  <li>
                    <a href={LINKS.selfHost}>
                      <span className="launch-link-name">Docker Self-Hosting</span>
                    </a>
                  </li>
                  <li>
                    <a href={LINKS.docs} target="_blank" rel="noreferrer">
                      <span className="launch-link-name">Architecture Reference</span>
                      <ArrowUpRight className="launch-ext-icon" />
                    </a>
                  </li>
                  <li>
                    <a
                      href={`${LINKS.github}/blob/main/AGENTS.md`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="launch-link-name">AGENTS.md Operational Spec</span>
                      <ArrowUpRight className="launch-ext-icon" />
                    </a>
                  </li>
                  <li>
                    <a href="#features" onClick={() => setOpen(false)}>
                      <span className="launch-link-name">Bring-Your-Own-Model Setup</span>
                      <span className="launch-link-tag">Claude / GPT</span>
                    </a>
                  </li>
                </ul>
              </div>

              {/* Column 4: Community & Source */}
              <div className="launch-hub-col">
                <div className="launch-col-title">
                  <GitHubIcon className="launch-col-icon" />
                  <span>Community &amp; Source</span>
                </div>
                <ul className="launch-link-list">
                  <li>
                    <a href={LINKS.github} target="_blank" rel="noreferrer">
                      <span className="launch-link-name">GitHub Repository</span>
                      <span className="launch-link-tag">AGPL-3.0</span>
                    </a>
                  </li>
                  <li>
                    <a href={LINKS.releases} target="_blank" rel="noreferrer">
                      <span className="launch-link-name">v1.0.0 Release Notes</span>
                      <ArrowUpRight className="launch-ext-icon" />
                    </a>
                  </li>
                  <li>
                    <a href={LINKS.issues} target="_blank" rel="noreferrer">
                      <span className="launch-link-name">Report Issue or Request Feature</span>
                      <ArrowUpRight className="launch-ext-icon" />
                    </a>
                  </li>
                  <li>
                    <a href="https://sayalabs.in" target="_blank" rel="noreferrer">
                      <span className="launch-link-name">Built by Sayalabs Studio</span>
                      <ArrowUpRight className="launch-ext-icon" />
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
