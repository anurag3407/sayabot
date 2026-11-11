import { scanLocalUsage, type LocalProvider } from "@sayabot/core/scanner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
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
        days: validDays,
        ...result,
      },
      {
        headers: {
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      },
    )
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to scan local developer agent usage",
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
