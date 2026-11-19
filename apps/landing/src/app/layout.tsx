import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"
import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "@/styles/base.css"
import "@/styles/hero.css"
import "@/styles/sections.css"
import "@/styles/homes.css"
import "@/styles/story.css"

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sayabot.tech"

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "Sayabot · Remote AI agents that keep working while you're away",
  description:
    "Open-source remote agents. Give each one a job, its own computer and your tools, and reach them from your Mac, Windows PC, Android phone or the web. Anything risky waits for your yes.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "48x48" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Sayabot · Remote AI agents",
    description:
      "Agents with their own computers, your tools and your model. They ask before anything risky.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "The Saya family of agent mascots" }],
    type: "website",
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
}

export const viewport: Viewport = {
  themeColor: "#08080a",
  colorScheme: "dark",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
