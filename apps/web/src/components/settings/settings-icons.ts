import type { ComponentType } from "react"
import {
  Bot,
  Brain,
  Cable,
  CircleDollarSign,
  KeyRound,
  LockKeyhole,
  Plug,
  Smartphone,
  UserRound,
  UsersRound,
} from "lucide-react"
import type { SettingsIconKey } from "@/lib/settings-nav"

/** Plain module (no "use client") so both server pages and the client nav can import it. */
export const SETTINGS_ICONS: Record<SettingsIconKey, ComponentType<{ className?: string }>> = {
  profile: UserRound,
  phones: Smartphone,
  workspace: UsersRound,
  keys: KeyRound,
  pricing: CircleDollarSign,
  tools: Plug,
  connectors: Cable,
  bots: Bot,
  vault: LockKeyhole,
  vector: Brain,
}
