import type { Metadata } from "next"
import { requireOrgAdmin } from "@/lib/auth"
import { listProviderKeys } from "@/lib/queries"
import { saveProviderKey } from "@/lib/actions/keys"
import { PROVIDER_LABELS } from "@/lib/format"
import { ActionForm } from "@/components/ui/action-form"
import { Field, HelpText, Input, Select } from "@/components/ui/field"
import { EmptyState } from "@/components/ui/empty"
import { Section } from "@/components/settings/section"
import { DeleteKeyButton, TestKeyButton } from "@/components/settings/key-actions"
import { AIConnectorsBanner } from "@/components/settings/ai-connectors-section"

export const maxDuration = 60

export const metadata: Metadata = { title: "Provider keys" }

export default async function KeysPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAdmin(orgSlug)
  const keys = await listProviderKeys(access.org.id)

  return (
    <>
      <AIConnectorsBanner />
      <Section
        title="Provider keys"
        description="API keys let your agents use an AI model. They are encrypted when saved, and only the last four characters can be seen afterwards."
      >
        {keys.length === 0 ? (
          <EmptyState
            title="No provider keys"
            body="Add a key below, then choose it when you create an agent. Agents need a key to reply."
          />
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {keys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-text">{key.label}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-faint">
                    {PROVIDER_LABELS[key.provider] ?? key.provider} · •••• {key.last4}
                    {key.baseUrl ? ` · ${key.baseUrl}` : ""}
                  </p>
                </div>
                <TestKeyButton orgSlug={orgSlug} keyId={key.id} provider={key.provider} />
                <DeleteKeyButton orgSlug={orgSlug} keyId={key.id} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Add a key"
        description="Paste a key from your provider. For Ollama, LM Studio or a similar server, choose OpenAI-compatible and enter its base URL."
      >
        <ActionForm action={saveProviderKey} submitLabel="Save key" resetOnSuccess>
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
            <Field label="provider" htmlFor="provider">
              <Select id="provider" name="provider" defaultValue="openai">
                {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="label" htmlFor="key-label" hint="shown in agent settings">
              <Input id="key-label" name="label" required maxLength={60} placeholder="production OpenAI" />
            </Field>
          </div>
          <Field label="api key" htmlFor="api-key" hint="never shown again">
            <Input
              id="api-key"
              name="apiKey"
              type="password"
              required
              autoComplete="off"
              placeholder="sk-…"
            />
          </Field>
          <Field label="base url" htmlFor="base-url" hint="only for OpenAI-compatible servers">
            <Input id="base-url" name="baseUrl" placeholder="http://localhost:11434/v1" />
          </Field>
          <HelpText>
            Use Test after saving to check that it works. If you delete a key, agents using it stop
            replying until you give them another one.
          </HelpText>
        </ActionForm>
      </Section>
    </>
  )
}
