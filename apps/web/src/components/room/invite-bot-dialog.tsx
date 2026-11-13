"use client"

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react"
import {
  botInviteStatusAction,
  createBotInviteAction,
  decideBotInviteAction,
  revokeBotInviteAction,
  type BotInviteView,
} from "@/lib/actions/bot-invites"
import { createRoomBotKey } from "@/lib/actions/invites"
import {
  AnthropicMark,
  CursorMark,
  GoogleMark,
  HermesMark,
  OpenAIMark,
} from "@/components/room/model-picker/provider-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { BotIcon, CheckIcon, CloseIcon, CopyIcon } from "@/components/ui/icons"
import { cn } from "@/lib/format"

interface Props {
  orgSlug: string
  roomId: string
  roomName: string
  /** Controlled mode (the Agents page opens it after a room is chosen). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  /** Prefill from the Providers page ("Claude Code is on this computer → Add to a room"). */
  initialApp?: string
  initialName?: string
}

interface AppChoice {
  id: string
  label: string
  icon: ReactNode
}

const APPS: AppChoice[] = [
  { id: "hermes", label: "Hermes", icon: <HermesMark size={14} /> },
  { id: "claude-code", label: "Claude Code", icon: <AnthropicMark size={14} /> },
  { id: "codex", label: "Codex", icon: <OpenAIMark size={14} /> },
  { id: "cursor", label: "Cursor", icon: <CursorMark size={14} /> },
  { id: "claude", label: "Claude app", icon: <AnthropicMark size={14} /> },
  { id: "chatgpt", label: "ChatGPT", icon: <OpenAIMark size={14} /> },
  { id: "antigravity", label: "Gemini", icon: <GoogleMark size={14} /> },
  { id: "generic", label: "Something else", icon: <BotIcon width={14} height={14} /> },
]

type View = "form" | "link" | "manual"

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1_800)
      return true
    } catch {
      return false
    }
  }, [])
  return { copied, copy }
}

function Step({
  n,
  state,
  title,
  children,
}: {
  n: number
  state: "done" | "active" | "todo"
  title: string
  children?: ReactNode
}) {
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-medium",
          state === "done" && "bg-ok/15 text-ok",
          state === "active" && "bg-accent/15 text-accent",
          state === "todo" && "bg-raised text-faint",
        )}
        aria-hidden
      >
        {state === "done" ? <CheckIcon width={12} height={12} /> : n}
      </span>
      <div className="min-w-0 flex-1 pb-1">
        <p className={cn("text-[14px] leading-snug", state === "todo" ? "text-faint" : "text-text")}>
          {title}
          {state === "active" ? (
            <span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent align-middle" />
          ) : null}
        </p>
        {children}
      </div>
    </li>
  )
}

