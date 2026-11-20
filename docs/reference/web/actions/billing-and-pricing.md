# Billing, Plans & Pricing

Billing is an enterprise-edition (`src/ee/billing`) feature of Sayabot Cloud only: workspaces buy Pro/Team subscriptions through Stripe, plans land in the `org_plans` table via verified webhooks, and every quantity-limited feature (agents, members, computers, server turns) is gated by `planGate` from `lib/plan-limits.ts`. On self-hosted servers (the default edition) all checks pass and billing actions refuse to run.

Source files: `apps/web/src/ee/billing/actions.ts`, `apps/web/src/ee/billing/service.ts`, `apps/web/src/ee/billing/stripe.ts`, `apps/web/src/ee/billing/billing-view.tsx`, `apps/web/src/lib/actions/pricing.ts`, `apps/web/src/lib/plan-limits.ts`

---

## ☁️ Edition gating

`edition()` (`apps/web/src/lib/env.ts:105`) reads the deployment edition from env — `self-hosted` (default) or `cloud`. Everything on this page is aware of it:

- Billing actions fail with "Plans are only on Sayabot Cloud." outside cloud (`ee/billing/actions.ts:30`).
- `planGate` short-circuits to `{ ok: true }` without touching the database on self-hosted (`lib/plan-limits.ts:89`).
- The license notice in each EE file points at `src/ee/LICENSE` (Sayabot Commercial License).

---

## 🔌 Minimal Stripe client (`ee/billing/stripe.ts`)

Sayabot calls Stripe's REST API directly — no Stripe SDK (`stripe.ts:4`):

- `stripeForm(params)` (`stripe.ts:14`) — Stripe's form encoding, expanding nested objects and arrays into `a[b][0]=c` style keys.
- `stripe<T>(path, params?, method?)` (`stripe.ts:36`) — `POST`/`GET` to `https://api.stripe.com/v1` with `Bearer STRIPE_SECRET_KEY`, header `stripe-version: 2024-06-20`, 15-second timeout, `cache: "no-store"`. Missing key → `StripeError("Billing isn't set up on this server (STRIPE_SECRET_KEY).", 500)`; API errors surface `data.error.message` with the HTTP status.
- `verifyStripeSignature(payload, header, secret, now?, toleranceSeconds = 300)` (`stripe.ts:66`) — checks the `Stripe-Signature` header (`t=…,v1=…`): HMAC-SHA256 over `"${timestamp}.${payload}"` with `STRIPE_WEBHOOK_SECRET`, timestamps within five minutes, hex signatures compared with `timingSafeEqual`.

---

## 💳 Checkout, portal, webhooks (`ee/billing/service.ts`)

### Price mapping

