"use client"

import { useEffect, useState } from "react"
import { ArrowDownToLine } from "lucide-react"
import { CopyButton } from "@/components/copy-button"

type Chip = "arm" | "intel" | "unknown"

/**
 * Which kind of Mac this is, so people get one "Download for Mac" button instead of choosing
 * between "Apple Silicon" and "Intel". Chrome and Edge say so directly; elsewhere the graphics
 * chip's name gives it away. When unsure, Apple Silicon (every Mac sold since 2020).
 */
async function detectChip(): Promise<Chip> {
  try {
    const uaData = (
      navigator as Navigator & {
        userAgentData?: {
          getHighEntropyValues: (hints: string[]) => Promise<{ architecture?: string }>
        }
      }
    ).userAgentData
    if (uaData) {
      const { architecture } = await uaData.getHighEntropyValues(["architecture"])
      if (architecture === "arm") return "arm"
      if (architecture === "x86") return "intel"
    }
  } catch {
    // fall through to the graphics check
  }
  try {
    const gl = document.createElement("canvas").getContext("webgl")
    const info = gl?.getExtension("WEBGL_debug_renderer_info")
    const renderer = info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ""
    if (/apple (m\d|gpu)/i.test(renderer)) return "arm"
    if (/intel|amd|radeon/i.test(renderer)) return "intel"
  } catch {
    // no WebGL
  }
  return "unknown"
}

export function MacDownload({
  armUrl,
  intelUrl,
  installCmd,
}: {
  armUrl: string
  intelUrl: string
  installCmd: string
}) {
  const [chip, setChip] = useState<Chip>("unknown")
  useEffect(() => {
    void detectChip().then(setChip)
  }, [])
  const intel = chip === "intel"
  const primary = intel ? intelUrl : armUrl
  const other = intel ? armUrl : intelUrl

  return (
    <div className="space-y-4">
      <a
        href={primary}
        download={intel ? "Sayabot-x64.dmg" : "Sayabot-arm64.dmg"}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-medium text-black shadow-sm transition-colors hover:bg-neutral-200"
      >
        <ArrowDownToLine className="h-4 w-4" />
        <span>Download for Mac</span>
        <span className="text-xs text-neutral-500">
          {intel ? "Intel" : chip === "arm" ? "Apple chip" : ""}
        </span>
      </a>
      <p className="text-center text-[11px] text-neutral-500">
        {intel ? "Mac with an Apple chip (M1 or newer)?" : "Older Mac with an Intel chip?"}{" "}
        <a href={other} download className="text-neutral-300 underline underline-offset-2">
          Download that version
        </a>
      </p>
      <ol className="space-y-1.5 text-[12px] leading-relaxed text-neutral-300">
        <li>1. Open the downloaded file and drag Sayabot into Applications.</li>
        <li>
          2. Open Sayabot. If macOS says it can&apos;t check the app, click <strong>Done</strong>,
          then open <strong>System Settings → Privacy &amp; Security</strong> and click{" "}
          <strong>Open Anyway</strong>.
        </li>
        <li>3. Sign in, and your bots can use the Claude Code or Codex on this Mac.</li>
      </ol>
      <details className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
        <summary className="cursor-pointer text-[12px] text-neutral-400 hover:text-neutral-200">
          Comfortable with Terminal? Install with one line instead
        </summary>
        <div className="mt-2 flex min-w-0 items-start gap-2">
          <span className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-neutral-200">
            {installCmd}
          </span>
          <CopyButton text={installCmd} label="copy" className="shrink-0 text-neutral-400" />
        </div>
      </details>
    </div>
  )
}
