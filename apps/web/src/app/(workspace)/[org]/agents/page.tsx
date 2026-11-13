import type { Metadata } from "next"
import { headers } from "next/headers"
import Link from "next/link"
import { isOrgAdmin, requireOrgAccess } from "@/lib/auth"
import { listMcpServers, listOrgAgents, listProviderKeys, listRooms } from "@/lib/queries"
import { addAgentToRoom } from "@/lib/actions/rooms"
import { updateAgent } from "@/lib/actions/agents"
import { ActionForm } from "@/components/ui/action-form"
import { Field, HelpText, Input, Select, Textarea } from "@/components/ui/field"
import { EmptyState } from "@/components/ui/empty"
import { Section } from "@/components/settings/section"
import { AddAgentChooser } from "@/components/agents/add-agent-chooser"
import { AgentModelPicker } from "@/components/agents/agent-model-picker"
import { AgentTestButton } from "@/components/agents/agent-test-button"
import { Mascot } from "@/components/ui/mascot"
import { agentRunner, loadWorkspaceModels } from "@/lib/model-catalog"
import { devModelConfigured } from "@/lib/env"
import { formatTokens, formatUsd, relativeTime } from "@/lib/format"
import { loadUsageRollup, usageByAgent } from "@/lib/usage"
import { DeleteAgentButton } from "@/components/agents/delete-agent-button"

export const maxDuration = 60

export const metadata: Metadata = { title: "Agents" }

