"use client"

import { useState } from "react"
import { Database, Sparkles } from "lucide-react"
import { cn } from "@/lib/format"
import type { VectorProviderView } from "@/lib/types"
import {
  DeleteVectorButton,
  SetActiveVectorButton,
  TestVectorButton,
} from "@/components/settings/vector-actions"
import { VectorAddForm, vectorProviderName } from "@/components/settings/vector-add-form"

export function VectorSettingsView({
  orgSlug,
  storage,
  embeddings,
}: {
  orgSlug: string
  storage: VectorProviderView[]
  embeddings: VectorProviderView[]
}) {
  const [activeTab, setActiveTab] = useState<"storage" | "embeddings">("storage")

  const activeStorage = storage.find((p) => p.isActive)
  const activeEmbedding = embeddings.find((p) => p.isActive)

  return (
    <div className="space-y-6">
      {/* Overview Banner */}
      <div className="rounded-2xl border border-line bg-surface/30 p-5 space-y-4">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[16px] font-semibold tracking-tight text-text">
              Workspace Vector Memory
            </h2>
            <p className="text-[13px] text-muted leading-relaxed">
              Long-term memory is active. Notes and canvas memories stay in this workspace database,
              and semantic search activates when an embedding model is connected.
            </p>
          </div>
        </div>

        {/* Feature badges */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 pt-2">
          <div className="rounded-xl border border-line/60 bg-surface/50 p-3">
            <span className="font-mono text-[10.5px] uppercase tracking-wider text-ok font-semibold">
              ● Zero Credential
            </span>
            <p className="mt-1 text-[12.5px] text-text font-medium">Built-in PostgreSQL</p>
            <p className="text-[11px] text-muted">Ready out of the box with pgvector.</p>
          </div>

          <div className="rounded-xl border border-line/60 bg-surface/50 p-3">
            <span className="font-mono text-[10.5px] uppercase tracking-wider text-accent font-semibold">
              ● API Key Cloud
            </span>
            <p className="mt-1 text-[12.5px] text-text font-medium">
              Pinecone, Qdrant, Gemini, Voyage
            </p>
            <p className="text-[11px] text-muted">Sealed with AES-256 envelope encryption.</p>
          </div>

          <div className="rounded-xl border border-line/60 bg-surface/50 p-3">
            <span className="font-mono text-[10.5px] uppercase tracking-wider text-faint font-semibold">
              ● Direct Database
            </span>
            <p className="mt-1 text-[12.5px] text-text font-medium">Neon & Custom Postgres</p>
            <p className="text-[11px] text-muted">Connect your own serverless databases.</p>
          </div>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex items-center gap-2 border-b border-line pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("storage")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-medium transition-all",
            activeTab === "storage"
              ? "bg-accent/10 text-accent font-semibold shadow-sm border border-accent/20"
              : "text-muted hover:bg-surface hover:text-text",
          )}
        >
          <Database className="h-4 w-4" />
          <span>Vector Storage</span>
          <span className="rounded-full bg-panel px-2 py-0.5 text-[10.5px] font-mono text-faint border border-line">
            {activeStorage ? activeStorage.label : "Built-in"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("embeddings")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-medium transition-all",
            activeTab === "embeddings"
              ? "bg-accent/10 text-accent font-semibold shadow-sm border border-accent/20"
              : "text-muted hover:bg-surface hover:text-text",
          )}
        >
          <Sparkles className="h-4 w-4" />
          <span>Embedding Models</span>
          <span className="rounded-full bg-panel px-2 py-0.5 text-[10.5px] font-mono text-faint border border-line">
            {activeEmbedding ? activeEmbedding.label : "Keyword"}
          </span>
        </button>
      </div>

      {/* Active Tab Content */}
      {activeTab === "storage" ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-line bg-surface/20 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-mono text-[11px] uppercase tracking-wider text-faint">
                  Currently Using
                </span>
                <h3 className="text-[16px] font-semibold text-text">
                  {activeStorage ? activeStorage.label : "Built-in Postgres (pgvector)"}
                </h3>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 border border-ok/20 px-2.5 py-1 text-[11px] font-medium text-ok">
                <span className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse" /> Active Storage
              </span>
            </div>
            <p className="text-[12.5px] text-muted">
              {activeStorage
                ? `Vectors are stored and indexed in ${vectorProviderName(activeStorage.provider)}.`
                : "Vectors are stored in your workspace PostgreSQL database with native cosine distance indexing."}
            </p>
          </div>

          {storage.length > 0 ? (
            <div className="rounded-2xl border border-line bg-surface/30 p-4 space-y-3">
              <h4 className="text-[13px] font-medium text-text">Configured Storage Connections</h4>
              <ul className="divide-y divide-line/60">
                {storage.map((provider) => (
                  <li
                    key={provider.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-semibold text-text">
                          {provider.label}
                        </span>
                        <span className="font-mono text-[11px] text-faint">
                          {vectorProviderName(provider.provider)}
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-faint truncate">
                        {provider.last4 && provider.last4 !== "local"
                          ? `•••• ${provider.last4}`
                          : "local"}
                        {provider.endpointUrl ? ` · ${provider.endpointUrl}` : ""}
                        {provider.config.indexName
                          ? ` · index: ${String(provider.config.indexName)}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <SetActiveVectorButton
                        orgSlug={orgSlug}
                        providerId={provider.id}
                        isActive={provider.isActive}
                      />
                      <TestVectorButton orgSlug={orgSlug} providerId={provider.id} />
                      <DeleteVectorButton orgSlug={orgSlug} providerId={provider.id} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Add / Connect new storage */}
          <div className="space-y-3">
            <h4 className="text-[14px] font-medium text-text">Connect Vector Database</h4>
            <VectorAddForm orgSlug={orgSlug} kind="vector_db" />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-2xl border border-line bg-surface/20 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-mono text-[11px] uppercase tracking-wider text-faint">
                  Currently Using
                </span>
                <h3 className="text-[16px] font-semibold text-text">
                  {activeEmbedding ? activeEmbedding.label : "Built-in Keyword Matching"}
                </h3>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 border border-ok/20 px-2.5 py-1 text-[11px] font-medium text-ok">
                <span className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse" /> Active Embeddings
              </span>
            </div>
            <p className="text-[12.5px] text-muted">
              {activeEmbedding
                ? `Text is vectorized using ${vectorProviderName(activeEmbedding.provider)} for semantic recall.`
                : "Exact keyword matching is used until you connect an embedding model."}
            </p>
          </div>

          {embeddings.length > 0 ? (
            <div className="rounded-2xl border border-line bg-surface/30 p-4 space-y-3">
              <h4 className="text-[13px] font-medium text-text">Configured Embedding Models</h4>
              <ul className="divide-y divide-line/60">
                {embeddings.map((provider) => (
                  <li
                    key={provider.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-semibold text-text">
                          {provider.label}
                        </span>
                        <span className="font-mono text-[11px] text-faint">
                          {vectorProviderName(provider.provider)}
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-faint truncate">
                        {provider.last4 && provider.last4 !== "local"
                          ? `•••• ${provider.last4}`
                          : "local"}
                        {provider.config.dimension
                          ? ` · ${String(provider.config.dimension)}d`
                          : ""}
                        {provider.endpointUrl ? ` · ${provider.endpointUrl}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <SetActiveVectorButton
                        orgSlug={orgSlug}
                        providerId={provider.id}
                        isActive={provider.isActive}
                      />
                      <TestVectorButton orgSlug={orgSlug} providerId={provider.id} />
                      <DeleteVectorButton orgSlug={orgSlug} providerId={provider.id} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Add / Connect new embeddings */}
          <div className="space-y-3">
            <h4 className="text-[14px] font-medium text-text">Connect Embedding Model</h4>
            <VectorAddForm orgSlug={orgSlug} kind="embedding" />
          </div>
        </div>
      )}
    </div>
  )
}
