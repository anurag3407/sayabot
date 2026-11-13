import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentRow, RoomRow } from "../runner/context"
import type { RunLlmTurnArgs, TurnResult } from "../runner/llm"
import * as cliRunner from "../runner/cli"
import * as cliAgent from "../runner/cli-agent"
import * as llmRunner from "../runner/llm"
import { startAgentTurn } from "./index"
import * as engineRun from "./run"

describe("Engine Dispatcher (E4)", () => {
  // Keep dispatch independent of whether Claude Code / Codex is signed in on this machine.
  beforeEach(() => {
    vi.stubEnv("SAYABOT_LOCAL_CLI", "0")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

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
      document: true,
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

  it("runs on this computer's Claude Code when the agent picked it", async () => {
    const result: TurnResult = { messageId: "m-cli", runId: "r-cli", content: "hi", error: null, aborted: false }
    const spy = vi.spyOn(cliRunner, "runCliTurn").mockResolvedValueOnce(result)
    const args = {
      ...dummyArgs,
      agent: { ...dummyAgent, params: { runner: { where: "server", app: "claude-code", model: "claude-opus-5-5" } } },
    }
    expect(await startAgentTurn(args)).toEqual(result)
    expect(spy).toHaveBeenCalledWith(args, { app: "claude-code", model: "claude-opus-5-5" })
    spy.mockRestore()
  })

  it("falls back to a signed-in app when the agent has no key", async () => {
    const result: TurnResult = { messageId: "m-fb", runId: "r-fb", content: "hi", error: null, aborted: false }
    vi.stubEnv("SAYABOT_LOCAL_CLI", "1")
    const binary = vi.spyOn(cliAgent, "findCliBinary").mockResolvedValue("/usr/local/bin/claude")
    const signedIn = vi.spyOn(cliAgent, "cliSignedIn").mockResolvedValue(true)
    const spy = vi.spyOn(cliRunner, "runCliTurn").mockResolvedValueOnce(result)
    expect(await startAgentTurn(dummyArgs)).toEqual(result)
    expect(spy).toHaveBeenCalledWith(dummyArgs, { app: "claude-code", model: null })
    binary.mockRestore()
    signedIn.mockRestore()
    spy.mockRestore()
  })

  it("keeps using the API key when the agent has one", async () => {
    vi.stubEnv("SAYABOT_LOCAL_CLI", "1")
    const fallback = vi.spyOn(cliAgent, "findCliBinary")
    const spy = vi.spyOn(llmRunner, "runLlmTurn").mockResolvedValueOnce({ messageId: "m", runId: "r", content: "", error: null, aborted: false })
    await startAgentTurn({ ...dummyArgs, agent: { ...dummyAgent, providerKeyId: "key-1" } })
    expect(fallback).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalledTimes(1)
    fallback.mockRestore()
    spy.mockRestore()
  })
})
