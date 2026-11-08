import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getCurrentUser, listUserOrgs } from "@/lib/auth"
import { githubAuthEnabled, googleAuthEnabled } from "@/lib/env"
import { PublicShell } from "@/components/public/public-shell"
import { AuthPanel } from "@/components/auth/auth-panel"

export const metadata: Metadata = { title: "Create an account · Sayabot" }
export const dynamic = "force-dynamic"

export default async function SignUpPage() {
  const user = await getCurrentUser()
  if (user) {
    const orgs = await listUserOrgs(user.id)
    redirect(orgs.length ? `/${orgs[0]!.slug}` : "/onboarding")
  }
  return (
    <PublicShell>
      <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[1fr_400px] lg:items-center lg:py-20">
        <div>
          <p className="font-mono text-[12px] text-faint">new workspace</p>
          <h1 className="mt-2 max-w-[16ch] text-3xl font-medium leading-tight tracking-[-0.02em] sm:text-4xl">
            Open one room. Invite the rest later.
          </h1>
          <p className="mt-4 max-w-[42ch] text-[14px] leading-relaxed text-muted">
            The setup takes about three minutes: a six-digit email code, a room name and time zone,
            meeting defaults, then the agents you want in the room.
          </p>
          <p className="mt-8 font-mono text-[11px] leading-relaxed text-faint">
            No credit card. No model key is required to create the workspace.
          </p>
        </div>
        <AuthPanel
          initialMode="signup"
          signupNext="/onboarding"
          signInNext="/"
          googleEnabled={googleAuthEnabled()}
          githubEnabled={githubAuthEnabled()}
        />
      </div>
    </PublicShell>
  )
}
