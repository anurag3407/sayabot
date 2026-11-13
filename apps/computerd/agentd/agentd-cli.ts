import { readFileSync, unlinkSync } from "node:fs"
import { createConnection } from "node:net"
import { StringDecoder } from "node:string_decoder"

const socketPath = process.env.AGENTD_SOCK || "/run/agentd.sock"

/**
 * The request arrives as one or more argv chunks (joined in order), or as `@<path>` to a file
 * that is read and deleted. A single argv string is capped at 128 KiB on Linux, so callers
 * split large requests (file writes, patches) instead of failing with E2BIG.
 */
function readRequest(args: string[]): string {
  const [first] = args
  if (args.length === 1 && first?.startsWith("@")) {
    const path = first.slice(1)
    const text = readFileSync(path, "utf8")
    try {
      unlinkSync(path)
    } catch {}
    return text
  }
  return args.join("")
}

const input = readRequest(process.argv.slice(2))
let request: { op?: string; timeoutMs?: number }
try {
  request = JSON.parse(input)
  if (!request || typeof request !== "object") throw new Error("Expected an object")
} catch {
  console.error("Usage: agentd-cli <json-object>")
  process.exit(1)
}
const client = createConnection(socketPath, () => client.write(input.trim() + "\n"))
const decoder = new StringDecoder("utf8")
let buffer = ""
let complete = false
client.setTimeout(Math.min(Math.max(request.timeoutMs ?? 60_000, 1000), 300_000) + 15_000)
client.on("timeout", () => client.destroy(new Error("agentd response timed out")))
client.on("data", (data) => {
  buffer += decoder.write(data)
  const lines = buffer.split("\n")
  buffer = lines.pop() || ""
  for (const line of lines) {
    if (!line.trim() || complete) continue
    try {
      const frame = JSON.parse(line)
      process.stdout.write(line + "\n")
      if (request.op !== "exec" || frame.t === "exit" || "error" in frame) {
        complete = true
        client.end()
      }
    } catch {
      client.destroy(new Error("Invalid agentd response"))
    }
  }
})
client.on("end", () => {
  if (!complete) {
    console.error("agentd closed without a complete response")
    process.exitCode = 1
  }
})
client.on("error", (err) => {
  console.error(`[agentd-cli] ${err.message}`)
  process.exitCode = 1
})
