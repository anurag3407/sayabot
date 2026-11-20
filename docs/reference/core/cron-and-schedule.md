# Cron Parsing & Schedule Helpers

These two modules are the math behind Hermes routines and the routine UI. `cron.ts` is a pure, zero-dependency cron engine: it normalizes aliases and natural-language shorthands into standard 5-field cron, parses fields into value sets, computes the next matching instant in any IANA time zone, and renders human-readable descriptions. `schedule.ts` complements it with small time-of-day utilities (minutes-since-midnight, `HH:MM` parsing/formatting, quiet-hours window checks) used by the memory scheduler and routine windows. Neither touches the database — `apps/orchestrator/src/scheduler/routines.ts` and the `cronjob` tool drive them.

Source files: `packages/core/src/cron.ts` (301 lines), `packages/core/src/schedule.ts` (39 lines); tests: `packages/core/src/cron.test.ts`, `packages/core/src/schedule.test.ts`

---

## ⏰ Cron expression parsing (`cron.ts`)

### Stage 1 — `normalizeCronExpression(input)`

Before parsing, input is trimmed, lowercased, and matched against three layers of sugar (`cron.ts:33-78`):

**Aliases** (`ALIASES`, `cron.ts:16-24`):

| Input                  | Cron        |
| :--------------------- | :---------- |
| `@yearly`, `@annually` | `0 0 1 1 *` |
| `@monthly`             | `0 0 1 * *` |
| `@weekly`              | `0 0 * * 0` |
| `@daily`, `@midnight`  | `0 0 * * *` |
| `@hourly`              | `0 * * * *` |

**Natural-language shorthands** (all regex-anchored, so `"daily at 9am"` matches but `"run daily at 9"` does not):

| Pattern                          | Produces      | Examples                                                                    |
| :------------------------------- | :------------ | :-------------------------------------------------------------------------- |
| `every N m\|min\|minutes` (1–59) | `*/N * * * *` | `every 15m` → `*/15 * * * *`, `every 30 minutes` → `*/30 * * * *`           |
| `every N h\|hr\|hours` (1–23)    | `0 */N * * *` | `every 2h` → `0 */2 * * *`                                                  |
| `daily at H[:MM] [am\|pm]`       | `M H * * *`   | `daily at 9am` → `0 9 * * *`, `daily at 14:30` → `30 14 * * *`              |
| `weekday[s] at H[:MM] [am\|pm]`  | `M H * * 1-5` | `weekdays at 9am` → `0 9 * * 1-5`, `weekdays at 10:15 am` → `15 10 * * 1-5` |

Meridiem handling: `pm` adds 12 to hours below 12; `12am` becomes hour 0. Out-of-range hour/minute values fail the match and the input falls through **unchanged** (`return input.trim()`), so a non-matching string is later rejected by `parseCron` with its real reason (wrong field count).

> Note: the JSDoc on this function contains a rendering artifact (`"every 15m" -> "star/15 * * * *"`); the code actually returns `*/15 * * * *` as the table above shows.

### Stage 2 — `parseCron(expr): ParsedCron | null`

Normalizes, splits on whitespace, and requires **exactly 5 fields** (`cron.ts:133-175`). Each field is expanded by `parseField(field, min, max)` (`cron.ts:80-131`), which accepts comma-separated parts of four shapes:

| Shape           | Semantics                      | Notes                                                            |
| :-------------- | :----------------------------- | :--------------------------------------------------------------- |
| `*`             | full range `min..max`          |                                                                  |
| `*/N`           | `min, min+N, …` up to `max`    | non-positive or non-integer step contributes nothing             |
| `A-B` / `A-B/S` | inclusive range, optional step | clamped to the field's legal range; `start > end` yields nothing |
| `V`             | single value                   | must be an integer within range                                  |

Results are de-duplicated (a `Set`) and sorted ascending. Field bounds: minutes 0–59, hours 0–23, days-of-month 1–31, months 1–12, days-of-week 0–7 with **7 normalized to 0 (Sunday)** after parsing. If any field expands to an empty set, the whole expression is invalid.

