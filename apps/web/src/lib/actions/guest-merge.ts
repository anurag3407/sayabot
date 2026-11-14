"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { completeGuestMerge, MERGE_COOKIE } from "@/lib/guest-merge"
import { safeNextPath } from "@/lib/safe-next"

/** Confirm step of the guest → account merge (/auth/merge/finish). */
export async function confirmGuestMergeAction(formData: FormData): Promise<void> {
  const raw = formData.get("next")
  const next = safeNextPath(typeof raw === "string" ? raw : "", "")
  const self = `/auth/merge/finish${next ? `?next=${encodeURIComponent(next)}` : ""}`

  const user = await getCurrentUser()
  if (!user || user.is_anonymous === true) {
    redirect(`/login?force=true&merge=1&next=${encodeURIComponent(self)}`)
  }

  const jar = await cookies()
  const token = jar.get(MERGE_COOKIE)?.value
  if (!token) redirect(self)

  const outcome = await completeGuestMerge(token, user.id)
  if (!outcome.ok) {
    const sep = self.includes("?") ? "&" : "?"
    redirect(`${self}${sep}error=${encodeURIComponent(outcome.error)}`)
  }

  jar.delete(MERGE_COOKIE)
  // Desktop flow passes next=/auth/desktop (hands the new login back to the app); otherwise
  // open the workspace that just moved over.
  redirect(next || (outcome.firstWorkspaceSlug ? `/${outcome.firstWorkspaceSlug}` : "/"))
}
