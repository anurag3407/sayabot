import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ComputerProvidersView } from "@/lib/computer-providers-shared"

/**
 * What Settings and the Works on picker show about the workspace's cloud desktops. Never a key:
 * only whether one is saved, its last four characters, and the server address.
 */
export async function loadComputerProviders(orgId: string): Promise<ComputerProvidersView> {
  const { data, error } = await createAdminClient()
    .from("org_computer_settings")
    .select(
      "boat_last4, e2b_last4, vps_ssh_alias, vps_host, vps_user, vps_port, vps_key_ciphertext, vps_start_automatically",
    )
    .eq("org_id", orgId)
    .maybeSingle()
  const row = (error ? null : data) as Record<string, unknown> | null
  const str = (value: unknown) => (typeof value === "string" && value ? value : null)
  const host = str(row?.vps_host)
  const user = str(row?.vps_user) ?? "root"
  const port = typeof row?.vps_port === "number" ? row.vps_port : 22
  const alias = str(row?.vps_ssh_alias)
  return {
    boat: {
      last4: str(row?.boat_last4),
      included: Boolean(process.env.SAYABOT_BOAT_TOKEN),
    },
    e2b: {
      last4: str(row?.e2b_last4),
      included: Boolean(process.env.E2B_API_KEY),
    },
    vps: {
      address: host ? `${user}@${host}${port === 22 ? "" : `:${port}`}` : null,
      alias,
      hasKey: Boolean(row?.vps_key_ciphertext),
      startAutomatically: row?.vps_start_automatically === true,
    },
  }
}
