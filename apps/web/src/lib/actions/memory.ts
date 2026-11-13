"use server"

import { revalidatePath } from "next/cache"
import { redactSecrets } from "@sayabot/core"
import { getOrgAccess, getRoomAccess } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { errorMessage, fail, ok } from "@/lib/actions/shared"
import type { ActionResult } from "@/lib/types"

export interface RememberInput {
  orgSlug: string
  roomId?: string
  agentId?: string
  scope?: "agent" | "room" | "org"
  title?: string
  body: string
  tags?: string[]
}

export async function rememberAction(input: RememberInput): Promise<ActionResult> {
  try {
    const access = input.roomId
      ? await getRoomAccess(input.orgSlug, input.roomId)
      : await getOrgAccess(input.orgSlug)

    if (!access) return fail("Unauthorized or room not found")

    const rawBody = input.body.trim()
    if (!rawBody) return fail("Memory text cannot be empty")
    if (rawBody.length > 2048) return fail("Memory text must be under 2048 characters")

    const redactedTitle = redactSecrets(
      (input.title?.trim() || rawBody.slice(0, 80)).replace(/\n/g, " "),
    ).text
    const redactedBody = redactSecrets(rawBody).text

    const admin = createAdminClient()
    const scope = input.scope ?? (input.roomId ? "room" : input.agentId ? "agent" : "org")

    const { data, error } = await admin
      .from("memories")
      .insert({
        org_id: access.org.id,
        room_id: input.roomId ?? null,
        agent_id: input.agentId ?? null,
        scope,
        kind: "fact",
        title: redactedTitle,
        body: redactedBody,
        tags: input.tags ?? [],
        source: "human",
        confidence: 1.0,
        pinned: false,
        created_by_user_id: access.user.id,
      })
      .select("id")
      .single()

    if (error) return fail(error.message)

    if (input.roomId) {
      revalidatePath(`/${input.orgSlug}/rooms/${input.roomId}`)
    }
    revalidatePath(`/${input.orgSlug}/agents`)

    return ok("Saved to memory", { memoryId: data.id })
  } catch (err) {
    return fail(errorMessage(err))
  }
}

export async function deleteMemoryAction(orgSlug: string, memoryId: string): Promise<ActionResult> {
  try {
    const access = await getOrgAccess(orgSlug)
    if (!access) return fail("Unauthorized")

    const admin = createAdminClient()
    const { error } = await admin
      .from("memories")
      .delete()
      .eq("id", memoryId)
      .eq("org_id", access.org.id)

    if (error) return fail(error.message)
    revalidatePath(`/${orgSlug}/settings`)
    return ok("Memory deleted")
  } catch (err) {
    return fail(errorMessage(err))
  }
}

export async function togglePinMemoryAction(
  orgSlug: string,
  memoryId: string,
  pinned: boolean,
): Promise<ActionResult> {
  try {
    const access = await getOrgAccess(orgSlug)
    if (!access) return fail("Unauthorized")

    const admin = createAdminClient()
    const { error } = await admin
      .from("memories")
      .update({ pinned, updated_at: new Date().toISOString() })
      .eq("id", memoryId)
      .eq("org_id", access.org.id)

    if (error) return fail(error.message)
    revalidatePath(`/${orgSlug}/settings`)
    return ok(pinned ? "Memory pinned" : "Memory unpinned")
  } catch (err) {
    return fail(errorMessage(err))
  }
}
