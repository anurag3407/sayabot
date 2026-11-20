import DownloadPage, { metadata as dlMetadata } from "../download/page"
import type { Metadata } from "next"

export const metadata: Metadata = {
  ...dlMetadata,
  title: "Sayabot for Desktop · macOS (Apple Silicon & Intel) & Windows",
  description:
    "Download Sayabot for macOS and Windows. Connect local Claude Code and Codex subscriptions to persistent autonomous agent sandboxes.",
  alternates: {
    canonical: "https://sayabot.tech/desktop",
  },
}

export default DownloadPage
