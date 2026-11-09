import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { requireOrgAdmin } from "@/lib/auth"
import { listVectorProviders } from "@/lib/queries"
import { Section } from "@/components/settings/section"
import { EmptyState } from "@/components/ui/empty"
import {
  DeleteVectorButton,
  SetActiveVectorButton,
  TestVectorButton,
} from "@/components/settings/vector-actions"
import { VectorAddForm } from "@/components/settings/vector-add-form"

export const maxDuration = 60

export const metadata: Metadata = {
  title: "Vector & RAG Providers",
}

const PROVIDER_NAMES: Record<string, string> = {
  pinecone: "Pinecone Serverless",
  qdrant: "Qdrant Cloud",
  supabase_pgvector: "Supabase pgvector",
  neon_pgvector: "Neon Serverless pgvector",
  cloudflare_vectorize: "Cloudflare Vectorize",
  pglite: "Local Embedded PGLite",
  custom_postgres: "PostgreSQL (pgvector)",
  google_gemini: "Google Gemini text-embedding-004",
  cloudflare_workers_ai: "Cloudflare Workers AI Embeddings",
  voyage: "Voyage AI (voyage-3)",
  openai: "OpenAI text-embedding-3",
  cohere: "Cohere Embed",
  fastembed_local: "Local FastEmbed (CPU)",
  openai_compatible: "OpenAI-Compatible Embeddings",
}

