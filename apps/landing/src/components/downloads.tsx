"use client"

import { useEffect, useState, type ReactNode } from "react"
import type { SayaShape } from "@sayabot/core/mascot"
import { DOWNLOADS, LINKS } from "@/lib/links"
import { CopyButton } from "./copy-button"
import {
  AndroidIcon,
  AppleIcon,
  ArrowUpRight,
  DownloadIcon,
  GitHubIcon,
  GlobeIcon,
  WindowsIcon,
} from "./icons"
import { Reveal } from "./reveal"
import { Saya } from "./saya"

type Platform = "mac" | "windows" | "android" | "web"

function detectPlatform(): Platform | null {
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return "android"
  if (/iphone|ipad|ipod/i.test(ua)) return "web"
  if (/mac/i.test(ua)) return "mac"
  if (/win/i.test(ua)) return "windows"
  return null
}

const INSTALL_CMD = "curl -fsSL https://sayabot.sayalabs.in/install-mac.sh | bash"

function Card({
  platform,
  recommended,
  index,
  icon,
  title,
  body,
  meta,
  mascot,
  children,
}: {
  platform: Platform
  recommended: boolean
  index: number
  icon: ReactNode
  title: string
  body: string
  meta: string
  mascot: SayaShape
  children: ReactNode
}) {
  return (
    <Reveal className={`dl-card card ${recommended ? "is-rec" : ""}`} index={index}>
      <Saya shape={mascot} mood="done" className="dl-card-peek" />
      <div className="dl-card-top">
        <span className="dl-card-tile">{icon}</span>
        {recommended ? <span className="dl-card-rec">For this device</span> : null}
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      <div className="dl-card-foot">
        <div className="dl-card-links">{children}</div>
        <small data-platform={platform}>{meta}</small>
      </div>
    </Reveal>
  )
}

export function Downloads() {
  const [platform, setPlatform] = useState<Platform | null>(null)
  useEffect(() => setPlatform(detectPlatform()), [])

  return (
    <section className="section" id="download" aria-labelledby="download-title">
      <div className="wrap">
        <Reveal className="head-center">
          <span className="eyebrow">Download</span>
          <h2 className="h2" id="download-title">
            On every screen you own.
          </h2>
          <p className="lede">
            Your agents run on their own computers, so they keep going when your laptop is closed.
            The apps are how you check in.
          </p>
        </Reveal>

        <div className="dls">
          <Card
            platform="mac"
            recommended={platform === "mac"}
            index={0}
            icon={<AppleIcon />}
            title="Mac"
            body="Native app with approvals, notifications and local agents on your Mac."
            meta="macOS 14 or later · .dmg"
            mascot="ghost"
          >
            <a className="btn btn-primary btn-sm" href={DOWNLOADS.macArm.href} download={DOWNLOADS.macArm.file}>
              <DownloadIcon /> Apple silicon
            </a>
            <a className="btn btn-ghost btn-sm" href={DOWNLOADS.macIntel.href} download={DOWNLOADS.macIntel.file}>
              Intel
            </a>
          </Card>
          <Card
            platform="windows"
            recommended={platform === "windows"}
            index={1}
            icon={<WindowsIcon />}
            title="Windows"
            body="The desktop app for your PC: every chat, approval and notification."
            meta="Windows 10 or later · .exe"
            mascot="block"
          >
            <a className="btn btn-primary btn-sm" href={DOWNLOADS.winX64.href} download={DOWNLOADS.winX64.file}>
              <DownloadIcon /> x64
            </a>
            <a className="btn btn-ghost btn-sm" href={DOWNLOADS.winArm.href} download={DOWNLOADS.winArm.file}>
              ARM64
            </a>
          </Card>
          <Card
            platform="android"
            recommended={platform === "android"}
            index={2}
            icon={<AndroidIcon />}
            title="Android"
            body="Approvals, chats, tasks and each agent's computer, in your pocket."
            meta="Android 7 or later · .apk"
            mascot="sprout"
          >
            <a className="btn btn-primary btn-sm" href={DOWNLOADS.android.href} download={DOWNLOADS.android.file}>
              <DownloadIcon /> Get the APK
            </a>
          </Card>
          <Card
            platform="web"
            recommended={platform === "web"}
            index={3}
            icon={<GlobeIcon />}
            title="Web"
            body="Nothing to install. Everything the apps do, in any browser."
            meta="Chrome, Safari, Firefox, Edge"
            mascot="bubble"
          >
            <a className="btn btn-primary btn-sm" href={LINKS.app}>
              Open the web app <ArrowUpRight />
            </a>
          </Card>
        </div>

        <Reveal className="dl-term" index={1}>
          <span className="dl-term-label">
            <AppleIcon /> Prefer the terminal?
          </span>
          <code className="mono">
            <span className="dim">$</span> {INSTALL_CMD}
          </code>
          <CopyButton text={INSTALL_CMD} />
          <a className="dl-term-more" href="/download">
            All install options <ArrowUpRight />
          </a>
        </Reveal>

        <Reveal className="oss card" index={1}>
          <div className="oss-copy">
            <span className="oss-badge">
              <GitHubIcon className="oss-icon" />
              <Saya shape="hoot" mood="done" className="oss-face" />
            </span>
            <h3>Open source. Run it on your own server.</h3>
            <p>
              The core is AGPL-3.0 and self-hosting is free. Point the desktop and phone apps at
              your server and sign in with the same account.
            </p>
            <div className="oss-links">
              <a
                className="btn btn-ghost btn-sm"
                href={LINKS.github}
                target="_blank"
                rel="noreferrer"
              >
                <GitHubIcon /> View on GitHub
              </a>
              <a className="link" href={LINKS.selfHost}>
                Self-hosting guide
              </a>
              <a className="link" href={LINKS.releases} target="_blank" rel="noreferrer">
                All releases
              </a>
            </div>
          </div>
          <pre className="oss-term mono" aria-label="Commands to run Sayabot from source">
            <span className="dim"># Node 24, pnpm 10 and Postgres</span>
            {"\n"}git clone https://github.com/anurag3407/sayabot.git
            {"\n"}cd sayabot && pnpm install
            {"\n"}cp .env.example .env
            {"\n"}pnpm db:migrate && pnpm db:seed
            {"\n"}pnpm dev
          </pre>
        </Reveal>
      </div>
    </section>
  )
}
