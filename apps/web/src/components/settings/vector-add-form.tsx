"use client"

import { useState } from "react"
import { ActionForm } from "@/components/ui/action-form"
import { Field, Input } from "@/components/ui/field"
import { cn } from "@/lib/format"
import { saveVectorProvider } from "@/lib/actions/vector-keys"

type Auth = "none" | "api_key" | "database_url"
type ExtraField = "endpoint" | "index"

interface VectorChoice {
  value: string
  name: string
  detail: string
  auth: Auth
  dimension?: number
  extras: ExtraField[]
  secretLabel?: string
  secretPlaceholder?: string
  endpointLabel?: string
  endpointPlaceholder?: string
  indexLabel?: string
  indexPlaceholder?: string
  note?: string
}

const STORAGE: VectorChoice[] = [
  {
    value: "pinecone",
    name: "Pinecone",
    detail: "2 GB free",
    auth: "api_key",
    extras: ["endpoint", "index"],
    secretPlaceholder: "pcsk_…",
    endpointLabel: "Index host",
    endpointPlaceholder: "https://my-index-xxxx.svc.pinecone.io",
    indexLabel: "Index",
    indexPlaceholder: "saaya-memory",
  },
  {
    value: "qdrant",
    name: "Qdrant",
    detail: "1 GB free",
    auth: "api_key",
    extras: ["endpoint", "index"],
    endpointLabel: "Cluster URL",
    endpointPlaceholder: "https://xyz.cloud.qdrant.io:6333",
    indexLabel: "Collection",
    indexPlaceholder: "saaya-memory",
  },
  {
    value: "supabase_pgvector",
    name: "Supabase",
    detail: "500 MB free",
    auth: "database_url",
    extras: [],
    secretLabel: "Connection string",
    secretPlaceholder: "postgresql://…",
  },
  {
    value: "neon_pgvector",
    name: "Neon",
    detail: "OAuth, then a URL",
    auth: "database_url",
    extras: [],
    secretLabel: "Connection string",
    secretPlaceholder: "postgresql://…",
    note: "Neon is the only provider here with OAuth. After you approve access, Neon shows a connection string — paste that URL. This workspace has no Neon OAuth app registered, so there is no sign-in button.",
  },
  {
    value: "cloudflare_vectorize",
    name: "Cloudflare",
    detail: "5M queries/mo free",
    auth: "api_key",
    extras: ["index"],
    secretLabel: "API token",
    indexLabel: "Index",
    indexPlaceholder: "saaya-memory",
  },
  {
    value: "custom_postgres",
    name: "Postgres",
    detail: "Your own database",
    auth: "database_url",
    extras: [],
    secretLabel: "Connection string",
    secretPlaceholder: "postgresql://…",
  },
  {
    value: "pglite",
    name: "On this machine",
    detail: "No key",
    auth: "none",
    extras: [],
  },
]

const EMBEDDINGS: VectorChoice[] = [
  {
    value: "fastembed_local",
    name: "On this machine",
    detail: "No key",
    auth: "none",
    extras: [],
  },
  {
    value: "google_gemini",
    name: "Gemini",
    detail: "Free tier",
    auth: "api_key",
    dimension: 768,
    extras: [],
    secretPlaceholder: "AI Studio key",
  },
  {
    value: "voyage",
    name: "Voyage",
    detail: "200M tokens free",
    auth: "api_key",
    dimension: 1024,
    extras: [],
  },
  {
    value: "openai",
    name: "OpenAI",
    detail: "text-embedding-3-small",
    auth: "api_key",
    dimension: 1536,
    extras: [],
    secretPlaceholder: "sk-…",
  },
  {
    value: "cohere",
    name: "Cohere",
    detail: "Trial key",
    auth: "api_key",
    extras: [],
  },
  {
    value: "cloudflare_workers_ai",
    name: "Cloudflare",
    detail: "Workers AI",
    auth: "api_key",
    extras: [],
    secretLabel: "API token",
  },
  {
    value: "openai_compatible",
    name: "Ollama",
    detail: "Local server",
    auth: "api_key",
    extras: ["endpoint"],
    secretLabel: "API key",
    secretPlaceholder: "Leave blank only if the server has no key",
    endpointLabel: "Base URL",
    endpointPlaceholder: "http://127.0.0.1:11434/v1",
  },
]

