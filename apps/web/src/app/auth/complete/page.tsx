import type { Metadata } from "next"
import { CompleteAuth } from "@/components/auth/complete-auth"
import { safeNextPath } from "@/lib/safe-next"

export const metadata: Metadata = { title: "Opening Sayabot…" }
export const dynamic = "force-dynamic"

export default async function AuthCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const next = safeNextPath(params.next, "")

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#070907] px-4 text-white selection:bg-[#34d399]/30">
      <CompleteAuth next={next} />
    </div>
  )
}
