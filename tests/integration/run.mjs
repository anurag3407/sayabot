import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const vitest = join(root, "apps/orchestrator/node_modules/vitest/vitest.mjs")
const res = spawnSync(process.execPath, [vitest, "run", "--root", join(root, "tests/integration")], { stdio: "inherit" })
process.exit(res.status ?? 1)
