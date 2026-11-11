"use client"

import { Smartphone } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { revokePhoneAction, type PhoneView } from "@/lib/actions/phones"
import { AddPhoneDialog } from "@/components/phones/add-phone-dialog"
import { Button } from "@/components/ui/button"
import { PlusIcon } from "@/components/ui/icons"
import { showToast } from "@/components/ui/toast"

function seen(iso: string | null): string {
  if (!iso) return "never"
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

export function PhonesList({ orgSlug, phones }: { orgSlug: string; phones: PhoneView[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function remove(phone: PhoneView) {
    startTransition(async () => {
      const result = await revokePhoneAction({ orgSlug, phoneId: phone.id })
      showToast({ tone: result.ok ? "neutral" : "danger", message: result.ok ? (result.message ?? "Removed") : (result.error ?? "Could not remove") })
      router.refresh()
    })
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium text-text">Your phones</h2>
          <p className="mt-1 text-[13px] text-muted">Phones that use Sayabot with this account.</p>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          <PlusIcon width={14} height={14} /> Add phone
        </Button>
      </div>

      {phones.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-line p-6 text-center">
          <p className="text-[14px] text-muted">No phones yet.</p>
          <p className="mt-1 text-[13px] text-faint">Add one to answer your agents and hand out tasks on the go.</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {phones.map((phone) => (
            <li key={phone.id} className="flex items-center gap-3 rounded-xl border border-line bg-panel p-4">
              <span aria-hidden className="grid h-10 w-10 place-items-center rounded-lg bg-raised text-muted">
                <Smartphone className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-text">{phone.deviceName}</p>
                <p className="text-[12px] text-faint">
                  {phone.platform ? `${phone.platform} · ` : ""}Last active {seen(phone.lastSeenAt ?? phone.pairedAt)}
                </p>
              </div>
              <Button size="sm" variant="quiet" disabled={pending} onClick={() => remove(phone)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[12px] leading-relaxed text-faint">
        Removing a phone takes effect at once. The phone signs out the next time it is opened or brought back from the background.
      </p>

      <AddPhoneDialog orgSlug={orgSlug} open={open} onClose={() => setOpen(false)} onPaired={() => router.refresh()} />
    </div>
  )
}
