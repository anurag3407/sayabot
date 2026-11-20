import { redactSecrets } from "@sayabot/core"
import { agentRuns, agents, messages, runSteps, runTranscripts, toolCalls } from "@sayabot/db"
import { generateText } from "ai"
import { and, desc, eq } from "drizzle-orm"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"
import { abortRun, activeRunIds } from "./active-runs"
import { canUserReadRoom } from "./authz"
import { resolveApprovalWaiter } from "./tools/approvals"
import { interruptRoom } from "./coordinator/interrupt"
import { ttsRoutes } from "./tts/routes"
import { botRoutes } from "./bot/routes"
import { mcpRoutes } from "./mcp/server"
import { localJobRoutes } from "./internal/local-jobs"
import { internalRoutes } from "./internal/routes"
import { loadCanvas } from "./canvas/server"
import { restoreCanvasSnapshot } from "./canvas/tools"
import { getDb, notify } from "./db"
import { isInternalRequest } from "./internal-auth"
import { acceptInbound, eventsFromPayload, type InboundPlatform } from "./connectors/inbound"
import { enqueueRoomMessage } from "./jobs"
import { loadMessage } from "./runner/context"
import { agentCliRunner, runCliOnce } from "./runner/cli"
import { resolveAgentModel } from "./runner/llm"
import { applyTaskMutation } from "./collab/tasks-service"
import { executeWebSearch, fetchProviderCredits } from "./tools/builtins/web-search"
import { executeDocumentExtract, type DocumentOcrProvider } from "./tools/builtins/document"
import { resolveToolCredential } from "./tools/secrets"
import { runRoutineNow } from "./scheduler/routines"

const roomMessageSchema = z.object({
  roomId: z.string().uuid(),
  messageId: z.string().uuid(),
})

