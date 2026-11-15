# Memory Tools — the Agent's Cognitive Toolset

The `memory` capability registers six agent-facing tools built by `memoryTools()`: `remember`, `recall`, `open_loop`, `reflect`, `graph_walk` and `forget` (the exact list is asserted in `memory.test.ts:820-825`). All six are `dangerous: false` except `forget`, which becomes dangerous dynamically when `hard_delete` is requested, so a permanent erase passes through the human approval gate while ordinary withdrawal does not. Every tool closes over one `MemoryAccessContext` (`{ orgId, agentId, roomId }`) fixed at build time, so all reads and writes are scoped to the room the turn runs in.

Source files: `apps/orchestrator/src/memory/tools.ts`

---

## 📦 Registration

`memoryTools(args: MemoryToolsArgs)` (`tools.ts:6-14`) takes `{ orgId, agentId, roomId }`, resolves the `MemoryService` singleton, and returns six `ToolSpec` objects. They are appended in `buildTools()` when `caps.memory` is true (`apps/orchestrator/src/tools/index.ts:382-388`). The capability defaults to `true` (`packages/core/src/capabilities.ts:31`). The shared access context is also the source of the standard not-found message (`tools.ts:12`):

```typescript
const NOT_FOUND = "Memory not found, or not one you can change from this room."
```

Because `MemoryService.loadAccessible` treats invisible ids as missing, every id-taking tool below returns that same message for another agent's private memory or another room's shared memory — it never leaks that the id exists.

---

## 📝 `remember` (`tools.ts:19-109`)

Saves or updates a durable memory. Title/body are redacted and clamped by the service (200/4096 chars). Saving again with the same title in the same scope bucket updates the memory in place (see [./overview.md](./overview.md)).

| Parameter | Zod schema | Default | Notes |
| :--- | :--- | :--- | :--- |
| `title` | `z.string().min(1).max(200)` | — | required |
| `body` | `z.string().min(1).max(4096)` | — | required |
| `scope` | `z.enum(["agent", "room", "org"])` | `"agent"` | `agent` = private in every room, `room` = shared in this room, `org` = whole workspace |
| `kind` | `z.enum(["fact", "preference", "decision", "procedure", "episode"])` | `"fact"` | |
| `epistemic_status` | `z.enum(["verified", "belief", "hypothesis"])` | `"belief"` | described as verified (checked against evidence), belief (working assumption), hypothesis (unconfirmed) |
| `confidence` | `z.number().min(0).max(1)` | `0.85` | |
| `emotional_salience` | `z.number().min(0).max(1)` | `0.5` | "Importance/surprise factor to resist Ebbinghaus forgetting decay" |
| `perspective` | `z.enum(["first_person", "third_person"])` | `"first_person"` | |
| `evidence_refs` | `z.array(z.string())` | optional | URIs/filepaths supporting the belief |
| `supersedes_memory_id` | `z.string().uuid()` | optional | older memory this one supersedes |
| `tags` | `z.array(z.string())` | optional | |
| `pinned` | `z.boolean()` | optional | |

`dangerous: false`. Execution maps snake_case tool args onto `service.write()` with `createdByAgentId: agentId`; the agent/room binding follows the scope (`agentId` only for `agent`, `roomId` only for `room`, `tools.ts:73-89`). When `supersedes_memory_id` is given, `service.supersedeBelief(oldId, newId, access)` marks the old memory `superseded`, points its `supersededBy` at the new row, and records a `supersedes` edge in `memory_links` — the check runs after the write, and only a memory the caller may change can be superseded. Returns `{ ok: true, id, title, scope, epistemic_status, superseded? }` where `superseded` appears only when a supersession was attempted.

---

## 🔎 `recall` (`tools.ts:111-189`)

Hybrid search over the caller's visible scopes plus owner facts. This is the *explicit* recall: unlike the automatic pre-turn recall (`engine/run.ts:383-395`), it passes `reinforce: true` and `minRelevance: 0.1`, so using it counts as a memory use and slows decay on what is found.

