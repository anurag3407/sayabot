# Security policy

## Report a vulnerability

Email **sayalabs.studio@gmail.com**. Please do not open a public issue, pull request, or discussion for a security problem. A public report can put people who are running Sayabot at risk before a fix exists.

Include:

- What is affected: the web app, the orchestrator, computerd, egress, the Mac or Windows app, the Android app, or the installer, with the version or commit and the platform
- What you believe the impact is
- Steps to reproduce it on your own account or an isolated server
- A minimal proof of concept, with secrets, tokens, and other people's data removed

Do not send live passwords, API keys, session tokens, or the contents of someone else's room.

If you are writing about someone's conduct rather than a flaw in the software, use [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Same address.

## What to expect

We aim to acknowledge a report within 3 business days, and to keep you posted while we assess it and work on a fix. Please give us a chance to ship a fix before you publish the details. There is no bug bounty.

We will not take legal action against research that:

- Stays within this policy and does not harm other people's data or availability
- Is aimed at a server you run, or at your own account
- Gives us a reasonable time to fix the issue before public disclosure

## Scope

In scope:

- The Sayabot server in this repository (web, orchestrator, computerd, egress)
- Sayabot for Mac and Windows, and the Android app
- The installers and `deploy/`
- The way secrets are sealed, the approval gate, room access control, and the outbound proxy

Out of scope:

- A deployment you do not operate, unless the flaw is in the Sayabot code itself. If you found a problem on someone else's server, tell that operator. If the cause is this project, also tell us.
- Denial-of-service attacks that only require a large volume of traffic
- Social engineering of maintainers or users
- Issues in third-party providers (Supabase, a model provider, an MCP client) with no Sayabot-side cause
- Missing security headers or best-practice notes that do not demonstrate a concrete impact
- Bugs that require the attacker to already hold the server's `MESH_KEK`, the service-role key, or shell access on the host

## How the software is built to limit damage

This is context for reporters, not a promise that every deployment is safe. The operator still has to protect Postgres, the encryption key, and the host.

- Dangerous tools wait for a person. Five minutes with no answer is a rejection, and the decision is stored.
- Provider keys, webhook secrets and connector tokens are sealed with AES-256-GCM under `MESH_KEK`. Agent API keys are stored as hashes.
- Strings are redacted before they are stored or sent to a model.
- Agent computers are confined to `/home/bot` and `/tmp`.
- Outbound HTTP from tools goes through a proxy that blocks private, loopback and link-local addresses.
- Room membership is enforced with Postgres row-level security, and turns for one room take an advisory lock so they cannot run together.

A running server also publishes a short page at `/security`. It describes the code. It is not a certification.

## What this software does not protect

A short and honest list, so nobody assumes more than the code delivers. Each item is explained, with impact and a suggested fix, in [the threat model](docs/reference/architecture/threat-model.md#7-known-gaps). Reporting one of these is useful, but it is not a vulnerability report.

- **The encryption key cannot be rotated.** Envelopes carry no key id, so changing `MESH_KEK` makes stored credentials unreadable. There is no re-encrypt path yet.
- **One key protects every organization.** A deployment shares a single KEK; there is no per-customer key custody.
- **The zero-config host backend is not a container.** `COMPUTER_BACKEND=host` runs agent commands in the operator's account with path checks as the only confinement.
- **Docker computers are identified to the proxy by IP**, with a short cache and a forget-on-restart call. A reused address inside that window could be attributed to the previous agent.
- **Desktop builds are ad-hoc signed.** Windows installers are unsigned, so Gatekeeper and SmartScreen warn, and update integrity rests on HTTPS.
- **No dependency scanning or SBOM in CI**, and no advisory channel beyond this file and the Security section of `CHANGELOG.md`.
- **No shared rate limiting** on the public HTTP surface; connector clients throttle only their own provider calls.
- **Approving a tool is authorized by the web app**, not re-checked against a user role inside the orchestrator, which trusts `ORCHESTRATOR_INTERNAL_SECRET`.
- **Redaction is pattern-based**, plus an exact-value scrubber for the current run. A secret in an unrecognized format can pass.
- **Prompt injection is contained, not eliminated.** Read-only tools can carry injected instructions; the approval gate is the backstop, and it only covers tools marked dangerous.

## Threat model

The [public threat model](docs/reference/architecture/threat-model.md) lists the assets, the trust boundaries, the adversaries considered, the control that answers each threat with the module that implements it, the invariants a change must not weaken, and the gaps above.

## Machine-readable contact

Deployments of the web app serve `/.well-known/security.txt` (RFC 9116) with this same address, from the static file `apps/web/public/.well-known/security.txt`. The `Expires` field there must be refreshed before it passes.