export default async function VectorSettingsPage({
  params,
}: {
  params: Promise<{ org: string }>
}) {
  const { org: orgSlug } = await params
  const access = await requireOrgAdmin(orgSlug)
  if (!access) notFound()

  const allProviders = await listVectorProviders(access.org.id)

  const vectorDbProviders = allProviders.filter((p) => p.kind === "vector_db")
  const embeddingProviders = allProviders.filter((p) => p.kind === "embedding")

  const activeVectorDb = vectorDbProviders.find((p) => p.isActive)
  const activeEmbedding = embeddingProviders.find((p) => p.isActive)

  return (
    <div className="space-y-8">
      {/* 1. Educational Banner: LLM vs Vector DB */}
      <div className="rounded-lg border border-accent/20 bg-accent/5 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-mono text-[13px] font-semibold text-text">
              🧠 Long-Term Memory (RAG) vs. AI Reasoning Models
            </h2>
            <p className="mt-1 text-[12px] text-muted">
              LLMs (Claude, GPT-4o, Groq) provide the <strong>thinking brain</strong>, but are stateless.
              Vector DBs (Pinecone, Qdrant, Supabase) and Embedding Models (Gemini, Voyage) provide the{" "}
              <strong>persistent memory</strong> that allows agents to recall past beliefs, facts, and open loops.
            </p>
          </div>
        </div>

        {/* Current Active Engine Status */}
        <div className="mt-4 grid gap-3 border-t border-accent/15 pt-3 sm:grid-cols-2">
          <div className="rounded border border-line bg-surface/50 p-2.5">
            <p className="font-mono text-[11px] uppercase tracking-wider text-faint">
              Active Vector Database (Storage)
            </p>
            <p className="mt-0.5 text-[13px] font-medium text-text">
              {activeVectorDb ? (
                <>
                  {activeVectorDb.label}{" "}
                  <span className="font-mono text-[11px] text-faint">
                    ({PROVIDER_NAMES[activeVectorDb.provider] ?? activeVectorDb.provider})
                  </span>
                </>
              ) : (
                <span className="text-muted">Built-in PostgreSQL / PGLite (Default)</span>
              )}
            </p>
          </div>

          <div className="rounded border border-line bg-surface/50 p-2.5">
            <p className="font-mono text-[11px] uppercase tracking-wider text-faint">
              Active Vector AI (Embeddings Model)
            </p>
            <p className="mt-0.5 text-[13px] font-medium text-text">
              {activeEmbedding ? (
                <>
                  {activeEmbedding.label}{" "}
                  <span className="font-mono text-[11px] text-faint">
                    ({PROVIDER_NAMES[activeEmbedding.provider] ?? activeEmbedding.provider})
                  </span>
                </>
              ) : (
                <span className="text-muted">Hybrid Keyword & Recency Matching (Default)</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* 2. Free Tier Cheat Sheet */}
      <Section
        title="Generous Free-Tier Options"
        description="Unlike expensive LLMs, many top-tier vector databases and embedding providers offer permanent, generous free tiers:"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-md border border-line p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] font-semibold text-text">Pinecone Serverless</span>
              <span className="rounded bg-ok/10 px-1.5 py-0.5 text-[10px] font-medium text-ok">Free Tier</span>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              <strong>2 GB storage, 100k vectors, 2M read units/mo</strong> forever free. No credit card required.
            </p>
          </div>

          <div className="rounded-md border border-line p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] font-semibold text-text">Google Gemini Embeddings</span>
              <span className="rounded bg-ok/10 px-1.5 py-0.5 text-[10px] font-medium text-ok">Free 1500 RPM</span>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              <strong>text-embedding-004</strong> with up to 1,500 requests/minute completely free in Google AI Studio.
            </p>
          </div>

          <div className="rounded-md border border-line p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] font-semibold text-text">Qdrant Cloud</span>
              <span className="rounded bg-ok/10 px-1.5 py-0.5 text-[10px] font-medium text-ok">Free 1GB Cluster</span>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              <strong>1 permanent 1 GB cluster</strong> free forever on AWS/GCP with high-speed payload filtering.
            </p>
          </div>

          <div className="rounded-md border border-line p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] font-semibold text-text">Voyage AI</span>
              <span className="rounded bg-ok/10 px-1.5 py-0.5 text-[10px] font-medium text-ok">200M Tokens Free</span>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Top-ranked benchmark embeddings with <strong>200 Million tokens free</strong> upon initial registration.
            </p>
          </div>

          <div className="rounded-md border border-line p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] font-semibold text-text">Supabase / Neon</span>
              <span className="rounded bg-ok/10 px-1.5 py-0.5 text-[10px] font-medium text-ok">500MB Free</span>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Full PostgreSQL database with the <strong>pgvector</strong> extension pre-installed on free tiers.
            </p>
          </div>

          <div className="rounded-md border border-line p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] font-semibold text-text">Local PGLite (gbrain)</span>
              <span className="rounded bg-ok/10 px-1.5 py-0.5 text-[10px] font-medium text-ok">100% Free</span>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Runs in-process inside your machine or container. <strong>Zero external keys, zero cloud costs.</strong>
            </p>
          </div>
        </div>
      </Section>

      {/* 3. Configured Vector Databases */}
      <Section
        title="Vector Databases (Storage & Retrieval)"
        description="These store vector embeddings and perform nearest-neighbor semantic search for your agents. You can add multiple providers and choose which one is active."
      >
        {vectorDbProviders.length === 0 ? (
          <EmptyState
            title="No custom vector databases configured"
            body="Using built-in PostgreSQL / PGLite storage by default. You can add a free Pinecone, Qdrant, or Supabase key below to switch."
          />
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {vectorDbProviders.map((provider) => (
              <li key={provider.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium text-text">{provider.label}</p>
                    <SetActiveVectorButton
                      orgSlug={orgSlug}
                      providerId={provider.id}
                      isActive={provider.isActive}
                    />
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-faint">
                    {PROVIDER_NAMES[provider.provider] ?? provider.provider} · •••• {provider.last4}
                    {provider.endpointUrl ? ` · ${provider.endpointUrl}` : ""}
                    {provider.config.indexName ? ` · Index: ${String(provider.config.indexName)}` : ""}
                  </p>
                </div>
                <TestVectorButton orgSlug={orgSlug} providerId={provider.id} />
                <DeleteVectorButton orgSlug={orgSlug} providerId={provider.id} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 4. Configured Embedding Models */}
      <Section
        title="Vector AI (Embedding Models)"
        description="Embedding models convert facts, thoughts, and queries into mathematical vectors. Only one model is active at a time."
      >
        {embeddingProviders.length === 0 ? (
          <EmptyState
            title="No custom embedding providers configured"
            body="Add a free Google Gemini (1500 RPM) or Voyage AI key below to enable semantic vector embeddings."
          />
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {embeddingProviders.map((provider) => (
              <li key={provider.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium text-text">{provider.label}</p>
                    <SetActiveVectorButton
                      orgSlug={orgSlug}
                      providerId={provider.id}
                      isActive={provider.isActive}
                    />
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-faint">
                    {PROVIDER_NAMES[provider.provider] ?? provider.provider} · •••• {provider.last4}
                    {provider.config.dimension ? ` · ${String(provider.config.dimension)}d` : ""}
                  </p>
                </div>
                <TestVectorButton orgSlug={orgSlug} providerId={provider.id} />
                <DeleteVectorButton orgSlug={orgSlug} providerId={provider.id} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 5. Add New Vector / Embedding Key Form */}
      <Section
        title="Add Vector or Embedding Provider"
        description="Paste credentials for a Vector DB (Pinecone, Qdrant, Supabase) or an Embedding model (Google Gemini, Voyage, OpenAI). Keys are encrypted with AES-256-GCM."
      >
        <VectorAddForm orgSlug={orgSlug} />
      </Section>
    </div>
  )
}
