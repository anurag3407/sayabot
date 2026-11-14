import { agentCliRunner, runCliTurn } from "../runner/cli"
import type { RunLlmTurnArgs, TurnResult } from "../runner/llm"
import { runLlmTurn } from "../runner/llm"
import { defaultMacRunner, localRunnerConfig, runLocalTurn } from "../runner/local"
import { runEngineTurn } from "./run"

export * from "./context"
export * from "./run"

export async function startAgentTurn(args: RunLlmTurnArgs): Promise<TurnResult> {
  const params = args.agent.params as Record<string, unknown> | null
  // Runs on the owner's paired computer through Claude Code / Codex signed in there.
  const local = localRunnerConfig(params)
  if (local) return runLocalTurn(args, local)
  // No key and no computer picked: the owner's Mac, when Sayabot for Mac is set to be the default.
  const mac = await defaultMacRunner(args.agent)
  if (mac) return runLocalTurn(args, mac)
  // Runs through Claude Code / Codex signed in on the computer this server runs on — either
  // chosen in the picker, or because the agent has no key and an app is already signed in.
  const cli = await agentCliRunner(args.agent)
  if (cli) return runCliTurn(args, cli)
  const engine = params?.engine ?? "v2"
  if (engine === "v1") return runLlmTurn(args)
  if (engine === "v2") return runEngineTurn(args)
  throw new Error(`Unsupported agent engine: ${String(engine)}`)
}
