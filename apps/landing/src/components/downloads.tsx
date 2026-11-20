import { DOWNLOADS, LINKS } from "@/lib/links"
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

export function Downloads() {
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
          <Reveal className="dl-card card" index={0}>
            <AppleIcon className="dl-card-icon" />
            <h3>Mac</h3>
            <p>Native app with approvals, notifications and local agents on your Mac.</p>
            <div className="dl-card-links">
              <a
                className="btn btn-primary btn-sm"
                href={DOWNLOADS.macArm.href}
                download={DOWNLOADS.macArm.file}
              >
                <DownloadIcon /> Apple silicon
              </a>
              <a
                className="btn btn-ghost btn-sm"
                href={DOWNLOADS.macIntel.href}
                download={DOWNLOADS.macIntel.file}
              >
                Intel
              </a>
            </div>
            <small>macOS 14 or later · .dmg</small>
          </Reveal>

          <Reveal className="dl-card card" index={1}>
            <WindowsIcon className="dl-card-icon" />
            <h3>Windows</h3>
            <p>The desktop app for your PC: every chat, approval and notification.</p>
            <div className="dl-card-links">
              <a
                className="btn btn-primary btn-sm"
                href={DOWNLOADS.winX64.href}
                download={DOWNLOADS.winX64.file}
              >
                <DownloadIcon /> x64
              </a>
              <a
                className="btn btn-ghost btn-sm"
                href={DOWNLOADS.winArm.href}
                download={DOWNLOADS.winArm.file}
              >
                ARM64
              </a>
            </div>
            <small>.exe installer</small>
          </Reveal>

          <Reveal className="dl-card card" index={2}>
            <AndroidIcon className="dl-card-icon" />
            <h3>Android</h3>
            <p>Approvals, chats, tasks and each agent&apos;s computer, in your pocket.</p>
            <div className="dl-card-links">
              <a
                className="btn btn-primary btn-sm"
                href={DOWNLOADS.android.href}
                download={DOWNLOADS.android.file}
              >
                <DownloadIcon /> Get the APK
              </a>
            </div>
            <small>Android 7 or later · .apk</small>
          </Reveal>

          <Reveal className="dl-card card" index={3}>
            <GlobeIcon className="dl-card-icon" />
            <h3>Web</h3>
            <p>Nothing to install. Everything the apps do, in any browser.</p>
            <div className="dl-card-links">
              <a className="btn btn-primary btn-sm" href={LINKS.app}>
                Open the web app <ArrowUpRight />
              </a>
            </div>
            <small>Chrome, Safari, Firefox, Edge</small>
          </Reveal>
        </div>

        <div style={{ textAlign: "center", marginTop: "28px", marginBottom: "32px" }}>
          <a
            href="/download"
            className="btn btn-ghost"
            style={{ display: "inline-flex", gap: "8px", alignItems: "center", padding: "10px 20px" }}
          >
            <span>View complete desktop &amp; mobile installation specs</span>
            <ArrowUpRight />
          </a>
        </div>

        <Reveal className="oss card" index={1}>
          <div className="oss-copy">
            <GitHubIcon className="oss-icon" />
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
              <a className="link" href={LINKS.selfHost} target="_blank" rel="noreferrer">
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
