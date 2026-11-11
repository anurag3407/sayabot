"use client"

import { useState, useTransition } from "react"
import { acceptInviteAction } from "@/lib/actions/workspace-invites"
import { Button } from "@/components/ui/button"

export function JoinButton({ code }: { code: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <Button
        className="mt-6 w-full"
        size="lg"
        variant="primary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            // On success the action redirects into the workspace.
            const result = await acceptInviteAction(code)
            if (result && !result.ok) setError(result.error ?? "Could not join")
          })
        }
      >
        {pending ? "Joining…" : "Join"}
      </Button>
      {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}
    </>
  )
}
