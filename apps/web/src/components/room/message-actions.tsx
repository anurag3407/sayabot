"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { retryMessageAction, sendMessage } from "@/lib/actions/messages"
import { Button } from "@/components/ui/button"
import { recoveryHint } from "@/lib/recovery-hint"
import { InspectTraceButton } from "@/components/trace/inspect-trace-button"

/** The way forward from a failed agent turn: send it again, or go to where it can be fixed. */
export function FailureActions({
  orgSlug,
  roomId,
  messageId,
  runId,
  text,
  reason,
  canAdmin,
  showRetry,
}: {
  orgSlug: string
  roomId: string
  messageId: string
  runId?: string | null
  text: string
  reason: string | null
  canAdmin: boolean
  showRetry: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const hint = canAdmin ? recoveryHint({ text, reason, orgSlug, roomId }) : null
  if (!showRetry && !hint) return null

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <InspectTraceButton
        orgSlug={orgSlug}
        runId={runId}
        messageId={messageId}
        label="Inspect Failure"
        variant="danger"
        size="xs"
      />
      {showRetry ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setError(null)
            startTransition(async () => {
              const result = await retryMessageAction({ orgSlug, roomId, messageId })
              if (!result.ok) setError(result.error ?? "Could not retry")
            })
          }}
        >
          {pending ? "Retrying…" : "Retry"}
        </Button>
      ) : null}
      {hint ? (
        <Link
          href={hint.href}
          className="font-mono text-[12px] text-accent underline underline-offset-4"
        >
          {hint.label}
        </Link>
      ) : null}
      {error ? (
        <span role="alert" className="text-[12px] text-danger">
          {error}
        </span>
      ) : null}
    </div>
  )
}

/** One-click wake-up for a bot that went quiet on its turn. */
export function PokeBotButton({
  orgSlug,
  roomId,
  handle,
  threadRootId,
}: {
  orgSlug: string
  roomId: string
  handle: string
  threadRootId: string | null
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle")
  async function poke() {
    setState("sending")
    const result = await sendMessage({
      orgSlug,
      roomId,
      threadRootId,
      content: `@${handle} are you still there? Pick up where you left off and post an update.`,
    })
    setState(result.ok ? "sent" : "failed")
  }
  return (
    <div className="mt-2 flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={state === "sending" || state === "sent"} onClick={poke}>
        {state === "sent" ? "Poked" : state === "sending" ? "Poking…" : `Poke @${handle}`}
      </Button>
      {state === "failed" ? <span className="text-[12px] text-danger">Could not send the poke</span> : null}
    </div>
  )
}
