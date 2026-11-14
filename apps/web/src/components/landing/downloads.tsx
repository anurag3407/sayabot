"use client"

import { useState, type ComponentType } from "react"
import { ArrowDownToLine, Check, FolderOpen, ArrowRight } from "lucide-react"
import Link from "next/link"
import { Mascot } from "@/components/ui/mascot"
import { SectionHead } from "./section-head"
import { AndroidIcon, AppleIcon, WindowsIcon } from "./brand-icons"
import { DOWNLOADS } from "./content"

const SOON: { name: string; icon: ComponentType<{ className?: string }> }[] = [
  { name: "Native Windows .exe", icon: WindowsIcon },
  { name: "Linux AppImage", icon: WindowsIcon },
  { name: "Google Play Store", icon: AndroidIcon },
]

export function Downloads() {
  const [macDownloaded, setMacDownloaded] = useState(false)
  const [androidDownloaded, setAndroidDownloaded] = useState(false)

  return (
    <section id="download" className="l-section">
      <div className="l-container">
        <SectionHead center label="Download" title="Take your team with you." />

        <div className="mt-20 grid gap-16 sm:grid-cols-2 sm:gap-4">
          {/* macOS Card */}
          <div
            data-reveal
            className="group relative block"
          >
            <div
              data-tilt
              className="relative flex flex-col justify-between rounded-[26px] p-7 text-[#15121a] shadow-[inset_0_1px_0_rgb(255_255_255/0.5),0_40px_70px_-34px_rgb(0_0_0/0.95)] sm:p-9 min-h-[380px]"
              style={{ background: "linear-gradient(165deg,#ecdfff,#c6a3ee)" }}
            >
              <Mascot
                seed="Pip"
                blink
                shadow
                className="absolute -top-12 right-8 h-24 w-24 transition-transform duration-500 ease-out group-hover:-translate-y-3 group-hover:rotate-6"
              />
              <div>
                <AppleIcon className="h-11 w-11" />
                <span className="mt-16 block text-[clamp(2.25rem,4.4vw,3.25rem)] font-medium leading-none tracking-[-0.04em]">
                  Sayabot for Mac
                </span>
                <span className="mt-2.5 block text-[14px] opacity-70">
                  Native macOS .dmg with deep-link OAuth & local computer use
                </span>
              </div>

              <div className="mt-8 space-y-3.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <a
                    href={DOWNLOADS.macArm64}
                    download="Sayabot-arm64.dmg"
                    onClick={() => {
                      setMacDownloaded(true)
                      setTimeout(() => setMacDownloaded(false), 9000)
                    }}
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-[#15121a] px-5 text-[14px] font-medium text-white shadow-md hover:bg-neutral-800 transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                    {macDownloaded ? (
                      <Check className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <ArrowDownToLine className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
                    )}
                    <span>{macDownloaded ? "Downloading DMG..." : "Download Mac App (.dmg)"}</span>
                  </a>

                  <a
                    href={DOWNLOADS.macIntel}
                    download="Sayabot-x64.dmg"
                    className="inline-flex h-11 items-center gap-1.5 rounded-full border border-black/15 bg-white/40 px-3.5 text-[12px] font-medium text-[#15121a] hover:bg-white/70 transition-colors"
                    title="Download for Intel Macs (x64)"
                  >
                    <span>Intel Mac (.dmg)</span>
                  </a>
                </div>

                {/* macOS Installation Flow Indicator */}
                {macDownloaded ? (
                  <div className="rounded-xl bg-black/10 p-2.5 text-xs text-[#15121a] animate-in fade-in slide-in-from-top-1 duration-300">
                    <p className="font-medium flex items-center gap-1.5 text-emerald-900">
                      <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>Download started! Next step:</span>
                    </p>
                    <p className="mt-1 text-[11px] opacity-80 pl-5">
                      Open <strong>Sayabot-arm64.dmg</strong> in Downloads and drag <strong>Sayabot</strong> into your <strong>Applications</strong> folder.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#15121a]/80">
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-black/10 px-2.5 py-1 text-[11px] font-medium">
                      <FolderOpen className="h-3.5 w-3.5 opacity-70" />
                      Move to Applications to install
                    </span>
                    <span className="text-[11px] opacity-60">· macOS 14+ (M1–M4 & Intel)</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Android Card */}
          <div
            data-reveal
            className="group relative block"
          >
            <div
              data-tilt
              className="relative flex flex-col justify-between rounded-[26px] p-7 text-[#15121a] shadow-[inset_0_1px_0_rgb(255_255_255/0.5),0_40px_70px_-34px_rgb(0_0_0/0.95)] sm:p-9 min-h-[380px]"
              style={{ background: "linear-gradient(165deg,#ffe1cf,#ef9f7f)" }}
            >
              <Mascot
                seed="Juno"
                blink
                shadow
                className="absolute -top-12 right-8 h-24 w-24 transition-transform duration-500 ease-out group-hover:-translate-y-3 group-hover:rotate-6"
              />
              <div>
                <AndroidIcon className="h-11 w-11" />
                <span className="mt-16 block text-[clamp(2.25rem,4.4vw,3.25rem)] font-medium leading-none tracking-[-0.04em]">
                  Sayabot for Android
                </span>
                <span className="mt-2.5 block text-[14px] opacity-70">
                  Android APK to control, chat & approve agent tools from phone
                </span>
              </div>

              <div className="mt-8 space-y-3.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <a
                    href={DOWNLOADS.androidApk}
                    download="Sayabot.apk"
                    onClick={() => {
                      setAndroidDownloaded(true)
                      setTimeout(() => setAndroidDownloaded(false), 9000)
                    }}
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-[#15121a] px-5 text-[14px] font-medium text-white shadow-md hover:bg-neutral-800 transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                    {androidDownloaded ? (
                      <Check className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <ArrowDownToLine className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
                    )}
                    <span>{androidDownloaded ? "Downloading APK..." : "Download Android APK"}</span>
                  </a>

                  <Link
                    href="/download"
                    className="inline-flex h-11 items-center gap-1.5 rounded-full border border-black/15 bg-white/40 px-3.5 text-[12px] font-medium text-[#15121a] hover:bg-white/70 transition-colors"
                  >
                    <span>Pairing Guide</span>
                    <ArrowRight className="h-3 w-3 opacity-60" />
                  </Link>
                </div>

                {/* Android Installation Flow Indicator */}
                {androidDownloaded ? (
                  <div className="rounded-xl bg-black/10 p-2.5 text-xs text-[#15121a] animate-in fade-in slide-in-from-top-1 duration-300">
                    <p className="font-medium flex items-center gap-1.5 text-emerald-900">
                      <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>Download started! Next step:</span>
                    </p>
                    <p className="mt-1 text-[11px] opacity-80 pl-5">
                      Open <strong>Sayabot.apk</strong> on your device and tap <strong>Install</strong> (enable &ldquo;Install from unknown sources&rdquo; if prompted).
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#15121a]/80">
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-black/10 px-2.5 py-1 text-[11px] font-medium">
                      Direct release install
                    </span>
                    <span className="text-[11px] opacity-60">· Android 10+ · Works with Mac account</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <ul className="mt-4 grid gap-2 sm:grid-cols-3">
          {SOON.map((item) => (
            <li key={item.name} data-reveal className="l-card flex items-center gap-3 px-5 py-4">
              <item.icon className="h-5 w-5 text-faint" />
              <span className="text-[14px] text-muted">{item.name}</span>
              <span className="ml-auto font-mono text-[10px] tracking-[0.12em] text-faint">COMING SOON</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
