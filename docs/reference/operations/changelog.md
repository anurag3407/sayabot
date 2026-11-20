# Changelog & release notes

Every release gets an entry in [`CHANGELOG.md`](../../../CHANGELOG.md) at the repository root, written as prose for the people who run Sayabot. The entry is not a commit dump: a reader should be able to tell whether this release matters to them without opening the diff. Tags are cut per release (`v1.0.32`), and the changelog is the human-readable counterpart to the tag.

Source files: `CHANGELOG.md`, `scripts/release-notes.mjs`, `.github/workflows/desktop-release.yml`

---

## 📝 What an entry contains

| Section             | Use it for                                                                                                                                                  |
| :------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opening paragraph   | The one or two things a user would upgrade for, described as what they can now do. Present tense.                                                           |
| `### Added`         | New surfaces, tools, commands, integrations                                                                                                                 |
| `### Changed`       | Behaviour that is different from the previous release, including anything a user must redo                                                                  |
| `### Fixed`         | User-visible bugs, stated as the symptom that is gone, not the module that was patched                                                                      |
| `### Security`      | Anything affecting the protections in [`SECURITY.md`](../../../SECURITY.md); link the [threat model](../architecture/threat-model.md) gap if one was closed |
| `### Upgrade notes` | Only when the operator must act: a new env var, a migration that needs care, a behaviour removed                                                            |

Rules of thumb:

- Write `You can now ask a room to…`, not `feat(orchestrator): add endpoint`.
- One line per outcome. If a line needs a file path to make sense, it belongs in `docs/reference/`, not here.
- Leave out internal chores (lockfile bumps, lint fixes, CI tweaks) unless they change what a user can do.
- If a release only fixes things, say so in the first line instead of inventing a headline.
- Never describe a security fix vaguely enough to hide an unfixed gap; if a report is still being worked on, say nothing rather than something untrue.

---

## 🔁 The release loop

1. **Draft the raw material.**

   ```bash
   node scripts/release-notes.mjs                  # since the latest tag
   node scripts/release-notes.mjs v1.0.32 v1.0.33  # explicit range
   pnpm release:notes                              # same, via the root script
   ```

   The script groups commits by conventional-commit prefix and prints a Markdown skeleton with commit hashes and instructions in comments. It does not decide what matters.

2. **Rewrite the skeleton into prose.** Delete internal items, merge related ones, and put the two or three changes a user would care about in the opening paragraph. Remove every commit hash and HTML comment.

3. **Prepend it to `CHANGELOG.md`**, newest first, under a `## <version> — <YYYY-MM-DD>` heading. Move anything not yet released out of `## Unreleased`.

4. **Cut the tag and publish the release** with the same prose as the release body, so the repository, the releases page and the download page tell one story.

5. **If the release contains a security fix**, add a GitHub Security Advisory when the severity warrants it and cross-reference the entry. A `Security` section with no advisory is fine for low-severity hardening; silence is not.

---

## 🧾 Version numbering

- The version in a tag matches the desktop app's `version`, which the update check compares against.
- The mobile app carries its own version (`1.2.x`) because OTA updates pin a `runtimeVersion` to it; a mobile bump appears in the same changelog entry as the release that shipped it.
- Patches on the same day are legitimate (see `1.0.29`–`1.0.32`), but they should still each say something true and specific. If two tags ship within minutes, a single entry covering both is better than two empty ones.

---

## Related docs

- [`CHANGELOG.md`](../../../CHANGELOG.md) — the entries themselves
- [Security policy](../../../SECURITY.md) — what a `Security` entry refers to
- [Threat model](../architecture/threat-model.md) — the gaps an entry may close
- [Deployment](../operations/deployment.md) — the upgrade path an `Upgrade notes` section warns about
