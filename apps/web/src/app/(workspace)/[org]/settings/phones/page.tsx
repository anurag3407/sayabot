import type { Metadata } from "next"
import { requireOrgAccess } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { PhonesList } from "@/components/phones/phones-list"

export const metadata: Metadata = { title: "Phones" }

export default async function PhonesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAccess(orgSlug)
  const { data } = await createAdminClient()
    .from("device_pairings")
    .select("id, device_name, platform, paired_at, last_seen_at")
    .eq("user_id", access.user.id)
    .eq("status", "paired")
    .order("paired_at", { ascending: false })
  const phones = ((data ?? []) as { id: string; device_name: string | null; platform: string | null; paired_at: string | null; last_seen_at: string | null }[]).map((row) => ({
    id: row.id,
    deviceName: row.device_name ?? "Phone",
    platform: row.platform,
    pairedAt: row.paired_at,
    lastSeenAt: row.last_seen_at,
  }))
  return <PhonesList orgSlug={orgSlug} phones={phones} />
}
