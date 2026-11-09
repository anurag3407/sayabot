import { readFileSync } from "node:fs"
import { isDestructiveCommand, redactSecrets } from "@sayabot/core"
import { canvases, canvasVersions } from "@sayabot/db"
import { z } from "zod"
import { getComputerClient, type CodeIntelligenceArgs, type EditFileArgs, type ReadFileArgs } from "../../computer/client"
import { getDb } from "../../db"
import { broadcast } from "../../realtime"
import type { ToolSpec } from "../audited"

export interface ComputerToolsArgs {
  agentId: string
  orgId: string
  roomId: string
  profile: "standard" | "browser"
}

/** Single-quotes a value for POSIX sh. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Literal (non-regex, no `$` patterns) string replacement. */
export function replaceLiteral(content: string, search: string, replacement: string, all: boolean): string {
  if (all) return content.split(search).join(replacement)
  const idx = content.indexOf(search)
  if (idx === -1) return content
  return content.slice(0, idx) + replacement + content.slice(idx + search.length)
}

const toolDocCache = new Map<string, string>()

/** Short summary plus the full usage doc from engine/tool-docs, so the model actually sees it. */
function describeWithDoc(name: string, summary: string): string {
  if (!toolDocCache.has(name)) {
    let doc = ""
    try {
      doc = readFileSync(new URL(`../../engine/tool-docs/${name}.md`, import.meta.url), "utf8")
        .replace(/^# .*\n+/, "")
        .trim()
    } catch {}
    toolDocCache.set(name, doc)
  }
  const doc = toolDocCache.get(name)
  return doc ? `${summary}\n\n${doc}` : summary
}

export function computerTools(args: ComputerToolsArgs): ToolSpec[] {
  const client = getComputerClient()
  const { agentId, orgId, roomId, profile } = args

  const shellTool: ToolSpec = {
    name: "computer_shell",
    description:
      "Execute a foreground command in your persistent container shell. Working directory defaults to /home/bot. Returns stdout, stderr and a verified exit code. Background jobs are not supported.",
    schema: z.object({
      command: z.string().min(1).max(20_000),
      cwd: z.string().optional(),
      timeoutSeconds: z.number().int().min(1).max(300).default(60),
    }),
    dangerous: (input) => isDestructiveCommand((input as { command: string }).command),
    execute: async (
      input: { command: string; cwd?: string; timeoutSeconds?: number },
      signal,
      ctx,
    ) => {
      await client.ensure(agentId, orgId, profile)
      let seq = 0
      const effectiveToolCallId = ctx?.toolCallId ?? agentId

      const result = await client.exec(
        agentId,
        {
          cmd: input.command,
          cwd: input.cwd,
          timeoutMs: (input.timeoutSeconds || 60) * 1000,
          onChunk: (chunk) => {
            void broadcast(roomId, {
              type: "tool.output",
              toolCallId: effectiveToolCallId,
              seq: seq++,
              chunk: redactSecrets(chunk).text,
            })
          },
        },
        signal,
      )

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
        duration_ms: result.durationMs,
        truncated: result.truncated,
        ...(result.timedOut
          ? { timed_out: true, note: `Command was killed after ${input.timeoutSeconds || 60}s. Raise timeoutSeconds (max 300) or narrow the command.` }
          : {}),
      }
    },
  }

  const readSchema = z.object({
    path: z.string().min(1),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    maxBytes: z.number().int().positive().max(2_000_000).default(256_000),
  }).refine((input) => input.endLine === undefined || input.endLine >= (input.startLine ?? 1), { message: "endLine must be >= startLine" })
  const fsReadTool: ToolSpec = {
    name: "fs_read",
    description: describeWithDoc("fs_read", "Read a UTF-8 file page with numbered lines. startLine/endLine are 1-based inclusive; pages contain at most 2000 complete lines and maxBytes source bytes (numbering adds display bytes). Returns full-file SHA-256 hash, exact totalLines/size, bytesReturned, startLine/endLine, truncated, hasMore and nextStartLine. Files over 32 MiB and binaries are refused. A page hash can guard fs_edit; omitted content is never treated as the whole file."),
    schema: readSchema,
    dangerous: false,
    execute: async (input: ReadFileArgs) => {
      await client.ensure(agentId, orgId, profile)
      const file = await client.readFile(agentId, input)
      if (file.encoding !== "utf8" || file.linesReturned === undefined || file.startLine === undefined) throw new Error("Invalid text page response")
      return { ...file, content: file.linesReturned ? file.content.split("\n").map((line, idx) => `${file.startLine! + idx} | ${line}`).join("\n") : "" }
    },
  }

  const fsEditTool: ToolSpec = {
    name: "fs_edit",
    description: describeWithDoc("fs_edit", "Atomically edit a complete UTF-8 file up to 5 MiB, optionally guarded by expectedHash from fs_read. Tries exact literal matching first; duplicate matches require replaceAll. whitespace=true permits a fallback only for one unique complete line block, ignoring leading/trailing spaces/tabs and CRLF differences, not internal whitespace. Ambiguous/overlapping matches, stale hashes and oversized files are rejected without writing. Returns matchMode, replacements and new hash."),
    schema: z.object({
      path: z.string().min(1),
      oldString: z.string().min(1).max(5_000_000),
      newString: z.string().max(5_000_000),
      expectedHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      replaceAll: z.boolean().default(false),
      whitespace: z.boolean().default(false),
    }),
    dangerous: false,
    execute: async (input: EditFileArgs) => {
      await client.ensure(agentId, orgId, profile)
      return client.editFile(agentId, input)
    },
  }

  const fsPatchTool: ToolSpec = {
    name: "fs_patch",
    description: describeWithDoc(
      "fs_patch",
      "Atomically apply a structured patch across one or more files in your container environment. Supported headers: '*** Add File: <path>', '*** Delete File: <path>', '*** Update File: <path>' (optional '*** Move to: <path>'), and '@@' hunks with context lines (' '), deleted lines ('-'), added lines ('+'). All hunks and files are verified in-memory before writing; if any hunk fails, zero files are modified. Enclosed in '*** Begin Patch' and '*** End Patch'.",
    ),
    schema: z.object({
      patchText: z.string().min(1).max(5_000_000),
    }),
    dangerous: false,
    execute: async (input: { patchText: string }) => {
      await client.ensure(agentId, orgId, profile)
      return client.applyPatch(agentId, input)
    },
  }

  const codeBase = {
    path: z.string().min(1),
    projectRoot: z.string().min(1).optional(),
    maxResults: z.number().int().min(1).max(1000).default(200),
  }
  const codePosition = { line: z.number().int().positive(), column: z.number().int().positive() }
  const codeTool = (name: string, action: CodeIntelligenceArgs["action"], description: string, schema: ToolSpec["schema"]): ToolSpec => ({
    name,
    description: `${description} TypeScript/JavaScript only, using the TypeScript compiler language service. Paths are absolute. Positions are 1-based UTF-16; range ends are exclusive. projectRoot defaults to the nearest tsconfig/jsconfig directory, or the file's directory if absent. Confined to that root (including imports/config symlinks); no plugins/scripts run. Bounded to 512 files, 24 MiB total, 2 MiB/file. maxResults defaults to 200 (max 1000).`,
    schema,
    dangerous: false,
    execute: async (input: Omit<CodeIntelligenceArgs, "action">) => {
      await client.ensure(agentId, orgId, profile)
      return client.codeIntelligence(agentId, { ...input, action })
    },
  })
  const codeTools = [
    codeTool("code_outline", "outline", "Return AST-derived declaration outlines: items with name, kind, container and range, plus total/truncated and file hash.", z.object(codeBase)),
    codeTool("code_definition", "definition", "Resolve the symbol at line/column to definition locations. Returns items, total/truncated and file hash.", z.object({ ...codeBase, ...codePosition })),
    codeTool("code_references", "references", "Find semantic references to the symbol at line/column, including write-access markers. Returns items, total/truncated and file hash.", z.object({ ...codeBase, ...codePosition })),
    codeTool("code_diagnostics", "diagnostics", "Return file syntax/semantic and compiler-option diagnostics with codes, categories, messages and ranges; items, total/truncated and hash. Does not run builds or linters.", z.object(codeBase)),
    codeTool("code_rename_preview", "rename_preview", "Preview semantic identifier rename to newName without writing. Returns canRename, preview, edits with oldText/newText, exclusive ranges and per-file hashes. Comments/strings are excluded. Refuses partial previews exceeding maxResults. Review edits; this is not a collision-free refactoring guarantee.", z.object({ ...codeBase, ...codePosition, newName: z.string().min(1).max(200) })),
  ]

  const fsWriteTool: ToolSpec = {
    name: "fs_write",
    description:
      describeWithDoc("fs_write", "Create or overwrite a file in your container environment."),
    schema: z.object({
      path: z.string().min(1),
      content: z.string().max(2_000_000),
      allowOverwriteLarge: z.boolean().optional().describe("Set to true if deliberately overwriting an existing file larger than 2KB (prevents accidental truncation)"),
    }),
    dangerous: false,
    execute: async (input: { path: string; content: string; allowOverwriteLarge?: boolean }) => {
      await client.ensure(agentId, orgId, profile)
      const result = await client.writeFile(agentId, { path: input.path, content: input.content, allowOverwriteLarge: input.allowOverwriteLarge })
      return { ok: true, path: input.path, ...result }
    },
  }

  const fsGlobTool: ToolSpec = {
    name: "fs_glob",
    description:
      describeWithDoc(
      "fs_glob",
      "Find files matching a glob pattern in the container filesystem, newest first. Patterns containing '/' match against the full path (e.g. '*/src/*.ts').",
    ),
    schema: z.object({
      pattern: z.string().min(1),
      path: z.string().optional().default("/home/bot"),
    }),
    dangerous: false,
    execute: async (input: { pattern: string; path?: string }) => {
      await client.ensure(agentId, orgId, profile)
      const base = input.path || "/home/bot"
      const res = await client.exec(agentId, {
        cmd: `find ${shellQuote(base)} ${input.pattern.includes("/") ? "-path" : "-name"} ${shellQuote(input.pattern)} -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -printf "%T@ %p\\n" 2>/dev/null | sort -nr | head -n 100 | cut -d' ' -f2-`,
      })
      const files = res.stdout.trim().split("\n").filter(Boolean)
      return {
        path: base,
        pattern: input.pattern,
        matches: files,
        count: files.length,
      }
    },
  }

  const fsGrepTool: ToolSpec = {
    name: "fs_grep",
    description:
      describeWithDoc(
      "fs_grep",
      "Search for a regex pattern across files using ripgrep, with line numbers.",
    ),
    schema: z.object({
      query: z.string().min(1),
      path: z.string().optional().default("/home/bot"),
      fileType: z.string().optional(),
    }),
    dangerous: false,
    execute: async (input: { query: string; path?: string; fileType?: string }) => {
      await client.ensure(agentId, orgId, profile)
      const base = input.path || "/home/bot"
      const typeFilter = input.fileType ? `-t ${shellQuote(input.fileType)}` : ""
      const res = await client.exec(agentId, {
        cmd: `rg -n --no-heading --color never --max-columns 400 -m 50 ${typeFilter} -- ${shellQuote(input.query)} ${shellQuote(base)} | head -n 400`,
      })
      if (!res.stdout && res.stderr.trim()) {
        throw new Error(`rg failed: ${res.stderr.slice(0, 2000)}`)
      }
      const lines = res.stdout ? res.stdout.split("\n").filter(Boolean).length : 0
      return {
        query: input.query,
        path: base,
        output: res.stdout || "(no matches found)",
        ...(lines >= 400 ? { note: "Output capped at 400 lines. Narrow the path or pattern." } : {}),
      }
    },
  }

  const gitStatusTool: ToolSpec = {
    name: "git_status",
    description: "Check git working tree status in your repository.",
    schema: z.object({
      cwd: z.string().optional().default("/home/bot"),
    }),
    dangerous: false,
    execute: async (input: { cwd?: string }) => {
      await client.ensure(agentId, orgId, profile)
      const res = await client.exec(agentId, {
        cmd: "git --no-optional-locks status -s",
        cwd: input.cwd,
      })
      return { status: res.stdout || "(clean working tree)" }
    },
  }

  const gitDiffTool: ToolSpec = {
    name: "git_diff",
    description: "View git diff of unstaged and staged changes.",
    schema: z.object({
      cwd: z.string().optional().default("/home/bot"),
      staged: z.boolean().optional().default(false),
    }),
    dangerous: false,
    execute: async (input: { cwd?: string; staged?: boolean }) => {
      await client.ensure(agentId, orgId, profile)
      const flag = input.staged ? "--staged" : ""
      const res = await client.exec(agentId, {
        cmd: `git --no-optional-locks diff ${flag}`,
        cwd: input.cwd,
      })
      return { diff: res.stdout || "(no changes)" }
    },
  }

  const gitCommitTool: ToolSpec = {
    name: "git_commit",
    description: "Commit staged or tracked changes in git repository.",
    schema: z.object({
      message: z.string().min(1),
      cwd: z.string().optional().default("/home/bot"),
      all: z.boolean().optional().default(true),
    }),
    dangerous: true,
    execute: async (input: { message: string; cwd?: string; all?: boolean }) => {
      await client.ensure(agentId, orgId, profile)
      const flag = input.all ? "-a" : ""
      const res = await client.exec(agentId, {
        cmd: `git commit ${flag} -m ${shellQuote(input.message)}`,
        cwd: input.cwd,
      })
      return { output: res.stdout || res.stderr, exitCode: res.exitCode }
    },
  }

  const gitPushTool: ToolSpec = {
    name: "git_push",
    description:
      "Push committed changes to remote git repository through Secret Broker proxy.",
    schema: z.object({
      cwd: z.string().optional().default("/home/bot"),
      remote: z.string().optional().default("origin"),
      branch: z.string().optional(),
    }),
    dangerous: true,
    execute: async (input: { cwd?: string; remote?: string; branch?: string }) => {
      await client.ensure(agentId, orgId, profile)
      const branch = input.branch ? ` ${shellQuote(input.branch)}` : ""
      const res = await client.exec(agentId, {
        cmd: `git push -- ${shellQuote(input.remote || "origin")}${branch}`,
        cwd: input.cwd,
      })
      return { output: res.stdout || res.stderr, exitCode: res.exitCode }
    },
  }

  // Aliases for backwards compatibility
  const readFileTool: ToolSpec = {
    name: "computer_read_file",
    description: "Read a raw UTF-8 page (compatibility alias to fs_read, without line-number prefixes). Returns the same full-file hash, totalLines, truncated and nextStartLine metadata. Use startLine/endLine and maxBytes for pagination.",
    schema: readSchema,
    dangerous: false,
    execute: async (input: ReadFileArgs) => {
      await client.ensure(agentId, orgId, profile)
      return client.readFile(agentId, input)
    },
  }

  const writeFileTool: ToolSpec = {
    name: "computer_write_file",
    description:
      "Write content to a file in your persistent container (/home/bot or /tmp) (alias to fs_write).",
    schema: z.object({
      path: z.string().min(1),
      content: z.string().max(1_000_000),
      allowOverwriteLarge: z.boolean().optional().describe("Set to true if deliberately overwriting an existing file larger than 2KB"),
    }),
    dangerous: false,
    execute: async (input: { path: string; content: string; allowOverwriteLarge?: boolean }) => {
      await client.ensure(agentId, orgId, profile)
      return client.writeFile(agentId, { path: input.path, content: input.content, allowOverwriteLarge: input.allowOverwriteLarge })
    },
  }

  const listFilesTool: ToolSpec = {
    name: "computer_list",
    description: "List directory contents in your persistent container filesystem.",
    schema: z.object({
      path: z.string().optional().default("/home/bot"),
      depth: z.number().int().min(1).max(3).default(1),
    }),
    dangerous: false,
    execute: async (input: { path?: string; depth?: number }) => {
      await client.ensure(agentId, orgId, profile)
      return client.listFiles(agentId, { path: input.path, depth: input.depth })
    },
  }

  const publishTool: ToolSpec = {
    name: "computer_publish",
    description: "Publish a file from your computer to the room as a shared Canvas document.",
    schema: z.object({
      path: z.string().min(1),
      as: z.enum(["canvas", "file"]).default("canvas"),
      title: z.string().optional(),
    }),
    dangerous: false,
    execute: async (input: { path: string; as: "canvas" | "file"; title?: string }) => {
      await client.ensure(agentId, orgId, profile)
      const file = await client.readFile(agentId, { path: input.path })
      if (file.truncated) throw new Error("Cannot publish a truncated file; publish a smaller file")

      const inferredKind = input.path.endsWith(".md")
        ? "markdown"
        : input.path.endsWith(".svg")
          ? "svg"
          : input.path.endsWith(".html")
            ? "html"
            : "code"

      const defaultTitle = input.path.split("/").pop() || "Published File"

      const [row] = await getDb()
        .insert(canvases)
        .values({
          roomId,
          title: input.title || defaultTitle,
          kind: inferredKind,
          snapshotText: file.content,
          language: inferredKind === "code" ? "text" : undefined,
        })
        .returning()

      if (row) {
        await getDb().insert(canvasVersions).values({
          canvasId: row.id,
          authorType: "agent",
          authorId: agentId,
          snapshotText: file.content,
        })
      }

      return {
        ok: true,
        canvasId: row?.id,
        title: row?.title,
        kind: row?.kind,
      }
    },
  }

  const standardTools: ToolSpec[] = [
    shellTool,
    fsReadTool,
    fsEditTool,
    fsPatchTool,
    fsWriteTool,
    fsGlobTool,
    fsGrepTool,
    ...codeTools,
    gitStatusTool,
    gitDiffTool,
    gitCommitTool,
    gitPushTool,
    readFileTool,
    writeFileTool,
    listFilesTool,
    publishTool,
  ]

  if (profile !== "browser") {
    return standardTools
  }

  // Browser tools
  const browserOpenTool: ToolSpec = {
    name: "browser_open",
    description: "Navigate the persistent Chromium browser to a URL.",
    schema: z.object({
      url: z.string().url(),
    }),
    dangerous: false,
    execute: async (input: { url: string }) => {
      await client.ensure(agentId, orgId, profile)
      return client.browser(agentId, "open", input)
    },
  }

  const browserSnapshotTool: ToolSpec = {
    name: "browser_snapshot",
    description: "Get the accessibility tree and interactive elements of the current browser page.",
    schema: z.object({}),
    dangerous: false,
    execute: async () => {
      await client.ensure(agentId, orgId, profile)
      return client.browser(agentId, "snapshot", {})
    },
  }

  const browserClickTool: ToolSpec = {
    name: "browser_click",
    description: "Click an element by ref number or CSS selector.",
    schema: z.object({
      ref: z.union([z.string(), z.number()]).optional(),
      selector: z.string().optional(),
    }),
    dangerous: false,
    execute: async (input: { ref?: string | number; selector?: string }) => {
      await client.ensure(agentId, orgId, profile)
      return client.browser(agentId, "click", input)
    },
  }

  const browserTypeTool: ToolSpec = {
    name: "browser_type",
    description: "Type text into a focused or selected element.",
    schema: z.object({
      ref: z.union([z.string(), z.number()]).optional(),
      selector: z.string().optional(),
      text: z.string(),
      submit: z.boolean().optional(),
    }),
    dangerous: false,
    execute: async (input: {
      ref?: string | number
      selector?: string
      text: string
      submit?: boolean
    }) => {
      await client.ensure(agentId, orgId, profile)
      return client.browser(agentId, "type", input)
    },
  }

  const browserExtractTool: ToolSpec = {
    name: "browser_extract",
    description: "Extract text, markdown, or HTML from the current page.",
    schema: z.object({
      selector: z.string().optional(),
      format: z.enum(["text", "markdown", "html"]).default("markdown"),
      maxChars: z.number().int().positive().max(100_000).default(30_000),
    }),
    dangerous: false,
    execute: async (input: {
      selector?: string
      format?: "text" | "markdown" | "html"
      maxChars?: number
    }) => {
      await client.ensure(agentId, orgId, profile)
      return client.browser(agentId, "extract", input)
    },
  }

  const browserScreenshotTool: ToolSpec = {
    name: "browser_screenshot",
    description:
      "Take a screenshot of the current page. Saves to /home/bot/.saaya/screens/ and returns preview.",
    schema: z.object({
      fullPage: z.boolean().optional(),
    }),
    dangerous: false,
    execute: async (input: { fullPage?: boolean }) => {
      await client.ensure(agentId, orgId, profile)
      return client.browser(agentId, "screenshot", input)
    },
  }

  return [
    ...standardTools,
    browserOpenTool,
    browserSnapshotTool,
    browserClickTool,
    browserTypeTool,
    browserExtractTool,
    browserScreenshotTool,
  ]
}
