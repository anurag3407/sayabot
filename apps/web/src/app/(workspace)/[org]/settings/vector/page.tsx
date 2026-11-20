import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { requireOrgAdmin } from "@/lib/auth"
import { listVectorProviders } from "@/lib/queries"
import { VectorSettingsView } from "@/components/settings/vector-settings-view"

export const maxDuration = 60

export const metadata: Metadata = {
  title: "Memory & RAG",
}

export default async function VectorSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAdmin(orgSlug)
  if (!access) notFound()

  const allProviders = await listVectorProviders(access.org.id)
  const storage = allProviders.filter((provider) => provider.kind === "vector_db")
  const embeddings = allProviders.filter((provider) => provider.kind === "embedding")

  return (
    <div className="space-y-6">
      <VectorSettingsView orgSlug={orgSlug} storage={storage} embeddings={embeddings} />
    </div>
  )
}
