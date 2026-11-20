import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { ConnectorSource } from "./types"

export interface StorageFileMeta {
  name: string
  path: string
  size?: number
  updatedAt?: string | null
  contentType?: string
}

export interface StorageClientConfig {
  source: ConnectorSource
  token: string
  config: Record<string, unknown>
  /** Override the Hugging Face origin. Tests point this at a local stub server. */
  baseUrl?: string
}

export class CloudStorageClient {
  private source: ConnectorSource
  private token: string
  private config: Record<string, unknown>
  private s3Client?: S3Client
  private supabaseClient?: SupabaseClient
  private baseUrl?: string

  constructor(opts: StorageClientConfig) {
    this.source = opts.source
    this.token = opts.token
    this.config = opts.config
    this.baseUrl = opts.baseUrl?.replace(/\/+$/, "")

    if (
      this.source === "cloudflare_r2" ||
      this.source === "backblaze_b2" ||
      this.source === "s3_storage"
    ) {
      const cfg = this.config as {
        endpoint?: string
        accountId?: string
        accessKeyId?: string
        keyId?: string
        region?: string
      }
      const rawEndpoint =
        cfg.endpoint ||
        (cfg.accountId ? `https://${cfg.accountId}.r2.cloudflarestorage.com` : undefined)
      const endpoint = rawEndpoint?.startsWith("http")
        ? rawEndpoint
        : rawEndpoint
          ? `https://${rawEndpoint}`
          : undefined
      const accessKeyId = cfg.accessKeyId || cfg.keyId || ""

      this.s3Client = new S3Client({
        endpoint,
        region: (cfg.region as string) || "auto",
        // MinIO and most self-hosted S3 gateways only answer path-style requests.
        ...(this.source === "s3_storage" ? { forcePathStyle: true } : {}),
        credentials: {
          accessKeyId,
          secretAccessKey: this.token,
        },
      })
    } else if (this.source === "supabase") {
      const cfg = this.config as { projectUrl?: string }
      const url = cfg.projectUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
      if (url) {
        this.supabaseClient = createClient(url, this.token)
      }
    }
  }

  getBucketName(): string {
    const cfg = this.config as { bucket?: string; repoId?: string }
    return cfg.bucket || cfg.repoId || "sayabot-storage"
  }

  private hfBase(): string {
    return this.baseUrl ?? "https://huggingface.co"
  }

  /** `owner/name` with each segment encoded, keeping the slash the Hub API expects. */
  private hfRepoPath(repo: string): string {
    return repo
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")
  }

