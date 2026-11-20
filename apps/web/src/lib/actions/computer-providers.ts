"use server"

import { revalidatePath } from "next/cache"
import { getOrgAccess } from "@/lib/auth"
import { audit, adminOrgAccess, fail, ok } from "@/lib/actions/shared"
import { loadComputerProviders } from "@/lib/computer-providers"
import type { ComputerProvidersView } from "@/lib/computer-providers-shared"
import { computerProviderUpdate, type ComputerProvider } from "@/lib/computer-settings"
import { getInternalSecret, getKek, getOrchestratorUrl } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ActionResult } from "@/lib/types"

const PROVIDERS = new Set<ComputerProvider>(["boat", "e2b", "vps"])
const LABEL: Record<ComputerProvider, string> = { boat: "Boat", e2b: "E2B", vps: "Server" }

/**
 * A bot remembers that its container or sandbox is ready. After the server or key changes that
 * memory points at the old one, so it is dropped and the next select_computer opens a fresh one.
 */
async function forgetReadyDesktops(orgId: string, provider: ComputerProvider): Promise<void> {
  if (provider === "boat") return // A Boat id stays valid across keys of the same account; the Boat code re-checks it.
  const admin = createAdminClient()
  const { data } = await admin.from("agents").select("id, params").eq("org_id", orgId).limit(1000)
  for (const agent of data ?? []) {
    const params = (agent.params as Record<string, unknown> | null) ?? {}
    const computer =
      params.computer && typeof params.computer === "object"
        ? { ...(params.computer as Record<string, unknown>) }
        : null
    if (!computer) continue
    if (provider === "vps" && computer.vpsReady === true) {
      computer.vpsReady = false
    } else if (
      provider === "e2b" &&
      (computer.e2bReady === true || typeof computer.e2bId === "string")
    ) {
      delete computer.e2bId
      computer.e2bReady = false
    } else {
      continue
    }
    await admin
      .from("agents")
      .update({ params: { ...params, computer } })
      .eq("id", agent.id)
  }
}

/** Saves one provider's row of Settings → Computers. Admins only. */
export async function saveComputerProviderAction(input: {
  orgSlug: string
  provider: ComputerProvider
  token?: string
  clear?: boolean
  address?: string
  alias?: string
  privateKey?: string
  clearKey?: boolean
  startAutomatically?: boolean
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  if (!PROVIDERS.has(input.provider)) return fail("Pick a provider")
  const built = computerProviderUpdate({
    orgId: check.access.org.id,
    provider: input.provider,
    token: input.token,
    clear: input.clear,
    address: input.address,
    alias: input.alias,
    privateKey: input.privateKey,
    clearKey: input.clearKey,
    startAutomatically: input.startAutomatically,
    kek: getKek(),
  })
  if (!built.ok) return fail(built.error)
  const { error } = await createAdminClient()
    .from("org_computer_settings")
    .upsert(built.row, { onConflict: "org_id" })
  if (error) return fail("Could not save. Is migration 0039 applied?")
  await forgetReadyDesktops(check.access.org.id, input.provider)
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "computers.provider_changed",
    target: check.access.org.id,
    metadata: {
      provider: input.provider,
      cleared: Boolean(input.clear),
      key: Boolean(input.token?.trim() || input.privateKey?.trim()),
      address: typeof built.row.vps_host === "string" ? built.row.vps_host : undefined,
    },
  })
  revalidatePath(`/${input.orgSlug}/settings/keys`)
  revalidatePath(`/${input.orgSlug}/settings/computers`)
  return ok(input.clear ? `${LABEL[input.provider]} removed` : `${LABEL[input.provider]} saved`)
}

/** Status for the Works on picker. Any member may see it; it holds no secrets. */
export async function getComputerProvidersAction(
  orgSlug: string,
): Promise<ComputerProvidersView | null> {
  const access = await getOrgAccess(orgSlug)
  if (!access) return null
  return loadComputerProviders(access.org.id)
}

/**
 * "Check" on a provider row. The VPS is checked by the orchestrator, the machine that will run
 * the bots' commands. An E2B key is checked by listing its sandboxes.
 */
export async function checkComputerProviderAction(input: {
  orgSlug: string
  provider: ComputerProvider
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  if (input.provider === "vps") {
    const response = await fetch(`${getOrchestratorUrl()}/internal/computers/vps/check`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": getInternalSecret() },
      body: JSON.stringify({ orgId: check.access.org.id }),
      signal: AbortSignal.timeout(35_000),
    }).catch(() => null)
    if (!response?.ok)
      return fail("The Sayabot server did not answer. Is the orchestrator running?")
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean
      error?: string
      docker?: string
    } | null
    if (!body?.ok) return fail(body?.error ?? "Could not reach the server")
    return ok(`Connected. Docker ${body.docker ?? "is ready"}.`)
  }
  if (input.provider === "e2b") {
    const { data } = await createAdminClient()
      .from("org_computer_settings")
      .select("e2b_ciphertext, e2b_iv, e2b_tag")
      .eq("org_id", check.access.org.id)
      .maybeSingle()
    const row = data as { e2b_ciphertext?: string; e2b_iv?: string; e2b_tag?: string } | null
    let key = process.env.E2B_API_KEY ?? ""
    if (row?.e2b_ciphertext && row.e2b_iv && row.e2b_tag) {
      const { decryptSecret } = await import("@sayabot/llm")
      try {
        key = decryptSecret(
          { ciphertext: row.e2b_ciphertext, iv: row.e2b_iv, tag: row.e2b_tag },
          getKek(),
        )
      } catch {
        return fail("The saved E2B key could not be opened. Save it again.")
      }
    }
    if (!key) return fail("No E2B key is saved yet")
    const response = await fetch("https://api.e2b.dev/v2/sandboxes?limit=1", {
      headers: { "X-API-Key": key },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null)
    if (!response) return fail("E2B did not answer")
    if (response.status === 401 || response.status === 403) return fail("E2B refused this key")
    if (!response.ok) return fail(`E2B answered ${response.status}`)
    return ok("E2B accepted this key")
  }
  return fail("Boat keys are checked the first time a bot opens a Boat")
}
