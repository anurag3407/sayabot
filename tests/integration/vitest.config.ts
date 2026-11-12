import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../..", import.meta.url))

export default {
  resolve: {
    alias: {
      "@sayabot/core/server": root + "/packages/core/src/server/index.ts",
      "@sayabot/core": root + "/packages/core/src/index.ts",
      "@sayabot/llm": root + "/packages/llm/src/index.ts",
      "@sayabot/db/schema": root + "/packages/db/src/schema/index.ts",
      "@sayabot/db": root + "/packages/db/src/index.ts",
      "drizzle-orm": root + "/packages/db/node_modules/drizzle-orm",
    },
  },
  test: { include: ["**/*.test.ts"], environment: "node" },
}
