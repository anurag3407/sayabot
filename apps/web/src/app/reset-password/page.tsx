import type { Metadata } from "next"
import Link from "next/link"
import { getCurrentUser } from "@/lib/auth"
import { PublicShell } from "@/components/public/public-shell"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"

export const metadata: Metadata = { title: "Choose a new password · Sayabot" }

export default async function ResetPasswordPage() {
  const user = await getCurrentUser()
  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-md px-5 py-16 sm:px-8">
        <p className="font-mono text-[12px] text-faint">account recovery</p>
        <h1 className="mt-2 text-2xl font-medium tracking-[-0.02em]">Choose a new password</h1>
        {user ? (
          <>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              Use at least 8 characters. This changes the password for this account on every device.
            </p>
            <div className="mt-6 rounded-md border border-line bg-panel p-5">
              <ResetPasswordForm email={user.email ?? null} />
            </div>
          </>
        ) : (
          <div className="mt-6 rounded-md border border-line bg-panel p-5">
            <p className="text-[13px] leading-relaxed text-muted">
              This reset link is missing or expired. Request a new one from the address on the
              account.
            </p>
            <Link
              href="/forgot-password"
              className="mt-4 inline-block font-mono text-[12px] text-accent underline underline-offset-4"
            >
              request a new link
            </Link>
          </div>
        )}
      </div>
    </PublicShell>
  )
}
