import { NextResponse } from "next/server"
import { getOrgAccess, isOrgAdmin } from "@/lib/auth"
import { localDetectionAllowed } from "@/lib/local-agents"
import { loadWorkspaceModels } from "@/lib/model-catalog"
import { requireRouteUser } from "@/lib/route-auth"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * The title-bar model picker's list, read live: the server's own models, apps signed in on this
 * computer, each saved key's provider `/models` list, and the person's own computers. Model lists
 * are cached server-side (10 min per key, 6 h for Codex, models.dev daily, the manifest hourly), so
 * opening the picker is cheap. `?refresh=1` re-reads everything now (admins only).
 */
export async function GET(request: Request) {
  const auth = await requireRouteUser()
  if ("response" in auth) return auth.response
  const url = new URL(request.url)
  const slug = url.searchParams.get("org")?.trim()
  if (!slug) return NextResponse.json({ error: "Which workspace?" }, { status: 400 })
  const access = await getOrgAccess(slug, { user: auth.user })
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  if (url.searchParams.get("refresh") === "1" && isOrgAdmin(access.role)) {
    const models = await import("@sayabot/llm/models")
    models.clearProviderModelCache()
    await Promise.all([
      models.modelCatalog().refresh({ force: true }),
      models.modelManifest().refresh({ force: true }),
      localDetectionAllowed(host)
        ? models.codexModelCatalog({ force: true }).catch(() => null)
        : Promise.resolve(null),
    ])
  }
  // Without `refresh`, buildModelCatalog refreshes models.dev and the manifest in the background:
  // this answer uses what is on hand and the next one sees any update.

  try {
    const { groups } = await loadWorkspaceModels({ access, host })
    return NextResponse.json(
      { groups, canManage: isOrgAdmin(access.role) },
      { headers: { "cache-control": "private, no-store" } },
    )
  } catch (error) {
    console.error("[models] could not build the model list", error)
    return NextResponse.json({ error: "Could not load the model list" }, { status: 500 })
  }
}
