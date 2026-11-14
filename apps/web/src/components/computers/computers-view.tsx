"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { Monitor } from "lucide-react"
import { removeHostAction, updateHostSettingsAction } from "@/lib/actions/desktop"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/field"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"
import type { ComputerView } from "@/lib/computers"

const PERMISSION_LABELS: Record<string, string> = {
  screen: "Screen Recording",
  accessibility: "Accessibility",
}

function PermissionRow({ name, value }: { name: string; value: string | undefined }) {
  const ok = value === "granted"
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-[14px] text-text">{PERMISSION_LABELS[name] ?? name}</span>
      <span className={cn("rounded-full px-2.5 py-1 text-[12px]", ok ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn")}>
        {ok ? "Allowed" : value === "unknown" || !value ? "Unknown" : "Needs permission"}
      </span>
    </div>
  )
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-accent" : "bg-line-strong",
      )}
    >
      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all", checked ? "left-[22px]" : "left-0.5")} />
    </button>
  )
}

function ComputerCard({ orgSlug, computer }: { orgSlug: string; computer: ComputerView }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const s = computer.settings

  function save(patch: Parameters<typeof updateHostSettingsAction>[0] extends infer T ? Partial<T> : never) {
    startTransition(async () => {
      const result = await updateHostSettingsAction({ orgSlug, hostId: computer.id, ...patch })
      showToast({ tone: result.ok ? "success" : "danger", message: result.ok ? "Saved" : (result.error ?? "Could not save") })
      router.refresh()
    })
  }

  return (
    <li className="rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-raised text-muted">
          <Monitor className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-text">{computer.name}</p>
          <p className="text-[12px] text-faint">
            <span className={computer.online ? "text-ok" : undefined}>{computer.online ? "Online" : "Offline"}</span>
            {" · "}
            {computer.platform === "darwin" ? "macOS" : computer.platform}
            {computer.appVersion ? ` · app ${computer.appVersion}` : ""}
            {!computer.mine && computer.ownerName ? ` · ${computer.ownerName}'s` : ""}
          </p>
        </div>
        <Link
          href={`/${orgSlug}/remote/${computer.id}`}
          aria-disabled={!computer.online}
          className={cn(
            "inline-flex h-10 items-center rounded-sm px-4 text-[13px] font-medium md:h-9",
            computer.online ? "bg-accent text-void hover:bg-[var(--color-accent-strong)]" : "pointer-events-none bg-raised text-faint",
          )}
        >
          Connect
        </Link>
      </div>

      {computer.mine ? (
        <div className="space-y-4 border-t border-line p-4">
          <div className="divide-y divide-line rounded-lg border border-line bg-ink px-3">
            <PermissionRow name="screen" value={computer.permissions.screen} />
            <PermissionRow name="accessibility" value={computer.permissions.accessibility} />
          </div>
          {computer.permissions.screen !== "granted" || computer.permissions.accessibility !== "granted" ? (
            <p className="text-[12px] leading-relaxed text-faint">
              On the Mac: System Settings → Privacy &amp; Security → Screen Recording (to see the screen) and Accessibility (to
              control it). Turn on Sayabot, then reopen the app.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[14px] text-text">Who can control this computer</p>
              <p className="text-[12px] text-faint">People who can open this computer&apos;s screen from another device.</p>
            </div>
            <Select
              value={s.whoCanControl ?? "only_me"}
              disabled={pending}
              onChange={(event) => save({ whoCanControl: event.target.value as "only_me" | "admins" | "members" })}
              className="w-44"
              aria-label="Who can control this computer"
            >
              <option value="only_me">Only me</option>
              <option value="admins">Workspace admins</option>
              <option value="members">All members</option>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[14px] text-text">Ask on this computer</p>
              <p className="text-[12px] text-faint">
                Each session waits until a person at the computer allows it. With no answer in 30 seconds, it&apos;s refused.
              </p>
            </div>
            <Toggle label="Ask on this computer" checked={s.askOnComputer !== false} disabled={pending} onChange={(v) => save({ askOnComputer: v })} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[14px] text-text">Run agents on this computer</p>
              <p className="text-[12px] text-faint">
                Agents set to “This computer” answer using Claude Code or Codex signed in here, on your own subscription.
              </p>
            </div>
            <Toggle label="Run agents on this computer" checked={Boolean(s.runnerEnabled)} disabled={pending} onChange={(v) => save({ runnerEnabled: v })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[14px] text-text">Use this computer for my agents</p>
              <p className="text-[12px] text-faint">
                Agents with no key or computer of their own run here, in workspaces only you are in. When this computer is offline, the server answers.
              </p>
            </div>
            <Toggle
              label="Use this computer for my agents"
              checked={Boolean(s.runnerEnabled && s.localDefault)}
              disabled={pending}
              onChange={(v) => save({ localDefault: v })}
            />
          </div>
          {computer.localAgents.length ? (
            <p className="text-[12px] text-faint">
              Found here:{" "}
              {computer.localAgents
                .map((a) => `${a.name}${a.status === "ready" ? "" : ` (${a.status.replace("_", " ")})`}`)
                .join(", ")}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button
              size="sm"
              variant="quiet"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await removeHostAction({ orgSlug, hostId: computer.id })
                  showToast({ tone: result.ok ? "neutral" : "danger", message: result.ok ? (result.message ?? "Removed") : (result.error ?? "Could not remove") })
                  router.refresh()
                })
              }
            >
              Remove this computer
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

export function ComputersView({ orgSlug, computers }: { orgSlug: string; computers: ComputerView[] }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[18px] font-semibold text-text">Computers</h2>
        <p className="mt-1 text-[13px] text-muted">
          Open your Mac&apos;s screen from anywhere, and let agents run on the apps signed in there.
        </p>
      </div>
      {computers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-6 text-center">
          <p className="text-[14px] text-text">No computers yet</p>
          <p className="mt-1 text-[13px] text-muted">Install Sayabot for Mac and sign in. Your computer shows up here.</p>
          <Link href="/download" className="mt-3 inline-flex text-[13px] font-medium text-accent hover:underline">
            Get Sayabot for Mac →
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {computers.map((computer) => (
            <ComputerCard key={computer.id} orgSlug={orgSlug} computer={computer} />
          ))}
        </ul>
      )}
    </div>
  )
}
