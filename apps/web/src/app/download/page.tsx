import type { Metadata } from "next"
import Link from "next/link"
import { ArrowDownToLine, CheckCircle2, Cpu, Smartphone, Laptop, ShieldCheck, Terminal, Globe, ArrowRight } from "lucide-react"
import { PublicShell } from "@/components/public/public-shell"
import { Mascot } from "@/components/ui/mascot"
import { Button } from "@/components/ui/button"
import { AppleIcon, AndroidIcon } from "@/components/landing/brand-icons"
import { DOWNLOADS } from "@/components/landing/content"

export const metadata: Metadata = {
  title: "Download Sayabot for Mac & Android",
  description: "Download Sayabot native macOS app (.dmg) and Android APK. Control your autonomous agents from anywhere.",
}

export default function DownloadPage() {
  return (
    <PublicShell>
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 lg:py-20">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto">
          <p className="font-mono text-xs uppercase tracking-widest text-emerald-400">Multi-Device Workspace</p>
          <h1 className="mt-3 text-4xl font-medium tracking-tight sm:text-5xl text-white">
            Take your agents anywhere.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-neutral-400">
            Run autonomous turns on your Mac or VPS, and monitor, chat, or approve actions directly from your Android phone with unified Google or GitHub sign-in.
          </p>
        </div>

        {/* Download Cards */}
        <div className="mt-14 grid gap-8 sm:grid-cols-2">
          {/* macOS Card */}
          <div className="relative rounded-3xl border border-white/10 bg-[#0f130f] p-8 shadow-xl flex flex-col justify-between overflow-hidden">
            <div className="absolute top-0 right-0 -mr-6 -mt-6 h-32 w-32 rounded-full bg-emerald-500/10 blur-2xl" />
            
            <div>
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10">
                  <AppleIcon className="h-7 w-7 text-white" />
                </div>
                <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-mono text-emerald-400 border border-emerald-500/20">
                  macOS 14+
                </span>
              </div>

              <h2 className="mt-6 text-2xl font-medium text-white">Sayabot for Mac</h2>
              <p className="mt-2 text-sm text-neutral-400 leading-relaxed">
                Native macOS workspace with built-in agent runner, terminal sandboxes, and deep-link OAuth integration.
              </p>

              <ul className="mt-6 space-y-2.5 text-xs text-neutral-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>1-click Google or GitHub sign-in (sayabot://)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>Local terminal & computer use via computerd</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>Real-time sync with sayabot.sayalabs.in</span>
                </li>
              </ul>
            </div>

            <div className="mt-8 pt-6 border-t border-white/5 space-y-3">
              <a
                href={DOWNLOADS.macArm64}
                className="flex items-center justify-center gap-2 w-full rounded-xl bg-white px-5 py-3 text-sm font-medium text-black hover:bg-neutral-200 transition-colors shadow-sm"
              >
                <ArrowDownToLine className="h-4 w-4" />
                <span>Download DMG (Apple Silicon M1-M4)</span>
              </a>
              <a
                href={DOWNLOADS.macIntel}
                className="flex items-center justify-center gap-2 w-full rounded-xl bg-white/5 px-5 py-2.5 text-xs font-medium text-neutral-300 hover:bg-white/10 border border-white/10 transition-colors"
              >
                <span>Download DMG (Intel Macs)</span>
              </a>
            </div>
          </div>

          {/* Android Card */}
          <div className="relative rounded-3xl border border-white/10 bg-[#0f130f] p-8 shadow-xl flex flex-col justify-between overflow-hidden">
            <div className="absolute top-0 right-0 -mr-6 -mt-6 h-32 w-32 rounded-full bg-emerald-500/10 blur-2xl" />

            <div>
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10">
                  <AndroidIcon className="h-7 w-7 text-white" />
                </div>
                <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-mono text-emerald-400 border border-emerald-500/20">
                  Android 10+
                </span>
              </div>

              <h2 className="mt-6 text-2xl font-medium text-white">Sayabot for Android</h2>
              <p className="mt-2 text-sm text-neutral-400 leading-relaxed">
                Pocket control center to review agent proposals, approve bash executions, and chat from your phone.
              </p>

              <ul className="mt-6 space-y-2.5 text-xs text-neutral-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>Signs into the same account as your Mac</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>1-tap tool and shell approvals on the go</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>Works with both Mac-hosted & VPS-hosted agents</span>
                </li>
              </ul>
            </div>

            <div className="mt-8 pt-6 border-t border-white/5 space-y-3">
              <a
                href={DOWNLOADS.androidApk}
                className="flex items-center justify-center gap-2 w-full rounded-xl bg-white px-5 py-3 text-sm font-medium text-black hover:bg-neutral-200 transition-colors shadow-sm"
              >
                <ArrowDownToLine className="h-4 w-4" />
                <span>Download Android APK</span>
              </a>
              <p className="text-center text-[11px] text-neutral-500">
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
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-mono font-medium text-emerald-400">
                1
              </span>
              <h4 className="text-sm font-medium text-white">Install Mac App</h4>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Open the downloaded DMG on your Mac and drag Sayabot into Applications.
              </p>
            </div>

            <div className="space-y-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-mono font-medium text-emerald-400">
                2
              </span>
              <h4 className="text-sm font-medium text-white">Sign In with Google</h4>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Click Sign In in the Mac app. Your browser opens, and Supabase safely passes back your session tokens.
              </p>
            </div>

            <div className="space-y-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-mono font-medium text-emerald-400">
                3
              </span>
              <h4 className="text-sm font-medium text-white">Install Phone APK</h4>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Install the APK on Android and log in with the exact same Google or GitHub account.
              </p>
            </div>

            <div className="space-y-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-mono font-medium text-emerald-400">
                4
              </span>
              <h4 className="text-sm font-medium text-white">Control 24/7</h4>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Control tasks on your Mac while it is open, or deploy on your VPS so agents work 24/7 even when your Mac sleeps!
              </p>
            </div>
          </div>
        </div>

        {/* Self-hosting callout */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-white/5 bg-white/[0.02] px-6 py-5">
          <div className="flex items-center gap-3">
            <Terminal className="h-5 w-5 text-emerald-400 shrink-0" />
            <p className="text-xs text-neutral-300">
              Want to self-host Sayabot backend on your private VPS with Docker?
            </p>
          </div>
          <Link
            href="/help"
            className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            <span>Read Self-Hosting Docs</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </PublicShell>
  )
}
