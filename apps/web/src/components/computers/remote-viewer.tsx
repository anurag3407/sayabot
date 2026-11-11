"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { Maximize, MousePointer2, PhoneOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/format"

type Phase = "starting" | "waiting" | "connected" | "denied" | "ended" | "error"

const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }]

function waitForIce(pc: RTCPeerConnection, ms = 3_000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check)
      resolve()
    }
    const check = () => pc.iceGatheringState === "complete" && done()
    pc.addEventListener("icegatheringstatechange", check)
    setTimeout(done, ms)
  })
}

/** Where the picture actually sits inside the <video> box (object-contain letterboxing). */
function contentRect(video: HTMLVideoElement) {
  const box = video.getBoundingClientRect()
  const vw = video.videoWidth || box.width
  const vh = video.videoHeight || box.height
  const scale = Math.min(box.width / vw, box.height / vh)
  const w = vw * scale
  const h = vh * scale
  return { left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2, width: w, height: h }
}

const SPECIAL_KEYS = new Set([
  "Enter", "Backspace", "Tab", "Escape", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Home", "End", "PageUp", "PageDown", " ",
])

/**
 * Remote desktop viewer: WebRTC straight to the computer (the server only passes the offer
 * and answer along), with mouse and keyboard sent over a data channel when control is on.
 */
