"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { setAgentWorksOnAction } from "@/lib/actions/agents"
import { WORKS_ON_OPTIONS } from "@/lib/works-on"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/field"
import { showToast } from "@/components/ui/toast"

export function WorksOnForm({
  orgSlug,
  agentId,
  worksOn,
  thisComputer,
  canEdit,
}: {
  orgSlug: string
  agentId: string
  worksOn: string
  thisComputer: boolean
  canEdit: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [surface, setSurface] = useState(worksOn)
  const [screen, setScreen] = useState(thisComputer)

  if (!canEdit) {
    return <p className="text-xs text-muted-foreground">Works on {worksOn.replaceAll("_", " ")}</p>
  }

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        startTransition(async () => {
          const result = await setAgentWorksOnAction({
            orgSlug,
            agentId,
            worksOn: surface,
            thisComputer: screen,
          })
          showToast({ tone: result.ok ? "success" : "danger", message: result.ok ? (result.message ?? "Saved") : (result.error ?? "Could not save") })
          router.refresh()
        })
      }}
    >
      <label className="block text-xs text-muted-foreground" htmlFor="works-on">
        Works on
      </label>
      <Select id="works-on" value={surface} onChange={(event) => setSurface(event.target.value)}>
        {WORKS_ON_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <p className="text-xs text-muted-foreground">{WORKS_ON_OPTIONS.find(([value]) => value === surface)?.[2]}</p>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={screen} onChange={(event) => setScreen(event.target.checked)} />
        This computer can use the Mac screen
      </label>
      <Button size="sm" type="submit" disabled={pending}>
        Save
      </Button>
    </form>
  )
}
