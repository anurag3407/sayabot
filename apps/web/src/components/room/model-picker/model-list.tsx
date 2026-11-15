"use client"

import { useCallback, useEffect, useState } from "react"
import { Monitor } from "lucide-react"
import { ProviderIcon } from "./provider-icons"
import { SayabotMark } from "@/components/landing/sayabot-mark"
import type { PickerGroup } from "@/lib/model-catalog"

interface ModelList {
  groups: PickerGroup[]
  canManage: boolean
}

/** The last list per workspace, shown at once while a fresh one loads. */
const lastLists = new Map<string, ModelList>()

/** The workspace's model list (see /api/connectors/models), for Manage AI accounts. */
export function useModelList(orgSlug: string) {
  const [list, setList] = useState<ModelList | null>(() => lastLists.get(orgSlug) ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true)
      setError(null)
      try {
        const query = new URLSearchParams({ org: orgSlug, ...(refresh ? { refresh: "1" } : {}) })
        const response = await fetch(`/api/connectors/models?${query}`, { cache: "no-store" })
        const body = (await response.json().catch(() => null)) as (ModelList & { error?: string }) | null
        if (!response.ok || !body || !Array.isArray(body.groups)) {
          throw new Error(body?.error ?? `HTTP ${response.status}`)
        }
        const next = { groups: body.groups, canManage: Boolean(body.canManage) }
        lastLists.set(orgSlug, next)
        setList(next)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load the model list")
      } finally {
        setLoading(false)
      }
    },
    [orgSlug],
  )

  useEffect(() => {
    void load()
  }, [load])

  return { list, loading, error, reload: load }
}

export function GroupIcon({ provider, size = 20 }: { provider: string; size?: 16 | 20 }) {
  const box = size === 16 ? "h-4 w-4" : "h-5 w-5"
  if (provider === "saya") return <SayabotMark className={box} />
  if (provider === "computer") return <Monitor className={box} />
  return <ProviderIcon provider={provider} size={size} />
}
