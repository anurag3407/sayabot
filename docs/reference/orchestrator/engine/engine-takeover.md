# Quota Takeover

A room should not go silent because one provider account ran out of credit. `runWithQuotaTakeover` wraps the v2 turn: when the bot's model reports an exhausted balance and the bot has a second, already-configured model, the same turn is answered on that second model and the dry one is skipped for a while instead of being rediscovered every message.

Source files: `apps/orchestrator/src/engine/takeover.ts`, `apps/orchestrator/src/engine/index.ts`, `apps/orchestrator/src/engine/recovery.ts`

---

## 🔧 Configuration

The fallback lives on the bot's `params` (`agents.params`):

```json
{
  "fallback": { "providerKeyId": "9f1c…", "model": "claude-sonnet-4.6" }
}
```

`fallbackFromParams(params)` reads it and returns `null` unless both fields are non-empty strings. The fallback names its **own provider key** on purpose: the case this covers is one account's balance, so a fallback on the same key cannot help and is refused.

Holds are stored beside it, keyed by `"providerKeyId/model"`:

```json
{ "quotaHolds": { "9f1c…/gpt-5": { "until": 1765000000000, "errorKind": "quota_exhausted" } } }
```

`modelKeyOf(agent)` builds that key (`"server/model"` when the bot runs on the server's own model), and `activeHoldUntil(params, key)` answers whether it is still live.

## 🔁 What a turn does

`runWithQuotaTakeover(args, run)` runs in three shapes:

1. **No fallback configured** — the turn runs once, unchanged.
2. **The model is already held** — the turn runs directly on the fallback, with no wasted round trip to the dry provider.
3. **First attempt reports `quota_exhausted`** — the wrapper:
   - records a hold of `QUOTA_HOLD_MS` (15 minutes, never more than `MAX_QUOTA_HOLD_MS` = 6 hours),
   - deletes the failed streaming message and broadcasts `message.removed`, the same cleanup `runFittingTheModel` uses, so the chat does not keep an empty attempt,
   - re-runs the turn with `{ model, providerKeyId }` taken from the fallback and `params.quotaHolds` merged in,
   - logs one line naming the dry model and the one that answered.

The reply's metadata already carries the model that produced it, so the room shows the fallback's name under the message.

Once per turn is the hard limit: a fallback that is also dry returns its own error, which reaches the room through `userFacingError` like any other failure. There is no loop, and `rate_limit`, `auth_error`, `request_too_large` and the rest are untouched — they have their own handling (`recovery.ts`, `fit-model.ts`).

## ⏳ Holds

- `pruneHolds(holds)` drops expired entries every time a hold is written, so `agents.params` cannot accumulate stale keys.
- A hold expiring is the retry: the next turn tries the primary model again, and takes over once more if it is still dry.
- `persistHolds(agentId, holds)` writes with `jsonb_set` on `{quotaHolds}` rather than replacing `params`, so a concurrent `lastModel` or `requestLimits` write is not clobbered. A failed write only means the next turn rediscovers the dry model; the turn itself still answers on the fallback.

## 🧪 Tests

| Test file                           | Covers                                                                              |
| :---------------------------------- | :---------------------------------------------------------------------------------- |
| `src/engine/takeover.test.ts`       | No fallback, takeover on `quota_exhausted`, hold-skip path, same-account refusal, other error kinds, hold expiry |

Related docs: [engine-loop](engine-loop.md) · [engine-watchdog](engine-watchdog.md) · [engine-budget-and-compaction](engine-budget-and-compaction.md) · [LLM runner](runner-llm.md) · [Configuration](../../architecture/configuration.md)
