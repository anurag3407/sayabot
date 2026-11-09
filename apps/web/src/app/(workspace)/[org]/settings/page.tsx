import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Check } from "lucide-react"
import { isOrgAdmin, requireOrgAccess } from "@/lib/auth"
import { listMcpServers, listMemberViews, listOrgAgents, listProviderKeys, listVectorProviders } from "@/lib/queries"
import { createAdminClient } from "@/lib/supabase/admin"
import { visibleSettingsGroups } from "@/lib/settings-nav"
import { cn } from "@/lib/format"
import { SETTINGS_ICONS } from "@/components/settings/settings-icons"

export const metadata: Metadata = { title: "Settings" }

interface Step {
  label: string
  detail: string
  href: string
  done: boolean
  optional?: boolean
}

async function adminSummary(orgId: string) {
  const admin = createAdminClient()
  const [keys, members, agents, servers, vectors, secrets] = await Promise.all([
    listProviderKeys(orgId),
    listMemberViews(orgId),
    listOrgAgents(orgId),
    listMcpServers(orgId),
    listVectorProviders(orgId),
    admin.from("vault_secrets").select("id", { count: "exact", head: true }).eq("org_id", orgId),
  ])
  const llmAgents = agents.filter((agent) => agent.kind === "llm").length
  const externalAgents = agents.length - llmAgents
  const activeVector = vectors.filter((v) => v.isActive)
  return {
    keys: keys.length,
    members: members.length,
    llmAgents,
    externalAgents,
    servers: servers.filter((server) => server.enabled).length,
    vectorDb: activeVector.some((v) => v.kind === "vector_db"),
    embedding: activeVector.some((v) => v.kind === "embedding"),
    secrets: secrets.count ?? 0,
  }
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

export default async function SettingsOverviewPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAccess(orgSlug)
  const isAdmin = isOrgAdmin(access.role)
  const base = `/${orgSlug}`
  const summary = isAdmin ? await adminSummary(access.org.id) : null

  const steps: Step[] = summary
    ? [
        {
          label: "Connect a model provider",
          detail: "Add an API key or sign in with an AI account so agents can think.",
          href: `${base}/settings/keys`,
          done: summary.keys > 0,
        },
        {
          label: "Create your first agent",
          detail: "Give it a name, a model and a job. It can join any room.",
          href: `${base}/agents/new`,
          done: summary.llmAgents > 0,
        },
        {
          label: "Invite your team",
          detail: "Rooms work best with humans and agents side by side.",
          href: `${base}/settings/workspace`,
          done: summary.members > 1,
        },
        {
          label: "Give agents tools",
          detail: "Turn on web search or connect an MCP server.",
          href: `${base}/settings/tools`,
          done: summary.servers > 0,
          optional: true,
        },
        {
          label: "Turn on long-term memory",
          detail: "A vector store and embedding model let agents recall past work.",
          href: `${base}/settings/vector`,
          done: summary.vectorDb && summary.embedding,
          optional: true,
        },
      ]
    : []
  const required = steps.filter((step) => !step.optional)
  const doneCount = steps.filter((step) => step.done).length
  const requiredDone = required.every((step) => step.done)
  const nextStep = steps.find((step) => !step.done)

  const status: Record<string, string> = summary
    ? {
        workspace: plural(summary.members, "member"),
        keys: summary.keys ? plural(summary.keys, "key") : "Not set up",
        pricing: "Defaults in use",
        tools: summary.servers ? `${plural(summary.servers, "MCP server")} on` : "Built-ins only",
        bots: summary.externalAgents ? plural(summary.externalAgents, "agent") : "None connected",
        vault: summary.secrets ? plural(summary.secrets, "secret") : "Empty",
        vector:
          summary.vectorDb && summary.embedding ? "Active" : summary.vectorDb || summary.embedding ? "Partly set up" : "Off",
      }
    : {}
  const attention = new Set(
    summary ? [summary.keys === 0 ? "keys" : null].filter((key): key is string => key !== null) : [],
  )

  return (
    <>
      {summary ? (
        <section
          aria-labelledby="setup-heading"
          className="overflow-hidden rounded-[18px] border border-line bg-panel"
        >
          <div className="flex flex-wrap items-end justify-between gap-4 p-5 pb-4">
            <div>
              <h2 id="setup-heading" className="text-[15px] font-medium">
                {requiredDone ? "Your workspace is ready" : "Get your workspace ready"}
              </h2>
              <p className="mt-1 text-[13px] text-muted">
                {requiredDone
                  ? "The essentials are done. The optional steps make agents more capable."
                  : "Three steps and your team can start working with agents."}
              </p>
            </div>
            <p className="font-mono text-[12px] text-faint" aria-live="polite">
              {doneCount}/{steps.length} done
            </p>
          </div>
          <div
            className="mx-5 h-1 overflow-hidden rounded-full bg-raised"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-valuenow={doneCount}
            aria-label="Setup progress"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${(doneCount / steps.length) * 100}%` }}
            />
          </div>
          <ol className="mt-4 divide-y divide-line border-t border-line">
            {steps.map((step) => {
              const isNext = step === nextStep
              return (
                <li key={step.label}>
                  <Link
                    href={step.href}
                    className={cn(
                      "group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-raised",
                      isNext && "bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)]",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "grid h-5 w-5 shrink-0 place-items-center rounded-full border",
                        step.done ? "border-ok bg-ok text-void" : isNext ? "border-accent" : "border-line-strong",
                      )}
                    >
                      {step.done ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-[13px]", step.done ? "text-muted line-through decoration-faint" : "text-text")}>
                        {step.label}
                        {step.optional ? <span className="ml-2 text-[11px] text-faint no-underline">optional</span> : null}
                        <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
                      </span>
                      {!step.done ? <span className="mt-0.5 block text-[12px] text-faint">{step.detail}</span> : null}
                    </span>
                    <ArrowRight
                      aria-hidden
                      className={cn(
                        "h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-text",
                        step.done && "opacity-0 group-hover:opacity-100",
                      )}
                    />
                  </Link>
                </li>
              )
            })}
          </ol>
        </section>
      ) : (
        <section className="rounded-[18px] border border-line bg-panel p-5">
          <h2 className="text-[15px] font-medium">Your settings</h2>
          <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-muted">
            You can change your profile and alerts here. Models, tools, keys and members are
            managed by the admins of {access.org.name}.
          </p>
        </section>
      )}

      {visibleSettingsGroups(isAdmin).map((group) => (
        <section key={group.label} aria-labelledby={`group-${group.label}`}>
          <h2 id={`group-${group.label}`} className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
            {group.label}
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {group.links.map((link) => {
              const Icon = SETTINGS_ICONS[link.icon]
              const needsAttention = attention.has(link.segment)
              return (
                <Link
                  key={link.segment}
                  href={`${base}/settings/${link.segment}`}
                  className="group flex gap-3 rounded-xl border border-line p-4 transition-colors hover:border-line-strong hover:bg-panel"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-raised text-muted group-hover:text-text">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium text-text">{link.label}</span>
                      {status[link.segment] ? (
                        <span
                          className={cn(
                            "shrink-0 font-mono text-[11px]",
                            needsAttention ? "text-warn" : "text-faint",
                          )}
                        >
                          {status[link.segment]}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-[12px] leading-relaxed text-muted">{link.description}</span>
                  </span>
                </Link>
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
}
