import { describe, expect, it, vi } from "vitest"
import type { AgentRow, RoomRow } from "../runner/context"
import type { RunLlmTurnArgs, TurnResult } from "../runner/llm"
import * as llmRunner from "../runner/llm"
import { startAgentTurn } from "./index"
import * as engineRun from "./run"

describe("Engine Dispatcher (E4)", () => {
  const dummyAgent: AgentRow = {
    id: "agent-1",
    orgId: "org-1",
    handle: "assistant",
    displayName: "Assistant",
    kind: "llm",
    providerKeyId: null,
    model: "claude-3-5-sonnet",
    systemPrompt: "helpful",
    params: { engine: "v1" },
    toolIds: [],
    webhookUrl: null,
    webhookSecretEnc: null,
    templateId: null,
    ownerUserId: null,
    visibility: "org",
    avatar: null,
    bio: null,
    capabilities: {
      canvas: true,
      tasks: true,
      sandbox: false,
      webSearch: false,
      github: false,
      postgres: false,
      mcp: true,
      computer: false,
      secrets: false,
      memory: true,
      subagents: true,
      cron: true,
      connectors: true,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const dummyRoom: RoomRow = {
    id: "room-1",
    orgId: "org-1",
    name: "main",
    kind: "public",
    turnMode: "mentions",
    systemDirective: null,
    turnCap: 3,
    rpmLimit: null,
    dailyBudgetUsd: 10,
    moderatorAgentId: null,
    debateOrder: [],
    timezone: "UTC",
    agentDmUserId: null,
    agentDmAgentId: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const dummyArgs: RunLlmTurnArgs = {
    room: dummyRoom,
    agent: dummyAgent,
    sessionId: "sess-1",
    threadRootId: null,
    trigger: { id: "msg-1" } as any,
    role: "responder",
    step: 1,
  }

  it("dispatches to runLlmTurn only when engine is explicitly v1", async () => {
    const mockLlmResult: TurnResult = {
      messageId: "m-v1",
      runId: "r-v1",
      content: "v1 output",
      error: null,
      aborted: false,
    }
    const runLlmSpy = vi.spyOn(llmRunner, "runLlmTurn").mockResolvedValueOnce(mockLlmResult)

    const res = await startAgentTurn(dummyArgs)
    expect(res).toEqual(mockLlmResult)
    expect(runLlmSpy).toHaveBeenCalledWith(dummyArgs)
    runLlmSpy.mockRestore()
  })

  it("uses v2 for existing bots without an explicit engine and rejects unsupported drivers", async () => {
    const spy = vi.spyOn(engineRun, "runEngineTurn").mockResolvedValue({ messageId: "m", runId: "r", content: "", error: null, aborted: false })
    await startAgentTurn({ ...dummyArgs, agent: { ...dummyAgent, params: {} } })
    expect(spy).toHaveBeenCalledTimes(1)
    await expect(startAgentTurn({ ...dummyArgs, agent: { ...dummyAgent, params: { engine: "cli" } } })).rejects.toThrow("Unsupported agent engine")
    spy.mockRestore()
  })

  it("dispatches to runEngineTurn when engine is v2", async () => {
    const mockV2Result: TurnResult = {
      messageId: "m-v2",
      runId: "r-v2",
      content: "v2 durable output",
      error: null,
      aborted: false,
    }
    const runEngineSpy = vi.spyOn(engineRun, "runEngineTurn").mockResolvedValueOnce(mockV2Result)

    const v2Args: RunLlmTurnArgs = {
      ...dummyArgs,
      agent: {
        ...dummyAgent,
        params: { engine: "v2" },
      },
    }

    const res = await startAgentTurn(v2Args)
    expect(res).toEqual(mockV2Result)
    expect(runEngineSpy).toHaveBeenCalledWith(v2Args)
    runEngineSpy.mockRestore()
  })
})