export default async function AgentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>
  searchParams: Promise<{ room?: string }>
}) {
  const { org: orgSlug } = await params
  await searchParams
  const access = await requireOrgAccess(orgSlug)
  const canEdit = isOrgAdmin(access.role)
  const [agents, keys, mcpServers, rooms] = await Promise.all([
    listOrgAgents(access.org.id),
    listProviderKeys(access.org.id),
    listMcpServers(access.org.id),
    listRooms(access.org.id),
  ])
  const addableRooms = rooms.filter((room) => room.kind !== "dm")
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const runnerOf = agentRunner
  const requestHeaders = await headers()
  const [rollup, models] = await Promise.all([
    loadUsageRollup(access.org.id, since),
    canEdit
      ? loadWorkspaceModels({
          access,
          host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
          keys,
          agents,
        })
      : Promise.resolve({ groups: [], serverApps: [] }),
  ])
  const catalog = models.groups
  const serverApps = models.serverApps
  const usage = usageByAgent(rollup ?? [])
  const maxTokens = Math.max(1, ...[...usage.values()].map((u) => u.inputTokens + u.outputTokens))
  const totals = [...usage.values()].reduce(
    (acc, u) => ({ tokens: acc.tokens + u.inputTokens + u.outputTokens, cost: acc.cost + u.costUsd, requests: acc.requests + u.requests }),
    { tokens: 0, cost: 0, requests: 0 },
  )
  // An agent with no key and no server default answers through the first signed-in app here.
  const fallbackApp = devModelConfigured() ? null : serverApps.find((a) => a.cli && a.status === "ready")
  const currentOf = (a: (typeof agents)[number]) =>
    runnerOf(a) ??
    (!a.providerKeyId && fallbackApp ? { keyId: `cli:${fallbackApp.id}`, model: "default" } : { keyId: a.providerKeyId, model: a.model })
  const pickerGroups = catalog.length
    ? catalog
    : keys.map((key) => ({
        keyId: key.id,
        provider: key.provider,
        label: key.label,
        detail: key.provider,
        section: "key" as const,
        models: [],
        effortLevels: [],
      }))

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-text">Agents</h1>
            <p className="mt-1 max-w-2xl text-[14px] text-muted">
              Your AI teammates. Pick each one&apos;s model, see what it uses, and add new ones.
            </p>
          </div>
          {canEdit ? <AddAgentChooser orgSlug={orgSlug} rooms={addableRooms.map((r) => ({ id: r.id, name: r.name }))} /> : null}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 rounded-xl border border-line bg-panel p-4">
          <div>
            <p className="text-[12px] text-faint">Tokens · 30 days</p>
            <p className="mt-0.5 text-[18px] font-semibold text-text">{formatTokens(totals.tokens)}</p>
          </div>
          <div>
            <p className="text-[12px] text-faint">Replies & runs</p>
            <p className="mt-0.5 text-[18px] font-semibold text-text">{totals.requests.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[12px] text-faint">Spend</p>
            <p className="mt-0.5 text-[18px] font-semibold text-text">{formatUsd(totals.cost)}</p>
          </div>
          <Link href={`/${orgSlug}/analytics`} className="col-span-3 mt-1 text-[12px] text-muted hover:text-text">
            Full usage breakdown →
          </Link>
        </div>

        {!canEdit ? (
          <p className="mt-4 text-[13px] text-muted">Only workspace admins can change agents.</p>
        ) : null}

        <div className="mt-6 space-y-8">
          <Section
            title="Your agents"
            description={`${agents.length} ${agents.length === 1 ? "agent" : "agents"} in this workspace.`}
          >
            {agents.length === 0 ? (
              <EmptyState
                title="No agents yet"
                body={canEdit ? "Press Add agent to create one or invite one you already use." : "Ask a workspace admin to add one."}
              />
            ) : (
              <ul className="divide-y divide-line border-y border-line">
                {agents.map((agent) => {
                  const u = usage.get(agent.id)
                  const tokens = u ? u.inputTokens + u.outputTokens : 0
                  const activeRecently = u?.lastAt ? Date.now() - new Date(u.lastAt).getTime() < 86_400_000 : false
                  return (
                    <li key={agent.id} className="py-4">
                      <div className="flex items-start gap-3">
                        <div className="relative">
                          <Mascot seed={agent.handle} className="h-11 w-11" />
                          {activeRecently ? (
                            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-void bg-ok" title="Active today" />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-baseline gap-2">
                            <span className="text-[15px] font-medium text-text">{agent.displayName}</span>
                            <span className="text-[12px] text-muted">@{agent.handle}</span>
                            <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] text-muted">
                              {agent.kind === "external" ? "Invited" : "Created here"}
                            </span>
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {agent.kind === "llm" ? (
                              <AgentModelPicker
                                orgSlug={orgSlug}
                                agentId={agent.id}
                                groups={pickerGroups}
                                currentKeyId={currentOf(agent).keyId}
                                currentModel={currentOf(agent).model}
                                currentEffort={typeof agent.params.effort === "string" ? agent.params.effort : null}
                                disabled={!canEdit}
                              />
                            ) : (
                              <span className="inline-flex h-8 items-center rounded-full border border-line px-2.5 text-[12px] text-muted">
                                Uses its own app&apos;s model
                              </span>
                            )}
                            {canEdit && agent.kind === "llm" ? <AgentTestButton orgSlug={orgSlug} agentId={agent.id} /> : null}
                          </div>
                          <div className="mt-3">
                            {u ? (
                              <>
                                <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-raised" aria-hidden>
                                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (tokens / maxTokens) * 100)}%` }} />
                                </div>
                                <p className="mt-1.5 text-[12px] text-muted">
                                  {formatTokens(tokens)} tokens · {u.requests.toLocaleString()} {u.requests === 1 ? "run" : "runs"} ·{" "}
                                  {formatUsd(u.costUsd)}
                                  {u.topModel ? <span className="text-faint"> · mostly {u.topModel}</span> : null}
                                  {u.lastAt ? <span className="text-faint"> · last active {relativeTime(u.lastAt)}</span> : null}
                                </p>
                              </>
                            ) : (
                              <p className="text-[12px] text-faint">
                                {agent.kind === "external"
                                  ? "Runs in its own app, so its tokens are billed there, not here."
                                  : runnerOf(agent)
                                    ? "Runs on your computer with your own subscription, so tokens aren't billed here."
                                    : "No usage in the last 30 days."}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      {canEdit ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer py-2 font-mono text-[12px] text-muted hover:text-text md:py-0">
                            More settings
                          </summary>
                          <div className="mt-3 border-l border-line pl-3">
                            <ActionForm action={updateAgent} submitLabel="Save agent">
                              <input type="hidden" name="orgSlug" value={orgSlug} />
                              <input type="hidden" name="agentId" value={agent.id} />
                              <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="@handle" htmlFor={`handle-${agent.id}`}>
                                  <Input
                                    id={`handle-${agent.id}`}
                                    name="handle"
                                    defaultValue={agent.handle}
                                    required
                                  />
                                </Field>
                                <Field label="name" htmlFor={`name-${agent.id}`}>
                                  <Input
                                    id={`name-${agent.id}`}
                                    name="displayName"
                                    defaultValue={agent.displayName}
                                    required
                                  />
                                </Field>
                              </div>

                              {agent.kind === "llm" ? (
                                <>
                                  <input type="hidden" name="providerKeyId" value={agent.providerKeyId ?? ""} />
                                  <input type="hidden" name="model" value={agent.model ?? ""} />
                                </>
                              ) : (
                                <Field label="webhook url" htmlFor={`webhook-${agent.id}`}>
                                  <Input
                                    id={`webhook-${agent.id}`}
                                    name="webhookUrl"
                                    defaultValue={agent.webhookUrl ?? ""}
                                  />
                                </Field>
                              )}

                              {agent.kind === "llm" ? (
                                <Field label="what is this agent for?" htmlFor={`prompt-${agent.id}`}>
                                  <Textarea
                                    id={`prompt-${agent.id}`}
                                    name="systemPrompt"
                                    defaultValue={agent.systemPrompt}
                                    className="min-h-24"
                                  />
                                </Field>
                              ) : null}

                              <details className="rounded-sm border border-line bg-panel/50 px-3 py-2">
                                <summary className="cursor-pointer py-1 font-mono text-[12px] text-muted hover:text-text">
                                  Advanced
                                </summary>
                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                <Field label="model parameters (JSON)" htmlFor={`params-${agent.id}`}>
                                  <Textarea
                                    id={`params-${agent.id}`}
                                    name="params"
                                    defaultValue={JSON.stringify(agent.params, null, 2)}
                                    className="min-h-20 font-mono text-[12px]"
                                  />
                                </Field>
                                <fieldset>
                                  <legend className="mb-1.5 font-mono text-[12px] text-muted">
                                    MCP servers
                                  </legend>
                                  <div className="space-y-1 border border-line bg-panel p-2">
                                    {mcpServers.length === 0 ? (
                                      <p className="text-[12px] text-faint">None registered.</p>
                                    ) : (
                                      mcpServers.map((server) => (
                                        <label
                                          key={server.id}
                                          className="flex items-center justify-between gap-2 text-[12px] text-muted"
                                        >
                                          <span>{server.name}</span>
                                          <input
                                            type="checkbox"
                                            name="toolIds"
                                            value={server.id}
                                            defaultChecked={agent.toolIds.includes(server.id)}
                                            className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                                          />
                                        </label>
                                      ))
                                    )}
                                  </div>
                                </fieldset>
                                </div>
                              </details>
                            </ActionForm>
                            <div className="mt-4 border-t border-line pt-3">
                              <DeleteAgentButton
                                orgSlug={orgSlug}
                                agentId={agent.id}
                                handle={agent.handle}
                              />
                            </div>
                          </div>
                        </details>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>

          {canEdit ? (
            <>
              <Section
                title="Add an agent to a room"
                description="Agents can only reply in rooms they belong to. They reply in the order they were added."
              >
                {agents.length === 0 || addableRooms.length === 0 ? (
                  <p className="text-[13px] text-muted">
                    Create an agent and a room first.
                  </p>
                ) : (
                  <ActionForm action={addAgentToRoom} submitLabel="Add to room">
                    <input type="hidden" name="orgSlug" value={orgSlug} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="agent" htmlFor="add-agent">
                        <Select id="add-agent" name="agentId" required defaultValue="">
                          <option value="" disabled>
                            Choose an agent
                          </option>
                          {agents.map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              @{agent.handle}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="room" htmlFor="add-room">
                        <Select id="add-room" name="roomId" required defaultValue="">
                          <option value="" disabled>
                            Choose a room
                          </option>
                          {addableRooms.map((room) => (
                            <option key={room.id} value={room.id}>
                              {room.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <HelpText>
                      For debate rooms, set the speaking order in room settings.
                    </HelpText>
                  </ActionForm>
                )}
              </Section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
