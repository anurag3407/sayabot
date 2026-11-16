import type { NextConfig } from "next"

/**
 * The public landing page: a fully static export (`out/`) with no server, auth or API.
 * Every link points at the downloads, the hosted web app or GitHub (src/lib/links.ts).
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: false,
  transpilePackages: ["@sayabot/core"],
}

export default nextConfig
