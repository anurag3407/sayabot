import { describe, expect, it, vi } from "vitest"
import { BeliefEngine } from "./modules/beliefs"
import { extractWikilinks, MemoryGraphEngine } from "./modules/graph"
import { OpenLoopsManager } from "./modules/open-loops"
import { calculateRetention, compositeMemoryScore } from "./modules/salience"
import { canReadMemory, formatSourceId, parseSourceId } from "./modules/sources"
import { MemoryService } from "./service"
import { memoryTools } from "./tools"

describe("Cognitive Memory Layer (gbrain-grade superpowers)", () => {
  describe("Ebbinghaus Retention & Salience", () => {
    it("calculates retention decay over time", () => {
      const now = new Date("2026-05-01T00:00:00Z")
      const freshDate = new Date("2026-05-01T00:00:00Z")
      const oldDate = new Date("2026-04-01T00:00:00Z") // 30 days ago (1 half-life)

      const freshRetention = calculateRetention({
        createdAt: freshDate,
        decayHalfLifeDays: 30,
        now,
      })
      expect(freshRetention).toBe(1.0)

      const oldRetention = calculateRetention({
        createdAt: oldDate,
        decayHalfLifeDays: 30,
        now,
      })
      // At 1 half-life (30 days), decay is ~0.50
      expect(oldRetention).toBeCloseTo(0.5, 1)
    })

    it("reinforces retention with repeated usage", () => {
      const now = new Date("2026-05-01T00:00:00Z")
      const oldDate = new Date("2026-04-01T00:00:00Z") // 30 days ago

      const unused = calculateRetention({
        createdAt: oldDate,
        useCount: 0,
        decayHalfLifeDays: 30,
        now,
      })

      const frequentlyUsed = calculateRetention({
        createdAt: oldDate,
        useCount: 15,
        decayHalfLifeDays: 30,
        now,
      })

      expect(frequentlyUsed).toBeGreaterThan(unused)
    })

    it("applies epistemic weights to composite score", () => {
      const verifiedScore = compositeMemoryScore({
        keywordMatchRatio: 1.0,
        pinned: false,
        confidence: 1.0,
        emotionalSalience: 0.8,
        retention: 1.0,
        epistemicStatus: "verified",
      })

      const hypothesisScore = compositeMemoryScore({
        keywordMatchRatio: 1.0,
        pinned: false,
        confidence: 1.0,
        emotionalSalience: 0.8,
        retention: 1.0,
        epistemicStatus: "hypothesis",
      })

      const withdrawnScore = compositeMemoryScore({
        keywordMatchRatio: 1.0,
        pinned: true,
        confidence: 1.0,
        emotionalSalience: 1.0,
        retention: 1.0,
        epistemicStatus: "withdrawn",
      })

      expect(verifiedScore).toBeGreaterThan(hypothesisScore)
      expect(withdrawnScore).toBe(0) // Withdrawn beliefs never surface
    })
  })

  describe("Sources & Scoping", () => {
    it("formats and parses source IDs correctly", () => {
      const id = formatSourceId("agent", "agent-123")
      expect(id).toBe("agent:agent-123")

      const parsed = parseSourceId("agent:agent-123")
      expect(parsed).toEqual({ scope: "agent", id: "agent-123" })

      const invalid = parseSourceId("invalid")
      expect(invalid).toBeNull()
    })

    it("enforces private agent memory visibility", () => {
      // Agent private memory is only accessible by that agent
      expect(
        canReadMemory({
          memoryScope: "agent",
          memoryAgentId: "agent-1",
          requestingAgentId: "agent-1",
        }),
      ).toBe(true)

      expect(
        canReadMemory({
          memoryScope: "agent",
          memoryAgentId: "agent-1",
          requestingAgentId: "agent-2",
        }),
      ).toBe(false)

      // Room memory accessible in room
      expect(
        canReadMemory({
          memoryScope: "room",
          memoryRoomId: "room-1",
          requestingRoomId: "room-1",
        }),
      ).toBe(true)

      expect(
        canReadMemory({
          memoryScope: "room",
          memoryRoomId: "room-1",
          requestingRoomId: "room-2",
        }),
      ).toBe(false)

      // Org memory globally visible
      expect(
        canReadMemory({
          memoryScope: "org",
          requestingAgentId: "agent-99",
        }),
      ).toBe(true)
    })
  })

  describe("Epistemic Belief Engine", () => {
    it("manages belief lifecycle and supersedes prior beliefs", async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                id: "mem-new",
                title: "Production DB is Aurora v2",
                epistemicStatus: "verified",
              },
            ]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                {
                  id: "mem-old",
                  epistemicStatus: "superseded",
                  supersededBy: "mem-new",
                },
              ]),
            }),
          }),
        }),
      }

      const engine = new BeliefEngine(mockDb)

      const inserted = await engine.assertBelief({
        orgId: "org-1",
        scope: "org",
        title: "Production DB is Aurora v2",
        body: "Migrated from standard Postgres to Aurora Serverless v2.",
        epistemicStatus: "verified",
        supersedesMemoryId: "mem-old",
      })

      expect(inserted.id).toBe("mem-new")
      expect(mockDb.update).toHaveBeenCalled()
    })

    it("detects topic contradictions with active beliefs", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  {
                    id: "mem-existing",
                    title: "Deploy Target Kubernetes Cluster",
                    body: "All backend services must be deployed to Kubernetes EKS.",
                    epistemicStatus: "verified",
                  },
                ]),
              }),
            }),
          }),
        }),
      }

      const engine = new BeliefEngine(mockDb)
      const contradictions = await engine.detectContradictions({
        orgId: "org-1",
        title: "Deploy Target Cloudflare Workers",
      })

      expect(contradictions.length).toBeGreaterThan(0)
      expect(contradictions[0]?.existingMemoryId).toBe("mem-existing")
    })
  })

  describe("Open Loops Tracking", () => {
    it("creates, updates, and formats open loops", async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                id: "loop-1",
                description: "Verify Stripe webhook secret on staging",
                status: "open",
                dueAt: new Date("2026-05-02T12:00:00Z"),
              },
            ]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                {
                  id: "loop-1",
                  status: "resolved",
                  resolution: "Secret configured in Vault",
                },
              ]),
            }),
          }),
        }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  {
                    id: "loop-1",
                    description: "Verify Stripe webhook secret on staging",
                    status: "open",
                    dueAt: new Date("2026-05-02T12:00:00Z"),
                    blockerReason: null,
                  },
                ]),
              }),
            }),
          }),
        }),
      }

      const manager = new OpenLoopsManager(mockDb)

      const loop = await manager.createOpenLoop({
        orgId: "org-1",
        agentId: "agent-1",
        description: "Verify Stripe webhook secret on staging",
      })
      expect(loop.id).toBe("loop-1")

      const resolved = await manager.resolveOpenLoop("loop-1", "org-1", "Secret configured in Vault")
      expect(resolved?.status).toBe("resolved")

      const activeLoops = await manager.getActiveLoops({
        orgId: "org-1",
        agentId: "agent-1",
      })
      const md = manager.formatOpenLoopsMarkdown(activeLoops)
      expect(md).toContain("# Active Open Loops")
      expect(md).toContain("Verify Stripe webhook secret")
    })
  })

  describe("Knowledge Graph & Concept Wikilinks", () => {
    it("extracts [[concept]] wikilinks from text", () => {
      const text =
        "We are integrating [[Auth0-SSO]] with our [[Session Management]] layer. See [[Auth0-SSO]]."
      const links = extractWikilinks(text)

      expect(links).toContain("auth0-sso")
      expect(links).toContain("session-management")
      expect(links.length).toBe(2) // deduplicated
    })

    it("performs graph walk across connected nodes", async () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table: any) => ({
            where: vi.fn().mockResolvedValue(
              table === undefined || table?.targetMemoryId !== undefined
                ? [
                    {
                      id: "link-1",
                      orgId: "org-1",
                      sourceMemoryId: "root-mem",
                      targetMemoryId: "neighbor-mem",
                      targetSlug: null,
                      relationship: "depends_on",
                      weight: 1.0,
                    },
                  ]
                : [
                    {
                      id: "neighbor-mem",
                      orgId: "org-1",
                      title: "Database Cluster",
                      body: "Postgres 16 cluster",
                      epistemicStatus: "verified",
                    },
                  ],
            ),
          })),
        })),
      }

      const graphEngine = new MemoryGraphEngine(mockDb)
      const walk = await graphEngine.graphWalk({
        orgId: "org-1",
        startMemoryId: "root-mem",
        maxDepth: 1,
      })

      expect(walk.rootMemoryId).toBe("root-mem")
      expect(walk.edges.length).toBe(1)
    })
  })

  describe("Agent Memory Tools Suite", () => {
    it("exports all 6 cognitive tools (remember, recall, open_loop, reflect, graph_walk, forget)", () => {
      const tools = memoryTools({
        orgId: "org-1",
        agentId: "agent-1",
        roomId: "room-1",
      })

      const toolNames = tools.map((t) => t.name)
      expect(toolNames).toContain("remember")
      expect(toolNames).toContain("recall")
      expect(toolNames).toContain("open_loop")
      expect(toolNames).toContain("reflect")
      expect(toolNames).toContain("graph_walk")
      expect(toolNames).toContain("forget")
    })
  })

  describe("Memory Service Integration", () => {
    it("scores and ranks memories with pinned and epistemic boost", async () => {
      const service = new MemoryService()

      const mockMemories = [
        {
          id: "mem-1",
          scope: "org" as const,
          kind: "decision" as const,
          title: "Frontend Framework",
          body: "We decided to use Next.js 16 with React 19.",
          pinned: false,
          confidence: 1.0,
          emotionalSalience: 0.8,
          epistemicStatus: "verified",
          perspective: "first_person",
          decayHalfLifeDays: 30,
          lastUsedAt: new Date(),
          createdAt: new Date(),
          useCount: 5,
        },
        {
          id: "mem-2",
          scope: "room" as const,
          kind: "fact" as const,
          title: "Staging Environment Policy",
          body: "Staging database is strictly read-only for bots.",
          pinned: true,
          confidence: 1.0,
          emotionalSalience: 0.9,
          epistemicStatus: "verified",
          perspective: "first_person",
          decayHalfLifeDays: 30,
          lastUsedAt: new Date(),
          createdAt: new Date(),
          useCount: 10,
        },
      ]

      vi.spyOn(service as any, "getDb").mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(mockMemories),
              }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      })

      const results = await service.recall({
        orgId: "org-1",
        query: "staging database read-only",
        limit: 5,
      })

      expect(results.length).toBe(2)
      expect(results[0]?.id).toBe("mem-2")
      expect(results[0]?.pinned).toBe(true)
    })
  })
})
