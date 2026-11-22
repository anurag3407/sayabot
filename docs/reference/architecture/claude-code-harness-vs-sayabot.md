# Claude Code's Harness vs Sayabot's Harness

Claude Code and Sayabot solve the same core problem — turn a language model into a reliable agent that reads a codebase, calls tools, recovers from failure, and reports honestly — but they put the control surface in different places. Claude Code's harness is mostly **prose plus tool descriptions plus permission modes plus an open extension format** (`CLAUDE.md`, skills, agents, hooks, plugins). Sayabot's harness is mostly **frozen code plus capability gating plus database-backed approvals plus execution evidence**. This page dissects both, then explains why Claude Code's arrangement feels unusually strong ("goated") and which of its mechanisms are worth copying without breaking Sayabot's multiplayer and audit guarantees.

Source files (Sayabot): `packages/core/src/harness.ts`, `apps/orchestrator/src/engine/context.ts`, `apps/orchestrator/src/engine/run.ts`, `apps/orchestrator/src/tools/index.ts`, `apps/orchestrator/src/tools/audited.ts`, `apps/orchestrator/src/engine/subagents.ts`, `apps/orchestrator/src/engine/tool-search.ts`, `apps/orchestrator/src/engine/evidence.ts`. Claude Code reference material is external; see [References](#-references).

---

## 🎯 TL;DR

1. **Claude Code's prompt is assembled, not baked.** In a captured v2.1.287 request the system prompt is three blocks: a 74-character billing header, a 62-character identity line, and one ~27,000-character block carrying policy, tone, memory rules, environment and context-management instructions. The whole block is marked `cache_control: ephemeral`.
2. **Claude Code treats tool descriptions as part of the prompt.** `TodoWrite` alone is ~2,000 tokens with four worked examples and a "when NOT to use" section; `Bash` carries a full git-commit protocol; `Grep` forbids shelling out to `grep`. The description *is* the behavioural spec.
3. **Sayabot centralizes policy in `harnessSystemPrompt()`** — identity, workflow, autonomy, tools, collaboration, communication, persona rule — and keeps tool descriptions comparatively terse, because the rules live in the system block instead.
4. **Claude Code spends context deliberately**: skills are progressive disclosure (metadata always, body on invoke, references on demand), subagents protect the main window, deferred tools load by search, and old messages compact automatically.
5. **Sayabot also does progressive disclosure**, but with different primitives: a sorted skills index in system block 2, `search_skills`/`load_skill`, BM25 `find_tools` above 40 specs, lean turns for small-context providers, and a three-breakpoint cache layout.
6. **Safety is inverted.** Claude Code asks the human before risky actions and offers plan mode; Sayabot tells the agent *not* to ask in chat and instead call the tool so the approval card appears, then persists the decision in `tool_calls`.
7. **Verification is inverted too.** Claude Code relies on prompt-level "verify before claiming done", hooks, and browser checks; Sayabot computes machine evidence (`RunEvidence`, `verify_workspace` exit codes) and refuses to treat prose as proof.
8. **The "harness" plugin is not Claude Code source.** It is `revfactory/harness`, listed in Anthropic's community plugin marketplace, and it is a *meta-skill*: it generates `.claude/agents/*.md`, `.claude/skills/*/SKILL.md`, orchestration and a `CLAUDE.md` pointer for a project.

---

## 🧭 What "harness" means in each system

A harness is everything between the model and the work: the prompt it wakes up with, the tools it can call, the permissions around those tools, how context is compacted, how subagents are briefed, and how the result is verified.

| Layer | Claude Code | Sayabot |
| :---- | :---------- | :------ |
| Prompt ownership | Anthropic ships a static core; the project adds `CLAUDE.md`, skills, output styles, memory | Sayabot ships a frozen harness; the bot owner adds only a `Persona`; capability blocks are added by code |
| Tool ownership | Built-in tools + MCP + skills + plugins + hooks | Built-in `ToolSpec`s + MCP + connectors, gated by 14 capability flags |
| Safety | Permission modes, approval prompts, sandbox, hooks, plan mode | `dangerous` predicate, `tool_calls` audit row, approval card with 5-minute timeout, secret broker, egress proxy |
| Context | Auto-compaction, skills, subagents, deferred tools, memory files | Compaction ladder, lean mode, BM25 tool search, subagents, DB memory |
| Extension unit | Markdown file (skill/agent/command), JSON (MCP/plugin) | DB row (skill/MCP/connector) or code (`ToolSpec`) |
| Unit of work | Session / conversation | Room turn, serialized by a PostgreSQL advisory lock |

The rest of this page takes each layer apart.

---

## 🏭 The `harness` skill: a factory for project harnesses

### Where it actually lives

`anthropics/claude-code` is the public companion repo: plugins, plugin-dev skills, mods, examples, devcontainer and automation. It does **not** contain the product source (the CLI is a closed npm package) and it does not contain a `harness` skill. The plugin is authored by `revfactory`, distributed through `anthropics/claude-plugins-community`, and installable with:

```bash
claude plugin marketplace add anthropics/claude-plugins-community
claude plugin install harness@claude-community --scope project
```

The `.claude-plugin/marketplace.json` in `claude-code` lists Anthropic's own plugins (`agent-sdk-dev`, `code-review`, `feature-dev`, `plugin-dev`, `security-guidance`, …) and does not list `harness`. Treat the skill as an ecosystem artifact that runs *on* Claude Code, not as an Anthropic-shipped component. That distinction matters when judging the design: it is a very good example of what the Claude Code extension surface makes possible.

### What the skill does

The SKILL.md description is trigger-dense (Korean): build/design a harness, construct an agent team, restructure or extend an existing harness, audit/inspect/synchronize agents and skills. The body is an eight-phase procedure:

| Phase | Output |
| :---- | :----- |
| 0. Audit | Reads `.claude/agents/`, `.claude/skills/`, `CLAUDE.md`; classifies the job as new / extend / maintain; detects v1 artifacts (`TeamCreate`, `TeamDelete`, experimental flags) |
| 1. Domain analysis | Task types, control-flow shape (enumerable list? verify-and-fix loop? negotiation?), stack, existing overlap |
| 2. Execution mode + team design | Picks workflow / persistent agents / subagents, then one of six team patterns |
| 3. Agent definitions | `.claude/agents/{name}.md` with `name`, `description`, optional `tools`, `model`, and a body covering role, principles, I/O, errors, collaboration |
| 4. Skill generation | `.claude/skills/{name}/SKILL.md` plus optional `scripts/`, `references/`, `assets/` |
| 5. Orchestration | An orchestrator skill binds agents and skills into a flow; `CLAUDE.md` gets only a trigger rule and change history |
| 6. Verification | File/reference checks, mode-specific checks, with-skill vs baseline A/B, trigger-boundary tests, dry run |
| 7. Maintenance | Incremental changes, change log, and `/harness:evolve` for repeated feedback |

### The three execution modes

The skill chooses by **shape of control flow**, not team size:

1. **Workflow orchestration** — deterministic scripts built from `agent()`, `pipeline()`, `parallel()`, `phase()`, with schemas and budgets. Best when the list of items, verification loop or repetition count can be expressed in code. Requires explicit user opt-in.
2. **Persistent agent collaboration** — named agents (`Agent(name:)`) plus `SendMessage` and shared task lists (`TaskCreate`/`TaskUpdate`). Best when specialists must keep context and negotiate.
3. **Sub-agent delegation** — one-shot `Agent` calls, background by default, parallel in a single message. Best when only the result matters.

Mixed mode is allowed per phase and must be labelled in the orchestrator.

### The six team patterns and five quality patterns

Team shapes: **pipeline**, **fan-out/fan-in**, **expert pool**, **producer-reviewer**, **supervisor**, **hierarchical delegation** (max two levels). Accuracy patterns:

- **Adversarial verification** — N verifiers per finding; only a majority `confirmed` passes; `refuted` and `uncertain` do not.
- **Judge panel** — produce N candidates, score in parallel, synthesize from the best.
- **Loop-until-dry** — keep searching until K consecutive rounds find nothing new.
- **Multi-modal sweep** — parallel investigation by container, content, entity, time.
- **Completeness critic** — a final agent whose only job is finding what is missing.

This is the most interesting part of the skill: it encodes *quality control as topology*, not as an exhortation to "be careful".

### Model policy

The skill explicitly forbids blanket `model: "opus"` pins and selects by task character: `fable` for long-horizon autonomous planning, `opus` for bounded deep reasoning/design/code generation/cross-verification, `sonnet` for procedural or high-volume work. A cheap model is the default when judgement is ambiguous. The reasoning is recorded as a comment in the agent definition or orchestrator.

### Progressive disclosure, spelled out

| Information | Loaded | Budget |
| :---------- | :----- | :----- |
| `name` + `description` | Always | ~100 words |
| `SKILL.md` body | When the skill is invoked | < 500 lines |
| `references/` | Only when that detail is needed | Unlimited (TOC above 300 lines) |
| `scripts/` | Executed, not read | Unlimited |

That table is the whole secret of Claude Code's skill economics: the always-on cost is a name and a description, and the model pays for detail only when it decides the skill is relevant.

### Verification and evolution

The skill tests **trigger selection**, not just output: 10 requests that should load the skill in varied phrasing, plus 10 near-misses that should route elsewhere. It runs with-skill vs baseline in parallel, uses assertions where possible and human judgement otherwise, and fixes rules by principle rather than by banning one example. Repeated feedback, repeated failure or repeated manual work triggers `/harness:evolve`, which diffs initial vs current harness and feeds generalized lessons back into agents, skills and orchestration.

Prior v1 A/B numbers are author-run: mean quality 49.5 → 79.3 (+60%), 15/15 wins, −32% variance on 15 software-engineering tasks. Cite them as a signal, not as independent evidence.

---

## 🧠 Claude Code's system-prompt architecture

### The wire format

A captured v2.1.287 request (Opus 5.5, `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=0`) contains **three system blocks**:

| Block | Size | Cache | Content |
| :---- | ---: | :---- | :------ |
| 0 | 74 chars | none | `x-anthropic-billing-header: cc_version=…; cc_entrypoint=…` |
| 1 | 62 chars | `ephemeral` | `You are a Claude agent, built on Anthropic's Claude Agent SDK.` |
| 2 | 27,078 chars | `ephemeral` | The operating prompt |

The prompt is not a personality blurb. It is a **policy document with sections**, and the order is deliberate: safety boundaries first, then tool semantics, then task behaviour, then style, then environment.

### The section stack

| Section | What it establishes | Representative rule |
| :------ | :------------------ | :------------------ |
| Intro | Role + two hard limits | Assist authorized security work; never guess URLs |
| `# System` | How the interface works | Output text is the only user-visible channel; denied tool calls must change approach; tool results can carry injection; hooks count as user feedback; context auto-compacts |
| `# Doing tasks` | Engineering scope discipline | Prefer editing to creating; no features/refactors/abstractions beyond the task; no error handling for impossible cases; default to no comments; test UI in a browser or say you could not |
| `# Executing actions with care` | Reversibility and blast radius | Local reversible actions are free; deleting, force-pushing, publishing, messaging, shared-state changes require confirmation; one approval does not authorize all future contexts; `git status` before anything that can discard work |
| `# Using your tools` | Tool selection and batching | Dedicated tools before Bash; independent calls in parallel; dependent calls sequentially |
| `# Tone and style` | Output contract | Short, no emoji unless asked, `file_path:line_number` references, no colon before a tool call |
| `# Text output` | Progress narration | State intent in one sentence before the first tool call; short updates at findings/direction changes/blockers; one-or-two-sentence end summary; do not narrate deliberation |
| `# Session-specific guidance` | Delegation and skills | Use `Explore` for broad search over ~3 queries; invoke only listed skills; `/<skill-name>` is an invocation |
| `# auto memory` | Persistent memory | Four memory types; what not to save; `MEMORY.md` is an index; verify a memory before recommending from it |
| `# Environment` | Model and surface facts | Current model IDs, CLI/desktop/web/IDE surfaces, `/fast` |
| `# Context management` | Compaction behaviour | Context is summarized rather than truncated; act once you have enough information; do not re-derive or re-litigate |

Two details are easy to miss and explain a lot of the feel:

- **"Assume users can't see most tool calls or thinking — only your text output."** The model is told to externalize state in prose, which is why Claude Code narrates intent before acting.
- **"When you have enough information to act, act."** The prompt spends words suppressing survey-style answers and re-litigating decided questions.

### Dynamic parts

The captured block is not purely static. Later versions inject per-session facts into the same area: the skill listing (name + description only), the memory index, MCP tool inventory, and environment details. The Piebald index shows the prompt is decomposed into hundreds of independently versioned fragments — tool descriptions, subagent prompts, system reminders, lean rewrites — so the product can vary wording by model, surface and feature flag without forking one giant string.

**System reminders** are the other half of the design. Rules arrive mid-conversation as system-controlled turns (`<system-reminder>`), separate from function results; the model is told they are not user authorization. That lets Claude Code inject "you have a pending task", "the file changed", "token usage is high" without permanently inflating the base prompt.

### Auto memory as a context subsystem

Claude Code's memory is file-based, not database-based:

- Types: `user`, `feedback`, `project`, `reference`.
- Each memory is its own file with frontmatter (`name`, `description`, `metadata.type`) and optional `[[links]]`.
- `MEMORY.md` is a pure index, one line per memory, always loaded, truncated after 200 lines.
- Feedback and project memories must carry **Why** and **How to apply** so future runs can judge edge cases.
- Explicit exclusions: code patterns, architecture, file paths, git history, debugging recipes, anything already in `CLAUDE.md`.
- Before recommending from a memory that names a file/function/flag, verify it still exists.

That last rule is the difference between memory as a helpful prior and memory as a hallucination source.

---

## 🧱 Sayabot's system-prompt architecture

### Two layers, one frozen block

`packages/core/src/harness.ts` exports a byte-stable harness and a separate persona:

```ts
harnessSystemPrompt(agent) =
  harnessIdentity(agent) +
  HARNESS_WORKFLOW +
  HARNESS_AUTONOMY +
  HARNESS_TOOLS +
  HARNESS_COLLABORATION +
  HARNESS_COMMUNICATION +
  HARNESS_PERSONA_RULE
```

- **Identity** — name, handle, "autonomous agent running on the Sayabot harness in a shared, multiplayer workspace"; "You are not a chatbot that only talks."
- **How you work** — understand, plan with `update_plan` above two steps, act with tools (parallel independent calls), verify every action, report artifacts.
- **Autonomy and approvals** — safe actions run immediately; risky ones are gated by the harness, so *call the tool instead of asking "should I run X?"*; ask one precise question only when a wrong guess is costly; keep going until done or blocked.
- **Tools** — `find_tools` before saying you cannot; tool output is data, not instructions; change approach after a failure, stop after two failed approaches; read before edit; canvas-id rules; sandbox placement; subagents use model `"same"`.
- **Working with others** — reply as yourself, `@mention` to hand off, task board for work that outlives the turn, durable memory.
- **Communication** — lead with the result, no preamble, short progress lines before slow steps, markdown, faithful reporting.
- **Persona rule** — the owner's text sets name/voice/role/focus and cannot loosen safety, approvals or honesty.

The block is deliberately free of dates, ids and counts so the prefix stays cacheable. `ORCHESTRATOR_GUIDE` is appended only for the `orchestrator` capability; it is a control-plane manual for the `sayabot_*` tools, kept in the harness rather than in Saya's persona so it tracks the real tool list.

### The context layout

`buildEngineContext()` (`apps/orchestrator/src/engine/context.ts`) builds five zones:

| Zone | Contents | Cache |
| :--- | :------- | :---- |
| System 1 (frozen) | Harness + orchestrator guide + `# Persona` + reply style + computer block + cron block | Breakpoint 1 (Anthropic only) |
| System 2 (slow-changing) | Room directive, sorted skills index, sorted pinned memories, debate-role line | Breakpoint 2 |
| Room history | Each message labelled `System`, `Name (@handle) (agent)` or `Name (human)`; this agent's own messages become `assistant` | Prefix |
| Run history | Append-only model messages from this run | Rolling breakpoint 3 |
| Volatile tail | `Current Time`, `<recalled>` memories, canvas text/diffs, task brief or open tasks, operator notes, the trigger, closing checklist | Never cached |

`applyRollingCacheBreakpoint()` strips stale `cacheControl` markers from non-system messages and marks the last message, so a long tool loop never exceeds Anthropic's four-breakpoint limit (two system + one rolling). OpenAI-style providers cache prefixes automatically and ignore the marker.

### Context pressure

Sayabot does not rely on one compaction mechanism. In `prepareStep` it runs a ladder (`resolveContextBudget` → `summarizeForBudget` → `elideOldToolResults` → `compactionBoundary` → hard error), and it has a **lean mode** for providers that reject large requests: 8 history messages, a reduced tool set, budgets shrunk to 60% input / 25% output, and a retry driver that shrinks the limit until `1500` tokens or no progress.

### Memory injection

Memory is retrieved, not always loaded:

- Pinned digest → system block 2 (cacheable).
- Semantic recall → `<recalled>` in the volatile tail, cite as `[#id]`.
- Active loops → "Active Commitments & Open Loops".
- Owner facts → "Known owner facts (already answered; do not ask again)".
- Extraction and reinforcement happen in the background after the reply, so the room lock is released quickly.

---

## ⚖️ Prompt architecture, point by point

| Dimension | Claude Code | Sayabot | Consequence |
| :-------- | :---------- | :------ | :---------- |
| Ownership | Anthropic core + project `CLAUDE.md`/skills/memory | Sayabot harness + owner persona + capability blocks | Claude Code adapts per repo; Sayabot guarantees identical operating rules across bots |
| Size | ~27k chars base, plus tool descriptions and reminders | A few thousand chars, plus per-room context | Claude Code buys behaviour with tokens; Sayabot buys consistency |
| Policy location | Mostly prose, some tool descriptions | Mostly one frozen module | Sayabot is easier to audit; Claude Code is easier to tune per task |
| Dynamic injection | Skills listing, memory index, MCP, environment, reminders | Room directive, skills index, pinned memory, recall, tasks, time | Both avoid a monolith, at different granularities |
| Caching | 3 blocks, 2 ephemeral; auto-compaction | 2 system breakpoints + rolling; explicit breakpoint math | Both are cache-aware; Sayabot is more explicit about provider limits |
| Persona | Output styles / `CLAUDE.md` / custom agents | First-class `Persona` section that cannot loosen rules | Sayabot makes delegation of identity safe |
| Memory | Files + `MEMORY.md` index, typed, verify-before-use | Postgres memory, scopes, recall, loops, owner facts | Sayabot has richer retrieval; Claude Code has cleaner provenance rules |
| Context failure | Summarize and continue | Summarize → elide → drop chunks → hard error → lean retry | Sayabot degrades more explicitly; Claude Code hides more |
| Honesty | "Never claim work you did not verify"; "trust but verify" subagents | Faithful reporting + machine evidence gate | Sayabot enforces; Claude Code persuades |

The deepest difference: **Claude Code's prompt is a behaviour specification for a generalist working alone; Sayabot's prompt is an operating contract for a teammate working in a shared room.** That is why Sayabot spends lines on approvals, mentions, task boards and not speaking for others, while Claude Code spends lines on reversibility, scope discipline and output style.

---

## 🛠️ Claude Code's tool system

### Inventory shape

The built-ins cluster into families:

- **Files** — `Read`, `Write`, `Edit`, `Glob`, `Grep`, `NotebookEdit`, `LSP`.
- **Execution** — `Bash` (and `PowerShell` on Windows), background shell output/kill.
- **Planning** — `TodoWrite`, `TaskCreate`/`TaskList`/`TaskUpdate`/`TaskGet`, `EnterPlanMode`/`ExitPlanMode`.
- **Delegation** — `Agent` (subagents), `SendMessage`, `ListAgents`, `Task*` for agent teams, `Workflow`.
- **Knowledge** — `Skill`, `SearchSkills`, `ToolSearch`, `WebFetch`, `WebSearch`, `ReadMcpResource*`, `ListMcpResources`, `RefreshMcpTools`.
- **Surface** — `AskUserQuestion`, computer/browser tools, `Artifact`, `SendUserFile`, `SendUserMessage`, `ScheduleWakeup`, `CronCreate`, `RemoteTrigger`.
- **Safety/observability** — permission UI integration, hooks, `ReportFindings`, `SendFeedback`.

The exact set varies by surface, plan, feature flag and model. That variability is the point: tools are composed per session.

### The description is the policy

Claude Code writes tool descriptions like mini-prompts. Four examples:

**`Read`** — absolute paths only; reads up to a line cap; images, PDFs (page ranges required above 10 pages, max 20 per request) and Jupyter notebooks; cannot read directories; always use it for user-supplied screenshots; an empty file returns a system reminder instead of contents.

**`Edit`** — exact string replacement; a read-before-edit note; strip the line-number prefix before matching; preserve exact indentation; `replace_all` for renames; prefer editing existing files.

**`Write`** — overwrites; read-before-write; *prefer Edit because it only sends the diff*; never create `*.md` or README unless asked.

**`Grep`** — "ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command." Full regex, glob/type filters, `content` / `files_with_matches` / `count` output, `multiline` for cross-line patterns, and a pointer to `Agent` for open-ended multi-round search.

That last sentence is the pattern: the description doesn't just document parameters, it **routes** the model — away from shell, toward the dedicated tool, then toward a subagent when the search is exploratory.

**`Bash`** is the extreme case. Its description and fragments encode:

- Prefer dedicated tools for read/edit/write/find/grep.
- Default to the sandbox; bypass only when the user asks or evidence shows a sandbox restriction; treat each command individually; retry a blocked command without the sandbox when appropriate.
- Quote paths with spaces; use absolute paths and avoid `cd`; verify the parent directory before creating files.
- Background execution semantics, timeout guidance, and "don't poll / don't sleep" rules.
- A full git protocol: never update config; never destructive git unless explicitly asked; never skip hooks; create new commits rather than amend (a failed pre-commit means the commit did not happen); stage specific files, not `git add -A`; only commit when asked; run `git status`/`git diff`/`git log` in parallel; write the message via HEREDOC; no interactive flags; never push unasked.

This is why Claude Code's git behaviour is so consistent: the procedure is in the tool contract, not in the user's request.

**`TodoWrite`** is the other extreme — ~2,000 tokens, four positive examples, four negative examples, task states, the `content`/`activeForm` pair, "exactly ONE in_progress", "never mark completed if tests are failing", "when in doubt, use this tool." It is over-specified on purpose, because todo drift is a common agent failure.

### Delegation

`Agent` usage notes define the contract:

- Always include a short description of what the agent will do.
- The subagent's final report is **not visible to the user** — the main agent must summarize it.
- "Trust but verify": a summary describes intent, not necessarily what happened; check actual changes.
- Background by default; you are notified on completion; do **not** sleep, poll or predict the result; never fabricate a result.
- Foreground only when the very next action depends on it and nothing else could usefully happen.
- A new `Agent` call starts fresh with no memory; the prompt must be self-contained. `subagent_type: "fork"` inherits full context.
- Parallelism means multiple tool calls in **one message**, not sequential turns.
- `isolation: "worktree"` gives a clean worktree, cleaned up if unchanged; there is also a remote isolation mode.
- Model, reasoning effort and tool access are set in the agent definition; a call-level `model` can override.

`EnterPlanMode` is the other autonomy valve: proactive for new features, multiple valid approaches, architectural decisions, multi-file changes, unclear requirements and preference-sensitive work; skipped for typos and single-function additions; requires user consent; if unsure, plan.

`Skill` closes the loop: invoke by exact listed name, `plugin:skill` for plugin skills, `apps/web:deploy` for directory-scoped skills (most specific wins), and if a `<skill>` block is already present, follow it instead of invoking again. Some skills run in a subagent and return only a name; the result arrives later as a task notification.

### Permission and safety model

Claude Code's safety is **interactive and contextual**:

- Tools run in a user-selected permission mode; anything not auto-allowed prompts the human.
- A denial is information: do not repeat the exact call; adjust.
- Hooks are shell commands on lifecycle events and their feedback counts as user feedback.
- Risky actions are enumerated by blast radius, not by tool name: delete, force-push, reset, amend published commits, dependency downgrades, CI changes, pushes/PRs/messages, shared infrastructure, uploads to third-party tools.
- Plan mode separates "design and get sign-off" from "write code".
- Sandbox is the default for Bash, with an explicit escape hatch and evidence-based rules for when to use it.

There is no database of approvals and no cross-session grant. Authorization is scoped to the conversation and the specific action. That is simpler than Sayabot and weaker for unattended operation — but it is very good at preventing one bad action.

### Context tools

- **Skills** are progressive disclosure.
- **Subagents** isolate noisy exploration.
- **`ToolSearch`** loads schemas for deferred tools announced by name, so a large MCP catalog does not sit in every request.
- **`Workflow`** runs deterministic multi-agent scripts in the background, with explicit opt-in, literal metadata and structured outputs.
- **Compaction** means the conversation is not bounded by the context window.
- **`CLAUDE.md`** is the project's durable instruction file; the harness skill deliberately keeps it to a trigger rule plus change history, pushing detail into skills.

---

## 🧰 Sayabot's tool system

### The contract

Every tool is a `ToolSpec`:

```ts
interface ToolSpec {
  name: string
  description: string
  schema: z.ZodType
  dangerous: boolean | ((args: Record<string, unknown>) => boolean)
  execute: (args: any, signal?: AbortSignal, ctx?: ToolContext) => Promise<unknown>
}
```

`dangerous` can be dynamic: `github_bridge` is dangerous only for `commit_file`; `verify_workspace` only when a check command looks destructive; `computer_shell` only when `isDestructiveCommand()` matches.

### Assembly and gating

`buildTools()` assembles specs from capability flags: canvas, sandbox (only when `computer` is off), web search/fetch, document, GitHub, Postgres, tasks, computer (+ browser profile), verification/workspace (computer + v2), secrets, memory, cron, orchestrator (`sayabot_*`), voice, data analysis, meetings, phone, planning/skills, subagents, and MCP.

MCP servers are connected per org/room; a tool whose name collides with a built-in is skipped with a warning; server `destructiveHint` can only add an approval gate, never remove one; offline desktop apps are skipped so a turn does not stall.

### The audit wrapper

`toAuditedTools()` is the invariant: every call, built-in or MCP, becomes a `tool_calls` row and flows through the same pipeline — abort check, danger evaluation, insert `pending_approval` or `running`, broadcast `tool.started`, fan out push/APNs/inbound-chat notices for dangerous calls, wait up to five minutes for a human, then execute with redaction and bounded output.

This is why Sayabot can run unattended: the approval is a durable row and a notification, not a chat question. It is also why the harness prompt tells agents **not** to ask "should I run X?" — the tool itself asks.

### Discovery, delegation, verification

- **`find_tools`** — a pure BM25 index over `name + description`. Above 40 specs, only 33 core tools plus `find_tools` are active; a hit activates matches for subsequent steps. Below 40, everything is active.
- **`spawn_subagent`** — roles `researcher`/`planner`/`worker`/`critic`; `tools: read_only | same`; `model: cheap | same`; max 10 steps default (cap 30); max 4 concurrent and 12 total children; no recursive spawning; foreground children inherit the parent abort; workers can be confined to a worktree (with the explicit caveat that shared tools are not a sandbox boundary).
- **Verification** — `verify_workspace` runs 1–6 test/lint/typecheck/build commands, stops at the first failure, folds output, and records exit codes. `RunEvidence` bumps a revision on every mutation and flips to `pending`; only a passing verify at the current revision becomes `passed`. Modes: `off`, `self` (default), `critic` (cheap model, read-only tools, ≤ 6 steps, ≤ 2 cycles, JSON verdict).
- **Memory tools** — `remember`, `recall`, `open_loop`, `reflect`, `graph_walk`, `forget`.
- **Secrets** — `use_secret` resolves placeholders at egress; the model never sees plaintext.

### What Sayabot does not have

No plan-mode primitive (planning is `update_plan` inside a turn), no interactive permission-mode UI inside the prompt (approvals are out-of-band), no first-class `CLAUDE.md` equivalent (persona + memory + room directive play that role), and no project-level generated agent/skill factory.

---

## 🔍 Tool systems, side by side

| Concern | Claude Code | Sayabot |
| :------ | :---------- | :------ |
| Tool definition | JSON schema + a long natural-language contract | Zod schema + a short description; policy in the harness prompt |
| Read | `Read` with absolute path, line cap, images/PDF/notebooks | `fs_read` on the computer; `fs_glob`/`fs_grep`; code intelligence tools |
| Edit | Exact-string `Edit` with read-before-edit and `replace_all` | `fs_edit` with hashes/guarded edits; `fs_patch`; `fs_write` |
| Search | `Grep` (ripgrep) and `Glob`, explicitly preferred over shell | `fs_grep`/`fs_glob`, `code_outline`/`code_definition`/`code_references` |
| Shell | `Bash`, sandbox by default, background jobs, git protocol | `computer_shell`, `terminal_exec`, `code_sandbox`, destructive-command classifier |
| Planning | `TodoWrite` + `Task*` + `EnterPlanMode` | `update_plan` + task-board tools |
| Delegation | `Agent` (fresh/fork), background, worktree, `SendMessage` teams | `spawn_subagent` (4 roles, read-only, worktree, limits), `subagent_status` |
| Skills | `Skill` + `SearchSkills`, progressive disclosure, plugin scoping | `search_skills`/`load_skill`/`inspect_skill`/`install_skill`/`propose_skill`/`publish_skill` |
| Tool discovery | `ToolSearch` for deferred schemas | `find_tools` BM25 above 40 specs |
| Memory | Files + `MEMORY.md` index | Postgres + recall/loops/facts |
| Permissions | Permission modes; human prompt per risky call | `dangerous` predicate; DB row; approval card; 5-min timeout; standing grants |
| Verification | Prompt discipline + hooks + browser checks | `RunEvidence` + `verify_workspace` + critic |
| Extensions | MCP, hooks, plugins, agents, skills, commands | MCP, connectors, storage, DB skills, capability flags |
| Failure model | Adjust after denial; compaction; background notifications | Pass loop, step budget, lean mode, warnings, run recovery |

Two observations:

1. **Claude Code pays for precision at the point of use.** Every tool carries its own rules, so the model does not need to remember a global policy table. The cost is prompt size and duplication.
2. **Sayabot pays for consistency at the point of assembly.** One harness, one audit wrapper, one approval path, one evidence model. The cost is that a tool's local quirks must be expressed in the tool or the harness, and the model must hold more global rules.

Neither is strictly better; they optimize different failure modes. Claude Code optimizes for **one developer, one repo, high trust in the model's judgement**. Sayabot optimizes for **many humans and agents, unattended runs, and auditability**.

---

## 🐐 Why Claude Code's harness feels "goated"

Ten mechanisms, in rough order of impact:

1. **The prompt is a policy document, not a persona.** It states how the interface works, how to act, what is risky, how to report. The model is never guessing about the social contract.
2. **Tool descriptions carry behaviour.** The git protocol, grep routing, edit-matching rules, todo discipline and subagent etiquette are all attached to the tool that needs them. This is the single biggest difference from a terse-schema harness.
3. **Progressive disclosure is structural.** Skills cost a name and a description until invoked; references cost nothing until read; scripts run without being read. Context is spent like money.
4. **Subagents are context insulation.** Exploration happens in a child with its own window; the parent gets a summary. The prompt is explicit that the child's report is invisible to the user and must be verified, which prevents both context bloat and blind trust.
5. **Autonomy has valves.** Plan mode for design sign-off; permission prompts for blast radius; background agents for parallelism; compaction for long work. The agent can be bold inside a safe envelope.
6. **Denials are feedback.** "Do not re-attempt the exact same call; think about why and adjust" turns a refusal into a policy signal instead of a dead end.
7. **The extension surface is markdown-first.** A skill, agent or command is a file with frontmatter. That makes harness construction cheap, reviewable and shareable — and it is exactly what the `harness` skill exploits.
8. **Memory has provenance rules.** Typed memories, an index, Why/How-to-apply, explicit exclusions, and verify-before-recommend. This is how you get persistence without compounding stale claims.
9. **Output is designed for a human in a terminal.** One-sentence intent, updates at state changes, no deliberation narration, `file:line` references, a two-sentence ending. The harness manages attention, not just correctness.
10. **Quality patterns are codified, not aspirational.** The `harness` skill's adversarial verification, judge panels, loop-until-dry and completeness critics turn "be thorough" into a topology with pass/fail rules.

The meta-point: Claude Code's harness is **composable**. Prompt fragments, tool descriptions, skills, agents, hooks, plugins and MCP all have file formats, so the harness can be extended without forking the product. Sayabot's harness is **governable**: frozen rules, capability gates, audited calls, approvals and evidence, so it can be trusted with a shared workspace and unattended execution. "Goated" is the composability; "production-grade" is the governance.

---

## 🛡️ Where Sayabot is stronger

- **Deterministic multiplayer turns.** `withRoomLock()` serializes every turn per room on a dedicated connection. Claude Code's agent teams coordinate by messages and tasks; Sayabot's rooms cannot race.
- **Durable approvals.** A dangerous call is a `tool_calls` row plus a notification plus a five-minute wait, not a chat prompt that disappears if the tab closes.
- **Auditability.** Every call is persisted with redacted input/output; every run has `run_steps`, usage, cost, cache metrics and verification evidence.
- **Machine-checkable verification.** `RunEvidence` cannot be satisfied by prose. The critic is a separate cheap model with read-only tools and a JSON verdict. Claude Code's equivalent is prompt discipline and hooks.
- **Secret handling.** AES-256-GCM envelope encryption, `use_secret` placeholders resolved at egress, response scrubbing, SSRF-safe fetch. Claude Code deliberately keeps secrets in the environment and relies on permission prompts.
- **Provider breadth and degradation.** 17 providers, lean turns, request-limit memory, quota takeover. Claude Code is Claude-centric by design.
- **Persistent computers.** `computerd` containers/microVMs with `/home/bot` confinement, browser profiles, code intelligence, memory mirroring. Claude Code runs on the developer's machine or a sandbox, not a per-agent durable computer.
- **Persona safety.** The owner's persona is explicitly subordinate to the harness; a bot cannot be talked into loosening approvals by its own persona text.

---

## 📋 What is worth borrowing

These are analysis, not implemented changes. Each is ordered by leverage and risk.

1. **Move per-tool policy into tool descriptions.** Sayabot's harness already says "read before edit" and "change approach after failure", but the git, edit-matching, search-routing and delegation rules would land harder next to the tool. Risk: prompt duplication; mitigate by keeping the harness as the invariant layer and the description as the local contract.
2. **Add a plan-approval valve.** A `plan_mode` equivalent (propose, wait, then execute) would reduce wasted work on ambiguous multi-file tasks without weakening the approval gate. It fits naturally as a run status plus a card.
3. **Make skills trigger-tested.** Adopt the `harness` skill's 10 positive + 10 boundary requests and with-skill vs baseline A/B for Sayabot skills. This is cheap and directly improves `search_skills`/`load_skill` selection.
4. **Adopt "Why / How to apply" for feedback memories.** Sayabot stores memories well; adding the reason and the application rule would improve recall precision and critic quality.
5. **Codify quality topology in the orchestrator guide.** Adversarial verification, judge panels and loop-until-dry could be expressed as recommended `spawn_subagent` patterns, not new code.
6. **Report "what I did not verify".** Sayabot already warns on pending evidence; making that a first-class final-report field would close the last honesty gap.
7. **Keep `CLAUDE.md`-style pointers small.** If Sayabot ever adds a project instruction file, keep it to trigger + change history, as the harness skill insists, and push detail into skills.
8. **Do not copy the interactive permission model.** Sayabot's out-of-band approval is strictly better for unattended rooms; borrow the *enumerated blast-radius categories*, not the chat prompt.

---

## ⚠️ Caveats

- Claude Code is closed source. The prompt text here comes from a locally intercepted v2.1.287 request and the Piebald-AI fragment index (v2.1.328); exact wording changes between versions and surfaces. Treat specific sentences as representative, not contractual.
- The `harness` plugin is third-party (`revfactory`), distributed via Anthropic's community marketplace. It is not part of `anthropics/claude-code` and its A/B numbers are author-run.
- Claude Code's tool set varies by plan, surface, model and feature flag; the inventory above is the union, not one session.
- Sayabot behaviour is taken from the source and the reference docs at the time of writing; if the engine changes, update this page with it (AGENTS.md §9).

---

## 🔗 References

**Claude Code**

- Repository: <https://github.com/anthropics/claude-code>
- Plugins README: <https://github.com/anthropics/claude-code/blob/main/plugins/README.md>
- Marketplace manifest: <https://github.com/anthropics/claude-code/blob/main/.claude-plugin/marketplace.json>
- Plugin development skills: <https://github.com/anthropics/claude-code/tree/main/plugins/plugin-dev/skills>
- System prompt index (Piebald-AI): <https://github.com/Piebald-AI/claude-code-system-prompts>
- Captured v2.1.287 system prompt: <https://louisyeaaah.github.io/claude-code-re/prompts/system-prompt.full.txt>
- `harness` plugin: <https://github.com/revfactory/harness>
- Community marketplace: <https://github.com/anthropics/claude-plugins-community>

**Sayabot**

- [Harness and persona](../core/harness-and-persona.md)
- [Engine loop](../orchestrator/engine/engine-loop.md)
- [Engine verification](../orchestrator/engine/engine-verify.md)
- [Subagents and tool search](../orchestrator/engine/engine-subagents-and-tool-search.md)
- [Tool system](../orchestrator/tools/tool-system.md)
- [Approvals](../orchestrator/tools/approvals.md)
- [Secrets broker](../orchestrator/tools/secrets-broker.md)
- [Security model](./security-model.md)

## Related docs

- [System overview](./system-overview.md)
- [Turn lifecycle](./turn-lifecycle.md)
- [Security model](./security-model.md)
- [Monorepo and build](./monorepo-and-build.md)
