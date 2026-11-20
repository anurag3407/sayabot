# Cloud Storage Connectors (Supabase, R2, B2, S3/MinIO, Hugging Face)

`CloudStorageClient` is the object-storage half of the connector platform. One class serves all five
storage sources from `STORAGE_CONNECTOR_SOURCES` — Supabase Storage, Cloudflare R2, Backblaze B2,
generic S3/MinIO, and Hugging Face datasets — with the same four operations the `storage_*` tools call:
list, read, upload, delete. The credential arrives already decrypted from `ConnectorService`
(`getStorageTarget` / `getDecryptedConnector`), the bucket or repo comes from the connector's
`config` jsonb, and the per-agent scope (`allowedPrefixes`, `readOnly`) is enforced by the tool layer
(see [Connector tools](../tools/tool-connectors.md)). `storage_list_files` and `storage_read_file` are
safe; `storage_upload_file` and `storage_delete_file` are both `dangerous: true`, because a write lands
in a bucket anything in the workspace can read — upload is not a quieter form of delete.

Source files: `apps/orchestrator/src/connectors/storage.ts`, `apps/orchestrator/src/connectors/types.ts`, `apps/orchestrator/src/tools/builtins/storage.ts`

---

## 🧭 Backend selection

The constructor picks a backend from the source (`storage.ts:38-76`):

| Source          | Backend                         | Credential                | `config` keys                                                                                               |
| :-------------- | :------------------------------ | :------------------------ | :---------------------------------------------------------------------------------------------------------- |
| `cloudflare_r2` | `S3Client`                      | R2 secret access key      | `accountId` (→ `https://<id>.r2.cloudflarestorage.com`), `accessKeyId`, `bucket`, `region` (default `auto`) |
| `backblaze_b2`  | `S3Client`                      | application key           | `endpoint` (host or URL), `keyId`, `bucket`                                                                 |
| `s3_storage`    | `S3Client`                      | secret access key         | `endpoint`, `accessKeyId`, `bucket`, `region` (default `auto`)                                              |
| `supabase`      | `@supabase/supabase-js` storage | service-role / secret key | `projectUrl`, `bucket` (default `sayabot-storage`)                                                          |
| `huggingface`   | Hub REST API                    | user access token         | `repoId` (`owner/name` dataset repo)                                                                        |

`getBucketName()` returns `config.bucket || config.repoId || "sayabot-storage"` and is what the tool
descriptions and results report.

The S3 endpoints are normalized the same way in the orchestrator and in the settings connection test
(`apps/web/src/lib/actions/connectors.ts`): a bare host gets `https://` prepended, and `s3_storage`
sets **`forcePathStyle: true`** because MinIO and most self-hosted gateways only answer path-style
requests.

## 📄 Operations

All path arguments have leading slashes stripped before use, and `listFiles` clamps the limit to
1–100 (default 50).

| Operation                                | S3                                                | Supabase                                                                                         | Hugging Face                                                            |
| :--------------------------------------- | :------------------------------------------------ | :----------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| `listFiles(prefix, limit)`               | `ListObjectsV2Command` with `Prefix` + `MaxKeys`  | `storage.from(bucket).list(prefix, { limit })` (errors become `Supabase storage list failed: …`) | `GET /api/datasets/<repo>/tree/main/<prefix>`, directories filtered out |
| `readFile(path)`                         | `GetObjectCommand` + `transformToString("utf-8")` | `storage.from(bucket).download(path)` → `.text()`                                                | `GET /datasets/<repo>/resolve/main/<path>`                              |
| `uploadFile(path, content, contentType)` | `PutObjectCommand`                                | `upload(..., { upsert: true, contentType })`                                                     | commit (below)                                                          |
| `deleteFile(path)`                       | `DeleteObjectCommand`                             | `storage.from(bucket).remove([path])`                                                            | commit (below)                                                          |

Results are `StorageFileMeta` (`name`, `path`, `size?`, `updatedAt?`, `contentType?`); reads return
`{ content, contentType? }`. A source that reaches the end of a switch throws
`Storage provider '<source>' is not supported`, which is unreachable for the five supported sources.

## 🤗 Hugging Face writes are commits

The Hub has no per-file write endpoint: `PUT`/`DELETE` on a raw or resolve URL is not part of the API.
A write is a commit on `main`, sent as **NDJSON** (`huggingfaceCommit`, `storage.ts:79-115`):

```
POST https://huggingface.co/api/datasets/<owner>/<repo>/commit/main
Authorization: Bearer <token>
Content-Type: application/x-ndjson

{"key":"header","value":{"summary":"Add reports/a.md"}}
{"key":"file","value":{"path":"reports/a.md","content":"# hi","encoding":"utf-8"}}
```

Deletes use the same header line followed by
`{"key":"deletedEntry","value":{"path":"reports/a.md"}}`. Each repo segment is URL-encoded
individually (`hfRepoPath`) so the `/` between owner and name survives. A non-2xx response becomes
`Hugging Face commit failed (<status>): <body slice>`; a missing `config.repoId` fails before any
request with `Hugging Face repoId is not configured`.

## 🧪 Tests

| Test file                                              | Covers                                                                                                                                                                       |
| :----------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/orchestrator/src/connectors/storage.test.ts`     | The Hugging Face commit body (header + file / deletedEntry), the `resolve` read URL, and the missing-repo error.                                                             |
| `apps/orchestrator/src/tools/builtins/storage.test.ts` | Which connector the tools target, `readOnly` blocking upload/delete, `allowedPrefixes` rejection, and `storage_upload_file` / `storage_delete_file` being `dangerous: true`. |
| `tests/integration/connector-dispatch.test.ts`         | All four tools for every storage source through `buildTools` → `toAuditedTools`, with upload approved through a real `pending_approval` row.                                 |

---

Related docs:

- [Connector platform](./connector-platform.md) — `getStorageTarget` grant resolution, decryption, scope grants
- [Connector tools](../tools/tool-connectors.md) — the `storage_*` agent tools
- [Search, Files & Storage](../../web/pages/search-files-storage.md) — the settings page that saves these connectors and tests them
