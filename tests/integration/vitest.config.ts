import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../..", import.meta.url))
// `ai/test` provides the scripted model; resolve it the way the orchestrator does.
const aiTest = createRequire(`${root}/apps/orchestrator/package.json`).resolve("ai/test")

export default {
  resolve: {
    alias: {
      "ai/test": aiTest,
      "@sayabot/core/server": root + "/packages/core/src/server/index.ts",
      "@sayabot/core": root + "/packages/core/src/index.ts",
      // Subpaths first: the bare alias is a file, so `@sayabot/llm/models` would otherwise
      // resolve to `index.ts/models` once a test reaches the orchestrator's tool registry.
      "@sayabot/llm/models/effort": root + "/packages/llm/src/models/effort.ts",
      "@sayabot/llm/models": root + "/packages/llm/src/models/index.ts",
      "@sayabot/llm/local-apps": root + "/packages/llm/src/local-apps.ts",
      "@sayabot/llm": root + "/packages/llm/src/index.ts",
      "@sayabot/db/schema": root + "/packages/db/src/schema/index.ts",
      "@sayabot/db": root + "/packages/db/src/index.ts",
      "drizzle-orm": root + "/packages/db/node_modules/drizzle-orm",
    },
  },
  test: { include: ["**/*.test.ts"], environment: "node" },
}
