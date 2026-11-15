"use client"

import { useState, useTransition } from "react"
import { removeMemberAction } from "@/lib/actions/orgs"
import { ConfirmButton } from "@/components/ui/confirm-button"
import { showToast } from "@/components/ui/toast"

export function RemoveMemberButton({
  orgSlug,
  userId,
  name,
}: {
  orgSlug: string
  userId: string
  name: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <ConfirmButton
        label="Remove"
        confirmLabel={`Remove ${name}`}
        pendingLabel="Removing…"
        warning="They lose access to every room here. Their past messages stay."
        variant="ghost"
        pending={pending}
        onConfirm={() => {
          setError(null)
          startTransition(async () => {
            const result = await removeMemberAction({ orgSlug, userId })
            if (!result.ok) {
              setError(result.error ?? "Could not remove this person")
              return
            }
            showToast({ message: `${name} removed`, tone: "success" })
          })
        }}
      />
      {error ? (
        <span role="alert" className="text-[12px] text-danger">
          {error}
        </span>
      ) : null}
    </span>
  )
}
