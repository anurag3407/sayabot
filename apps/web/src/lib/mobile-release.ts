// Finds the newest Android APK published on GitHub Releases, so `/api/mobile/version` tracks
// real releases without anyone editing env vars. APKs are uploaded as `Sayabot-<x.y.z>.apk`.

const APK_NAME = /^Sayabot-v?(\d+)\.(\d+)\.(\d+)\.apk$/i

export interface ReleaseAsset {
  name: string
  browser_download_url: string
}

export interface LatestApk {
  version: string
  url: string
}

/** The highest-versioned `Sayabot-x.y.z.apk` among the assets, or null when none match. */
export function pickLatestApk(assets: ReleaseAsset[]): LatestApk | null {
  let best: { rank: number; apk: LatestApk } | null = null
  for (const asset of assets) {
    const m = APK_NAME.exec(asset.name)
    if (!m) continue
    const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
    // Same ordering as the Android versionCode (major*10000 + minor*100 + patch), widened.
    const rank = major * 1e8 + minor * 1e4 + patch
    if (!best || rank > best.rank) {
      best = {
        rank,
        apk: { version: `${major}.${minor}.${patch}`, url: asset.browser_download_url },
      }
    }
  }
  return best?.apk ?? null
}

/** `owner/repo` from a GitHub URL such as https://github.com/acme/sayabot. */
export function repoFromGithubUrl(url: string): string | null {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/.exec(url)
  if (!m?.[1] || !m[2]) return null
  return `${m[1]}/${m[2].replace(/\.git$/, "")}`
}

/** Asks GitHub for the latest releases; cached by Next for 60 seconds. Pools assets across top releases so APKs uploaded to an earlier tag or during parallel builds are never missed. Null on any failure. */
export async function fetchLatestApk(repo: string): Promise<LatestApk | null> {
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" }
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    }

    const allAssets: ReleaseAsset[] = []

    // 1. Fetch latest release
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers,
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const body = (await res.json()) as { assets?: ReleaseAsset[] }
      if (Array.isArray(body.assets)) {
        allAssets.push(...body.assets)
      }
    }

    // 2. Also inspect the top 3 releases in case a newly published tag hasn't received its APK yet
    // or the APK was attached to the preceding release during concurrent desktop/mobile builds.
    try {
      const listRes = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=3`, {
        headers,
        next: { revalidate: 60 },
        signal: AbortSignal.timeout(5000),
      })
      if (listRes.ok) {
        const releases = (await listRes.json()) as Array<{ assets?: ReleaseAsset[] }>
        if (Array.isArray(releases)) {
          for (const r of releases) {
            if (Array.isArray(r.assets)) {
              allAssets.push(...r.assets)
            }
          }
        }
      }
    } catch {
      // Fallback: list fetch failure is non-fatal if latest release responded
    }

    return pickLatestApk(allAssets)
  } catch {
    return null
  }
}
