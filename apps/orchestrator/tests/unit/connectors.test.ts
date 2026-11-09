import { describe, expect, it, vi } from "vitest"
import { encryptSecret } from "@sayabot/llm"
import { GoogleDriveConnector } from "../../src/connectors/google-drive"
import { SlackConnector } from "../../src/connectors/slack"
import { GitHubConnector } from "../../src/connectors/github"
import { ConnectorService } from "../../src/connectors/service"

describe("GoogleDriveConnector", () => {
  it("searches files using Drive v3 API", async () => {
    const mockFiles = [
      {
        id: "doc-1",
        name: "Q3 Financial Plan",
        mimeType: "application/vnd.google-apps.document",
        webViewLink: "https://docs.google.com/doc-1",
        modifiedTime: "2026-10-01T00:00:00Z",
      },
    ]

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ files: mockFiles }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const connector = new GoogleDriveConnector({
      accessToken: "test-token",
      fetchFn: mockFetch,
    })

    const results = await connector.searchFiles({ query: "Financial", limit: 5 })
    expect(results).toHaveLength(1)
    expect(results[0]?.title).toBe("Q3 Financial Plan")
    expect(results[0]?.source).toBe("google_drive")
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("googleapis.com/drive/v3/files"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    )
  })

  it("exports Google Docs text content via export endpoint", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "doc-1",
            name: "Compliance Doc",
            mimeType: "application/vnd.google-apps.document",
            webViewLink: "https://docs.google.com/doc-1",
            modifiedTime: "2026-10-01T00:00:00Z",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response("SOC2 Compliance Policy: All keys must be encrypted with AES-256.", {
          status: 200,
        }),
      )

    const connector = new GoogleDriveConnector({
      accessToken: "test-token",
      fetchFn: mockFetch,
    })

    const doc = await connector.readFile("doc-1")
    expect(doc.title).toBe("Compliance Doc")
    expect(doc.content).toContain("SOC2 Compliance Policy")
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("export?mimeType=text/plain"),
      expect.anything(),
    )
  })

  it("exports Google Sheets to CSV via export endpoint", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "sheet-1",
            name: "Budget",
            mimeType: "application/vnd.google-apps.spreadsheet",
            webViewLink: "https://docs.google.com/sheet-1",
            modifiedTime: "2026-10-01T00:00:00Z",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response("Department,Spend,Budget\nEngineering,50000,60000", {
          status: 200,
        }),
      )

    const connector = new GoogleDriveConnector({
      accessToken: "test-token",
      fetchFn: mockFetch,
    })

    const doc = await connector.readFile("sheet-1")
    expect(doc.title).toBe("Budget")
    expect(doc.content).toContain("Engineering,50000,60000")
  })
})

describe("SlackConnector", () => {
  it("searches messages and resolves user IDs to names", async () => {
    const mockMessages = {
      ok: true,
      messages: {
        matches: [
          {
            iid: "msg-1",
            text: "Hey <@U12345>, please check the checkout bug",
            permalink: "https://slack.com/msg-1",
            ts: "1690000000.000100",
            username: "sarah",
            channel: { id: "C001", name: "engineering" },
          },
        ],
      },
    }

    const mockUserInfo = {
      ok: true,
      user: {
        id: "U12345",
        name: "alex_dev",
        profile: { real_name: "Alex Smith", display_name: "Alex" },
      },
    }

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("search.messages")) {
        return Promise.resolve(new Response(JSON.stringify(mockMessages), { status: 200 }))
      }
      if (url.includes("users.info")) {
        return Promise.resolve(new Response(JSON.stringify(mockUserInfo), { status: 200 }))
      }
      return Promise.resolve(new Response("{}", { status: 404 }))
    })

    const connector = new SlackConnector({
      botToken: "xoxb-test",
      fetchFn: mockFetch,
    })

    const results = await connector.searchMessages({ query: "checkout bug" })
    expect(results).toHaveLength(1)
    expect(results[0]?.content).toContain("@Alex")
  })

  it("fetches thread replies in chronological order", async () => {
    const mockReplies = {
      ok: true,
      messages: [
        { user: "U1", text: "Root thread issue", ts: "1690000000.000100" },
        { user: "U2", text: "Resolved in commit abc", ts: "1690000010.000200" },
      ],
    }

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockReplies), { status: 200 }),
    )

    const connector = new SlackConnector({
      botToken: "xoxb-test",
      fetchFn: mockFetch,
    })

    const thread = await connector.readThread("C001", "1690000000.000100")
    expect(thread.content).toContain("Root thread issue")
    expect(thread.content).toContain("Resolved in commit abc")
    expect(thread.metadata.replyCount).toBe(2)
  })
})

