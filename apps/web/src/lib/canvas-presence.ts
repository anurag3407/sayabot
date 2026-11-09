/** Turns Yjs awareness states into the named cursors shown on a shared canvas. */

const PALETTE = ["#ff7a45", "#7dd3c0", "#b79cf5", "#ffd08a", "#7fb2ff", "#f08fb0", "#a6d86f", "#f5b26b"]
const FALLBACK = PALETTE[0]!

export interface CanvasPeer {
  clientId: number
  userId: string
  name: string
  color: string
}

export function colorForUser(userId: string): string {
  let hash = 0
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length] ?? FALLBACK
}

/** Awareness is written by other clients, so every field is untrusted here. */
export function peersFromAwareness(states: Map<number, unknown>, selfClientId: number): CanvasPeer[] {
  const peers: CanvasPeer[] = []
  for (const [clientId, state] of states) {
    if (clientId === selfClientId || !Number.isInteger(clientId)) continue
    const user = (state as { user?: Record<string, unknown> } | null)?.user
    if (!user || typeof user.name !== "string") continue
    const color = typeof user.color === "string" && /^#[0-9a-f]{6}$/i.test(user.color) ? user.color : FALLBACK
    peers.push({
      clientId,
      userId: typeof user.id === "string" ? user.id : String(clientId),
      name: user.name.slice(0, 60) || "someone",
      color,
    })
  }
  return peers
}

function cssLabel(name: string): string {
  const safe = name.replace(/[^\p{L}\p{M}\p{N} ._'-]/gu, "").trim().slice(0, 32)
  return `"${safe || "someone"}"`
}

/** y-monaco only adds per-client class names; the colours and labels have to come from us. */
export function remoteCursorCss(peers: CanvasPeer[]): string {
  return peers
    .map(({ clientId, color, name }) => {
      const head = `.yRemoteSelectionHead-${clientId}`
      return [
        `.yRemoteSelection-${clientId}{background:${color}40}`,
        `${head}{position:absolute;height:100%;box-sizing:border-box;border-left:2px solid ${color}}`,
        `${head}::after{content:${cssLabel(name)};position:absolute;top:-1.35em;left:-2px;padding:0 4px;border-radius:3px 3px 3px 0;background:${color};color:#0b0e0c;font:500 10px/1.35em var(--font-sans,sans-serif);white-space:nowrap;pointer-events:none}`,
      ].join("")
    })
    .join("\n")
}
