"use client"

import { useActionState, useState } from "react"
import { createRoom } from "@/lib/actions/rooms"
import { Button } from "@/components/ui/button"
import { Field, HelpText, Input, Select } from "@/components/ui/field"
import { InlineAlert } from "@/components/ui/empty"
import type { ActionResult, MemberView } from "@/lib/types"

export function RoomForm({
  orgSlug,
  members,
  selfId,
}: {
  orgSlug: string
  members: MemberView[]
  selfId: string
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createRoom, null)
  const [kind, setKind] = useState("private")
  return (
    <form action={action} id="new-room" className="space-y-4 scroll-mt-6">
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <div>
        <h2 className="text-[15px] font-medium">New room</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Give it a name. Everything else can wait.
        </p>
      </div>
      <Field label="name" htmlFor="room-name" hint="1 to 60 characters">
        <Input
          id="room-name"
          name="name"
          required={kind !== "dm"}
          maxLength={60}
          placeholder="release-triage"
        />
      </Field>
      <details className="rounded-md border border-line">
        <summary className="cursor-pointer select-none px-3 py-2 text-[12px] text-muted hover:text-text">
          More options{" "}
          <span className="text-faint">
            ({kind === "private" ? "private" : kind === "public" ? "public" : "direct chat"}
            {kind !== "dm" ? ", just you" : ""})
          </span>
        </summary>
        <div className="space-y-4 border-t border-line px-3 py-3">
          <Field label="who can see it" htmlFor="room-kind">
            <Select
              id="room-kind"
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="private">Private: only people you add</option>
              <option value="public">Public: anyone in the workspace can read</option>
              <option value="dm">Direct chat with one person</option>
            </Select>
          </Field>
          <Field
            label={kind === "dm" ? "person" : "add a person"}
            htmlFor="room-member"
            hint={kind === "dm" ? "required" : "optional"}
          >
            <Select id="room-member" name="memberId" required={kind === "dm"} defaultValue="">
              <option value="">{kind === "dm" ? "Choose a person" : "No one else for now"}</option>
              {members
                .filter((member) => member.userId !== selfId)
                .map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.displayName}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
      </details>
      <HelpText>
        Just a name is enough. Agents, people, tools and who leads are all set up later in the
        room&apos;s settings.
      </HelpText>
      {state && !state.ok ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating room…" : "Create room"}
      </Button>
    </form>
  )
}
