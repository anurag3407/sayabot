import type { ToolSpec } from "../tools/audited"

const MUTATING_TOOLS = new Set(["fs_edit", "fs_write", "computer_write_file"])

// Commands that only read the workspace (or run checks). Anything else, including
// arbitrary scripts, is conservatively treated as a possible write.
const READ_ONLY_SEGMENT = new RegExp(
  "^(?:" +
    [
      "cd",
      "pwd",
      "ls",
      "cat",
      "head",
      "tail",
      "less",
      "wc",
      "grep",
      "egrep",
      "rg",
      "ag",
      "find",
      "fd",
      "tree",
      "stat",
      "file",
      "du",
      "df",
      "echo",
      "printf",
      "which",
      "type",
      "env",
      "whoami",
      "date",
      "uname",
      "sort",
      "uniq",
      "cut",
      "tr",
      "jq",
      "diff",
      "cmp",
      "sha256sum",
      "md5sum",
      "basename",
      "dirname",
      "realpath",
      "git\\s+(?:status|diff|log|show|branch|remote|rev-parse|blame|ls-files|grep|describe|tag\\s+-l)",
      "(?:node|python3?|go|cargo|rustc|java|ruby|pnpm|npm|yarn|bun)\\s+(?:-v|--version)",
      "(?:npm|pnpm|yarn|bun)\\s+(?:test|run\\s+(?:test|lint|typecheck|check|build)(?::[\\w-]+)?)",
      "(?:npx|pnpm\\s+exec|pnpm\\s+dlx)\\s+(?:vitest|jest|tsc|eslint|prettier\\s+--check)",
      "pytest",
      "python3?\\s+-m\\s+(?:pytest|unittest|mypy)",
      "mypy",
      "ruff\\s+check",
      "cargo\\s+(?:test|check|build|clippy)",
      "go\\s+(?:test|vet|build)",
      "make\\s+(?:test|check|lint)",
    ].join("|") +
    ")(?:\\s|$)",
)

const WRITE_HINT = new RegExp(
  [
    ">{1,2}",
    "\\btee\\b",
    "\\bxargs\\b",
    "\\b(?:sh|bash|zsh)\\b",
    "--fix\\b",
    "--write\\b",
    "\\b(?:rm|mv|cp|mkdir|rmdir|touch|chmod|chown|ln|truncate|dd|patch)\\b",
    "\\bsed\\s+-i",
    "\\bperl\\s+-\\w*i",
    "\\bfind\\b.*\\s-(?:delete|exec)",
    "\\$\\(",
    "`",
  ].join("|"),
)

/** True unless every chained segment of the command is a known read-only/check command. */
export function shellMayMutate(command: string): boolean {
  const normalized = command
    .replace(/\d?>\s*\/dev\/null/g, "")
    .replace(/\d>&\d/g, "")
    .replace(/&>\s*\/dev\/null/g, "")
    .trim()
  if (!normalized) return false
  if (WRITE_HINT.test(normalized)) return true
  return normalized.split(/&&|\|\||;|\||\n/).some((segment) => {
    const part = segment.trim()
    return part.length > 0 && !READ_ONLY_SEGMENT.test(part)
  })
}

export interface VerificationCheck {
  kind: "test" | "lint" | "typecheck" | "build"
  command: string
  cwd: string
  exitCode: number
  durationMs: number
}

export interface VerificationEvidence {
  status: "not_required" | "pending" | "passed" | "failed"
  mutationRevision: number
  checks: VerificationCheck[]
  reason?: string
}

export class RunEvidence {
  private revision = 0
  private activeWrites = 0
  private verifiedRevision = -1
  private checks: VerificationCheck[] = []
  private failed = false

  snapshot(): VerificationEvidence {
    const status = this.failed
      ? "failed"
      : this.activeWrites > 0
        ? "pending"
        : this.revision === this.verifiedRevision
          ? "passed"
          : this.revision === 0
            ? "not_required"
            : "pending"
    return {
      status,
      mutationRevision: this.revision,
      checks: this.checks,
      ...(status === "pending"
        ? {
            reason:
              "Run verify_workspace after the latest file edit or shell operation. Prose is not execution evidence.",
          }
        : {}),
      ...(status === "failed"
        ? {
            reason:
              "The latest verification failed or could not finish. Fix the failure and rerun the checks.",
          }
        : {}),
    }
  }

  wrap(spec: ToolSpec): ToolSpec {
    return {
      ...spec,
      execute: async (input, signal, context) => {
        const shellMayWrite =
          spec.name === "computer_shell" && shellMayMutate(String(input.command ?? ""))
        const mutates = MUTATING_TOOLS.has(spec.name) || shellMayWrite
        if (mutates) {
          this.revision++
          this.activeWrites++
        }
        const revision = this.revision
        try {
          const result = await spec.execute(input, signal, context)
          if (spec.name === "verify_workspace") {
            const verification = result as { checks?: VerificationCheck[]; passed?: boolean }
            this.checks = (verification.checks ?? []).map(
              ({ kind, command, cwd, exitCode, durationMs }) => ({
                kind,
                command,
                cwd,
                exitCode,
                durationMs,
              }),
            )
            this.failed =
              verification.passed !== true ||
              this.checks.length === 0 ||
              this.checks.some((c) => c.exitCode !== 0)
            if (!this.failed && this.activeWrites === 0 && revision === this.revision) {
              this.verifiedRevision = revision
            }
          }
          return result
        } catch (error) {
          if (spec.name === "verify_workspace") this.failed = true
          throw error
        } finally {
          if (mutates) {
            this.revision++
            this.activeWrites--
          }
        }
      },
    }
  }
}
