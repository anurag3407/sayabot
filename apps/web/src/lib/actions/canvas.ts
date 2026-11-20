"use server"

import { z } from "zod"
import { getRoomAccess } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { restoreCanvasInOrchestrator } from "@/lib/orchestrator"
import {
  adminRoomAccess,
  audit,
  errorMessage,
  fail,
  field,
  ok,
  optionalField,
  revalidateOrg,
} from "@/lib/actions/shared"
import type { ActionResult } from "@/lib/types"

const kindSchema = z.enum(["markdown", "code", "svg", "html"])

export async function createCanvas(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const roomId = field(formData, "roomId")
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail("Your session expired")
  const access = await getRoomAccess(orgSlug, roomId)
  if (!access) return fail("Room not found")
  const title = field(formData, "title")
  const kind = kindSchema.safeParse(field(formData, "kind") || "markdown")
  if (title.length < 1 || title.length > 60) return fail("Title must be 1 to 60 characters")
  if (!kind.success) return fail("Choose a valid canvas kind")
  const language = optionalField(formData, "language")
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("canvases")
    .insert({
      room_id: roomId,
      kind: kind.data,
      title,
      language: kind.data === "code" ? language : null,
      snapshot_text: "",
      created_by: user.id,
    })
    .select("id")
    .single()
  if (error || !data) return fail(errorMessage(error) || "Could not create the canvas")
  await audit({
    orgId: access.org.id,
    actorId: user.id,
    action: "canvas.created",
    target: data.id,
    metadata: { roomId, title, kind: kind.data },
  })
  revalidateOrg(orgSlug)
  return ok("Canvas created", { canvasId: data.id })
}

export async function restoreCanvasVersion(input: {
  orgSlug: string
  roomId: string
  versionId: string
}): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail("Your session expired")
  const access = await getRoomAccess(input.orgSlug, input.roomId)
  if (!access) return fail("Room not found")
  const { data: version } = await supabase
    .from("canvas_versions")
    .select("id, canvas_id, snapshot_text")
    .eq("id", input.versionId)
    .maybeSingle()
  if (!version) return fail("Version not found")
  const { data: canvas } = await supabase
    .from("canvases")
    .select("id, room_id")
    .eq("id", version.canvas_id)
    .maybeSingle()
  if (!canvas || canvas.room_id !== input.roomId) return fail("Version not found in this room")
  const result = await restoreCanvasInOrchestrator(canvas.id, user.id, version.snapshot_text)
  if (!result.ok) {
    return fail("The orchestrator could not restore the canvas. Is it running?")
  }
  await audit({
    orgId: access.org.id,
    actorId: user.id,
    action: "canvas.version_restored",
    target: canvas.id,
    metadata: { versionId: version.id },
  })
  revalidateOrg(input.orgSlug)
  return ok("Version restored")
}

export async function deleteCanvasAction(input: {
  orgSlug: string
  roomId: string
  canvasId: string
}): Promise<ActionResult> {
  const check = await adminRoomAccess(input.orgSlug, input.roomId)
  if ("error" in check) return fail(check.error)
  const admin = createAdminClient()
  const { data: canvas } = await admin
    .from("canvases")
    .select("id, title, room_id")
    .eq("id", input.canvasId)
    .maybeSingle()
  if (!canvas || canvas.room_id !== input.roomId) return fail("Canvas not found")
  const { error } = await admin.from("canvases").delete().eq("id", input.canvasId)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "canvas.deleted",
    target: input.canvasId,
    metadata: { roomId: input.roomId, title: canvas.title },
  })
  revalidateOrg(input.orgSlug)
  return ok("Canvas deleted")
}
