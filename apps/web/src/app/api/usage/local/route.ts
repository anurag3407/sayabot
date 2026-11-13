import { scanLocalUsage, type LocalProvider } from "@sayabot/core/scanner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

/**
 * Reads the Claude Code / Codex / Antigravity logs in the home folder of the machine running
 * this server. That is only "your computer" when Sayabot itself runs on it, so on a hosted
 * server (where it would read the server's files and show them to every signed-in user) the
 * scan is switched off and the dashboard hides that view.
 */
function isOwnMachine(request: Request): boolean {
  if (process.env.SAYABOT_LOCAL_USAGE_SCAN === "1") return true
  if (process.env.SAYABOT_LOCAL_USAGE_SCAN === "0") return false
  return LOOPBACK_HOSTS.has(new URL(request.url).hostname)
}

export async function GET(request: Request) {
  if (!isOwnMachine(request)) {
    return Response.json(
      { ok: false, available: false, records: [], events: [] },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  }
  try {
    const url = new URL(request.url)
    const daysParam = url.searchParams.get("days")
    const days = daysParam ? parseInt(daysParam, 10) : 30
    const validDays = Number.isFinite(days) && days > 0 ? days : 30

    const providersParam = url.searchParams.get("providers") || url.searchParams.get("provider")
    const includeProviders = providersParam
      ? (providersParam.split(",").map((p) => p.trim()) as LocalProvider[])
      : undefined

    const result = await scanLocalUsage({
      days: validDays,
      includeProviders,
    })

    return Response.json(
      {
        ok: true,
        available: true,
        days: validDays,
        ...result,
      },
      {
        headers: {
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      },
    )
  } catch (error: unknown) {
    return Response.json(
      {
        ok: false,
        available: true,
        error: error instanceof Error ? error.message : "Could not read this computer's coding tool logs",
        records: [],
        summary: {
          totalTokens: 0,
          uncachedInputTokens: 0,
          cachedInputTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          costUsd: 0,
          cacheSavingsUsd: 0,
          sessionCount: 0,
          byProvider: {},
          byModel: {},
          byDay: [],
        },
        events: [],
        scannedAt: new Date().toISOString(),
        providersScanned: [],
      },
      { status: 500 },
    )
  }
}
