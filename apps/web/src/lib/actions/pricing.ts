"use server"

import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  adminOrgAccess,
  audit,
  errorMessage,
  fail,
  field,
  ok,
  revalidateOrg,
} from "@/lib/actions/shared"
import type { ActionResult } from "@/lib/types"

export async function upsertModelPricing(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)
  const provider = field(formData, "provider")
  const model = field(formData, "model")
  const input = z.coerce.number().min(0).max(10_000).safeParse(field(formData, "inputPerMtok"))
  const output = z.coerce.number().min(0).max(10_000).safeParse(field(formData, "outputPerMtok"))
  if (!provider || !model) return fail("Provider and model are required")
  if (!input.success || !output.success) return fail("Prices must be non-negative numbers")
  const admin = createAdminClient()
  const { error } = await admin.from("model_pricing").upsert(
    {
      provider,
      model,
      input_per_mtok: input.data,
      output_per_mtok: output.data,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider,model" },
  )
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "pricing.updated",
    target: `${provider}/${model}`,
    metadata: { input: input.data, output: output.data },
  })
  revalidateOrg(orgSlug)
  return ok("Price saved")
}
