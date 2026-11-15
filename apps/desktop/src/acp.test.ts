import { describe, expect, it } from "vitest"
import { MAC_CLI_APPS } from "../../../packages/core/src/mac-apps"
import {
  acpModels,
  acpUpdate,
  effortRequest,
  modelLabel,
  modelRequest,
  permissionOutcome,
  toolName,
} from "./acp"
import { AGENT_SPECS } from "./local-agents"
import { cursorRowsToModels, piRowsToModels } from "./local-models"

describe("acpModels", () => {
  it("reads a grouped `model` config option and puts the current model first", () => {
    const list = acpModels({
      sessionId: "s1",
      configOptions: [
        {
          id: "mode",
          category: "mode",
          type: "select",
          currentValue: "ask",
          options: [{ value: "ask", name: "Ask" }],
        },
        {
          id: "model",
          category: "model",
          type: "select",
          currentValue: "claude-sonnet-5-5",
          options: [
            {
              group: "anthropic",
              name: "Anthropic",
              options: [{ value: "claude-haiku-5-5", name: "Haiku 5.5" }],
            },
            { value: "claude-sonnet-5-5", name: "Sonnet 5.5" },
            { value: "bad id with spaces", name: "Nope" },
          ],
        },
      ],
    })
    expect(list.models).toEqual([
      { id: "claude-sonnet-5-5", label: "Sonnet 5.5", isDefault: true },
      { id: "claude-haiku-5-5", label: "Haiku 5.5" },
    ])
    expect(list.setter).toEqual({ kind: "config", configId: "model" })
    expect(modelRequest(list.setter, "s1", "claude-haiku-5-5")).toEqual({
      method: "session/set_config_option",
      params: { sessionId: "s1", configId: "model", value: "claude-haiku-5-5" },
    })
  })

  it("falls back to the older models list and session/set_model", () => {
    const list = acpModels({
      models: {
        availableModels: [
          { modelId: "auto", name: "Auto" },
          { modelId: "auto", name: "Auto again" },
        ],
        currentModelId: "auto",
      },
    })
    expect(list.models).toEqual([{ id: "auto", label: "Auto", isDefault: true }])
    expect(modelRequest(list.setter, "s1", "auto")).toEqual({
      method: "session/set_model",
      params: { sessionId: "s1", modelId: "auto" },
    })
  })

  it("can't switch models when the session offers none", () => {
    const list = acpModels({ sessionId: "s1" })
    expect(list.models).toEqual([])
    expect(modelRequest(list.setter, "s1", "x")).toBeNull()
  })
})

describe("acpUpdate", () => {
  it("streams reply text", () => {
    expect(
      acpUpdate({
        sessionId: "s",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } },
      }),
    ).toEqual({
      delta: "Hi",
      activity: [],
    })
    expect(
      acpUpdate({
        update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } },
      }),
    ).toEqual({ activity: [] })
  })

  it("names steps by kind, so a titled shell step is still Bash", () => {
    // Copilot titles shell steps with the command; the server refused that as a tool name.
    expect(toolName({ title: "pmset -g batt", kind: "execute" })).toBe("Bash")
    expect(toolName({ title: "Fetch docs", kind: "fetch" })).toBe("WebFetch")
    expect(toolName({ title: "Do a thing!" })).toBe("Do_a_thing")
  })

  it("turns tool calls into live steps", () => {
    expect(
      acpUpdate({
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          title: "Run ls",
          kind: "execute",
          status: "pending",
          rawInput: { command: "ls" },
        },
      }),
    ).toEqual({
      activity: [{ type: "started", key: "t1", toolName: "Bash", args: { command: "ls" } }],
    })
    expect(
      acpUpdate({
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: "completed",
          content: [
            { type: "content", content: { type: "text", text: "a.txt" } },
            { type: "diff", path: "/x/b.ts" },
          ],
        },
      }),
    ).toEqual({
      activity: [{ type: "finished", key: "t1", ok: true, result: "a.txt\nedited /x/b.ts" }],
    })
    expect(
      acpUpdate({
        update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress" },
      }),
    ).toEqual({ activity: [] })
  })
})

