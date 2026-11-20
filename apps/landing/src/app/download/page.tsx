import type { Metadata } from "next"
import { DOWNLOADS, LINKS } from "@/lib/links"
import { Nav } from "@/components/nav"
import { Footer } from "@/components/footer"
import {
  AppleIcon,
  WindowsIcon,
  AndroidIcon,
  GlobeIcon,
  DownloadIcon,
  GitHubIcon,
  ArrowUpRight,
  ServerIcon,
} from "@/components/icons"
import { DownloadButton } from "@/components/download-button"

export const metadata: Metadata = {
  title: "Download Sayabot · Mac, Windows & Android APK",
  description:
    "Official downloads for Sayabot. Native macOS DMGs (Apple Silicon & Intel), Windows installers (x64 & ARM64), and direct Android APK. Connect to your autonomous AI agents from any device.",
  alternates: {
    canonical: "https://sayabot.tech/download",
  },
}

const MAC_INSTALL_CMD = "curl -fsSL https://sayabot.sayalabs.in/install-mac.sh | bash"
const WIN_INSTALL_CMD = "irm https://sayabot.sayalabs.in/install-windows.ps1 | iex"

export default function DownloadPage() {
  return (
    <>
      <Nav />
      <main className="download-page">
        {/* Hero Section */}
        <section className="section download-hero" aria-labelledby="dl-hero-title">
          <div className="wrap">
            <div className="head-center">
              <span className="eyebrow">Official Downloads · v1.0.0</span>
              <h1 className="h1" id="dl-hero-title">
                Sayabot on every device.
              </h1>
              <p className="lede">
                Native desktop companions for your Mac and PC, instant pocket approvals with the Android APK,
                or launch immediately in your web browser.
              </p>
              <div className="download-hero-cta" style={{ marginTop: "24px", display: "flex", justifyContent: "center" }}>
                <DownloadButton />
              </div>
            </div>

            {/* Platform Grid */}
            <div className="dls" style={{ marginTop: "48px" }}>
              {/* macOS */}
              <div className="dl-card card" style={{ position: "relative", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <AppleIcon className="dl-card-icon" />
                  <span className="badge" style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "99px", background: "rgba(157, 140, 255, 0.15)", color: "var(--accent)" }}>
                    macOS 14+
                  </span>
                </div>
                <h2 style={{ fontSize: "22px", fontWeight: 600, marginTop: "16px" }}>macOS</h2>
                <p>Native controller for Apple Silicon and Intel. Run local agents and manage danger approvals.</p>

                <div className="dl-card-links" style={{ marginTop: "20px" }}>
                  <a
                    className="btn btn-primary btn-sm"
                    href={DOWNLOADS.macArm.href}
                    download={DOWNLOADS.macArm.file}
                  >
                    <DownloadIcon /> Apple Silicon (M1–M4)
                  </a>
                  <a
                    className="btn btn-ghost btn-sm"
                    href={DOWNLOADS.macIntel.href}
                    download={DOWNLOADS.macIntel.file}
                  >
                    Intel (x64)
                  </a>
                </div>

                <div style={{ marginTop: "20px", padding: "12px", background: "var(--surface)", borderRadius: "14px", border: "1px solid var(--line)" }}>
                  <div style={{ fontSize: "11px", color: "var(--faint)", marginBottom: "6px", fontFamily: "var(--mono)" }}>Terminal Install</div>
                  <code style={{ fontSize: "11px", color: "var(--text)", wordBreak: "break-all", fontFamily: "var(--mono)" }}>
                    {MAC_INSTALL_CMD}
                  </code>
                </div>
                <small style={{ marginTop: "14px", display: "block" }}>Universal DMG · Notarized for macOS</small>
              </div>

              {/* Windows */}
              <div className="dl-card card" style={{ position: "relative", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <WindowsIcon className="dl-card-icon" />
                  <span className="badge" style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "99px", background: "rgba(157, 140, 255, 0.15)", color: "var(--accent)" }}>
                    Windows 10/11
                  </span>
                </div>
                <h2 style={{ fontSize: "22px", fontWeight: 600, marginTop: "16px" }}>Windows</h2>
                <p>Full desktop app for PC. Uses your existing Claude Code and Codex subscriptions.</p>

                <div className="dl-card-links" style={{ marginTop: "20px" }}>
                  <a
                    className="btn btn-primary btn-sm"
                    href={DOWNLOADS.winX64.href}
                    download={DOWNLOADS.winX64.file}
                  >
                    <DownloadIcon /> Windows x64 (.exe)
                  </a>
                  <a
                    className="btn btn-ghost btn-sm"
                    href={DOWNLOADS.winArm.href}
                    download={DOWNLOADS.winArm.file}
                  >
                    ARM64 (.exe)
                  </a>
                </div>

                <div style={{ marginTop: "20px", padding: "12px", background: "var(--surface)", borderRadius: "14px", border: "1px solid var(--line)" }}>
                  <div style={{ fontSize: "11px", color: "var(--faint)", marginBottom: "6px", fontFamily: "var(--mono)" }}>PowerShell Install</div>
                  <code style={{ fontSize: "11px", color: "var(--text)", wordBreak: "break-all", fontFamily: "var(--mono)" }}>
                    {WIN_INSTALL_CMD}
                  </code>
                </div>
                <small style={{ marginTop: "14px", display: "block" }}>Per-user NSIS setup · No admin required</small>
              </div>

              {/* Android APK */}
              <div className="dl-card card" style={{ position: "relative", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <AndroidIcon className="dl-card-icon" />
                  <span className="badge" style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "99px", background: "rgba(111, 211, 154, 0.15)", color: "var(--green)" }}>
                    Android 7+ · APK
                  </span>
                </div>
                <h2 style={{ fontSize: "22px", fontWeight: 600, marginTop: "16px" }}>Android APK</h2>
                <p>Stay in control on the go. Instant push alerts, dangerous tool yes/no, and offline SQLite sync.</p>

                <div className="dl-card-links" style={{ marginTop: "20px" }}>
                  <a
                    className="btn btn-primary btn-sm"
                    href={DOWNLOADS.android.href}
                    download={DOWNLOADS.android.file}
                  >
                    <DownloadIcon /> Download Sayabot.apk
                  </a>
                </div>

                {/* Mobile QR Code Scanner Box */}
                <div style={{ marginTop: "20px", padding: "14px", background: "var(--surface)", borderRadius: "14px", border: "1px solid var(--line)", display: "flex", gap: "12px", alignItems: "center" }}>
                  <div style={{ background: "#ffffff", padding: "6px", borderRadius: "8px", flexShrink: 0 }}>
                    <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#09090b" strokeWidth="1.5">
                      <rect x="2" y="2" width="8" height="8" rx="1" />
                      <rect x="14" y="2" width="8" height="8" rx="1" />
                      <rect x="2" y="14" width="8" height="8" rx="1" />
                      <rect x="5" y="5" width="2" height="2" fill="#09090b" />
                      <rect x="17" y="5" width="2" height="2" fill="#09090b" />
                      <rect x="5" y="17" width="2" height="2" fill="#09090b" />
                      <path d="M14 14h2v2h-2zM18 14h4v2h-4zM14 18h2v4h-2zM18 18h2v2h-2zM20 20h2v2h-2z" fill="#09090b" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>Scan from phone</div>
                    <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                      Direct release APK. Auto-updates in background.
                    </div>
                  </div>
                </div>
                <small style={{ marginTop: "14px", display: "block" }}>Direct APK download · No Play Store required</small>
              </div>

              {/* Web App */}
              <div className="dl-card card" style={{ position: "relative", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <GlobeIcon className="dl-card-icon" />
                  <span className="badge" style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "99px", background: "rgba(157, 140, 255, 0.15)", color: "var(--accent)" }}>
                    Zero Install
                  </span>
                </div>
                <h2 style={{ fontSize: "22px", fontWeight: 600, marginTop: "16px" }}>Web Application</h2>
                <p>Collaborative multiplayer room workspace, real-time Monaco canvas, and voice agent rooms.</p>

                <div className="dl-card-links" style={{ marginTop: "20px" }}>
                  <a className="btn btn-primary btn-sm" href={LINKS.app}>
                    Open in Browser <ArrowUpRight />
                  </a>
                  <a className="btn btn-ghost btn-sm" href={LINKS.signup}>
                    Create Account
                  </a>
                </div>

                <div style={{ marginTop: "20px", padding: "12px", background: "var(--surface)", borderRadius: "14px", border: "1px solid var(--line)" }}>
                  <div style={{ fontSize: "11px", color: "var(--faint)", marginBottom: "4px" }}>Supported Browsers</div>
                  <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                    Chrome, Safari, Firefox, Microsoft Edge, Arc, Brave
                  </div>
                </div>
                <small style={{ marginTop: "14px", display: "block" }}>Works on tablet, Chromebook &amp; desktop</small>
              </div>
            </div>

            {/* Comparison Matrix */}
            <div style={{ marginTop: "64px" }}>
              <div className="head-center">
                <span className="eyebrow">Platform Capabilities</span>
                <h2 className="h2">Feature comparison across clients</h2>
              </div>

              <div className="card" style={{ marginTop: "32px", overflowX: "auto", padding: "0" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13.5px", textAlign: "left" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--line)", background: "var(--raised)" }}>
                      <th style={{ padding: "16px 20px", color: "var(--text)" }}>Capability</th>
                      <th style={{ padding: "16px 20px", color: "var(--accent)" }}>macOS Desktop</th>
                      <th style={{ padding: "16px 20px", color: "var(--accent)" }}>Windows Desktop</th>
                      <th style={{ padding: "16px 20px", color: "var(--green)" }}>Android APK</th>
                      <th style={{ padding: "16px 20px", color: "var(--text)" }}>Web App</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "14px 20px", fontWeight: 500 }}>Local Agent Runner (Claude/Codex/Ollama)</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ Native</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ Native</td>
                      <td style={{ padding: "14px 20px", color: "var(--faint)" }}>— Cloud/VPS</td>
                      <td style={{ padding: "14px 20px", color: "var(--faint)" }}>— Cloud/VPS</td>
                    </tr>
                    <tr style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "14px 20px", fontWeight: 500 }}>Danger Tool Approvals &amp; Asks</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ Desktop notify</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ Desktop notify</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ One-tap Push</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ Browser alerts</td>
                    </tr>
                    <tr style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "14px 20px", fontWeight: 500 }}>Multi-Agent Turn Coordination</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ Synced</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ Synced</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ Synced</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ Synced</td>
                    </tr>
                    <tr style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "14px 20px", fontWeight: 500 }}>Collaborative Monaco Canvas</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ Full</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ Full</td>
                      <td style={{ padding: "14px 20px", color: "var(--muted)" }}>Preview only</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ Full</td>
                    </tr>
                    <tr style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "14px 20px", fontWeight: 500 }}>Voice Rooms &amp; Live Audio</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ Native Mic</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ WebRTC</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "14px 20px", fontWeight: 500 }}>Offline Turn History &amp; Cache</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ File JSON</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ File JSON</td>
                      <td style={{ padding: "14px 20px", color: "var(--green)" }}>✓ SQLite</td>
                      <td style={{ padding: "14px 20px", color: "var(--muted)" }}>IndexedDB</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Self-Host Banner */}
            <div className="oss card" style={{ marginTop: "64px" }}>
              <div className="oss-copy">
                <ServerIcon className="oss-icon" />
                <h3>Host your own Sayabot server</h3>
                <p>
                  Deploy the complete backend on your VPS or Kubernetes cluster with Docker. Point the macOS,
                  Windows, and Android apps directly to your server address.
                </p>
                <div className="oss-links" style={{ marginTop: "16px" }}>
                  <a className="btn btn-ghost btn-sm" href={LINKS.github} target="_blank" rel="noreferrer">
                    <GitHubIcon /> GitHub AGPL-3.0
                  </a>
                  <a className="link" href={LINKS.selfHost} target="_blank" rel="noreferrer">
                    Self-Hosting Guide
                  </a>
                </div>
              </div>
              <pre className="oss-term mono" aria-label="Terminal commands">
                <span className="dim"># Run anywhere with Docker &amp; pnpm</span>
                {"\n"}git clone https://github.com/anurag3407/sayabot.git
                {"\n"}cd sayabot && pnpm install
                {"\n"}pnpm db:migrate && pnpm db:seed
                {"\n"}pnpm dev
              </pre>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
