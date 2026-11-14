import type { Metadata } from "next"
import Link from "next/link"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { confirmGuestMergeAction } from "@/lib/actions/guest-merge"
import { findMergeTicket, MERGE_COOKIE, summarizeGuest } from "@/lib/guest-merge"
import { safeNextPath } from "@/lib/safe-next"
import { PublicShell } from "@/components/public/public-shell"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = { title: "Move your guest workspace · Sayabot" }
export const dynamic = "force-dynamic"

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

export default async function MergeFinishPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const params = await searchParams
  const next = safeNextPath(params.next, "")
  const self = `/auth/merge/finish${next ? `?next=${encodeURIComponent(next)}` : ""}`
  const signInElsewhere = `/login?force=true&merge=1&next=${encodeURIComponent(self)}`

  const user = await getCurrentUser()
  if (!user || user.is_anonymous === true) redirect(signInElsewhere)

  const token = (await cookies()).get(MERGE_COOKIE)?.value
  const ticket = await findMergeTicket(token)

  if (!ticket) {
    return (
      <PublicShell>
        <div className="mx-auto w-full max-w-md px-5 py-20">
          <div className="space-y-4 rounded-2xl border border-line bg-panel p-6">
            <h1 className="text-lg font-medium">Nothing to move</h1>
            <p className="text-[13px] leading-relaxed text-muted">
              This link has expired or was already used. If your guest workspace isn't in your
              account yet, open the Sayabot app and choose <em>Save account</em> again.
            </p>
            <Link href={next || "/"} className="text-[13px] text-accent hover:underline">
              Continue
            </Link>
          </div>
        </div>
      </PublicShell>
    )
  }

  const summary = await summarizeGuest(ticket.guestUserId)
  const workspaces = summary.workspaces.map((w) => w.name)
  const account = user.email || "this account"

  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-md px-5 py-20">
        <form
          action={confirmGuestMergeAction}
          className="space-y-5 rounded-2xl border border-line bg-panel p-6"
        >
          <input type="hidden" name="next" value={next} />
          <div className="space-y-2">
            <p className="font-mono text-[12px] text-faint">save guest workspace</p>
            <h1 className="text-xl font-medium tracking-[-0.01em]">
              Move everything into {account}?
            </h1>
            <p className="text-[13px] leading-relaxed text-muted">
              Your bots, chats, files and settings from the guest session will belong to{" "}
              <span className="text-text">{account}</span>. You can open them from any device you
              sign in on. Your existing workspaces aren't changed.
            </p>
          </div>

          <ul className="space-y-1.5 rounded-xl border border-line bg-raised p-4 text-[13px]">
            <li>
              <span className="text-faint">Workspaces: </span>
              {workspaces.length ? listNames(workspaces) : "none yet"}
            </li>
            {summary.computers.length ? (
              <li>
                <span className="text-faint">Computers: </span>
                {listNames(summary.computers)}
              </li>
            ) : null}
          </ul>

          {params.error ? (
            <p role="alert" className="text-[13px] text-danger">
              {params.error}
            </p>
          ) : null}

          <Button type="submit" variant="primary" className="w-full">
            Move into my account
          </Button>
          <Link
            href={signInElsewhere}
            className="block text-center text-[12px] text-faint hover:text-text"
          >
            Use a different account
          </Link>
        </form>
      </div>
    </PublicShell>
  )
}
