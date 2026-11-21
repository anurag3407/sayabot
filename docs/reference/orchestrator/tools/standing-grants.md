# Standing Grants

An agent that reads the same file, runs the same test command, and commits the same way should not interrupt a person forty times a day. A **standing grant** remembers one exact call that a person already approved: same tool, same arguments, for one day, on that bot. Everything else still goes through the approval gate.

Source files: `apps/orchestrator/src/tools/grants.ts`, `apps/orchestrator/src/tools/audited.ts`, `apps/orchestrator/src/http.ts`

---

## 📋 Shape

Grants live on the bot's `params.standingGrants` (`agents.params`), newest first:

```ts
interface StandingGrant {
  tool: string
  argsDigest: string // sha256 of the stored arguments, 32 hex chars
  label: string // what was allowed, for the access list
  grantedBy: string // profile id, or "internal" from an operator route
  grantedAt: string
  expiresAt: string
}
```

| Constant               | Value | Meaning                            |
| :--------------------- | :---- | :--------------------------------- |
| `GRANT_TTL_MS`         | 24 h  | How long one grant lasts           |
| `MAX_STANDING_GRANTS`  | 20    | Cap per bot; oldest dropped first  |

`withGrant(params, grant)` prunes expired entries, replaces an existing grant for the same call, and caps the list.

## 🔑 The digest

`argsDigest(args)` hashes `stableJson(args)` — JSON with object keys sorted at every level — so `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` are the same call, while any different value is a different grant. The hash is computed over the **stored** arguments (`forStorage(input, scrub)` in `audited.ts`), which are redacted: a command carrying a secret hashes to the same value before and after scrubbing, and the grant never stores the secret itself.

## 🚫 What a grant can never cover

`grantAllowed(tool)` refuses by name pattern, and `matchStandingGrant` re-checks it even if a grant exists:

- credentials: `secret`, `vault`, `password`, `credential`, `api_key`
- outbound or public actions: `send`, `publish`, `post`, `reply`, `email`, `message`, `invite`
- installs: `install`, `uninstall`
- deletions and irreversible state: `delete`, `remove`, `destroy`, `drop`, `truncate`, `revoke`, `reset`, `purge`
- money: `pay`, `purchase`, `charge`, `refund`, `transfer`, `bill`

Ordinary work is allowed: `computer_shell`, `fs_write`, `git_commit`, `workspace_fork`, and the like.

## 🔁 How a call uses one

In `toAuditedTools`, after the room's execution mode decides whether the call is dangerous:

1. `standingGrantFor(agentId, tool, storedArgs)` reads the bot's live grants and asks `matchStandingGrant`.
2. **A grant matched** — the `tool_calls` row is inserted already approved (`approvedBy` set when the grant names a profile), `tool.approval_resolved { status: "approved" }` is broadcast, and execution proceeds. No `tool.approval_requested` is sent, so no card and no push.
3. **No grant** — the existing gate runs unchanged: row `pending_approval`, `tool.approval_requested`, push fan-out, `waitForApproval`, 5-minute timeout.

A grant is an approval that already happened, recorded with who gave it. It never turns a dangerous call into an ungated one, and `rooms.execution_mode = 'review_all'` still asks for everything: review-all promises a human sees each step, so a grant does not shorten it. `turbo` keeps working as before.

## ➕ Creating one

`POST /v1/tools/:toolCallId/approve` (internal secret) accepts `{ approved: true, remember: true, approvedBy?: "<profile id>" }`. It resolves the call's `runId` → `agent_runs.agentId`, builds the grant from `tool_calls.args` (already redacted), and writes it with `rememberStandingGrant`. The response includes the grant when one was saved. A call with no run, or a tool on the blocked list, returns `ok` without a grant.

`revoke` is a params edit today: `standingGrants` is a plain list, and removing an entry takes effect on the next call because `standingGrantFor` reads it fresh each time.

## 🧪 Tests

| Test file                   | Covers                                                                                  |
| :-------------------------- | :-------------------------------------------------------------------------------------- |
| `src/tools/grants.test.ts`  | Stable hashing across key order, digest separation, allowed vs blocked tools, exact-call matching, expiry, one entry per call, list cap, malformed input |

Related docs: [approvals](approvals.md) · [tool-system](tool-system.md) · [tool-sandbox](tool-sandbox.md) · [security model](../../architecture/security-model.md)