const NAMES: Record<string, string> = {}
for (const choice of [...STORAGE, ...EMBEDDINGS]) NAMES[choice.value] = choice.name

export function vectorProviderName(provider: string): string {
  return NAMES[provider] ?? provider
}

const AUTH_LABEL: Record<Auth, string> = {
  none: "No key",
  api_key: "API key",
  database_url: "Database URL",
}

export function VectorAddForm({
  orgSlug,
  kind,
}: {
  orgSlug: string
  kind: "vector_db" | "embedding"
}) {
  const choices = kind === "vector_db" ? STORAGE : EMBEDDINGS
  const [provider, setProvider] = useState<string | null>(null)
  const choice = choices.find((item) => item.value === provider) ?? null

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {choices.map((item) => {
          const selected = item.value === provider
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={selected}
              onClick={() => setProvider(item.value)}
              className={cn(
                "rounded-md border px-3 py-2 text-left transition-colors",
                selected
                  ? "border-accent bg-accent/10"
                  : "border-line bg-transparent hover:border-line-strong hover:bg-surface/60",
              )}
            >
              <span className="block text-[13px] font-medium text-text">{item.name}</span>
              <span className="mt-0.5 block text-[11px] text-muted">
                {item.detail}
                <span className="text-faint"> · {AUTH_LABEL[item.auth]}</span>
              </span>
            </button>
          )
        })}
      </div>

      {choice ? (
        <ActionForm
          key={choice.value}
          action={saveVectorProvider}
          submitLabel={choice.auth === "none" ? `Use ${choice.name}` : "Save"}
          resetOnSuccess
          className="rounded-md border border-line bg-surface/40 p-3"
        >
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="provider" value={choice.value} />
          <input type="hidden" name="label" value={choice.name} />
          <input type="hidden" name="makeActive" value="on" />
          {choice.dimension ? (
            <input type="hidden" name="dimension" value={choice.dimension} />
          ) : null}

          {choice.auth !== "none" ? (
            <Field
              label={choice.secretLabel ?? "API key"}
              htmlFor={`${kind}-${choice.value}-secret`}
              hint="Encrypted before it is saved"
            >
              <Input
                id={`${kind}-${choice.value}-secret`}
                name="apiKey"
                type="password"
                required={choice.value !== "openai_compatible"}
                autoComplete="off"
                placeholder={choice.secretPlaceholder}
              />
            </Field>
          ) : (
            <p className="text-[13px] text-muted">
              Nothing to paste. This runs inside the workspace.
            </p>
          )}

          {choice.extras.includes("endpoint") ? (
            <Field
              label={choice.endpointLabel ?? "Endpoint"}
              htmlFor={`${kind}-${choice.value}-endpoint`}
            >
              <Input
                id={`${kind}-${choice.value}-endpoint`}
                name="endpointUrl"
                required
                placeholder={choice.endpointPlaceholder}
                autoComplete="off"
              />
            </Field>
          ) : null}

          {choice.extras.includes("index") ? (
            <Field label={choice.indexLabel ?? "Index"} htmlFor={`${kind}-${choice.value}-index`}>
              <Input
                id={`${kind}-${choice.value}-index`}
                name="indexName"
                required
                placeholder={choice.indexPlaceholder}
                autoComplete="off"
              />
            </Field>
          ) : null}

          {choice.note ? (
            <p className="text-[12px] leading-relaxed text-muted">{choice.note}</p>
          ) : null}
        </ActionForm>
      ) : (
        <p className="text-[12px] text-faint">
          Choose a provider. Only the fields it needs will show up.
        </p>
      )}
    </div>
  )
}
