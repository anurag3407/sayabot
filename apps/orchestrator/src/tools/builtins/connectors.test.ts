import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ConnectorDoc } from "../../connectors/types"
import { connectorTools } from "./connectors"

const mockConnectorService = vi.hoisted(() => ({
  searchGoogleDrive: vi.fn(),
  readGoogleDriveFile: vi.fn(),
  searchSlack: vi.fn(),
  readSlackThread: vi.fn(),
  searchGitHubCode: vi.fn(),
  getGitHubFile: vi.fn(),
  getGitHubIssueOrPr: vi.fn(),
  postSlackMessage: vi.fn(),
  listDiscordChannels: vi.fn(),
  readDiscordMessages: vi.fn(),
  sendDiscordMessage: vi.fn(),
  readTelegramMessages: vi.fn(),
  sendTelegramMessage: vi.fn(),
  sendWhatsAppText: vi.fn(),
  sendWhatsAppTemplate: vi.fn(),
}))

vi.mock("../../connectors/service", () => ({
  getConnectorService: () => mockConnectorService,
}))

describe("connectorTools", () => {
  const defaultOpts = {
    orgId: "org-test-123",
    agentId: "agent-test-456",
    roomId: "room-test-789",
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("registration and source filtering", () => {
    it("registers the 8 Drive, Slack and GitHub tools by default when sources option is omitted", () => {
      const tools = connectorTools(defaultOpts)
      expect(tools).toHaveLength(8)
      const names = tools.map((t) => t.name)
      expect(names).toEqual([
        "gdrive_search",
        "gdrive_read_file",
        "slack_search",
        "slack_read_thread",
        "slack_send_message",
        "github_search_code",
        "github_get_file",
        "github_get_issue_or_pr",
      ])
      for (const tool of tools) {
        expect(tool.dangerous).toBe(tool.name === "slack_send_message")
        expect(tool.description).toBeTruthy()
        expect(tool.schema).toBeDefined()
        expect(typeof tool.execute).toBe("function")
      }
    })

    it("filters tools based on specified sources", () => {
      const gdriveOnly = connectorTools({ ...defaultOpts, sources: ["google_drive"] })
      expect(gdriveOnly.map((t) => t.name)).toEqual(["gdrive_search", "gdrive_read_file"])

      const slackOnly = connectorTools({ ...defaultOpts, sources: ["slack"] })
      expect(slackOnly.map((t) => t.name)).toEqual(["slack_search", "slack_read_thread", "slack_send_message"])

      const githubOnly = connectorTools({ ...defaultOpts, sources: ["github"] })
      expect(githubOnly.map((t) => t.name)).toEqual([
        "github_search_code",
        "github_get_file",
        "github_get_issue_or_pr",
      ])

      const multi = connectorTools({ ...defaultOpts, sources: ["google_drive", "github"] })
      expect(multi.map((t) => t.name)).toEqual([
        "gdrive_search",
        "gdrive_read_file",
        "github_search_code",
        "github_get_file",
        "github_get_issue_or_pr",
      ])

      const empty = connectorTools({ ...defaultOpts, sources: [] })
      expect(empty).toHaveLength(0)
    })
  })

  describe("gdrive_search tool", () => {
    const getTool = () => connectorTools(defaultOpts).find((t) => t.name === "gdrive_search")!

    describe("schema validation", () => {
      it("validates valid input and applies default limit of 8", () => {
        const tool = getTool()
        const parsed = tool.schema.parse({ query: "financial roadmap" })
        expect(parsed).toEqual({
          query: "financial roadmap",
          limit: 8,
        })
      })

      it("accepts custom limit within range [1, 20]", () => {
        const tool = getTool()
        const parsed = tool.schema.parse({ query: "q4 results", limit: 15 })
        expect(parsed).toEqual({
          query: "q4 results",
          limit: 15,
        })
      })

      it("rejects invalid inputs", () => {
        const tool = getTool()
        // Missing query
        expect(tool.schema.safeParse({}).success).toBe(false)
        // Empty query
        expect(tool.schema.safeParse({ query: "" }).success).toBe(false)
        // Non-string query
        expect(tool.schema.safeParse({ query: 123 }).success).toBe(false)
        // Limit below 1
        expect(tool.schema.safeParse({ query: "test", limit: 0 }).success).toBe(false)
        // Limit above 20
        expect(tool.schema.safeParse({ query: "test", limit: 21 }).success).toBe(false)
        // Non-integer limit
        expect(tool.schema.safeParse({ query: "test", limit: 5.5 }).success).toBe(false)
      })
    })

    describe("execute", () => {
      it("calls service.searchGoogleDrive with correct params and maps output fields", async () => {
        const tool = getTool()
        const mockDocs: ConnectorDoc[] = [
          {
            id: "drive-doc-1",
            source: "google_drive",
            title: "Q4 Roadmap",
            content: "Roadmap text content...",
            url: "https://docs.google.com/document/d/drive-doc-1",
            metadata: {
              mimeType: "application/vnd.google-apps.document",
              lastModified: "2026-11-01T10:00:00Z",
              author: "alice@example.com",
            },
          },
          {
            id: "drive-doc-2",
            source: "google_drive",
            title: "Budget Sheet",
            content: "CSV content...",
            url: "https://docs.google.com/spreadsheets/d/drive-doc-2",
            metadata: {
              mimeType: "application/vnd.google-apps.spreadsheet",
              lastModified: "2026-11-05T14:30:00Z",
              author: "bob@example.com",
            },
          },
        ]
        mockConnectorService.searchGoogleDrive.mockResolvedValueOnce(mockDocs)

        const result = (await tool.execute({ query: "budget", limit: 5 })) as any

        expect(mockConnectorService.searchGoogleDrive).toHaveBeenCalledTimes(1)
        expect(mockConnectorService.searchGoogleDrive).toHaveBeenCalledWith({
          agentId: defaultOpts.agentId,
          orgId: defaultOpts.orgId,
          query: "budget",
          limit: 5,
        })

        expect(result).toEqual({
          query: "budget",
          count: 2,
          files: [
            {
              id: "drive-doc-1",
              title: "Q4 Roadmap",
              url: "https://docs.google.com/document/d/drive-doc-1",
              mime_type: "application/vnd.google-apps.document",
              last_modified: "2026-11-01T10:00:00Z",
              author: "alice@example.com",
            },
            {
              id: "drive-doc-2",
              title: "Budget Sheet",
              url: "https://docs.google.com/spreadsheets/d/drive-doc-2",
              mime_type: "application/vnd.google-apps.spreadsheet",
              last_modified: "2026-11-05T14:30:00Z",
              author: "bob@example.com",
            },
          ],
        })
      })

      it("handles empty search results correctly", async () => {
        const tool = getTool()
        mockConnectorService.searchGoogleDrive.mockResolvedValueOnce([])

        const result = (await tool.execute({ query: "nonexistent" })) as any

        expect(result).toEqual({
          query: "nonexistent",
          count: 0,
          files: [],
        })
      })

      it("propagates errors thrown by service", async () => {
        const tool = getTool()
        mockConnectorService.searchGoogleDrive.mockRejectedValueOnce(
          new Error("Google Drive API rate limit reached"),
        )

        await expect(tool.execute({ query: "budget" })).rejects.toThrow(
          "Google Drive API rate limit reached",
        )
      })
    })
  })

  describe("gdrive_read_file tool", () => {
    const getTool = () => connectorTools(defaultOpts).find((t) => t.name === "gdrive_read_file")!

    describe("schema validation", () => {
      it("validates valid input", () => {
        const tool = getTool()
        const parsed = tool.schema.parse({ file_id: "file-xyz-987" })
        expect(parsed).toEqual({ file_id: "file-xyz-987" })
      })

      it("rejects invalid inputs", () => {
        const tool = getTool()
        expect(tool.schema.safeParse({}).success).toBe(false)
        expect(tool.schema.safeParse({ file_id: "" }).success).toBe(false)
        expect(tool.schema.safeParse({ file_id: 12345 }).success).toBe(false)
      })
    })

    describe("execute", () => {
      it("calls service.readGoogleDriveFile and returns document structure", async () => {
        const tool = getTool()
        const mockDoc: ConnectorDoc = {
          id: "file-xyz-987",
          source: "google_drive",
          title: "Architecture Specification",
          content: "# System Architecture\nDetailed overview...",
          url: "https://docs.google.com/document/d/file-xyz-987",
          metadata: {
            author: "carol@example.com",
            mimeType: "text/markdown",
            lastModified: "2026-11-10T12:00:00Z",
          },
        }
        mockConnectorService.readGoogleDriveFile.mockResolvedValueOnce(mockDoc)

        const result = (await tool.execute({ file_id: "file-xyz-987" })) as any

        expect(mockConnectorService.readGoogleDriveFile).toHaveBeenCalledTimes(1)
        expect(mockConnectorService.readGoogleDriveFile).toHaveBeenCalledWith({
          agentId: defaultOpts.agentId,
          orgId: defaultOpts.orgId,
          fileId: "file-xyz-987",
        })

        expect(result).toEqual({
          id: "file-xyz-987",
          title: "Architecture Specification",
          url: "https://docs.google.com/document/d/file-xyz-987",
          content: "# System Architecture\nDetailed overview...",
          metadata: {
            author: "carol@example.com",
            mimeType: "text/markdown",
            lastModified: "2026-11-10T12:00:00Z",
          },
        })
      })

      it("propagates errors when file is not found or access denied", async () => {
        const tool = getTool()
        mockConnectorService.readGoogleDriveFile.mockRejectedValueOnce(
          new Error("Access Denied: File not in allowed folders"),
        )

        await expect(tool.execute({ file_id: "forbidden-file" })).rejects.toThrow(
          "Access Denied: File not in allowed folders",
        )
      })
    })
  })

  describe("slack_search tool", () => {
    const getTool = () => connectorTools(defaultOpts).find((t) => t.name === "slack_search")!

    describe("schema validation", () => {
      it("validates valid input and applies default limit of 10", () => {
        const tool = getTool()
        const parsed = tool.schema.parse({ query: "incident-postmortem" })
        expect(parsed).toEqual({
          query: "incident-postmortem",
          limit: 10,
        })
      })

      it("accepts custom limit within range [1, 20]", () => {
        const tool = getTool()
        const parsed = tool.schema.parse({ query: "deployment", limit: 3 })
        expect(parsed).toEqual({
          query: "deployment",
          limit: 3,
        })
      })

      it("rejects invalid inputs", () => {
        const tool = getTool()
        expect(tool.schema.safeParse({}).success).toBe(false)
        expect(tool.schema.safeParse({ query: "" }).success).toBe(false)
        expect(tool.schema.safeParse({ query: "test", limit: 0 }).success).toBe(false)
        expect(tool.schema.safeParse({ query: "test", limit: 25 }).success).toBe(false)
        expect(tool.schema.safeParse({ query: "test", limit: 3.14 }).success).toBe(false)
      })
    })

    describe("execute", () => {
      it("calls service.searchSlack and maps message objects correctly", async () => {
        const tool = getTool()
        const mockMessages: ConnectorDoc[] = [
          {
            id: "slack-msg-1",
            source: "slack",
            title: "Message from dave",
            content: "Deployment succeeded to production cluster",
            url: "https://sayalabs.slack.com/archives/C123/p1700000001",
            metadata: {
              channelName: "engineering",
              author: "dave",
              threadTs: "1700000000.000100",
            },
          },
        ]
        mockConnectorService.searchSlack.mockResolvedValueOnce(mockMessages)

        const result = (await tool.execute({ query: "deployment", limit: 5 })) as any

        expect(mockConnectorService.searchSlack).toHaveBeenCalledTimes(1)
        expect(mockConnectorService.searchSlack).toHaveBeenCalledWith({
          agentId: defaultOpts.agentId,
          orgId: defaultOpts.orgId,
          query: "deployment",
          limit: 5,
        })

        expect(result).toEqual({
          query: "deployment",
          count: 1,
          messages: [
            {
              id: "slack-msg-1",
              title: "Message from dave",
              url: "https://sayalabs.slack.com/archives/C123/p1700000001",
              content: "Deployment succeeded to production cluster",
              channel: "engineering",
              author: "dave",
              thread_ts: "1700000000.000100",
            },
          ],
        })
      })

      it("handles empty search results correctly", async () => {
        const tool = getTool()
        mockConnectorService.searchSlack.mockResolvedValueOnce([])

        const result = (await tool.execute({ query: "unknown-keyword" })) as any

        expect(result).toEqual({
          query: "unknown-keyword",
          count: 0,
          messages: [],
        })
      })

      it("propagates errors thrown by service", async () => {
        const tool = getTool()
        mockConnectorService.searchSlack.mockRejectedValueOnce(
          new Error("Slack connector not found"),
        )

        await expect(tool.execute({ query: "test" })).rejects.toThrow("Slack connector not found")
      })
    })
  })

  describe("slack_read_thread tool", () => {
    const getTool = () => connectorTools(defaultOpts).find((t) => t.name === "slack_read_thread")!

    describe("schema validation", () => {
      it("validates valid channel_id and thread_ts", () => {
        const tool = getTool()
        const parsed = tool.schema.parse({
          channel_id: "C01234567",
          thread_ts: "1700000000.000100",
        })
        expect(parsed).toEqual({
          channel_id: "C01234567",
          thread_ts: "1700000000.000100",
        })
      })

      it("rejects invalid inputs", () => {
        const tool = getTool()
        expect(tool.schema.safeParse({}).success).toBe(false)
        expect(tool.schema.safeParse({ channel_id: "C123" }).success).toBe(false)
        expect(tool.schema.safeParse({ thread_ts: "1700000000.000100" }).success).toBe(false)
        expect(
          tool.schema.safeParse({ channel_id: "", thread_ts: "1700000000.000100" }).success,
        ).toBe(false)
        expect(tool.schema.safeParse({ channel_id: "C123", thread_ts: "" }).success).toBe(false)
      })
    })

    describe("execute", () => {
      it("calls service.readSlackThread and returns discussion structure", async () => {
        const tool = getTool()
        const mockThread: ConnectorDoc = {
          id: "slack-thread-1",
          source: "slack",
          title: "Thread in #engineering",
          content: "Parent message\n- Reply 1 by dave\n- Reply 2 by eve",
          url: "https://sayalabs.slack.com/archives/C01234567/p1700000000000100",
          metadata: {
            replyCount: 2,
            channelName: "engineering",
          },
        }
        mockConnectorService.readSlackThread.mockResolvedValueOnce(mockThread)

        const result = (await tool.execute({
          channel_id: "C01234567",
          thread_ts: "1700000000.000100",
        })) as any

        expect(mockConnectorService.readSlackThread).toHaveBeenCalledTimes(1)
        expect(mockConnectorService.readSlackThread).toHaveBeenCalledWith({
          agentId: defaultOpts.agentId,
          orgId: defaultOpts.orgId,
          channelId: "C01234567",
          threadTs: "1700000000.000100",
        })

        expect(result).toEqual({
          id: "slack-thread-1",
          title: "Thread in #engineering",
          url: "https://sayalabs.slack.com/archives/C01234567/p1700000000000100",
          discussion: "Parent message\n- Reply 1 by dave\n- Reply 2 by eve",
          reply_count: 2,
        })
      })

      it("propagates errors when thread cannot be read", async () => {
        const tool = getTool()
        mockConnectorService.readSlackThread.mockRejectedValueOnce(
          new Error("Access Denied: Agent is not granted access to channel C01234567"),
        )

        await expect(
          tool.execute({ channel_id: "C01234567", thread_ts: "1700000000.000100" }),
        ).rejects.toThrow("Access Denied: Agent is not granted access to channel C01234567")
      })
    })
  })

  describe("github_search_code tool", () => {
    const getTool = () => connectorTools(defaultOpts).find((t) => t.name === "github_search_code")!

    describe("schema validation", () => {
      it("validates valid input and applies default limit of 10", () => {
        const tool = getTool()
        const parsed = tool.schema.parse({ query: "function authenticate" })
        expect(parsed).toEqual({
          query: "function authenticate",
          limit: 10,
        })
      })

      it("accepts custom limit within range [1, 20]", () => {
        const tool = getTool()
        const parsed = tool.schema.parse({ query: "import drizzle", limit: 4 })
        expect(parsed).toEqual({
          query: "import drizzle",
          limit: 4,
        })
      })

      it("rejects invalid inputs", () => {
        const tool = getTool()
        expect(tool.schema.safeParse({}).success).toBe(false)
        expect(tool.schema.safeParse({ query: "" }).success).toBe(false)
        expect(tool.schema.safeParse({ query: "test", limit: 0 }).success).toBe(false)
        expect(tool.schema.safeParse({ query: "test", limit: 25 }).success).toBe(false)
        expect(tool.schema.safeParse({ query: "test", limit: 4.2 }).success).toBe(false)
      })
    })

    describe("execute", () => {
      it("calls service.searchGitHubCode and maps items correctly", async () => {
        const tool = getTool()
        const mockCodeFiles: ConnectorDoc[] = [
          {
            id: "gh-file-1",
            source: "github",
            title: "auth.ts",
            content: "export function authenticate() {}",
            url: "https://github.com/sayalabs/core/blob/main/src/auth.ts",
            metadata: {
              repo: "sayalabs/core",
              path: "src/auth.ts",
            },
          },
        ]
        mockConnectorService.searchGitHubCode.mockResolvedValueOnce(mockCodeFiles)

        const result = (await tool.execute({ query: "authenticate", limit: 10 })) as any

        expect(mockConnectorService.searchGitHubCode).toHaveBeenCalledTimes(1)
        expect(mockConnectorService.searchGitHubCode).toHaveBeenCalledWith({
          agentId: defaultOpts.agentId,
          orgId: defaultOpts.orgId,
          query: "authenticate",
          limit: 10,
        })

        expect(result).toEqual({
          query: "authenticate",
          count: 1,
          items: [
            {
              id: "gh-file-1",
              title: "auth.ts",
              url: "https://github.com/sayalabs/core/blob/main/src/auth.ts",
              repo: "sayalabs/core",
              path: "src/auth.ts",
            },
          ],
        })
      })

      it("handles empty search results correctly", async () => {
        const tool = getTool()
        mockConnectorService.searchGitHubCode.mockResolvedValueOnce([])

        const result = (await tool.execute({ query: "nonexistentSymbol" })) as any

        expect(result).toEqual({
          query: "nonexistentSymbol",
          count: 0,
          items: [],
        })
      })

      it("propagates errors thrown by service", async () => {
        const tool = getTool()
        mockConnectorService.searchGitHubCode.mockRejectedValueOnce(
          new Error("GitHub API secondary rate limit"),
        )

        await expect(tool.execute({ query: "foo" })).rejects.toThrow(
          "GitHub API secondary rate limit",
        )
      })
    })
  })

  describe("github_get_file tool", () => {
    const getTool = () => connectorTools(defaultOpts).find((t) => t.name === "github_get_file")!

    describe("schema validation", () => {
      it("validates valid input and sets default ref to 'main'", () => {
        const tool = getTool()
        const parsed = tool.schema.parse({
          repo: "sayalabs/orchestrator",
          path: "src/index.ts",
        })
        expect(parsed).toEqual({
          repo: "sayalabs/orchestrator",
          path: "src/index.ts",
          ref: "main",
        })
      })

      it("accepts custom ref", () => {
        const tool = getTool()
        const parsed = tool.schema.parse({
          repo: "sayalabs/orchestrator",
          path: "src/index.ts",
          ref: "feat/connectors",
        })
        expect(parsed).toEqual({
          repo: "sayalabs/orchestrator",
          path: "src/index.ts",
          ref: "feat/connectors",
        })
      })

      it("rejects invalid inputs", () => {
        const tool = getTool()
        expect(tool.schema.safeParse({}).success).toBe(false)
        expect(tool.schema.safeParse({ repo: "" }).success).toBe(false)
        expect(tool.schema.safeParse({ repo: "sayalabs/core" }).success).toBe(false)
        expect(tool.schema.safeParse({ repo: "sayalabs/core", path: "" }).success).toBe(false)
        expect(tool.schema.safeParse({ path: "src/index.ts" }).success).toBe(false)
      })
    })

    describe("execute", () => {
      it("calls service.getGitHubFile and returns file structure", async () => {
        const tool = getTool()
        const mockFile: ConnectorDoc = {
          id: "sayalabs/orchestrator:package.json",
          source: "github",
          title: "package.json",
          content: '{\n  "name": "@sayabot/orchestrator"\n}',
          url: "https://github.com/sayalabs/orchestrator/blob/main/package.json",
          metadata: {
            path: "package.json",
            repo: "sayalabs/orchestrator",
            sha: "abc12345",
          },
        }
        mockConnectorService.getGitHubFile.mockResolvedValueOnce(mockFile)

        const result = (await tool.execute({
          repo: "sayalabs/orchestrator",
          path: "package.json",
          ref: "main",
        })) as any

        expect(mockConnectorService.getGitHubFile).toHaveBeenCalledTimes(1)
        expect(mockConnectorService.getGitHubFile).toHaveBeenCalledWith({
          agentId: defaultOpts.agentId,
          orgId: defaultOpts.orgId,
          repo: "sayalabs/orchestrator",
          path: "package.json",
          ref: "main",
        })

        expect(result).toEqual({
          title: "package.json",
          url: "https://github.com/sayalabs/orchestrator/blob/main/package.json",
          content: '{\n  "name": "@sayabot/orchestrator"\n}',
          metadata: {
            path: "package.json",
            repo: "sayalabs/orchestrator",
            sha: "abc12345",
          },
        })
      })

      it("propagates errors when repository access is unauthorized", async () => {
        const tool = getTool()
        mockConnectorService.getGitHubFile.mockRejectedValueOnce(
          new Error("Access Denied: Agent is not granted access to repository secret/repo"),
        )

        await expect(
          tool.execute({ repo: "secret/repo", path: "config.json", ref: "main" }),
        ).rejects.toThrow(
          "Access Denied: Agent is not granted access to repository secret/repo",
        )
      })
    })
  })

  describe("github_get_issue_or_pr tool", () => {
    const getTool = () =>
      connectorTools(defaultOpts).find((t) => t.name === "github_get_issue_or_pr")!

    describe("schema validation", () => {
      it("validates valid repo and positive integer issue_number", () => {
        const tool = getTool()
        const parsed = tool.schema.parse({
          repo: "sayalabs/core",
          issue_number: 142,
        })
        expect(parsed).toEqual({
          repo: "sayalabs/core",
          issue_number: 142,
        })
      })

      it("rejects invalid inputs", () => {
        const tool = getTool()
        expect(tool.schema.safeParse({}).success).toBe(false)
        expect(tool.schema.safeParse({ repo: "sayalabs/core" }).success).toBe(false)
        expect(tool.schema.safeParse({ issue_number: 10 }).success).toBe(false)
        expect(tool.schema.safeParse({ repo: "", issue_number: 10 }).success).toBe(false)
        // Non-positive or non-integer issue numbers
        expect(tool.schema.safeParse({ repo: "sayalabs/core", issue_number: 0 }).success).toBe(
          false,
        )
        expect(tool.schema.safeParse({ repo: "sayalabs/core", issue_number: -1 }).success).toBe(
          false,
        )
        expect(tool.schema.safeParse({ repo: "sayalabs/core", issue_number: 12.34 }).success).toBe(
          false,
        )
        expect(
          tool.schema.safeParse({ repo: "sayalabs/core", issue_number: "142" }).success,
        ).toBe(false)
      })
    })

    describe("execute", () => {
      it("calls service.getGitHubIssueOrPr and returns issue structure", async () => {
        const tool = getTool()
        const mockIssue: ConnectorDoc = {
          id: "sayalabs/core#142",
          source: "github",
          title: "Fix database pool exhaustion",
          content: "Body of the issue describing reconnection logic...",
          url: "https://github.com/sayalabs/core/issues/142",
          metadata: {
            repo: "sayalabs/core",
            issueNumber: 142,
            type: "issue",
            state: "open",
            author: "octocat",
            labels: ["bug", "database"],
          },
        }
        mockConnectorService.getGitHubIssueOrPr.mockResolvedValueOnce(mockIssue)

        const result = (await tool.execute({
          repo: "sayalabs/core",
          issue_number: 142,
        })) as any

        expect(mockConnectorService.getGitHubIssueOrPr).toHaveBeenCalledTimes(1)
        expect(mockConnectorService.getGitHubIssueOrPr).toHaveBeenCalledWith({
          agentId: defaultOpts.agentId,
          orgId: defaultOpts.orgId,
          repo: "sayalabs/core",
          issueNumber: 142,
        })

        expect(result).toEqual({
          id: "sayalabs/core#142",
          title: "Fix database pool exhaustion",
          url: "https://github.com/sayalabs/core/issues/142",
          content: "Body of the issue describing reconnection logic...",
          metadata: {
            repo: "sayalabs/core",
            issueNumber: 142,
            type: "issue",
            state: "open",
            author: "octocat",
            labels: ["bug", "database"],
          },
        })
      })

      it("propagates errors when issue or PR is not found", async () => {
        const tool = getTool()
        mockConnectorService.getGitHubIssueOrPr.mockRejectedValueOnce(
          new Error("Not Found: GitHub issue #9999 does not exist"),
        )

        await expect(
          tool.execute({ repo: "sayalabs/core", issue_number: 9999 }),
        ).rejects.toThrow("Not Found: GitHub issue #9999 does not exist")
      })
    })
  })

  describe("messaging connectors", () => {
    it("registers Discord, Telegram and WhatsApp tools and gates every send", () => {
      const tools = connectorTools({ ...defaultOpts, sources: ["discord", "telegram", "whatsapp"] })
      const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
      expect(Object.keys(byName)).toEqual([
        "discord_list_channels",
        "discord_read_messages",
        "discord_send_message",
        "telegram_read_messages",
        "telegram_send_message",
        "whatsapp_send_message",
        "whatsapp_send_template",
      ])
      for (const tool of tools) {
        expect(tool.dangerous).toBe(/_send_/.test(tool.name))
      }
    })

    it("passes the agent and org through to the service on send", async () => {
      mockConnectorService.sendDiscordMessage.mockResolvedValue({ id: "m1", url: "https://discord.com/channels/1/2/m1" })
      const tool = connectorTools({ ...defaultOpts, sources: ["discord"] }).find((t) => t.name === "discord_send_message")!
      const result = (await tool.execute({ channel_id: "123456", content: "hi" })) as { ok: boolean; id: string }
      expect(result).toMatchObject({ ok: true, id: "m1" })
      expect(mockConnectorService.sendDiscordMessage).toHaveBeenCalledWith({
        agentId: "agent-test-456",
        orgId: "org-test-123",
        channelId: "123456",
        content: "hi",
      })
    })

    it("defaults the WhatsApp template language", async () => {
      mockConnectorService.sendWhatsAppTemplate.mockResolvedValue({ id: "wamid.1" })
      const tool = connectorTools({ ...defaultOpts, sources: ["whatsapp"] }).find((t) => t.name === "whatsapp_send_template")!
      await tool.execute({ to: "+14155550123", template: "hello_world" })
      expect(mockConnectorService.sendWhatsAppTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ template: "hello_world", language: "en_US" }),
      )
    })
  })
})
