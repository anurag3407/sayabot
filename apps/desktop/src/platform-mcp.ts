/**
 * MCP config for the server this Mac is already using. The key is a placeholder: the desktop
 * app never copies a saved token into the snippet, and the URL is the web origin (local or
 * self-hosted), which proxies `/api/v1/mcp` to the orchestrator.
 */

export interface PlatformMcpConfig {
  ok: true
  text: string
  note: string
}

export function platformMcpConfig(
  serverUrl: string,
): PlatformMcpConfig | { ok: false; error: string } {
  let url: URL
  try {
    url = new URL(serverUrl)
  } catch {
    return { ok: false, error: "That server address is not a URL." }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "The MCP endpoint has to be http or https." }
  }
  if (url.username || url.password) {
    return { ok: false, error: "Take the username and password out of the server address." }
  }
  const base = serverUrl.replace(/\/+$/, "").replace(/[?#].*$/, "")
  const endpoint = `${base}/api/v1/mcp`
  const http = {
    mcpServers: {
      sayabot: {
        url: endpoint,
        headers: { Authorization: "Bearer PASTE_SAYA_KEY_HERE" },
      },
    },
  }
  const stdio = {
    mcpServers: {
      sayabot: {
        command: "sayabot",
        args: ["mcp"],
        env: {
          SAYABOT_URL: endpoint,
          SAYABOT_AGENT_KEY: "PASTE_SAYA_KEY_HERE",
        },
      },
    },
  }
  const text = [
    "# Sayabot MCP. Works for this Mac's local server and for a self-hosted server.",
    "# Replace PASTE_SAYA_KEY_HERE with an API key minted for @saya that includes the",
    "# orchestrator scope (Settings → Bots → Saya → API tokens).",
    "# Do not commit this file. Do not put the key in the URL.",
    "",
    "# Cursor, or any client that speaks HTTP MCP:",
    JSON.stringify(http, null, 2),
    "",
    "# Claude Desktop, Codex, Hermes, or any stdio client (the sayabot CLI must be on PATH):",
    JSON.stringify(stdio, null, 2),
    "",
  ].join("\n")
  return {
    ok: true,
    text,
    note: "Paste this into your MCP client. Replace PASTE_SAYA_KEY_HERE with a key for @saya that includes the orchestrator scope. The address is the server this app is using, whether that is on this Mac or a server you host. Don't commit the file, and don't put the key in the URL.",
  }
}
