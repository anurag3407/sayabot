import { readFileSync } from "node:fs"
import { isDestructiveCommand, redactSecrets, resolveComputer, type ComputerAvailability, type WorksOn } from "@sayabot/core"
import { canvases, canvasVersions } from "@sayabot/db"
import { z } from "zod"
import { getComputerClient, type CodeIntelligenceArgs, type EditFileArgs, type ReadFileArgs } from "../../computer/client"
import { boatCatCommand, boatClickCommand, boatListCommand, boatReadCommand, boatWriteCommand, captureBoatScreen, numberBoatLines, planBoatEdit, runBoatShell } from "../../computers/boat-shell"
import { runVpsShell } from "../../computers/vps"
import { getDb } from "../../db"
import { broadcast } from "../../realtime"
import type { ToolSpec } from "../audited"

export interface ComputerToolsArgs {
  agentId: string
  orgId: string
  roomId: string
  profile: "standard" | "browser"
  worksOn: WorksOn
  available: ComputerAvailability
  params: Record<string, unknown> | null
  /** SSH config name from Settings → Computers. Empty when no VPS is saved. */
  vpsSshAlias?: string | null
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

  /** The SSH name when this turn is already on the person's VPS. Auto does not start it. */
  function readyVps(): string | null {
    const decision = resolveComputer(args.worksOn, args.available)
    return decision.surface === "vps" && decision.action === "use" ? args.vpsSshAlias || null : null
  }

  /** Opens the local VM only when one is already ready. Auto does not create one. */
  async function useLocalVm(): Promise<{ ok: false; error: string } | null> {
    const decision = resolveComputer(args.worksOn, args.available)
    if (decision.surface === "local_vm" && decision.action === "use") {
      await client.ensure(agentId, orgId, profile)
      return null
    }
    if (decision.surface === "this_computer") {
      return { ok: false, error: "This bot uses the Mac's screen and apps, not a container." }
    }
    if (decision.surface === "boat") {
      if (decision.action === "use") {
        return { ok: false, error: "This tool uses the local VM. On a Boat, use computer_shell, fs_read, fs_write, or fs_edit." }
      }
      return { ok: false, error: decision.reason || "This bot's files are on its Boat. Call select_computer with boat. Auto does not wake one." }
    }
    if (decision.surface === "vps") {
      if (decision.action === "use") {
        return {
          ok: false,
          error: "This tool uses the local VM. On your VPS, use computer_shell, fs_read, fs_write, or fs_edit. Sayabot does not turn that server off.",
        }
      }
      return { ok: false, error: "This bot's desktop is your VPS. Call select_computer with vps. Sayabot does not turn that server off." }
    }
    return {
      ok: false,
      error: decision.reason || "No local VM is ready. Call select_computer to create one. Auto does not create a desktop.",
    }
  }

