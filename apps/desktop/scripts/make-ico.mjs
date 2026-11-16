/**
 * Wraps assets/icon.png in a Vista-style PNG-in-ICO so electron-builder can brand the Windows exe.
 * Width and height 0 mean 256px, which is what Windows uses for the large icon.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const png = readFileSync(join(root, "assets", "icon.png"))
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)
const entry = Buffer.alloc(16)
entry.writeUInt8(0, 0)
entry.writeUInt8(0, 1)
entry.writeUInt8(0, 2)
entry.writeUInt8(0, 3)
entry.writeUInt16LE(1, 4)
entry.writeUInt16LE(32, 6)
entry.writeUInt32LE(png.length, 8)
entry.writeUInt32LE(22, 12)
writeFileSync(join(root, "build", "icon.ico"), Buffer.concat([header, entry, png]))
