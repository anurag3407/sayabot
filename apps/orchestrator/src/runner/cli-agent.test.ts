import { describe, expect, it } from "vitest"
import {
  cheapCliModel,
  claudeMcpConfig,
  cliCommand,
  cliEnvironment,
  cliFailureHint,
  cliRunnerAllowed,
  cliRunnerConfig,
  parseCliLine,
} from "./cli-agent"

describe("cliRunnerConfig", () => {
  it("reads a server runner", () => {
    expect(
      cliRunnerConfig({
        runner: { where: "server", app: "claude-code", model: "claude-opus-5-5" },
      }),
    ).toEqual({
      app: "claude-code",
      model: "claude-opus-5-5",
    })
    expect(cliRunnerConfig({ runner: { where: "server", app: "codex" } })).toEqual({
      app: "codex",
      model: null,
    })
  })

  it("ignores paired-computer runners, unknown apps and odd model ids", () => {
    expect(
      cliRunnerConfig({
        runner: { hostId: "3f1c2b9a-0000-4000-8000-000000000000", app: "claude-code" },
      }),
    ).toBeNull()
    expect(cliRunnerConfig({ runner: { where: "server", app: "gemini" } })).toBeNull()
    expect(cliRunnerConfig({ runner: { where: "server", app: "cursor" } })?.app).toBe("cursor")
    expect(
      cliRunnerConfig({ runner: { where: "server", app: "claude-code", model: "x; rm -rf /" } })
        ?.model,
    ).toBeNull()
    expect(cliRunnerConfig(null)).toBeNull()
  })
})

describe("cliRunnerAllowed", () => {
  it("is on outside production and follows the flag", () => {
    expect(cliRunnerAllowed({ NODE_ENV: "development" })).toBe(true)
    expect(cliRunnerAllowed({ NODE_ENV: "production" })).toBe(false)
    expect(cliRunnerAllowed({ NODE_ENV: "production", SAYABOT_LOCAL_CLI: "1" })).toBe(true)
    expect(cliRunnerAllowed({ NODE_ENV: "development", SAYABOT_LOCAL_CLI: "0" })).toBe(false)
  })
})

describe("cliEnvironment", () => {
  it("drops nested-session variables, API keys and server secrets", () => {
    const env = cliEnvironment("/opt/homebrew/bin/claude", {
      HOME: "/Users/me",
      PATH: "/usr/bin",
      CLAUDECODE: "1",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      CLAUDE_CODE_SESSION_ID: "abc",
      ANTHROPIC_API_KEY: "sk-ant-x",
      OPENAI_API_KEY: "sk-x",
      MESH_KEK: "k",
      DATABASE_URL: "postgres://",
      SUPABASE_SERVICE_ROLE_KEY: "s",
      SAYA_AI_API_KEY: "sk-saya",
      CLOUDFLARE_TUNNEL_TOKEN: "t",
      CLAUDE_CONFIG_DIR: "/Users/me/.claude-work",
    })
    expect(env.HOME).toBe("/Users/me")
    expect(env.CLAUDE_CONFIG_DIR).toBe("/Users/me/.claude-work")
    for (const name of [
      "CLAUDECODE",
      "CLAUDE_CODE_ENTRYPOINT",
      "CLAUDE_CODE_SESSION_ID",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "MESH_KEK",
      "DATABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SAYA_AI_API_KEY",
      "CLOUDFLARE_TUNNEL_TOKEN",
    ]) {
      expect(env[name]).toBeUndefined()
    }
    expect(env.PATH?.startsWith("/opt/homebrew/bin")).toBe(true)
  })
})