`priceFor(plan)` / `planForPrice(priceId)` (`service.ts:11`) map between plan ids (`pro` | `team`) and the configured prices `STRIPE_PRICE_PRO` / `STRIPE_PRICE_TEAM`. `billingConfigured()` (`service.ts:25`) is true only when all four env vars are set: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM`.

### `createCheckout(input)` (`service.ts:34`)

Creates a subscription Checkout session for one workspace:

- `mode: "subscription"`, one `line_item` for the plan's price.
- `client_reference_id: orgId` and metadata `{ org_id, plan }` on both the session and the subscription — this is how webhooks later attribute the plan.
- Customer reuse: an existing `customerId` wins, otherwise `customer_email` pre-fills checkout.
- `allow_promotion_codes: true`; `success_url` = `/<orgSlug>/settings/billing?upgraded=<plan>`, `cancel_url` = `...?canceled=1`.
- Returns the session `url` for the browser to open.

### `createPortal(customerId, returnUrl)` (`service.ts:63`)

Creates a Stripe billing-portal session with `return_url` = `/<orgSlug>/settings/billing` — invoices, cards, plan changes and cancellation all live in Stripe's portal.

### Webhook application (`applyStripeEvent`, `service.ts:122`)

Called from `app/api/billing/webhook/route.ts` after signature verification (see the webhooks & OAuth API reference). Three event types are handled, everything else is ignored:

- `checkout.session.completed` — resolves the org from `metadata.org_id` or `client_reference_id`, fetches the subscription with `GET /subscriptions/:id`, and saves the plan.
- `customer.subscription.created` / `.updated` / `.deleted` — resolves the org from subscription metadata or `orgForCustomer(customerId)` (a lookup over `org_plans.customer_id`, `service.ts:87`), then saves with `ended = true` for deletions.
- `savePlan(orgId, sub, ended?)` (`service.ts:96`) — upserts `org_plans` keyed on `org_id`: plan from the price id, then subscription metadata, defaulting to `free`; `status` becomes `"canceled"` on deletion; stores `provider: "stripe"`, `customer_id`, `subscription_id`, `current_period_end` (seconds → ISO), and `cancel_at_period_end`.

---

## 🛒 Billing actions (`ee/billing/actions.ts`)

- `startCheckoutAction({ orgSlug, plan })` (`actions.ts:26`) — org-admin. Guards: cloud edition, `billingConfigured()`, and the plan must be a valid `PlanId` other than `free` ("Pick Pro or Team." — `actions.ts:32`). If the workspace already pays (`plan !== "free"` with a `customerId`) it opens the **portal** instead — plan changes and cancellations happen there (`actions.ts:37`). Otherwise it creates checkout with the caller's email and the public origin derived from the request headers via `getPublicOrigin(new Request(...))` (`actions.ts:15`). Stripe failures become friendly messages: `StripeError` → "Payment provider: …", anything else → "Couldn't reach the payment provider. Try again in a moment." (`actions.ts:20`). Success returns `data.url`, which the client navigates to.
- `openBillingPortalAction({ orgSlug })` (`actions.ts:64`) — org-admin; requires a paying workspace ("This workspace hasn't paid for a plan yet."); returns the portal URL.

---

## 🪟 Billing UI (`ee/billing/billing-view.tsx`)

`BillingView({ orgSlug, plan, paying, configured, usage })` (`billing-view.tsx:59`) is the client component for the Plan & billing settings page:

- **Usage meters**: each `UsageRow { label, used, limit, hint? }` renders a progress bar via the `Meter` component (`billing-view.tsx:20`) — amber at ≥ 80% of the limit, red at 100%; `limit: null` renders "· unlimited".
- **Plan cards** iterate `PLAN_ORDER` / `PLANS` from `@sayabot/core`, showing name, `priceLabel` ("/ month"), tagline, and highlights. Every highlight stays checked (it is part of the plan) and is labeled **Coming soon**. A warning above the cards says Sayabot Cloud is coming soon, and that agents on your Mac and a server you host work today. The current plan is marked "your plan" with a disabled "Current plan" button. Other plans show a disabled "Coming soon" button and do not open checkout. Someone already paying can still open "Manage billing" for the Stripe portal.
- All buttons call the server actions inside `startTransition` and `window.location.assign(result.data.url)` on success; failures render in an `InlineAlert`.
- When Stripe env vars are missing, a warning banner says billing isn't set up on this server (`billing-view.tsx:105`).

---

## 📏 Plan gating (`lib/plan-limits.ts`)

The gate used by the agent/invite/computer actions (see the other action references):

- `workspacePlan(orgId)` (`plan-limits.ts:28`) — reads `org_plans` and normalizes with `effectivePlan(plan, status)` (e.g. past-due or canceled subscriptions degrade to `free`); returns `{ plan, status, currentPeriodEnd, cancelAtPeriodEnd, customerId }`.
- `workspaceUsage(orgId)` (`plan-limits.ts:50`) — counts what plans limit: `server_turns` from `org_usage_monthly` for `usageMonth()`, plus head-counts of `agents`, `org_members`, and `agent_computers` in the org.
- `planGate(orgId, kind)` (`plan-limits.ts:88`) — cloud-only. Kinds (`LimitKind` from `@sayabot/core`): `serverTurnsPerMonth`, `agents`, `members`, `computers` (mapped to usage keys at `plan-limits.ts:74`). Runs `checkLimit("cloud", plan, kind, used)`; when denied it builds a ready-to-show message: `limitMessage(kind, plan, limit)` plus either "Upgrade to \<name\> in Settings → Plan & billing." (`upgradeFor` finds the cheapest sufficient plan) or "This is the largest plan; contact us for more." — and returns `{ ok: false, message, plan, upgradeTo }`.

Callers across the actions: `planGate(orgId, "agents")` before creating agents/bots and bot keys, `"members"` when an admin approves a join request, `"computers"` when a bot wants the computer capability.

---

## 💲 Model pricing table (`lib/actions/pricing.ts`)

`upsertModelPricing(_prev, formData)` (`pricing.ts:8`) — org-admin form action for the per-model price overrides shown on usage/pricing pages: `provider` + `model` required, `inputPerMtok` / `outputPerMtok` are `z.coerce.number()` in 0–10,000. Upserts into `model_pricing` with `onConflict: "provider,model"`, stamps `updated_at`, audits `pricing.updated` (metadata: input/output prices), revalidates, returns "Price saved".

---

## ⚙️ Environment variables

| Variable                                 | Purpose                                                                    |
| :--------------------------------------- | :------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`                      | Stripe REST auth (`stripe.ts:41`).                                         |
| `STRIPE_WEBHOOK_SECRET`                  | Webhook signature verification (`stripe.ts` + the webhook route).          |
| `STRIPE_PRICE_PRO` / `STRIPE_PRICE_TEAM` | Price ids mapping plans (`service.ts:11`).                                 |
| `SAYABOT_EDITION` / edition env          | `edition()` (`lib/env.ts:105`) — billing and limits only apply on `cloud`. |

