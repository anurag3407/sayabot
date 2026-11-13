"use client"

import { agentModelText, type SayaAiPublic } from "@sayabot/core"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { openBotDmAction } from "@/lib/actions/room-state"
import { RoomForm } from "@/components/room-form"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty"
import { cn } from "@/lib/format"
import type { AgentView, MemberView } from "@/lib/types"

type Tab = "room" | "bot"

function BotStartButton({ orgSlug, agentId }: { orgSlug: string; agentId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await openBotDmAction(orgSlug, agentId)
            if (!result.ok) {
              setError(result.error ?? "Could not open the chat")
              return
            }
            const path = typeof result.data?.path === "string" ? result.data.path : null
            if (path) {
              router.push(path)
              router.refresh()
            }
          })
        }
      >
        {pending ? "Opening…" : "Start chat"}
      </Button>
      {error ? <span className="text-[12px] text-danger">{error}</span> : null}
    </div>
  )
}

export function NewChatView({
  orgSlug,
  members,
  selfId,
  agents,
  saya = null,
  initialTab = "room",
}: {
  orgSlug: string
  members: MemberView[]
  selfId: string
  agents: AgentView[]
  /** The server's Saya AI models (names only), to label agents that use them. */
  saya?: SayaAiPublic | null
  initialTab?: Tab
}) {
  const [tab, setTab] = useState<Tab>(initialTab)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
        <p className="font-mono text-[12px] text-faint">
          <Link href={`/${orgSlug}`} className="hover:text-text">
            chats
          </Link>{" "}
          / new
        </p>
        <h1 className="mt-1 text-2xl font-medium tracking-[-0.02em]">Start a new chat</h1>
        <p className="mt-2 max-w-[58ch] text-[13px] leading-relaxed text-muted">
          A room is a shared space with its own canvas, agents and meetings. An agent chat is a
          private conversation between you and one agent.
        </p>

        <div className="mt-7 flex gap-1 border-b border-line">
          {(
            [
              { key: "room", label: "Room with people" },
              { key: "bot", label: "Chat with an agent" },
            ] as const
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setTab(option.key)}
              aria-pressed={tab === option.key}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 font-mono text-[12px] transition-colors",
                tab === option.key
                  ? "border-accent text-text"
                  : "border-transparent text-muted hover:text-text",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {tab === "room" ? (
            <div className="max-w-md">
              <RoomForm orgSlug={orgSlug} members={members} selfId={selfId} />
            </div>
          ) : agents.length === 0 ? (
            <EmptyState
              title="No agents yet"
              body="Create an agent first, then you can chat with it directly or add it to rooms."
              action={
                <Link
                  href={`/${orgSlug}/agents`}
                  className="font-mono text-[12px] text-accent underline underline-offset-4"
                >
                  create an agent
                </Link>
              }
            />
          ) : (
            <div>
              <p className="max-w-[58ch] text-[12px] leading-relaxed text-muted">
                No @mention needed here: the agent answers every message you send. Risky actions still
                wait for approval.
              </p>
              <ul className="mt-5 divide-y divide-line border-y border-line">
                {agents.map((agent) => (
                  <li key={agent.id} className="flex items-center gap-3 py-3">
                    <span
                      aria-hidden="true"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)] bg-accent-soft font-mono text-[12px] text-accent"
                    >
                      @
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-text">
                        {agent.displayName}{" "}
                        <span className="font-mono text-[11px] text-faint">@{agent.handle}</span>
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-faint">
                        {agentModelText(agent, saya)}
                      </p>
                    </div>
                    <BotStartButton orgSlug={orgSlug} agentId={agent.id} />
                  </li>
                ))}
              </ul>
              <p className="mt-4 font-mono text-[11px] leading-relaxed text-faint">
                Only you can read your agent chats.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
