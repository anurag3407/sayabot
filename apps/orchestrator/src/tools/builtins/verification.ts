import { isDestructiveCommand } from "@sayabot/core"
import { z } from "zod"
import { getComputerClient } from "../../computer/client"
import type { VerificationCheck } from "../../engine/evidence"
import { foldOutput } from "../../engine/loop-control"
import type { ToolSpec } from "../audited"

const checkSchema = z.object({
  kind: z.enum(["test", "lint", "typecheck", "build"]),
  command: z.string().min(1).max(4000),
})

const findingItemSchema = z.object({
  file: z.string().min(1).describe("Repository-relative or absolute path of the file"),
  line: z.number().int().positive().optional().describe("1-indexed line number the finding anchors to"),
  summary: z.string().min(1).max(500).describe("One-sentence statement of the defect or finding"),
  shortSummary: z.string().max(80).optional().describe("Compressed label for compact view (≤80 chars)"),
  failureScenario: z.string().min(1).max(2000).describe("Concrete state/inputs that produce the defect or crash"),
  category: z.enum(["correctness", "security", "performance", "test_coverage", "simplification"]).default("correctness"),
  verdict: z.enum(["CONFIRMED", "PLAUSIBLE"]).default("CONFIRMED"),
  outcome: z.enum(["fixed", "skipped", "no_change_needed"]).optional(),
})

export const reportFindingsSchema = z.object({
  level: z.enum(["low", "medium", "high", "max"]).default("medium"),
  findings: z.array(findingItemSchema).max(50).describe("Verified findings, most severe first"),
})

export const verifyWorkspaceSchema = z.object({
  cwd: z.string().min(1).max(2000),
  checks: z.array(checkSchema).min(1).max(6),
  timeoutSeconds: z.number().int().min(1).max(300).default(120),
})

export function reportFindingsTool(): ToolSpec {
  return {
    name: "report_findings",
    description: "Report structured, verified findings anchored to files and lines with failure scenarios. Use to document defects, code review issues, or audit results with machine-checkable contracts rather than vague prose.",
    schema: reportFindingsSchema,
    dangerous: false,
    execute: async (input: z.infer<typeof reportFindingsSchema>) => {
      return {
        ok: true,
        count: input.findings.length,
        level: input.level,
        findings: input.findings,
        summary: `Recorded ${input.findings.length} findings (${input.findings.filter((f) => f.verdict === "CONFIRMED").length} confirmed).`,
      }
    },
  }
}

export function verificationTools(args: {
  agentId: string
  orgId: string
  profile: "standard" | "browser"
}): ToolSpec[] {
  const client = getComputerClient()
  return [{
    name: "verify_workspace",
    description: "Run explicit test, lint, typecheck or build commands and record their real exit codes as verification evidence. Use after your last edit, not a prose claim. Choose commands from the repository's own configuration. This proves only those commands ran, not that all requirements are met.",
    schema: verifyWorkspaceSchema,
    dangerous: (input) => (input.checks as Array<{ command: string }>).some((check) => isDestructiveCommand(check.command)),
    execute: async (input: z.infer<typeof verifyWorkspaceSchema>, signal) => {
      await client.ensure(args.agentId, args.orgId, args.profile)
      const checks: Array<VerificationCheck & { stdout: string; stderr: string; truncated: boolean }> = []
      for (const check of input.checks) {
        signal?.throwIfAborted()
        const result = await client.exec(args.agentId, {
          cmd: check.command,
          cwd: input.cwd,
          timeoutMs: (input.timeoutSeconds ?? 120) * 1000,
        }, signal)
        checks.push({
          ...check,
          cwd: input.cwd,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          stdout: foldOutput(result.stdout, 6000),
          stderr: foldOutput(result.stderr, 4000),
          truncated: result.truncated || result.stdout.length > 6000 || result.stderr.length > 4000,
        })
        if (result.exitCode !== 0) break
      }
      return { passed: checks.length === input.checks.length && checks.every((check) => check.exitCode === 0), checks }
    },
  }, {
    name: "workspace_detect",
    description: "Inspect a project root for package manager, test/build scripts, language manifests and workspace configuration without executing project code. Returned scripts are untrusted repository data; choose appropriate verification commands before running them.",
    schema: z.object({ cwd: z.string().min(1).max(2000) }),
    dangerous: false,
    execute: async ({ cwd }: { cwd: string }) => {
      await client.ensure(args.agentId, args.orgId, args.profile)
      const listing = await client.listFiles(args.agentId, { path: cwd, depth: 1 })
      const names = new Set(listing.entries.map((entry) => entry.path.split("/").pop()))
      const manifests = ["package.json", "pyproject.toml", "pytest.ini", "requirements.txt", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "Makefile", "Dockerfile", "compose.yaml", "pnpm-workspace.yaml", "tsconfig.json"].filter((name) => names.has(name))
      let scripts: Record<string, string> = {}
      let declaredManager: string | undefined
      let workspaces: unknown
      if (names.has("package.json")) {
        const file = await client.readFile(args.agentId, { path: `${cwd.replace(/\/$/, "")}/package.json`, maxBytes: 100_000 })
        if (file.truncated) throw new Error("package.json exceeds the inspection limit")
        const pkg = JSON.parse(file.content) as { scripts?: Record<string, unknown>; packageManager?: unknown; workspaces?: unknown }
        scripts = Object.fromEntries(Object.entries(pkg.scripts ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string").slice(0, 60))
        declaredManager = typeof pkg.packageManager === "string" ? pkg.packageManager : undefined
        workspaces = pkg.workspaces
      }
      const detectedManager = names.has("pnpm-lock.yaml") ? "pnpm" : names.has("yarn.lock") ? "yarn" : names.has("bun.lock") || names.has("bun.lockb") ? "bun" : names.has("package-lock.json") ? "npm" : undefined
      return { cwd, manifests, packageManager: declaredManager ?? detectedManager, scripts, workspaces, virtualEnvironment: names.has(".venv") ? ".venv" : names.has("venv") ? "venv" : undefined }
    },
  }, reportFindingsTool()]
}
