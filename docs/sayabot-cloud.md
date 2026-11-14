# Running Sayabot Cloud (plans and billing)

Sayabot Cloud is the same code as self-hosted Sayabot, with `SAYABOT_EDITION=cloud`. That one
setting turns on plans, limits and billing. Self-hosted servers leave it unset and never run any
of it. The billing code lives in [`apps/web/src/ee/`](../apps/web/src/ee/) under the
[Sayabot Commercial License](../apps/web/src/ee/LICENSE).

## Plans

Defined in one place: [`packages/core/src/edition.ts`](../packages/core/src/edition.ts) (`PLANS`).

|                        | Free      | Pro ($12) | Team ($39) |
| ---------------------- | --------- | --------- | ---------- |
| Server replies / month | 300       | 3,000     | 15,000     |
| Agents                 | 3         | 20        | unlimited  |
| Agent computers        | —         | 2         | 10         |
| People                 | 3         | 5         | 50         |
| Agents on your Mac     | unlimited | unlimited | unlimited  |

**Server replies** are agent replies that run on the server: the operator's models, a
workspace's API keys, agent computers. Replies that run on someone's Mac (Claude Code / Codex
through Sayabot for Mac) never count, because they cost the server almost nothing. That keeps
Free useful and your costs bounded.

Change the numbers or prices in `PLANS`. Keep the shown prices in step with the Stripe prices.

## Where limits apply

| Limit           | Checked in                                                                                                                          | What people see                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Server replies  | orchestrator, before a server-run turn ([`plans.ts`](../apps/orchestrator/src/plans.ts)); counted atomically by `bump_server_turns` | The agent replies with a friendly note and a link to upgrade. Mac agents keep working. At 80%, admins get a banner. |
| Agents          | creating agents, templates, invited and joining bots                                                                                | "The Free plan includes 3 agents. Upgrade to Pro…"                                                                  |
| Agent computers | creating an agent with a computer                                                                                                   | The agent is still created, without a computer, with a note.                                                        |
| People          | accepting a workspace invite                                                                                                        | "Acme is full on its current plan. Ask an admin to upgrade."                                                        |

A subscription that lapses (canceled, unpaid) falls back to Free. Nothing is deleted. Things
over the limit keep working; only adding more is blocked.

## Stripe setup

1. **Products**: create two products, Pro and Team, each with a monthly recurring price. Copy the
   price IDs.
2. **API key**: Developers → API keys → secret key.
3. **Webhook**: Developers → Webhooks → add endpoint
   `https://YOUR_DOMAIN/api/billing/webhook` with events `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Copy the signing secret.
4. **Customer portal**: Settings → Billing → Customer portal. Allow plan switching between the two
   prices, cancelling, and updating payment methods.
5. Add to `deploy/.env.production`:

   ```bash
   SAYABOT_EDITION=cloud
   STRIPE_SECRET_KEY=sk_live_…
   STRIPE_WEBHOOK_SECRET=whsec_…
   STRIPE_PRICE_PRO=price_…
   STRIPE_PRICE_TEAM=price_…
   ```

6. `./deploy/deploy.sh`. A full deploy is needed, because the edition is also built into the web
   app so it can show the Plan & billing page.

Test first with Stripe's test keys and `stripe listen --forward-to localhost:3000/api/billing/webhook`.

## How a purchase flows

```
Settings → Plan & billing → "Upgrade to Pro"
  → startCheckoutAction → Stripe Checkout (workspace id in metadata)
  → payment → webhook checkout.session.completed → org_plans.plan = pro
  → back to Plan & billing ("Thanks! … moving to Pro")
Later: renewals, plan switches, cancellations → customer.subscription.* webhooks → org_plans
"Manage billing" → Stripe customer portal (invoices, card, switch, cancel)
```

Webhooks are verified with the signing secret (HMAC-SHA256, 5-minute window, constant-time
compare). Unsigned or stale requests are refused. A failure while saving returns 500, so Stripe
retries.

## Data

[`packages/db/sql/0033_cloud_plans.sql`](../packages/db/sql/0033_cloud_plans.sql):

- `org_plans`: one row per paying (or once-paying) workspace. No row means Free.
- `org_usage_monthly`: server replies per workspace per UTC month.
- `bump_server_turns(org, month, limit)`: counts and checks in one statement, so parallel
  turns can't go over the limit.

Members can read their own workspace's rows (RLS). Only the server writes.
