import { agentCliRunner, runCliTurn } from "../runner/cli"
import type { RunLlmTurnArgs, TurnResult } from "../runner/llm"
import { runLlmTurn, withoutRunner } from "../runner/llm"
import { defaultMacRunner, localRunnerConfig, macPlan, runLocalTurn } from "../runner/local"
import { applyRoomModel } from "../runner/room-model"
import { admitServerTurn, planLimitTurn } from "../plans"
import { runFittingTheModel } from "./fit-model"
import { runEngineTurn } from "./run"

export * from "./context"
export * from "./run"

export async function startAgentTurn(input: RunLlmTurnArgs): Promise<TurnResult> {
  // A model picked for this bot in this chat only ("only this chat") wins over its default.
  let args = { ...input, agent: await applyRoomModel(input.room.id, input.agent) }
  // Runs on the owner's paired computer through Claude Code / Codex signed in there. When that
  // Mac is off, the bot answers from the server, waits for the Mac, or says so (its setting).
  const local = localRunnerConfig(args.agent.params as Record<string, unknown> | null)
  if (local) {
    const plan = await macPlan(args.agent, local)
    if (plan !== "server") return runLocalTurn(args, local, { wait: plan === "wait" })
    args = { ...args, agent: { ...args.agent, params: withoutRunner(args.agent.params) } }
  }
  const params = args.agent.params as Record<string, unknown> | null
  // No key and no computer picked: the owner's Mac, when Sayabot for Mac is set to be the default.
  const mac = await defaultMacRunner(args.agent)
  if (mac) return runLocalTurn(args, mac)
  // From here the reply runs on the server: on Sayabot Cloud it counts against the plan.
  const admission = await admitServerTurn(args.agent.orgId)
  if (!admission.allowed) return planLimitTurn(args, admission.message)
  // Runs through Claude Code / Codex signed in on the computer this server runs on — either
  // chosen in the picker, or because the agent has no key and an app is already signed in.
  const cli = await agentCliRunner(args.agent)
  if (cli) return runCliTurn(args, cli)
  const engine = params?.engine ?? "v2"
  if (engine === "v1") return runLlmTurn(args)
  if (engine === "v2") return runFittingTheModel(args, runEngineTurn)
  throw new Error(`Unsupported agent engine: ${String(engine)}`)
}
