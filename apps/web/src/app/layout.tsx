import type { Metadata, Viewport } from "next"
import { Suspense } from "react"
import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "./globals.css"
import { DesktopSessionSync } from "@/components/desktop-session-sync"
import { Toaster } from "@/components/ui/toast"
import { SummaryFocusGuard } from "@/components/summary-focus-guard"
import { PwaUpdatePrompt } from "@/components/pwa-update-prompt"
import { ThemeProvider, ThemeScript } from "@/components/theme-provider"
import { NavigationProgress } from "@/components/ui/navigation-progress"

export const metadata: Metadata = {
  title: {
    default: "Sayabot",
    template: "%s · Sayabot",
  },
  description:
    "Shared rooms where human teams and AI agents take turns, edit canvases and call tools together.",
  applicationName: "Sayabot",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "32x32" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Sayabot",
    statusBarStyle: "black-translucent",
  },
}

export const viewport: Viewport = {
  themeColor: "#070907",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="dark" data-theme="dark">
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh bg-void text-text antialiased">
        <ThemeProvider>
          <Suspense fallback={null}>
            <NavigationProgress />
          </Suspense>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[110] focus:rounded-sm focus:bg-accent focus:px-3 focus:py-2 focus:text-[13px] focus:text-void"
          >
            Skip to content
          </a>
          {children}
          <Toaster />
          <SummaryFocusGuard />
          <PwaUpdatePrompt />
          <DesktopSessionSync />
        </ThemeProvider>
      </body>
    </html>
  )
}