```typescript
export interface ParsedCron {
  minutes: number[]
  hours: number[]
  daysOfMonth: number[]
  months: number[]
  daysOfWeek: number[]
  originalExpr: string // the normalized (post-alias/shorthand) expression
}
```

**`isValidCron(expr)`** is just `parseCron(expr) !== null` — and because normalization runs first, `"@daily"` and `"every 2h"` are valid cron by this definition.

### Stage 3 — `getNextCronRun(expr, fromDate?, timeZone?)`

```typescript
export function getNextCronRun(expr: string, fromDate = new Date(), timeZone = "UTC"): Date | null
```

(`cron.ts:185-265`) Finds the first matching instant strictly after `fromDate`, searching at most **366 days** ahead (returning `null` past that). The algorithm:

1. Round the timestamp up to the next whole minute (seconds and milliseconds dropped).
2. Render each candidate minute through `Intl.DateTimeFormat` with `timeZone` (default `"UTC"`), `hourCycle: "h23"`, and a weekday short-name → 0–6 map, so DST and offset handling are delegated to the platform instead of hand-rolled.
3. Match day/month with the standard cron **DOM/DOW OR rule**: if _both_ the day-of-month and day-of-week fields are restricted (fewer than all values), a day matching **either** counts; if only one is restricted, it must match; unrestricted means always true.
4. Skip efficiently: month/day miss → jump to next local midnight; hour miss → jump to next hour at minute 00; hour matches but no minute ≥ current minute remains → next hour. Minute match → return that exact `Date`.

The tests pin the arithmetic: from Wednesday `2026-06-10T08:00:00Z`, `0 * * * *` → 09:00 the same day, `30 9 * * *` → 09:30 the same day; and from Friday `2026-06-12T15:00:00Z`, `0 9 * * 1-5` lands on **Monday June 15 at 09:00**, correctly skipping the weekend.

### `humanReadableCron(expr)`

A description table for the UI (`cron.ts:270-301`): exact strings for the common shapes, regex fallbacks for step expressions, and a generic `Cron: <expr>` for anything else.

| Expression                  | Description                    |
| :-------------------------- | :----------------------------- |
| `* * * * *`                 | Every minute                   |
| `0 * * * *`                 | Every hour at minute 0         |
| `0 0 * * *`                 | Daily at midnight              |
| `0 9 * * *`                 | Daily at 09:00                 |
| `0 9 * * 1-5`               | Every weekday at 09:00         |
| `0 0 * * 0` (or `7`)        | Weekly on Sunday at midnight   |
| `0 0 1 * *`                 | Monthly on the 1st at midnight |
| `*/15 * * * *`              | Every 15 minutes               |
| `0 */2 * * *`               | Every 2 hours                  |
| `M H * * 1-5` (other times) | Every weekday at `HH:MM`       |
| `M H * * *` (other times)   | Daily at `HH:MM`               |

### Day matching: the DOM/DOW OR rule

Cron's most surprising corner is how day-of-month and day-of-week interact, and `getNextCronRun` implements the standard Vixie-cron behaviour (`cron.ts:231-239`):

| `daysOfMonth` restricted? | `daysOfWeek` restricted? | A day matches when                      |
| :------------------------ | :----------------------- | :-------------------------------------- |
| no (all 31 values)        | no (all 7 values)        | always (month gate only)                |
| yes                       | no                       | day-of-month matches                    |
| no                        | yes                      | day-of-week matches                     |
| yes                       | yes                      | day-of-month **OR** day-of-week matches |

So `0 9 1 * 1` (midnight-ish 09:00 on the 1st **and** every Monday) fires on both the 1st and Mondays — the OR reading, matching what `man 5 crontab` specifies, not the AND reading some cron implementations choose.

### Field expansion examples

