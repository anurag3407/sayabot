"use server"

import { getRoomAccess } from "@/lib/auth"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { fail } from "@/lib/actions/shared"
import type { ActionResult, RunStepView, RunTraceView } from "@/lib/types"

export async function getRunTraceAction(input: {
  orgSlug: string
  runId?: string | null
  messageId?: string | null
}): Promise<ActionResult & { trace?: RunTraceView }> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail("Your session expired. Sign in again.")

  const admin = createAdminClient()

  let resolvedRunId = input.runId ?? null
  if (!resolvedRunId && input.messageId) {
    const { data: msg } = await admin
      .from("messages")
      .select("run_id")
      .eq("id", input.messageId)
      .maybeSingle()
    if (msg?.run_id) {
      resolvedRunId = msg.run_id
    } else {
      const { data: runByMsg } = await admin
        .from("agent_runs")
        .select("id")
        .eq("message_id", input.messageId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (runByMsg?.id) {
        resolvedRunId = runByMsg.id
      }
    }
  }

  if (!resolvedRunId) {
    return fail("Run not found for this message")
  }

  const { data: run } = await admin
    .from("agent_runs")
    .select(`
      id,
      session_id,
      room_id,
      task_id,
      agent_id,
      message_id,
      step,
      role,
      status,
      finish_reason,
      steps,
      engine,
      parent_run_id,
      waiting_reason,
      input_tokens,
      output_tokens,
      cost_usd,
      ttft_ms,
      latency_ms,
      error,
      created_at,
      agents (
        id,
        display_name,
        handle
      )
    `)
    .eq("id", resolvedRunId)
    .maybeSingle()

  if (!run) {
    return fail("Run trace not found")
  }

  // Security check: verify user has access to the room
  const access = await getRoomAccess(input.orgSlug, run.room_id)
  if (!access) {
    return fail("Access denied to this run trace")
  }

  // Fetch steps for this run
  const { data: rawSteps } = await admin
    .from("run_steps")
    .select("id, run_id, idx, kind, input_ref, output, usage, started_at, finished_at")
    .eq("run_id", resolvedRunId)
    .order("idx", { ascending: true })

  // Fetch plan from transcript if available
  const { data: transcript } = await admin
    .from("run_transcripts")
    .select("plan")
    .eq("run_id", resolvedRunId)
    .maybeSingle()

  // Fetch any child subagent runs
  const { data: rawSubagentRuns } = await admin
    .from("agent_runs")
    .select(`
      id,
      session_id,
      room_id,
      task_id,
      agent_id,
      message_id,
      step,
      role,
      status,
      finish_reason,
      steps,
      engine,
      parent_run_id,
      waiting_reason,
      input_tokens,
      output_tokens,
      cost_usd,
      ttft_ms,
      latency_ms,
      error,
      created_at,
      agents (
        id,
        display_name,
        handle
      )
    `)
    .eq("parent_run_id", resolvedRunId)
    .order("created_at", { ascending: true })

  // Fetch steps for subagent runs
  const subagentIds = (rawSubagentRuns ?? []).map((r) => r.id)
  const subagentStepsMap: Record<string, RunStepView[]> = {}

  if (subagentIds.length > 0) {
    const { data: rawSubSteps } = await admin
      .from("run_steps")
      .select("id, run_id, idx, kind, input_ref, output, usage, started_at, finished_at")
      .in("run_id", subagentIds)
      .order("idx", { ascending: true })

    if (rawSubSteps) {
      for (const step of rawSubSteps) {
        const start = new Date(step.started_at).getTime()
        const finish = step.finished_at ? new Date(step.finished_at).getTime() : null
        const mapped: RunStepView = {
          id: step.id,
          runId: step.run_id,
          idx: step.idx,
          kind: step.kind as RunStepView["kind"],
          inputRef: step.input_ref,
          output: (step.output as Record<string, unknown>) ?? null,
          usage: (step.usage as RunStepView["usage"]) ?? null,
          startedAt: step.started_at,
          finishedAt: step.finished_at,
          durationMs: finish ? Math.max(0, finish - start) : null,
        }
        if (!subagentStepsMap[step.run_id]) {
          subagentStepsMap[step.run_id] = []
        }
        subagentStepsMap[step.run_id]!.push(mapped)
      }
    }
  }

  const steps: RunStepView[] = (rawSteps ?? []).map((step) => {
    const start = new Date(step.started_at).getTime()
    const finish = step.finished_at ? new Date(step.finished_at).getTime() : null
    return {
      id: step.id,
      runId: step.run_id,
      idx: step.idx,
      kind: step.kind as RunStepView["kind"],
      inputRef: step.input_ref,
      output: (step.output as Record<string, unknown>) ?? null,
      usage: (step.usage as RunStepView["usage"]) ?? null,
      startedAt: step.started_at,
      finishedAt: step.finished_at,
      durationMs: finish ? Math.max(0, finish - start) : null,
    }
  })

  const subagentRuns: RunTraceView[] = (rawSubagentRuns ?? []).map((child) => {
    const childAgent = Array.isArray(child.agents) ? child.agents[0] : child.agents
    return {
      id: child.id,
      sessionId: child.session_id,
      roomId: child.room_id,
      taskId: child.task_id,
      agentId: child.agent_id,
      agentName: childAgent?.display_name ?? null,
      agentHandle: childAgent?.handle ?? null,
      messageId: child.message_id,
      step: child.step,
      role: child.role,
      status: child.status,
      finishReason: child.finish_reason,
      stepsCount: child.steps ?? (subagentStepsMap[child.id]?.length ?? 0),
      engine: child.engine,
      parentRunId: child.parent_run_id,
      waitingReason: child.waiting_reason,
      inputTokens: child.input_tokens,
      outputTokens: child.output_tokens,
      costUsd: Number(child.cost_usd) || 0,
      ttftMs: child.ttft_ms,
      latencyMs: child.latency_ms,
      error: child.error,
      createdAt: child.created_at,
      steps: subagentStepsMap[child.id] ?? [],
    }
  })

  const agentData = Array.isArray(run.agents) ? run.agents[0] : run.agents

  const trace: RunTraceView = {
    id: run.id,
    sessionId: run.session_id,
    roomId: run.room_id,
    taskId: run.task_id,
    agentId: run.agent_id,
    agentName: agentData?.display_name ?? null,
    agentHandle: agentData?.handle ?? null,
    messageId: run.message_id,
    step: run.step,
    role: run.role,
    status: run.status,
    finishReason: run.finish_reason,
    stepsCount: run.steps ?? steps.length,
    engine: run.engine,
    parentRunId: run.parent_run_id,
    waitingReason: run.waiting_reason,
    inputTokens: run.input_tokens,
    outputTokens: run.output_tokens,
    costUsd: Number(run.cost_usd) || 0,
    ttftMs: run.ttft_ms,
    latencyMs: run.latency_ms,
    error: run.error,
    createdAt: run.created_at,
    steps,
    subagentRuns,
    transcriptPlan: (transcript?.plan as Record<string, unknown>) ?? null,
  }

  return {
    ok: true,
    trace,
  }
}
