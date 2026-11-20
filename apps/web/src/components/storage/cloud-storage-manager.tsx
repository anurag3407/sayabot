"use client"

import { useState, useTransition, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  Cloud,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  ShieldCheck,
  Zap,
  HardDrive,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, HelpText, Input } from "@/components/ui/field"
import {
  saveWorkspaceConnector,
  deleteWorkspaceConnector,
  testWorkspaceConnector,
  connectBuiltinSupabaseStorage,
} from "@/lib/actions/connectors"
import type { WorkspaceConnectorView } from "@/lib/types"

interface CloudStorageManagerProps {
  orgSlug: string
  connectors: WorkspaceConnectorView[]
  isAdmin: boolean
}

type ProviderKey = "supabase" | "cloudflare_r2" | "backblaze_b2" | "huggingface" | "s3_storage"

const STORAGE_PROVIDERS: Array<{
  id: ProviderKey
  name: string
  tagline: string
  freeTier: string
  requiresCreditCard: boolean
  badgeColor: string
  authType: "oauth_or_key" | "key"
}> = [
  {
    id: "supabase",
    name: "Supabase Storage",
    tagline: "PostgreSQL-backed object storage with instant OAuth",
    freeTier: "1 GB Free • No credit card",
    requiresCreditCard: false,
    badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    authType: "oauth_or_key",
  },
  {
    id: "cloudflare_r2",
    name: "Cloudflare R2",
    tagline: "S3-compatible object storage with global edge distribution",
    freeTier: "10 GB Free / mo • $0 Egress fees",
    requiresCreditCard: true,
    badgeColor: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    authType: "key",
  },
  {
    id: "backblaze_b2",
    name: "Backblaze B2",
    tagline: "High-reliability S3-compatible cloud storage",
    freeTier: "10 GB Free • No credit card",
    requiresCreditCard: false,
    badgeColor: "bg-red-500/10 text-red-400 border-red-500/20",
    authType: "key",
  },
  {
    id: "huggingface",
    name: "Hugging Face Hub",
    tagline: "Store files & datasets directly on Hugging Face Hub",
    freeTier: "Up to 50 GB Free • Single token",
    requiresCreditCard: false,
    badgeColor: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    authType: "key",
  },
  {
    id: "s3_storage",
    name: "Custom S3 / MinIO",
    tagline: "Connect your self-hosted MinIO or any S3-compatible cloud",
    freeTier: "Self-hosted / Any S3",
    requiresCreditCard: false,
    badgeColor: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    authType: "key",
  },
]

