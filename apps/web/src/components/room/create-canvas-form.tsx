"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createCanvas } from "@/lib/actions/canvas"
import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { InlineAlert } from "@/components/ui/empty"
import type { ActionResult } from "@/lib/types"

export function CreateCanvasForm({
  orgSlug,
  roomId,
  onCreated,
}: {
  orgSlug: string
  roomId: string
  onCreated: (canvasId: string) => void
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createCanvas, null)
  const [kind, setKind] = useState("markdown")

  useEffect(() => {
    const id = state?.data?.canvasId
    if (state?.ok && typeof id === "string") {
      onCreated(id)
      router.refresh()
    }
  }, [state, onCreated, router])

  return (
    <form action={action} className="space-y-3 border-t border-line bg-panel p-4">
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="roomId" value={roomId} />
      <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
        <Field label="title" htmlFor="canvas-title">
          <Input
            id="canvas-title"
            name="title"
            required
            maxLength={60}
            placeholder="launch notes"
          />
        </Field>
        <Field label="type" htmlFor="canvas-kind">
          <Select
            id="canvas-kind"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="markdown">Notes (markdown)</option>
            <option value="code">Code</option>
            <option value="html">Web page (HTML)</option>
            <option value="svg">Drawing (SVG)</option>
          </Select>
        </Field>
      </div>
      {kind === "code" ? (
        <Field label="language" htmlFor="canvas-language" hint="optional">
          <Input id="canvas-language" name="language" placeholder="typescript" />
        </Field>
      ) : null}
      {state && !state.ok ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      <Button type="submit" size="sm" variant="primary" disabled={pending}>
        {pending ? "Adding…" : "Add canvas"}
      </Button>
    </form>
  )
}
