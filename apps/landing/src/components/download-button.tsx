"use client"

import { useEffect, useRef, useState } from "react"
import { DOWNLOADS, type DownloadId } from "@/lib/links"
import { AndroidIcon, AppleIcon, ChevronDown, WindowsIcon } from "./icons"
import { CopyButton } from "./copy-button"

const ORDER: DownloadId[] = ["macArm", "macIntel", "winX64", "winArm", "android"]

function detect(): DownloadId {
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return "android"
  if (/Windows/i.test(ua)) return /ARM64|aarch64/i.test(ua) ? "winArm" : "winX64"
  return "macArm"
}

function PlatformIcon({ id, className }: { id: DownloadId; className?: string }) {
  const platform = DOWNLOADS[id].platform
  if (platform === "windows") return <WindowsIcon className={className} />
  if (platform === "android") return <AndroidIcon className={className} />
  return <AppleIcon className={className} />
}

const SHORT: Record<DownloadId, string> = {
  macArm: "Download for Mac",
  macIntel: "Download for Mac",
  winX64: "Download for Windows",
  winArm: "Download for Windows",
  android: "Download for Android",
}

/** A split button: the visitor's platform up front, every other build in the menu. */
export function DownloadButton({ align = "left" }: { align?: "left" | "center" }) {
  const [primary, setPrimary] = useState<DownloadId>("macArm")
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => setPrimary(detect()), [])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false)
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", close)
      document.removeEventListener("keydown", escape)
    }
  }, [open])

  const item = DOWNLOADS[primary]
  return (
    <div className={`dl ${align === "center" ? "dl-center" : ""}`} ref={box}>
      <a className="btn btn-primary dl-main" href={item.href} download={item.file}>
        <PlatformIcon id={primary} />
        {SHORT[primary]}
      </a>
      <button
        type="button"
        className="btn btn-primary dl-toggle"
        aria-label="Other platforms"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown className={open ? "flip" : ""} />
      </button>
      {open ? (
        <div className="dl-menu" role="menu">
          {ORDER.map((id) => (
            <a
              key={id}
              role="menuitem"
              className="dl-item"
              href={DOWNLOADS[id].href}
              download={DOWNLOADS[id].file}
              onClick={() => setOpen(false)}
            >
              <PlatformIcon id={id} className="dl-icon" />
              <span>
                <strong>{DOWNLOADS[id].label}</strong>
                <small>{DOWNLOADS[id].detail}</small>
              </span>
            </a>
          ))}
        </div>
      ) : null}
      {primary.startsWith("mac") && (
        <div
          style={{
            marginTop: "10px",
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "11px",
            color: "var(--faint)",
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            padding: "4px 10px",
            borderRadius: "8px",
          }}
        >
          <span>Terminal install:</span>
          <code style={{ color: "var(--accent)", fontFamily: "var(--mono)" }}>
            curl -fsSL https://sayabot.sayalabs.in/install-mac.sh | bash
          </code>
          <CopyButton text="curl -fsSL https://sayabot.sayalabs.in/install-mac.sh | bash" />
        </div>
      )}
    </div>
  )
}
