# Secret Redaction, Circuit Breakers & Repetition Detection

These three modules are the safety net around what agents say and how often they run. `redact.ts` scrubs credential-shaped strings out of anything that could be stored or shown to a model, `breakers.ts` halts generation before a turn when a room's limits are exhausted, and `repetition.ts` detects circular bot chatter so two agents cannot loop politely forever. All three are pure functions with no I/O.

Source files: `packages/core/src/redact.ts`, `packages/core/src/breakers.ts`, `packages/core/src/repetition.ts` (tests: `redact.test.ts`, `breakers.test.ts`, `repetition.test.ts`)

---

## 🕵️ Secret Redaction (`redact.ts`)

Two complementary mechanisms: a **pattern-based** redactor that recognizes well-known token formats, and a **value-based** per-run scrubber that removes specific known secrets (and their encodings) from tool output.

### Pattern library (`PATTERNS`, `redact.ts:1`)

Every match is replaced with `[REDACTED:<name>]`:

| Name | Pattern | Matches |
| :--- | :--- | :--- |
| `aws_access_key` | `(?:AKIA\|ASIA)[0-9A-Z]{16}` | AWS access key IDs |
| `anthropic_key` | `sk-ant-[A-Za-z0-9_-]{20,}` | Anthropic API keys |
| `openai_key` | `sk-(?:proj-\|svcacct-)?[A-Za-z0-9_-]{20,}` | OpenAI keys (incl. project/service-account forms) |
| `github_token` | `(?:ghp\|gho\|ghu\|ghs\|ghr)_[A-Za-z0-9]{30,}` | Classic GitHub tokens |
| `github_pat` | `github_pat_[A-Za-z0-9_]{40,}` | Fine-grained GitHub PATs |
| `slack_token` | `xox[abposr]-[A-Za-z0-9-]{10,}` | Slack bot/user/app/refresh tokens |
| `google_api_key` | `AIza[0-9A-Za-z_-]{35}` | Google API keys |
| `groq_key` | `gsk_[A-Za-z0-9]{40,}` | Groq keys |
| `mesh_agent_key` | `(?:mesh_ak_\|saaya_ak_\|sayabot_ak_)[A-Za-z0-9_-]{20,}` | Sayabot agent HMAC keys (all three brand prefixes) |
| `oauth_access_token` | `(?:mesh_at_\|sayabot_at_)[A-Za-z0-9_-]{20,}` | Internal OAuth access tokens |
| `oauth_refresh_token` | `(?:mesh_rt_\|sayabot_rt_)[A-Za-z0-9_-]{20,}` | Internal OAuth refresh tokens |
| `invite_code` | `sinv_[A-Za-z0-9_-]{20,}` | Space invite codes (`invite.ts`) |
| `jwt` | `eyJ…\.eyJ…\.…` (three dot-separated base64url segments) | JSON Web Tokens |
| `private_key` | `-----BEGIN [A-Z ]*PRIVATE KEY----- … -----END …-----` | PEM blocks, matched across newlines |

The self-branded tokens (`saaya_ak_`, `mesh_at_`, etc.) are recognized in all legacy and current prefixes, so older deployments stay protected.

### `redactSecrets(input, options?)` (`redact.ts:26`)

```typescript
export interface RedactionResult {
  text: string
  redactions: { name: string; count: number }[]  // one entry per pattern with ≥1 hit
}

export function redactSecrets(
  input: string,
  options?: { redactPlaceholders?: boolean },
): RedactionResult
```

Behaviour:

- Runs every pattern in order over the string, replacing each match with `[REDACTED:<name>]` and counting hits. Only patterns with at least one match appear in `redactions`.
- `PLACEHOLDER_PATTERN` (`redact.ts:18`) matches secret-broker placeholders (`saaya_ph_` + 24+ chars). These are **left untouched by default** — an agent legitimately sees `$SECRET{...}`-style placeholders — and are only replaced with `[REDACTED:placeholder]` when `options.redactPlaceholders === true`.
- Innocent text is returned unchanged with an empty `redactions` array.

### `createRunScrubber(values)` (`redact.ts:55`)

Pattern redaction can't catch an *arbitrary* secret the agent was legitimately given (a connector token, a webhook URL). For that, each agent run builds an exact-value scrubber:

```typescript
export function createRunScrubber(values: string[]): (text: string) => string
```

1. Collect every value into a set, skipping empty, non-string, or short (< 6 chars) values.
2. For each value, also add its `encodeURIComponent` variant and, when at least 8 chars long, its UTF-8 **base64** variant — so a secret leaked inside a URL query or an `Authorization: Basic` header is still caught.
3. If no targets remain, return the identity function.
4. Sort targets **longest first** (so a long token is not partially eaten by one of its own substrings), regex-escape each, join with `|` into a single global regex.
5. The returned function replaces every hit with `[REDACTED:secret]` (non-string input passes through untouched).

`redact.test.ts` verifies all three variants are scrubbed from one string and that short values (`"hi"`, `"test"`) are ignored. Note the test fixtures are assembled at runtime via `join(...)` so the repo itself never contains a scanner-matching literal.

This is the code-level enforcement of the AGENTS.md rule that no raw secret ever reaches a message row, a log, or an LLM prompt.

---