export function CloudStorageManager({ orgSlug, connectors, isAdmin }: CloudStorageManagerProps) {
  const router = useRouter()
  const [activeProvider, setActiveProvider] = useState<ProviderKey>("supabase")
  const [isPending, startTransition] = useTransition()
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>(
    {},
  )
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showManualForm, setShowManualForm] = useState(false)

  // Form states
  const [connectorName, setConnectorName] = useState("")
  const [bucketName, setBucketName] = useState("sayabot-storage")
  const [tokenOrSecret, setTokenOrSecret] = useState("")
  const [accessKeyId, setAccessKeyId] = useState("")
  const [accountId, setAccountId] = useState("")
  const [endpoint, setEndpoint] = useState("")
  const [projectUrl, setProjectUrl] = useState("")
  const [repoId, setRepoId] = useState("")

  // Listen for Supabase OAuth popup postMessage
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === "SUPABASE_AUTH_SUCCESS") {
        setSuccess(`Connected to Supabase project "${event.data.projectName ?? "Default"}"!`)
        router.refresh()
      }
    }
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [router])

  const storageConnectors = connectors.filter((c) =>
    ["supabase", "cloudflare_r2", "backblaze_b2", "s3_storage", "huggingface"].includes(c.source),
  )

  async function handleConnectSupabaseOAuth() {
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(`/api/connectors/supabase/oauth?org=${encodeURIComponent(orgSlug)}`)
      const data = await res.json()
      if (!res.ok || !data.authUrl) {
        setError(
          data.error ||
            "Supabase OAuth app credentials not configured. Use 1-click Default Storage or manual API keys below.",
        )
        return
      }
      const popup = window.open(data.authUrl, "supabase_oauth", "width=600,height=720")
      if (!popup) {
        setError("Popup was blocked by your browser. Please allow popups for this site.")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open Supabase OAuth")
    }
  }

  function handleConnectDefaultSupabase() {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const res = await connectBuiltinSupabaseStorage(orgSlug)
      if (!res.ok) {
        setError(res.error ?? "Failed to connect default workspace storage")
      } else {
        setSuccess("Workspace Default Supabase Storage is active and ready to use!")
        router.refresh()
      }
    })
  }

  function handleSaveManualStorage(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const formData = new FormData()
    formData.append("orgSlug", orgSlug)
    formData.append("source", activeProvider)
    formData.append(
      "name",
      connectorName.trim() ||
        `${STORAGE_PROVIDERS.find((p) => p.id === activeProvider)?.name ?? "Cloud Storage"}`,
    )
    formData.append("token", tokenOrSecret.trim())

    if (activeProvider === "supabase") {
      formData.append("projectUrl", projectUrl.trim())
      formData.append("bucket", bucketName.trim() || "sayabot-storage")
    } else if (activeProvider === "cloudflare_r2") {
      formData.append("accountId", accountId.trim())
      formData.append("accessKeyId", accessKeyId.trim())
      formData.append("bucket", bucketName.trim())
    } else if (activeProvider === "backblaze_b2") {
      formData.append("keyId", accessKeyId.trim())
      formData.append("endpoint", endpoint.trim())
      formData.append("bucket", bucketName.trim())
    } else if (activeProvider === "s3_storage") {
      formData.append("endpoint", endpoint.trim())
      formData.append("accessKeyId", accessKeyId.trim())
      formData.append("bucket", bucketName.trim())
    } else if (activeProvider === "huggingface") {
      formData.append("repoId", repoId.trim())
    }

    startTransition(async () => {
      const res = await saveWorkspaceConnector(null, formData)
      if (!res.ok) {
        setError(res.error ?? "Failed to save cloud storage connector")
      } else {
        setSuccess("Cloud storage configuration saved successfully!")
        setTokenOrSecret("")
        setShowManualForm(false)
        router.refresh()
      }
    })
  }

  function handleTestConnection(connectorId: string) {
    setTestingId(connectorId)
    startTransition(async () => {
      const res = await testWorkspaceConnector(orgSlug, connectorId)
      setTestingId(null)
      setTestResults((prev) => ({
        ...prev,
        [connectorId]: {
          ok: res.ok,
          message: res.ok
            ? String((res.data as any)?.detail || res.message || "Connection active")
            : typeof res.error === "string"
              ? res.error
              : "Connection test failed",
        },
      }))
    })
  }

  function handleDeleteConnector(connectorId: string) {
    if (!confirm("Are you sure you want to disconnect this storage provider?")) return
    startTransition(async () => {
      const res = await deleteWorkspaceConnector({ orgSlug, connectorId })
      if (!res.ok) {
        setError(res.error ?? "Failed to delete storage provider")
      } else {
        setSuccess("Storage provider disconnected")
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Overview header */}
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
          <Cloud className="h-5 w-5 text-accent" /> Cloud Storage Providers
        </h2>
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          Connect free or S3-compatible cloud storage so your autonomous agents can store artifacts,
          persisted datasets, and generated files without friction.
        </p>
      </div>

      {/* Notifications */}
      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1">{success}</div>
        </div>
      )}

      {/* Active storage providers list */}
      {storageConnectors.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Connected Storage ({storageConnectors.length})
          </h3>
          <div className="grid gap-3 sm:grid-cols-1">
            {storageConnectors.map((c) => {
              const cfg = (c.config ?? {}) as {
                bucket?: string
                projectUrl?: string
                endpoint?: string
                repoId?: string
                authMode?: string
              }
              const testResult = testResults[c.id]
              const isTesting = testingId === c.id

              return (
                <div
                  key={c.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground">{c.name}</span>
                      <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                        {c.source.replace("_", " ")}
                      </span>
                      {c.status === "active" ? (
                        <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" /> Ready
                        </span>
                      ) : (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-400">
                          {c.status}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Bucket/Location:{" "}
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
                        {cfg.bucket || cfg.repoId || "default"}
                      </code>
                      {cfg.projectUrl && (
                        <span className="ml-2 font-mono text-[11px] text-faint">
                          ({cfg.projectUrl})
                        </span>
                      )}
                    </p>
                    {testResult && (
                      <p
                        className={`text-xs mt-1 font-medium ${
                          testResult.ok ? "text-emerald-400" : "text-danger"
                        }`}
                      >
                        {testResult.ok ? "✓ " : "✕ "}
                        {testResult.message}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isTesting || isPending}
                      onClick={() => handleTestConnection(c.id)}
                      className="text-xs flex items-center gap-1.5"
                    >
                      {isTesting ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-3.5 w-3.5" /> Check
                        </>
                      )}
                    </Button>
                    {isAdmin && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => handleDeleteConnector(c.id)}
                        className="text-xs text-muted-foreground hover:text-danger hover:bg-danger/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <HardDrive className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <h4 className="mt-2 text-sm font-semibold text-foreground">
            No cloud storage connected yet
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Connect Supabase, Cloudflare R2, or Backblaze below so agents can store and manage
            files.
          </p>
        </div>
      )}

      {/* Provider connection section */}
      {isAdmin && (
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Add Cloud Storage Provider</h3>

          {/* Provider selector tabs */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {STORAGE_PROVIDERS.map((provider) => {
              const active = activeProvider === provider.id
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => {
                    setActiveProvider(provider.id)
                    setError(null)
                    setSuccess(null)
                  }}
                  className={`flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-all ${
                    active
                      ? "border-accent bg-accent/10 shadow-sm"
                      : "border-border bg-background hover:bg-muted/50"
                  }`}
                >
                  <span className="text-xs font-semibold text-foreground">{provider.name}</span>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[9px] font-medium leading-tight ${provider.badgeColor}`}
                  >
                    {provider.freeTier}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Active provider details & forms */}
          {activeProvider === "supabase" && (
            <div className="space-y-4 rounded-lg border border-border/60 bg-background/50 p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/50 pb-3">
                <div>
                  <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    Supabase Storage{" "}
                    <span className="text-xs text-emerald-400 font-normal">
                      1 GB Free • No credit card
                    </span>
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Connect via OAuth or 1-click built-in storage — no API keys required!
                  </p>
                </div>
              </div>

              {/* Instant OAuth and Default buttons */}
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  onClick={handleConnectSupabaseOAuth}
                  disabled={isPending}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-2 text-xs font-medium"
                >
                  <Zap className="h-3.5 w-3.5" /> ⚡ Connect with Supabase (OAuth)
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleConnectDefaultSupabase}
                  disabled={isPending}
                  className="flex items-center gap-2 text-xs font-medium"
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-accent" /> Use Workspace Default Storage
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowManualForm(!showManualForm)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {showManualForm ? "Hide manual keys" : "Or enter API keys manually"}
                </Button>
              </div>

              {/* Manual Supabase Form */}
              {showManualForm && (
                <form
                  onSubmit={handleSaveManualStorage}
                  className="space-y-3 pt-3 border-t border-border/40"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Connector Name" htmlFor="supa-name">
                      <Input
                        id="supa-name"
                        placeholder="e.g. My Supabase Storage"
                        value={connectorName}
                        onChange={(e) => setConnectorName(e.target.value)}
                      />
                    </Field>
                    <Field label="Bucket Name" htmlFor="supa-bucket">
                      <Input
                        id="supa-bucket"
                        placeholder="sayabot-storage"
                        value={bucketName}
                        onChange={(e) => setBucketName(e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field label="Project URL" htmlFor="supa-url">
                    <Input
                      id="supa-url"
                      placeholder="https://xyzcompany.supabase.co"
                      value={projectUrl}
                      onChange={(e) => setProjectUrl(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Service Role Key (or Secret API Key)" htmlFor="supa-key">
                    <Input
                      id="supa-key"
                      type="password"
                      placeholder="eyJhbGciOi..."
                      value={tokenOrSecret}
                      onChange={(e) => setTokenOrSecret(e.target.value)}
                      required
                    />
                    <HelpText>Encrypted at rest using AES-256-GCM envelope encryption.</HelpText>
                  </Field>
                  <Button type="submit" size="sm" disabled={isPending}>
                    {isPending ? "Connecting…" : "Save & Check Connection"}
                  </Button>
                </form>
              )}
            </div>
          )}

          {activeProvider === "cloudflare_r2" && (
            <form
              onSubmit={handleSaveManualStorage}
              className="space-y-3 rounded-lg border border-border/60 bg-background/50 p-4"
            >
              <div>
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  Cloudflare R2{" "}
                  <span className="text-xs text-amber-400 font-normal">
                    10 GB Free • $0 Egress Fees
                  </span>
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Generate an S3 token in Cloudflare Dashboard → R2 → Manage R2 API Tokens.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Account ID" htmlFor="r2-account">
                  <Input
                    id="r2-account"
                    placeholder="e.g. a1b2c3d4e5f67890..."
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Bucket Name" htmlFor="r2-bucket">
                  <Input
                    id="r2-bucket"
                    placeholder="e.g. sayabot-artifacts"
                    value={bucketName}
                    onChange={(e) => setBucketName(e.target.value)}
                    required
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Access Key ID" htmlFor="r2-access-key">
                  <Input
                    id="r2-access-key"
                    placeholder="e.g. 987654321..."
                    value={accessKeyId}
                    onChange={(e) => setAccessKeyId(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Secret Access Key" htmlFor="r2-secret-key">
                  <Input
                    id="r2-secret-key"
                    type="password"
                    placeholder="e.g. fedcba9876..."
                    value={tokenOrSecret}
                    onChange={(e) => setTokenOrSecret(e.target.value)}
                    required
                  />
                </Field>
              </div>

              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Connecting…" : "Save & Check Connection"}
              </Button>
            </form>
          )}

          {activeProvider === "backblaze_b2" && (
            <form
              onSubmit={handleSaveManualStorage}
              className="space-y-3 rounded-lg border border-border/60 bg-background/50 p-4"
            >
              <div>
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  Backblaze B2{" "}
                  <span className="text-xs text-red-400 font-normal">
                    10 GB Free • No credit card
                  </span>
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Generate an Application Key in Backblaze Dashboard → Application Keys.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="S3 Endpoint" htmlFor="b2-endpoint">
                  <Input
                    id="b2-endpoint"
                    placeholder="e.g. s3.us-west-004.backblazeb2.com"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Bucket Name" htmlFor="b2-bucket">
                  <Input
                    id="b2-bucket"
                    placeholder="e.g. my-sayabot-bucket"
                    value={bucketName}
                    onChange={(e) => setBucketName(e.target.value)}
                    required
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Key ID (Access Key)" htmlFor="b2-key-id">
                  <Input
                    id="b2-key-id"
                    placeholder="e.g. 0041234..."
                    value={accessKeyId}
                    onChange={(e) => setAccessKeyId(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Application Key (Secret Key)" htmlFor="b2-app-key">
                  <Input
                    id="b2-app-key"
                    type="password"
                    placeholder="e.g. K004abcdef..."
                    value={tokenOrSecret}
                    onChange={(e) => setTokenOrSecret(e.target.value)}
                    required
                  />
                </Field>
              </div>

              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Connecting…" : "Save & Check Connection"}
              </Button>
            </form>
          )}

          {activeProvider === "huggingface" && (
            <form
              onSubmit={handleSaveManualStorage}
              className="space-y-3 rounded-lg border border-border/60 bg-background/50 p-4"
            >
              <div>
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  Hugging Face Hub{" "}
                  <span className="text-xs text-yellow-400 font-normal">
                    Up to 50 GB Free • No credit card
                  </span>
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Create a User Access Token (Write) in Hugging Face → Settings → Access Tokens.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Dataset / Repo ID" htmlFor="hf-repo">
                  <Input
                    id="hf-repo"
                    placeholder="e.g. username/sayabot-storage"
                    value={repoId}
                    onChange={(e) => setRepoId(e.target.value)}
                    required
                  />
                </Field>
                <Field label="User Access Token" htmlFor="hf-token">
                  <Input
                    id="hf-token"
                    type="password"
                    placeholder="hf_..."
                    value={tokenOrSecret}
                    onChange={(e) => setTokenOrSecret(e.target.value)}
                    required
                  />
                </Field>
              </div>

              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Connecting…" : "Save & Check Connection"}
              </Button>
            </form>
          )}

          {activeProvider === "s3_storage" && (
            <form
              onSubmit={handleSaveManualStorage}
              className="space-y-3 rounded-lg border border-border/60 bg-background/50 p-4"
            >
              <div>
                <h4 className="text-sm font-semibold text-foreground">Custom S3 / MinIO Storage</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Connect any self-hosted MinIO, LocalStack, or custom S3 provider.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="S3 Endpoint URL" htmlFor="s3-endpoint">
                  <Input
                    id="s3-endpoint"
                    placeholder="e.g. http://minio.local:9000"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Bucket Name" htmlFor="s3-bucket">
                  <Input
                    id="s3-bucket"
                    placeholder="e.g. sayabot"
                    value={bucketName}
                    onChange={(e) => setBucketName(e.target.value)}
                    required
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Access Key" htmlFor="s3-access-key">
                  <Input
                    id="s3-access-key"
                    placeholder="Access Key ID"
                    value={accessKeyId}
                    onChange={(e) => setAccessKeyId(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Secret Key" htmlFor="s3-secret-key">
                  <Input
                    id="s3-secret-key"
                    type="password"
                    placeholder="Secret Access Key"
                    value={tokenOrSecret}
                    onChange={(e) => setTokenOrSecret(e.target.value)}
                    required
                  />
                </Field>
              </div>

              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Connecting…" : "Save & Check Connection"}
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
