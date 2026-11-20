"use client"

import { useActionState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { ConfirmButton } from "@/components/ui/confirm-button"
import { InlineAlert } from "@/components/ui/empty"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"
import type { ActionResult } from "@/lib/types"

export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Saving…",
  className,
  resetOnSuccess = false,
  footer,
  submitVariant = "primary",
  confirmLabel,
  confirmWarning,
}: {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>
  children: React.ReactNode
  submitLabel: string
  pendingLabel?: string
  className?: string
  resetOnSuccess?: boolean
  footer?: React.ReactNode
  submitVariant?: "primary" | "secondary" | "outline" | "danger"
  /** Ask for a second click before submitting, for changes that are hard to undo. */
  confirmLabel?: string
  confirmWarning?: string
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null)
  const ref = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (!state?.ok) return
    if (resetOnSuccess) ref.current?.reset()
    if (state.message) showToast({ message: state.message, tone: "success" })
  }, [state, resetOnSuccess])

  return (
    <form ref={ref} action={formAction} className={cn("space-y-3", className)}>
      {children}
      {state && !state.ok ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      {state?.ok && state.warning ? (
        <InlineAlert tone="warning">{state.warning}</InlineAlert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {confirmLabel ? (
          <ConfirmButton
            submit
            label={submitLabel}
            confirmLabel={confirmLabel}
            pendingLabel={pendingLabel}
            warning={confirmWarning}
            pending={pending}
            variant={submitVariant}
          />
        ) : (
          <Button type="submit" variant={submitVariant} size="sm" disabled={pending}>
            {pending ? pendingLabel : submitLabel}
          </Button>
        )}
        {footer}
      </div>
    </form>
  )
}
