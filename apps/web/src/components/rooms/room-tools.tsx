"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { addMcpServer, setMcpServerRoomAction } from "@/lib/actions/mcp"
import { disconnectMarketplaceServerAction } from "@/lib/actions/marketplace"
import { ActionForm } from "@/components/ui/action-form"
import { Button } from "@/components/ui/button"
import { Field, HelpText, Input } from "@/components/ui/field"
import { EmptyState } from "@/components/ui/empty"
import { showToast } from "@/components/ui/toast"
import type { ActionResult } from "@/lib/types"

export interface RoomToolServer {
  id: string
  name: string
  url: string
  /** null: every room; this room's id: only here. */
  roomId: string | null
  enabled: boolean
}

/**
 * Apps (MCP servers) whose tools this room's agents can use: the workspace's apps that work in
 * every room, plus apps limited to this room. Workspace admins can limit an app to this room,
 * open it to every room, or connect one just for this room.
 */
export function RoomTools({
  orgSlug,
  roomId,
  servers,
  canManage,
}: {
  orgSlug: string
  roomId: string
  servers: RoomToolServer[]
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  function run(serverId: string, call: () => Promise<ActionResult>) {
    setBusyId(serverId)
    startTransition(async () => {
      const res = await call()
      setBusyId(null)
      showToast({
        message: res.ok ? (res.message ?? "Saved") : (res.error ?? "Something went wrong"),
        tone: res.ok ? "success" : "danger",
      })
      if (res.ok) router.refresh()
    })
  }

  const addHere = async (prev: ActionResult | null, form: FormData) => {
    const res = await addMcpServer(prev, form)
    if (res.ok) {
      setAdding(false)
      router.refresh()
    }
    return res
  }

  return (
    <div>
      {servers.length === 0 ? (
        <EmptyState
          title="No apps connected"
          body="Agents here use only their built-in tools. Connect an app such as GitHub or a docs site to give them more."
        />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {servers.map((server) => {
            const here = server.roomId === roomId
            return (
              <li key={server.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <span className="text-[13px] text-text">{server.name}</span>
                <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] text-muted">
                  {here ? "Only this room" : "All rooms"}
                </span>
                {!server.enabled ? (
                  <span className="font-mono text-[11px] text-faint">off</span>
                ) : null}
                {canManage ? (
                  <div className="ml-auto flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        run(server.id, () =>
                          setMcpServerRoomAction({
                            orgSlug,
                            serverId: server.id,
                            roomId: here ? null : roomId,
                          }),
                        )
                      }
                      title={
                        here
                          ? "Let agents in every room use it"
                          : "Agents in other rooms will stop seeing it"
                      }
                    >
                      {busyId === server.id
                        ? "Saving…"
                        : here
                          ? "Use in all rooms"
                          : "Only this room"}
                    </Button>
                    {here ? (
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={pending}
                        onClick={() =>
                          run(server.id, () =>
                            disconnectMarketplaceServerAction({ orgSlug, serverId: server.id }),
                          )
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {canManage ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href={`/${orgSlug}/marketplace`}
            className="inline-flex h-10 items-center rounded-sm border border-line-strong bg-raised px-3 text-[13px] text-text hover:bg-hover md:h-9"
          >
            Browse apps
          </Link>
          <Button variant="ghost" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "Add by link, just for this room"}
          </Button>
        </div>
      ) : (
        <HelpText>A workspace admin can connect apps for this room.</HelpText>
      )}

      {canManage && adding ? (
        <div className="mt-4 border-t border-line pt-4">
          <ActionForm action={addHere} submitLabel="Connect" resetOnSuccess>
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="roomId" value={roomId} />
            <input type="hidden" name="transport" value="http" />
            {/* Like "Sign in with…" apps: anything that isn't a read asks a person first. */}
            <input type="hidden" name="dangerousTools" value="@writes" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="name" htmlFor="room-tool-name">
                <Input id="room-tool-name" name="name" required maxLength={60} placeholder="Docs" />
              </Field>
              <Field label="MCP link" htmlFor="room-tool-url" hint="starts with https://">
                <Input
                  id="room-tool-url"
                  name="url"
                  required
                  type="url"
                  placeholder="https://docs.example.com/mcp"
                  className="font-mono"
                />
              </Field>
            </div>
            <HelpText>
              Apps from Browse apps join every room; use &ldquo;Only this room&rdquo; to limit one
              here. Tools that change things still ask before they run.
            </HelpText>
          </ActionForm>
        </div>
      ) : null}
    </div>
  )
}
