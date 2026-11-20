"use client"

import { useState, useTransition } from "react"
import { issueAgentApiKey, revokeAgentApiKey, rotateWebhookSecret } from "@/lib/actions/bots"
import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { InlineAlert } from "@/components/ui/empty"
import { CopyButton } from "@/components/copy-button"
import { McpConnect } from "@/components/settings/mcp-connect"

export function IssueApiKey({
  orgSlug,
  agentId,
  mcpEndpoint,
  handle,
  roomName,
  timezone,
}: {
  orgSlug: string
  agentId: string
  mcpEndpoint?: string
  handle?: string
  roomName?: string
  timezone?: string
}) {
  const [label, setLabel] = useState("default")
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function issue() {
    setError(null)
    setToken(null)
    startTransition(async () => {
      const result = await issueAgentApiKey({ orgSlug, agentId, label })
      if (!result.ok) {
        setError(result.error ?? "Could not issue a key")
        return
      }
      const issued = result.data?.token
      if (typeof issued === "string") setToken(issued)
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="key label" htmlFor={`key-label-${agentId}`} className="min-w-40 flex-1">
          <Input
            id={`key-label-${agentId}`}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={60}
            className="h-8"
          />
        </Field>
        <Button size="sm" onClick={issue} disabled={pending}>
          {pending ? "issuing…" : "issue key"}
        </Button>
      </div>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {token ? (
        <div className="rounded-sm border border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] bg-accent-soft p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[11px] text-accent">
              copy this key now, it is not shown again
            </p>
            <CopyButton text={token} label="copy key" />
          </div>
          <code className="mt-1 block break-all font-mono text-[12px] text-text">{token}</code>
          {mcpEndpoint && handle ? (
            <div className="mt-3 border-t border-line pt-3">
              <p className="mb-2 font-mono text-[11px] text-accent">connect your AI app</p>
              <McpConnect
                endpoint={mcpEndpoint}
                token={token}
                handle={handle}
                roomName={roomName}
                timezone={timezone}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function RotateWebhookSecret({ orgSlug, agentId }: { orgSlug: string; agentId: string }) {
  const [confirming, setConfirming] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function rotate() {
    setError(null)
    setSecret(null)
    startTransition(async () => {
      const result = await rotateWebhookSecret({ orgSlug, agentId })
      if (!result.ok) {
        setError(result.error ?? "Could not rotate the secret")
        setConfirming(false)
        return
      }
      const issued = result.data?.secret
      if (typeof issued === "string") setSecret(issued)
      setConfirming(false)
    })
  }

  return (
    <div className="space-y-2">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="danger" className="h-7" onClick={rotate} disabled={pending}>
            {pending ? "rotating…" : "rotate now"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => setConfirming(false)}
            disabled={pending}
          >
            cancel
          </Button>
          <span className="text-[12px] text-warn">The old secret stops working immediately.</span>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="h-7" onClick={() => setConfirming(true)}>
          rotate webhook secret
        </Button>
      )}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {secret ? (
        <div className="rounded-sm border border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] bg-accent-soft p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[11px] text-accent">
              new webhook secret, shown once. Update the bot now.
            </p>
            <CopyButton text={secret} label="copy secret" />
          </div>
          <code className="mt-1 block break-all font-mono text-[12px] text-text">{secret}</code>
        </div>
      ) : null}
    </div>
  )
}

export function RevokeKeyButton({ orgSlug, keyId }: { orgSlug: string; keyId: string }) {
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function revoke() {
    setError(null)
    startTransition(async () => {
      const result = await revokeAgentApiKey({ orgSlug, keyId })
      if (!result.ok) {
        setError(result.error ?? "Could not revoke the key")
        setConfirming(false)
      }
    })
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <Button size="sm" variant="danger" className="h-7" onClick={revoke} disabled={pending}>
            {pending ? "revoking…" : "confirm revoke"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => setConfirming(false)}
            disabled={pending}
          >
            cancel
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-danger"
          onClick={() => setConfirming(true)}
        >
          revoke
        </Button>
      )}
      {error ? (
        <span role="alert" className="text-[12px] text-danger">
          {error}
        </span>
      ) : null}
    </span>
  )
}