  const shellTool: ToolSpec = {
    name: "computer_shell",
    description:
      "Execute a command on this bot's desktop. A local VM uses /home/bot. A Boat runs the same command on its Linux desktop; background: true keeps that Boat awake for up to two hours. The agent process stays where it already runs.",
    schema: z.object({
      command: z.string().min(1).max(20_000),
      cwd: z.string().optional(),
      timeoutSeconds: z.number().int().min(1).max(300).default(60),
      background: z.boolean().default(false),
    }),
    dangerous: (input) => isDestructiveCommand((input as { command: string }).command),
    execute: async (
      input: { command: string; cwd?: string; timeoutSeconds?: number; background?: boolean },
      signal,
      ctx,
    ) => {
      const decision = resolveComputer(args.worksOn, args.available)
      if (decision.surface === "boat") {
        if (decision.action !== "use") {
          return {
            ok: false,
            error: decision.reason || "Call select_computer with boat. Auto does not create or wake one.",
          }
        }
        return runBoatShell({
          orgId,
          agentId,
          params: args.params,
          command: input.cwd ? `cd ${shellQuote(input.cwd)} && ${input.command}` : input.command,
          detached: input.background === true,
        })
      }
      if (input.background) {
        return {
          ok: false,
          error: "A background command runs on a Boat that is already awake. Call select_computer with boat.",
        }
      }
      if (decision.surface === "this_computer") {
        return { ok: false, error: "This bot uses the Mac's screen and apps, not a container." }
      }
      if (decision.surface === "vps") {
        if (decision.action !== "use") {
          return {
            ok: false,
            error: "This bot's desktop is your VPS. Call select_computer with vps. Sayabot does not turn that server off.",
          }
        }
        if (!args.vpsSshAlias) return { ok: false, error: "No VPS is set in Settings → Computers." }
        const command = input.cwd ? `cd ${shellQuote(input.cwd)} && ${input.command}` : input.command
        const ran = await runVpsShell(args.vpsSshAlias, command, (input.timeoutSeconds || 60) * 1000)
        return { ok: ran.ok, output: ran.output }
      }
      if (decision.surface !== "local_vm" || decision.action !== "use") {
        return {
          ok: false,
          error: decision.reason || "No local VM is ready. Call select_computer to create one. Auto does not create a desktop.",
        }
      }
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const decision = resolveComputer(args.worksOn, args.available)
      if (decision.surface === "boat" && decision.action === "use") {
        const command = boatReadCommand(input.path, input.startLine, input.endLine)
        if (!command) return { ok: false, error: "That path cannot be read on the Boat." }
        const result = await runBoatShell({
          orgId,
          agentId,
          params: args.params,
          command,
          detached: false,
        })
        if (result.ok === false) return result
        const text = typeof result.output === "string" ? result.output : ""
        return {
          path: input.path,
          content: numberBoatLines(text, input.startLine ?? 1),
          encoding: "utf8",
        }
      }
      const vps = readyVps()
      if (vps) {
        const command = boatReadCommand(input.path, input.startLine, input.endLine)
        if (!command) return { ok: false, error: "That path cannot be read on the VPS." }
        const ran = await runVpsShell(vps, command)
        if (!ran.ok) return { ok: false, error: ran.output || "The VPS did not read that file." }
        return { path: input.path, content: numberBoatLines(ran.output, input.startLine ?? 1), encoding: "utf8" }
      }
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const decision = resolveComputer(args.worksOn, args.available)
      if (decision.surface === "boat" && decision.action === "use") {
        const readCommand = boatCatCommand(input.path)
        if (!readCommand) return { ok: false, error: "That path cannot be read on the Boat." }
        const read = await runBoatShell({ orgId, agentId, params: args.params, command: readCommand, detached: false })
        if (read.ok === false) return read
        const content = typeof read.output === "string" ? read.output : ""
        const planned = planBoatEdit(input.path, content, input)
        if ("error" in planned) return { ok: false, error: planned.error }
        const wrote = await runBoatShell({ orgId, agentId, params: args.params, command: planned.command, detached: false })
        if (wrote.ok === false) return wrote
        return { ok: true, path: input.path, replacements: planned.replacements, hash: planned.hash, matchMode: "exact" }
      }
      const vps = readyVps()
      if (vps) {
        const readCommand = boatCatCommand(input.path)
        if (!readCommand) return { ok: false, error: "That path cannot be read on the VPS." }
        const read = await runVpsShell(vps, readCommand)
        if (!read.ok) return { ok: false, error: read.output || "The VPS did not read that file." }
        const planned = planBoatEdit(input.path, read.output, input)
        if ("error" in planned) return { ok: false, error: planned.error }
        const wrote = await runVpsShell(vps, planned.command)
        if (!wrote.ok) return { ok: false, error: wrote.output || "The VPS did not write that file." }
        return { ok: true, path: input.path, replacements: planned.replacements, hash: planned.hash, matchMode: "exact" }
      }
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const decision = resolveComputer(args.worksOn, args.available)
      if (decision.surface === "boat" && decision.action === "use") {
        const command = boatWriteCommand(input.path, input.content)
        if (!command) return { ok: false, error: "That path cannot be written on the Boat." }
        return runBoatShell({ orgId, agentId, params: args.params, command, detached: false })
      }
      const vps = readyVps()
      if (vps) {
        const command = boatWriteCommand(input.path, input.content)
        if (!command) return { ok: false, error: "That path cannot be written on the VPS." }
        const ran = await runVpsShell(vps, command)
        return ran.ok ? { ok: true, path: input.path } : { ok: false, error: ran.output || "The VPS did not write that file." }
      }
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const decision = resolveComputer(args.worksOn, args.available)
      if (decision.surface === "boat" && decision.action === "use") {
        const command = boatReadCommand(input.path, input.startLine, input.endLine)
        if (!command) return { ok: false, error: "That path cannot be read on the Boat." }
        const result = await runBoatShell({ orgId, agentId, params: args.params, command, detached: false })
        if (result.ok === false) return result
        return { path: input.path, content: typeof result.output === "string" ? result.output : "", encoding: "utf8" }
      }
      const vps = readyVps()
      if (vps) {
        const command = boatReadCommand(input.path, input.startLine, input.endLine)
        if (!command) return { ok: false, error: "That path cannot be read on the VPS." }
        const ran = await runVpsShell(vps, command)
        if (!ran.ok) return { ok: false, error: ran.output || "The VPS did not read that file." }
        return { path: input.path, content: ran.output, encoding: "utf8" }
      }
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const decision = resolveComputer(args.worksOn, args.available)
      if (decision.surface === "boat" && decision.action === "use") {
        const command = boatWriteCommand(input.path, input.content)
        if (!command) return { ok: false, error: "That path cannot be written on the Boat." }
        return runBoatShell({ orgId, agentId, params: args.params, command, detached: false })
      }
      const vps = readyVps()
      if (vps) {
        const command = boatWriteCommand(input.path, input.content)
        if (!command) return { ok: false, error: "That path cannot be written on the VPS." }
        const ran = await runVpsShell(vps, command)
        return ran.ok ? { ok: true, path: input.path } : { ok: false, error: ran.output || "The VPS did not write that file." }
      }
      const blocked = await useLocalVm()
      if (blocked) return blocked
      return client.writeFile(agentId, { path: input.path, content: input.content, allowOverwriteLarge: input.allowOverwriteLarge })
    },
  }

