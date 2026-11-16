import type { Metadata } from "next"
import { headers } from "next/headers"
import { ArrowDownToLine, CheckCircle2, Terminal, ArrowRight, Server } from "lucide-react"
import { CopyButton } from "@/components/copy-button"
import { MacDownload } from "@/components/public/mac-download"
import { PublicShell } from "@/components/public/public-shell"
import { Mascot } from "@/components/ui/mascot"
import { AppleIcon, AndroidIcon, WindowsIcon } from "@/components/landing/brand-icons"
import { DOWNLOADS } from "@/components/landing/content"
import { edition, instanceName } from "@/lib/env"
import { getPublicOrigin, needsServerAddress } from "@/lib/public-origin"

const SELF_HOSTING_DOCS =
  "https://github.com/anurag3407/sayabot/blob/main/docs/self-hosting-quickstart.md"

/** This server's public address, for the "connect your apps" panel. */
async function thisServer(): Promise<string> {
  const h = await headers()
  return getPublicOrigin(new Request("http://localhost", { headers: h }))
}

export const metadata: Metadata = {
  title: "Download Sayabot for Mac, Windows & Android",
  description:
    "Download Sayabot for macOS (.dmg), Windows (.exe), and Android. Control your autonomous agents from anywhere.",
}

export default async function DownloadPage() {
  const server = await thisServer()
  // The connect panel is for self-hosted servers. On the default server the apps already
  // connect here, so telling people to pick "My own server" and type this address was wrong.
  const selfHosted = edition() === "self-hosted" && needsServerAddress(server)
  const host = server.replace(/^https?:\/\//, "")
  const connectLink = `sayabot://connect?server=${encodeURIComponent(server)}`
  const installCmd = `curl -fsSL ${server}/install-mac.sh | bash`
  const installWindows = `irm ${server}/install-windows.ps1 | iex`

  return (
    <PublicShell>
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 lg:py-20">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">
            Multi-Device Workspace
          </p>
          <h1 className="mt-3 text-4xl font-medium tracking-tight sm:text-5xl text-white">
            Take your agents anywhere.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted">
            Your bots run on your Mac, your Windows PC, or on Sayabot. Chat with them and approve
            what they do from your computer or your phone.
          </p>
        </div>

        {selfHosted ? (
          <section
            aria-labelledby="connect-title"
            className="mx-auto mt-10 max-w-3xl rounded-2xl border border-accent/25 bg-accent/[0.06] p-6"
          >
            <div className="flex items-start gap-3">
              <Server className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <h2 id="connect-title" className="text-base font-medium text-white">
                  Connect your apps to {instanceName()}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  These apps work with this server. Install one, then connect it here: your data
                  stays on this server.
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <a
                    href={connectLink}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-neutral-200"
                  >
                    <AppleIcon className="h-4 w-4" />
                    Open in Sayabot for Mac
                  </a>
                  <a
                    href={connectLink}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
                  >
                    <WindowsIcon className="h-4 w-4" />
                    Open in Sayabot for Windows
                  </a>
                  <div className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                    <span className="font-mono text-[11px] text-faint">server</span>
                    <span className="min-w-0 truncate font-mono text-[13px] text-neutral-200">
                      {host}
                    </span>
                    <CopyButton text={server} />
                  </div>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-faint">
                  On your phone or a fresh Mac install, choose <strong>My own server</strong> and
                  enter <span className="font-mono text-neutral-300">{host}</span>.
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {/* Download Cards */}
        <div className="mt-14 grid gap-8 lg:grid-cols-3">
          {/* macOS Card */}
          <div className="relative rounded-3xl border border-white/10 bg-panel p-8 shadow-xl flex flex-col justify-between overflow-hidden">
            <div className="absolute top-0 right-0 -mr-6 -mt-6 h-32 w-32 rounded-full bg-accent/10 blur-2xl" />

            <div>
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10">
                  <AppleIcon className="h-7 w-7 text-white" />
                </div>
                <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-mono text-accent border border-accent/20">
                  macOS 14+
                </span>
              </div>

              <h2 className="mt-6 text-2xl font-medium text-white">Sayabot for Mac</h2>
              <p className="mt-2 text-sm text-muted leading-relaxed">
                Your bots work with the Claude Code or Codex you already use on your Mac. No API key
                needed, and they ask before doing anything risky.
              </p>

              <ul className="mt-6 space-y-2.5 text-xs text-neutral-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
                  <span>Sign in with Google or GitHub in one click</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
                  <span>Uses your own Claude or ChatGPT subscription</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
                  <span>Same chats and bots as on {host}</span>
                </li>
              </ul>
            </div>

            <div id="install" className="mt-8 scroll-mt-28 border-t border-white/5 pt-6">
              <MacDownload
                armUrl={DOWNLOADS.macArm64}
                intelUrl={DOWNLOADS.macIntel}
                installCmd={installCmd}
              />
            </div>
          </div>

          <div className="relative rounded-3xl border border-white/10 bg-panel p-8 shadow-xl flex flex-col justify-between overflow-hidden">
            <div className="absolute top-0 right-0 -mr-6 -mt-6 h-32 w-32 rounded-full bg-accent/10 blur-2xl" />

            <div>
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10">
                  <WindowsIcon className="h-7 w-7 text-white" />
                </div>
                <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-mono text-accent border border-accent/20">
                  Windows 10+
                </span>
              </div>

              <h2 className="mt-6 text-2xl font-medium text-white">Sayabot for Windows</h2>
              <p className="mt-2 text-sm text-muted leading-relaxed">
                The same controller as the Mac app: sign in, run local agents, and share this PC
                when you allow it.
              </p>

              <ul className="mt-6 space-y-2.5 text-xs text-neutral-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
                  <span>Per-user installer, no admin account required</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
                  <span>Uses the Claude Code or Codex you already have</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
                  <span>Updates itself from this server</span>
                </li>
              </ul>
            </div>

            <div className="mt-8 scroll-mt-28 border-t border-white/5 pt-6 space-y-3">
              <a
                href={DOWNLOADS.winX64}
                download="Sayabot-Setup-x64.exe"
                className="flex items-center justify-center gap-2 w-full rounded-xl bg-white px-5 py-3 text-sm font-medium text-black hover:bg-neutral-200 transition-colors shadow-sm"
              >
                <ArrowDownToLine className="h-4 w-4" />
                <span>Download for Windows</span>
              </a>
              <a
                href={DOWNLOADS.winArm64}
                download="Sayabot-Setup-arm64.exe"
                className="block text-center text-[12px] text-muted underline underline-offset-2 hover:text-white"
              >
                Windows on ARM
              </a>
              <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                <p className="font-mono text-[11px] text-faint">PowerShell</p>
                <p className="mt-1 break-all font-mono text-[12px] text-neutral-200">
                  {installWindows}
                </p>
                <div className="mt-2">
                  <CopyButton text={installWindows} />
                </div>
              </div>
            </div>
          </div>

          {/* Android Card */}
          <div className="relative rounded-3xl border border-white/10 bg-panel p-8 shadow-xl flex flex-col justify-between overflow-hidden">
            <div className="absolute top-0 right-0 -mr-6 -mt-6 h-32 w-32 rounded-full bg-accent/10 blur-2xl" />

            <div>
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10">
                  <AndroidIcon className="h-7 w-7 text-white" />
                </div>
                <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-mono text-accent border border-accent/20">
                  Android 10+
                </span>
              </div>

              <h2 className="mt-6 text-2xl font-medium text-white">Sayabot for Android</h2>
              <p className="mt-2 text-sm text-muted leading-relaxed">
                Chat with your bots and say yes or no to what they want to do, from your phone.
              </p>

              <ul className="mt-6 space-y-2.5 text-xs text-neutral-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
                  <span>Signs into the same account as your Mac</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
                  <span>Approve your bots&apos; actions with one tap</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
                  <span>Works with bots on your Mac or on Sayabot</span>
                </li>
              </ul>
            </div>

            <div className="mt-8 pt-6 border-t border-white/5 space-y-3">
              <a
                href={DOWNLOADS.androidApk}
                download="Sayabot.apk"
                className="flex items-center justify-center gap-2 w-full rounded-xl bg-white px-5 py-3 text-sm font-medium text-black hover:bg-neutral-200 transition-colors shadow-sm"
              >
                <ArrowDownToLine className="h-4 w-4" />
                <span>Download Android APK</span>
              </a>
              <p className="text-center text-[11px] text-faint">
                Direct release install · No Google Play account required
              </p>
            </div>
          </div>
        </div>

        {/* 4-Step How It Works Banner */}
        <div className="mt-16 rounded-3xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-8 sm:p-10">
          <div className="flex items-center gap-3">
            <Mascot seed="Pip" blink lit mood="alert" className="h-10 w-10" />
            <h3 className="text-xl font-medium text-white">How the Connected Flow Works</h3>
          </div>

          <div className="mt-8 grid gap-6 sm:grid-cols-4">
            <div className="space-y-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 border border-accent/20 text-xs font-mono font-medium text-accent">
                1
              </span>
              <h4 className="text-sm font-medium text-white">Install the desktop app</h4>
              <p className="text-xs text-muted leading-relaxed">
                On a Mac, paste the Terminal command. On Windows, run the PowerShell command or open
                the setup exe.
              </p>
            </div>

            <div className="space-y-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 border border-accent/20 text-xs font-mono font-medium text-accent">
                2
              </span>
              <h4 className="text-sm font-medium text-white">Sign In with Google</h4>
              <p className="text-xs text-muted leading-relaxed">
                Click Sign In in the Mac app. Your browser opens, and Supabase safely passes back
                your session tokens.
              </p>
            </div>

            <div className="space-y-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 border border-accent/20 text-xs font-mono font-medium text-accent">
                3
              </span>
              <h4 className="text-sm font-medium text-white">Install Phone APK</h4>
              <p className="text-xs text-muted leading-relaxed">
                Install the APK on Android and log in with the exact same Google or GitHub account.
              </p>
            </div>

            <div className="space-y-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 border border-accent/20 text-xs font-mono font-medium text-accent">
                4
              </span>
              <h4 className="text-sm font-medium text-white">Control 24/7</h4>
              <p className="text-xs text-muted leading-relaxed">
                Control tasks on your Mac while it is open, or deploy on your VPS so agents work
                24/7 even when your Mac sleeps!
              </p>
            </div>
          </div>
        </div>

        {/* Self-hosting callout */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-white/5 bg-white/[0.02] px-6 py-5">
          <div className="flex items-center gap-3">
            <Terminal className="h-5 w-5 text-accent shrink-0" />
            <p className="text-xs text-neutral-300">
              Want to self-host Sayabot backend on your private VPS with Docker?
            </p>
          </div>
          <a
            href={SELF_HOSTING_DOCS}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs font-medium text-accent hover:text-[var(--color-accent-strong)] transition-colors"
          >
            <span>Self-host in 10 minutes</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </PublicShell>
  )
}
