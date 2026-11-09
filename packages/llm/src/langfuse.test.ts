import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  getLangfuseClient,
  isLangfuseConfigured,
  recordScoreToLangfuse,
  recordStepToLangfuse,
} from "./langfuse"

describe("langfuse telemetry integration", () => {
  const origEnv = process.env

  beforeEach(() => {
    process.env = { ...origEnv }
    delete process.env.LANGFUSE_PUBLIC_KEY
    delete process.env.LANGFUSE_SECRET_KEY
  })

  afterEach(() => {
    process.env = origEnv
  })

  it("reports unconfigured when environment keys are missing", () => {
    expect(isLangfuseConfigured()).toBe(false)
    expect(getLangfuseClient()).toBeNull()
  })

  it("reports configured when keys are present", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test"
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test"
    expect(isLangfuseConfigured()).toBe(true)
    const client = getLangfuseClient()
    expect(client).not.toBeNull()
  })

  it("handles step records safely when unconfigured", async () => {
    await expect(
      recordStepToLangfuse({
        traceId: "test-trace",
        stepIdx: 1,
        kind: "tool",
        input: { cmd: "ls" },
        output: { stdout: "files" },
      }),
    ).resolves.toBeUndefined()
  })

  it("handles score records safely when unconfigured", async () => {
    await expect(
      recordScoreToLangfuse({
        traceId: "test-trace",
        name: "human_approval",
        value: 1,
      }),
    ).resolves.toBeUndefined()
  })
})
