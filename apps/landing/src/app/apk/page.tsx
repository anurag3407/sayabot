import DownloadPage, { metadata as dlMetadata } from "../download/page"
import type { Metadata } from "next"

export const metadata: Metadata = {
  ...dlMetadata,
  title: "Sayabot for Android · Direct Release APK",
  description:
    "Download Sayabot Android APK. Control your autonomous agents, approve dangerous tool calls, and get real-time room notifications on your phone.",
  alternates: {
    canonical: "https://sayabot.tech/apk",
  },
}

export default DownloadPage