| Parameter | Zod schema | Default | Notes |
| :--- | :--- | :--- | :--- |
| `query` | `z.string().min(1)` | — | required |
| `scope` | `z.enum(["agent", "room", "org"])` | optional | restricts the search bucket |
| `epistemic_filter` | `z.array(z.enum(["verified", "belief", "hypothesis", "superseded", "withdrawn"]))` | optional | default active set: verified, belief, hypothesis |
| `min_salience` | `z.number().min(0).max(1)` | optional | minimum emotional salience |
| `include_links` | `z.boolean()` | `true` | include knowledge-graph wikilinks |
| `limit` | `z.number().int().positive().max(20)` | `8` | |

`dangerous: false`. The recall and the owner-fact lookup run concurrently (`Promise.all`, `tools.ts:145-164`); owner facts are only fetched when no explicit `scope` was requested, and their failure degrades to an empty list. Each returned memory reports `scope` as `"private"` when it is agent-scoped, plus `title`, `body`, `kind`, `epistemic_status`, `confidence`, `emotional_salience`, `retention`, `relevance`, `score` and `links`. The response adds `owner_facts` when any matched, and a `hint` suggesting broader keywords when nothing matched at all. The tool description tells the agent to cite results as `[#id]`; cited ids are picked up post-turn by `citedMemoryIds` and reinforced (`engine/run.ts:327-330`).

A representative response (`tools.ts:166-187`):

```json
{
  "query": "deploy target",
  "count": 1,
  "memories": [{
    "id": "3f1c…", "scope": "private", "title": "Deploy target",
    "body": "Production deploys go to Fly.io.", "kind": "decision",
    "epistemic_status": "belief", "confidence": 0.85, "emotional_salience": 0.5,
    "retention": 0.9283, "relevance": 0.7354, "score": 0.6112, "links": []
  }],
  "owner_facts": [{ "key": "deploy_pref", "label": "Deploy preference",
                    "value": "Fly.io", "scope": "workspace" }]
}
```

`owner_facts` entries carry `scope: "this_room" | "workspace"` depending on whether the fact row was room-bound (`OwnerFactView`, `service.ts:97-102`), and are capped at 5 here regardless of the pre-turn summary's limit.

---

## 🔁 `open_loop` (`tools.ts:191-268`)

Tracks commitments, promises and blockers across turns. One tool, four actions.

| Parameter | Zod schema | Notes |
| :--- | :--- | :--- |
| `action` | `z.enum(["create", "update", "resolve", "list"])` | required |
| `id` | `z.string().uuid()` | optional; required for `update`/`resolve` |
| `description` | `z.string().min(1).max(2048)` | optional; required for `create` |
| `due_in_hours` | `z.number().positive()` | optional; converted to `dueAt` as `Date.now() + hours * 3600_000` |
| `status` | `z.enum(["open", "in_progress", "blocked", "resolved", "dropped"])` | optional (`update`) |
| `blocker_reason` | `z.string()` | optional (`update`) |
| `resolution` | `z.string()` | optional (`update`/`resolve`) |

`dangerous: false`. Behaviour per action:

- **create** — `service.createOpenLoop({ orgId, agentId, roomId, description, dueAt })`; loops always belong to the calling agent and carry the current room. Returns `{ ok: true, loop }`.
- **update** — `service.updateOpenLoop(...)`; the update is scoped by `id + orgId + agentId`, so a loop id from another agent is simply not found. `due_in_hours` recomputes `dueAt`. Returns `{ ok: true, loop }` or `{ ok: false, error: "Open loop not found." }`.
- **resolve** — `service.resolveOpenLoop(id, orgId, agentId, resolution ?? "Resolved")`; sets `status: "resolved"` with the resolution note.
- **list** — `service.getActiveLoops({ orgId, agentId, roomId })`: statuses `open | in_progress | blocked` for this agent in this room, newest first, default limit 20. Returns `{ ok: true, count, loops }`.

Missing required fields throw descriptive errors (`"description required for open_loop create"`, `"id required for open_loop update"`, etc.).

---

## 🪞 `reflect` (`tools.ts:270-317`)

Cognitive reflection: contradiction detection and belief lineage.

| Parameter | Zod schema | Notes |
| :--- | :--- | :--- |
| `action` | `z.enum(["detect_contradictions", "belief_lineage"])` | required |
| `title` | `z.string()` | optional; required for `detect_contradictions` |
| `tags` | `z.array(z.string())` | optional, feeds the shared-tag signal |
| `memory_id` | `z.string().uuid()` | optional; required for `belief_lineage` |

