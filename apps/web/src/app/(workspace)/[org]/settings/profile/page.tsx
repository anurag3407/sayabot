import type { Metadata } from "next"
import Link from "next/link"
import { listUserOrgs, requireOrgAccess } from "@/lib/auth"
import { signOutAction } from "@/lib/actions/auth"
import { humanHandle } from "@/lib/human-handle"
import { cn } from "@/lib/format"
import { buttonVariants } from "@/components/ui/button"
import { EnableAlerts } from "@/components/room/room-activity"
import { ProfileForm } from "@/components/settings/profile-form"
import { Section } from "@/components/settings/section"

export const metadata: Metadata = { title: "Profile & alerts" }

export default async function ProfileSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAccess(orgSlug)
  const orgs = await listUserOrgs(access.user.id)

  return (
    <>
      <Section
        title="Profile"
        description={`How you appear in rooms, to agents and in mentions. Your handle is @${humanHandle(access.user.displayName)}.`}
        className="border-t-0 pt-0"
      >
        <ProfileForm
          email={access.user.email}
          displayName={access.user.displayName}
          avatarUrl={access.user.avatarUrl}
          notifications={access.user.notifications}
          sound={access.user.sound}
        />
        <p className="mt-4 text-[12px] leading-relaxed text-faint">
          Renaming yourself changes your @handle and the name on your messages. Past messages and
          authorship records are unchanged.
        </p>
      </Section>

      <Section
        title="Browser alerts"
        description="Desktop and phone notifications when an agent needs your approval or someone mentions you. Each browser asks separately."
        actions={<EnableAlerts enabled={access.user.notifications !== "off"} />}
      >
        <p className="text-[12px] text-faint">
          {access.user.notifications === "off"
            ? "Alerts are off. Choose “Everything” or “Only mentions” above to turn them on."
            : "If no button appears, this browser already granted or blocked alerts. Change that in the browser's site settings."}
        </p>
      </Section>

      <Section title="Your workspaces" description="Every workspace you belong to, and your role in each.">
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {orgs.map((org) => (
            <li key={org.id}>
              <Link
                href={`/${org.slug}`}
                className="flex items-center justify-between gap-3 px-4 py-3 text-[13px] hover:bg-panel"
              >
                <span className="min-w-0 truncate">
                  {org.name}
                  {org.slug === orgSlug ? <span className="ml-2 text-[11px] text-accent">current</span> : null}
                </span>
                <span className="shrink-0 font-mono text-[11px] capitalize text-faint">{org.role}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/new-workspace" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}>
          New workspace
        </Link>
      </Section>

      <Section
        title="Sign-in & security"
        description={access.user.email ? `Signed in as ${access.user.email}.` : "Signed in with an external provider."}
      >
        <div className="flex flex-wrap gap-2">
          <Link href="/forgot-password" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Change password
          </Link>
          <form action={signOutAction}>
            <button type="submit" className={buttonVariants({ variant: "danger", size: "sm" })}>
              Sign out
            </button>
          </form>
        </div>
      </Section>
    </>
  )
}
