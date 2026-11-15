# Document Extraction Tool (`document_extract`)

`document_extract` converts PDFs, images, financial statements, and invoices into Markdown and structured tables through pluggable OCR engines: self-hosted Docling or Marker, cloud Mistral OCR, or a multimodal vision LLM. The provider is configured per org in Settings → Tools (`org_tool_configs.tool = "document_extract"`); when the selected engine fails, extraction automatically falls back to the Vision LLM path rather than erroring the turn.

Source files: `apps/orchestrator/src/tools/builtins/document.ts`, `apps/orchestrator/src/tools/secrets.ts:17-34`, `apps/orchestrator/src/ssrf.ts`, `apps/orchestrator/src/tools/builtins/document.test.ts`

---

## 🎛️ Registration

`documentTools({ orgId, agentId, roomId })` returns exactly one tool (`document.ts:396-452`); it is registered unless the capability is explicitly disabled — `caps.document !== false` (`src/tools/index.ts:350-352`), so default-capability agents always have it. `dangerous: false`.

## 📥 Schema (`document.ts:405-425`)

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `source` | string (min 1) | — | Public URL, internal storage URI, or local container file path to the PDF or image document |
| `extractTables` | boolean | `true` | Use neural TableFormer to reconstruct nested multi-column tables |
| `format` | enum `markdown \| json \| tables_csv` | `"markdown"` | Desired output format |
| `maxPages` | int 1–100 | optional | Limit on the number of pages to extract |

Note: the agent-facing schema does not expose `provider`/`apiKey`/`baseUrl`; those come from the org tool config (see below). The lower-level `executeDocumentExtract()` (`document.ts:356-392`) accepts `provider`, `apiKey`, `baseUrl`, and `fallbackToVision` for direct callers.

## 🧩 Providers (`DOCUMENT_PROVIDERS`, `document.ts:41-162`)

| Provider | Tag | Badge | Requires | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `docling` (IBM Research) | Free / Self-Hosted | Free (SOTA Tables) | self-hosted URL (default `http://localhost:5001`) | DocLayNet layout + TableFormer tables, ~2.5 GB weights |
| `marker` (Vik Paruchuri) | Free / Self-Hosted | Free (Books & Papers) | self-hosted URL (default `http://localhost:5002`) | Surya OCR; strong on academic papers |
| `tesseract` / `vision_llm` / `mistral_ocr` / `aws_textract` | Free / Cloud | various | URL or API key | Present in the metadata catalog; see implementation notes |

The catalog carries hardware/cost metadata for settings UIs (asserted in `document.test.ts:23-34`), but the execution dispatcher implements **docling, marker, mistral_ocr, and vision_llm** paths (`document.ts:362-379`). Unknown providers default to docling (`document.ts:377-379`).

## ⚙️ Execution (`document.ts:356-392` + provider functions)

The tool's `execute` resolves config first (`document.ts:428-437`):

```typescript
config = await resolveToolCredential({ orgId, agentId, tool: "document_extract" }).catch(() => null)
const selectedProvider = (config?.provider as DocumentOcrProvider) || "docling"
const baseUrl = config?.baseUrl
const apiKey = config?.apiKey
const fallbackToVision = config?.fallbackToVision !== false
```

`resolveToolCredential` reads the sealed `org_tool_configs.configEnc` (AES-256-GCM under `MESH_KEK`) — no agent-level canonical env grant applies to this tool ([./secrets-broker.md](./secrets-broker.md)).

### Docling (`executeDocling`, `document.ts:198-253`)

- Validates the configured `baseUrl` with `assertSafeWebhookUrl(baseUrl, true)` — the `allowPrivate: true` flag permits self-hosted instances on private networks (`ssrf.ts:11-42`), but still enforces http/https and no embedded credentials.
- `POST <baseUrl>/v1alpha/convert/source` with `{ source: { url: source }, options: { to_formats, do_table_structure, max_num_pages? } }`.
- Non-OK response → `throw new Error("Docling service responded with status <status>: <first 300 chars>")`.
- Parses `document.markdown` (or `markdown`), `document.tables` entries into `ExtractedTable { id, rows, cols, markdown, grid }`, and `page_count`.

### Marker (`executeMarker`, `document.ts:255-288`)

