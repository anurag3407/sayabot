/** Same shape as packages/core LocalWorkspaceSnapshot. Desktop's tsconfig cannot import that package. */
export interface LocalWorkspaceSnapshot {
  bots: Array<{ id: string }>
  chats: Array<{ id: string }>
  routines: Array<{ id: string }>
  keys: Array<{ id: string }>
  /** Sealed Boat key and VPS name. A plaintext key is not stored here. */
  computers?: {
    boatCiphertext?: string | null
    boatIv?: string | null
    boatTag?: string | null
    boatLast4?: string | null
    vpsSshAlias?: string | null
    vpsStartAutomatically?: boolean
  } | null
}

export type HandoffStep = "copy_to_cloud" | "copy_back" | "none"

/** Same decision as planCloudHandoff in @sayabot/core. */
function planCloudHandoff(input: {
  cloudReady: boolean
  planActive: boolean
  copied: boolean
}): HandoffStep {
  if (input.copied && !input.planActive) return "copy_back"
  if (input.cloudReady && input.planActive && !input.copied) return "copy_to_cloud"
  return "none"
}

/** Keeps a sealed Boat key and a VPS name. A plaintext key is dropped. */
export function computersFromRecord(value: unknown): LocalWorkspaceSnapshot["computers"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if ("boatToken" in row || "token" in row) return null
  const text = (key: string) =>
    typeof row[key] === "string" && row[key] ? (row[key] as string) : null
  const boatCiphertext = text("boatCiphertext")
  const boatIv = text("boatIv")
  const boatTag = text("boatTag")
  const boatLast4 = text("boatLast4")
  const sealed = Boolean(boatCiphertext && boatIv && boatTag && boatLast4)
  const vpsSshAlias =
    typeof row.vpsSshAlias === "string" && /^[A-Za-z0-9_.:@-]+$/.test(row.vpsSshAlias)
      ? row.vpsSshAlias
      : null
  if (!sealed && !vpsSshAlias) return null
  return {
    boatCiphertext: sealed ? boatCiphertext : null,
    boatIv: sealed ? boatIv : null,
    boatTag: sealed ? boatTag : null,
    boatLast4: sealed ? boatLast4 : null,
    vpsSshAlias,
    vpsStartAutomatically: row.vpsStartAutomatically === true,
  }
}

export function snapshotHasRecords(snapshot: LocalWorkspaceSnapshot): boolean {
  return (
    snapshot.bots.some((row) => "handle" in row) ||
    snapshot.chats.some((row) => "name" in row) ||
    snapshot.routines.some((row) => "prompt" in row) ||
    snapshot.keys.some((row) => "ciphertext" in row) ||
    Boolean(snapshot.computers?.boatCiphertext || snapshot.computers?.vpsSshAlias)
  )
}

/** Reads this Mac's bots, chats, routines, and sealed keys from the server it is signed into. */
export async function fetchWorkspaceSnapshot(
  serverUrl: string,
  hostId: string,
  hostToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalWorkspaceSnapshot | null> {
  const res = await fetchImpl(`${serverUrl.replace(/\/+$/, "")}/api/desktop/workspace-snapshot`, {
    headers: { "x-host-id": hostId, "x-host-token": hostToken },
  })
  if (!res.ok) return null
  const body = (await res.json()) as { snapshot?: LocalWorkspaceSnapshot }
  return body.snapshot && snapshotHasRecords(body.snapshot) ? body.snapshot : null
}

/** Puts a returned copy onto the server this Mac is using now. Rows already there are left as they are. */
export async function importWorkspaceSnapshot(input: {
  serverUrl: string
  hostId: string
  hostToken: string
  snapshot: LocalWorkspaceSnapshot
  fetch?: typeof fetch
}): Promise<boolean> {
  const fetchImpl = input.fetch ?? fetch
  const res = await fetchImpl(
    `${input.serverUrl.replace(/\/+$/, "")}/api/desktop/workspace-import`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-host-id": input.hostId,
        "x-host-token": input.hostToken,
      },
      body: JSON.stringify({ snapshot: input.snapshot }),
    },
  )
  return res.ok
}

export interface CloudHomeStatus {
  cloudReady: boolean
  planActive: boolean
  copied: boolean
}

/**
 * Asks the server once, then copies this Mac's snapshot up or writes the Cloud copy back down.
 * A second call while the plan is active does nothing.
 */
export async function syncCloudHandoff(input: {
  serverUrl: string
  hostId: string
  hostToken: string
  snapshot: LocalWorkspaceSnapshot
  writeSnapshot: (snapshot: LocalWorkspaceSnapshot) => void
  onCopiedBack?: () => void
  fetch?: typeof fetch
}): Promise<HandoffStep> {
  const fetchImpl = input.fetch ?? fetch
  const base = input.serverUrl.replace(/\/+$/, "")
  const headers = {
    "content-type": "application/json",
    "x-host-id": input.hostId,
    "x-host-token": input.hostToken,
  }
  const statusRes = await fetchImpl(`${base}/api/desktop/cloud-home`, { headers })
  if (!statusRes.ok) throw new Error(`Cloud home status ${statusRes.status}`)
  const status = (await statusRes.json()) as CloudHomeStatus
  const step = planCloudHandoff(status)
  if (step === "copy_to_cloud") {
    if (!snapshotHasRecords(input.snapshot)) throw new Error("Nothing on this Mac to copy")
    const saved = await fetchImpl(`${base}/api/desktop/cloud-home`, {
      method: "POST",
      headers,
      body: JSON.stringify({ snapshot: input.snapshot }),
    })
    if (!saved.ok) throw new Error(`Cloud copy failed (${saved.status})`)
  }
  if (step === "copy_back") {
    const back = await fetchImpl(`${base}/api/desktop/cloud-home`, { method: "DELETE", headers })
    if (!back.ok) throw new Error(`Cloud copy-back failed (${back.status})`)
    const body = (await back.json()) as { snapshot?: LocalWorkspaceSnapshot }
    if (body.snapshot) input.writeSnapshot(body.snapshot)
    input.onCopiedBack?.()
  }
  return step
}

/**
 * Asks the current server for the copy when this Mac points somewhere else.
 * An active plan stays on Cloud. The copy comes back only after the plan has ended.
 */
export async function leaveCloudHome(input: {
  nextEdition: string
  serverUrl: string
  hostId: string
  hostToken: string
  snapshot: LocalWorkspaceSnapshot
  writeSnapshot: (snapshot: LocalWorkspaceSnapshot) => void
  fetch?: typeof fetch
}): Promise<boolean> {
  if (input.nextEdition === "cloud") return false
  const step = await syncCloudHandoff({
    serverUrl: input.serverUrl,
    hostId: input.hostId,
    hostToken: input.hostToken,
    snapshot: input.snapshot,
    writeSnapshot: input.writeSnapshot,
    fetch: input.fetch,
  })
  return step === "copy_back"
}
