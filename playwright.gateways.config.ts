import "dotenv/config"
import { defineConfig } from "@playwright/test"

/**
 * Gateway E2E lane: real Next dev server, real orchestrator, real Postgres/Supabase. The only
 * faked network hops are Telegram/Discord/the model endpoint, which are redirected to
 * `e2e/fake-chat-provider.mjs` via base-URL overrides.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:7431"
const orchURL = process.env.ORCHESTRATOR_URL ?? "http://localhost:4000"
const fake = `http://127.0.0.1:${process.env.FAKE_PROVIDER_PORT ?? 4599}`

export default defineConfig({
  testDir: "./e2e",
  testMatch: /gateways\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 420_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: { baseURL, viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
  webServer: [
    {
      command: "node e2e/fake-chat-provider.mjs",
      url: `${fake}/health`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: `TELEGRAM_API_BASE=${fake}/telegram DISCORD_API_BASE=${fake}/discord pnpm --filter @sayabot/web dev`,
      url: `${baseURL}/login`,
      reuseExistingServer: true,
      timeout: 240_000,
    },
    {
      command: `PORT=4000 SAYABOT_LOCAL=true DATABASE_POOL_MAX=4 TELEGRAM_API_BASE=${fake}/telegram DISCORD_API_BASE=${fake}/discord DEV_OPENAI_COMPAT_BASE_URL=${fake}/llm pnpm --filter @sayabot/orchestrator dev`,
      url: `${orchURL}/health`,
      reuseExistingServer: true,
      timeout: 240_000,
    },
  ],
})
