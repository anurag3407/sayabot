"use client"

import { useState, useTransition } from "react"
import { deleteProviderKey, testProviderKey } from "@/lib/actions/keys"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import type { ActionResult } from "@/lib/types"

export function TestKeyButton({
  orgSlug,
  keyId,
  provider,
}: {
  orgSlug: string
  keyId: string
  provider: string
}) {
  const [model, setModel] = useState("")
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<ActionResult | null>(null)

  function test() {
    setResult(null)
    startTransition(async () => {
      const response = await testProviderKey(orgSlug, keyId, model || undefined)
      setResult(response)
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {provider === "openai-compatible" ? (
        <Input
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="model to test"
          className="h-7 w-44 text-[12px]"
          aria-label="Model to test"
        />
      ) : null}
      <Button size="sm" variant="outline" className="md:h-7" disabled={pending} onClick={test}>
        {pending ? "Testing…" : "Test"}
      </Button>
      {result ? (
        <span
          role="status"
          className={result.ok ? "max-w-xs text-[12px] text-ok" : "max-w-xs text-[12px] text-danger"}
        >
          {result.ok ? result.message : result.error}
        </span>
      ) : null}
    </div>
  )
}

export function DeleteKeyButton({ orgSlug, keyId }: { orgSlug: string; keyId: string }) {
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function remove() {
    setError(null)
    startTransition(async () => {
      const result = await deleteProviderKey({ orgSlug, keyId })
      if (!result.ok) {
        setError(result.error ?? "Could not delete the key")
        setConfirming(false)
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <Button size="sm" variant="danger" className="md:h-7" disabled={pending} onClick={remove}>
            {pending ? "Deleting…" : "Confirm delete"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="md:h-7"
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
          className="text-danger md:h-7"
          onClick={() => setConfirming(true)}
        >
          Delete
        </Button>
      )}
      {error ? (
        <span role="alert" className="text-[12px] text-danger">
          {error}
        </span>
      ) : null}
    </div>
  )
}