The webhook endpoint itself is `POST /api/billing/webhook` (plain-text mention: documented in the webhooks & OAuth API reference together with the other inbound endpoints).

---

## 📄 The `org_plans` row

Everything billing reads and writes lives in one row per workspace (upsert keyed on `org_id`), written by `savePlan` (`service.ts:96`) and read by `workspacePlan` (`plan-limits.ts:28`):

| Column                            | Meaning                                                                                                                  |
| :-------------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| `plan`                            | `pro` \| `team` \| `free` — from the price id, then subscription metadata, defaulting to `free`; deletions write `free`. |
| `status`                          | Stripe's subscription status verbatim (`active`, `trialing`, `past_due`, `canceled`, …); deletions force `canceled`.     |
| `provider`                        | Always `"stripe"`.                                                                                                       |
| `customer_id` / `subscription_id` | Stripe ids; `subscription_id` is cleared when ended.                                                                     |
| `current_period_end`              | Seconds → ISO timestamp, taken from the subscription item first.                                                         |
| `cancel_at_period_end`            | Boolean straight from Stripe.                                                                                            |
| `updated_at`                      | Touched on every save.                                                                                                   |

`workspacePlan` passes the pair through `effectivePlan(plan, status)` from `@sayabot/core`, so an unpaid or canceled subscription degrades to the free plan even before the deletion event arrives.

## 📣 Where gates fire in practice

| Call site                                                  | Gate                           | Effect when denied                                                                                                                                                     |
| :--------------------------------------------------------- | :----------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createAgent` / `createBotAction` (`actions/agents.ts`)    | `planGate(orgId, "agents")`    | Action fails with the plan message.                                                                                                                                    |
| `createBotAction` computer capability                      | `planGate(orgId, "computers")` | Bot is still created; `capabilities.computer` dropped and `warning` attached.                                                                                          |
| `decideJoinRequestAction` (`actions/workspace-invites.ts`) | `planGate(orgId, "members")`   | "`<org>` is full on its current plan. Ask an admin to upgrade it in Settings → Plan & billing." The seat is checked when the admin approves, not when the person asks. |
| `createRoomBotKey` (`actions/invites.ts`)                  | `planGate(orgId, "agents")`    | Room key creation refused.                                                                                                                                             |

The gate message is composed once in `planGate`: `limitMessage(kind, plan, limit)` (what the plan includes) plus either the upgrade pointer (`upgradeFor` finds the cheapest plan that admits `used + 1`) or "This is the largest plan; contact us for more." — with `data.plan` and `data.upgradeTo` attached for UI affordances.

## 🧮 Webhook event → effect

| Stripe event                                 | `applyStripeEvent` behavior (`service.ts:122`)                                                                                                                                                  |
| :------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkout.session.completed`                 | Org from `metadata.org_id` or `client_reference_id`; subscription fetched via `GET /subscriptions/:id`; `savePlan` writes the paid plan. Missing ids → "ignored: no workspace or subscription". |
| `customer.subscription.created` / `.updated` | Org from subscription metadata or the customer lookup; `savePlan` upserts status, period end and `cancel_at_period_end`. Unknown customer → "ignored: unknown customer".                        |
| `customer.subscription.deleted`              | Same path with `ended = true` → plan `free`, status `canceled`, `subscription_id` cleared.                                                                                                      |
| anything else                                | "ignored: \<type\>" — the route still answers `{ received: true }` so Stripe does not retry.                                                                                                    |

A database failure while saving throws, which the route converts into HTTP 500 so Stripe retries later rather than the payment being lost.

## 🧩 `PlanGate` shape

`planGate` returns `{ ok: true }` or `{ ok: false, message, plan, upgradeTo }` (`plan-limits.ts:81`), so callers can do more than fail: `createBotAction` merges the message into `warning` and keeps going, while most others `fail(message)` with the exact user-facing copy. `upgradeTo` is `null` on the top plan, which is how the UI knows to say "contact us" instead of linking to checkout.
---

Related docs: [Editions & licensing](../../architecture/editions-and-licensing.md), [Configuration](../../architecture/configuration.md), [Settings UI](../pages/settings-ui.md)
