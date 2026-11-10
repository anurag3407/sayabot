import type { Metadata } from "next"
import { requireOrgAdmin } from "@/lib/auth"
import { listMcpServers, listOrgToolConfigs, listRooms } from "@/lib/queries"
import { addMcpServer, saveOrgToolConfig, updateMcpServer } from "@/lib/actions/mcp"
import { ActionForm } from "@/components/ui/action-form"
import { Field, HelpText, Input, Select, Textarea } from "@/components/ui/field"
import { EmptyState } from "@/components/ui/empty"
import { Section } from "@/components/settings/section"
import { McpInspector } from "@/components/settings/mcp-inspector"
import { WebSearchConfig } from "@/components/settings/web-search-config"
import { DocumentOcrConfig } from "@/components/settings/document-ocr-config"

export const maxDuration = 60

export const metadata: Metadata = { title: "Tools & MCP" }

export default async function ToolsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAdmin(orgSlug)
  const [servers, configs, rooms] = await Promise.all([
    listMcpServers(access.org.id),
    listOrgToolConfigs(access.org.id),
    listRooms(access.org.id),
  ])
  const roomsById = new Map(rooms.map((room) => [room.id, room]))
  const github = configs.find((config) => config.tool === "github_bridge")
  const postgres = configs.find((config) => config.tool === "postgres_inspector")
  const webSearch = configs.find((config) => config.tool === "web_search")
  const documentOcr = configs.find((config) => config.tool === "document_extract")

  return (
    <>
      <Section
        title="MCP servers"
        description="Model Context Protocol servers are mounted per room, or across the whole workspace. Their headers are encrypted at rest. Mark write-capable tools as dangerous to require a human approval."
        actions={
          <span className="font-mono text-[11px] text-faint">
            {servers.length} {servers.length === 1 ? "server" : "servers"}
          </span>
        }
      >
        {servers.length === 0 ? (
          <EmptyState
            title="No MCP servers"
            body="Register an HTTP or SSE MCP server, then attach it to an agent. Tools are namespaced by server name so two servers can expose the same tool."
          />
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {servers.map((server) => (
              <li key={server.id} className="py-3">
                <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-text">{server.name}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-faint">
                      {server.transport} · {server.url} ·{" "}
                      {server.roomId ? roomsById.get(server.roomId)?.name ?? "room" : "workspace"}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-faint">
                      {server.enabled ? "enabled" : "disabled"}
                      {server.dangerousTools.length
                        ? ` · needs approval: ${server.dangerousTools.join(", ")}`
                        : " · no approval-gated tools"}
                    </p>
                  </div>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer font-mono text-[11px] text-muted hover:text-text">
                    inspect tools
                  </summary>
                  <div className="mt-2 border-l border-line pl-3">
                    <McpInspector orgSlug={orgSlug} serverId={server.id} />
                  </div>
                </details>
                <details className="mt-2">
                  <summary className="cursor-pointer font-mono text-[11px] text-muted hover:text-text">
                    edit
                  </summary>
                  <div className="mt-2 border-l border-line pl-3">
                    <ActionForm action={updateMcpServer} submitLabel="Save server">
                      <input type="hidden" name="orgSlug" value={orgSlug} />
                      <input type="hidden" name="serverId" value={server.id} />
                      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                        <Field label="url" htmlFor={`url-${server.id}`}>
                          <Input id={`url-${server.id}`} name="url" defaultValue={server.url} />
                        </Field>
                        <Field label="enabled" htmlFor={`enabled-${server.id}`}>
                          <Select
                            id={`enabled-${server.id}`}
                            name="enabled"
                            defaultValue={server.enabled ? "true" : "false"}
                          >
                            <option value="true">enabled</option>
                            <option value="false">disabled</option>
                          </Select>
                        </Field>
                      </div>
                      <Field
                        label="dangerous tools"
                        htmlFor={`danger-${server.id}`}
                        hint="comma separated"
                      >
                        <Input
                          id={`danger-${server.id}`}
                          name="dangerousTools"
                          defaultValue={server.dangerousTools.join(", ")}
                        />
                      </Field>
                      <Field
                        label="replace headers (JSON)"
                        htmlFor={`headers-${server.id}`}
                        hint="leave empty to keep"
                      >
                        <Textarea
                          id={`headers-${server.id}`}
                          name="headers"
                          className="min-h-16 font-mono text-[12px]"
                          placeholder='{"Authorization":"Bearer …"}'
                        />
                      </Field>
                    </ActionForm>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Add an MCP server"
        description="Use an HTTP (streamable) or SSE endpoint. Header values are sealed before insert and never shown again."
      >
        <ActionForm action={addMcpServer} submitLabel="Add server" resetOnSuccess>
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <div className="grid gap-3 sm:grid-cols-[1fr_130px]">
            <Field label="name" htmlFor="mcp-name" hint="tool namespace">
              <Input id="mcp-name" name="name" required maxLength={60} placeholder="linear" />
            </Field>
            <Field label="transport" htmlFor="mcp-transport">
              <Select id="mcp-transport" name="transport" defaultValue="http">
                <option value="http">http</option>
                <option value="sse">sse</option>
              </Select>
            </Field>
          </div>
          <Field label="url" htmlFor="mcp-url">
            <Input
              id="mcp-url"
              name="url"
              required
              placeholder="https://mcp.example.com/mcp"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="room scope" htmlFor="mcp-room" hint="optional">
              <Select id="mcp-room" name="roomId" defaultValue="">
                <option value="">workspace-wide</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="dangerous tools"
              htmlFor="mcp-danger"
              hint="comma separated"
            >
              <Input id="mcp-danger" name="dangerousTools" placeholder="create_issue, delete_branch" />
            </Field>
          </div>
          <Field label="headers (JSON object)" htmlFor="mcp-headers" hint="optional">
            <Textarea
              id="mcp-headers"
              name="headers"
              className="min-h-16 font-mono text-[12px]"
              placeholder='{"Authorization":"Bearer …"}'
            />
          </Field>
        </ActionForm>
      </Section>

      <Section
        title="Built-in tools"
        description="These come built in. The database inspector only runs a single read-only SELECT in a 10 second transaction. The GitHub bridge asks for approval before committing."
      >
        <div className="space-y-5">
          <div className="border-y border-line py-5">
            <div className="mb-4">
              <p className="text-[13px] font-medium text-text">web_search</p>
              <p className="mt-0.5 font-mono text-[11px] text-faint">
                Multi-provider web search engine (DuckDuckGo, Tavily, Brave, SearXNG, Serper, Exa, TinyFish, Firecrawl, Perplexity, Bing)
              </p>
            </div>
            <WebSearchConfig orgSlug={orgSlug} savedConfig={webSearch} />
          </div>

          <div className="border-b border-line pb-5">
            <div className="mb-4">
              <p className="text-[13px] font-medium text-text">document_extract</p>
              <p className="mt-0.5 font-mono text-[11px] text-faint">
                High-precision Document & Financial OCR Intelligence (IBM Docling, Marker, Tesseract, Multimodal Vision, Mistral OCR, AWS Textract)
              </p>
            </div>
            <DocumentOcrConfig orgSlug={orgSlug} savedConfig={documentOcr} />
          </div>

          <div className="border-b border-line pb-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[13px] text-text">web_fetch</p>
                <p className="mt-0.5 font-mono text-[11px] text-faint">
                  Autonomous Web Page Extractor · HTML to Markdown · Free & Keyless
                </p>
              </div>
              <span className="rounded-sm bg-ok/10 px-1.5 py-0.5 font-mono text-[10px] text-ok border border-ok/30">
                built-in
              </span>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Agents use this tool to scrape and read full documentation, articles, and APIs into clean Markdown. It automatically handles entity decoding, link preservation, and boilerplate stripping with zero external credentials needed.
            </p>
          </div>

          <div className="border-b border-line pb-5">
            <p className="text-[13px] text-text">github_bridge</p>
            <p className="mt-0.5 font-mono text-[11px] text-faint">
              {github ? `configured · ${github.enabled ? "enabled" : "disabled"}` : "not configured"}
            </p>
            <div className="mt-3">
              <ActionForm action={saveOrgToolConfig} submitLabel="Save GitHub token">
                <input type="hidden" name="orgSlug" value={orgSlug} />
                <input type="hidden" name="tool" value="github_bridge" />
                <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
                  <Field label="personal access token" htmlFor="github-token" hint="sealed at rest">
                    <Input
                      id="github-token"
                      name="githubToken"
                      type="password"
                      autoComplete="off"
                      placeholder="ghp_…"
                    />
                  </Field>
                  <Field label="state" htmlFor="github-enabled">
                    <Select
                      id="github-enabled"
                      name="enabled"
                      defaultValue={github?.enabled === false ? "false" : "true"}
                    >
                      <option value="true">enabled</option>
                      <option value="false">disabled</option>
                    </Select>
                  </Field>
                </div>
                <HelpText>
                  Grants read access to files and issues, and commit access behind a human approval.
                  Use a fine-grained token limited to the repositories agents should touch.
                </HelpText>
              </ActionForm>
            </div>
          </div>

          <div>
            <p className="text-[13px] text-text">postgres_inspector</p>
            <p className="mt-0.5 font-mono text-[11px] text-faint">
              {postgres
                ? `configured · ${postgres.enabled ? "enabled" : "disabled"}`
                : "not configured"}
            </p>
            <div className="mt-3">
              <ActionForm action={saveOrgToolConfig} submitLabel="Save connection">
                <input type="hidden" name="orgSlug" value={orgSlug} />
                <input type="hidden" name="tool" value="postgres_inspector" />
                <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
                  <Field label="connection string" htmlFor="pg-url" hint="sealed at rest">
                    <Input
                      id="pg-url"
                      name="connectionString"
                      type="password"
                      autoComplete="off"
                      placeholder="postgresql://readonly@host:5432/db"
                    />
                  </Field>
                  <Field label="state" htmlFor="pg-enabled">
                    <Select
                      id="pg-enabled"
                      name="enabled"
                      defaultValue={postgres?.enabled === false ? "false" : "true"}
                    >
                      <option value="true">enabled</option>
                      <option value="false">disabled</option>
                    </Select>
                  </Field>
                </div>
                <HelpText>
                  Use a role with read-only grants. The inspector rejects anything that is not a
                  single SELECT or WITH statement.
                </HelpText>
              </ActionForm>
            </div>
          </div>
        </div>
      </Section>
    </>
  )
}
