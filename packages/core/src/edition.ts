/**
 * Which kind of Sayabot server this is.
 *
 * - `self-hosted` (default): someone runs Sayabot on their own server. No plans, no limits, no
 *   billing, nothing that talks to the Sayabot Cloud.
 * - `cloud`: Sayabot Cloud (sayabot.sayalabs.in). Workspaces are on a plan; limits apply and
 *   billing is on. Set with SAYABOT_EDITION=cloud.
 */
export type Edition = "self-hosted" | "cloud"

export function readEdition(env: Record<string, string | undefined>): Edition {
  const value = env.SAYABOT_EDITION ?? env.NEXT_PUBLIC_SAYABOT_EDITION
  return value?.trim().toLowerCase() === "cloud" ? "cloud" : "self-hosted"
}

/**
 * In the browser: the edition baked into the build (NEXT_PUBLIC_SAYABOT_EDITION, set from
 * SAYABOT_EDITION by the Docker build). Written out in full so Next inlines it.
 */
export function publicEdition(): Edition {
  return process.env.NEXT_PUBLIC_SAYABOT_EDITION?.trim().toLowerCase() === "cloud"
    ? "cloud"
    : "self-hosted"
}

export type PlanId = "free" | "pro" | "team"

/** What a plan allows. `null` = no limit. */
export interface PlanLimits {
  /**
   * Agent replies a month that run on the server (server models, your keys, agent computers).
   * Replies that run on the person's own Mac don't count: they cost the server almost nothing.
   */
  serverTurnsPerMonth: number | null
  agents: number | null
  /** Persistent Linux computers for agents (computerd). */
  computers: number | null
  members: number | null
}

export interface Plan {
  id: PlanId
  name: string
  /** Shown price, per workspace per month (the real price lives in the payment provider). */
  priceLabel: string
  tagline: string
  limits: PlanLimits
  highlights: string[]
}

/**
 * Sayabot Cloud plans. Tune the numbers here; prices shown here should match the Stripe prices
 * set in STRIPE_PRICE_PRO / STRIPE_PRICE_TEAM.
 */
export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceLabel: "$0",
    tagline: "Try Sayabot with a few agents.",
    limits: { serverTurnsPerMonth: 300, agents: 3, computers: 0, members: 3 },
    highlights: [
      "Unlimited agents on your Mac",
      "300 server replies a month",
      "3 agents, 3 people",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceLabel: "$12",
    tagline: "For one person who lets agents do real work.",
    limits: { serverTurnsPerMonth: 3_000, agents: 20, computers: 2, members: 5 },
    highlights: [
      "Everything in Free",
      "3,000 server replies a month",
      "20 agents, 2 agent computers",
      "Routines and connectors around the clock",
    ],
  },
  team: {
    id: "team",
    name: "Team",
    priceLabel: "$39",
    tagline: "For a team sharing rooms with agents.",
    limits: { serverTurnsPerMonth: 15_000, agents: null, computers: 10, members: 50 },
    highlights: [
      "Everything in Pro",
      "15,000 server replies a month",
      "Unlimited agents, 10 agent computers",
      "Up to 50 people",
    ],
  },
}

export const PLAN_ORDER: PlanId[] = ["free", "pro", "team"]

export function isPlanId(value: unknown): value is PlanId {
  return value === "free" || value === "pro" || value === "team"
}

/** A paid plan only counts while the subscription is in good standing. */
export function effectivePlan(
  plan: PlanId | null | undefined,
  status: string | null | undefined,
): PlanId {
  if (!plan || plan === "free") return "free"
  return status === "active" || status === "trialing" || status === "past_due" ? plan : "free"
}

export type LimitKind = keyof PlanLimits

export interface LimitCheck {
  allowed: boolean
  used: number
  limit: number | null
}

/** Whether one more of `kind` fits. Self-hosted servers have no limits. */
export function checkLimit(
  edition: Edition,
  plan: PlanId,
  kind: LimitKind,
  used: number,
): LimitCheck {
  if (edition !== "cloud") return { allowed: true, used, limit: null }
  const limit = PLANS[plan].limits[kind]
  return { allowed: limit === null || used < limit, used, limit }
}

/** The next plan up that lifts this limit, for "upgrade to …" prompts. */
export function upgradeFor(plan: PlanId, kind: LimitKind, needed: number): PlanId | null {
  for (const id of PLAN_ORDER.slice(PLAN_ORDER.indexOf(plan) + 1)) {
    const limit = PLANS[id].limits[kind]
    if (limit === null || limit >= needed) return id
  }
  return null
}

/** Calendar month a usage counter belongs to, in UTC: "2026-11". */
export function usageMonth(date = new Date()): string {
  return date.toISOString().slice(0, 7)
}

/** Plain words for a reached limit. */
export function limitMessage(kind: LimitKind, plan: PlanId, limit: number): string {
  const name = PLANS[plan].name
  switch (kind) {
    case "serverTurnsPerMonth":
      return `This workspace has used its ${limit.toLocaleString("en-US")} server replies for this month on the ${name} plan.`
    case "agents":
      return `The ${name} plan includes ${limit} agents.`
    case "computers":
      return limit === 0
        ? `Agent computers are part of the paid plans.`
        : `The ${name} plan includes ${limit} agent computers.`
    case "members":
      return `The ${name} plan includes ${limit} people.`
  }
}
