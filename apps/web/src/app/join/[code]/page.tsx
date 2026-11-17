import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth"
import { describeJoin } from "@/lib/workspace-invites"
import { JoinButton } from "./join-button"
import { SayabotMark } from "@/components/landing/sayabot-mark"

export const metadata: Metadata = { title: "Join a workspace", robots: { index: false } }
export const dynamic = "force-dynamic"

/** Landing page for invite links. Signed-out visitors go through login/signup and come back here. */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const user = await requireUser(`/join/${code}`)
  const state = await describeJoin(code, user.id)
  if (state.ok && state.alreadyMember) redirect(`/${state.orgSlug}`)

  return (
    <main className="grid min-h-dvh place-items-center bg-void px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 text-center">
        <SayabotMark className="mx-auto h-12 w-12" />
        {state.ok ? (
          <>
            <h1 className="mt-4 text-[20px] font-semibold text-text">Join {state.orgName}</h1>
            <p className="mt-2 text-[14px] text-muted">
              {state.inviterName ? `${state.inviterName} shared a link` : "You've been invited"} as{" "}
              {state.role === "admin" ? "an admin" : "a member"}
              {state.roomCount
                ? ` and to ${state.roomCount === 1 ? "a room" : `${state.roomCount} rooms`}`
                : ""}
              . A workspace admin approves you before you can see anything.
            </p>
            <p className="mt-1 text-[12px] text-faint">Signed in as {user.email}</p>
            {state.heldBySomeoneElse ? (
              <p className="mt-4 text-[14px] text-muted">
                Someone else is already using this link. Ask for a new one.
              </p>
            ) : state.request === "pending" ? (
              <p className="mt-4 text-[14px] text-text">
                Waiting for a workspace admin to approve you.
              </p>
            ) : (
              <JoinButton code={code} again={state.request === "declined"} />
            )}
          </>
        ) : (
          <>
            <h1 className="mt-4 text-[18px] font-semibold text-text">Can&apos;t join</h1>
            <p className="mt-2 text-[14px] text-muted">{state.reason}</p>
            <Link
              href="/"
              className="mt-6 inline-flex text-[13px] font-medium text-accent hover:underline"
            >
              Go to Sayabot
            </Link>
          </>
        )}
      </div>
    </main>
  )
}
