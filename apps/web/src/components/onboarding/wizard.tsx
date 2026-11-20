"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { finishOnboardingAction, setupWorkspaceAction } from "@/lib/actions/onboarding"
import { Button } from "@/components/ui/button"
import { Field, HelpText, Input } from "@/components/ui/field"
import { InlineAlert } from "@/components/ui/empty"
import { WorkspaceSkeleton } from "@/components/ui/skeleton"

const DEFAULT_ROOM = "General"

function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (zone) return zone
  } catch {
    // Older runtimes without a resolved time zone fall back to UTC.
  }
  return "UTC"
}

export function OnboardingWizard({
  userName,
  initialWorkspace = null,
}: {
  userName: string
  initialWorkspace?: { slug: string; roomId: string } | null
}) {
  const router = useRouter()
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [workspaceName, setWorkspaceName] = useState(
    userName ? `${userName}'s workspace` : "My workspace",
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!initialWorkspace) return
    let cancelled = false
    startTransition(async () => {
      const result = await finishOnboardingAction(initialWorkspace.slug, initialWorkspace.roomId)
      if (cancelled) return
      if (!result.ok) {
        setError(result.error ?? "Could not open the workspace")
        return
      }
      const path =
        typeof result.data?.path === "string" ? result.data.path : `/${initialWorkspace.slug}`
      router.push(path)
    })
    return () => {
      cancelled = true
    }
  }, [initialWorkspace, router])

  function openRoom(slug: string, roomId: string, path?: string) {
    router.push(path ?? `/${slug}/r/${roomId}`)
  }

  function createWorkspace() {
    setError(null)
    startTransition(async () => {
      let slug = workspace?.slug ?? ""
      let roomId = workspace?.roomId ?? ""
      if (!slug || !roomId) {
        const form = new FormData()
        form.set("workspaceName", workspaceName.trim())
        form.set("roomName", DEFAULT_ROOM)
        form.set("timezone", browserTimeZone())
        const result = await setupWorkspaceAction(null, form)
        if (!result.ok) {
          setError(result.error ?? "Could not create the workspace")
          return
        }
        slug = typeof result.data?.orgSlug === "string" ? result.data.orgSlug : ""
        roomId = typeof result.data?.roomId === "string" ? result.data.roomId : ""
        if (!slug || !roomId) {
          setError("The workspace was created but could not be opened. Reload to continue.")
          return
        }
        setWorkspace({ slug, roomId })
      }
      const finished = await finishOnboardingAction(slug, roomId)
      if (!finished.ok) {
        setError(finished.error ?? "Could not open the workspace")
        return
      }
      const path = typeof finished.data?.path === "string" ? finished.data.path : undefined
      openRoom(slug, roomId, path)
    })
  }

  const nameOk = workspaceName.trim().length >= 2 && workspaceName.trim().length <= 60

  if (pending || (initialWorkspace && !error)) {
    return (
      <WorkspaceSkeleton
        label={initialWorkspace ? "Opening your workspace" : "Creating your workspace"}
      />
    )
  }

  if (initialWorkspace && error) {
    return (
      <main id="main-content" className="grid min-h-dvh place-items-center px-6">
        <div className="w-full max-w-md space-y-4 text-center">
          <InlineAlert tone="danger">{error}</InlineAlert>
          <Button
            variant="primary"
            size="lg"
            onClick={() => openRoom(initialWorkspace.slug, initialWorkspace.roomId)}
          >
            Open workspace
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main id="main-content" className="grid min-h-dvh place-items-center px-6 py-10">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-medium tracking-[-0.02em] sm:text-3xl">Name your workspace</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          {userName ? `Welcome, ${userName}. ` : ""}
          This is the name your team sees. You can rename it later.
        </p>
        <form
          className="mt-7 space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!pending && nameOk) createWorkspace()
          }}
        >
          <Field label="workspace name" htmlFor="workspace-name" hint="your team or company">
            <Input
              id="workspace-name"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              maxLength={60}
              placeholder="Acme design team"
              autoFocus
              required
              minLength={2}
            />
          </Field>
          <HelpText>A first chat called General is created for you.</HelpText>
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
          <Button type="submit" variant="primary" size="lg" disabled={!nameOk}>
            Create workspace
          </Button>
        </form>
      </div>
    </main>
  )
}
