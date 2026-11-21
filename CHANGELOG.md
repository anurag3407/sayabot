# Changelog

Release notes for Sayabot, written for the people who run it: what changed in the product, what they can now do, and what they have to do about it. Fixes are grouped by what they fixed rather than by the commit that fixed them.

Version numbers follow the desktop app and the tag names in the repository (`v1.0.32`). Entries are newest first. A `Security` section means a change in this repository's protections — see [SECURITY.md](SECURITY.md) and the [threat model](docs/reference/architecture/threat-model.md). To draft the next entry see [docs/reference/operations/changelog.md](docs/reference/operations/changelog.md).

## Unreleased

**Run Sayabot with no database and no Docker.** A new zero-config mode keeps everything on one machine: an embedded Postgres (PGlite), a host sandbox under `~/.sayabot`, and a local workspace page the desktop app opens on launch. Nothing needs a Supabase project to try the product. Use `COMPUTER_BACKEND=host` only on a machine you trust — it is not a container (see [G4](docs/reference/architecture/threat-model.md#7-known-gaps)).

**Agents stop repeating themselves.** A redirect loop breaker ends a run that keeps bouncing between the same steps instead of spending the room's budget on it.

**A room keeps answering when one account runs dry.** A bot can name a second model on its own provider key; when the first reports an exhausted balance, the same turn is answered on the fallback and the dry model is skipped for 15 minutes instead of being retried on every message. See [quota takeover](docs/reference/orchestrator/engine/engine-takeover.md).

**Approvals can be remembered for one exact call.** Allowing a call with "always allow this one" saves it for that tool and those exact arguments for 24 hours, so the same test command or commit stops asking. Credential reads, sends, installs, deletions and money tools never qualify. See [standing grants](docs/reference/orchestrator/tools/standing-grants.md).

**A wedged turn is stopped and explained.** A turn that shows no activity for 20 minutes — or two hours while one of its tools is running — is stopped with a note in the chat, instead of holding its room. See [stall watchdog](docs/reference/orchestrator/engine/engine-watchdog.md).

**Managed Supabase schemas bootstrap cleanly.** Creating the schema on a hosted Supabase project no longer fails on permission differences between managed and local Postgres.

**The container agent starts as the low-privilege user.** Privilege dropping now happens in the standalone `agentd` entrypoint, so a computer that is started outside the normal launcher still runs as `bot`.

**`sayabot` command-line tool.** `@sayabot/cli` adds `sayabot mcp` (a stdio MCP server that lets a local agent drive a room through the orchestrator) and one-shot commands — `sayabot check-in`, `inbox`, `rooms`, `post`, `tools`, `call` — for scripts and terminals. Same agent key, same scopes. See [the CLI doc](docs/reference/cli/overview.md).

**Security.** The public [threat model](docs/reference/architecture/threat-model.md) and the known-gaps list in [SECURITY.md](SECURITY.md) are published, and the web app serves `/.well-known/security.txt` with the same contact address.

## 1.0.32 — 2026-11-20

A cleanup release for the landing page and the desktop build number.

- The hero section no longer offers a terminal command; the download buttons are the only call to action.
- The desktop app reports 1.0.31 internally so the update check matches the published build.

## 1.0.31 — 2026-11-20

**Onboarding that finishes.** First-run setup now completes: creating the first workspace, picking a model provider, and landing in a room no longer dead-ends halfway through.

## 1.0.30 — 2026-11-20

**The desktop app stays on your install.** The local workspace no longer redirects to the public landing page, and a leftover cloud session from an earlier build is no longer picked up after you have moved to a self-hosted server.

## 1.0.29 — 2026-11-20

**Self-hosting without the hosted service.** Sayabot no longer assumes a cloud backend at runtime. Deployments that point at their own Postgres, their own storage and their own orchestrator work end to end, and the connector layer gained the test suites that prove it.

## 1.0.28 — 2026-11-20

**The Android app is on the release page.** Each push now attaches the newest APK to the latest release and syncs the existing ones, so the download link on the site always resolves to a build that installs.

## 1.0.27 — 2026-11-20

The largest release so far. Pick the parts you care about.

**Voice.** Speak to a room and hear it answer: multi-provider text to speech, audio calls where the room takes turns, recorded voice notes, and dictation in the composer. Providers can be swapped per workspace.

**Search you configure.** Settings now holds search providers with a credit check, so you can see what a key has left before an agent spends it, plus a per-agent choice of which search backend to use.

**Mobile matches desktop.** Mascots, radial halos and ambient depth were rebuilt on the phone so the two clients look like the same product; the Android build moved to 1.2.2 with updated icons.

**Landing page.** A sponsor section and launch banner, a radial tools constellation, and SEO/GEO metadata for `sayabot.tech`, deployed to Cloudflare Pages on push.

**Packaging.** The DMG now ships a clean solid background and transparent app icons.

Fixed in the same release: bot invites that silently failed to add the agent to the room, memory leaks in long-lived room windows, and a lint break that blocked the release workflow.

## 1.0.26 — 2026-11-18

**A first launch that explains itself.** The first-run experience and the server setup flow were rewritten: what to connect, why, and what happens if you skip it.

## 1.0.25 — 2026-11-17

**Ask to join a workspace.** Instead of needing an invitation link, someone with an account can request access to a workspace and an admin approves it.

Alongside it: a reworked plan ring in the sidebar, and updated security and code-of-conduct policies.

## 1.0.24 — 2026-11-17

**You can see the model think.** Reasoning is captured as thinking blocks you can open in the message, folded away by default.

**Room identity.** A room's agent identities and mascots can be previewed and customized, so a room full of bots does not read as four identical avatars.

## 1.0.23 — 2026-11-17

**More computers, more skills.** Computer providers are now selectable per agent, and skills can be managed from the same place, so the machine an agent runs on and what it is allowed to do are configured together.

## 1.0.22 — 2026-11-16

**Memory you can read.** A Memory panel shows the notes and decisions a room has accumulated, instead of leaving them buried in the database.

The workspace switcher also lost a stale role prop, so it renders correctly during onboarding.

## 1.0.21 — 2026-11-16

**Saya gets a body.** The mascot's geometry and SVG assets became a shared package, so the web app, landing page, desktop app, mobile app and brand exports all draw the same character.

## 1.0.20 — 2026-11-16

**Rooms got better at teamwork.** Agent management inside a room, clearer organization display, and a sidebar that puts the workspace where you look for it.

**The phone got a model picker**, so chat and agent pages can choose a model without going back to the web app.

## 1.0.3 – 1.0.19

The first public releases: rooms with multiple agents and humans, the Postgres advisory lock that keeps one room's turns in order, the Docker computer sandbox, the egress proxy that keeps credentials out of the model, connector grants, and the Mac, Windows and Android builds.
