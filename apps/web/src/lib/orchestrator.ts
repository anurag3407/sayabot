import "server-only"
import { getInternalSecret, getOrchestratorUrl } from "@/lib/env"

async function callOrchestrator(
  path: string,
  body: unknown,
  timeoutMs = 15_000,
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const response = await fetch(`${getOrchestratorUrl()}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": getInternalSecret(),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      return { ok: false, status: response.status, error: text.slice(0, 300) || response.statusText }
    }
    return { ok: true, status: response.status }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function queueRoomMessage(roomId: string, messageId: string) {
  return callOrchestrator("/internal/room-message", { roomId, messageId })
}

export function stopRunInOrchestrator(runId: string) {
  return callOrchestrator(`/internal/runs/${encodeURIComponent(runId)}/stop`, {})
}

export function runRoutineInOrchestrator(routineId: string) {
  return callOrchestrator(`/internal/routines/${encodeURIComponent(routineId)}/run`, {})
}

export async function testWebSearchInOrchestrator(payload: {
  orgId?: string
  provider?: string
  apiKey?: string
  baseUrl?: string
  query?: string
}): Promise<{ ok: true; provider: string; count: number; results: any[]; answer?: string; latencyMs: number } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${getOrchestratorUrl()}/internal/tools/test-web-search`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": getInternalSecret(),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.ok) {
      return { ok: false, error: data?.error || `Search failed with status ${response.status}` }
    }
    return data
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function testAgentInOrchestrator(
  agentId: string,
  orgId: string,
): Promise<{ ok: true; text: string; model: string; latencyMs: number } | { ok: false; error: string }> {
  try {
    const response = await fetch(
      `${getOrchestratorUrl()}/internal/agents/${encodeURIComponent(agentId)}/test`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-secret": getInternalSecret(),
        },
        body: JSON.stringify({ orgId }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    )
    const data = (await response.json().catch(() => null)) as
      | { text?: string; model?: string; latencyMs?: number; error?: string }
      | null
    if (!response.ok || !data || typeof data.text !== "string") {
      return { ok: false, error: data?.error ?? `agent test failed (${response.status})` }
    }
    return {
      ok: true,
      text: data.text,
      model: data.model ?? "unknown",
      latencyMs: data.latencyMs ?? 0,
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function restoreCanvasInOrchestrator(canvasId: string, userId: string, snapshot: string) {
  return callOrchestrator(
    `/internal/canvases/${encodeURIComponent(canvasId)}/restore`,
    { userId, snapshot },
    30_000,
  )
}

export async function mutateTaskInOrchestrator(input: {
  taskId: string
  actor: { type: "human" | "agent" | "system"; id: string }
  status?: string
  title?: string
  description?: string
  assigneeUserId?: string | null
  assigneeAgentId?: string | null
  dueAt?: string | null
  unblockNeeds?: string | null
  unblockDetail?: string | null
  blockedBy?: string[] | null
  outcome?: { kind: string; ref?: string | null } | null
  reason?: string | null
  note?: string | null
  metadata?: Record<string, unknown>
}): Promise<{ ok: boolean; task?: unknown; event?: unknown; error?: string }> {
  try {
    const response = await fetch(`${getOrchestratorUrl()}/internal/tasks/mutate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": getInternalSecret(),
      },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await response.json().catch(() => null)) as
      | { ok?: boolean; task?: unknown; event?: unknown; error?: string }
      | null
    if (!response.ok || !data?.ok) {
      return { ok: false, error: data?.error ?? `task mutation failed (${response.status})` }
    }
    return { ok: true, task: data.task, event: data.event }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
