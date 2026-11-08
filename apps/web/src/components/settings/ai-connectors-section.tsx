"use client"

import { useState } from "react"
import { Plug, Settings } from "lucide-react"
import { ManageAccountsModal } from "@/components/room/model-picker"

export function AIConnectorsBanner() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#232b25] bg-[#101411] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ff7a45]/10 text-[#ff7a45]">
            <Plug className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#e9e5d8]">AI Accounts & Subscriptions</h3>
            <p className="text-xs text-[#9aa39b]">
              Connect OpenRouter OAuth (400+ free models), ChatGPT Plus/Pro plan, or GitHub Copilot.
            </p>
          </div>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-[#232b25] px-4 py-2 text-xs font-semibold text-[#e9e5d8] hover:bg-[#354037] transition-colors"
        >
          <Settings className="h-3.5 w-3.5 text-[#9aa39b]" />
          Manage AI Accounts
        </button>
      </div>

      <ManageAccountsModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  )
}
