/**
 * Pure retrieval helpers for memory recall: query tokenization, full-text query building,
 * vector similarity, relevance blending and near-duplicate detection. No I/O here so the
 * ranking rules are unit-testable on their own.
 */

/** Words too common to signal topic overlap. Postgres drops its own stop words on top. */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "no",
  "not",
  "of",
  "on",
  "or",
  "our",
  "please",
  "she",
  "so",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "up",
  "us",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
])

/**
 * Lowercased, de-duplicated content words. Tokens contain only letters and digits, which
 * also makes them safe to splice into a `to_tsquery` expression.
 */
export function queryTerms(text: string, max = 24): string[] {
  const seen = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOP_WORDS.has(raw)) continue
    seen.add(raw)
    if (seen.size >= max) break
  }
  return [...seen]
}

/**
 * OR-joined tsquery source (`a | b | c`). `websearch_to_tsquery` ANDs every word, which
 * makes a long trigger message match almost nothing; OR plus `ts_rank` ranks partial
 * overlap instead.
 */
export function buildOrTsQuery(terms: readonly string[]): string | null {
  const safe = terms.filter((t) => /^[\p{L}\p{N}]+$/u.test(t))
  return safe.length > 0 ? safe.join(" | ") : null
}

/**
 * Keyword overlap in both directions. A short memory title fully contained in a long
 * request is a strong match even though it covers few of the request's words.
 */
export function keywordRelevance(args: {
  title: string
  body: string
  terms: readonly string[]
}): number {
  if (args.terms.length === 0) return 0
  const text = `${args.title} ${args.body}`.toLowerCase()
  let hits = 0
  for (const term of args.terms) if (text.includes(term)) hits++
  const queryCoverage = hits / args.terms.length

  const titleTerms = queryTerms(args.title, 12)
  let titleCoverage = 0
  if (titleTerms.length > 0) {
    const termSet = new Set(args.terms)
    titleCoverage = titleTerms.filter((t) => termSet.has(t)).length / titleTerms.length
  }
  return Math.min(1, Math.max(queryCoverage, titleCoverage * 0.9))
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * Maps raw cosine similarity onto [0, 1] relevance. Each embedding model has its own
 * baseline for unrelated text (`floor`); similarity at or below it counts as no signal.
 */
export function vectorRelevance(similarity: number, floor: number): number {
  const span = Math.max(0.05, 0.9 - floor)
  return clamp01((similarity - floor) / span)
}

/** Full-text rank normalised against the best match of the same query. */
export function ftsRelevance(rank: number, maxRank: number): number {
  if (rank <= 0 || maxRank <= 0) return 0
  return 0.3 + 0.5 * clamp01(rank / maxRank)
}

/**
 * Strongest signal wins; independent signals that agree add a small bonus.
 */
export function blendRelevance(signals: {
  fts?: number
  vector?: number
  keyword?: number
}): number {
  const values = [signals.fts ?? 0, signals.vector ?? 0, signals.keyword ?? 0]
  const max = Math.max(...values)
  const agreeing = values.filter((v) => v >= 0.3).length
  return clamp01(max + 0.1 * Math.max(0, agreeing - 1))
}

function tokenSet(text: string): Set<string> {
  return new Set(queryTerms(text, 64))
}

export function jaccard(a: string, b: string): number {
  const sa = tokenSet(a)
  const sb = tokenSet(b)
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  return inter / (sa.size + sb.size - inter)
}

export function normalizeTitle(title: string): string {
  return queryTerms(title, 64).join(" ")
}

/**
 * Whether a newly extracted memory restates an existing one closely enough to merge into it
 * instead of inserting a duplicate.
 */
export function isNearDuplicate(
  candidate: { title: string; body: string },
  existing: { title: string; body: string },
  vectorSimilarity?: number,
): boolean {
  const ct = normalizeTitle(candidate.title)
  if (ct.length > 0 && ct === normalizeTitle(existing.title)) return true
  if (typeof vectorSimilarity === "number" && vectorSimilarity >= 0.92) return true
  if (jaccard(candidate.title, existing.title) >= 0.7) return true
  return (
    jaccard(`${candidate.title} ${candidate.body}`, `${existing.title} ${existing.body}`) >= 0.6
  )
}

/** `[#<uuid>]` citations of recalled memories in the agent's reply. */
export function citedMemoryIds(text: string, allowed: Iterable<string>): string[] {
  const allow = new Set(allowed)
  const out = new Set<string>()
  for (const m of text.matchAll(
    /\[#([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi,
  )) {
    const id = m[1]?.toLowerCase()
    if (id && allow.has(id)) out.add(id)
  }
  return [...out]
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}