- Same SSRF guard; `POST <baseUrl>/convert` with `{ url: source }`.
- Returns `markdown: data.markdown || data.text` with empty tables.

### Mistral OCR (`executeMistralOcr`, `document.ts:290-331`)

- Requires an API key (`"Mistral OCR requires an API key (Bearer token)."`)
- `POST https://api.mistral.ai/v1/ocr` with `model: "mistral-ocr-latest"`, `document: { type: "document_url", document_url: source }`.
- Pages are joined with `\n\n---\n\n` into one Markdown string.

### Vision LLM (`executeVisionLlm`, `document.ts:333-352`)

- Currently returns structured placeholder Markdown (the comment marks it as simulated/direct vision prompt extraction): `"### Document Extract (Vision AI)…"` — no live provider call in this code path.

### Fallback behavior (`document.ts:380-391`)

If the selected provider throws and `fallbackToVision` is enabled (default true) and the provider isn't already `vision_llm`:

```typescript
console.warn(`[document_extract] provider "${provider}" failed (${message}), falling back to Vision LLM...`)
return { ...visionResult, fallback: true, warning: `Primary engine "${provider}" was unavailable: ${message}. Automatically fell back to Multimodal Vision.` }
```

With fallback disabled, the original error propagates.

### Output shape (`DocumentExtractOutput`, `document.ts:172-182`)

```typescript
{
  provider: string
  source: string
  pageCount?: number
  markdown: string
  tables: ExtractedTable[]   // { id?, rows, cols, markdown, grid? }
  tablesCount: number
  processingTimeMs: number
  fallback?: boolean
  warning?: string
}
```

## 🗃️ Tables and events

| Concern | Details |
| :--- | :--- |
| DB tables | `org_tool_configs` (read-only, via `loadOrgToolConfig`); results are returned to the model and stored in `tool_calls` by the audit layer — no dedicated document tables |
| Realtime events | none beyond standard `tool.started` / `tool.finished` |
| Env vars | none; docling/marker endpoints come from org config (`baseUrl`), Mistral key from org config `apiKey` |

## ⚠️ Error modes

| Condition | Result |
| :--- | :--- |
| Docling/Marker HTTP error | throw with status + 300-char body excerpt → fallback to vision (if enabled) |
| Mistral key missing | throw `"Mistral OCR requires an API key (Bearer token)."` → fallback |
| Provider throws with fallback disabled | error propagates; audit layer stores `status: "error"` and the model sees `{ ok: false, error }` |
| Self-hosted URL unsafe (non-http/https or embedded credentials) | `assertSafeWebhookUrl` throws before any fetch |

## 🧪 Examples (from `document.test.ts`)

```typescript
// Tool shape (document.test.ts:36-42)
const tools = documentTools({ orgId: "test-org" })
expect(tools.length).toBe(1)
expect(tools[0]!.name).toBe("document_extract")
expect(tools[0]!.dangerous).toBe(false)

// Docling success with mocked HTTP (document.test.ts:44+): a mocked
// 200 JSON response with document.markdown/document.tables yields
// { provider: "docling", markdown, tables: [...], tablesCount, processingTimeMs }

// Provider catalog assertions (document.test.ts:23-34)
const docling = DOCUMENT_PROVIDERS.find((p) => p.id === "docling")
expect(docling?.tableAccuracy).toContain("99%")
```

## ⚠️ Notes

1. **`tesseract` and `aws_textract` have no execute path** in `executeDocumentExtract` — they appear in `DOCUMENT_PROVIDERS` metadata only; selecting them falls through to the docling default (`document.ts:377-379`).
2. **`format: "json" | "tables_csv"`** only alters Docling's `to_formats` (json vs md) and is otherwise passed through unchanged; Marker/Mistral always return Markdown.
3. **Private-network self-hosting is intentional**: `assertSafeWebhookUrl(baseUrl, true)` allows private addresses for docling/marker, unlike the public-web tools ([./tool-web.md](./tool-web.md)).

Related docs: [./tool-system.md](./tool-system.md) · [./tool-web.md](./tool-web.md) · [./secrets-broker.md](./secrets-broker.md) · [../../core/redact-and-breakers.md](../../core/redact-and-breakers.md) · [../../database/schema-agents-and-templates.md](../../database/schema-agents-and-templates.md)
