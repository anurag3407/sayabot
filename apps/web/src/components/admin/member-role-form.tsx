"use client"

import { useActionState } from "react"
import { setMemberRole } from "@/lib/actions/orgs"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/field"
import type { ActionResult, OrgRole } from "@/lib/types"

export function MemberRoleForm({
  orgSlug,
  userId,
  role,
  allowOwner,
}: {
  orgSlug: string
  userId: string
  role: OrgRole
  allowOwner: boolean
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(setMemberRole, null)

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="userId" value={userId} />
      <label htmlFor={`role-${userId}`} className="sr-only">
        Role for this member
      </label>
      <Select
        id={`role-${userId}`}
        name="role"
        defaultValue={role}
        className="h-7 w-28 text-[12px]"
      >
        <option value="member">member</option>
        <option value="admin">admin</option>
        {allowOwner ? <option value="owner">owner</option> : null}
      </Select>
      <Button type="submit" size="sm" variant="outline" className="h-7" disabled={pending}>
        {pending ? "saving" : "save"}
      </Button>
      {state && !state.ok ? (
        <span role="alert" className="text-[12px] text-danger">
          {state.error}
        </span>
      ) : null}
      {state?.ok ? <span className="text-[12px] text-ok">saved</span> : null}
    </form>
  )
}
