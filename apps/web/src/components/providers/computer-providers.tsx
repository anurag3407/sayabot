"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Cloud, KeyRound, Loader2, Server, Ship } from "lucide-react"
import {
  checkComputerProviderAction,
  saveComputerProviderAction,
} from "@/lib/actions/computer-providers"
import type { ComputerProvidersView } from "@/lib/computer-providers-shared"
import type { ComputerProvider } from "@/lib/computer-settings"
import { forgetComputerProviders } from "@/components/agents/works-on-picker"
import { Button } from "@/components/ui/button"
import { Input, Textarea } from "@/components/ui/field"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"
import { ProviderCard, ProviderList, StatusPill } from "./provider-card"

type SaveInput = Omit<Parameters<typeof saveComputerProviderAction>[0], "orgSlug" | "provider">

function useProviderActions(orgSlug: string) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  function run(
    id: string,
    work: () => Promise<{ ok: boolean; message?: string; error?: string }>,
    after?: () => void,
  ) {
    setBusy(id)
    startTransition(async () => {
      const result = await work()
      setBusy(null)
      showToast({
        tone: result.ok ? "success" : "danger",
        message: result.ok ? (result.message ?? "Saved") : (result.error ?? "Could not save"),
      })
      if (result.ok) {
        after?.()
        forgetComputerProviders(orgSlug)
        router.refresh()
      }
    })
  }
  return {
    pending,
    busy,
    save: (provider: ComputerProvider, input: SaveInput, after?: () => void) =>
      run(
        `save-${provider}`,
        () => saveComputerProviderAction({ orgSlug, provider, ...input }),
        after,
      ),
    remove: (provider: ComputerProvider) =>
      run(`clear-${provider}`, () =>
        saveComputerProviderAction({ orgSlug, provider, clear: true }),
      ),
    check: (provider: ComputerProvider) =>
      run(`check-${provider}`, () => checkComputerProviderAction({ orgSlug, provider })),
  }
}

function Spin({ on }: { on: boolean }) {
  return on ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null
}

