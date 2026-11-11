/**
 * Structured asks and owner facts.
 *
 * Bots used to ask the room owner the same things over and over ("start date?", "availability?",
 * "when can you join?") because questions were only folded when the wording matched. Asks now
 * carry items with stable keys, and every answer is kept as an owner fact. Before a question
 * reaches a person it is checked against the facts and against questions still waiting, so:
 *   - a fact that is already known is answered straight away, with no card for the person;
 *   - a key that another open question already asks is not asked twice;
 *   - only genuinely new items reach the inbox, merged into the bot's existing open question.
 *
 * Everything here is pure so the orchestrator (MCP) and the web app (inbox) share one rulebook.
 */

export const MAX_ASK_ITEMS = 8
export const MAX_FACT_VALUE = 1_000
export const MAX_FACT_KEY = 48

export type AskItemSource = "human" | "fact"

export interface AskItem {
  key: string
  question: string
  hint?: string
  options?: string[]
  answer?: string | null
  answeredAt?: string | null
  source?: AskItemSource | null
}

export interface KnownFact {
  key: string
  label: string
  value: string
  /** null = every room in the workspace; otherwise only this room. */
  roomId: string | null
  source?: string | null
  updatedAt?: string | null
}

export interface OpenAskRef {
  id: string
  agentId: string | null
  items: AskItem[]
}

/**
 * Different bots (and the same bot on different days) name the same fact differently.
 * These fold onto one key so "availability" and "start_date" are the same question.
 */
const FACT_KEY_ALIASES: Record<string, string> = {
  availability: "start_date",
  available_from: "start_date",
  earliest_start: "start_date",
  earliest_start_date: "start_date",
  joining_date: "start_date",
  join_date: "start_date",
  start: "start_date",
  start_month: "start_date",
  work_authorisation: "work_authorization",
  work_auth: "work_authorization",
  work_permit: "work_authorization",
  right_to_work: "work_authorization",
  eligible_to_work: "work_authorization",
  sponsorship: "visa_sponsorship",
  needs_sponsorship: "visa_sponsorship",
  visa: "visa_sponsorship",
  expected_ctc: "expected_salary",
  expected_lpa: "expected_salary",
  expected_pay: "expected_salary",
  salary_expectation: "expected_salary",
  current_ctc: "current_salary",
  current_lpa: "current_salary",
  current_pay: "current_salary",
  notice: "notice_period",
  notice_days: "notice_period",
  current_city: "location",
  city: "location",
  current_location: "location",
  relocate: "relocation",
  willing_to_relocate: "relocation",
  open_to_relocation: "relocation",
  linkedin: "linkedin_url",
  linkedin_profile: "linkedin_url",
  github: "github_url",
  github_profile: "github_url",
  github_link: "github_url",
  graduation: "graduation_date",
  graduation_year: "graduation_date",
  grad_year: "graduation_date",
  expected_graduation: "graduation_date",
  gpa: "cgpa",
  grades: "cgpa",
  experience: "years_of_experience",
  years_experience: "years_of_experience",
  yoe: "years_of_experience",
}

const FACT_LABELS: Record<string, string> = {
  cgpa: "CGPA",
  linkedin_url: "LinkedIn URL",
  github_url: "GitHub URL",
  work_authorization: "Work authorisation",
  visa_sponsorship: "Visa sponsorship",
}

/** Lowercase snake_case, punctuation folded, capped. Empty input gives "". */
export function normalizeFactKey(raw: string | null | undefined): string {
  if (!raw) return ""
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, MAX_FACT_KEY)
    .replace(/_+$/g, "")
}

/** The key a fact is stored under: normalized, then folded through the alias table. */
export function canonicalFactKey(raw: string | null | undefined): string {
  const key = normalizeFactKey(raw)
  return FACT_KEY_ALIASES[key] ?? key
}