`dangerous: false`.

- **detect_contradictions** — `service.detectContradictions({ orgId, title, tags, agentId, roomId })` scans the 100 most recent *visible* active memories for topic overlap: a candidate matches when at least `min(2, titleTokens.length)` title keywords (length > 3) appear in its title+body, or when a tag is shared and at least one keyword matches (`modules/beliefs.ts:160-214`). Returns `{ ok: true, potential_contradictions: [...] }` with each candidate's `existingMemoryId`, `existingTitle`, `existingStatus` and a human-readable `reason`, capped at 10.
- **belief_lineage** — `service.getBeliefLineage(memory_id, access)` walks backward through `supersedes` links up to 10 hops (cycle-guarded), stopping at the first memory the caller cannot read (`modules/beliefs.ts:220-266`). Returns `{ ok: true, lineage: [{ id, title, epistemic_status, created_at }] }`, oldest ancestor last.

An unsupported action value throws `Unsupported action: <action>`.

---

## 🕸️ `graph_walk` (`tools.ts:319-358`)

Traverses the knowledge graph from a memory node along relational links and `[[wikilink]]` slugs.

| Parameter | Zod schema | Default | Notes |
| :--- | :--- | :--- | :--- |
| `start_memory_id` | `z.string().uuid()` | — | required; root node |
| `max_depth` | `z.number().int().min(1).max(2)` | `1` | hops |
| `limit` | `z.number().int().positive().max(20)` | `10` | max nodes returned |

`dangerous: false`. Delegates to `service.graphWalk` → `MemoryGraphEngine.graphWalk`, a breadth-first walk that follows explicit edges in both directions, resolves `targetSlug` edges to memories whose title slugifies to that slug, and also treats co-citations (other memories linking the same slug) as neighbours — all filtered through the caller's visibility, and the root itself must be readable or the result is empty (`modules/graph.ts:113-239`). Returns `{ ok: true, root_memory_id, connected_nodes: [{ id, title, epistemic_status, depth, relationship, weight }], edge_count }`.

---

## 🗑️ `forget` (`tools.ts:360-391`)

Retracts or permanently deletes a memory.

| Parameter | Zod schema | Default | Notes |
| :--- | :--- | :--- | :--- |
| `id` | `z.string().uuid()` | — | required |
| `reason` | `z.string()` | optional | recorded as the withdrawal reason |
| `hard_delete` | `z.boolean()` | `false` | permanent erase instead of withdraw |

This is the only memory tool with a dynamic danger flag (`tools.ts:374`):

```typescript
dangerous: (input) => input.hard_delete === true,
```

- **Default (withdraw)** — `service.withdrawBelief(id, access, reason ?? "Retracted by agent")` sets `epistemicStatus: "withdrawn"` plus the (redacted, 500-char) `withdrawalReason`; the row is kept for audit but never recalled, scores as zero, and is purged after 60 idle days by the dream cycle. Returns `{ ok: true, id, action: "withdrawn" }`.
- **`hard_delete: true`** — `service.forget(id, access)` deletes the row outright, but only after the tool-call record passes the human approval gate ([../tools/approvals.md](../tools/approvals.md)). Returns `{ ok: true, id, action: "deleted" }`.

Both paths require write access: agent-private and room memories follow read visibility, while an org memory may only be changed by the agent that created it (`modules/sources.ts:163-169`). Otherwise the result is `{ ok: false, id, error: NOT_FOUND }`.

---

## 🧪 Tests

`apps/orchestrator/src/memory/memory.test.ts` covers the tools at two levels: `describe("memory tools")` asserts the exact six-tool export order (`memory.test.ts:820-825`), while the `describe("memory service")` blocks verify the underlying permission behaviour the tools inherit — refusing to forget another agent's private memory, refusing to withdraw an org memory another agent wrote, unpin-safe same-title updates, withdrawn memories reviving on re-remember, and recall reinforcing only on explicit use (`memory.test.ts:494-753`).

Related docs: [./overview.md](./overview.md) · [./modules.md](./modules.md) · [./scheduler-and-mirror.md](./scheduler-and-mirror.md) · [../tools/approvals.md](../tools/approvals.md) · [../../architecture/turn-lifecycle.md](../../architecture/turn-lifecycle.md)
