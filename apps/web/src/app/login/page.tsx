import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getCurrentUser, listUserOrgs } from "@/lib/auth"
import { githubAuthEnabled, googleAuthEnabled } from "@/lib/env"
import { PublicShell } from "@/components/public/public-shell"
import { AuthPanel } from "@/components/auth/auth-panel"
import { safeNextPath } from "@/lib/safe-next"

export const metadata: Metadata = { title: "Sign in · Sayabot" }
export const dynamic = "force-dynamic"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; force?: string; reauth?: string; switch?: string }>
}) {
  const params = await searchParams
  const isForce = params.force === "true" || params.reauth === "true" || params.switch === "true"
  const user = await getCurrentUser()
  if (user && !isForce) {
    const next = safeNextPath(params.next, "")
    if (next && next !== "/" && next !== "/login" && next !== "/signup") {
      redirect(next)
    }
    const orgs = await listUserOrgs(user.id)
    redirect(orgs.length ? `/${orgs[0]!.slug}` : "/onboarding")
  }
  const next = safeNextPath(params.next)

  return (
    <PublicShell>
      <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[1fr_400px] lg:items-center lg:py-20">
        <div>
          <p className="font-mono text-[12px] text-faint">welcome back</p>
          <h1 className="mt-2 max-w-[16ch] text-3xl font-medium leading-tight tracking-[-0.02em] sm:text-4xl">
            Sign in to your rooms.
          </h1>
          <p className="mt-4 max-w-[42ch] text-[14px] leading-relaxed text-muted">
            The room keeps its position: the last messages, the canvas, the meeting card and the
            approvals that still need you.
          </p>
          {params.error ? (
            <p
              role="alert"
              className="mt-6 max-w-[42ch] border-l-2 border-[var(--color-danger)] pl-3 text-[13px] leading-relaxed text-danger"
            >
              {params.error === "auth"
                ? "Sign-in did not complete. The verification link or session may have expired. Try again."
                : decodeURIComponent(params.error)}
            </p>
          ) : null}
        </div>
        <AuthPanel
          initialMode="signin"
          signupNext="/onboarding"
          signInNext={next}
          googleEnabled={googleAuthEnabled()}
          githubEnabled={githubAuthEnabled()}
        />
      </div>
    </PublicShell>
  )
}