/** "start_date" → "Start date". Known acronyms keep their casing. */
export function humanizeFactKey(key: string): string {
  const canonical = canonicalFactKey(key)
  if (FACT_LABELS[canonical]) return FACT_LABELS[canonical]
  const words = canonical.replace(/_/g, " ").trim()
  if (!words) return "Detail"
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Room-scoped facts win over workspace-wide ones with the same key. */
export function lookupFact(
  facts: readonly KnownFact[],
  key: string,
  roomId: string | null,
): KnownFact | null {
  const canonical = canonicalFactKey(key)
  if (!canonical) return null
  let workspaceWide: KnownFact | null = null
  for (const fact of facts) {
    if (canonicalFactKey(fact.key) !== canonical) continue
    if (!fact.value?.trim()) continue
    if (roomId && fact.roomId === roomId) return fact
    if (fact.roomId === null) workspaceWide = fact
  }
  return workspaceWide
}

/** Facts a bot in `roomId` may read, room-scoped first, one per key. */
export function factsVisibleInRoom(facts: readonly KnownFact[], roomId: string | null): KnownFact[] {
  const byKey = new Map<string, KnownFact>()
  for (const fact of facts) {
    if (fact.roomId !== null && fact.roomId !== roomId) continue
    const key = canonicalFactKey(fact.key)
    if (!key || !fact.value?.trim()) continue
    const existing = byKey.get(key)
    if (!existing || (existing.roomId === null && fact.roomId !== null)) byKey.set(key, fact)
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))
}

function cleanOptions(options: unknown): string[] | undefined {
  if (!Array.isArray(options)) return undefined
  const cleaned = [
    ...new Set(
      options
        .filter((o): o is string => typeof o === "string")
        .map((o) => o.trim().slice(0, 60))
        .filter(Boolean),
    ),
  ].slice(0, 6)
  return cleaned.length ? cleaned : undefined
}

/**
 * Trims, keys and dedupes the items a bot sends. An item without a key gets one from its
 * question, so two bots typing the identical question still fold. Capped at MAX_ASK_ITEMS.
 */
export function sanitizeAskItems(
  raw: ReadonlyArray<{ key?: string | null; question?: string | null; hint?: string | null; options?: unknown }>,
): AskItem[] {
  const seen = new Set<string>()
  const out: AskItem[] = []
  for (const item of raw) {
    const question = (item.question ?? "").trim().slice(0, 300)
    const key = canonicalFactKey(item.key) || canonicalFactKey(question)
    if (!key || !question || seen.has(key)) continue
    seen.add(key)
    const hint = item.hint?.trim().slice(0, 300)
    const options = cleanOptions(item.options)
    out.push({
      key,
      question,
      ...(hint ? { hint } : {}),
      ...(options ? { options } : {}),
      answer: null,
      answeredAt: null,
      source: null,
    })
    if (out.length >= MAX_ASK_ITEMS) break
  }
  return out
}