describe("permissionOutcome", () => {
  const options = [
    { optionId: "always", kind: "allow_always", name: "Always" },
    { optionId: "once", kind: "allow_once", name: "Allow" },
    { optionId: "no", kind: "reject_once", name: "Deny" },
  ]
  it("allows once, never for good", () => {
    expect(permissionOutcome(options, true)).toEqual({
      outcome: { outcome: "selected", optionId: "once" },
    })
  })
  it("rejects with the app's own option, or cancels when it has none", () => {
    expect(permissionOutcome(options, false)).toEqual({
      outcome: { outcome: "selected", optionId: "no" },
    })
    expect(permissionOutcome([{ optionId: "once", kind: "allow_once" }], false)).toEqual({
      outcome: { outcome: "cancelled" },
    })
  })
})

describe("piRowsToModels", () => {
  it("reads provider and model from `pi --list-models`", () => {
    const out = [
      "provider    model                                   context  max-out  thinking  images",
      "fireworks   accounts/fireworks/models/kimi-k3       1.0M     131.1K   yes       yes",
      "anthropic   claude-sonnet-5-5                       1M       64K      yes       yes",
      "",
    ].join("\n")
    expect(piRowsToModels(out)).toEqual([
      { id: "fireworks/accounts/fireworks/models/kimi-k3", label: "kimi-k3 · fireworks" },
      { id: "anthropic/claude-sonnet-5-5", label: "claude-sonnet-5-5 · anthropic" },
    ])
  })
})

describe("agent apps", () => {
  it("match the shared list the web and the server use", () => {
    expect(AGENT_SPECS.map((spec) => [spec.id, spec.bin]).sort()).toEqual(
      MAC_CLI_APPS.map((app) => [app.id, app.bin]).sort(),
    )
    for (const spec of AGENT_SPECS) {
      const shared = MAC_CLI_APPS.find((app) => app.id === spec.id)
      expect(
        spec.keyEnv.every((name) => shared?.keyEnv.includes(name) || name === "CURSOR_AUTH_TOKEN"),
      ).toBe(true)
    }
  })
})

describe("OpenCode-style sessions", () => {
  // The shape `opencode acp` 2.3.0 answers session/new with (trimmed).
  const session = {
    sessionId: "s9",
    configOptions: [
      {
        id: "model",
        category: "model",
        type: "select",
        currentValue: "opencode-zen/space-bunny-free",
        options: [
          {
            value: "fireworks-ai/accounts/fireworks/models/deepseek-v4p1-flash",
            name: "fireworks-ai/DeepSeek V4.1 Flash",
          },
          {
            value: "opencode-zen/space-bunny-free",
            name: "opencode-zen/Space Bunny Free (1M Context)",
          },
        ],
      },
      {
        id: "effort",
        category: "thought_level",
        type: "select",
        currentValue: "default",
        options: [
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
          { value: "default", name: "Default" },
        ],
      },
    ],
  }

  it("lists every model with readable names, and the current model's effort levels", () => {
    const list = acpModels(session)
    expect(list.models).toEqual([
      {
        id: "opencode-zen/space-bunny-free",
        label: "opencode-zen · Space Bunny Free (1M Context)",
        effort: ["low", "medium", "high"],
        isDefault: true,
      },
      {
        id: "fireworks-ai/accounts/fireworks/models/deepseek-v4p1-flash",
        label: "fireworks-ai · DeepSeek V4.1 Flash",
      },
    ])
    expect(list.effort).toEqual({
      configId: "effort",
      values: ["low", "medium", "high"],
      current: null,
    })
  })

  it("sets an effort the app offers and skips one it doesn't", () => {
    const { effort } = acpModels(session)
    expect(effortRequest(effort, "s9", "high")).toEqual({
      method: "session/set_config_option",
      params: { sessionId: "s9", configId: "effort", value: "high" },
    })
    expect(effortRequest(effort, "s9", "max")).toBeNull()
    expect(effortRequest(effort, "s9", null)).toBeNull()
  })

  it("keeps plain names as they are", () => {
    expect(modelLabel("Claude Sonnet 5.5")).toBe("Claude Sonnet 5.5")
    expect(modelLabel("Space Bunny / Free")).toBe("Space Bunny / Free")
  })
})

describe("cursorRowsToModels", () => {
  it("reads `cursor-agent models` lines", () => {
    const out = [
      "Available models",
      "",
      "auto - Auto (current)",
      "gpt-5.5 - GPT-5.5",
      "sonnet-5-5-thinking - Claude Sonnet 5.5 Thinking",
    ].join("\n")
    expect(cursorRowsToModels(out)).toEqual([
      { id: "auto", label: "Auto", isDefault: true },
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "sonnet-5-5-thinking", label: "Claude Sonnet 5.5 Thinking" },
    ])
  })
})
