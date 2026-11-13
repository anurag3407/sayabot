import { describe, expect, it } from "vitest"
import { APP_CATEGORIES, appForHost, findMarketplaceApp, MARKETPLACE_APPS } from "./marketplace"

describe("Marketplace catalog", () => {
  it("has a few hundred apps with unique ids", () => {
    expect(MARKETPLACE_APPS.length).toBeGreaterThan(200)
    const ids = MARKETPLACE_APPS.map((app) => app.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("uses HTTPS and a known category everywhere", () => {
    const categories = new Set(APP_CATEGORIES.map((c) => c.id))
    for (const app of MARKETPLACE_APPS) {
      if (app.transport === "stdio") expect(app.url, app.id).toBe(`stdio://${app.id}`)
      else expect(new URL(app.url).protocol, app.id).toBe("https:")
      expect(categories.has(app.category), app.id).toBe(true)
      expect(app.tagline.length, app.id).toBeGreaterThan(3)
    }
  })

  it("never matches one saved server to two apps", () => {
    for (const app of MARKETPLACE_APPS) {
      if (app.auth.kind === "personal-url" || app.transport === "stdio") continue
      const host = new URL(app.url).host
      expect(appForHost(host)?.id, host).toBe(app.id)
    }
  })

  it("offers sign-in for the big sign-in-only apps", () => {
    for (const id of ["notion", "atlassian", "linear", "canva", "sentry", "vercel"]) {
      expect(findMarketplaceApp(id)?.auth.kind, id).toBe("oauth")
    }
  })
})
