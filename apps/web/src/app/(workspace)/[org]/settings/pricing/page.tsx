import type { Metadata } from "next"
import { requireOrgAdmin } from "@/lib/auth"
import { listPricing } from "@/lib/queries"
import { upsertModelPricing } from "@/lib/actions/pricing"
import { ActionForm } from "@/components/ui/action-form"
import { Field, HelpText, Input, Select } from "@/components/ui/field"
import { EmptyState } from "@/components/ui/empty"
import { Section } from "@/components/settings/section"
import { PricingRow } from "@/components/settings/pricing-row"
import { PROVIDER_LABELS } from "@/lib/format"

export const metadata: Metadata = { title: "Pricing" }

export default async function PricingPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  await requireOrgAdmin(orgSlug)
  const pricing = await listPricing()

  return (
    <>
      <Section
        title="Model pricing"
        description="Prices in USD per million tokens. These are used to estimate costs and enforce daily budgets. A model with no row costs $0 and can still run; add it here to make budgets meaningful."
      >
        {pricing.length === 0 ? (
          <EmptyState
            title="No prices configured"
            body="Add a row for each model your agents use. Without a row, usage is recorded but cost stays at zero."
          />
        ) : (
          <>
            <div className="hidden grid-cols-[1fr_110px_110px_auto] gap-2 border-b border-line pb-1 font-mono text-[11px] text-faint sm:grid">
              <span>model</span>
              <span>input / MTok</span>
              <span>output / MTok</span>
              <span className="w-[100px]">save</span>
            </div>
            <div className="divide-y divide-line">
              {pricing.map((price) => (
                <PricingRow
                  key={`${price.provider}/${price.model}`}
                  orgSlug={orgSlug}
                  price={price}
                />
              ))}
            </div>
          </>
        )}
      </Section>

      <Section
        title="Add or update a model"
        description="Prices are shared across the deployment. Updating an existing provider and model overwrites its row."
      >
        <ActionForm action={upsertModelPricing} submitLabel="Save price" resetOnSuccess>
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <div className="grid gap-3 sm:grid-cols-[170px_1fr_110px_110px]">
            <Field label="provider" htmlFor="price-provider">
              <Select id="price-provider" name="provider" defaultValue="openai">
                {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="model id" htmlFor="price-model">
              <Input id="price-model" name="model" required placeholder="gpt-4.1-mini" />
            </Field>
            <Field label="input" htmlFor="price-input">
              <Input
                id="price-input"
                name="inputPerMtok"
                type="number"
                step="0.000001"
                min="0"
                required
                defaultValue="0"
                className="font-mono"
              />
            </Field>
            <Field label="output" htmlFor="price-output">
              <Input
                id="price-output"
                name="outputPerMtok"
                type="number"
                step="0.000001"
                min="0"
                required
                defaultValue="0"
                className="font-mono"
              />
            </Field>
          </div>
          <HelpText>
            The price applies to model ids exactly as typed on the agent. Check the provider's
            current price page before relying on budgets.
          </HelpText>
        </ActionForm>
      </Section>
    </>
  )
}