function KeyRow({
  provider,
  title,
  subtitle,
  placeholder,
  keyUrl,
  last4,
  included,
  canEdit,
  canCheck,
  footnote,
  icon,
  actions,
}: {
  provider: "boat" | "e2b"
  title: string
  subtitle: string
  placeholder: string
  keyUrl: string
  last4: string | null
  included: boolean
  canEdit: boolean
  canCheck: boolean
  footnote: React.ReactNode
  icon: React.ReactNode
  actions: ReturnType<typeof useProviderActions>
}) {
  const [token, setToken] = useState("")
  const status = last4 ? (
    <StatusPill tone="ok">Saved · ends {last4}</StatusPill>
  ) : included ? (
    <StatusPill tone="ok">Included with this server</StatusPill>
  ) : (
    <StatusPill tone="idle">Not set up</StatusPill>
  )
  return (
    <ProviderCard icon={icon} title={title} subtitle={subtitle} status={status} footnote={footnote}>
      {canEdit ? (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault()
            actions.save(provider, { token }, () => setToken(""))
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={last4 ? "Paste a new key to replace it" : placeholder}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            aria-label={title}
            className="sm:flex-1"
          />
          <div className="flex items-center gap-2">
            <a
              href={keyUrl}
              target="_blank"
              rel="noreferrer"
              className="px-1 text-[12.5px] text-muted hover:text-text hover:underline"
            >
              Get a key ↗
            </a>
            <Button
              size="sm"
              variant="primary"
              type="submit"
              disabled={!token.trim() || actions.pending}
            >
              <Spin on={actions.busy === `save-${provider}`} />
              Save
            </Button>
            {canCheck && (last4 || included) ? (
              <Button
                size="sm"
                variant="outline"
                disabled={actions.pending}
                onClick={() => actions.check(provider)}
              >
                <Spin on={actions.busy === `check-${provider}`} />
                Check
              </Button>
            ) : null}
            {last4 ? (
              <Button
                size="sm"
                variant="quiet"
                disabled={actions.pending}
                onClick={() => actions.remove(provider)}
              >
                Remove
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </ProviderCard>
  )
}

function VpsRow({
  vps,
  canEdit,
  actions,
}: {
  vps: ComputerProvidersView["vps"]
  canEdit: boolean
  actions: ReturnType<typeof useProviderActions>
}) {
  const [mode, setMode] = useState<"address" | "alias">(
    vps.alias && !vps.address ? "alias" : "address",
  )
  const [address, setAddress] = useState(vps.address ?? "")
  const [alias, setAlias] = useState(vps.alias ?? "")
  const [privateKey, setPrivateKey] = useState("")
  const [startAutomatically, setStartAutomatically] = useState(vps.startAutomatically)
  const saved = vps.address ?? vps.alias
  const status = saved ? (
    <StatusPill tone={vps.address && !vps.hasKey ? "warn" : "ok"}>
      {vps.address
        ? vps.hasKey
          ? `${vps.address} · key saved`
          : `${vps.address} · no key`
        : `SSH name ${vps.alias}`}
    </StatusPill>
  ) : (
    <StatusPill tone="idle">Not set up</StatusPill>
  )

  return (
    <ProviderCard
      icon={<Server className="h-4 w-4" />}
      title="Self-hosted VPS"
      subtitle="Your own Linux server, reached over SSH"
      status={status}
      footnote={
        <>
          Any Linux machine with Docker that you reach over SSH works, including a computer on your
          Tailscale network (use its Tailscale name as the address). Each bot gets its own container
          with its files in /home/bot. Sayabot never turns the server off.
        </>
      }
    >
      {canEdit ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            actions.save(
              "vps",
              mode === "address"
                ? { address, privateKey, startAutomatically }
                : { alias, startAutomatically },
              () => setPrivateKey(""),
            )
          }}
        >
          <div
            className="inline-flex rounded-lg border border-line p-0.5"
            role="tablist"
            aria-label="How to reach the server"
          >
            {(
              [
                ["address", "Address and key"],
                ["alias", "SSH config name"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[12.5px] transition-colors",
                  mode === value ? "bg-raised text-text" : "text-muted hover:text-text",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "address" ? (
            <>
              <Input
                placeholder="ubuntu@203.0.113.7 or ubuntu@my-vps:2222"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                aria-label="SSH address"
                spellCheck={false}
                autoComplete="off"
              />
              <Textarea
                placeholder={
                  vps.hasKey
                    ? "A private key is saved. Paste a new one to replace it."
                    : "Paste the SSH private key (-----BEGIN OPENSSH PRIVATE KEY----- …) for this server"
                }
                value={privateKey}
                onChange={(event) => setPrivateKey(event.target.value)}
                aria-label="SSH private key"
                spellCheck={false}
                autoComplete="off"
                className="min-h-20 font-mono text-[11.5px]"
              />
              <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-faint">
                <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                The key is encrypted before it is saved and can&apos;t be shown again. Make a key
                without a passphrase just for Sayabot, and add its public half to
                ~/.ssh/authorized_keys on the server.
              </p>
            </>
          ) : (
            <>
              <Input
                placeholder="my-vps"
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                aria-label="SSH config name"
                spellCheck={false}
                autoComplete="off"
              />
              <p className="text-[12px] leading-relaxed text-faint">
                A Host name from ~/.ssh/config on the machine running the Sayabot server. Sayabot
                uses that config and its SSH agent, and stores no key.
              </p>
            </>
          )}

          <label className="flex items-center gap-2 text-[12.5px] text-muted">
            <input
              type="checkbox"
              checked={startAutomatically}
              onChange={(event) => setStartAutomatically(event.target.checked)}
            />
            Bots set to Auto may also start their container here
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              type="submit"
              disabled={actions.pending || (mode === "address" ? !address.trim() : !alias.trim())}
            >
              <Spin on={actions.busy === "save-vps"} />
              Save
            </Button>
            {saved ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actions.pending}
                  onClick={() => actions.check("vps")}
                >
                  <Spin on={actions.busy === "check-vps"} />
                  Check connection
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={actions.pending}
                  onClick={() => actions.remove("vps")}
                >
                  Remove
                </Button>
              </>
            ) : null}
          </div>
        </form>
      ) : null}
    </ProviderCard>
  )
}

/** Settings → AI providers → Computers and browser: Boat, E2B, your own VPS, and website logins. */
export function ComputerProviders({
  orgSlug,
  view,
  canEdit,
}: {
  orgSlug: string
  view: ComputerProvidersView
  canEdit: boolean
}) {
  const actions = useProviderActions(orgSlug)
  return (
    <ProviderList>
      <KeyRow
        provider="boat"
        title="Boat API key"
        subtitle="Cloud desktops your bots can see and click"
        placeholder="boat_… or box_…"
        keyUrl="https://boat.dev"
        last4={view.boat.last4}
        included={view.boat.included}
        canEdit={canEdit}
        canCheck={false}
        icon={<Ship className="h-4 w-4" />}
        footnote="Boat is a paid service after its trial. A Boat sleeps after 10 idle minutes and wakes with its files."
        actions={actions}
      />
      <KeyRow
        provider="e2b"
        title="E2B API key"
        subtitle="Cloud Linux sandboxes, one per bot"
        placeholder="e2b_…"
        keyUrl="https://e2b.dev/dashboard?tab=keys"
        last4={view.e2b.last4}
        included={view.e2b.included}
        canEdit={canEdit}
        canCheck
        icon={<Cloud className="h-4 w-4" />}
        footnote="Each bot gets its own sandbox. E2B pauses it after 10 idle minutes and resumes it with its files. E2B bills usage to this key."
        actions={actions}
      />
      <VpsRow vps={view.vps} canEdit={canEdit} actions={actions} />
      <ProviderCard
        icon={<KeyRound className="h-4 w-4" />}
        title="1Password"
        subtitle="Website logins your bots can use"
        status={
          <Link
            href={`/${orgSlug}/settings/vault`}
            className="text-[12.5px] font-medium text-accent hover:underline"
          >
            Open Vault →
          </Link>
        }
        footnote="Set up in Vault, then grant a login to the bots that need it."
      />
    </ProviderList>
  )
}
