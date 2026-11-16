import type { Metadata } from "next"
import { requireUser } from "@/lib/auth"
import { NewWorkspaceForm } from "@/components/onboarding/new-workspace-form"
import Link from "next/link"

export const metadata: Metadata = { title: "New workspace" }

export default async function NewWorkspacePage() {
  await requireUser("/new-workspace")
  return (
    <main id="main-content" className="grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-md">
        <p className="font-mono text-[12px] text-faint">
          <Link href="/" className="hover:text-text">
            back to your workspace
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-medium tracking-[-0.02em]">Create a workspace</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          A workspace keeps its own rooms, agents, API keys and members, separate from your other
          workspaces.
        </p>
        <div className="mt-6">
          <NewWorkspaceForm />
        </div>
      </div>
    </main>
  )
}