const taskMutateSchema = z.object({
  taskId: z.string().uuid(),
  actor: z.object({
    type: z.enum(["human", "agent", "system"]),
    id: z.string().uuid(),
  }),
  status: z.enum(["open", "in_progress", "stuck", "done"]).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  assigneeAgentId: z.string().uuid().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  unblockNeeds: z
    .enum(["human_answer", "another_agent", "credential", "external_access", "time", "other"])
    .nullable()
    .optional(),
  unblockDetail: z.string().nullable().optional(),
  blockedBy: z.array(z.string().uuid()).nullable().optional(),
  outcome: z
    .object({
      kind: z.enum(["artifact", "submission", "external_change", "decision", "none", "legacy"]),
      ref: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  reason: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const restoreSchema = z.object({
  userId: z.string().uuid(),
  snapshot: z.string().max(1_000_000),
})

const agentTestSchema = z.object({
  orgId: z.string().uuid(),
})

const testWebSearchSchema = z.object({
  orgId: z.string().uuid().optional(),
  provider: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  query: z.string().default("test query"),
})

const searchProviderCreditsSchema = z.object({
  orgId: z.string().uuid().optional(),
  provider: z.string().default("duckduckgo"),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
})

const testDocumentOcrSchema = z.object({
  orgId: z.string().uuid().optional(),
  provider: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  source: z
    .string()
    .default("https://raw.githubusercontent.com/DS4SD/docling/main/tests/data/2206.01062.pdf"),
})

export function createApp() {
  const app = new Hono()

  app.use("/v1/*", bodyLimit({ maxSize: 2_000_000 }))
  app.use("/internal/*", bodyLimit({ maxSize: 200_000 }))

  app.get("/health", (c) =>
    c.json({ ok: true, service: "sayabot-orchestrator", activeRuns: activeRunIds().length }),
  )

  app.get("/api/instance", (c) =>
    c.json({
      ok: true,
      sayabot: true,
      name: "Sayabot Local",
      edition: "self-hosted",
      guestMode: true,
      version: "1.0.31",
    }),
  )

  app.get("/api/version", (c) =>
    c.json({
      ok: true,
      sayabot: true,
      latestDesktopVersion: "1.0.31",
    }),
  )

  app.get("/api/desktop/guest", (c) =>
    c.json({
      enabled: true,
      supabaseUrl: "http://127.0.0.1:4000",
      anonKey: "local-anon-key",
      localMode: true,
    }),
  )

  app.get("/auth/complete", (c) => {
    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Sayabot Local Workspace</title>
</head>
<body style="background:#09090b;color:#ededf0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <p style="font-size:14px;color:#a3a3ad;">Opening Sayabot Local Workspace…</p>
  <script>
    try {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const token = hash.get('access_token');
      const refresh = hash.get('refresh_token');
      if (token) localStorage.setItem('sayabot_token', token);
      if (refresh) localStorage.setItem('sayabot_refresh', refresh);
    } catch (e) {}
    window.location.replace('/');
  </script>
</body>
</html>`)
  })

  app.get("/api/local/workspace", async (c) => {
    const db = getDb()
    const roomId = "00000000-0000-0000-0000-000000000004"
    try {
      const recentMessages = await db
        .select({
          id: messages.id,
          senderType: messages.senderType,
          senderId: messages.senderId,
          content: messages.content,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(eq(messages.roomId, roomId))
        .orderBy(desc(messages.createdAt))
        .limit(50)

      return c.json({
        ok: true,
        room: {
          id: roomId,
          name: "general",
          topic: "Local zero-config workspace with PGlite & Host Sandbox",
        },
        agent: {
          id: "00000000-0000-0000-0000-000000000003",
          name: "Sayabot",
        },
        messages: recentMessages.reverse(),
      })
    } catch (err: any) {
      return c.json({ ok: false, error: err.message }, 500)
    }
  })

  app.post("/api/local/message", async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body.content !== "string" || !body.content.trim()) {
      return c.json({ error: "content required" }, 400)
    }
    const db = getDb()
    const roomId = body.roomId || "00000000-0000-0000-0000-000000000004"
    const userId = "00000000-0000-0000-0000-000000000001"

    try {
      const [inserted] = await db
        .insert(messages)
        .values({
          roomId,
          senderType: "human",
          senderId: userId,
          content: body.content.trim(),
          mentions: ["@Sayabot"],
        })
        .returning()

      if (inserted) {
        await enqueueRoomMessage(roomId, inserted.id)
      }

      return c.json({ ok: true, message: inserted })
    } catch (err: any) {
      return c.json({ ok: false, error: err.message }, 500)
    }
  })

  app.get("/", (c) => {
    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sayabot Local Workspace</title>
  <style>
    :root {
      --bg: #09090b;
      --card-bg: #111114;
      --border: rgba(255, 255, 255, 0.08);
      --text: #ededf0;
      --muted: #a3a3ad;
      --accent: #9d8cff;
      --accent-glow: rgba(157, 140, 255, 0.15);
      --green: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
    header { height: 50px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 16px; background: rgba(17, 17, 20, 0.7); backdrop-filter: blur(8px); -webkit-app-region: drag; }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 14px; }
    .badge { font-size: 11px; font-weight: 500; background: rgba(16, 185, 129, 0.15); color: var(--green); border: 1px solid rgba(16, 185, 129, 0.3); padding: 2px 8px; border-radius: 99px; display: inline-flex; align-items: center; gap: 5px; }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
    .header-actions { display: flex; gap: 8px; -webkit-app-region: no-drag; }
    .btn { background: rgba(255, 255, 255, 0.06); color: var(--text); border: 1px solid var(--border); padding: 6px 12px; border-radius: 8px; font-size: 12px; cursor: pointer; transition: 0.15s ease; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
    .btn:hover { background: rgba(255, 255, 255, 0.12); }
    .btn-primary { background: var(--accent); color: #09090b; border: none; font-weight: 600; }
    .btn-primary:hover { background: #b6a9ff; }
    .layout { display: flex; flex: 1; overflow: hidden; }
    aside { width: 240px; border-right: 1px solid var(--border); background: #0c0c0f; display: flex; flex-direction: column; padding: 12px; gap: 16px; }
    .section-title { font-size: 11px; text-transform: uppercase; color: var(--muted); font-weight: 600; letter-spacing: 0.05em; margin-bottom: 6px; }
    .item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; font-size: 13px; cursor: pointer; color: var(--muted); text-decoration: none; }
    .item.active, .item:hover { background: rgba(255, 255, 255, 0.05); color: var(--text); }
    .caps { margin-top: auto; font-size: 11px; color: var(--muted); display: flex; flex-direction: column; gap: 4px; padding: 10px; border-radius: 8px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); }
    main { flex: 1; display: flex; flex-direction: column; background: var(--bg); overflow: hidden; }
    .chat-header { padding: 12px 20px; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--muted); display: flex; align-items: center; justify-content: space-between; }
    .chat-header strong { color: var(--text); margin-right: 8px; }
    .messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
    .msg { display: flex; gap: 12px; max-width: 85%; }
    .msg.human { align-self: flex-end; flex-direction: row-reverse; }
    .avatar { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600; flex-shrink: 0; }
    .msg.agent .avatar { background: var(--accent-glow); border: 1px solid rgba(157, 140, 255, 0.3); color: var(--accent); }
    .msg.human .avatar { background: rgba(255, 255, 255, 0.1); color: var(--text); }
    .bubble { background: var(--card-bg); border: 1px solid var(--border); border-radius: 14px; padding: 10px 14px; font-size: 13.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .msg.human .bubble { background: #1f1d2b; border-color: rgba(157, 140, 255, 0.2); }
    .msg-sender { font-size: 11px; color: var(--muted); margin-bottom: 3px; font-weight: 500; }
    .composer { padding: 16px 20px; border-top: 1px solid var(--border); background: rgba(17, 17, 20, 0.5); }
    .input-wrap { display: flex; gap: 10px; background: #16161a; border: 1px solid var(--border); border-radius: 12px; padding: 8px 12px; }
    .input-wrap:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-glow); }
    textarea { flex: 1; background: transparent; border: none; color: var(--text); font-size: 13.5px; resize: none; outline: none; min-height: 22px; max-height: 120px; }
    .chips { display: flex; gap: 8px; margin-top: 8px; }
    .chip { font-size: 11.5px; color: var(--muted); background: rgba(255,255,255,0.03); border: 1px solid var(--border); padding: 4px 8px; border-radius: 6px; cursor: pointer; }
    .chip:hover { color: var(--text); border-color: rgba(255,255,255,0.2); }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span>⚡ Sayabot</span>
      <span class="badge"><span class="dot"></span> Local Zero-Config</span>
    </div>
    <div class="header-actions">
      <button class="btn" onclick="returnToController()">Controller</button>
      <a class="btn" href="http://127.0.0.1:3000" target="_blank" title="Open full Next.js web application if running">Web App (3000)</a>
    </div>
  </header>

  <div class="layout">
    <aside>
      <div>
        <div class="section-title">Rooms</div>
        <div class="item active"># general</div>
      </div>
      <div>
        <div class="section-title">Active Agent</div>
        <div class="item">🤖 Sayabot (Local)</div>
      </div>
      <div class="caps">
        <div><strong>Engine:</strong> Orchestrator Local</div>
        <div><strong>Database:</strong> Embedded PGlite</div>
        <div><strong>Sandbox:</strong> Host ~/.sayabot</div>
        <div><strong>Locking:</strong> Advisory Locks Active</div>
      </div>
    </aside>

    <main>
      <div class="chat-header">
        <div><strong>#general</strong> Local Team & Agent Room</div>
        <div style="font-size:11.5px; color: var(--green);">● Ready for turns</div>
      </div>

      <div class="messages" id="messages">
        <div class="msg agent">
          <div class="avatar">🤖</div>
          <div>
            <div class="msg-sender">Sayabot</div>
            <div class="bubble">👋 Welcome to Sayabot Local!
You are running in 1-click zero-config mode powered by embedded PostgreSQL (PGlite) and an isolated host compute sandbox. No Docker and no external database required.
How can I assist your team today?</div>
          </div>
        </div>
      </div>

      <div class="composer">
        <div class="input-wrap">
          <textarea id="promptInput" rows="1" placeholder="Message #general... (Enter to send, Shift+Enter for newline)"></textarea>
          <button class="btn btn-primary" id="sendBtn" onclick="sendMessage()">Send</button>
        </div>
        <div class="chips">
          <div class="chip" onclick="quickPrompt('What tools and capabilities do you have available?')">What tools do you have?</div>
          <div class="chip" onclick="quickPrompt('Run a bash command in your sandbox to check the environment')">Test sandbox execution</div>
          <div class="chip" onclick="quickPrompt('Create a plan for building a new application')">Plan a project</div>
        </div>
      </div>
    </main>
  </div>

  <script>
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('promptInput');
    const sendBtn = document.getElementById('sendBtn');
    let knownMessageIds = new Set();

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    function quickPrompt(text) {
      inputEl.value = text;
      sendMessage();
    }

    function returnToController() {
      if (window.sayabotDesktop && window.sayabotDesktop.returnToController) {
        window.sayabotDesktop.returnToController();
      } else {
        window.location.href = '/auth/complete';
      }
    }

    async function loadWorkspace() {
      try {
        const res = await fetch('/api/local/workspace');
        if (!res.ok) return;
        const data = await res.json();
        if (data.ok && Array.isArray(data.messages)) {
          for (const msg of data.messages) {
            if (!knownMessageIds.has(msg.id)) {
              knownMessageIds.add(msg.id);
              appendMessage(msg.senderType, msg.senderType === 'human' ? 'You' : 'Sayabot', msg.content);
            }
          }
        }
      } catch (e) {}
    }

    function appendMessage(senderType, senderName, content) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'msg ' + (senderType === 'human' ? 'human' : 'agent');
      const avatar = senderType === 'human' ? '👤' : '🤖';
      msgDiv.innerHTML = '<div class="avatar">' + avatar + '</div><div><div class="msg-sender">' + senderName + '</div><div class="bubble"></div></div>';
      msgDiv.querySelector('.bubble').textContent = content;
      messagesEl.appendChild(msgDiv);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    async function sendMessage() {
      const text = inputEl.value.trim();
      if (!text) return;
      inputEl.value = '';
      appendMessage('human', 'You', text);

      try {
        sendBtn.disabled = true;
        const res = await fetch('/api/local/message', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: text })
        });
        if (!res.ok) {
          appendMessage('agent', 'Sayabot', '⚠️ Error sending message: ' + res.statusText);
        }
      } catch (err) {
        appendMessage('agent', 'Sayabot', '⚠️ Network error: ' + err.message);
      } finally {
        sendBtn.disabled = false;
        setTimeout(loadWorkspace, 1000);
      }
    }

    loadWorkspace();
    setInterval(loadWorkspace, 2000);
  </script>
</body>
</html>`)
  })

  app.use("/internal/*", async (c, next) => {
    if (!isInternalRequest(c.req.header("authorization"), c.req.header("x-internal-secret"))) {
      return c.json({ error: "unauthorized" }, 401)
    }
    await next()
  })

  app.post("/internal/room-message", async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = roomMessageSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: "invalid body" }, 400)
    const message = await loadMessage(parsed.data.messageId)
    if (!message || message.roomId !== parsed.data.roomId || message.senderType !== "human") {
      return c.json({ error: "message not found or not a human message" }, 404)
    }
    await interruptRoom(parsed.data.roomId)
    await enqueueRoomMessage(parsed.data.roomId, parsed.data.messageId)
    return c.json({ queued: true }, 202)
  })

  app.post("/internal/inbound", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      platform?: string
      connectorId?: string
      key?: string
      raw?: string
    } | null
    const platform = body?.platform
    if (platform !== "telegram" && platform !== "whatsapp")
      return c.json({ error: "unsupported" }, 400)
    if (!body?.connectorId || typeof body.raw !== "string" || body.raw.length > 100_000) {
      return c.json({ error: "invalid body" }, 400)
    }
    const events = eventsFromPayload(platform as InboundPlatform, body.raw)
    if (events.length === 0) return c.json({ queued: false })
    const results = []
    for (const event of events.slice(0, 10)) {
      results.push(
        await acceptInbound({ connectorId: body.connectorId, platform, key: body.key, ...event }),
      )
    }
    return c.json({ results })
  })

  app.post("/internal/runs/:runId/stop", async (c) => {
    const runId = c.req.param("runId")
    const stopped = abortRun(runId)
    await notify("mesh_stop_run", { runId }).catch(() => {})
    return c.json({ stopped, notified: true })
  })

  app.post("/internal/routines/:id/run", async (c) => {
    if (!isInternalRequest(c.req.header("authorization"), c.req.header("x-internal-secret"))) {
      return c.json({ error: "forbidden" }, 403)
    }
    const routineId = c.req.param("id")
    const result = await runRoutineNow(routineId)
    if (!result.success) {
      return c.json({ error: result.error }, 400)
    }
    return c.json({ ok: true, runId: result.runId })
  })

  app.post("/internal/tasks/mutate", async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = taskMutateSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: "invalid body", details: parsed.error.issues }, 400)
    }
    try {
      const result = await applyTaskMutation(parsed.data)
      return c.json({ ok: true, task: result.task, event: result.event })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ error: message }, 400)
    }
  })

  app.post("/internal/agents/:agentId/test", async (c) => {
    const agentId = c.req.param("agentId")
    const body = await c.req.json().catch(() => null)
    const parsed = agentTestSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: "invalid body" }, 400)
    const [agent] = await getDb()
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.orgId, parsed.data.orgId)))
      .limit(1)
    if (!agent) return c.json({ error: "agent not found" }, 404)
    if (agent.kind === "external") return c.json({ error: "external agents have no model" }, 400)
    const started = Date.now()
    try {
      const cli = await agentCliRunner(agent)
      if (cli) {
        const out = await runCliOnce(
          cli,
          agent.systemPrompt || "",
          "Reply with the single word: ok",
        )
        return c.json({
          text: redactSecrets(out.text).text.slice(0, 300),
          model: out.model,
          latencyMs: Date.now() - started,
        })
      }
      const resolved = await resolveAgentModel(agent)
      const result = await generateText({
        model: resolved.model,
        system: agent.systemPrompt || undefined,
        prompt: "Reply with the single word: ok",
        maxOutputTokens: 200,
        abortSignal: AbortSignal.timeout(25_000),
      })
      return c.json({
        text: redactSecrets(result.text).text.slice(0, 300),
        model: resolved.modelName,
        latencyMs: Date.now() - started,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ error: redactSecrets(message).text.slice(0, 500) }, 502)
    }
  })

  app.post("/internal/tools/test-web-search", async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = testWebSearchSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: "invalid body", details: parsed.error.issues }, 400)
    const started = Date.now()
    try {
      let { provider, apiKey, baseUrl } = parsed.data
      if (
        parsed.data.orgId &&
        (!provider || (!apiKey && provider !== "duckduckgo" && provider !== "searxng"))
      ) {
        const stored = await resolveToolCredential({ orgId: parsed.data.orgId, tool: "web_search" })
        if (stored) {
          provider = provider || stored.provider
          apiKey = apiKey || stored.apiKey
          baseUrl = baseUrl || stored.baseUrl
        }
      }
      const out = await executeWebSearch({
        query: parsed.data.query,
        count: 3,
        provider,
        apiKey,
        baseUrl,
      })
      return c.json({
        ok: true,
        provider: out.provider,
        query: out.query,
        count: out.results.length,
        results: out.results,
        answer: out.answer,
        latencyMs: Date.now() - started,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ ok: false, error: redactSecrets(message).text.slice(0, 500) }, 400)
    }
  })

  app.post("/internal/tools/search-provider-credits", async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = searchProviderCreditsSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: "invalid body", details: parsed.error.issues }, 400)
    try {
      const { provider } = parsed.data
      let { apiKey, baseUrl } = parsed.data
      if (
        parsed.data.orgId &&
        !apiKey &&
        provider !== "duckduckgo" &&
        provider !== "searxng" &&
        provider !== "whoogle"
      ) {
        const stored = await resolveToolCredential({ orgId: parsed.data.orgId, tool: "web_search" })
        if (stored) {
          apiKey = apiKey || stored.apiKey
          baseUrl = baseUrl || stored.baseUrl
        }
      }
      const info = await fetchProviderCredits({
        provider,
        apiKey,
        baseUrl,
      })
      return c.json(info)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ ok: false, error: redactSecrets(message).text.slice(0, 500) }, 400)
    }
  })

  app.post("/internal/tools/test-document-ocr", async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = testDocumentOcrSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: "invalid body", details: parsed.error.issues }, 400)
    const started = Date.now()
    try {
      let { provider, apiKey, baseUrl } = parsed.data
      if (
        parsed.data.orgId &&
        (!provider ||
          (!apiKey && provider !== "docling" && provider !== "marker" && provider !== "tesseract"))
      ) {
        const stored = await resolveToolCredential({
          orgId: parsed.data.orgId,
          tool: "document_extract",
        })
        if (stored) {
          provider = provider || stored.provider
          apiKey = apiKey || stored.apiKey
          baseUrl = baseUrl || stored.baseUrl
        }
      }
      const out = await executeDocumentExtract({
        source: parsed.data.source,
        provider: (provider as DocumentOcrProvider) || "docling",
        apiKey,
        baseUrl,
        fallbackToVision: true,
      })
      return c.json({
        ok: true,
        provider: out.provider,
        source: out.source,
        pageCount: out.pageCount,
        tablesCount: out.tablesCount,
        markdownPreview: out.markdown.slice(0, 300),
        processingTimeMs: out.processingTimeMs || Date.now() - started,
        fallback: out.fallback,
        warning: out.warning,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ ok: false, error: redactSecrets(message).text.slice(0, 500) }, 400)
    }
  })

  app.post("/internal/canvases/:canvasId/restore", async (c) => {
    const canvasId = c.req.param("canvasId")
    const canvas = await loadCanvas(canvasId)
    if (!canvas) return c.json({ error: "canvas not found" }, 404)
    const body = await c.req.json().catch(() => null)
    const parsed = restoreSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: "invalid body" }, 400)
    if (!(await canUserReadRoom(parsed.data.userId, canvas.roomId))) {
      return c.json({ error: "forbidden" }, 403)
    }
    const result = await restoreCanvasSnapshot({
      canvasId,
      roomId: canvas.roomId,
      userId: parsed.data.userId,
      snapshot: parsed.data.snapshot,
    })
    return c.json(result)
  })

  app.post("/v1/tools/:toolCallId/approve", async (c) => {
    if (!isInternalRequest(c.req.header("authorization"), c.req.header("x-internal-secret"))) {
      return c.json({ error: "unauthorized" }, 401)
    }
    const toolCallId = c.req.param("toolCallId")
    const body = await c.req.json().catch(() => ({}))
    const approved = Boolean(body.approved)
    const status = approved ? "approved" : "rejected"

    const [toolCall] = await getDb()
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.id, toolCallId))
      .limit(1)

    if (!toolCall) return c.json({ error: "tool call not found" }, 404)

    await getDb()
      .update(toolCalls)
      .set({
        status,
        resolvedAt: new Date(),
      })
      .where(and(eq(toolCalls.id, toolCallId), eq(toolCalls.status, "pending_approval")))

    await notify("tool_call_resolved", { toolCallId, status })
    resolveApprovalWaiter(toolCallId, status)

    return c.json({ ok: true, status })
  })

  app.get("/internal/runs/:runId/trace", async (c) => {
    if (!isInternalRequest(c.req.header("authorization"), c.req.header("x-internal-secret"))) {
      return c.json({ error: "unauthorized" }, 401)
    }
    const runId = c.req.param("runId")
    const db = getDb()
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1)

    if (!run) return c.json({ error: "run not found" }, 404)

    const steps = await db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, runId))
      .orderBy(runSteps.idx)

    const [transcript] = await db
      .select({ plan: runTranscripts.plan })
      .from(runTranscripts)
      .where(eq(runTranscripts.runId, runId))
      .limit(1)

    return c.json({
      ok: true,
      trace: {
        run,
        steps,
        plan: transcript?.plan ?? null,
      },
    })
  })

  app.route("/", botRoutes)
  app.route("/", mcpRoutes)
  app.route("/", internalRoutes)
  app.route("/", localJobRoutes)
  app.route("/v1/tts", ttsRoutes)

  app.onError((error, c) => {
    console.error("[http] unhandled error", error)
    return c.json({ error: "internal error" }, 500)
  })

  return app
}

export function getDbForHealth() {
  return getDb()
}
