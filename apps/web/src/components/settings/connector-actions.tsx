"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { deleteWorkspaceConnector, testWorkspaceConnector } from "@/lib/actions/connectors"
import { Button } from "@/components/ui/button"

export function TestConnectorButton({
  orgSlug,
  connectorId,
}: {
  orgSlug: string
  connectorId: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)

  function runTest() {
    setStatus(null)
    startTransition(async () => {
      const res = await testWorkspaceConnector(orgSlug, connectorId)
      if (res.ok) {
        setStatus({ ok: true, msg: res.message ?? "Connected" })
      } else {
        setStatus({ ok: false, msg: res.error ?? "Failed" })
      }
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-[11px]"
        disabled={pending}
        onClick={runTest}
      >
        {pending ? "Testing…" : "Test Connection"}
      </Button>
      {status ? (
        <span
          className={`font-mono text-[11px] ${
            status.ok ? "text-ok" : "text-danger"
          }`}
        >
          {status.msg}
        </span>
      ) : null}
    </div>
  )
}

export function DeleteConnectorButton({
  orgSlug,
  connectorId,
  name,
}: {
  orgSlug: string
  connectorId: string
  name: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleDelete() {
    if (!confirm(`Are you sure you want to disconnect ${name}? Agents using this connector will lose access.`)) {
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await deleteWorkspaceConnector({ orgSlug, connectorId })
      if (!res.ok) {
        setError(res.error ?? "Failed to delete connector")
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-[11px] text-danger hover:bg-danger/10 hover:text-danger"
        disabled={pending}
        onClick={handleDelete}
      >
        {pending ? "Removing…" : "Disconnect"}
      </Button>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  )
}
