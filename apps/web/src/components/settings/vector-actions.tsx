"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { deleteVectorProvider, setActiveVectorProvider, testVectorProvider } from "@/lib/actions/vector-keys"
import { Button } from "@/components/ui/button"
import type { ActionResult } from "@/lib/types"

export function SetActiveVectorButton({
  orgSlug,
  providerId,
  isActive,
}: {
  orgSlug: string
  providerId: string
  isActive: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function activate() {
    if (isActive) return
    setError(null)
    startTransition(async () => {
      const result = await setActiveVectorProvider({ orgSlug, providerId })
      if (!result.ok) {
        setError(result.error ?? "Failed to activate provider")
      } else {
        router.refresh()
      }
    })
  }

  if (isActive) {
    return (
      <span className="inline-flex items-center rounded-full bg-ok/10 px-2 py-0.5 font-mono text-[11px] font-medium text-ok">
        ● Active
      </span>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-[11px]"
        disabled={pending}
        onClick={activate}
      >
        {pending ? "Setting…" : "Set as Active"}
      </Button>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  )
}

export function TestVectorButton({
  orgSlug,
  providerId,
}: {
  orgSlug: string
  providerId: string
}) {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<ActionResult | null>(null)

  function test() {
    setResult(null)
    startTransition(async () => {
      const response = await testVectorProvider(orgSlug, providerId)
      setResult(response)
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={pending} onClick={test}>
        {pending ? "Testing…" : "Test Connection"}
      </Button>
      {result ? (
        <span
          role="status"
          className={
            result.ok
              ? "max-w-xs truncate text-[11px] text-ok"
              : "max-w-xs truncate text-[11px] text-danger"
          }
          title={result.ok ? result.message : result.error}
        >
          {result.ok ? result.message : result.error}
        </span>
      ) : null}
    </div>
  )
}

export function DeleteVectorButton({
  orgSlug,
  providerId,
}: {
  orgSlug: string
  providerId: string
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function remove() {
    setError(null)
    startTransition(async () => {
      const result = await deleteVectorProvider({ orgSlug, providerId })
      if (!result.ok) {
        setError(result.error ?? "Could not delete provider")
        setConfirming(false)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <Button size="sm" variant="danger" className="h-7 text-[11px]" disabled={pending} onClick={remove}>
            {pending ? "Deleting…" : "Confirm"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px]"
            onClick={() => setConfirming(false)}
            disabled={pending}
          >
            Cancel
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px] text-danger"
          onClick={() => setConfirming(true)}
        >
          Delete
        </Button>
      )}
      {error ? (
        <span role="alert" className="text-[11px] text-danger">
          {error}
        </span>
      ) : null}
    </div>
  )
}
