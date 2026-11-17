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

## Machine-readable contact

Deployments of the web app serve `/.well-known/security.txt` (RFC 9116) with this same address.