## ⛔ Pre-Turn Circuit Breakers (`breakers.ts`)

Despite the name, this is not a network-error circuit breaker — it is the **pre-turn limit check** that decides whether an agent turn may start at all, per room.

### `checkPreTurnBreakers(input)` (`breakers.ts:24`)

```typescript
export type BreakerCode = "turn_cap" | "rpm_limit" | "daily_budget"

export interface BreakerInput {
  botTurnsUsed: number
  turnCap: number
  rpmUsed: number
  rpmLimit: number | null      // null = unlimited
  spentUsd: number
  dailyBudgetUsd: number | null // null = unlimited
}

export interface BreakerTrip {
  code: BreakerCode
  reason: string
  message: string
}
```

Checks run in a fixed priority order and the **first** tripped breaker is returned (as a `BreakerTrip`); `null` means the turn may proceed:

1. **`turn_cap`** — `botTurnsUsed >= turnCap`. Message: `"Generation halted: this room's turn cap of N was reached. Human input is required to continue."` This is the hard stop that prevents runaway multi-agent loops; only a human can lift it.
2. **`rpm_limit`** — only when `rpmLimit !== null` and `rpmUsed >= rpmLimit`. Message suggests retrying shortly.
3. **`daily_budget`** — only when `dailyBudgetUsd !== null` and `spentUsd >= dailyBudgetUsd`. Both figures are rendered with `toFixed(4)` in the message (e.g. `spent $5.0000`), and a zero-ish budget (`0.0001`) trips as soon as spending exceeds it.

Every message is prefixed with `Generation halted` (the `HALT_LABEL` constant) because these strings are surfaced to users as the room's halt reason. `breakers.test.ts` confirms the ordering (a tripped cap wins over RPM and budget), that `null` limits are treated as unlimited even with absurd spend, and the exact message formatting.

### `REPETITION_HALT_MESSAGE` (`breakers.ts:49`)

```typescript
export const REPETITION_HALT_MESSAGE =
  "Generation halted: the agents started repeating each other. Human input is required to continue."
```

The constant the orchestrator posts when `detectRepetition` (below) fires — keeping the exact halt wording in one place next to the other breaker messages.

---

## 🔁 Repetition Detection (`repetition.ts`)

Multi-agent rooms can degenerate into an echo chamber: bots paraphrase each other or trade politeness until the turn cap burns. `repetition.ts` quantifies that and gives the engine a halt signal.

### Normalization and similarity primitives

- **`normalize(text)`** (`repetition.ts:4`) — lowercases, replaces `` ` *_ > # ~ [ ] ( ) ! . , : ; ? " ' - `` with spaces, collapses whitespace. Markdown and punctuation stop affecting similarity.
- **`levenshteinSimilarity(a, b)`** (`repetition.ts:13`) — normalized Levenshtein over the normalized strings using `fastest-levenshtein`: `1 - distance / max(len)`. `1` = identical, `0` = completely different; both-empty inputs score `1`.
- **`tokenCosine(a, b)`** (`repetition.ts:22`) — cosine similarity over word-count vectors of the normalized text. Order-insensitive, so word salads with the same vocabulary score high.

### `isPoliteAgreement(text)` (`repetition.ts:43`)

True when a message is short, content-free agreement. All three conditions must hold:

1. Normalized length < 240 chars.
2. Starts with an agreement opener (`AGREEMENT_RE`): *I/we (fully|completely|totally) agree*, *thanks/thank you*, *great point/suggestion*, *sounds good*, *exactly*, *absolutely*, *well said*, *you('re|are) right*.
3. Contains **no** substantive connective (`SUBSTANTIVE_RE`): *but, however, though, although, yet, because, unless, need(s), should, must*.
4. ≤ 14 words after normalization.

So `"I agree with Alice."` and `"Great point, Bob!"` are polite noise, while `"I agree, but the migration needs a rollback plan"` is a real reply.

### `detectRepetition(candidate, recentBotMessages, opts?)` (`repetition.ts:62`)

```typescript
export interface RepetitionOptions {
  levenshteinThreshold?: number  // default 0.85
  cosineThreshold?: number       // default 0.92
  window?: number                // default 4 — how many recent bot messages to compare
}
```

The candidate reply is checked against the last `window` bot messages:

1. **Near-duplicate (edit distance)** — `levenshteinSimilarity(candidate, prev) >= 0.85` returns `{ repeating: true, reason: "near-duplicate reply (levenshtein X.XX)" }`.
2. **Near-duplicate (bag of words)** — `tokenCosine >= 0.92` *and* the normalized candidate is longer than 40 chars (the length guard stops two short greetings from counting as duplicates). Reason: `"near-duplicate reply (cosine X.XX)"`.
3. **Agreement loop** — if the last **two** bot messages plus the candidate are *all* `isPoliteAgreement`, it returns `{ repeating: true, reason: "circular agreement loop" }`.
4. Otherwise `{ repeating: false }`.

The first match wins, and reasons embed the offending score for logs. The orchestrator combines this with `REPETITION_HALT_MESSAGE` to stop the room and hand control back to a human — the behavioural twin of the hard breakers above.

Related docs: [./turns.md](./turns.md), [./engine-and-computers.md](./engine-and-computers.md), [./platform-utilities.md](./platform-utilities.md)
