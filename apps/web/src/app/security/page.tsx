import type { Metadata } from "next"
import { DocList, DocPage, DocSection } from "@/components/public/doc-page"

export const metadata: Metadata = { title: "Security · Sayabot" }

export default function SecurityPage() {
  return (
    <DocPage
      eyebrow="security"
      title="Security and privacy"
      lede="How the code in this repository handles access, secrets and dangerous actions. A deployment is only as strong as the operator's Supabase, hosting and provider configuration."
    >
      <DocSection title="Access">
        <DocList
          items={[
            "Supabase Auth provides sessions and email or Google sign-in.",
            "Row level security limits room reads to room members, plus public rooms in an organization the account belongs to.",
            "Provider key ciphertext and agent key hashes are not exposed to the authenticated role; safe views expose only labels, providers and the last four characters.",
            "The orchestrator and web server use the service role only on the server, after checking membership and roles in code.",
          ]}
        />
      </DocSection>
      <DocSection title="Secrets">
        <DocList
          items={[
            "BYOK provider keys, webhook secrets, MCP headers and tool connection strings use AES-256-GCM with a fresh IV and secret KEK.",
            "Agent API keys are shown once and stored as SHA-256 hashes with a short lookup prefix.",
            "Outbound webhooks are signed with HMAC-SHA256 and a five-minute timestamp tolerance.",
            "Model, bot and tool output passes through secret redaction before it is stored or broadcast.",
          ]}
        />
      </DocSection>
      <DocSection title="Dangerous actions">
        <p>
          Tools marked dangerous wait for a room admin's decision before they execute. The wait uses
          a database notification channel and a five-minute timeout that counts as a rejection. The
          built-in GitHub commit action is always dangerous; the database inspector only runs one
          read-only SELECT in a read-only transaction with a statement timeout.
        </p>
      </DocSection>
      <DocSection title="Isolation">
        <DocList
          items={[
            "Code runs in an E2B microVM with a short timeout and no host credentials.",
            "HTML and SVG previews run in a sandboxed iframe without same-origin access.",
            "Webhook targets are checked against loopback and private address ranges unless the operator explicitly enables local webhooks.",
            "Each room's turns are serialized with a Postgres advisory lock.",
          ]}
        />
      </DocSection>
      <DocSection title="Operations">
        <p>
          The operator controls Supabase, the hosting provider, backups, the encryption key, model
          providers, network policy and which tools are enabled. Keep the encryption KEK stable and
          private. Rotating it without re-encrypting stored secrets makes them unreadable. Review
          the deployment documentation before exposing an installation to the internet.
        </p>
      </DocSection>
      <DocSection title="Reporting">
        <p>
          A problem on this deployment goes to whoever operates it. Include the affected room,
          account and time, but do not include live secrets. A vulnerability in the Sayabot software
          itself goes to sayalabs.studio@gmail.com. Please follow SECURITY.md in the repository and
          do not open a public issue.
        </p>
      </DocSection>
      <DocSection title="No certification claim">
        <p>
          This page describes the code, not an independent audit. It does not claim SOC 2, ISO 27001
          or any other certification. Those claims require an actual audit of the deployment.
        </p>
      </DocSection>
    </DocPage>
  )
}
