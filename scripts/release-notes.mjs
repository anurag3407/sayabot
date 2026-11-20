#!/usr/bin/env node
/**
 * Drafts the raw material for the next CHANGELOG entry.
 *
 * It is deliberately not a changelog generator: it groups commits by type and links them, then
 * stops. The published entry is prose about what a user can now do (see docs/reference/operations/
 * changelog.md), and that part is written by a person, not printed by this script.
 *
 *   node scripts/release-notes.mjs                 # commits since the latest tag
 *   node scripts/release-notes.mjs v1.0.32 v1.0.33 # an explicit range
 */
import { execFileSync } from "node:child_process"

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim()
}

function latestTag() {
  try {
    return git(["describe", "--tags", "--abbrev=0"])
  } catch {
    return ""
  }
}

const [, , fromArg, toArg] = process.argv
const from = fromArg || latestTag()
const to = toArg || "HEAD"
const range = from ? `${from}..${to}` : to

// Conventional-commit prefixes, mapped to the changelog sections they belong in once rewritten.
const sections = [
  { key: "feat", title: "Added" },
  { key: "fix", title: "Fixed" },
  { key: "perf", title: "Changed" },
  { key: "refactor", title: "Changed" },
  { key: "security", title: "Security" },
  { key: "chore", title: "Housekeeping" },
  { key: "docs", title: "Docs" },
]

const subjects = git(["log", "--no-merges", "--pretty=format:%h%x09%s", range])
  .split("\n")
  .filter(Boolean)

const groups = new Map(sections.map((s) => [s.key, []]))
const other = []

for (const line of subjects) {
  const [sha, ...rest] = line.split("\t")
  const subject = rest.join("\t")
  const match = /^([a-z]+)(?:\([^)]*\))?!?:\s*(.+)$/i.exec(subject)
  const key = match ? match[1].toLowerCase() : null
  const text = match ? match[2] : subject
  if (key && groups.has(key)) groups.get(key).push(`- ${text} (${sha})`)
  else other.push(`- ${text} (${sha})`)
}

const lines = [
  `<!-- Draft for ${to}. Do not paste this; rewrite it as prose first. -->`,
  `## ${to.replace(/^v/, "")} — ${new Date().toISOString().slice(0, 10)}`,
  "",
  "<!-- One short paragraph: what can a user do now that they could not before. -->",
  "",
]

for (const section of sections) {
  const items = groups.get(section.key)
  if (!items?.length) continue
  lines.push(`### ${section.title}`, "", ...items, "")
}
if (other.length) lines.push("### Uncategorized", "", ...other, "")

lines.push(
  "<!--",
  "Before publishing:",
  "  1. Delete or merge entries that are internal only (chores, lockfile bumps, CI tweaks).",
  "  2. Rewrite each line as an outcome the reader experiences, not as a code change.",
  "  3. Put anything security relevant under Security and cross-link SECURITY.md.",
  "  4. Remove the commit hashes and these comments.",
  "-->",
)

process.stdout.write(`${lines.join("\n")}\n`)
