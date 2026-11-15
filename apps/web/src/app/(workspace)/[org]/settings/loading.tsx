import { Skeleton } from "@/components/ui/skeleton"

/**
 * Shown inside the settings layout while a page loads, so a click in the nav answers at once
 * (and Next can prefetch this shell) instead of freezing on the previous page.
 */
export default function SettingsLoading() {
  return (
    <div role="status" aria-label="Loading settings" className="fade-in space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-3 w-80 max-w-full" />
      </div>
      <div className="space-y-3 rounded-2xl border border-line bg-panel p-5">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-28 w-full rounded-2xl" />
    </div>
  )
}
