"use client"

import Link from "next/link"
import { useEffect, useState, type ComponentType } from "react"
import { Box, Check, Cloud, Monitor, Power, Sparkles } from "lucide-react"
import { getComputerProvidersAction } from "@/lib/actions/computer-providers"
import {
  CLOUD_PROVIDERS,
  cloudProviderReady,
  type CloudProviderId,
  type ComputerProvidersView,
} from "@/lib/computer-providers-shared"
import { cn } from "@/lib/format"
import { isCloudWorksOn, tileOf, WORKS_ON_TILES, type WorksOnTile } from "@/lib/works-on"

const ICONS: Record<WorksOnTile, ComponentType<{ className?: string }>> = {
  auto: Sparkles,
  cloud: Cloud,
  local_vm: Box,
  this_computer: Monitor,
  off: Power,
}

// One fetch per workspace per page load; every picker on the page shares it.
const cache = new Map<string, Promise<ComputerProvidersView | null>>()

/** Undefined while loading; null when the status could not be read. */
export function useComputerProviders(orgSlug: string): ComputerProvidersView | null | undefined {
  const [view, setView] = useState<ComputerProvidersView | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    let pending = cache.get(orgSlug)
    if (!pending) {
      pending = getComputerProvidersAction(orgSlug).catch(() => null)
      cache.set(orgSlug, pending)
    }
    void pending.then((value) => live && setView(value))
    return () => {
      live = false
    }
  }, [orgSlug])
  return view
}

/** After a save in Settings the next picker should see it. */
export function forgetComputerProviders(orgSlug: string): void {
  cache.delete(orgSlug)
}

/**
 * Where a bot works: Auto, a cloud desktop (Boat, your VPS or E2B), a private desktop on this Mac,
 * this computer's own screen, or nothing. The stored values stay those of lib/works-on.
 */
export function WorksOnPicker({
  orgSlug,
  worksOn,
  onChange,
  disabled,
  canAdmin,
}: {
  orgSlug: string
  worksOn: string
  onChange: (worksOn: string) => void
  disabled?: boolean
  canAdmin: boolean
}) {
  const providers = useComputerProviders(orgSlug)
  const tile = tileOf(worksOn)
  const cloud: CloudProviderId | null = isCloudWorksOn(worksOn) ? worksOn : null

  function pickTile(next: WorksOnTile) {
    if (next === tile) return
    if (next !== "cloud") return onChange(next)
    const firstReady = CLOUD_PROVIDERS.find((p) => cloudProviderReady(providers ?? null, p.id))
    onChange(firstReady?.id ?? "boat")
  }

  const active = cloud ? CLOUD_PROVIDERS.find((p) => p.id === cloud) : null
  const ready = cloud ? cloudProviderReady(providers ?? null, cloud) : true

  return (
    <div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Where this bot works">
        {WORKS_ON_TILES.map((item) => {
          const selected = item.value === tile
          const Icon = ICONS[item.value]
          return (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => pickTile(item.value)}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed",
                selected
                  ? "border-accent/70 bg-accent-soft/60"
                  : "border-line hover:border-line-strong hover:bg-raised/60 disabled:hover:border-line disabled:hover:bg-transparent",
              )}
            >
              <span className="flex items-center gap-2 text-[13.5px] font-medium text-text">
                {selected ? (
                  <Check className="h-4 w-4 text-accent" />
                ) : (
                  <Icon className="h-4 w-4 text-muted" />
                )}
                {item.label}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-faint">{item.hint}</span>
            </button>
          )
        })}
      </div>

      {cloud && active ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-[13px] text-muted">{active.detail}</p>
          <div className="mt-3 rounded-xl bg-raised/50 p-3">
            <p className="text-[13.5px] font-medium text-text">Cloud provider</p>
            <div
              className="mt-2 grid grid-cols-3 overflow-hidden rounded-lg border border-line"
              role="radiogroup"
              aria-label="Cloud provider"
            >
              {CLOUD_PROVIDERS.map((provider, index) => {
                const selected = provider.id === cloud
                const set = cloudProviderReady(providers ?? null, provider.id)
                return (
                  <button
                    key={provider.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={disabled}
                    onClick={() => !selected && onChange(provider.id)}
                    className={cn(
                      "relative px-2 py-2 text-[12.5px] transition-colors disabled:cursor-not-allowed",
                      index > 0 && "border-l border-line",
                      selected
                        ? "bg-panel font-medium text-text"
                        : "text-muted hover:bg-panel/60 hover:text-text",
                    )}
                  >
                    {provider.id === "vps" ? (
                      <>
                        <span className="sm:hidden">Your VPS</span>
                        <span className="hidden sm:inline">{provider.label}</span>
                      </>
                    ) : (
                      provider.label
                    )}
                    {providers && !set ? (
                      <span className="ml-1 text-faint" aria-label="not set up">
                        ·
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            {providers === undefined ? (
              <p className="mt-2 text-[12px] text-faint">Checking setup…</p>
            ) : providers === null ? null : ready ? (
              <p className="mt-2 text-[12px] text-faint">
                {cloud === "vps"
                  ? `Runs on ${providers.vps.address ?? providers.vps.alias}. The bot opens its container the first time it needs it.`
                  : "Set up. The bot opens its desktop the first time it needs it."}
              </p>
            ) : (
              <p className="mt-2 text-[12px] text-warn">
                Not set up yet.{" "}
                {canAdmin ? (
                  <Link
                    href={`/${orgSlug}/settings/keys#computers`}
                    className="font-medium text-accent hover:underline"
                  >
                    Add it in AI providers →
                  </Link>
                ) : (
                  "Ask a workspace admin to add it in AI providers."
                )}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
