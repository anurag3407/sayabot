import withSerwistInit from "@serwist/next"
import type { NextConfig } from "next"
import { fileURLToPath } from "node:url"

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  cacheOnNavigation: false,
  reloadOnOnline: true,
  additionalPrecacheEntries: ["/offline", "/icon.svg", "/manifest.webmanifest"].map((url) => ({
    url,
    revision:
        process.env.VERCEL_GIT_COMMIT_SHA ??
        process.env.GIT_COMMIT_SHA ??
        Date.now().toString(36),
  })),
})

// Docker builds set NEXT_OUTPUT=standalone to get a self-contained server bundle.
// Tracing from the monorepo root pulls in packages/* that the app imports as source.
const standalone = process.env.NEXT_OUTPUT === "standalone"

const nextConfig: NextConfig = {
  ...(standalone
    ? {
        output: "standalone" as const,
        outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
      }
    : {}),
  transpilePackages: ["@sayabot/core", "@sayabot/db", "@sayabot/llm"],
  serverExternalPackages: ["pg", "pg-boss", "@e2b/code-interpreter"],
  poweredByHeader: false,
  typescript: {
    // Monorepo has React 19 in web and React 18 in mobile; typecheck separately
    ignoreBuildErrors: true,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        child_process: false,
      }
    }
    return config
  },
  turbopack: {},
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ]
  },
}

export default withSerwist(nextConfig)
