"use client"

import { useState } from "react"
import { ActionForm } from "@/components/ui/action-form"
import { Field, HelpText, Input, Select } from "@/components/ui/field"
import { saveVectorProvider } from "@/lib/actions/vector-keys"

const VECTOR_DB_PROVIDERS = [
  { value: "pinecone", label: "Pinecone Serverless (Free 2GB / 100k vectors)" },
  { value: "qdrant", label: "Qdrant Cloud (Free 1GB Cluster)" },
  { value: "supabase_pgvector", label: "Supabase pgvector (Free 500MB DB)" },
  { value: "neon_pgvector", label: "Neon Serverless pgvector (Free 0.5GB)" },
  { value: "cloudflare_vectorize", label: "Cloudflare Vectorize (Free 5M queries/mo)" },
  { value: "pglite", label: "Local PGLite (100% Free Offline, No Key Needed)" },
  { value: "custom_postgres", label: "Custom PostgreSQL with pgvector" },
]

const EMBEDDING_PROVIDERS = [
  { value: "google_gemini", label: "Google Gemini text-embedding-004 (Free 1500 RPM)" },
  { value: "voyage", label: "Voyage AI voyage-3 (Free 200M Tokens)" },
  { value: "openai", label: "OpenAI text-embedding-3-small" },
  { value: "cohere", label: "Cohere embed-english-v3.0 (Free Trial)" },
  { value: "fastembed_local", label: "Local FastEmbed (100% Free CPU, No Key Needed)" },
  { value: "openai_compatible", label: "Ollama / LocalAI / OpenAI-compatible" },
]

export function VectorAddForm({ orgSlug }: { orgSlug: string }) {
  const [kind, setKind] = useState<"vector_db" | "embedding">("vector_db")
  const [provider, setProvider] = useState<string>("pinecone")

  const isLocalNoKey = provider === "pglite" || provider === "fastembed_local"

  const handleKindChange = (newKind: "vector_db" | "embedding") => {
    setKind(newKind)
    setProvider(newKind === "vector_db" ? "pinecone" : "google_gemini")
  }

  return (
    <ActionForm action={saveVectorProvider} submitLabel="Save Vector Credential" resetOnSuccess>
      <input type="hidden" name="orgSlug" value={orgSlug} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category" htmlFor="vector-kind">
          <Select
            id="vector-kind"
            name="kind"
            value={kind}
            onChange={(e) => handleKindChange(e.target.value as "vector_db" | "embedding")}
          >
            <option value="vector_db">Vector Database (Store & Search)</option>
            <option value="embedding">Vector AI (Embedding Model)</option>
          </Select>
        </Field>

        <Field label="Provider" htmlFor="vector-provider">
          <Select
            id="vector-provider"
            name="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            {(kind === "vector_db" ? VECTOR_DB_PROVIDERS : EMBEDDING_PROVIDERS).map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        <Field label="Label" htmlFor="vector-label" hint="Shown in workspace settings">
          <Input
            id="vector-label"
            name="label"
            required
            maxLength={80}
            placeholder={
              kind === "vector_db"
                ? provider === "pinecone"
                  ? "Production Pinecone Serverless"
                  : "Staging pgvector DB"
                : provider === "google_gemini"
                  ? "Google Gemini 1500 RPM Embeddings"
                  : "Production Voyage-3"
            }
          />
        </Field>

        <Field
          label="Dimension"
          htmlFor="vector-dimension"
          hint="e.g. 768 for Gemini, 1536 for OpenAI"
        >
          <Input
            id="vector-dimension"
            name="dimension"
            type="number"
            placeholder={
              provider === "google_gemini"
                ? "768"
                : provider === "voyage"
                  ? "1024"
                  : provider === "openai"
                    ? "1536"
                    : "1536"
            }
          />
        </Field>
      </div>

      {!isLocalNoKey ? (
        <Field
          label="API Key or Connection URL"
          htmlFor="vector-api-key"
          hint="Encrypted with MESH_KEK, never shown in plaintext"
        >
          <Input
            id="vector-api-key"
            name="apiKey"
            type="password"
            required={!isLocalNoKey}
            autoComplete="off"
            placeholder={
              provider === "supabase_pgvector" || provider === "neon_pgvector"
                ? "postgresql://user:password@host:5432/db"
                : provider === "pinecone"
                  ? "pcsk_..."
                  : "sk-..."
            }
          />
        </Field>
      ) : null}

      {kind === "vector_db" && provider !== "pglite" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Endpoint / Host URL"
            htmlFor="vector-endpoint"
            hint={
              provider === "pinecone"
                ? "Index host URL (from Pinecone console)"
                : provider === "qdrant"
                  ? "Cluster endpoint URL"
                  : "Host address"
            }
          >
            <Input
              id="vector-endpoint"
              name="endpointUrl"
              placeholder={
                provider === "pinecone"
                  ? "https://my-index-xxxx.svc.pinecone.io"
                  : provider === "qdrant"
                    ? "https://xyz-example.cloud.qdrant.io:6333"
                    : "https://..."
              }
            />
          </Field>

          <Field
            label="Index / Collection Name"
            htmlFor="vector-index-name"
            hint="Target index or table"
          >
            <Input id="vector-index-name" name="indexName" placeholder="saaya-memory" />
          </Field>
        </div>
      ) : null}

      <div className="flex items-center gap-2 pt-1">
        <input
          type="checkbox"
          id="make-active-checkbox"
          name="makeActive"
          defaultChecked
          className="h-4 w-4 rounded border-line text-accent"
        />
        <label htmlFor="make-active-checkbox" className="text-[12px] text-text">
          Set as active {kind === "vector_db" ? "Vector Database" : "Embedding Model"} for this workspace
        </label>
      </div>

      <HelpText>
        You can save multiple keys and switch between them anytime. All credentials are encrypted with
        AES-256-GCM before saving to PostgreSQL.
      </HelpText>
    </ActionForm>
  )
}
