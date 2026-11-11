import type { RunLlmTurnArgs, TurnResult } from "../runner/llm"
import { runLlmTurn } from "../runner/llm"
import { localRunnerConfig, runLocalTurn } from "../runner/local"
import { runEngineTurn } from "./run"

export * from "./context"
export * from "./run"

export async function startAgentTurn(args: RunLlmTurnArgs): Promise<TurnResult> {
  // Runs on the owner's computer through Claude Code / Codex signed in there.
  const local = localRunnerConfig(args.agent.params as Record<string, unknown> | null)
  if (local) return runLocalTurn(args, local)
  const engine = (args.agent.params as Record<string, unknown> | null)?.engine ?? "v2"
  if (engine === "v1") return runLlmTurn(args)
  if (engine === "v2") return runEngineTurn(args)
  throw new Error(`Unsupported agent engine: ${String(engine)}`)
}
