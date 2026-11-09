import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { requireOrgAdmin } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { deleteVaultSecret, grantSecret, revokeGrant, saveVaultSecret } from "@/lib/actions/vault"
import { ActionForm } from "@/components/ui/action-form"
import { Field, HelpText, Input, Select } from "@/components/ui/field"
import { Section } from "@/components/settings/section"
import { EmptyState } from "@/components/ui/empty"
import { listOrgAgents } from "@/lib/queries"

export const metadata: Metadata = { title: "Secret Vault" }

export default async function VaultSettingsPage({
  params,
}: {
  params: Promise<{ org: string }>
}) {
  const { org: orgSlug } = await params
  const access = await requireOrgAdmin(orgSlug)
  if (!access) notFound()

  const admin = createAdminClient()

  const [{ data: rawSecrets }, { data: rawGrants }, agents] = await Promise.all([
    admin
      .from("vault_secrets")
      .select("id, label, kind, last4, last_used_at, rotated_at, created_at")
      .eq("org_id", access.org.id)
      .order("created_at", { ascending: false }),
    admin
      .from("agent_secret_grants")
      .select("id, agent_id, env_name, placeholder, allowed_hosts, inject, requires_approval, revoked_at, created_at, agents(handle, display_name), vault_secrets(label, last4)")
      .eq("org_id", access.org.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    listOrgAgents(access.org.id),
  ])

  const secrets = rawSecrets ?? []
  const grants = rawGrants ?? []

  return (
    <div className="space-y-8">
      {/* 1. Add Secret */}
      <Section title="Add Secret to Vault" description="Secrets are encrypted with MESH_KEK and never shown in plaintext again. Bots receive capabilities and placeholders only.">
        <ActionForm action={saveVaultSecret} submitLabel="Save Secret to Vault">
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <Field label="Label">
            <Input name="label" placeholder="e.g. GitHub Production Token" required maxLength={80} />
            <HelpText>Human-readable name for this credential.</HelpText>
          </Field>

          <Field label="Secret Kind">
            <Select name="kind" defaultValue="api_token">
              <option value="api_token">API Token</option>
              <option value="basic_auth">Basic Auth (user:password)</option>
              <option value="password">Password</option>
              <option value="header_set">Header Set (JSON)</option>
              <option value="github_app">GitHub App (Private Key / PEM)</option>
            </Select>
          </Field>

          <Field label="Secret Value">
            <Input type="password" name="secretValue" placeholder="Paste credential here..." required />
            <HelpText>Encrypted immediately with AES-256-GCM. We only store the sealed ciphertext and the last 4 characters.</HelpText>
          </Field>
        </ActionForm>
      </Section>

      {/* 2. Stored Vault Secrets */}
      <Section title="Vault Secrets" description="All credentials saved in this workspace.">
        {secrets.length === 0 ? (
          <EmptyState title="No secrets in vault" body="Add credentials above to grant them to bots." />
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {secrets.map((sec) => (
              <div key={sec.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-foreground">{sec.label}</span>
                    <span className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      ••••{sec.last4}
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground uppercase">{sec.kind}</span>
                  </div>
                  <div className="text-xs text-faint mt-0.5">
                    {sec.last_used_at ? `Last used: ${new Date(sec.last_used_at).toLocaleDateString()}` : "Never used yet"}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <ActionForm action={deleteVaultSecret} submitLabel="Delete" submitVariant="secondary">
                    <input type="hidden" name="orgSlug" value={orgSlug} />
                    <input type="hidden" name="secretId" value={sec.id} />
                  </ActionForm>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 3. Grant Secret to Bot */}
      <Section title="Grant Secret to a Bot" description="Bind a vault credential to an agent with an environment variable placeholder and strict host allowlist.">
        <ActionForm action={grantSecret} submitLabel="Grant Secret">
          <input type="hidden" name="orgSlug" value={orgSlug} />

          <Field label="Target Agent">
            <Select name="agentId" required>
              <option value="">Select an agent...</option>
              {agents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  @{ag.handle} ({ag.displayName})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Vault Secret">
            <Select name="secretId" required>
              <option value="">Select a credential...</option>
              {secrets.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.label} (ending in {sec.last4})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Environment Variable Name">
            <Input name="envName" placeholder="e.g. STRIPE_API_KEY" required />
            <HelpText>The bot sees this as an environment variable or tool parameter containing a placeholder.</HelpText>
          </Field>

          <Field label="Allowed Hosts">
            <Input name="allowedHosts" placeholder="api.stripe.com, *.stripe.com" required />
            <HelpText>Comma- or space-separated host patterns. Placeholders sent to any other host will be blocked by the Egress proxy.</HelpText>
          </Field>

          <div className="flex items-center gap-2 pt-1">
            <input type="checkbox" id="requiresApproval" name="requiresApproval" value="true" className="h-4 w-4 rounded border-border text-primary" />
            <label htmlFor="requiresApproval" className="text-xs font-medium text-foreground cursor-pointer">
              Require human approval on first use in each turn
            </label>
          </div>
        </ActionForm>
      </Section>

      {/* 4. Active Grants */}
      <Section title="Active Grants" description="Current secret grants issued to bots in this workspace.">
        {grants.length === 0 ? (
          <EmptyState title="No active grants" body="Issue a grant above to let a bot communicate with external APIs." />
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {grants.map((g: any) => (
              <div key={g.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-foreground">${g.env_name}</span>
                    <span className="text-xs text-muted-foreground">→</span>
                    <span className="text-xs font-medium text-foreground">@{g.agents?.handle || "bot"}</span>
                    <span className="text-xs text-muted-foreground">({g.vault_secrets?.label})</span>
                  </div>
                  <div className="text-xs text-faint mt-1">
                    Allowed hosts: <span className="font-mono">{g.allowed_hosts?.join(", ")}</span>
                  </div>
                  <div className="text-[11px] font-mono text-faint mt-0.5">
                    Placeholder: {g.placeholder?.slice(0, 16)}...
                  </div>
                </div>

                <ActionForm action={revokeGrant} submitLabel="Revoke Grant" submitVariant="secondary">
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="grantId" value={g.id} />
                </ActionForm>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