export function InviteBotDialog({
  orgSlug,
  roomId,
  roomName,
  open: openProp,
  onOpenChange,
  hideTrigger,
  initialApp,
  initialName,
}: Props) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (value: boolean) => {
    setOpenState(value)
    onOpenChange?.(value)
  }
  const [view, setView] = useState<View>("form")
  const [name, setName] = useState(initialName ?? "")
  const [app, setApp] = useState<string | null>(initialApp ?? null)
  const [invite, setInvite] = useState<BotInviteView | null>(null)
  const [pasted, setPasted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [manual, setManual] = useState<{ prompt?: string; snippet?: string; handle?: string } | null>(null)
  const { copied, copy } = useCopy()
  const dialogRef = useRef<HTMLDivElement>(null)

  const appLabel = APPS.find((a) => a.id === app)?.label
  const botName = name.trim() || appLabel || "your agent"

  function reset() {
    setView("form")
    setName(initialName ?? "")
    setApp(initialApp ?? null)
    setInvite(null)
    setPasted(false)
    setError(null)
    setManual(null)
  }

  function close() {
    setOpen(false)
    // Keep a live link alive (the bot may still knock); only clear the dialog's state.
    window.setTimeout(reset, 200)
  }

  // Live status while the bot is on its way.
  useEffect(() => {
    if (!open || !invite) return
    if (!["waiting", "pending", "approved"].includes(invite.state)) return
    const timer = window.setInterval(async () => {
      const result = await botInviteStatusAction({ orgSlug, inviteId: invite.id })
      if (result.ok && result.data?.invite) setInvite(result.data.invite as BotInviteView)
    }, 2_500)
    return () => window.clearInterval(timer)
  }, [open, invite, orgSlug])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    dialogRef.current?.focus()
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function createLink() {
    setError(null)
    startTransition(async () => {
      const result = await createBotInviteAction({
        orgSlug,
        roomId,
        name: name.trim() || appLabel,
        app: app ?? undefined,
      })
      if (!result.ok || !result.data?.invite) {
        setError(result.error ?? "Could not make the link")
        return
      }
      setInvite(result.data.invite as BotInviteView)
      setView("link")
    })
  }

  function decide(approve: boolean) {
    if (!invite) return
    setError(null)
    startTransition(async () => {
      const result = await decideBotInviteAction({ orgSlug, inviteId: invite.id, approve })
      if (!result.ok) {
        setError(result.error ?? "Could not save your answer")
        return
      }
      const status = await botInviteStatusAction({ orgSlug, inviteId: invite.id })
      if (status.ok && status.data?.invite) setInvite(status.data.invite as BotInviteView)
    })
  }

  function cancelLink() {
    if (!invite) return
    startTransition(async () => {
      await revokeBotInviteAction({ orgSlug, inviteId: invite.id })
      close()
    })
  }

  function makeManual() {
    setError(null)
    startTransition(async () => {
      const form = new FormData()
      form.append("orgSlug", orgSlug)
      form.append("roomId", roomId)
      form.append("client", app ?? "generic")
      const handle = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")
      if (handle) form.append("handle", handle)
      const result = await createRoomBotKey(null, form)
      if (!result.ok || !result.data) {
        setError(result.error ?? "Could not set it up")
        return
      }
      setManual(result.data as { prompt?: string; snippet?: string; handle?: string })
    })
  }

  const state = invite?.state
  const asked = state === "pending" || state === "approved" || state === "joined"
  const stepAsk: "done" | "active" | "todo" = asked ? "done" : pasted ? "active" : "todo"
  const stepApprove: "done" | "active" | "todo" =
    state === "approved" || state === "joined" ? "done" : state === "pending" ? "active" : "todo"
  const stepJoin: "done" | "active" | "todo" = state === "joined" ? "done" : state === "approved" ? "active" : "todo"
  const requester = invite?.requestName || botName

  return (
    <>
      {hideTrigger ? null : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] text-muted transition-colors hover:bg-panel hover:text-text"
        >
          <BotIcon width={15} height={15} />
          <span>Add agent</span>
        </button>
      )}

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-void/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close()
          }}
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-agent-title"
            className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-xl border border-line bg-panel p-5 shadow-2xl outline-none sm:rounded-xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="add-agent-title" className="text-[17px] font-semibold text-text">
                  {view === "manual" ? "Set up by hand" : "Add an agent"}
                </h2>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  {view === "manual"
                    ? `For apps that can't open links. This gives ${botName} its key directly.`
                    : `Bring an agent you already use, like Hermes or Claude Code, into #${roomName}.`}
                </p>
              </div>
              <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={close}>
                <CloseIcon width={14} height={14} />
              </Button>
            </div>

            {view === "form" ? (
              <div className="mt-5 space-y-5">
                <div>
                  <label htmlFor="agent-name" className="text-[13px] font-medium text-text">
                    What do you call it?
                  </label>
                  <Input
                    id="agent-name"
                    className="mt-1.5"
                    value={name}
                    maxLength={60}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Like Hermes"
                    autoFocus
                  />
                  <p className="mt-1.5 text-[12px] text-faint">
                    Use the same name it has in its own app, so everyone knows who it is.
                  </p>
                </div>

                <div>
                  <p className="text-[13px] font-medium text-text">
                    Which app is it in? <span className="font-normal text-faint">(optional)</span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {APPS.map((choice) => (
                      <button
                        key={choice.id}
                        type="button"
                        aria-pressed={app === choice.id}
                        onClick={() => setApp(app === choice.id ? null : choice.id)}
                        className={cn(
                          "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors",
                          app === choice.id
                            ? "border-accent bg-accent-soft text-text"
                            : "border-line text-muted hover:border-line-strong hover:text-text",
                        )}
                      >
                        {choice.icon}
                        {choice.label}
                      </button>
                    ))}
                  </div>
                </div>

                {error ? (
                  <p role="alert" className="text-[13px] text-danger">
                    {error}
                  </p>
                ) : null}

                <a
                  href={`/${orgSlug}/agents/new?room=${encodeURIComponent(roomId)}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-ink px-3 py-2.5 text-[13px] text-muted hover:border-line-strong hover:text-text"
                >
                  <span>
                    <span className="block font-medium text-text">Don&apos;t have one? Create a new agent</span>
                    Pick a ready-made agent or build your own, powered by your AI account.
                  </span>
                  <span aria-hidden>→</span>
                </a>

                <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center">
                  <Button variant="primary" size="lg" disabled={pending} onClick={createLink} className="sm:min-w-44">
                    {pending ? "Making link…" : "Get invite link"}
                  </Button>
                  <Button variant="quiet" size="sm" onClick={() => setView("manual")}>
                    Its app can&apos;t open links? Set up by hand
                  </Button>
                </div>
              </div>
            ) : null}

            {view === "link" && invite ? (
              <div className="mt-5 space-y-5">
                {state === "joined" ? (
                  <div className="rounded-lg border border-ok/30 bg-ok/10 p-4 text-center">
                    <p className="text-[15px] font-medium text-text">
                      @{invite.agentHandle ?? "agent"} joined #{roomName}
                    </p>
                    <p className="mt-1 text-[13px] text-muted">
                      Mention it in the chat or give it a task. It checks in on its own.
                    </p>
                  </div>
                ) : state === "declined" || state === "expired" || state === "revoked" ? (
                  <div className="rounded-lg border border-line bg-raised p-4 text-[13px] text-muted">
                    This link is {state}. Make a new one to try again.
                  </div>
                ) : null}

                <ol className="space-y-4">
                  <Step n={1} state={pasted || asked ? "done" : "active"} title={`Paste this into ${botName}'s chat`}>
                    {!asked ? (
                      <div className="mt-2 rounded-lg border border-line bg-ink p-3">
                        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted">
                          {invite.message}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={async () => {
                              if (await copy("message", invite.message)) setPasted(true)
                            }}
                          >
                            {copied === "message" ? <CheckIcon width={13} height={13} /> : <CopyIcon width={13} height={13} />}
                            {copied === "message" ? "Copied" : "Copy message"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              if (await copy("link", invite.url)) setPasted(true)
                            }}
                          >
                            {copied === "link" ? "Copied" : "Copy link only"}
                          </Button>
                        </div>
                        <p className="mt-2 text-[12px] text-faint">
                          No password is in this message. The link works once, for one app, until you approve it.
                        </p>
                      </div>
                    ) : null}
                  </Step>

                  <Step
                    n={2}
                    state={stepAsk}
                    title={asked ? `${requester} asked to join` : `${botName} opens the link and asks to join`}
                  >
                    {invite.rejectedAttempts > 0 ? (
                      <p className="mt-1 text-[12px] text-warn">
                        {invite.rejectedAttempts === 1
                          ? "Another app also tried this link and was turned away."
                          : `${invite.rejectedAttempts} other attempts on this link were turned away.`}
                      </p>
                    ) : null}
                  </Step>

                  <Step n={3} state={stepApprove} title="You approve it">
                    {state === "pending" ? (
                      <div className="mt-2 rounded-lg border border-accent/40 bg-accent-soft p-3">
                        <p className="text-[14px] text-text">
                          <span className="font-medium">{invite.requestName}</span>
                          {invite.requestAppLabel ? <span className="text-muted"> · {invite.requestAppLabel}</span> : null}
                        </p>
                        {invite.requestAbout ? (
                          <p className="mt-1 text-[13px] text-muted">&ldquo;{invite.requestAbout}&rdquo;</p>
                        ) : null}
                        <p className="mt-2 text-[12px] text-faint">
                          Only approve if you just pasted the link into this agent. It can then read and post in
                          #{roomName} and take tasks there, nothing else.
                        </p>
                        <div className="mt-3 flex gap-2">
                          <Button variant="primary" size="sm" disabled={pending} onClick={() => decide(true)}>
                            Approve
                          </Button>
                          <Button variant="outline" size="sm" disabled={pending} onClick={() => decide(false)}>
                            Decline
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </Step>

                  <Step
                    n={4}
                    state={stepJoin}
                    title={state === "joined" ? "Connected" : `${requester} connects and says hello`}
                  />
                </ol>

                {error ? (
                  <p role="alert" className="text-[13px] text-danger">
                    {error}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
                  {state === "waiting" || state === "pending" ? (
                    <Button variant="quiet" size="sm" disabled={pending} onClick={cancelLink}>
                      Cancel this link
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button variant={state === "joined" ? "primary" : "secondary"} size="sm" onClick={close}>
                    {state === "joined" ? "Done" : "Close, I'll approve it later"}
                  </Button>
                </div>
                {state === "waiting" || state === "pending" ? (
                  <p className="text-[12px] text-faint">
                    You can close this. The request will wait in your Inbox for 7 days.
                  </p>
                ) : null}
              </div>
            ) : null}

            {view === "manual" ? (
              <div className="mt-5 space-y-4">
                {!manual ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {APPS.map((choice) => (
                        <button
                          key={choice.id}
                          type="button"
                          aria-pressed={app === choice.id}
                          onClick={() => setApp(choice.id)}
                          className={cn(
                            "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors",
                            app === choice.id
                              ? "border-accent bg-accent-soft text-text"
                              : "border-line text-muted hover:border-line-strong hover:text-text",
                          )}
                        >
                          {choice.icon}
                          {choice.label}
                        </button>
                      ))}
                    </div>
                    <div className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-[12px] leading-relaxed text-muted">
                      This message contains the agent&apos;s private key. Paste it only into {botName}&apos;s own
                      chat, never into a group or shared doc.
                    </div>
                    {error ? (
                      <p role="alert" className="text-[13px] text-danger">
                        {error}
                      </p>
                    ) : null}
                    <div className="flex flex-col gap-2 sm:flex-row-reverse">
                      <Button variant="primary" disabled={pending || !app} onClick={makeManual}>
                        {pending ? "Setting up…" : app ? `Make setup message for ${appLabel}` : "Pick its app first"}
                      </Button>
                      <Button variant="ghost" onClick={() => setView("form")}>
                        Back
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] text-muted">
                      Registered as <span className="font-medium text-text">@{manual.handle}</span>. Copy this into
                      its chat. It is shown once.
                    </p>
                    {manual.prompt ? (
                      <div className="rounded-lg border border-line bg-ink p-3">
                        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-muted">
                          {manual.prompt}
                        </p>
                        <Button className="mt-3" variant="primary" size="sm" onClick={() => copy("prompt", manual.prompt!)}>
                          {copied === "prompt" ? "Copied" : "Copy setup message"}
                        </Button>
                      </div>
                    ) : null}
                    {manual.snippet ? (
                      <details className="rounded-lg border border-line p-3">
                        <summary className="cursor-pointer text-[13px] text-muted">Config for developers</summary>
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted">
                          {manual.snippet}
                        </pre>
                        <Button className="mt-2" variant="ghost" size="sm" onClick={() => copy("snippet", manual.snippet!)}>
                          {copied === "snippet" ? "Copied" : "Copy config"}
                        </Button>
                      </details>
                    ) : null}
                    <div className="flex justify-end">
                      <Button variant="secondary" size="sm" onClick={close}>
                        Done
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
