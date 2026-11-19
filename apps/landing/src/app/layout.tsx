import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"
import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "@/styles/base.css"
import "@/styles/hero.css"
import "@/styles/sections.css"
import "@/styles/homes.css"
import "@/styles/story.css"
import { TabTitle } from "@/components/tab-title"

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sayabot.tech"

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Sayabot · Remote AI agents that keep working while you're away",
    template: "%s · Sayabot",
  },
  description:
    "Open-source remote AI agent platform. Give each agent a job, its own persistent Linux computer and your tools. Reach them from your Mac, Windows PC, Android phone or the web. Risky operations wait for your yes.",
  applicationName: "Sayabot",
  keywords: [
    "Sayabot",
    "remote AI agents",
    "autonomous agents",
    "AI agent workspace",
    "persistent linux sandbox",
    "docker agent daemon",
    "computerd",
    "multi-agent collaboration",
    "agent turn coordinator",
    "postgres advisory locks",
    "open source claude alternative",
    "MCP tools",
    "model context protocol",
    "Sayalabs",
  ],
  authors: [
    { name: "Sayalabs", url: "https://sayabot.tech" },
    { name: "Anurag Mishra", url: "https://github.com/anurag3407" },
  ],
  creator: "Sayalabs",
  publisher: "Sayalabs",
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  alternates: {
    canonical: "https://sayabot.tech",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "48x48" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    title: "Sayabot · Remote AI agents that keep working while you're away",
    description:
      "Agents with their own persistent computers, your tools and your choice of LLM. Deterministic turns with PostgreSQL advisory locks and human danger gates.",
    url: "https://sayabot.tech",
    siteName: "Sayabot",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Sayabot — The Saya family of remote agent mascots",
        type: "image/png",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sayabot · Remote AI agents that keep working while you're away",
    description:
      "Open-source remote AI agents with persistent Linux sandboxes, multi-agent turns & human approval gates.",
    images: ["/og.png"],
    site: "@sayalabs",
    creator: "@anurag_mishra",
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Sayabot",
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#08080a" },
    { media: "(prefers-color-scheme: dark)", color: "#08080a" },
  ],
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
}

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": "https://sayabot.tech/#website",
    name: "Sayabot",
    url: "https://sayabot.tech",
    description:
      "Open-source remote AI agents that keep working while you're away. Persistent Linux compute sandboxes, deterministic multi-agent turns with PostgreSQL advisory locks, and human approval gates.",
    publisher: {
      "@id": "https://sayabot.tech/#organization",
    },
    inLanguage: "en-US",
  },
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": "https://sayabot.tech/#organization",
    name: "Sayalabs",
    url: "https://sayabot.tech",
    logo: {
      "@type": "ImageObject",
      url: "https://sayabot.tech/icon.svg",
      width: 1024,
      height: 1024,
    },
    sameAs: [
      "https://github.com/anurag3407/sayabot",
      "https://github.com/anurag3407",
      "https://sayalabs.in",
    ],
    founder: {
      "@type": "Person",
      name: "Anurag Mishra",
      url: "https://github.com/anurag3407",
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": "https://sayabot.tech/#application",
    name: "Sayabot",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "macOS 14+, Windows 10+, Android 7+, Linux, Web",
    softwareVersion: "1.0.0",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: "https://sayabot.tech",
    },
    description:
      "Open-source remote AI agent platform. Give each agent a job, its own Linux Docker sandbox, and your tools. Reach them from your Mac, Windows PC, Android phone, or the web. Anything risky waits for your yes.",
    screenshot: "https://sayabot.tech/og.png",
    downloadUrl: "https://github.com/anurag3407/sayabot/releases/latest",
    author: {
      "@id": "https://sayabot.tech/#organization",
    },
    publisher: {
      "@id": "https://sayabot.tech/#organization",
    },
    license: "https://github.com/anurag3407/sayabot/blob/main/LICENSING.md",
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    "@id": "https://sayabot.tech/#code",
    name: "Sayabot",
    description:
      "Deterministic multi-agent turns with PostgreSQL advisory locks, isolated Docker sandboxes (/home/bot), and AES-256-GCM envelope encryption.",
    codeRepository: "https://github.com/anurag3407/sayabot",
    programmingLanguage: ["TypeScript", "Rust", "Python", "Shell"],
    runtimePlatform: "Node.js, Docker, Next.js, React Native",
    license: "https://github.com/anurag3407/sayabot/blob/main/LICENSING.md",
    author: {
      "@id": "https://sayabot.tech/#organization",
    },
  },
]

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {jsonLd.map((schema, index) => (
          <script
            key={index}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
          />
        ))}
      </head>
      <body>
        <TabTitle />
        {children}
      </body>
    </html>
  )
}
