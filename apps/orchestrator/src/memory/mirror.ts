import { createHash } from "node:crypto"
import type { ComputerClient } from "../computer/client"
import { getMemoryService } from "./service"

const ROOT = "/home/bot/.saaya/memory"

/** Last mirrored content hash per agent, so unchanged memory costs no computer calls. */
const lastMirrorHash = new Map<string, string>()

export type MirrorClient = Pick<ComputerClient, "writeFile" | "exec">

export function mirrorFiles(mirror: {
  memoryMd: string
  openLoopsMd: string
  topics: Record<string, string>
}): Record<string, string> {
  const files: Record<string, string> = {
    [`${ROOT}/MEMORY.md`]: mirror.memoryMd,
    [`${ROOT}/OPEN_LOOPS.md`]: mirror.openLoopsMd,
  }
  for (const [tag, content] of Object.entries(mirror.topics)) {
    const safeTag = tag.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "untagged"
    const path = `${ROOT}/topics/${safeTag}.md`
    files[path] = files[path] ? `${files[path]}\n${content}` : content
  }
  return files
}

export function hashFiles(files: Record<string, string>): string {
  const hash = createHash("sha256")
  for (const path of Object.keys(files).sort()) {
    hash.update(path)
    hash.update("\0")
    hash.update(files[path] ?? "")
    hash.update("\0")
  }
  return hash.digest("hex")
}

/**
 * Mirrors the agent's room-independent memory into its persistent computer.
 * Rewrites only when the content changed, and clears the topics folder first so tags
 * that no longer exist (or room memories mirrored by older versions) do not linger.
 */
export async function syncMemoryMirror(args: {
  orgId: string
  agentId: string
  client: MirrorClient
}): Promise<"unchanged" | "written"> {
  const mirror = await getMemoryService().generateMemoryMirror({
    orgId: args.orgId,
    agentId: args.agentId,
  })
  const files = mirrorFiles(mirror)
  const hash = hashFiles(files)
  if (lastMirrorHash.get(args.agentId) === hash) return "unchanged"

  await args.client.exec(args.agentId, {
    cmd: `rm -rf ${ROOT}/topics ${ROOT}/rooms && mkdir -p ${ROOT}/topics`,
    timeoutMs: 15_000,
  })
  for (const [path, content] of Object.entries(files)) {
    await args.client.writeFile(args.agentId, { path, content, allowOverwriteLarge: true })
  }
  lastMirrorHash.set(args.agentId, hash)
  return "written"
}

export function resetMirrorCache(): void {
  lastMirrorHash.clear()
}
