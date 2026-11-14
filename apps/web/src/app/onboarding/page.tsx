import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getCurrentUser, getProfile, listUserOrgs, requireUser } from "@/lib/auth"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { devModelConfigured } from "@/lib/env"
import { macDefaultApp } from "@/lib/desktop-hosts"
import { OnboardingWizard } from "@/components/onboarding/wizard"

export const metadata: Metadata = { title: "Set up your workspace" }

const FALLBACK_ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
]

function timeZones(): string[] {
  try {
    const supported = Intl.supportedValuesOf("timeZone")
    if (supported.length > 0) {
      return supported.includes("UTC") ? supported : ["UTC", ...supported]
    }
  } catch {
    // Older runtimes without supportedValuesOf fall back to the short list.
  }
  return FALLBACK_ZONES
}

export default async function OnboardingPage() {
  const user = await requireUser("/onboarding")
  const orgs = await listUserOrgs(user.id)
  const supabase = await createSupabaseServerClient()
  const { data: row } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", user.id)
    .maybeSingle()
  const resume = (row?.preferences as { onboarding?: { orgSlug: string; roomId: string } } | null)
    ?.onboarding
  const inProgress = resume && orgs.some((org) => org.slug === resume.orgSlug) ? resume : null
  if (orgs.length > 0 && !inProgress) redirect(`/${orgs[0]!.slug}`)
  const current = await getCurrentUser()
  if (!current) redirect("/login")
  const profile = await getProfile(current)
  // "member" is the placeholder for accounts without a name yet (every guest starts that way).
  const firstName =
    profile.displayName === "member" ? "" : (profile.displayName.split(" ")[0] ?? "")
  const macApp = await macDefaultApp(user.id)

  return (
    <OnboardingWizard
      userName={firstName}
      macApp={macApp}
      defaultTimeZone="UTC"
      timeZones={timeZones()}
      hasServerModel={devModelConfigured()}
      initialWorkspace={inProgress ? { slug: inProgress.orgSlug, roomId: inProgress.roomId } : null}
    />
  )
}
