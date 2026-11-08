import { expect, test } from "@playwright/test"

// Unauthenticated navigation matrix: public pages load, protected pages
// redirect to /login (proxy.ts), unknown routes 404.
const PUBLIC = ["/", "/login", "/signup", "/forgot-password", "/reset-password", "/terms", "/privacy", "/security", "/help", "/offline"]
const PROTECTED = ["/onboarding", "/new-workspace"]

test.describe("public pages", () => {
  for (const path of PUBLIC) {
    test(`GET ${path} renders without a login redirect`, async ({ page }) => {
      const res = await page.goto(path)
      expect(res).not.toBeNull()
      await expect(page).not.toHaveURL(/\/login(\?|$)/)
      await expect(page.locator("body")).toBeVisible()
    })
  }
})

test.describe("protected pages", () => {
  for (const path of PROTECTED) {
    test(`GET ${path} redirects signed-out users to login`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login/)
    })
  }
})

test("unknown route renders the 404 page", async ({ page }) => {
  const res = await page.goto("/this-page-does-not-exist-xyz")
  expect(res?.status()).toBe(404)
})

test("landing page mentions Sayabot and its core promise", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator("body")).toContainText(/Sayabot/i)
})
