import { cn } from "@/lib/format"

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-sm bg-raised", className)} />
}

export function PageSkeleton() {
  return (
    <div className="h-full overflow-hidden" role="status" aria-label="Loading">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-7 w-48" />
        <Skeleton className="mt-3 h-3 w-72 max-w-full" />
        <div className="mt-8 space-y-4 border-t border-line pt-6">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The app shell, for moments before the sidebar exists: creating or opening a workspace. */
export function WorkspaceSkeleton({ label = "Opening your workspace" }: { label?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex bg-void" role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <aside className="hidden w-[284px] shrink-0 flex-col gap-3 border-r border-line p-3 md:flex" aria-hidden="true">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-9 w-full rounded-md" />
        <div className="mt-2 space-y-2">
          {["w-3/4", "w-1/2", "w-2/3", "w-3/5", "w-4/5", "w-1/2"].map((width, row) => (
            <div key={row} className="flex items-center gap-2 px-1 py-1">
              <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
              <Skeleton className={`h-3 ${width}`} />
            </div>
          ))}
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-ink" aria-hidden="true">
        <div className="border-b border-line px-4 py-3">
          <Skeleton className="h-4 w-36" />
        </div>
          <div className="min-h-0 flex-1 space-y-6 px-4 py-6">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex gap-3">
                <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-3/4 max-w-xl" />
                  {row % 2 === 0 ? <Skeleton className="h-3 w-1/2 max-w-md" /> : null}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-line p-4">
            <Skeleton className="h-16 w-full rounded-md" />
          </div>
        </div>
      </div>
    )
  }

/** The name-your-workspace form, while that page itself is loading. */
export function SetupSkeleton() {
  return (
    <main className="grid min-h-dvh place-items-center px-6" role="status" aria-label="Loading">
      <div className="w-full max-w-md space-y-4" aria-hidden="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="mt-4 h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-40 rounded-md" />
      </div>
    </main>
  )
}

export function RoomSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col" role="status" aria-label="Loading room">
      <div className="border-b border-line bg-ink px-4 py-3">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-hidden px-4 py-6">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex gap-3">
            <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-3/4 max-w-xl" />
              {row % 2 === 0 ? <Skeleton className="h-3 w-1/2 max-w-md" /> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-line p-4">
        <Skeleton className="h-20 w-full rounded-md" />
      </div>
    </div>
  )
}
