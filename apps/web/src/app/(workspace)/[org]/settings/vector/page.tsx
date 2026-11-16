import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { requireOrgAdmin } from "@/lib/auth"
import { listVectorProviders } from "@/lib/queries"
import type { VectorProviderView } from "@/lib/types"
import {
  DeleteVectorButton,
  SetActiveVectorButton,
  TestVectorButton,
} from "@/components/settings/vector-actions"
import { VectorAddForm, vectorProviderName } from "@/components/settings/vector-add-form"

export const maxDuration = 60

export const metadata: Metadata = {
  title: "Memory",
}

export default async function VectorSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAdmin(orgSlug)
  if (!access) notFound()

  const allProviders = await listVectorProviders(access.org.id)
  const storage = allProviders.filter((provider) => provider.kind === "vector_db")
  const embeddings = allProviders.filter((provider) => provider.kind === "embedding")

  return (
    <div className="space-y-8">
      <div className="max-w-2xl space-y-3">
        <p className="text-[13px] leading-relaxed text-muted">
          Memory is already on. Notes stay in this workspace’s database, and search uses keywords
          until you add an embedding model.
        </p>
        <dl className="grid overflow-hidden rounded-md border border-line sm:grid-cols-3">
          <div className="border-b border-line p-3 sm:border-b-0 sm:border-r">
            <dt className="font-mono text-[11px] uppercase tracking-wider text-faint">
              No credential
            </dt>
            <dd className="mt-1 text-[13px] leading-snug text-text">
              Built-in database and on-device embeddings.
            </dd>
          </div>
          <div className="border-b border-line p-3 sm:border-b-0 sm:border-r">
            <dt className="font-mono text-[11px] uppercase tracking-wider text-faint">API key</dt>
            <dd className="mt-1 text-[13px] leading-snug text-text">
              Pinecone, Qdrant, Cloudflare, Gemini, Voyage, OpenAI, Cohere.
            </dd>
          </div>
          <div className="p-3">
            <dt className="font-mono text-[11px] uppercase tracking-wider text-faint">OAuth</dt>
            <dd className="mt-1 text-[13px] leading-snug text-text">
              Neon only. Approve access there, then paste the connection string Neon gives you.
            </dd>
          </div>
        </dl>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Lane
          title="Storage"
          description="Where vectors are kept."
          fallback="Built-in Postgres"
          orgSlug={orgSlug}
          kind="vector_db"
          providers={storage}
        />
        <Lane
          title="Embeddings"
          description="Turns text into vectors for search by meaning."
          fallback="Keyword matching"
          orgSlug={orgSlug}
          kind="embedding"
          providers={embeddings}
        />
      </div>
    </div>
  )
}

function Lane({
  title,
  description,
  fallback,
  orgSlug,
  kind,
  providers,
}: {
  title: string
  description: string
  fallback: string
  orgSlug: string
  kind: "vector_db" | "embedding"
  providers: VectorProviderView[]
}) {
  const active = providers.find((provider) => provider.isActive)

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-[15px] font-medium text-text">{title}</h2>
        <p className="mt-1 text-[13px] text-muted">{description}</p>
        <p className="mt-2 text-[13px] text-text">
          <span className="text-faint">Using </span>
          {active ? active.label : fallback}
          {active ? (
            <span className="text-faint"> · {vectorProviderName(active.provider)}</span>
          ) : null}
        </p>
      </div>

      {providers.length > 0 ? (
        <ul className="divide-y divide-line border-y border-line">
          {providers.map((provider) => (
            <li key={provider.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] font-medium text-text">{provider.label}</p>
                  <SetActiveVectorButton
                    orgSlug={orgSlug}
                    providerId={provider.id}
                    isActive={provider.isActive}
                  />
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-faint">
                  {vectorProviderName(provider.provider)}
                  {provider.last4 && provider.last4 !== "local" ? ` · •••• ${provider.last4}` : ""}
                  {provider.endpointUrl ? ` · ${provider.endpointUrl}` : ""}
                  {provider.config.indexName ? ` · ${String(provider.config.indexName)}` : ""}
                  {provider.config.dimension ? ` · ${String(provider.config.dimension)}d` : ""}
                </p>
              </div>
              <TestVectorButton orgSlug={orgSlug} providerId={provider.id} />
              <DeleteVectorButton orgSlug={orgSlug} providerId={provider.id} />
            </li>
          ))}
        </ul>
      ) : null}

      <VectorAddForm orgSlug={orgSlug} kind={kind} />
    </section>
  )
}
