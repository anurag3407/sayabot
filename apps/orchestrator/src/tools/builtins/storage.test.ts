import { describe, expect, it, vi, beforeEach } from "vitest"
import { storageTools } from "./storage"
import { getConnectorService } from "../../connectors/service"

vi.mock("../../connectors/service", () => ({
  getConnectorService: vi.fn(),
}))

describe("storageTools", () => {
  const mockService = {
    getDecryptedConnector: vi.fn(),
    getAgentScope: vi.fn(),
    getStorageTarget: vi.fn(),
  }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getConnectorService).mockReturnValue(mockService as any)
  })

  it("returns empty array if no cloud storage connector is configured", async () => {
    mockService.getStorageTarget.mockResolvedValue(null)

    const tools = await storageTools({
      orgId: "org-test-1",
      agentId: "agent-test-1",
      roomId: "room-test-1",
    })

    expect(tools).toEqual([])
  })

  it("returns full suite of storage tools when Supabase storage connector exists", async () => {
    mockService.getStorageTarget.mockResolvedValue({
      connector: {
        id: "conn-supa-1",
        name: "Supabase Storage",
        source: "supabase",
        config: { projectUrl: "https://test.supabase.co", bucket: "test-bucket" },
      },
      token: "test-service-key",
      granted: false,
    })

    const tools = await storageTools({
      orgId: "org-test-1",
      agentId: "agent-test-1",
      roomId: "room-test-1",
    })

    expect(tools).toHaveLength(4)
    const names = tools.map((t) => t.name)
    expect(names).toContain("storage_list_files")
    expect(names).toContain("storage_read_file")
    expect(names).toContain("storage_upload_file")
    expect(names).toContain("storage_delete_file")

    // Golden Rule 4: Dangerous tools MUST be marked dangerous: true
    const deleteTool = tools.find((t) => t.name === "storage_delete_file")!
    expect(deleteTool.dangerous).toBe(true)

    const listTool = tools.find((t) => t.name === "storage_list_files")!
    expect(listTool.dangerous).toBe(false)
  })

  it("uses the connector the agent was granted, not another active provider", async () => {
    mockService.getStorageTarget.mockResolvedValue({
      connector: {
        id: "conn-r2-1",
        name: "Cloudflare R2",
        source: "cloudflare_r2",
        config: { bucket: "artifacts", accountId: "acc-123", accessKeyId: "key-1" },
      },
      token: "secret-token",
      granted: true,
    })
    mockService.getAgentScope.mockResolvedValue({})

    const tools = await storageTools({
      orgId: "org-test-1",
      agentId: "agent-test-1",
      roomId: "room-test-1",
    })

    const listTool = tools.find((t) => t.name === "storage_list_files")!
    expect(listTool.description).toContain("cloudflare_r2")
    expect(mockService.getAgentScope).toHaveBeenCalledWith("agent-test-1", "conn-r2-1")
  })

  it("enforces read-only scope restriction for write and delete tools", async () => {
    mockService.getStorageTarget.mockResolvedValue({
      connector: {
        id: "conn-r2-1",
        name: "Cloudflare R2",
        source: "cloudflare_r2",
        config: { bucket: "artifacts", accountId: "acc-123", accessKeyId: "key-1" },
      },
      token: "secret-token",
      granted: true,
    })
    // Agent has read-only grant
    mockService.getAgentScope.mockResolvedValue({
      readOnly: true,
    })

    const tools = await storageTools({
      orgId: "org-test-1",
      agentId: "agent-test-1",
      roomId: "room-test-1",
    })

    const uploadTool = tools.find((t) => t.name === "storage_upload_file")!
    const deleteTool = tools.find((t) => t.name === "storage_delete_file")!

    await expect(uploadTool.execute({ path: "test.txt", content: "data" })).rejects.toThrow(
      /read-only/i,
    )
    await expect(deleteTool.execute({ path: "test.txt" })).rejects.toThrow(/read-only/i)
  })

  it("enforces path prefix restrictions from agent scope", async () => {
    mockService.getStorageTarget.mockResolvedValue({
      connector: {
        id: "conn-b2-1",
        name: "Backblaze B2",
        source: "backblaze_b2",
        config: { bucket: "bucket-1", keyId: "key-1", endpoint: "s3.us-west-004.backblazeb2.com" },
      },
      token: "secret-key",
      granted: true,
    })
    // Agent is restricted to reports/
    mockService.getAgentScope.mockResolvedValue({
      allowedPrefixes: ["reports/"],
      readOnly: false,
    })

    const tools = await storageTools({
      orgId: "org-test-1",
      agentId: "agent-test-1",
      roomId: "room-test-1",
    })

    const readTool = tools.find((t) => t.name === "storage_read_file")!

    await expect(readTool.execute({ path: "private/secrets.env" })).rejects.toThrow(
      /outside this agent's allowed storage prefixes/i,
    )
  })
})
