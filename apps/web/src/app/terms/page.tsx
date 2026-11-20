import type { Metadata } from "next"
import { DocList, DocPage, DocSection } from "@/components/public/doc-page"

export const metadata: Metadata = { title: "Terms · Sayabot" }

export default function TermsPage() {
  return (
    <DocPage
      eyebrow="terms"
      title="Terms of use"
      lede="These terms describe how a Sayabot deployment is meant to be used. The operator of this deployment is responsible for adapting them to its entity, jurisdiction and policies."
      draft
    >
      <DocSection title="1. The service">
        <p>
          Sayabot is self-hosted collaboration software. A deployment consists of a web application,
          an orchestrator and a Supabase project operated by whoever runs the deployment. The
          operator decides who may create an account and which model providers, tools and bots are
          available.
        </p>
      </DocSection>
      <DocSection title="2. Accounts">
        <p>
          Use your real name and an email address you control. Keep your password and agent API keys
          private. You are responsible for activity under your account, including messages and tool
          calls made by agents you add to a workspace.
        </p>
      </DocSection>
      <DocSection title="3. Workspaces and rooms">
        <p>
          A workspace owner controls its rooms, members and agents. Room content is visible to the
          members and agents in that room, subject to the deployment's row level security policies.
          Only share content you have the right to share with those people and services.
        </p>
      </DocSection>
      <DocSection title="4. Agents, models and tools">
        <p>
          Agents may use third-party model providers, MCP servers, sandbox providers and external
          bots. Those services have their own terms and charges. The deployment operator does not
          control them. AI output can be wrong or incomplete; check anything important before
          relying on it.
        </p>
      </DocSection>
      <DocSection title="5. Your content">
        <p>
          You keep ownership of the content you post. You grant the operator a limited licence to
          store, process and display that content only as needed to run, secure and support the
          deployment. Content and account deletion are handled by the operator or an authorized
          workspace owner and remove data from the active database, subject to the operator's backup
          and retention configuration.
        </p>
      </DocSection>
      <DocSection title="6. Acceptable use">
        <DocList
          items={[
            "Do not break the law or help anyone else do so.",
            "Do not harass, threaten, defame or impersonate people.",
            "Do not send spam, malware or phishing, or attempt to bypass authentication or limits.",
            "Do not use the deployment to infringe intellectual property, privacy or other rights.",
            "Do not post government identifiers, payment card data, medical records, passwords or access keys.",
          ]}
        />
      </DocSection>
      <DocSection title="7. Keys and secrets">
        <p>
          Provider keys, webhook secrets and MCP headers are encrypted by the deployment. Agent API
          keys are shown once and stored as hashes. If a secret is exposed, rotate it and remove the
          affected agent or key. The operator controls the encryption key; losing it makes
          previously encrypted secrets unrecoverable.
        </p>
      </DocSection>
      <DocSection title="8. Availability and changes">
        <p>
          This is early software. Features and limits may change. The operator may suspend access to
          protect the deployment or comply with the law. No uptime or support level is promised
          unless the operator publishes one separately.
        </p>
      </DocSection>
      <DocSection title="9. Disclaimers">
        <p>
          The deployment is provided as is, without warranties to the extent permitted by law.
          Nothing in Sayabot is legal, medical, financial or other professional advice, and the
          service is not for emergencies.
        </p>
      </DocSection>
      <DocSection title="10. Contact">
        <p>
          Questions about these terms go to the person or organization that gave you access to this
          deployment.
        </p>
      </DocSection>
    </DocPage>
  )
}
