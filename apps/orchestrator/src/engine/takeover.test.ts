import { beforeEach, describe, expect, it, vi } from "vitest"
import type { RunLlmTurnArgs, TurnResult } from "../runner/llm"

const updates: Record<string, unknown>[] = []
const deletes: string[] = []

vi.mock("../db", () => ({
  getDb: () => ({
    update: () => ({
      set: (value: Record<string, unknown>) => ({
        where: async () => {
          updates.push(value)
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        deletes.push("message")
      },
    }),
  }),
}))

vi.mock("../realtime", () => ({ broadcast: vi.fn(async () => undefined) }))

const { runWithQuotaTakeover, activeHoldUntil, modelKeyOf, QUOTA_HOLD_MS } =
  await import("./takeover")

const FALLBACK = { providerKeyId: "key-backup", model: "backup-model" }

function turnArgs(params: Record<string, unknown> = {}): RunLlmTurnArgs {
  return {
    room: { id: "room-1", orgId: "org-1" },
    agent: {
      id: "agent-1",
      providerKeyId: "key-primary",
      model: "big-model",
      params,
    },
    sessionId: "session-1",
    threadRootId: null,
    trigger: { metadata: null },
    role: "responder",
    step: 1,
  } as unknown as RunLlmTurnArgs
}

function result(overrides: Partial<TurnResult> = {}): TurnResult {
  return {
    messageId: "message-1",
    runId: "run-1",
    content: "",
    error: null,
    aborted: false,
    ...overrides,
  }
}

beforeEach(() => {
  updates.length = 0
  deletes.length = 0
})

describe("runWithQuotaTakeover", () => {
  it("runs once and leaves everything alone without a fallback", async () => {
    const run = vi.fn(async () => result({ errorKind: "quota_exhausted" }))
    const out = await runWithQuotaTakeover(turnArgs(), run)
    expect(run).toHaveBeenCalledTimes(1)
    expect(out.errorKind).toBe("quota_exhausted")
    expect(updates).toHaveLength(0)
  })

  it("answers on the fallback when the first model is out of balance", async () => {
    const run = vi
      .fn<(args: RunLlmTurnArgs) => Promise<TurnResult>>()
      .mockResolvedValueOnce(result({ errorKind: "quota_exhausted" }))
      .mockResolvedValueOnce(result({ messageId: "message-2" }))

    const out = await runWithQuotaTakeover(turnArgs({ fallback: FALLBACK }), run)

    expect(run).toHaveBeenCalledTimes(2)
    const second = run.mock.calls[1]?.[0]
    expect(second?.agent.model).toBe("backup-model")
    expect(second?.agent.providerKeyId).toBe("key-backup")
    expect(out.messageId).toBe("message-2")
    expect(updates).toHaveLength(1)
    expect(deletes).toHaveLength(1)
  })

  it("remembers the hold and skips the dry model on the next turn", async () => {
    const params = {
      fallback: FALLBACK,
      quotaHolds: {
        [modelKeyOf({ providerKeyId: "key-primary", model: "big-model" })]: {
          until: Date.now() + QUOTA_HOLD_MS,
        },
      },
    }
    const run = vi.fn<(args: RunLlmTurnArgs) => Promise<TurnResult>>(async () => result())
    await runWithQuotaTakeover(turnArgs(params), run)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[0]?.agent.model).toBe("backup-model")
  })

  it("does not switch to a fallback on the same account", async () => {
    const run = vi.fn(async () => result({ errorKind: "quota_exhausted" }))
    const out = await runWithQuotaTakeover(
      turnArgs({ fallback: { providerKeyId: "key-primary", model: "small-model" } }),
      run,
    )
    expect(run).toHaveBeenCalledTimes(1)
    expect(out.errorKind).toBe("quota_exhausted")
  })

  it("leaves other failures to their own handling", async () => {
    const run = vi.fn(async () => result({ errorKind: "rate_limit" }))
    const out = await runWithQuotaTakeover(turnArgs({ fallback: FALLBACK }), run)
    expect(run).toHaveBeenCalledTimes(1)
    expect(out.errorKind).toBe("rate_limit")
  })
})

describe("activeHoldUntil", () => {
  it("ignores an expired hold and keeps a live one", () => {
    const key = "key/one"
    expect(activeHoldUntil({ quotaHolds: { [key]: { until: 1_000 } } }, key, 2_000)).toBeNull()
    expect(activeHoldUntil({ quotaHolds: { [key]: { until: 9_000 } } }, key, 2_000)).toBe(9_000)
  })
})
