# Stall Watchdog

A turn can stop making progress while its process stays perfectly healthy: a provider connection hangs, a stream never closes, an adapter stops calling back. Heartbeats do not catch it, because the heartbeats keep firing. The watchdog watches **visible activity** instead, and stops a turn that has produced nothing for too long.

Source files: `apps/orchestrator/src/engine/watchdog.ts`, `apps/orchestrator/src/active-runs.ts`, `apps/orchestrator/src/engine/run.ts`, `apps/orchestrator/src/tools/audited.ts`, `apps/orchestrator/src/index.ts`

---

## ⏱ Two limits

| Constant        | Value  | Applies when                                     |
| :-------------- | :----- | :----------------------------------------------- |
| `TURN_STALL_MS` | 20 min | No tool of this run is running                   |
| `TOOL_STALL_MS` | 2 h    | One of the run's tools started and has not ended |

The second limit exists because a build, a test suite, or a long `computer_shell` legitimately reports nothing for a long time. `stallLimitFor(toolsInFlight, limitMs)` picks the limit and honours an explicit override.

`assessStall({ now, lastActivityAt, toolsInFlight, limitMs })` returns:

```ts
interface StallAssessment {
  stalled: boolean
  limitMs: number
  silentForMs: number
  reason: string | null // plain words for the room, null while healthy
}
```

The reason is `A tool reported nothing for N minutes, so this step was stopped.` or `No activity for N minutes, so this step was stopped.`

## 📡 What counts as activity

`active-runs.ts` keeps `lastActivityAt` and `toolsInFlight` per run:

- `registerRun` starts the clock.
- `touchRun(runId)` is called from `send()` in `run.ts`, so every visible event — a `run.status`, a `run.step`, a redacted `message.delta` — is progress.
- `beginRunTool` / `endRunTool` bracket `spec.execute` in `audited.ts`, so a running tool extends the allowance and finishing one resets it.
- `touchRun` also fires when an approval resolves, because waiting on a person is not a wedged turn.

A provider that stops streaming therefore goes silent, while a tool that is genuinely working does not.

## 🚦 What the watchdog does

`startRunWatchdog()` runs every 60 seconds over `runActivity()` — the runs **this process** owns:

- a run past its limit is stopped through `abortRun(runId)`, which aborts that run's `AbortController`; the turn then finalizes as `halted` through the normal path,
- the room is told why with `run.step { kind: "watchdog", label }`, so the chat does not show a stalled spinner with no explanation,
- when `abortRun` returns false (the run finished between the check and the abort) nothing is broadcast.

Runs owned by another orchestrator instance are never touched: each instance watches its own. A process that dies outright is still the heartbeat recovery's job (`recoverStaleRuns` in `resume.ts`).

`startRunWatchdog` returns a stop function, called on shutdown (`index.ts`) and used by tests. The interval is `unref`'d so it never keeps the process alive. Options `{ intervalMs, now, list, stop, notify }` exist for tests.

## ⚠️ Trade-off

A model that thinks for more than 20 minutes with no streamed token and no tool call will be stopped. That is deliberate: silence that long is indistinguishable from a hang, and the room gets a message it can act on rather than an indefinite wait. A long tool is the escape hatch, which is why the tool limit is six times larger.

## 🧪 Tests

| Test file                     | Covers                                                                      |
| :---------------------------- | :-------------------------------------------------------------------------- |
| `src/engine/watchdog.test.ts` | Healthy turn, turn limit, tool allowance, explicit limit, stop-and-notify, silent no-op when the run is gone |

Related docs: [engine-loop](engine-loop.md) · [engine-interrupts-and-recovery](engine-interrupts-and-recovery.md) · [engine-takeover](engine-takeover.md) · [Tool system](../tools/tool-system.md)
