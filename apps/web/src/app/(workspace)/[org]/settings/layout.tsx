import { isOrgAdmin, requireOrgAccess } from "@/lib/auth"
import { SettingsNav } from "@/components/settings/settings-nav"

/**
 * Open to every member: personal settings live here too. Admin-only pages gate themselves
 * with requireOrgAdmin, and the nav simply hides what this person cannot open.
 */
export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ org: string }>
}) {
  const { org: orgSlug } = await params
  const access = await requireOrgAccess(orgSlug)
  const isAdmin = isOrgAdmin(access.role)
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-5 pb-16 pt-6 sm:px-8 md:pt-10">
        <div className="md:pl-[15rem]">
          <h1 className="text-2xl font-medium tracking-[-0.02em]">Settings</h1>
          <p className="mt-1 text-[13px] text-muted">
            {access.org.name}
            <span className="text-faint"> · </span>
            <span className="capitalize">{access.role}</span>
          </p>
        </div>
        <div className="mt-6 flex flex-col gap-6 md:mt-8 md:flex-row md:gap-8">
          <div className="md:sticky md:top-0 md:self-start">
            <SettingsNav orgSlug={orgSlug} isAdmin={isAdmin} />
          </div>
          <div className="min-w-0 max-w-3xl flex-1 space-y-8">{children}</div>
        </div>
      </div>
    </div>
  )
}