describe("cliCommand", () => {
  it("runs Claude Code in print mode with default permissions", () => {
    const cmd = cliCommand({ app: "claude-code", model: "claude-sonnet-5-5" }, "SYS", "hello")
    expect(cmd.args).toContain("-p")
    expect(cmd.args).toContain("stream-json")
    expect(cmd.args.join(" ")).toContain("--permission-mode default")
    expect(cmd.args.join(" ")).toContain("--model claude-sonnet-5-5")
    expect(cmd.args.join(" ")).not.toContain("dangerously")
    expect(cmd.stdin).toBe("hello")
  })

  it("runs Codex read-only and leaves the model to Codex by default", () => {
    const cmd = cliCommand({ app: "codex", model: null }, "SYS", "hello")
    expect(cmd.args.join(" ")).toContain("--sandbox read-only")
    expect(cmd.args).not.toContain("--model")
    expect(cmd.stdin).toBe("SYS\n\nhello")
  })

  it("runs Claude Code lean: Sayabot's prompt, read-only tools, none of the person's MCP servers", () => {
    const args = cliCommand({ app: "claude-code", model: null }, "SYS", "hello").args.join(" ")
    expect(args).toContain("--system-prompt SYS")
    expect(args).toContain("--tools Read,Glob,Grep,WebSearch,WebFetch")
    expect(args).toContain("--strict-mcp-config")
    expect(args).toContain("--disable-slash-commands")
    expect(args).toContain("--setting-sources project,local")
    // --bare would skip the Keychain, which is where the subscription sign-in lives.
    expect(args).not.toContain("--bare")
  })

  it("gives Claude Code Sayabot's room tools but not post_message, wait_for_activity or use_secret", () => {
    const args = cliCommand({ app: "claude-code", model: null }, "SYS", "hi", {
      url: "http://127.0.0.1:4000/v1/mcp",
      tokenEnv: "SAYABOT_MCP_TOKEN",
      configPath: "/tmp/x/mcp.json",
    }).args
    expect(args.join(" ")).toContain("--mcp-config /tmp/x/mcp.json")
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("mcp__sayabot")
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe(
      "mcp__sayabot__post_message,mcp__sayabot__wait_for_activity,mcp__sayabot__use_secret",
    )
    expect(JSON.parse(claudeMcpConfig("http://h/v1/mcp", "tok"))).toEqual({
      mcpServers: {
        sayabot: { type: "http", url: "http://h/v1/mcp", headers: { Authorization: "Bearer tok" } },
      },
    })
  })

  it("points Codex at Sayabot's MCP server with the token in an env var, not on the command line", () => {
    const args = cliCommand({ app: "codex", model: "gpt-6-luna" }, "SYS", "hi", {
      url: "http://127.0.0.1:4000/v1/mcp",
      tokenEnv: "SAYABOT_MCP_TOKEN",
    }).args.join(" ")
    expect(args).toContain('mcp_servers.sayabot.url="http://127.0.0.1:4000/v1/mcp"')
    expect(args).toContain('mcp_servers.sayabot.bearer_token_env_var="SAYABOT_MCP_TOKEN"')
    expect(args).toContain("--model gpt-6-luna")
    expect(args).not.toContain("sayabot_at_")
  })

  it("runs Cursor in print mode without --force", () => {
    const cmd = cliCommand({ app: "cursor", model: null }, "SYS", "hello")
    expect(cmd.args.slice(0, 3)).toEqual(["-p", "--output-format", "stream-json"])
    expect(cmd.args).not.toContain("--force")
    expect(cmd.args.at(-1)).toBe("SYS\n\nhello")
    expect(cmd.stdin).toBeNull()
  })
})

describe("cheapCliModel", () => {
  it("uses Haiku for Claude Code background jobs and keeps the others' defaults", () => {
    expect(cheapCliModel({ app: "claude-code", model: "claude-opus-5-5" }).model).toBe(
      "claude-haiku-5-5",
    )
    expect(cheapCliModel({ app: "codex", model: null }).model).toBeNull()
    expect(cheapCliModel({ app: "codex", model: null }, "gpt-6-luna").model).toBe("gpt-6-luna")
  })
})

describe("parseCliLine", () => {
  it("reads Claude Code partial text, messages and the result", () => {
    expect(
      parseCliLine(
        "claude-code",
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
        }),
      ),
    ).toEqual({ kind: "delta", text: "Hi" })
    expect(
      parseCliLine(
        "claude-code",
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Hello" }, { type: "tool_use" }] },
        }),
      ),
    ).toEqual({ kind: "message", text: "Hello" })
    const done = parseCliLine(
      "claude-code",
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Hello there",
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 5,
          cache_read_input_tokens: 100,
          output_tokens: 7,
        },
        modelUsage: { "claude-opus-5-5": {} },
      }),
    )
    expect(done).toEqual({
      kind: "done",
      text: "Hello there",
      error: null,
      model: "claude-opus-5-5",
      usage: { inputTokens: 15, outputTokens: 7, cachedInputTokens: 100 },
    })
  })

  it("marks a Claude Code error result", () => {
    const done = parseCliLine(
      "claude-code",
      JSON.stringify({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        result: "",
      }),
    )
    expect(done?.kind === "done" && done.error).toBe("error_during_execution")
  })

  it("reads Codex messages and usage", () => {
    expect(
      parseCliLine(
        "codex",
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Done" } }),
      ),
    ).toEqual({
      kind: "message",
      text: "Done",
    })
    expect(
      parseCliLine(
        "codex",
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 3, output_tokens: 4, cached_input_tokens: 1 },
        }),
      ),
    ).toEqual({
      kind: "done",
      text: null,
      error: null,
      model: null,
      usage: { inputTokens: 3, outputTokens: 4, cachedInputTokens: 1 },
    })
  })

  it("ignores Codex retry notices and keeps the final error", () => {
    expect(
      parseCliLine(
        "codex",
        JSON.stringify({ type: "error", message: "Reconnecting... 2/5 (timeout)" }),
      ),
    ).toBeNull()
    const done = parseCliLine(
      "codex",
      JSON.stringify({ type: "turn.failed", error: { message: "model not supported" } }),
    )
    expect(done?.kind === "done" && done.error).toBe("model not supported")
  })

  it("reads Cursor's stream-json like Claude Code's", () => {
    expect(
      parseCliLine(
        "cursor",
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        }),
      ),
    ).toEqual({ kind: "message", text: "Hi" })
    const done = parseCliLine(
      "cursor",
      JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Hi there" }),
    )
    expect(done).toMatchObject({ kind: "done", text: "Hi there", error: null })
  })

  it("skips noise", () => {
    expect(parseCliLine("claude-code", "not json")).toBeNull()
    expect(
      parseCliLine("claude-code", JSON.stringify({ type: "system", subtype: "init" })),
    ).toBeNull()
  })
})

describe("cliFailureHint", () => {
  it("points at signing in when the app says so", () => {
    expect(cliFailureHint("claude-code", "Invalid API key · Please run /login", 1)).toContain(
      "isn't signed in",
    )
    expect(cliFailureHint("codex", "boom", 2)).toBe("boom")
  })
})
