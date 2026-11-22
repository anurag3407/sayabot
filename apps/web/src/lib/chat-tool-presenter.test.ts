import { describe, expect, it } from "vitest"
import {
  buildActionSummarySentence,
  classifyToolKind,
  extractChangedFiles,
  extractSearchQuery,
  extractToolCommand,
  extractToolPath,
  formatActionDuration,
  formatDiffNumber,
} from "./chat-tool-presenter"
import type { ToolCallView } from "./types"

function makeCall(toolName: string, args: Record<string, unknown> = {}, status: ToolCallView["status"] = "done"): ToolCallView {
  return {
    id: `call-${Math.random().toString(36).slice(2)}`,
    roomId: "room-1",
    messageId: "msg-1",
    runId: "run-1",
    toolName,
    args,
    status,
    approvedBy: null,
    result: { ok: true },
    error: null,
    liveOutput: undefined,
    createdAt: new Date().toISOString(),
    resolvedAt: new Date().toISOString(),
  }
}

describe("chat-tool-presenter", () => {
  it("classifies tool kinds accurately", () => {
    expect(classifyToolKind("bash")).toBe("command")
    expect(classifyToolKind("run_command")).toBe("command")
    expect(classifyToolKind("search_code")).toBe("code-search")
    expect(classifyToolKind("web_search")).toBe("search")
    expect(classifyToolKind("read_file")).toBe("read")
    expect(classifyToolKind("write_file")).toBe("edit")
    expect(classifyToolKind("aside_browse")).toBe("browser")
    expect(classifyToolKind("custom_tool")).toBe("other")
  })

  it("extracts command lines and search queries", () => {
    expect(extractToolCommand({ CommandLine: "ls -la" })).toBe("ls -la")
    expect(extractToolCommand({ command: "git status" })).toBe("git status")
    expect(extractToolPath({ Path: "/Users/test/index.html" })).toBe("/Users/test/index.html")
    expect(extractSearchQuery({ pattern: "test", path: "src" })).toEqual({ query: "test", target: "src" })
  })

  it("builds natural-language summary sentences matching the exact target syntax", () => {
    // Exactly matches screenshot: 2 commands, 1 search code, 2 other actions
    const calls: ToolCallView[] = [
      makeCall("bash", { command: "ls -la" }),
      makeCall("terminal", { command: "grep -r" }),
      makeCall("search_code", { query: "index.html" }),
      makeCall("custom_action_1"),
      makeCall("custom_action_2"),
    ]

    const res = buildActionSummarySentence(calls, false, false)
    expect(res.summary).toBe("Ran 2 commands, searched code 1 time, and performed 2 other actions")
    expect(res.hasFailure).toBe(false)
  })

  it("handles single and two categories cleanly", () => {
    const single = [makeCall("bash")]
    expect(buildActionSummarySentence(single, false, false).summary).toBe("Ran 1 command")

    const two = [makeCall("bash"), makeCall("search_code")]
    expect(buildActionSummarySentence(two, false, false).summary).toBe("Ran 1 command and searched code 1 time")
  })

  it("handles empty tool calls with thinking", () => {
    expect(buildActionSummarySentence([], true, false).summary).toBe("Thought")
    expect(buildActionSummarySentence([], true, true).summary).toBe("Thinking")
  })

  it("formats durations accurately", () => {
    expect(formatActionDuration(3500)).toBe("3.5s")
    expect(formatActionDuration(47000)).toBe("47s")
    expect(formatActionDuration(63000)).toBe("1m 3s")
    expect(formatActionDuration(193000)).toBe("3m 13s")
  })

  it("formats diff numbers cleanly", () => {
    expect(formatDiffNumber(0)).toBe("0")
    expect(formatDiffNumber(45)).toBe("45")
    expect(formatDiffNumber(2046)).toBe("2k")
    expect(formatDiffNumber(15000)).toBe("15k")
  })

  it("extracts changed files with addition and deletion stats", () => {
    const calls = [
      makeCall("write_file", { path: "src/index.html", content: "line 1\nline 2\nline 3" }),
      makeCall("edit_file", { path: "src/index.html", target: "line 2", replacement: "line 2 revised\nline 2.5" }),
    ]
    const summary = extractChangedFiles(calls)
    expect(summary.totalFiles).toBe(1)
    expect(summary.files[0]?.path).toBe("src/index.html")
    expect(summary.totalAdditions).toBe(5) // 3 from write + 2 from edit
    expect(summary.totalDeletions).toBe(1) // 1 from edit
  })
})
