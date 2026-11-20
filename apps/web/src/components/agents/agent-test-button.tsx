"use client"

import { useState, useTransition } from "react"
import { testAgent } from "@/lib/actions/agents"
import { Button } from "@/components/ui/button"
import type { ActionResult } from "@/lib/types"

export function AgentTestButton({ orgSlug, agentId }: { orgSlug: string; agentId: string }) {
  const [result, setResult] = useState<ActionResult | null>(null)
  const [pending, startTransition] = useTransition()

  function run() {
    setResult(null)
    startTransition(async () => {
      setResult(await testAgent(orgSlug, agentId))
    })
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" className="md:h-7" onClick={run} disabled={pending}>
        {pending ? "Testing…" : "Test"}
      </Button>
      {result ? (
        <span
          role="status"
          className={
            result.ok ? "max-w-sm text-[12px] text-ok" : "max-w-sm text-[12px] text-danger"
          }
        >
          {result.ok ? result.message : result.error}
          {result.ok && typeof result.data?.reply === "string" ? ` · "${result.data.reply}"` : ""}
        </span>
      ) : null}
    </span>
  )
}
