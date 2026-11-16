"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { adminOrgAccess, audit, errorMessage, fail, ok, revalidateOrg } from "@/lib/actions/shared"
import type { ActionResult } from "@/lib/types"

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** Built-in procedures. A custom skill cannot take one of these names. */
const RESERVED_SLUGS = new Set([
  "write-and-run-tests",
  "open-pr",
  "research-citations",
  "summarise-thread",
  "canvas-landing-page",
])

function slugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

/**
 * The bot sidebar's "write a command". Saves an org skill the bot can load by slug.
 * The body is reference material, the same as a skill the bot proposes itself.
 */
export async function saveOrgSkillAction(input: {
  orgSlug: string
  name: string
  description: string
  body: string
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  const slug = slugFromName(input.name)
  if (!SLUG.test(slug)) return fail("Use a short name made of letters, numbers and hyphens")
  if (RESERVED_SLUGS.has(slug)) return fail("That name is reserved for a built-in skill")
  const description = input.description.trim().slice(0, 200)
  const body = input.body.trim().slice(0, 32_000)
  if (!description) return fail("Say what it does, in one line")
  if (!body) return fail("Write what the bot should do")
  const title = input.name.trim().replace(/^\//, "").slice(0, 120) || slug
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("skills")
    .insert({
      org_id: check.access.org.id,
      slug,
      title,
      description,
      body,
      visibility: "org",
      created_by: check.access.user.id,
    })
    .select("id, slug")
    .single()
  if (error || !data) {
    return fail(
      error?.code === "23505"
        ? "A skill with that name already exists"
        : error
          ? errorMessage(error)
          : "Could not save",
    )
  }
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "skill.created",
    target: slug,
    metadata: { skillId: data.id },
  })
  revalidateOrg(input.orgSlug)
  return ok(`/${slug} is ready`, { slug, skillId: data.id })
}