export function RemoteViewer({ orgSlug, hostId, hostName }: { orgSlug: string; hostId: string; hostName: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const sessionRef = useRef<string | null>(null)
  const lastMove = useRef(0)
  const [phase, setPhase] = useState<Phase>("starting")
  const [message, setMessage] = useState<string | null>(null)
  const [control, setControl] = useState(true)

  const hangUp = useCallback(async () => {
    const id = sessionRef.current
    sessionRef.current = null
    pcRef.current?.close()
    if (id) await fetch(`/api/remote/sessions/${id}`, { method: "DELETE" }).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    async function start() {
      const pc = new RTCPeerConnection({ iceServers: ICE })
      pcRef.current = pc
      pc.addTransceiver("video", { direction: "recvonly" })
      const dc = pc.createDataChannel("input", { ordered: true })
      dcRef.current = dc
      pc.ontrack = (event) => {
        if (videoRef.current) videoRef.current.srcObject = event.streams[0] ?? new MediaStream([event.track])
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") setPhase("connected")
        if (pc.connectionState === "failed") {
          setPhase("error")
          setMessage("The connection dropped. Both devices need internet; some strict networks block direct connections.")
        }
        if (pc.connectionState === "disconnected" || pc.connectionState === "closed") setPhase((p) => (p === "connected" ? "ended" : p))
      }
      await pc.setLocalDescription(await pc.createOffer())
      await waitForIce(pc)
      if (cancelled) return
      const res = await fetch("/api/remote/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostId, offer: JSON.stringify(pc.localDescription), control: true }),
      })
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
      if (!res.ok || !data.id) {
        setPhase("error")
        setMessage(data.error ?? "Could not reach the computer")
        return
      }
      sessionRef.current = data.id
      setPhase("waiting")
      const deadline = Date.now() + 60_000
      while (!cancelled && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1_000))
        const poll = await fetch(`/api/remote/sessions/${data.id}`, { cache: "no-store" })
        const state = (await poll.json().catch(() => ({}))) as { status?: string; answer?: string | null; error?: string | null }
        if (state.status === "answered" && state.answer) {
          await pc.setRemoteDescription(JSON.parse(state.answer))
          return
        }
        if (state.status === "denied" || state.status === "failed" || state.status === "ended") {
          setPhase(state.status === "denied" ? "denied" : "error")
          setMessage(state.error ?? (state.status === "denied" ? "The computer declined." : "The computer couldn't start sharing."))
          return
        }
      }
      if (!cancelled) {
        setPhase("error")
        setMessage("The computer didn't answer. Is the Sayabot app open on it?")
        void hangUp()
      }
    }
    void start().catch((err) => {
      setPhase("error")
      setMessage(err instanceof Error ? err.message : "Could not connect")
    })
    return () => {
      cancelled = true
      void hangUp()
    }
  }, [hostId, hangUp])

  const send = useCallback(
    (event: Record<string, unknown>) => {
      const dc = dcRef.current
      if (control && dc && dc.readyState === "open") dc.send(JSON.stringify(event))
    },
    [control],
  )

  function point(e: React.PointerEvent | React.MouseEvent) {
    const video = videoRef.current
    if (!video) return null
    const r = contentRect(video)
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  useEffect(() => {
    if (phase !== "connected" || !control) return
    const onKey = (e: KeyboardEvent) => {
      const mods = [e.metaKey && "cmd", e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && "shift"].filter(Boolean) as string[]
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) send({ t: "text", s: e.key })
      else if (SPECIAL_KEYS.has(e.key) || (e.key.length === 1 && (e.metaKey || e.ctrlKey))) send({ t: "key", key: e.key, mods })
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [phase, control, send])

  return (
    <div className="flex h-full flex-col bg-void">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-4 py-2.5">
        <Link href={`/${orgSlug}/settings/computers`} className="text-[13px] text-muted hover:text-text">
          ← Computers
        </Link>
        <p className="ml-2 min-w-0 flex-1 truncate text-[14px] font-medium text-text">
          {hostName}
          <span className="ml-2 text-[12px] font-normal text-faint">
            {phase === "starting" && "Starting…"}
            {phase === "waiting" && "Waiting for the computer to allow it…"}
            {phase === "connected" && (control ? "Connected · you're in control" : "Connected · view only")}
            {phase === "denied" && "Declined"}
            {phase === "ended" && "Ended"}
            {phase === "error" && "Not connected"}
          </span>
        </p>
        <Button size="sm" variant={control ? "secondary" : "ghost"} onClick={() => setControl((c) => !c)} disabled={phase !== "connected"}>
          <MousePointer2 className="h-3.5 w-3.5" /> {control ? "Control on" : "View only"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => videoRef.current?.parentElement?.requestFullscreen?.()} disabled={phase !== "connected"}>
          <Maximize className="h-3.5 w-3.5" /> Full screen
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={async () => {
            await hangUp()
            setPhase("ended")
          }}
        >
          <PhoneOff className="h-3.5 w-3.5" /> Disconnect
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={cn("h-full w-full bg-black object-contain", control && phase === "connected" ? "cursor-none" : "")}
          onPointerMove={(e) => {
            const now = performance.now()
            if (now - lastMove.current < 30) return
            lastMove.current = now
            const p = point(e)
            if (p) send({ t: "move", ...p })
          }}
          onPointerDown={(e) => {
            const p = point(e)
            if (p) send({ t: "down", ...p, b: e.button === 2 ? 2 : 0 })
          }}
          onPointerUp={(e) => {
            const p = point(e)
            if (p) send({ t: "up", ...p, b: e.button === 2 ? 2 : 0 })
          }}
          onContextMenu={(e) => control && e.preventDefault()}
          onWheel={(e) => send({ t: "scroll", dy: Math.round(e.deltaY / 20), dx: Math.round(e.deltaX / 20) })}
        />
        {phase !== "connected" ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="max-w-sm">
              <p className="text-[15px] text-text">
                {phase === "starting" || phase === "waiting" ? `Connecting to ${hostName}…` : (message ?? "Disconnected")}
              </p>
              {phase === "waiting" ? (
                <p className="mt-2 text-[13px] text-muted">If “Ask on this computer” is on, someone at it needs to press Allow.</p>
              ) : null}
              {phase === "ended" || phase === "error" || phase === "denied" ? (
                <Button className="mt-4" variant="primary" onClick={() => window.location.reload()}>
                  Try again
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
