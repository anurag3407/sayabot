import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getCurrentUser, listUserOrgs } from "@/lib/auth"
import { safeNextPath } from "@/lib/safe-next"
import { PublicShell } from "@/components/public/public-shell"
import { SaveAccountForm } from "@/components/auth/save-account-form"

export const metadata: Metadata = { title: "Save your account · Sayabot" }
export const dynamic = "force-dynamic"

export default async function SaveAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const params = await searchParams
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  let next = safeNextPath(params.next, "")
  if (!next || next === "/") {
    const orgs = await listUserOrgs(user.id)
    next = orgs[0]?.slug ? `/${orgs[0].slug}` : "/onboarding"
  }
  // Already a full account: nothing to save.
  if (user.is_anonymous !== true) redirect(next)

  return (
    <PublicShell>
      <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[1fr_400px] lg:items-center lg:py-20">
        <div>
          <p className="font-mono text-[12px] text-faint">guest account</p>
          <h1 className="mt-2 max-w-[18ch] text-3xl font-medium leading-tight tracking-[-0.02em] sm:text-4xl">
            Keep everything you made.
          </h1>
          <p className="mt-4 max-w-[42ch] text-[14px] leading-relaxed text-muted">
            Your bots, chats and computers move into the account you sign in to: a new one or one
            you already have. Then you can open them on your phone, the web or another Mac.
          </p>
          {params.error ? (
            <p
              role="alert"
              className="mt-6 max-w-[42ch] border-l-2 border-[var(--color-danger)] pl-3 text-[13px] leading-relaxed text-danger"
            >
              {params.error}
            </p>
          ) : null}
        </div>
        <SaveAccountForm next={next} />
      </div>
    </PublicShell>
  )
}