  const listFilesTool: ToolSpec = {
    name: "computer_list",
    description: "List directory contents in your persistent container filesystem.",
    schema: z.object({
      path: z.string().optional(),
      depth: z.number().int().min(1).max(3).default(1),
    }),
    dangerous: false,
    execute: async (input: { path?: string; depth?: number }) => {
      const home = resolveComputer(args.worksOn, args.available).surface === "boat" ? "/home/user" : "/home/bot"
      const command = boatListCommand(input.path || home, input.depth ?? 1)
      const decision = resolveComputer(args.worksOn, args.available)
      if (decision.surface === "boat" && decision.action === "use") {
        if (!command) return { ok: false, error: "That path cannot be listed on the Boat." }
        return runBoatShell({ orgId, agentId, params: args.params, command, detached: false })
      }
      const vps = readyVps()
      if (vps) {
        if (!command) return { ok: false, error: "That path cannot be listed on the VPS." }
        const ran = await runVpsShell(vps, command)
        return ran.ok ? { ok: true, output: ran.output } : { ok: false, error: ran.output || "The VPS did not list that directory." }
      }
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const blocked = await useLocalVm()
      if (blocked) return blocked
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

  const seeTool: ToolSpec = {
    name: "computer_screenshot",
    description: "See the Boat desktop. The picture is the screen the agent can click. A sleeping Boat is not woken.",
    schema: z.object({}),
    dangerous: false,
    execute: async () => {
      const decision = resolveComputer(args.worksOn, args.available)
      if (decision.surface !== "boat" || decision.action !== "use") {
        return { ok: false, error: "A Boat screenshot needs a Boat that is already awake. Call select_computer with boat. Auto does not wake one." }
      }
      return captureBoatScreen({ orgId, agentId, params: args.params })
    },
  }

  const clickTool: ToolSpec = {
    name: "computer_click",
    description: "Click a point on the Boat desktop. x and y are pixels. A sleeping Boat is not woken.",
    schema: z.object({
      x: z.number().int().min(0).max(32767),
      y: z.number().int().min(0).max(32767),
      button: z.enum(["left", "middle", "right"]).default("left"),
      count: z.number().int().min(1).max(3).default(1),
    }),
    dangerous: false,
    execute: async (input: { x: number; y: number; button?: "left" | "middle" | "right"; count?: number }) => {
      const decision = resolveComputer(args.worksOn, args.available)
      if (decision.surface !== "boat" || decision.action !== "use") {
        return { ok: false, error: "A Boat click needs a Boat that is already awake. Call select_computer with boat. Auto does not wake one." }
      }
      const command = boatClickCommand(input.x, input.y, input.button ?? "left", input.count ?? 1)
      if (!command) return { ok: false, error: "That point is not on the Boat screen." }
      return runBoatShell({ orgId, agentId, params: args.params, command, detached: false })
    },
  }

  const standardTools: ToolSpec[] = [
    shellTool,
    seeTool,
    clickTool,
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
      const blocked = await useLocalVm()
      if (blocked) return blocked
      return client.browser(agentId, "open", input)
    },
  }

  const browserSnapshotTool: ToolSpec = {
    name: "browser_snapshot",
    description: "Get the accessibility tree and interactive elements of the current browser page.",
    schema: z.object({}),
    dangerous: false,
    execute: async () => {
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const blocked = await useLocalVm()
      if (blocked) return blocked
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
      const blocked = await useLocalVm()
      if (blocked) return blocked
      return client.browser(agentId, "screenshot", input)
    },
  }

  const browserExecTool: ToolSpec = {
    name: "browser_exec",
    description:
      "Execute model-generated Python or JavaScript code snippets using pre-imported browser helpers (page.goto, page.click, page.screenshot, page.evaluate). Returns stdout, logs, and evaluated return values.",
    schema: z.object({
      code: z.string().min(1).describe("Python or JavaScript code to execute against the active Chromium page context"),
      language: z.enum(["python", "javascript"]).default("python").describe("Script language ('python' or 'javascript')"),
      timeoutSeconds: z.number().int().min(1).max(120).default(30).optional(),
    }),
    dangerous: false,
    execute: async (input: { code: string; language?: "python" | "javascript"; timeoutSeconds?: number }) => {
      const blocked = await useLocalVm()
      if (blocked) return blocked
      return client.browser(agentId, "exec", input)
    },
  }

  const browserCdpTool: ToolSpec = {
    name: "browser_cdp",
    description:
      "Execute direct low-level Chrome DevTools Protocol (CDP) JSON-RPC commands (DOM inspection, network request interception, cookies, storage, emulation, and performance tracing).",
    schema: z.object({
      method: z.string().min(1).describe("CDP method name (e.g. 'Network.getCookies', 'Page.captureScreenshot', 'DOM.getDocument', 'Emulation.setDeviceMetricsOverride')"),
      params: z.record(z.string(), z.unknown()).default({}).describe("JSON-RPC parameter object for the CDP method call"),
    }),
    dangerous: false,
    execute: async (input: { method: string; params?: Record<string, unknown> }) => {
      const blocked = await useLocalVm()
      if (blocked) return blocked
      return client.browser(agentId, "cdp", input)
    },
  }

  const browserDialogTool: ToolSpec = {
    name: "browser_dialog",
    description:
      "Intercept and interact with JavaScript modal dialogs (window.alert(), window.confirm(), window.prompt(), or beforeunload).",
    schema: z.object({
      action: z.enum(["accept", "dismiss"]).describe("Whether to accept (OK) or dismiss (Cancel) the active dialog"),
      promptText: z.string().optional().describe("Text value to submit into a window.prompt() input box before accepting"),
    }),
    dangerous: false,
    execute: async (input: { action: "accept" | "dismiss"; promptText?: string }) => {
      const blocked = await useLocalVm()
      if (blocked) return blocked
      return client.browser(agentId, "dialog", input)
    },
  }

  const browserVaultTool: ToolSpec = {
    name: "browser_vault",
    description:
      "Safely auto-fill encrypted vault credentials (passwords, API tokens, 2FA codes) into browser input fields without exposing the secret plaintext to the model conversation context (zero token leakage).",
    schema: z.object({
      secretName: z.string().min(1).describe("The name of the vault secret (e.g., 'ADMIN_PASSWORD', 'STRIPE_KEY', 'GITHUB_TOKEN')"),
      selector: z.string().min(1).describe("CSS selector of the target input element (e.g. 'input[name=password]', '#login-pass')"),
      submit: z.boolean().default(false).describe("Whether to automatically submit the form or press Enter after filling"),
    }),
    dangerous: false,
    execute: async (input: { secretName: string; selector: string; submit?: boolean }) => {
      const blocked = await useLocalVm()
      if (blocked) return blocked
      return client.browser(agentId, "vault", {
        secretName: input.secretName,
        selector: input.selector,
        submit: input.submit ?? false,
        orgId,
      })
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
    browserExecTool,
    browserCdpTool,
    browserDialogTool,
    browserVaultTool,
  ]
}
