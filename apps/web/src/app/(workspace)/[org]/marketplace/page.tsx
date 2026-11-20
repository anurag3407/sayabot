import { redirect } from "next/navigation"

export default async function MarketplacePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>
  searchParams: Promise<{ tab?: string; connected?: string; tools?: string; signin_error?: string }>
}) {
  const { org: orgSlug } = await params
  const sp = await searchParams
  const q = new URLSearchParams()
  if (sp.connected) q.set("connected", sp.connected)
  if (sp.tools) q.set("tools", sp.tools)
  if (sp.signin_error) q.set("signin_error", sp.signin_error)
  const qs = q.toString() ? `?${q.toString()}` : ""

  if (sp.tab === "agents") {
    redirect(`/${orgSlug}/bot-store${qs}`)
  }
  redirect(`/${orgSlug}/connectors${qs}`)
}