  /**
   * Hugging Face has no per-file write endpoint: a write is a commit on `main`. The body is
   * NDJSON — a header line, then one line per file operation.
   */
  private async huggingfaceCommit(
    repo: string,
    operations: Record<string, unknown>[],
    summary: string,
  ): Promise<unknown> {
    const body = [
      JSON.stringify({ key: "header", value: { summary } }),
      ...operations.map((operation) => JSON.stringify(operation)),
    ].join("\n")

    const res = await fetch(`${this.hfBase()}/api/datasets/${this.hfRepoPath(repo)}/commit/main`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/x-ndjson",
      },
      body: `${body}\n`,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Hugging Face commit failed (${res.status}): ${text.slice(0, 150)}`)
    }
    return res.json().catch(() => ({}))
  }

  async listFiles(prefix = "", limit = 50): Promise<StorageFileMeta[]> {
    const bucket = this.getBucketName()
    const cleanPrefix = prefix.replace(/^\/+/, "")

    if (this.s3Client) {
      const res = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: cleanPrefix,
          MaxKeys: Math.min(100, Math.max(1, limit)),
        }),
      )
      return (res.Contents ?? []).map((item) => ({
        name: item.Key?.split("/").pop() || (item.Key ?? "file"),
        path: item.Key || "",
        size: item.Size,
        updatedAt: item.LastModified?.toISOString(),
      }))
    }

    if (this.supabaseClient) {
      const { data, error } = await this.supabaseClient.storage
        .from(bucket)
        .list(cleanPrefix, { limit: Math.min(100, limit) })
      if (error) {
        throw new Error(`Supabase storage list failed: ${error.message}`)
      }
      return (data ?? []).map((item) => ({
        name: item.name,
        path: cleanPrefix ? `${cleanPrefix.replace(/\/+$/, "")}/${item.name}` : item.name,
        size: item.metadata?.size,
        updatedAt: item.updated_at ?? undefined,
        contentType: item.metadata?.mimetype,
      }))
    }

    if (this.source === "huggingface") {
      const cfg = this.config as { repoId?: string }
      const repo = cfg.repoId
      if (!repo) throw new Error("Hugging Face repoId is not configured")
      const url = `${this.hfBase()}/api/datasets/${this.hfRepoPath(repo)}/tree/main/${cleanPrefix}`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.token}` },
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Hugging Face list failed (${res.status}): ${text.slice(0, 100)}`)
      }
      const data = (await res.json()) as Array<{ path: string; size?: number; type?: string }>
      return (data ?? [])
        .filter((i) => i.type !== "directory")
        .slice(0, limit)
        .map((item) => ({
          name: item.path.split("/").pop() || item.path,
          path: item.path,
          size: item.size,
        }))
    }

    throw new Error(`Storage provider '${this.source}' is not supported`)
  }

  async readFile(filePath: string): Promise<{ content: string; contentType?: string }> {
    const bucket = this.getBucketName()
    const cleanPath = filePath.replace(/^\/+/, "")

    if (this.s3Client) {
      const res = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: cleanPath,
        }),
      )
      const content = await res.Body?.transformToString("utf-8")
      return {
        content: content || "",
        contentType: res.ContentType,
      }
    }

    if (this.supabaseClient) {
      const { data, error } = await this.supabaseClient.storage.from(bucket).download(cleanPath)
      if (error) {
        throw new Error(`Supabase download failed: ${error.message}`)
      }
      const text = await data.text()
      return {
        content: text,
        contentType: data.type,
      }
    }

    if (this.source === "huggingface") {
      const cfg = this.config as { repoId?: string }
      const repo = cfg.repoId
      if (!repo) throw new Error("Hugging Face repoId is not configured")
      const url = `${this.hfBase()}/datasets/${this.hfRepoPath(repo)}/resolve/main/${cleanPath}`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.token}` },
      })
      if (!res.ok) {
        throw new Error(`Hugging Face file download failed (${res.status})`)
      }
      const text = await res.text()
      return {
        content: text,
        contentType: res.headers.get("content-type") || undefined,
      }
    }

    throw new Error(`Storage provider '${this.source}' is not supported`)
  }

  async uploadFile(
    filePath: string,
    content: string,
    contentType = "text/plain",
  ): Promise<{ ok: boolean; path: string }> {
    const bucket = this.getBucketName()
    const cleanPath = filePath.replace(/^\/+/, "")

    if (this.s3Client) {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: cleanPath,
          Body: content,
          ContentType: contentType,
        }),
      )
      return { ok: true, path: cleanPath }
    }

    if (this.supabaseClient) {
      const { error } = await this.supabaseClient.storage.from(bucket).upload(cleanPath, content, {
        upsert: true,
        contentType,
      })
      if (error) {
        throw new Error(`Supabase upload failed: ${error.message}`)
      }
      return { ok: true, path: cleanPath }
    }

    if (this.source === "huggingface") {
      const cfg = this.config as { repoId?: string }
      const repo = cfg.repoId
      if (!repo) throw new Error("Hugging Face repoId is not configured")
      await this.huggingfaceCommit(
        repo,
        [{ key: "file", value: { path: cleanPath, content, encoding: "utf-8" } }],
        `Add ${cleanPath}`,
      )
      return { ok: true, path: cleanPath }
    }

    throw new Error(`Storage provider '${this.source}' is not supported`)
  }

  async deleteFile(filePath: string): Promise<{ ok: boolean; path: string }> {
    const bucket = this.getBucketName()
    const cleanPath = filePath.replace(/^\/+/, "")

    if (this.s3Client) {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: cleanPath,
        }),
      )
      return { ok: true, path: cleanPath }
    }

    if (this.supabaseClient) {
      const { error } = await this.supabaseClient.storage.from(bucket).remove([cleanPath])
      if (error) {
        throw new Error(`Supabase delete failed: ${error.message}`)
      }
      return { ok: true, path: cleanPath }
    }

    if (this.source === "huggingface") {
      const cfg = this.config as { repoId?: string }
      const repo = cfg.repoId
      if (!repo) throw new Error("Hugging Face repoId is not configured")
      await this.huggingfaceCommit(
        repo,
        [{ key: "deletedEntry", value: { path: cleanPath } }],
        `Delete ${cleanPath}`,
      )
      return { ok: true, path: cleanPath }
    }

    throw new Error(`Storage provider '${this.source}' is not supported`)
  }
}
