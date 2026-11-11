import { describe, expect, it } from "vitest"
import {
  applyAnswersToItems,
  askItemsFromMetadata,
  canonicalFactKey,
  factsVisibleInRoom,
  fillItemsFromFacts,
  formatItemAnswers,
  humanizeFactKey,
  lookupFact,
  MAX_ASK_ITEMS,
  mergeAskItems,
  normalizeFactKey,
  planAsk,
  sanitizeAskItems,
  type KnownFact,
} from "./asks"

const ROOM = "room-1"
const OTHER_ROOM = "room-2"

function fact(key: string, value: string, roomId: string | null = null): KnownFact {
  return { key, label: humanizeFactKey(key), value, roomId }
}

describe("fact keys", () => {
  it("normalizes to snake_case and caps length", () => {
    expect(normalizeFactKey("  Start Date! ")).toBe("start_date")
    expect(normalizeFactKey("R&D focus")).toBe("r_and_d_focus")
    expect(normalizeFactKey("")).toBe("")
    expect(normalizeFactKey(null)).toBe("")
    expect(normalizeFactKey("a".repeat(80)).length).toBeLessThanOrEqual(48)
    expect(normalizeFactKey("x_".repeat(40))).not.toMatch(/_$/)
  })

  it("folds synonyms onto one canonical key", () => {
    expect(canonicalFactKey("availability")).toBe("start_date")
    expect(canonicalFactKey("Work authorisation")).toBe("work_authorization")
    expect(canonicalFactKey("expected CTC")).toBe("expected_salary")
    expect(canonicalFactKey("GPA")).toBe("cgpa")
    expect(canonicalFactKey("favourite_colour")).toBe("favourite_colour")
  })

  it("humanizes keys with acronyms intact", () => {
    expect(humanizeFactKey("start_date")).toBe("Start date")
    expect(humanizeFactKey("gpa")).toBe("CGPA")
    expect(humanizeFactKey("linkedin")).toBe("LinkedIn URL")
    expect(humanizeFactKey("___")).toBe("Detail")
  })
})

describe("lookupFact / factsVisibleInRoom", () => {
  const facts = [
    fact("start_date", "June 2027"),
    fact("start_date", "Jan 2027", ROOM),
    fact("location", "Patna", OTHER_ROOM),
    fact("cgpa", "  "),
  ]

  it("prefers the room-scoped fact", () => {
    expect(lookupFact(facts, "availability", ROOM)?.value).toBe("Jan 2027")
    expect(lookupFact(facts, "start_date", OTHER_ROOM)?.value).toBe("June 2027")
  })

  it("never leaks another room's fact", () => {
    expect(lookupFact(facts, "location", ROOM)).toBeNull()
    expect(factsVisibleInRoom(facts, ROOM).map((f) => f.key)).toEqual(["start_date"])
    expect(factsVisibleInRoom(facts, ROOM)[0]?.value).toBe("Jan 2027")
  })

  it("ignores blank values", () => {
    expect(lookupFact(facts, "cgpa", ROOM)).toBeNull()
  })
})

