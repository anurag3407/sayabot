import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type { AudioOutput, Voice } from "./types"

const execFileAsync = promisify(execFile)
const SAY = "/usr/bin/say"

export function isAvailable(platform = process.platform): boolean {
  return platform === "darwin"
}

export async function listVoices(): Promise<Voice[]> {
  if (!isAvailable()) return []
  try {
    const { stdout } = await execFileAsync(SAY, ["-v", "?"], { timeout: 5_000 })
    const voices: Voice[] = []
    for (const line of stdout.split("\n")) {
      const match = /^(.+?)\s{2,}(\S+)\s+#\s*(.+)$/.exec(line.trimEnd())
      if (!match || !match[1] || !match[2] || !match[3]) continue
      const name = match[1]
      const locale = match[2]
      const sample = match[3]
      const id = name.trim()
      if (!id) continue
      voices.push({ id, label: id, description: `${locale} — ${sample.trim()}` })
    }
    return voices
  } catch {
    return []
  }
}

export async function synthesize(text: string, voiceId?: string): Promise<AudioOutput> {
  if (!isAvailable()) {
    throw new Error("System voices are only available on macOS")
  }
  const trimmed = text.trim()
  if (!trimmed) return { bytes: Buffer.alloc(0), mime: "audio/wav" }

  const dir = await mkdtemp(join(tmpdir(), "sayabot-say-"))
  const out = join(dir, "speech.wav")
  try {
    const args = ["-o", out, "--data-format=LEI16@22050"]
    if (voiceId?.trim()) args.push("-v", voiceId.trim())
    args.push("--", trimmed)
    await execFileAsync(SAY, args, { timeout: 30_000 })
    const bytes = await readFile(out)
    return { bytes, mime: "audio/wav" }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
