import ts from "typescript"
import {
  closeSync,
  fstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
  statSync,
  constants,
} from "node:fs"
import { basename, dirname, isAbsolute, matchesGlob, resolve } from "node:path"
import { assertSafePath, hashBytes, isSafePath, readCompleteFile, within } from "./files"

export interface CodeRequest {
  action: "outline" | "definition" | "references" | "diagnostics" | "rename_preview"
  path: string
  projectRoot?: string
  line?: number
  column?: number
  newName?: string
  maxResults?: number
}

const MAX_FILE = 2 * 1024 * 1024
const MAX_PROJECT = 24 * 1024 * 1024
const MAX_FILES = 512
const MAX_ENTRIES = 20_000
const MAX_RESULTS = 1000
const sourceExtension = /\.(?:[cm]?tsx?|[cm]?jsx?)$/i

/** A fresh, bounded language service per request. No tsserver, plugins, watchers or emit. */
export function codeIntelligence(req: CodeRequest) {
  if (
    !["outline", "definition", "references", "diagnostics", "rename_preview"].includes(req.action)
  )
    throw new Error("Unknown code intelligence action")
  assertSafePath(req.path)
  const file = realpathSync(req.path)
  if (!sourceExtension.test(file))
    throw new Error("Code intelligence supports TypeScript and JavaScript files only")
  let root = req.projectRoot ? realpathSync(req.projectRoot) : dirname(file)
  assertSafePath(root)
  let config: string | undefined
  if (!req.projectRoot) {
    let dir = root
    while (isSafePath(dir)) {
      for (const name of ["tsconfig.json", "jsconfig.json"]) {
        const candidate = resolve(dir, name)
        // Do not follow an escaping config symlink even during discovery.
        try {
          if (statSync(candidate).isFile()) {
            assertSafePath(candidate)
            config = candidate
            break
          }
        } catch (error: any) {
          if (error.code !== "ENOENT") throw error
        }
      }
      if (config) {
        root = dir
        break
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } else {
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const candidate = resolve(root, name)
      try {
        if (statSync(candidate).isFile()) {
          assertSafePath(candidate)
          config = candidate
          break
        }
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error
      }
    }
  }
  root = realpathSync(root)
  if (!within(file, root)) throw new Error("File must be inside projectRoot")
  const maxResults = req.maxResults ?? 200
  if (!Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > MAX_RESULTS)
    throw new Error("maxResults must be between 1 and 1000")
  const libraryRoot = realpathSync(dirname(ts.getDefaultLibFilePath({})))
  const cache = new Map<string, string>()
  let projectBytes = 0
  let entries = 0
  const deadline = Date.now() + 10_000
  const checkBudget = () => {
    if (Date.now() > deadline)
      throw new Error("Code intelligence time limit exceeded; narrow projectRoot")
  }
  const isLibrary = (path: string) =>
    dirname(path) === libraryRoot && /^lib[\w.-]*\.d\.ts$/.test(basename(path))
  const permitted = (path: string) => {
    if (!isAbsolute(path)) return false
    const absolute = resolve(path)
    if (isLibrary(absolute)) {
      try {
        return realpathSync(absolute) === absolute
      } catch {
        return false
      }
    }
    if (!within(absolute, root) || !isSafePath(absolute)) return false
    try {
      return within(realpathSync(absolute), root)
    } catch {
      return false
    }
  }
  const exists = (path: string, directory = false) => {
    checkBudget()
    if (!permitted(path)) return false
    try {
      return directory ? statSync(path).isDirectory() : statSync(path).isFile()
    } catch {
      return false
    }
  }
  const read = (path: string): string | undefined => {
    checkBudget()
    if (!exists(path)) return undefined
    const canonical = realpathSync(path)
    if (cache.has(canonical)) return cache.get(canonical)
    let bytes: Buffer
    if (isLibrary(canonical)) {
      // Only the installed compiler's immutable lib*.d.ts files get this exception.
      const fd = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const size = fstatSync(fd).size
        if (size > MAX_FILE) throw new Error("TypeScript library exceeds file limit")
        bytes = Buffer.alloc(size)
        let offset = 0
        while (offset < size) {
          const n = readSync(fd, bytes, offset, size - offset, null)
          if (!n) throw new Error("Incomplete TypeScript library read")
          offset += n
        }
      } finally {
        closeSync(fd)
      }
    } else {
      bytes = readCompleteFile(canonical, MAX_FILE)
    }
    projectBytes += bytes.length
    if (cache.size >= MAX_FILES || projectBytes > MAX_PROJECT)
      throw new Error("Project exceeds code intelligence size limit; narrow projectRoot")
    if (bytes.includes(0)) throw new Error("Binary source/config file")
    const value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
    cache.set(canonical, value)
    return value
  }
  const glob = (base: string, pattern: string) => {
    const absolute = resolve(base, pattern)
    // TypeScript interprets extensionless directory patterns as recursive includes.
    return /[*?]/.test(absolute) || /\.[^/]+$/.test(absolute) ? absolute : `${absolute}/**/*`
  }
  const readDirectory: ts.ParseConfigHost["readDirectory"] = (
    base,
    extensions,
    excludes,
    includes,
    depth,
  ) => {
    if (!exists(base, true)) return []
    const result: string[] = []
    const seen = new Set<string>()
    const includeGlobs = (includes ?? ["**/*"]).map((p) => glob(base, p))
    const excludeGlobs = (excludes ?? ["node_modules", "bower_components", "jspm_packages"]).map(
      (p) => glob(base, p),
    )
    const scan = (dir: string, level: number) => {
      checkBudget()
      if (level > 64) throw new Error("Project directory depth limit exceeded")
      if (depth !== undefined && level > depth) return
      if (!exists(dir, true)) return
      const real = realpathSync(dir)
      if (seen.has(real)) return
      seen.add(real)
      const handle = opendirSync(dir)
      try {
        for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
          if (++entries > MAX_ENTRIES)
            throw new Error("Project directory entry limit exceeded; narrow projectRoot")
          if (entry.name === ".git" || entry.name === "node_modules") continue
          const path = resolve(dir, entry.name)
          if (!permitted(path)) continue
          if (excludeGlobs.some((p) => matchesGlob(path, p) || matchesGlob(`${path}/`, p))) continue
          if (exists(path, true)) scan(path, level + 1)
          else if (
            exists(path) &&
            (!extensions || extensions.some((ext) => path.endsWith(ext))) &&
            includeGlobs.some((p) => matchesGlob(path, p))
          ) {
            result.push(path)
            if (result.length > MAX_FILES)
              throw new Error("Project file count limit exceeded; narrow projectRoot")
          }
        }
      } finally {
        handle.closeSync()
      }
    }
    scan(base, 0)
    return result
  }
  const configHost: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: true,
    readDirectory,
    fileExists: (p) => exists(p),
    readFile: read,
    directoryExists: (p) => exists(p, true),
    realpath: (p) => (permitted(p) ? realpathSync(p) : p),
  }
  let options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  }
  let files: string[]
  let configErrors: readonly ts.Diagnostic[] = []
  if (config) {
    const loaded = ts.readConfigFile(config, read)
    if (loaded.error)
      throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"))
    const parsed = ts.parseJsonConfigFileContent(loaded.config, configHost, root, undefined, config)
    if (parsed.errors.length)
      throw new Error(
        `Invalid or inaccessible tsconfig: ${parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("; ")}`,
      )
    files = parsed.fileNames
    options = { ...parsed.options, allowJs: true }
    configErrors = parsed.errors
    // Project references are not followed: this service is restricted to this root.
  } else {
    files = [
      ...readDirectory(
        root,
        [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
        undefined,
        ["**/*"],
      ),
    ]
  }
  options = {
    ...options,
    noEmit: true,
    incremental: false,
    composite: false,
    plugins: [],
    disableSourceOfProjectReferenceRedirect: true,
  }
  files = [...new Set([...files, file])]
  if (files.length > MAX_FILES) throw new Error("Project file count limit exceeded")
  for (const path of files) {
    if (!permitted(path)) throw new Error("Project source path escapes allowed projectRoot")
    read(path)
  }
  const host: ts.LanguageServiceHost = {
    ...configHost,
    readDirectory: (path, extensions, exclude, include, depth) => [
      ...readDirectory(path, extensions ?? [], exclude, include ?? ["**/*"], depth),
    ],
    getCompilationSettings: () => options,
    getScriptFileNames: () => files,
    getScriptVersion: () => "0",
    getScriptSnapshot: (path) => {
      const content = read(path)
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content)
    },
    getCurrentDirectory: () => root,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    getNewLine: () => "\n",
    useCaseSensitiveFileNames: () => true,
    getCancellationToken: () => ({
      isCancellationRequested: () => Date.now() > deadline,
      throwIfCancellationRequested: checkBudget,
    }),
  }
  const service = ts.createLanguageService(host)
  try {
    const source = service.getProgram()?.getSourceFile(file)
    if (!source) throw new Error("Could not parse source file")
    const location = (path: string, span: ts.TextSpan) => {
      if (!permitted(path)) throw new Error("Result path escapes allowed projectRoot")
      const content = read(path)!
      const parsed =
        service.getProgram()?.getSourceFile(path) ??
        ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true)
      const from = parsed.getLineAndCharacterOfPosition(span.start)
      const to = parsed.getLineAndCharacterOfPosition(span.start + span.length)
      return {
        path,
        start: { line: from.line + 1, column: from.character + 1 },
        end: { line: to.line + 1, column: to.character + 1 },
      }
    }
    const base = {
      engine: "typescript",
      projectRoot: root,
      configPath: config ?? null,
      path: file,
      hash: hashBytes(Buffer.from(source.text)),
    }
    const page = <T>(items: readonly T[]) => ({
      items: items.slice(0, maxResults),
      total: items.length,
      truncated: items.length > maxResults,
    })
    const position = () => {
      const { line, column } = req
      if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line! < 1 || column! < 1)
        throw new Error("line and column must be positive 1-based UTF-16 positions")
      const starts = source.getLineStarts()
      if (line! > starts.length) throw new Error("line is out of range")
      const start = starts[line! - 1]!
      const end =
        line! < starts.length
          ? starts[line!]! - (source.text[starts[line!]! - 2] === "\r" ? 2 : 1)
          : source.text.length
      if (start + column! - 1 > end) throw new Error("column is out of range")
      return start + column! - 1
    }
    switch (req.action) {
      case "outline": {
        // TypeScript's navigation tree is constructed from its parsed AST, not text matching.
        const symbols: Array<{
          name: string
          kind: string
          container: string | null
          range: ReturnType<typeof location>
        }> = []
        const walk = (node: ts.NavigationTree, parent: string | null) => {
          for (const child of node.childItems ?? []) {
            for (const span of child.spans)
              symbols.push({
                name: child.text,
                kind: child.kind,
                container: parent,
                range: location(file, span),
              })
            walk(child, child.text)
          }
        }
        walk(service.getNavigationTree(file), null)
        return { ...base, ...page(symbols) }
      }
      case "definition": {
        const definitions = service.getDefinitionAtPosition(file, position()) ?? []
        return {
          ...base,
          ...page(
            definitions.map((d) => ({
              ...location(d.fileName, d.textSpan),
              name: d.name,
              kind: d.kind,
            })),
          ),
        }
      }
      case "references": {
        const references = service.getReferencesAtPosition(file, position()) ?? []
        return {
          ...base,
          ...page(
            references.map((r) => ({
              ...location(r.fileName, r.textSpan),
              isWriteAccess: r.isWriteAccess,
            })),
          ),
        }
      }
      case "diagnostics": {
        const diagnostics = [
          ...configErrors,
          ...service.getCompilerOptionsDiagnostics(),
          ...service.getSyntacticDiagnostics(file),
          ...service.getSemanticDiagnostics(file),
        ]
        return {
          ...base,
          ...page(
            diagnostics.map((d) => ({
              code: d.code,
              category: ts.DiagnosticCategory[d.category].toLowerCase(),
              message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
              ...(d.file && d.start !== undefined
                ? { range: location(d.file.fileName, { start: d.start, length: d.length ?? 0 }) }
                : {}),
            })),
          ),
        }
      }
      case "rename_preview": {
        if (typeof req.newName !== "string" || req.newName.length > 200)
          throw new Error("newName must be a TypeScript/JavaScript identifier (max 200 characters)")
        const scanner = ts.createScanner(
          ts.ScriptTarget.Latest,
          false,
          ts.LanguageVariant.Standard,
          req.newName,
        )
        if (
          scanner.scan() !== ts.SyntaxKind.Identifier ||
          scanner.getTokenText() !== req.newName ||
          scanner.scan() !== ts.SyntaxKind.EndOfFileToken
        )
          throw new Error("newName must be a TypeScript/JavaScript identifier")
        const pos = position()
        const info = service.getRenameInfo(file, pos, { allowRenameOfImportPath: false })
        if (!info.canRename)
          return {
            ...base,
            canRename: false,
            reason: info.localizedErrorMessage,
            edits: [],
            truncated: false,
          }
        const locations = service.findRenameLocations(file, pos, false, false, true) ?? []
        if (locations.length > maxResults)
          throw new Error(
            `Rename preview has ${locations.length} edits, exceeding maxResults; no partial rename returned`,
          )
        const edits = locations.map((entry) => {
          if (isLibrary(resolve(entry.fileName)))
            throw new Error("Cannot rename installed TypeScript library declarations")
          const content = read(entry.fileName)
          if (content === undefined) throw new Error("Rename target is outside allowed projectRoot")
          const target = location(entry.fileName, entry.textSpan)
          return {
            ...target,
            range: target,
            hash: hashBytes(Buffer.from(content)),
            oldText: content.slice(
              entry.textSpan.start,
              entry.textSpan.start + entry.textSpan.length,
            ),
            newText: `${entry.prefixText ?? ""}${req.newName}${entry.suffixText ?? ""}`,
          }
        })
        return {
          ...base,
          canRename: true,
          preview: true,
          newName: req.newName,
          edits,
          total: edits.length,
          truncated: false,
        }
      }
    }
  } finally {
    service.dispose()
  }
}
