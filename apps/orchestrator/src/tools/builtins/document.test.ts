import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DOCUMENT_PROVIDERS, documentTools, executeDocumentExtract } from "./document"

describe("documentTools", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("exposes all documented providers with complete hardware and pricing specs", () => {
    expect(DOCUMENT_PROVIDERS.length).toBeGreaterThanOrEqual(5)

    const docling = DOCUMENT_PROVIDERS.find((p) => p.id === "docling")
    expect(docling).toBeDefined()
    expect(docling?.tag).toBe("Free / Self-Hosted")
    expect(docling?.hardware.cpu).toContain("4+")
    expect(docling?.hardware.ram).toContain("4–8 GB")
    expect(docling?.tableAccuracy).toContain("99%")

    const vision = DOCUMENT_PROVIDERS.find((p) => p.id === "vision_llm")
    expect(vision).toBeDefined()
    expect(vision?.tag).toBe("Cloud / BYOK")
    expect(vision?.hardware.cpu).toContain("0 Cores")
    expect(vision?.hardware.ram).toContain("0 MB")
  })

  it("creates tool specification with proper schema", () => {
    const tools = documentTools({ orgId: "test-org" })
    expect(tools.length).toBe(1)
    expect(tools[0]!.name).toBe("document_extract")
    expect(tools[0]!.dangerous).toBe(false)
  })

  it("executes Docling successfully with mocked response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        document: {
          page_count: 2,
          markdown: "# Financial Statement\n\n| Q1 | Q2 |\n|---|---|\n| 100 | 200 |",
          tables: [
            {
              id: "table_1",
              rows: 2,
              cols: 2,
              markdown: "| Q1 | Q2 |\n|---|---|\n| 100 | 200 |",
            },
          ],
        },
      }),
    }) as any

    const result = await executeDocumentExtract({
      source: "https://example.com/sample.pdf",
      provider: "docling",
      baseUrl: "http://localhost:5001",
    })

    expect(result.provider).toBe("docling")
    expect(result.pageCount).toBe(2)
    expect(result.tablesCount).toBe(1)
    expect(result.markdown).toContain("Financial Statement")
  })

  it("gracefully falls back to Vision LLM when local Docling is unavailable", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:5001"))

    const result = await executeDocumentExtract({
      source: "https://example.com/invoice.pdf",
      provider: "docling",
      baseUrl: "http://localhost:5001",
      fallbackToVision: true,
    })

    expect(result.fallback).toBe(true)
    expect(result.warning).toContain("Primary engine \"docling\" was unavailable")
    expect(result.provider).toBe("vision_llm")
    expect(result.markdown).toContain("Document Extract (Vision AI)")
  })
})
