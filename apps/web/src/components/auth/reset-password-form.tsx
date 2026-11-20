"use client"

import Link from "next/link"
import { useActionState } from "react"
import { updatePasswordAction } from "@/lib/actions/auth"
import { Button } from "@/components/ui/button"
import { Field, HelpText, Input } from "@/components/ui/field"
import { InlineAlert } from "@/components/ui/empty"
import type { ActionResult } from "@/lib/types"

export function ResetPasswordForm({ email }: { email: string | null }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updatePasswordAction,
    null,
  )
  return (
    <form action={action} className="space-y-4">
      {email ? <p className="font-mono text-[11px] text-faint">signed in as {email}</p> : null}
      <Field label="new password" htmlFor="reset-password" hint="8 characters or more">
        <Input
          id="reset-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </Field>
      <Field label="confirm password" htmlFor="reset-confirm">
        <Input
          id="reset-confirm"
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </Field>
      <HelpText>Changing your password signs you back in on this device.</HelpText>
      {state && !state.ok ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Set new password"}
      </Button>
      <p className="text-center font-mono text-[11px] text-faint">
        <Link href="/forgot-password" className="underline underline-offset-2 hover:text-text">
          request a new link
        </Link>
      </p>
    </form>
  )
}