describe("GitHubConnector", () => {
  it("searches repository code using GitHub API", async () => {
    const mockCodeResults = {
      items: [
        {
          name: "service.ts",
          path: "src/connectors/service.ts",
          html_url: "https://github.com/sayalabs/saaya/blob/main/src/connectors/service.ts",
          repository: { full_name: "sayalabs/saaya" },
        },
      ],
    }

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockCodeResults), { status: 200 }),
    )

    const connector = new GitHubConnector({
      token: "ghp-test",
      fetchFn: mockFetch,
    })

    const results = await connector.searchCode({
      query: "enforceAgentScope",
      allowedRepos: ["sayalabs/saaya"],
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.title).toBe("service.ts (sayalabs/saaya)")
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("repo%3Asayalabs%2Fsaaya"),
      expect.anything(),
    )
  })

  it("reads and base64-decodes file contents", async () => {
    const mockFilePayload = {
      name: "config.json",
      path: "config.json",
      encoding: "base64",
      content: Buffer.from(JSON.stringify({ port: 8080 })).toString("base64"),
      html_url: "https://github.com/sayalabs/saaya/blob/main/config.json",
      size: 14,
    }

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockFilePayload), { status: 200 }),
    )

    const connector = new GitHubConnector({
      token: "ghp-test",
      fetchFn: mockFetch,
    })

    const doc = await connector.getFileContent("sayalabs", "saaya", "config.json")
    expect(doc.content).toContain(`"port":8080`)
  })

  it("fetches issue and PR discussions with comments", async () => {
    const mockIssue = {
      number: 42,
      title: "Bug in authentication flow",
      body: "Tokens expire prematurely",
      state: "open",
      html_url: "https://github.com/sayalabs/saaya/issues/42",
      user: { login: "octocat" },
      created_at: "2026-10-01T12:00:00Z",
    }

    const mockComments = [
      {
        user: { login: "reviewer" },
        body: "Fixed in PR #43",
        created_at: "2026-10-01T13:00:00Z",
      },
    ]

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/comments")) {
        return Promise.resolve(new Response(JSON.stringify(mockComments), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(mockIssue), { status: 200 }))
    })

    const connector = new GitHubConnector({
      token: "ghp-test",
      fetchFn: mockFetch,
    })

    const doc = await connector.getIssueOrPullRequest("sayalabs", "saaya", 42)
    expect(doc.title).toContain("#42: Bug in authentication flow")
    expect(doc.content).toContain("Tokens expire prematurely")
    expect(doc.content).toContain("Fixed in PR #43")
  })
})

describe("ConnectorService Scoping & Decryption", () => {
  const mockKek = Buffer.alloc(32, 7).toString("base64")
  const encrypted = encryptSecret("xoxb-real-slack-token", mockKek)

  it("rejects agent with out-of-scope Slack channel", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              // First call: workspaceConnectors query
              // Second call: agentConnectorGrants query
              if (mockDb.select.mock.calls.length === 1) {
                return Promise.resolve([
                  {
                    id: "c-1",
                    orgId: "org-1",
                    source: "slack",
                    name: "Slack",
                    status: "active",
                    ciphertext: encrypted.ciphertext,
                    iv: encrypted.iv,
                    tag: encrypted.tag,
                  },
                ])
              }
              return Promise.resolve([
                {
                  id: "g-1",
                  orgId: "org-1",
                  agentId: "agent-1",
                  connectorId: "c-1",
                  scopeConfig: {
                    allowedChannels: ["engineering", "security"],
                  },
                },
              ])
            }),
          }),
        }),
      }),
    }

    const service = new ConnectorService({
      db: mockDb,
      kek: mockKek,
    })

    await expect(
      service.searchSlack({
        agentId: "agent-1",
        orgId: "org-1",
        query: "bonus calculations",
        channel: "executive-confidential",
      }),
    ).rejects.toThrow("Channel 'executive-confidential' is outside this agent's allowed channels")
  })

  it("throws when agent has no grant for connector", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              if (mockDb.select.mock.calls.length === 1) {
                return Promise.resolve([
                  {
                    id: "c-1",
                    orgId: "org-1",
                    source: "google_drive",
                    name: "Google Drive",
                    status: "active",
                    ciphertext: encrypted.ciphertext,
                    iv: encrypted.iv,
                    tag: encrypted.tag,
                  },
                ])
              }
              // No grant found
              return Promise.resolve([])
            }),
          }),
        }),
      }),
    }

    const service = new ConnectorService({
      db: mockDb,
      kek: mockKek,
    })

    await expect(
      service.searchGoogleDrive({
        agentId: "unauthorized-agent",
        orgId: "org-1",
        query: "finance sheet",
      }),
    ).rejects.toThrow("Access Denied: This agent is not granted access to this connector.")
  })
})
