"use client"

import { useState, useTransition } from "react"
import { requestJoinAction } from "@/lib/actions/workspace-invites"
import { Button } from "@/components/ui/button"

export function JoinButton({ code, again = false }: { code: string; again?: boolean }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  if (done) return <p className="mt-4 text-[14px] text-text">{done}</p>
  return (
    <>
      {again ? (
        <p className="mt-4 text-[13px] text-muted">
          An admin declined this request. You can ask again.
        </p>
      ) : null}
      <Button
        className="mt-6 w-full"
        size="lg"
        variant="primary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await requestJoinAction(code)
            if (result && !result.ok) {
              setError(result.error ?? "Could not ask to join")
              return
            }
            setDone(result?.message ?? "Waiting for a workspace admin to approve you.")
          })
        }
      >
        {pending ? "Asking…" : again ? "Ask again" : "Ask to join"}
      </Button>
      {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}
    </>
  )
}
