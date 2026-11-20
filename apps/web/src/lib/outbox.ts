"use client"

import { get, set } from "idb-keyval"

const KEY = "mesh:outbox:v1"

export interface OutboxItem {
  id: string
  orgSlug: string
  roomId: string
  content: string
  threadRootId: string | null
  createdAt: string
}

export async function readOutbox(): Promise<OutboxItem[]> {
  return (await get<OutboxItem[]>(KEY)) ?? []
}

export async function enqueueOutbox(item: OutboxItem): Promise<void> {
  const items = await readOutbox()
  if (items.some((existing) => existing.id === item.id)) return
  await set(KEY, [...items, item])
}

async function removeOutbox(id: string): Promise<void> {
  const items = await readOutbox()
  await set(
    KEY,
    items.filter((item) => item.id !== id),
  )
}

export async function flushOutbox(): Promise<{ sent: number; failed: number }> {
  const items = await readOutbox()
  let sent = 0
  let failed = 0
  for (const item of items) {
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgSlug: item.orgSlug,
          roomId: item.roomId,
          content: item.content,
          threadRootId: item.threadRootId,
          clientId: item.id,
        }),
      })
      if (response.ok) {
        await removeOutbox(item.id)
        sent++
      } else if (response.status === 400 || response.status === 404) {
        await removeOutbox(item.id)
        failed++
      } else {
        failed++
      }
    } catch {
      failed++
    }
  }
  return { sent, failed }
}
