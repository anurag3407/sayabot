import { fetchWithRetry } from "./rate-limiter"
import type { ConnectorDoc, ConnectorSearchOptions } from "./types"

export interface GoogleDriveConfig {
  accessToken: string
  fetchFn?: typeof fetch
}

export class GoogleDriveConnector {
  constructor(private config: GoogleDriveConfig) {}

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      Accept: "application/json",
    }
  }

  /**
   * Searches Google Drive files matching query text and scoped by allowed folder IDs.
   */
  async searchFiles(options: ConnectorSearchOptions): Promise<ConnectorDoc[]> {
    const limit = Math.min(25, Math.max(1, options.limit ?? 8))
    const searchTerms = options.query.replace(/'/g, "\\'")

    let q = `trashed = false and (name contains '${searchTerms}' or fullText contains '${searchTerms}')`

    if (options.allowedFolders && options.allowedFolders.length > 0) {
      const folderClauses = options.allowedFolders.map((f) => `'${f}' in parents`).join(" or ")
      q += ` and (${folderClauses})`
    }

    const params = new URLSearchParams({
      q,
      pageSize: String(limit),
      fields: "nextPageToken, files(id, name, mimeType, webViewLink, modifiedTime, owners, size)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      corpora: "allDrives",
    })

    const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`
    const response = await fetchWithRetry(
      url,
      {
        method: "GET",
        headers: this.headers,
      },
      { fetchFn: this.config.fetchFn },
    )

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Google Drive search failed (${response.status}): ${errText.slice(0, 150)}`)
    }

    const data = (await response.json()) as {
      files?: Array<{
        id: string
        name: string
        mimeType: string
        webViewLink?: string
        modifiedTime?: string
        owners?: Array<{ displayName?: string; emailAddress?: string }>
      }>
    }

    const files = data.files ?? []
    return files.map((f) => ({
      id: f.id,
      source: "google_drive" as const,
      title: f.name,
      content: `[Google Drive File: ${f.name} (type: ${f.mimeType})]`,
      url: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
      metadata: {
        mimeType: f.mimeType,
        lastModified: f.modifiedTime,
        author: f.owners?.[0]?.displayName || f.owners?.[0]?.emailAddress,
      },
    }))
  }

  /**
   * Reads and converts a Google Drive file into text/Markdown.
   * Handles Google Docs (exported to text), Google Sheets (exported to CSV), and raw text files.
   */
  async readFile(fileId: string): Promise<ConnectorDoc> {
    // 1. Fetch file metadata
    const metaUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,webViewLink,modifiedTime,owners&supportsAllDrives=true`
    const metaRes = await fetchWithRetry(
      metaUrl,
      {
        method: "GET",
        headers: this.headers,
      },
      { fetchFn: this.config.fetchFn },
    )

    if (!metaRes.ok) {
      throw new Error(`Failed to fetch file metadata: ${metaRes.statusText || metaRes.status}`)
    }

    const meta = (await metaRes.json()) as {
      id: string
      name: string
      mimeType: string
      webViewLink?: string
      modifiedTime?: string
      owners?: Array<{ displayName?: string }>
    }

    let content = ""

    // 2. Export based on MIME type
    if (meta.mimeType === "application/vnd.google-apps.document") {
      const exportUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`
      const exportRes = await fetchWithRetry(
        exportUrl,
        {
          method: "GET",
          headers: this.headers,
        },
        { fetchFn: this.config.fetchFn },
      )
      content = exportRes.ok ? await exportRes.text() : `[Could not export Google Doc ${fileId}]`
    } else if (meta.mimeType === "application/vnd.google-apps.spreadsheet") {
      const exportUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`
      const exportRes = await fetchWithRetry(
        exportUrl,
        {
          method: "GET",
          headers: this.headers,
        },
        { fetchFn: this.config.fetchFn },
      )
      content = exportRes.ok ? await exportRes.text() : `[Could not export Google Sheet ${fileId}]`
    } else if (meta.mimeType === "application/vnd.google-apps.presentation") {
      const exportUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`
      const exportRes = await fetchWithRetry(
        exportUrl,
        {
          method: "GET",
          headers: this.headers,
        },
        { fetchFn: this.config.fetchFn },
      )
      content = exportRes.ok ? await exportRes.text() : `[Could not export Google Slides ${fileId}]`
    } else {
      // Download raw content for text, markdown, json, etc.
      const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`
      const downloadRes = await fetchWithRetry(
        downloadUrl,
        {
          method: "GET",
          headers: this.headers,
        },
        { fetchFn: this.config.fetchFn },
      )
      content = downloadRes.ok ? await downloadRes.text() : `[Could not download file ${fileId}]`
    }

    return {
      id: meta.id,
      source: "google_drive",
      title: meta.name,
      content: content.slice(0, 100_000), // Cap at 100k characters for safe context window
      url: meta.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
      metadata: {
        mimeType: meta.mimeType,
        lastModified: meta.modifiedTime,
        author: meta.owners?.[0]?.displayName,
      },
    }
  }
}
