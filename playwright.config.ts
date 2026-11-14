import "dotenv/config"
import { defineConfig, devices } from "@playwright/test"

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000"
const orchURL = process.env.ORCHESTRATOR_URL ?? "http://localhost:4000"
// The seeded browser specs (chat/approval/turns) need E2E_USER_* + Supabase;
// the smoke lane (api/, navigation, api-guard) only needs running servers.
const smokeOnly = process.env.E2E_SMOKE === "1"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  globalSetup: smokeOnly ? undefined : "./e2e/global-setup.ts",
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  webServer: [
    {
      command: "pnpm --filter @sayabot/web dev",
      url: baseURL,
      reuseExistingServer: true,
      timeout: 180_000,
    },
    ...(smokeOnly
      ? []
      : [
          {
            command: "pnpm --filter @sayabot/orchestrator dev",
            url: `${orchURL}/health`,
            reuseExistingServer: true,
            timeout: 180_000,
          },
        ]),
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
