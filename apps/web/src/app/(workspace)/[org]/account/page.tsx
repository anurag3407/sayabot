import { redirect } from "next/navigation"

/** Moved into settings; kept so old links and bookmarks still land. */
export default async function AccountPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params
  redirect(`/${org}/settings/profile`)
}