/** Reads items back out of a request's jsonb metadata, dropping anything malformed. */
export function askItemsFromMetadata(metadata: unknown): AskItem[] {
  if (!metadata || typeof metadata !== "object") return []
  const items = (metadata as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  const out: AskItem[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const key = canonicalFactKey(typeof r.key === "string" ? r.key : "")
    const question = typeof r.question === "string" ? r.question : ""
    if (!key || !question) continue
    const answer = typeof r.answer === "string" && r.answer.trim() ? r.answer : null
    out.push({
      key,
      question,
      ...(typeof r.hint === "string" && r.hint ? { hint: r.hint } : {}),
      ...(cleanOptions(r.options) ? { options: cleanOptions(r.options) } : {}),
      answer,
      answeredAt: answer && typeof r.answeredAt === "string" ? r.answeredAt : null,
      source: answer && (r.source === "human" || r.source === "fact") ? r.source : null,
    })
  }
  return out
}

export function unansweredItems(items: readonly AskItem[]): AskItem[] {
  return items.filter((item) => !item.answer?.trim())
}

export interface AskPlan {
  /** Answered from facts right now: the bot gets these back and no person is bothered. */
  known: Array<{ key: string; question: string; label: string; value: string }>
  /** Already waiting in another open question: not asked a second time. */
  alreadyAsked: Array<{ key: string; askId: string }>
  /** New items that do need a person. */
  toAsk: AskItem[]
  /** The bot's own open question in this room that new items should join, if any. */
  mergeIntoId: string | null
}

/**
 * Decides what to do with a bot's question. `openAsks` are the room's open requests, newest first.
 */
export function planAsk(input: {
  items: readonly AskItem[]
  facts: readonly KnownFact[]
  roomId: string | null
  openAsks: readonly OpenAskRef[]
  agentId: string | null
}): AskPlan {
  const plan: AskPlan = { known: [], alreadyAsked: [], toAsk: [], mergeIntoId: null }
  for (const item of input.items) {
    const fact = lookupFact(input.facts, item.key, input.roomId)
    if (fact) {
      plan.known.push({
        key: item.key,
        question: item.question,
        label: fact.label || humanizeFactKey(item.key),
        value: fact.value,
      })
      continue
    }
    const waiting = input.openAsks.find((ask) =>
      ask.items.some((existing) => existing.key === item.key && !existing.answer?.trim()),
    )
    if (waiting) {
      plan.alreadyAsked.push({ key: item.key, askId: waiting.id })
      continue
    }
    plan.toAsk.push(item)
  }
  if (plan.toAsk.length && input.agentId) {
    const own = input.openAsks.find((ask) => ask.agentId === input.agentId && ask.items.length > 0)
    if (own) plan.mergeIntoId = own.id
  }
  return plan
}

/** Appends new items to an existing ask, keeping the total under MAX_ASK_ITEMS. */
export function mergeAskItems(existing: readonly AskItem[], incoming: readonly AskItem[]): AskItem[] {
  const keys = new Set(existing.map((item) => item.key))
  const merged = [...existing]
  for (const item of incoming) {
    if (merged.length >= MAX_ASK_ITEMS) break
    if (keys.has(item.key)) continue
    keys.add(item.key)
    merged.push(item)
  }
  return merged
}

export interface AppliedAnswers {
  items: AskItem[]
  /** Keys answered by this call (not ones that were already answered). */
  answeredKeys: string[]
  remaining: number
}

/** Writes answers (by key) into items. Blank answers are ignored. */
export function applyAnswersToItems(
  items: readonly AskItem[],
  answers: Readonly<Record<string, string>>,
  source: AskItemSource,
  now: string = new Date().toISOString(),
): AppliedAnswers {
  const byKey = new Map<string, string>()
  for (const [rawKey, value] of Object.entries(answers)) {
    const key = canonicalFactKey(rawKey)
    const trimmed = (value ?? "").trim().slice(0, MAX_FACT_VALUE)
    if (key && trimmed) byKey.set(key, trimmed)
  }
  const answeredKeys: string[] = []
  const next = items.map((item) => {
    if (item.answer?.trim()) return item
    const value = byKey.get(item.key)
    if (!value) return item
    answeredKeys.push(item.key)
    return { ...item, answer: value, answeredAt: now, source }
  })
  return { items: next, answeredKeys, remaining: unansweredItems(next).length }
}

/** Fills any unanswered item whose key is now a known fact. */
export function fillItemsFromFacts(
  items: readonly AskItem[],
  facts: readonly KnownFact[],
  roomId: string | null,
  now: string = new Date().toISOString(),
): AppliedAnswers {
  const answers: Record<string, string> = {}
  for (const item of unansweredItems(items)) {
    const fact = lookupFact(facts, item.key, roomId)
    if (fact) answers[item.key] = fact.value
  }
  return applyAnswersToItems(items, answers, "fact", now)
}

/** The message a bot receives: one "Label: value" line per answered item. */
export function formatItemAnswers(items: readonly AskItem[], keys?: readonly string[]): string {
  const wanted = keys ? new Set(keys) : null
  return items
    .filter((item) => item.answer?.trim() && (!wanted || wanted.has(item.key)))
    .map((item) => `${humanizeFactKey(item.key)}: ${item.answer!.trim()}`)
    .join("\n")
}
