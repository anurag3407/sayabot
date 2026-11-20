# Run Trace Inspector

Every agent turn is recorded as a **run** with an ordered list of **steps** in Sayabot's own database. The Run Trace Inspector is the UI over that record: a small `InspectTraceButton` renders anywhere a message or run id exists, and clicking it opens `RunInspectorDrawer`, a right-side drawer showing the run's KPIs (duration, cost, steps, tokens), a filterable step timeline, nested subagent runs, and the raw JSON payload.

Note: despite what some older docs imply, the web inspector is **not** Langfuse-backed — it reads the `agent_runs` / `run_steps` / `run_transcripts` Postgres tables directly. Langfuse (`packages/llm/src/langfuse.ts`) is an optional, best-effort mirror the orchestrator exports to when `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` are set; it never feeds this UI.

Source files: `apps/web/src/components/trace/inspect-trace-button.tsx`, `apps/web/src/components/trace/run-inspector-drawer.tsx`, `apps/web/src/lib/actions/trace.ts`, `apps/web/src/lib/types.ts` (`RunStepKind`, `RunStepView`, `RunTraceView`)

---

## 🔘 Entry Point (`components/trace/inspect-trace-button.tsx`)

`InspectTraceButton` is a tiny client component. Props:

| Prop        | Type                               | Default     | Purpose                                                          |
| :---------- | :--------------------------------- | :---------- | :--------------------------------------------------------------- |
| `orgSlug`   | `string`                           | —           | workspace scope for the trace action                             |
| `runId`     | `string \| null`                   | —           | explicit run to inspect                                          |
| `messageId` | `string \| null`                   | —           | resolve the run from a message                                   |
| `agentName` | `string \| null`                   | —           | header fallback before the trace loads                           |
| `label`     | `string`                           | `"Inspect"` | button text                                                      |
| `className` | `string`                           | —           | extra classes                                                    |
| `variant`   | `"ghost" \| "outline" \| "danger"` | `"ghost"`   | ghost is faint mono; danger (red border) is used for failed runs |
| `size`      | `"sm" \| "xs"`                     | `"xs"`      | 24px vs 28px tall                                                |

The button (with `TraceIcon` and the title "Inspect run steps, latency, tokens & subagents") toggles local `open` state and always renders the sibling `<RunInspectorDrawer>`; the drawer returns `null` itself when closed.

Used from `components/room/message-item.tsx` and `components/room/message-actions.tsx`, so any room message can be inspected in place.

## 🪟 Inspector Drawer (`components/trace/run-inspector-drawer.tsx`)

A `role="dialog"` overlay pinned to the right edge (`max-w-2xl`, slide-in animation). State: `trace`, `loading`, `error`, step-kind `filter` (`"all" | RunStepKind`), `viewTab` (`"timeline" | "raw"`), and a transient `copied` flag.

### Loading

`useEffect` fires `getRunTraceAction({ orgSlug, runId, messageId })` when opened with either id present (`run-inspector-drawer.tsx:34-65`); an `active` flag guards against stale responses, and closing the drawer resets trace/error. Three content states: a spinner ("Loading execution trace and step telemetry…"), the error box (e.g. "Access denied to this run trace"), and "No trace found for this execution.".

### Header & KPI bar

- Title: the trace's `agentName` (falling back to the prop, then "Run Trace Inspector"), a `StatusBadge` (from `components/ui/status.tsx`) for the run status, and the run id in mono.
- **Copy JSON** button copies the full trace object to the clipboard ("Copied" for 2 s).
- Four KPI cells (`run-inspector-drawer.tsx:165-188`): **Duration** (`latencyMs`, seconds-formatted above 1 s), **Est. Cost** (`$` with 4 decimals, in accent), **Steps** (`steps.length` plus `(+N sub)` when subagent runs exist), **Tokens** (`inputTokens in / outputTokens out`).

### Filters and view tabs

Step-kind chips are only shown when count > 0: **All**, **Model**, **Tools**, **Subagents**, **Critic** (`verify`), **Compaction**. The right side switches the body between **Timeline** and **Raw JSON** (a `<pre>` of `JSON.stringify(trace, null, 2)`).

### Timeline (`StepCard`)

One collapsible card per step, matched against `trace.subagentRuns` by `step.idx` to attach a child run to a `subagent` step:

- Collapsed row: `#idx`, a colored kind badge, the step's `inputRef` (or the kind's human label), a one-line preview of the generated text (first 100 chars), and either the duration or the wall-clock start time (`clockTime` from `lib/format.ts`).
- Expanded shows:
  - **Token usage strip** when `step.usage` exists (input / output / total).
  - **Subagent block** (purple) for a nested run: "Subagent Run: @<handle> (N child steps)" with a mini list of child steps `↳ #idx <kind> <inputRef> <duration>ms`.
  - **Generated Output** (`output.text`) in a scrollable pre-wrap box (max 60 units tall).
  - **Tool Invocations** / **Tool Results** — pretty-printed JSON of `output.toolCalls` / `output.toolResults` when present.
  - **Copy Step JSON** for the individual step payload.

### Kind badge colors (`getKindBadge`, `run-inspector-drawer.tsx:481-524`)

| Kind          | Badge   | Label                     |
| :------------ | :------ | :------------------------ |
| `model`       | indigo  | AI Reasoning & Generation |
| `tool`        | blue    | Tool Execution            |
| `subagent`    | purple  | Subagent Delegation       |
| `verify`      | amber   | Critic Verification       |
| `compaction`  | emerald | Memory Compaction         |
| `recall`      | cyan    | Memory Recall             |
| `plan`        | rose    | Execution Plan Update     |
| anything else | neutral | Execution Step            |

`RunStepKind` is the closed union `"model" | "tool" | "compaction" | "recall" | "plan" | "subagent" | "verify"` (`lib/types.ts:500`).

## 🔐 Trace Action (`lib/actions/trace.ts`)

`getRunTraceAction({ orgSlug, runId?, messageId? })` is the single server action. Flow:

1. **Auth**: `supabase.auth.getUser()`; no user → "Your session expired. Sign in again."
2. **Run resolution** (`trace.ts:22-47`): use `runId` when given; otherwise look up `messages.run_id` for the `messageId`, falling back to the newest `agent_runs` row with `message_id = <id>`. Neither works → "Run not found for this message".
3. **Run row**: loads `agent_runs` with an embedded `agents (id, display_name, handle)` join and all telemetry columns (`session_id, room_id, task_id, step, role, status, finish_reason, steps, engine, parent_run_id, waiting_reason, input_tokens, output_tokens, cost_usd, ttft_ms, latency_ms, error, created_at`).
4. **Room authorization** (`trace.ts:87-90`): `getRoomAccess(orgSlug, run.room_id)` — traces are only visible to people who can read the room the run happened in; denial returns "Access denied to this run trace". (This is the security boundary; the queries themselves use the admin client.)
5. **Steps**: all `run_steps` for the run ordered by `idx`. Each row is mapped to `RunStepView` with computed `durationMs = finished_at - started_at` (clamped to ≥ 0), `output` parsed as an object and `usage` as `{ inputTokens?, outputTokens?, totalTokens?, … }`.
6. **Plan**: `run_transcripts.plan` (a JSON record) is attached as `transcriptPlan` when a transcript row exists.
7. **Subagents**: child `agent_runs` rows with `parent_run_id = resolvedRunId`, plus their steps grouped into `subagentStepsMap` keyed by run id; each child is mapped to a nested `RunTraceView`.
8. Returns `{ ok: true, trace }` where `trace` is the flat `RunTraceView` (`lib/types.ts:520-547`): identity fields, telemetry, `steps`, `subagentRuns`, and `transcriptPlan`.

Reads go through `createAdminClient()` for the run/step tables (bypassing RLS deliberately, compensated by the explicit room check) and `createSupabaseServerClient()` for the user check.

## 🔭 Where the data comes from

`agent_runs`, `run_steps`, and `run_transcripts` are written by the orchestrator's Agent Loop V2 during turn execution — one run per model call chain, one step row per model/tool/subagent/critic/compaction/recall/plan event. See the orchestrator engine docs for the writer side, and the DB schema docs for the tables. The Langfuse mirror (`recordStepToLangfuse` in `apps/orchestrator/src/engine/run.ts:671,840`, flushed with `flushLangfuse()` at run end) duplicates step telemetry to an external Langfuse instance **when configured**; the inspector never queries Langfuse.

## Related docs

- [Room chat UI](./room-chat-ui.md) — the messages that carry the Inspect button
- [Tasks / Inbox / Meetings UI](./tasks-inbox-meetings-ui.md) — task runs surfaced alongside traces
- [Analytics / Usage UI](./analytics-usage-ui.md) — aggregated usage from the same run telemetry
- [App overview](./app-overview.md) — workspace shell and access checks
- ../../architecture/turn-lifecycle.md — how runs and steps are produced
- ../../database/schema-engine-tools-ops.md — `agent_runs`, `run_steps`, `run_transcripts` tables
- ../../../tools-and-sandboxes.md — what a `tool` step executes
