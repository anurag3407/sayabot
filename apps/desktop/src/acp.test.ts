import { describe, expect, it } from "vitest"
import { MAC_CLI_APPS, macAppTakesRoomTools } from "../../../packages/core/src/mac-apps"
import {
  acpModels,
  acpUpdate,
  effortRequest,
  isRoomToolStep,
  mcpToolName,
  modelLabel,
  modelRequest,
  permissionOutcome,
  roomMcpServers,
  systemPromptSetup,
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
    ).toEqual({ thinking: "hmm", activity: [] })
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
      // The server decides who gets room tools from the shared transport, so it must match.
      expect([spec.id, shared?.transport]).toEqual([spec.id, spec.run.kind])
    }
  })

  it("run Antigravity over its own ACP server, and no Claude/Codex adapters", () => {
    const acp = (id: string) => AGENT_SPECS.find((spec) => spec.id === id)
    expect(acp("antigravity")).toMatchObject({ bin: "agy", run: { kind: "acp", args: ["acp"] } })
    // Anthropic doesn't allow subscription logins in third-party Agent SDK apps, and OpenAI hasn't
    // sanctioned it: Claude Code and Codex run as their own unmodified binaries instead.
    expect(acp("claude-acp")).toBeUndefined()
    expect(acp("codex-acp")).toBeUndefined()
  })
})

describe("room tools for Mac runs", () => {
  it("go to stream-mode apps always, ACP apps on new Mac apps, print-mode apps never", () => {
    expect(macAppTakesRoomTools("claude-code", null)).toBe(true)
    expect(macAppTakesRoomTools("codex", "1.0.1")).toBe(true)
    expect(macAppTakesRoomTools("antigravity", "1.0.31")).toBe(false)
    expect(macAppTakesRoomTools("antigravity", null)).toBe(false)
    expect(macAppTakesRoomTools("antigravity", "1.0.32")).toBe(true)
    expect(macAppTakesRoomTools("copilot", "2.0.0")).toBe(true)
    expect(macAppTakesRoomTools("pi", "9.9.9")).toBe(false)
    expect(macAppTakesRoomTools("ollama", "9.9.9")).toBe(false)
  })

  it("ride in session/new as a stdio server only when the run has a token", () => {
    const bridge = { command: "/Applications/Sayabot.app/Sayabot", script: "/x/room-mcp.js" }
    expect(roomMcpServers(null, bridge)).toEqual([])
    expect(roomMcpServers({ url: "https://s.example/api/v1/mcp", token: "" }, bridge)).toEqual([])
    expect(roomMcpServers({ url: "https://s.example/api/v1/mcp", token: "t1" }, bridge)).toEqual([
      {
        name: "sayabot",
        command: "/Applications/Sayabot.app/Sayabot",
        args: ["/x/room-mcp.js"],
        env: [
          { name: "ELECTRON_RUN_AS_NODE", value: "1" },
          { name: "SAYABOT_MCP_URL", value: "https://s.example/api/v1/mcp" },
          { name: "SAYABOT_MCP_TOKEN", value: "t1" },
        ],
      },
    ])
  })
})

describe("MCP steps", () => {
  // Shapes the harnesses sent in a real run (trimmed).
  const claude = {
    toolCallId: "toolu_1",
    title: "mcp__sayabot__create_task",
    kind: "other",
    _meta: { claudeCode: { toolName: "mcp__sayabot__create_task" } },
  }
  const codex = { toolCallId: "exec-1", title: "mcp.sayabot.create_task", kind: "execute" }
  const antigravity = {
    toolCallId: "call_1",
    name: "mcp_sayabot_create_task",
    title: "Run mcp_sayabot_create_task",
    kind: "other",
  }

  it("are named like Claude Code names them, whatever the harness", () => {
    expect(toolName(claude)).toBe("mcp__sayabot__create_task")
    expect(toolName(codex)).toBe("mcp__sayabot__create_task")
    expect(toolName(antigravity)).toBe("mcp__sayabot__create_task")
    expect(toolName({ toolCall: codex })).toBe("mcp__sayabot__create_task")
    expect(mcpToolName({ title: "mcp.github.create_pr", kind: "execute" })).toBe(
      "mcp__github__create_pr",
    )
  })

  it("count as room tools only for Sayabot's own server", () => {
    expect([claude, antigravity].every(isRoomToolStep)).toBe(true)
    expect(isRoomToolStep(codex)).toBe(false)
    expect(isRoomToolStep({ title: "mcp.github.create_pr", kind: "execute" })).toBe(false)
    expect(isRoomToolStep({ name: "mcp_github_create_pr", kind: "other" })).toBe(false)
  })

  it("never come from a shell command or file change that only looks like one", () => {
    expect(isRoomToolStep({ title: "mcp__sayabot__create_task", kind: "execute" })).toBe(false)
    expect(
      mcpToolName({
        title: "mcp.sayabot.create_task",
        rawInput: { command: "mcp.sayabot.create_task" },
      }),
    ).toBeNull()
    expect(isRoomToolStep({ name: "mcp_sayabot_x", kind: "edit" })).toBe(false)
    expect(isRoomToolStep({ title: "mcp__sayabot__x; rm -rf ~", kind: "other" })).toBe(false)
    expect(toolName({ title: "mcp__sayabot__x", kind: "execute" })).toBe("Bash")
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

describe("systemPromptSetup", () => {
  // initialize results the harnesses sent (trimmed).
  const acpField = { agentCapabilities: { sessionCapabilities: { systemPrompt: {} } } }
  const antigravity = {
    agentCapabilities: { _meta: { antigravity: { tier: true, systemPrompt: { append: true } } } },
  }

  it("uses ACP's systemPrompt when the agent advertises it", () => {
    expect(systemPromptSetup(acpField, " Room rules ")).toEqual({
      session: {
        systemPrompt: { mode: "append", content: [{ type: "text", text: "Room rules" }] },
      },
      prefix: "",
    })
  })

  it("uses Antigravity's extension when that's what it advertises", () => {
    expect(systemPromptSetup(antigravity, "Room rules")).toEqual({
      session: { _meta: { antigravity: { systemPrompt: { append: "Room rules" } } } },
      prefix: "",
    })
  })

  it("puts it in front of the prompt otherwise, and does nothing without one", () => {
    expect(systemPromptSetup({ agentCapabilities: {} }, "Room rules")).toEqual({
      session: {},
      prefix: "Room rules\n\n",
    })
    expect(systemPromptSetup(antigravity, null)).toEqual({ session: {}, prefix: "" })
    expect(systemPromptSetup(undefined, "  ")).toEqual({ session: {}, prefix: "" })
  })
})
