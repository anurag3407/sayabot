import type { Metadata } from "next"
import Link from "next/link"
import { requireUser } from "@/lib/auth"
import { checkJoinCode } from "@/lib/actions/workspace-invites"
import { JoinButton } from "./join-button"
import { SayabotMark } from "@/components/landing/sayabot-mark"

export const metadata: Metadata = { title: "Join a workspace", robots: { index: false } }
export const dynamic = "force-dynamic"

/** Landing page for invite links. Signed-out visitors go through login/signup and come back here. */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const user = await requireUser(`/join/${code}`)
  const check = await checkJoinCode(code)

  return (
    <main className="grid min-h-dvh place-items-center bg-void px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 text-center">
        <SayabotMark className="mx-auto h-12 w-12" />
        {check.ok ? (
          <>
            <h1 className="mt-4 text-[20px] font-semibold text-text">Join {check.orgName}</h1>
            <p className="mt-2 text-[14px] text-muted">
              {check.inviterName ? `${check.inviterName} invited you` : "You've been invited"} as{" "}
              {check.role === "admin" ? "an admin" : "a member"}
              {check.roomIds.length ? ` and to ${check.roomIds.length === 1 ? "a room" : `${check.roomIds.length} rooms`}` : ""}.
            </p>
            <p className="mt-1 text-[12px] text-faint">Signed in as {user.email}</p>
            <JoinButton code={code} />
          </>
        ) : (
          <>
            <h1 className="mt-4 text-[18px] font-semibold text-text">Can&apos;t join</h1>
            <p className="mt-2 text-[14px] text-muted">{check.reason}</p>
            <Link href="/" className="mt-6 inline-flex text-[13px] font-medium text-accent hover:underline">
              Go to Sayabot
            </Link>
          </>
        )}
      </div>
    </main>
  )
}
