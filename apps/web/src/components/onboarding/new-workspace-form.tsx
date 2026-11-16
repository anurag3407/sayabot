"use client"

import { useActionState } from "react"
import { createOrg } from "@/lib/actions/orgs"
import { Button } from "@/components/ui/button"
import { InlineAlert } from "@/components/ui/empty"
import { Field, HelpText, Input } from "@/components/ui/field"
import { WorkspaceSkeleton } from "@/components/ui/skeleton"
import type { ActionResult } from "@/lib/types"

export function NewWorkspaceForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createOrg, null)
  if (pending) return <WorkspaceSkeleton label="Creating your workspace" />
  return (
    <form action={action} className="space-y-3">
      <Field label="workspace name" htmlFor="workspace-name">
        <Input
          id="workspace-name"
          name="name"
          required
          minLength={2}
          maxLength={60}
          autoFocus
          placeholder="Acme design team"
        />
      </Field>
      <HelpText>You can rename it later.</HelpText>
      {state && !state.ok ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      <Button type="submit" variant="primary" size="sm">
        Create workspace
      </Button>
    </form>
  )
}