| Field                  | Expansion                                                            |
| :--------------------- | :------------------------------------------------------------------- |
| `*` (hours, 0–23)      | `[0,1,2,…,23]`                                                       |
| `*/10` (minutes)       | `[0,10,20,30,40,50]`                                                 |
| `8-18` (hours)         | `[8,9,…,18]`                                                         |
| `1-5` (days of week)   | `[1,2,3,4,5]`                                                        |
| `1,15` (days of month) | `[1,15]`                                                             |
| `0` (days of week)     | `[0]` — Sunday; a parsed `7` is folded back to `0` and de-duplicated |

## 🗓️ Schedule helpers (`schedule.ts`)

Five tiny pure utilities, all working in **minutes since local midnight** (0–1439):

| Function                             | Behaviour                                                                                                                                                       | Test examples                                                                                              |
| :----------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| `minutesInTimeZone(date, timeZone)`  | Renders the date through `Intl.DateTimeFormat` (`hourCycle: "h23"`) and returns `hour*60 + minute` in that zone                                                 | `2026-10-31T00:00:00Z` → `0` in UTC, `330` in `Asia/Kolkata`                                               |
| `parseTimeToMinutes(value)`          | Accepts strictly `HH:MM` (zero-padded, `00`–`23` hours, `00`–`59` minutes via `/^([01]\d\|2[0-3]):([0-5]\d)$/`); returns `h*60+m` or `null`                     | `"09:30"` → `570`, `"17:05"` → `1025`, `"24:00"` → `null`, `"9:30"` → `null`                               |
| `formatMinutes(minutes)`             | Inverse: normalizes modulo 1440 (negative-safe) and zero-pads                                                                                                   | `570` → `"09:30"`, `1440` → `"00:00"`                                                                      |
| `isWithinWindow(minute, start, end)` | Half-open window check (`start` inclusive, `end` exclusive); `start === end` is always `false`; `start > end` means an **overnight** window that wraps midnight | `600` in `540–660` → `true`; `660` → `false`; `1380` in `1320–120` → `true`; `600` in `1320–120` → `false` |
| `durationLabel(minutes)`             | `"< N` min"`below an hour, otherwise`Hh`plus`m` remainder                                                                                                       | `10` → `"10 min"`, `90` → `"1h 30m"`                                                                       |

`isWithinWindow` is what makes quiet-hours / active-hours routine windows work across midnight: a window `22:00–02:00` stores `start=1320, end=120` and the wrap branch handles the rest.

## 🔗 Where they're consumed

- `apps/orchestrator/src/scheduler/routines.ts` — validates routine expressions with `isValidCron` and computes firings with `getNextCronRun`.
- `apps/orchestrator/src/tools/builtins/cronjob.ts` — the agent-facing `cronjob` tool accepts natural language ("every 2h") because `normalizeCronExpression` runs before validation and storage (`cronjob.ts:80-89`), and renders `humanReadableCron` back to the model.
- The web app (`/cron` page, routines API routes) uses the same functions for previews and the next-run column.
- `minutesInTimeZone`/`isWithinWindow` back the **meetings scheduler**: `apps/orchestrator/src/scheduler/meetings.ts` checks local meeting and check-in windows (`meetings.ts:279-319`), and the web app reuses them in the room meeting bar, the meetings view, and onboarding actions.

## ✅ Test coverage summary

`cron.test.ts` covers the four layers end to end: alias normalization (`@daily`/`@hourly`/`@weekly`), all five NL shorthand forms including meridiem and minute variants, validation acceptance (`*/10 8-18 * * 1-5`, shorthands) and rejection (4 fields, minute `60`, hour `25`, prose), exact next-run computation in UTC including the weekend skip, and the human-readable table above. `schedule.test.ts` covers strict `HH:MM` parsing (rejecting `"24:00"` and unpadded `"9:30"`), round-trip formatting, both normal and overnight windows, timezone minute extraction, and duration labels.

Related docs: [./commands.md](./commands.md), [./turns.md](./turns.md), [./platform-utilities.md](./platform-utilities.md), [./overview-and-types.md](./overview-and-types.md), [./cost-and-plan-limits.md](./cost-and-plan-limits.md)
