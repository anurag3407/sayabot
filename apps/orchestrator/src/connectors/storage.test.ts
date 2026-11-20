import { afterEach, describe, expect, it, vi } from "vitest"
import { CloudStorageClient } from "./storage"

function linesOf(init: RequestInit): Record<string, unknown>[] {
  return String(init.body)
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe("CloudStorageClient (Hugging Face)", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("uploads through the Hub commit API as NDJSON", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({})))
    vi.stubGlobal("fetch", fetchMock)
    const client = new CloudStorageClient({
      source: "huggingface",
      token: "hf_test",
      config: { repoId: "acme/data" },
    })

    await client.uploadFile("reports/a.md", "# hi", "text/markdown")

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://huggingface.co/api/datasets/acme/data/commit/main")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-ndjson")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer hf_test")
    expect(linesOf(init)).toEqual([
      { key: "header", value: { summary: "Add reports/a.md" } },
      { key: "file", value: { path: "reports/a.md", content: "# hi", encoding: "utf-8" } },
    ])
  })

  it("deletes through the Hub commit API", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({})))
    vi.stubGlobal("fetch", fetchMock)
    const client = new CloudStorageClient({
      source: "huggingface",
      token: "hf_test",
      config: { repoId: "acme/data" },
    })

    await client.deleteFile("/reports/a.md")

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://huggingface.co/api/datasets/acme/data/commit/main")
    expect(linesOf(init)).toEqual([
      { key: "header", value: { summary: "Delete reports/a.md" } },
      { key: "deletedEntry", value: { path: "reports/a.md" } },
    ])
  })

  it("reads a file from the resolve URL", async () => {
    const fetchMock = vi.fn(async () => new Response("# hi"))
    vi.stubGlobal("fetch", fetchMock)
    const client = new CloudStorageClient({
      source: "huggingface",
      token: "hf_test",
      config: { repoId: "acme/data" },
    })

    const file = await client.readFile("reports/a.md")

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(file.content).toBe("# hi")
    expect(url).toBe("https://huggingface.co/datasets/acme/data/resolve/main/reports/a.md")
  })

  it("explains a missing repo id instead of calling out", async () => {
    const fetchMock = vi.fn(async () => new Response(""))
    vi.stubGlobal("fetch", fetchMock)
    const client = new CloudStorageClient({ source: "huggingface", token: "hf_test", config: {} })

    await expect(client.uploadFile("a.md", "x")).rejects.toThrow(/repoId is not configured/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
