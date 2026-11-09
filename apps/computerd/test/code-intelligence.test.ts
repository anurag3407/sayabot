import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { codeIntelligence, type CodeRequest } from "../agentd/code-intelligence"

let home: string
let project: string
let canonicalProject: string

function file(name: string, content: string) {
  const path = join(project, name)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content, { mode: 0o644 })
  return path
}

function request(action: CodeRequest["action"], extra: Partial<CodeRequest> = {}) {
  return codeIntelligence({ action, path: file("src/index.ts", `export function alpha(): number { return 1 }\nexport const beta = () => alpha()\n`), ...extra })
}

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "agentd-code-")))
  project = join(home, "project")
  mkdirSync(project, { recursive: true })
  canonicalProject = realpathSync(project)
  process.env.BOT_HOME = home
  file("tsconfig.json", `{
  "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "noEmit": true },
  "include": ["src/**/*.ts"]
}`)
})

afterEach(() => {
  delete process.env.BOT_HOME
  rmSync(home, { recursive: true, force: true })
})

describe("TypeScript code intelligence", { timeout: 20_000 }, () => {
  it("returns AST-derived declarations, not text lines", () => {
    const result = request("outline") as any
    expect(result.engine).toBe("typescript")
    expect(result.configPath).toBe(join(project, "tsconfig.json"))
    expect(result.items).toEqual([
      expect.objectContaining({ name: "alpha", kind: "function", container: null }),
      expect.objectContaining({ name: "beta", kind: "const", container: null }),
    ])
    expect(result.items.find((item: any) => item.name === "alpha").range.start.line).toBe(1)
  })

  it("resolves semantic definitions and references across files", () => {
    file("src/alpha.ts", "export function alpha(): number { return 1 }\n")
    const target = file("src/consumer.ts", `import { alpha } from "./alpha.js"\nexport const value = alpha()\nexport const second = alpha()\n`)
    const definitions = codeIntelligence({ action: "definition", path: target, line: 2, column: 23 }) as any
    expect(definitions.items).toEqual([expect.objectContaining({ name: "alpha", path: join(project, "src/alpha.ts"), start: { line: 1, column: 17 } })])
    const references = codeIntelligence({ action: "references", path: join(project, "src/alpha.ts"), line: 1, column: 17 }) as any
    expect(references.items).toEqual([
      expect.objectContaining({ path: join(canonicalProject, "src/alpha.ts"), start: { line: 1, column: 17 }, isWriteAccess: true }),
      expect.objectContaining({ path: join(canonicalProject, "src/consumer.ts"), start: { line: 1, column: 10 } }),
      expect.objectContaining({ path: join(canonicalProject, "src/consumer.ts"), start: { line: 2, column: 22 } }),
      expect.objectContaining({ path: join(canonicalProject, "src/consumer.ts"), start: { line: 3, column: 23 } }),
    ])
    expect(references.total).toBeGreaterThanOrEqual(3)
  })

  it("reports syntax and semantic diagnostics without running project scripts", () => {
    const path = file("src/broken.ts", `import { missing } from "./does-not-exist.js"\nexport const value: string = 1\n`)
    const result = codeIntelligence({ action: "diagnostics", path }) as any
    const messages = result.items.map((item: any) => item.message).join("\n")
    expect(messages).toContain("Cannot find module")
    expect(messages).toContain("string")
    expect(result.items.every((item: any) => item.code > 0 && item.range?.path === path)).toBe(true)
  })

  it("previews a semantic rename without writing files", () => {
    file("src/alpha.ts", "export function alpha(): number { return 1 }\n")
    file("src/consumer.ts", `import { alpha } from "./alpha.js"\nconst literal = "alpha"\nexport const value = alpha()\n`)
    const result = codeIntelligence({ action: "rename_preview", path: join(project, "src/alpha.ts"), line: 1, column: 17, newName: "renamed" }) as any
    expect(result.canRename).toBe(true)
    expect(result.preview).toBe(true)
    expect(result.edits).toHaveLength(3)
    expect(result.edits.map((edit: any) => edit.newText)).toEqual(["renamed", "renamed", "renamed"])
    expect(result.edits.map((edit: any) => `${edit.path}:${edit.range.start.line}`)).toEqual([
      `${join(canonicalProject, "src/alpha.ts")}:1`,
      `${join(canonicalProject, "src/consumer.ts")}:1`,
      `${join(canonicalProject, "src/consumer.ts")}:3`,
    ])
    expect(result.edits.every((edit: any) => /^[a-f0-9]{64}$/.test(edit.hash))).toBe(true)
  })

  it("confines the project and refuses escapes, non-JS/TS files and oversized requests", () => {
    const outside = join(home, "outside.ts")
    const outsideRoot = join(home, "outside-root")
    writeFileSync(outside, "export const secret = 1\n")
    mkdirSync(outsideRoot, { recursive: true })
    mkdirSync(join(project, "src"), { recursive: true })
    expect(() => codeIntelligence({ action: "outline", path: outside, projectRoot: canonicalProject })).toThrow("inside projectRoot")
    expect(() => codeIntelligence({ action: "definition", path: file("src/index.ts", "export const alpha = 1\nexport const beta = alpha\n"), line: 2, column: 20, projectRoot: outsideRoot })).toThrow("inside projectRoot")
    const python = file("src/main.py", "def alpha():\n    return 1\n")
    expect(() => codeIntelligence({ action: "outline", path: python })).toThrow("TypeScript and JavaScript")
    expect(() => codeIntelligence({ action: "outline", path: join(project, "src/index.ts"), maxResults: 0 })).toThrow("maxResults")
    expect(() => codeIntelligence({ action: "definition", path: join(project, "src/index.ts"), line: 0, column: 1 })).toThrow("positive")
    expect(() => codeIntelligence({ action: "rename_preview", path: join(project, "src/index.ts"), line: 1, column: 17, newName: "bad name" })).toThrow("identifier")
  })

  it("does not execute tsconfig plugins or follow escaping project references", () => {
    writeFileSync(join(project, "tsconfig.json"), `{
  "compilerOptions": { "strict": true },
  "include": ["src/**/*.ts"],
  "references": [{ "path": "../outside" }]
}`)
    const result = request("outline") as any
    expect(result.configPath).toBe(join(project, "tsconfig.json"))
    expect(result.items.map((item: any) => item.name)).toContain("alpha")
  })

  it("rejects symlinked source paths that leave the allowed roots", () => {
    const outside = join(home, "outside.ts")
    writeFileSync(outside, "export const secret = 1\n")
    mkdirSync(join(project, "src"), { recursive: true })
    const link = join(project, "src/link.ts")
    symlinkSync(outside, link)
    expect(() => codeIntelligence({ action: "outline", path: link, projectRoot: canonicalProject })).toThrow("inside projectRoot")
  })

  it("does not leave writable temporary artifacts or expose compiler library paths", () => {
    request("outline")
    const result = request("diagnostics") as any
    expect(result.items.every((item: any) => !item.range?.path.includes("node_modules"))).toBe(true)
    for (const name of ["src/index.ts", "tsconfig.json"]) {
      expect(() => chmodSync(join(project, name), 0o644)).not.toThrow()
    }
  })
})
