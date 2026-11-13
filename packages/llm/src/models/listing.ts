import { findCatalogModel, modelCatalog, modelKey, type ModelCatalog } from "./models-dev"

/**
 * Which models a picker leads with, worked out from release dates instead of a hand-kept list.
 *
 * `new`: released in the last week; the picker labels it. `older`: a newer model of the same line
 * (models.dev's `family`) or a newer line of the same service is out, so the picker folds it under
 * Older models. No listing: a plain row. Nothing is hidden: older models stay one click away.
 *
 * The rule follows OpenBot's model visibility: a short list shows everything; a long one shows the
 * newest release of each of the newest families, a fair share per service so a reseller with
 * hundreds of models does not push out the rest. A model models.dev has not dated yet but that is
 * a newer version of a dated one (`claude-opus-6` next to `claude-opus-5-5`) leads its family
 * instead of being folded, because models.dev adds a release some days after providers list it.
 */
export type ModelListing = "new" | "older"

export interface ModelListingInfo {
  listing?: ModelListing
  /** `YYYY-MM-DD` from models.dev, or inferred for a newer version it has not listed yet. */
  releaseDate?: string
}

const DAY_MS = 24 * 60 * 60 * 1000
/** A list this long or shorter shows every model. */
export const LISTING_SHORT_LIST = 5
/** How many of the newest families a long list leads with, shared out between its services. */
export const LISTING_NEWEST_FAMILIES = 12
/** Each service gets at least this many families. */
export const LISTING_FAMILIES_PER_SERVICE = 4
/** A family this much older than its service's newest family is a past generation. */
export const LISTING_FAMILY_AGE_LIMIT_MS = 120 * DAY_MS
/** A model is labelled New for this long after its release date. */
export const LISTING_NEW_MS = 7 * DAY_MS

/** Ids that stand for "whatever the engine picks", never a model of their own. */
const PSEUDO_IDS = new Set(["", "default", "auto"])

interface Dated {
  id: string
  date: string
  family: string
  service: string
}

/** `openai/gpt-6:free` → `openai`; a bare id has no service. */
function serviceOf(id: string): string {
  const slash = id.lastIndexOf("/")
  return slash > 0 ? id.slice(0, slash).toLowerCase() : ""
}

function bareOf(id: string): string {
  const slash = id.lastIndexOf("/")
  return modelKey((slash >= 0 ? id.slice(slash + 1) : id).replace(/:free$/i, ""))
}

/** The id with its version numbers taken out: `claude-opus-#-#`. Ids of one shape are one line. */
function shapeOf(id: string): string {
  return bareOf(id).replace(/\d+/g, "#")
}

function versionOf(id: string): number[] {
  return (bareOf(id).match(/\d+/g) ?? []).map(Number)
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0)
    if (difference) return difference
  }
  return 0
}

function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

const dateMs = (date: string) => Date.parse(`${date}T00:00:00Z`)

/**
 * Listings for one provider account's models, keyed by model id. Models in `inUse` are never
 * folded: an agent running on one must not lose it from view.
 */
export function modelListings(
  provider: string | null,
  models: readonly { id: string }[],
  options: { inUse?: ReadonlySet<string>; now?: number; catalog?: ModelCatalog } = {},
): Map<string, ModelListingInfo> {
  const catalog = options.catalog ?? modelCatalog().get()
  const now = options.now ?? Date.now()
  const inUse = options.inUse ?? new Set<string>()
  const real = models.filter((m) => !PSEUDO_IDS.has(m.id.trim().toLowerCase()))

  const dated = new Map<string, Dated>()
  const undated: string[] = []
  for (const { id } of real) {
    const known = findCatalogModel(catalog, provider, id.replace(/:free$/i, ""))
    if (known?.release_date) {
      dated.set(id, {
        id,
        date: known.release_date,
        family: known.family ?? shapeOf(id),
        service: serviceOf(id),
      })
    } else undated.push(id)
  }

  // A newer version models.dev has not dated yet leads its family; an older one folds with it.
  const knownDated = [...dated.values()]
  for (const id of undated) {
    const service = serviceOf(id)
    const shape = shapeOf(id)
    const sameLine = knownDated.filter((d) => d.service === service && shapeOf(d.id) === shape)
    if (!sameLine.length) continue
    const version = versionOf(id)
    const below = sameLine
      .filter((d) => compareVersions(versionOf(d.id), version) <= 0)
      .sort((a, b) => compareVersions(versionOf(b.id), versionOf(a.id)))
    const newest = sameLine.reduce((a, b) => (a.date >= b.date ? a : b))
    const isNewest =
      below.length === sameLine.length &&
      compareVersions(version, versionOf(below[0]?.id ?? "")) > 0
    dated.set(id, {
      id,
      date: isNewest
        ? shiftDay(newest.date, 1)
        : (below[0]?.date ?? sameLine[0]?.date ?? newest.date),
      family: newest.family,
      service,
    })
  }

  const out = new Map<string, ModelListingInfo>()
  if (!dated.size) return out

  // Which dated models lead: all of them on a short list, else the newest of the newest families.
  const shown = new Set<string>()
  if (real.length <= LISTING_SHORT_LIST) {
    for (const id of dated.keys()) shown.add(id)
  } else {
    const families = new Map<string, { service: string; newest: string; members: Dated[] }>()
    for (const d of dated.values()) {
      const key = `${d.service}\u0000${d.family}`
      const family = families.get(key)
      if (family) {
        family.members.push(d)
        if (d.date > family.newest) family.newest = d.date
      } else families.set(key, { service: d.service, newest: d.date, members: [d] })
    }
    const services = new Map<string, Array<{ newest: string; members: Dated[] }>>()
    for (const family of families.values()) {
      const list = services.get(family.service)
      if (list) list.push(family)
      else services.set(family.service, [family])
    }
    const perService = Math.max(
      LISTING_FAMILIES_PER_SERVICE,
      Math.floor(LISTING_NEWEST_FAMILIES / services.size),
    )
    for (const list of services.values()) {
      list.sort((a, b) => (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : 0))
      const newestOfService = dateMs(list[0]?.newest ?? "1970-01-01")
      list
        .filter((family) => newestOfService - dateMs(family.newest) <= LISTING_FAMILY_AGE_LIMIT_MS)
        .slice(0, perService)
        .forEach((family) => {
          for (const member of family.members)
            if (member.date === family.newest) shown.add(member.id)
        })
    }
  }

  for (const d of dated.values()) {
    const age = now - dateMs(d.date)
    const lead = shown.has(d.id) || inUse.has(d.id)
    const listing: ModelListing | undefined = !lead
      ? "older"
      : age >= -DAY_MS && age < LISTING_NEW_MS
        ? "new"
        : undefined
    out.set(d.id, { releaseDate: d.date, ...(listing ? { listing } : {}) })
  }
  return out
}
