// Pure version helpers for app updates. No React Native imports, so they unit-test in Node.

export function parseSemver(v: string): [number, number, number] {
  const parts = v
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((x) => parseInt(x, 10) || 0)
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

/** True when `latest` is a strictly higher major.minor.patch than `current`. */
export function isNewerVersion(current: string, latest: string): boolean {
  const [cMaj, cMin, cPat] = parseSemver(current)
  const [lMaj, lMin, lPat] = parseSemver(latest)
  if (lMaj !== cMaj) return lMaj > cMaj
  if (lMin !== cMin) return lMin > cMin
  return lPat > cPat
}

/** The server may send an absolute download link or one relative to itself. */
export function resolveApkUrl(serverBase: string, apkUrl: string): string {
  if (/^https?:\/\//i.test(apkUrl)) return apkUrl
  const base = serverBase.replace(/\/+$/, "")
  return `${base}${apkUrl.startsWith("/") ? "" : "/"}${apkUrl}`
}

/** Quiet checks run at most this often while the app keeps coming back to the foreground. */
export const QUIET_CHECK_INTERVAL_MS = 30 * 60 * 1000

export function shouldQuietCheck(lastCheckedAt: number | null, now: number): boolean {
  return lastCheckedAt === null || now - lastCheckedAt >= QUIET_CHECK_INTERVAL_MS
}
