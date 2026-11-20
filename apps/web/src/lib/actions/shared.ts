import "server-only"
import { revalidatePath } from "next/cache"
import { isOrgAdmin, getOrgAccess, getRoomAccess } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import type { OrgAccess, RoomAccess } from "@/lib/types"
import type { ActionResult } from "@/lib/types"

export function ok(message?: string, data?: Record<string, unknown>): ActionResult {
  return { ok: true, message, data }
}

export function fail(error: string): ActionResult {
  return { ok: false, error }
}

export function field(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === "string" ? value.trim() : ""
}

export function optionalField(form: FormData, name: string): string | null {
  const value = field(form, name)
  return value === "" ? null : value
}

export function parseJsonObject(
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, value: {} }
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Expected a JSON object" }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, error: "Invalid JSON" }
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}

/** Top-level routes a workspace slug must never shadow. */
const RESERVED_SLUGS = new Set([
  "api",
  "auth",
  "forgot-password",
  "help",
  "login",
  "new-workspace",
  "offline",
  "onboarding",
  "privacy",
  "reset-password",
  "security",
  "signup",
  "terms",
])

export async function uniqueOrgSlug(base: string): Promise<string> {
  const admin = createAdminClient()
  const root = slugify(base) || "workspace"
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`
    if (RESERVED_SLUGS.has(candidate)) continue
    const { data } = await admin.from("orgs").select("id").eq("slug", candidate).maybeSingle()
    if (!data) return candidate
  }
  return `${root}-${Date.now().toString(36)}`
}

export async function adminOrgAccess(
  slug: string,
): Promise<{ access: OrgAccess } | { error: string }> {
  const access = await getOrgAccess(slug)
  if (!access) return { error: "Organization not found" }
  if (!isOrgAdmin(access.role)) return { error: "Only organization admins can do this" }
  return { access }
}

export async function adminRoomAccess(
  slug: string,
  roomId: string,
): Promise<{ access: RoomAccess } | { error: string }> {
  const access = await getRoomAccess(slug, roomId)
  if (!access) return { error: "Room not found" }
  if (!access.canAdmin) return { error: "Only room or organization admins can do this" }
  return { access }
}

export async function audit(args: {
  orgId: string
  actorType?: string
  actorId: string | null
  action: string
  target?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  const admin = createAdminClient()
  try {
    await admin.from("audit_logs").insert({
      org_id: args.orgId,
      actor_type: args.actorType ?? "user",
      actor_id: args.actorId,
      action: args.action,
      target: args.target ?? null,
      metadata: args.metadata ?? {},
    })
  } catch (error) {
    console.error("[audit] failed", error)
  }
}

export function revalidateOrg(orgSlug: string): void {
  revalidatePath(`/${orgSlug}`, "layout")
}