describe("sanitizeAskItems", () => {
  it("keys, trims and dedupes items", () => {
    const items = sanitizeAskItems([
      { key: "Availability", question: " When can you start? " },
      { key: "start_date", question: "Start date?" },
      { question: "Which city are you in?" },
      { key: "x", question: "   " },
      { key: "relocation", question: "Relocate?", options: ["Yes", "No", "Yes", 3, ""] },
    ])
    expect(items.map((i) => i.key)).toEqual(["start_date", "which_city_are_you_in", "relocation"])
    expect(items[0]?.question).toBe("When can you start?")
    expect(items[2]?.options).toEqual(["Yes", "No"])
    expect(items.every((i) => i.answer === null)).toBe(true)
  })

  it("caps the number of items", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}`, question: `q${i}?` }))
    expect(sanitizeAskItems(many)).toHaveLength(MAX_ASK_ITEMS)
  })
})

describe("askItemsFromMetadata", () => {
  it("round-trips sanitized items and drops junk", () => {
    const items = sanitizeAskItems([{ key: "cgpa", question: "CGPA?" }])
    const back = askItemsFromMetadata({ items: [...items, null, { key: "", question: "x" }, "str"] })
    expect(back).toEqual(items)
    expect(askItemsFromMetadata(null)).toEqual([])
    expect(askItemsFromMetadata({ items: "nope" })).toEqual([])
  })

  it("drops a stale answeredAt/source when the answer is blank", () => {
    const back = askItemsFromMetadata({
      items: [{ key: "cgpa", question: "CGPA?", answer: " ", answeredAt: "t", source: "human" }],
    })
    expect(back[0]).toMatchObject({ answer: null, answeredAt: null, source: null })
  })
})

describe("planAsk", () => {
  const items = sanitizeAskItems([
    { key: "start_date", question: "When can you start?" },
    { key: "work_authorization", question: "Can you work in India?" },
    { key: "notice_period", question: "Notice period?" },
  ])

  it("answers known facts without asking a person", () => {
    const plan = planAsk({
      items,
      facts: [fact("availability", "June 2027"), fact("work_auth", "Indian citizen")],
      roomId: ROOM,
      openAsks: [],
      agentId: "hermes",
    })
    expect(plan.known.map((k) => [k.key, k.value])).toEqual([
      ["start_date", "June 2027"],
      ["work_authorization", "Indian citizen"],
    ])
    expect(plan.toAsk.map((i) => i.key)).toEqual(["notice_period"])
    expect(plan.mergeIntoId).toBeNull()
  })

  it("does not ask a key that another open question is waiting on", () => {
    const plan = planAsk({
      items,
      facts: [],
      roomId: ROOM,
      openAsks: [
        {
          id: "ask-other-bot",
          agentId: "scout",
          items: sanitizeAskItems([{ key: "start_date", question: "Start?" }]),
        },
      ],
      agentId: "hermes",
    })
    expect(plan.alreadyAsked).toEqual([{ key: "start_date", askId: "ask-other-bot" }])
    expect(plan.toAsk.map((i) => i.key)).toEqual(["work_authorization", "notice_period"])
    expect(plan.mergeIntoId).toBeNull()
  })

  it("re-asks a key whose open item was already answered", () => {
    const answered = applyAnswersToItems(
      sanitizeAskItems([{ key: "start_date", question: "Start?" }]),
      { start_date: "June" },
      "human",
    ).items
    const plan = planAsk({
      items: items.slice(0, 1),
      facts: [],
      roomId: ROOM,
      openAsks: [{ id: "a", agentId: "scout", items: answered }],
      agentId: "hermes",
    })
    expect(plan.alreadyAsked).toEqual([])
    expect(plan.toAsk).toHaveLength(1)
  })

  it("merges new items into the bot's own open question", () => {
    const plan = planAsk({
      items,
      facts: [],
      roomId: ROOM,
      openAsks: [
        { id: "legacy", agentId: "hermes", items: [] },
        { id: "mine", agentId: "hermes", items: sanitizeAskItems([{ key: "cgpa", question: "CGPA?" }]) },
      ],
      agentId: "hermes",
    })
    expect(plan.mergeIntoId).toBe("mine")
    expect(plan.toAsk).toHaveLength(3)
  })
})

describe("mergeAskItems", () => {
  it("appends only new keys and respects the cap", () => {
    const existing = sanitizeAskItems(
      Array.from({ length: MAX_ASK_ITEMS - 1 }, (_, i) => ({ key: `k${i}`, question: `q${i}?` })),
    )
    const merged = mergeAskItems(
      existing,
      sanitizeAskItems([
        { key: "k0", question: "dup" },
        { key: "new1", question: "n1?" },
        { key: "new2", question: "n2?" },
      ]),
    )
    expect(merged).toHaveLength(MAX_ASK_ITEMS)
    expect(merged.at(-1)?.key).toBe("new1")
  })
})

describe("answers", () => {
  const items = sanitizeAskItems([
    { key: "start_date", question: "Start?" },
    { key: "cgpa", question: "CGPA?" },
  ])

  it("applies partial answers and counts what is left", () => {
    const result = applyAnswersToItems(items, { availability: " June 2027 ", cgpa: "  " }, "human", "T")
    expect(result.answeredKeys).toEqual(["start_date"])
    expect(result.remaining).toBe(1)
    expect(result.items[0]).toMatchObject({ answer: "June 2027", answeredAt: "T", source: "human" })
  })

  it("does not overwrite an answer that is already there", () => {
    const first = applyAnswersToItems(items, { start_date: "June" }, "human").items
    const second = applyAnswersToItems(first, { start_date: "July" }, "human")
    expect(second.answeredKeys).toEqual([])
    expect(second.items[0]?.answer).toBe("June")
  })

  it("fills open items from facts", () => {
    const result = fillItemsFromFacts(items, [fact("gpa", "6.9")], ROOM)
    expect(result.answeredKeys).toEqual(["cgpa"])
    expect(result.items[1]?.source).toBe("fact")
    expect(result.remaining).toBe(1)
  })

  it("formats answered items as label lines", () => {
    const answered = applyAnswersToItems(items, { start_date: "June", cgpa: "6.9" }, "human").items
    expect(formatItemAnswers(answered)).toBe("Start date: June\nCGPA: 6.9")
    expect(formatItemAnswers(answered, ["cgpa"])).toBe("CGPA: 6.9")
  })
})
