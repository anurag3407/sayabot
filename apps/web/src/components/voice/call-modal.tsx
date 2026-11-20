"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import {
  PhoneOff,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  ShieldAlert,
  Check,
  X,
  Sparkles,
} from "lucide-react"
import { startRecording, type RecordingSession } from "@/lib/tts/vad"
import { speaker, useSpeech } from "@/lib/tts"
import { sendMessage } from "@/lib/actions/messages"
import { Mascot } from "@/components/ui/mascot"
import { cn } from "@/lib/format"
import type { MessageView, ToolCallView, TurnStateView } from "@/lib/types"

export interface CallModalProps {
  isOpen: boolean
  onClose: () => void
  orgSlug: string
  roomId: string
  roomName: string
  agent?: { id: string; handle: string; displayName: string; avatarUrl?: string | null } | null
  messages: MessageView[]
  toolCalls: ToolCallView[]
  turnState: TurnStateView | null
}

type CallPhase =
  "connecting" | "listening" | "transcribing" | "thinking" | "speaking" | "approval_needed"

export function CallModal({
  isOpen,
  onClose,
  orgSlug,
  roomId,
  roomName,
  agent,
  messages,
  toolCalls,
  turnState: _turnState,
}: CallModalProps) {
  const [phase, setPhase] = useState<CallPhase>("connecting")
  const [isMuted, setIsMuted] = useState(false)
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false)
  const [volumeLevel, setVolumeLevel] = useState(0)
  const [callDuration, setCallDuration] = useState(0)
  const [lastUserSpeech, setLastUserSpeech] = useState<string | null>(null)
  const [lastAgentSpeech, setLastAgentSpeech] = useState<string | null>(null)
  const [spokenApprovalCall, setSpokenApprovalCall] = useState<ToolCallView | null>(null)

  const sessionRef = useRef<RecordingSession | null>(null)
  const recordingActiveRef = useRef(false)
  const lastSpokenMessageIdRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const handleSpeechEndRef = useRef<(blob: Blob) => Promise<void>>(() => Promise.resolve())

  const { status: speakerStatus } = useSpeech()

  // Track call timer
  useEffect(() => {
    if (!isOpen) {
      setCallDuration(0)
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }

    timerRef.current = setInterval(() => {
      setCallDuration((d) => d + 1)
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isOpen])

  // Clean exit when modal closes
  const hangUp = useCallback(() => {
    recordingActiveRef.current = false
    if (sessionRef.current) {
      sessionRef.current.cancel()
      sessionRef.current = null
    }
    speaker.stop()
    onClose()
  }, [onClose])

  // Turn management: start listening to user
  const armMicrophone = useCallback(async () => {
    if (isMuted || !isOpen) return
    if (recordingActiveRef.current) return

    try {
      recordingActiveRef.current = true
      setPhase("listening")

      const session = await startRecording({
        silenceTimeoutMs: 1700,
        minSpeechMs: 400,
        onVolumeChange: (vol) => setVolumeLevel(vol),
        onSpeechEnd: async (blob) => {
          recordingActiveRef.current = false
          sessionRef.current = null
          await handleSpeechEndRef.current(blob)
        },
        onError: (err) => {
          console.warn("VAD error:", err)
          recordingActiveRef.current = false
          sessionRef.current = null
        },
      })

      sessionRef.current = session
    } catch (err) {
      console.warn("Failed to arm microphone:", err)
      recordingActiveRef.current = false
    }
  }, [isMuted, isOpen])

  const approvePendingTool = useCallback(
    async (callId: string, approved: boolean) => {
      try {
        await fetch(`/api/v1/rooms/${roomId}/tool-calls/${callId}/approval`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approved }),
        })
      } catch (err) {
        console.warn("Tool approval post failed:", err)
      }
    },
    [roomId],
  )

  // Transcribe recorded audio and send turn to room
  const handleSpeechEnd = useCallback(
    async (blob: Blob) => {
      if (blob.size < 1200) {
        // Too short, re-arm
        void armMicrophone()
        return
      }

      setPhase("transcribing")
      try {
        const formData = new FormData()
        formData.append("file", blob, "call-turn.wav")

        const res = await fetch("/api/v1/tts/transcribe", {
          method: "POST",
          body: formData,
        })

        if (!res.ok) throw new Error("Transcription failed")
        const data = (await res.json()) as { text?: string }
        const text = data.text?.trim()

        if (!text) {
          void armMicrophone()
          return
        }

        setLastUserSpeech(text)

        // Spoken approval check if a dangerous tool is waiting
        if (spokenApprovalCall) {
          const lower = text.toLowerCase()
          if (
            lower.includes("yes") ||
            lower.includes("approve") ||
            lower.includes("confirm") ||
            lower.includes("proceed") ||
            lower.includes("go ahead")
          ) {
            // Spoken approval detected!
            await approvePendingTool(spokenApprovalCall.id, true)
            setSpokenApprovalCall(null)
            return
          } else if (
            lower.includes("no") ||
            lower.includes("reject") ||
            lower.includes("cancel") ||
            lower.includes("stop")
          ) {
            await approvePendingTool(spokenApprovalCall.id, false)
            setSpokenApprovalCall(null)
            return
          }
        }

        // Send message to room to trigger agent turn
        setPhase("thinking")
        await sendMessage({
          orgSlug,
          roomId,
          content: text,
        })
      } catch (err) {
        console.warn("Speech handling error:", err)
        void armMicrophone()
      }
    },
    [approvePendingTool, armMicrophone, orgSlug, roomId, spokenApprovalCall],
  )

  handleSpeechEndRef.current = handleSpeechEnd

  // Monitor pending tool approvals
  useEffect(() => {
    const pendingCall = toolCalls.find((tc) => tc.status === "pending_approval")

    if (pendingCall && !spokenApprovalCall) {
      setSpokenApprovalCall(pendingCall)
      setPhase("approval_needed")
      if (recordingActiveRef.current && sessionRef.current) {
        sessionRef.current.cancel()
        recordingActiveRef.current = false
        sessionRef.current = null
      }
      // Speak audio prompt for approval
      void speaker.play(
        `approval-${pendingCall.id}`,
        `Action ${pendingCall.toolName.replace(/_/g, " ")} requires your approval. Say yes to approve, or no to cancel.`,
      )
    } else if (!pendingCall && spokenApprovalCall) {
      setSpokenApprovalCall(null)
    }
  }, [toolCalls, spokenApprovalCall])

  // Detect latest agent message and speak it aloud
  useEffect(() => {
    if (!isOpen) return
    const agentMessages = messages.filter(
      (m) => m.senderType === "agent" && m.status !== "streaming",
    )
    const latest = agentMessages[agentMessages.length - 1]

    if (latest && latest.id !== lastSpokenMessageIdRef.current && latest.content?.trim()) {
      lastSpokenMessageIdRef.current = latest.id
      setLastAgentSpeech(latest.content)

      if (recordingActiveRef.current && sessionRef.current) {
        sessionRef.current.cancel()
        recordingActiveRef.current = false
        sessionRef.current = null
      }

      setPhase("speaking")

      if (!isSpeakerMuted) {
        void speaker.play(latest.id, latest.content)
      } else {
        // Speaker muted, directly transition back to listening
        void armMicrophone()
      }
    }
  }, [messages, isOpen, isSpeakerMuted, armMicrophone])

  // Watch speaker status to re-arm mic when agent finishes speaking
  useEffect(() => {
    if (phase === "speaking" && speakerStatus.state === "idle") {
      void armMicrophone()
    }
  }, [phase, speakerStatus.state, armMicrophone])

  // Initial connect
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        void armMicrophone()
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [isOpen, armMicrophone])

  if (!isOpen) return null

  // Active tool execution narration chip
  const activeTool = toolCalls.find((tc) => tc.status === "running")

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, "0")}`
  }

  const agentName = agent?.displayName ?? roomName

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Voice call with ${agentName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      <div className="relative flex flex-col items-center justify-between w-full max-w-lg min-h-[520px] rounded-3xl border border-line-strong bg-panel/95 p-8 shadow-2xl">
        {/* Header with Call Duration */}
        <div className="flex w-full items-center justify-between text-muted text-[13px]">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
            <span className="font-medium text-text">{roomName}</span>
          </div>
          <span className="font-mono text-faint">{formatTime(callDuration)}</span>
        </div>

        {/* Mascot & Visualizer */}
        <div className="flex flex-col items-center justify-center my-auto text-center">
          <div className="relative mb-6">
            {/* Visualizer rings for speaking/listening */}
            {phase === "listening" ? (
              <div
                className="absolute inset-0 rounded-full bg-accent/20 transition-transform duration-75 -z-10"
                style={{ transform: `scale(${1.2 + volumeLevel * 0.8})` }}
              />
            ) : phase === "speaking" ? (
              <div className="absolute inset-0 rounded-full bg-accent/30 animate-ping -z-10" />
            ) : null}

            <div className="grid h-28 w-28 place-items-center rounded-full bg-raised border-2 border-line-strong shadow-xl overflow-hidden">
              <Mascot
                mood={phase === "speaking" ? "busy" : phase === "thinking" ? "thinking" : "idle"}
                lit={phase === "speaking" || phase === "listening"}
                live
                className="h-20 w-20"
              />
            </div>
          </div>

          <h2 className="text-xl font-bold text-text tracking-tight">{agentName}</h2>
          <p className="mt-1 text-[13px] text-faint font-medium">
            {phase === "connecting" && "Connecting call…"}
            {phase === "listening" && "Listening to you… (pause 1.7s to send)"}
            {phase === "transcribing" && "Processing speech…"}
            {phase === "thinking" && "Agent thinking…"}
            {phase === "speaking" && "Agent speaking…"}
            {phase === "approval_needed" && "Waiting for your approval…"}
          </p>

          {/* Active Tool Narration Chip */}
          {activeTool ? (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-line bg-raised/80 px-3.5 py-1 text-[12px] text-accent animate-pulse">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Running {activeTool.toolName.replace(/_/g, " ")}…</span>
            </div>
          ) : null}

          {/* Spoken Approval Card */}
          {spokenApprovalCall ? (
            <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border border-warn/40 bg-warn/10 p-3.5 max-w-sm">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-warn">
                <ShieldAlert className="h-4 w-4" />
                <span>Approval Required: {spokenApprovalCall.toolName}</span>
              </div>
              <p className="text-[12px] text-muted text-center">
                Say <strong className="text-text">&quot;yes&quot;</strong> to approve, or click
                below:
              </p>
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => approvePendingTool(spokenApprovalCall.id, true)}
                  className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1 text-[12px] font-medium text-void shadow-xs hover:brightness-105"
                >
                  <Check className="h-3.5 w-3.5" /> Approve
                </button>
                <button
                  type="button"
                  onClick={() => approvePendingTool(spokenApprovalCall.id, false)}
                  className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1 text-[12px] text-muted hover:text-text hover:bg-raised"
                >
                  <X className="h-3.5 w-3.5" /> Reject
                </button>
              </div>
            </div>
          ) : null}

          {/* Speech transcript snippet */}
          {lastAgentSpeech && phase === "speaking" ? (
            <div className="mt-4 max-w-sm rounded-xl bg-raised/40 px-3 py-1.5 text-[12px] text-muted truncate">
              &quot;{lastAgentSpeech}&quot;
            </div>
          ) : lastUserSpeech && phase === "thinking" ? (
            <div className="mt-4 max-w-sm rounded-xl bg-raised/40 px-3 py-1.5 text-[12px] text-muted truncate">
              &quot;{lastUserSpeech}&quot;
            </div>
          ) : null}
        </div>

        {/* Action Controls Bar */}
        <div className="flex items-center justify-center gap-6 mt-6">
          {/* Mute Mic */}
          <button
            type="button"
            onClick={() => {
              if (isMuted) {
                setIsMuted(false)
                void armMicrophone()
              } else {
                setIsMuted(true)
                if (sessionRef.current) {
                  sessionRef.current.cancel()
                  sessionRef.current = null
                  recordingActiveRef.current = false
                }
              }
            }}
            aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
            className={cn(
              "grid h-12 w-12 place-items-center rounded-full border border-line bg-raised text-muted transition-colors hover:text-text hover:bg-white/[0.08]",
              isMuted && "bg-danger/20 text-danger border-danger/40",
            )}
          >
            {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>

          {/* End Call Button */}
          <button
            type="button"
            onClick={hangUp}
            aria-label="End call"
            className="grid h-14 w-14 place-items-center rounded-full bg-danger text-white shadow-lg transition-transform active:scale-95 hover:brightness-110"
          >
            <PhoneOff className="h-6 w-6" />
          </button>

          {/* Mute Speaker */}
          <button
            type="button"
            onClick={() => {
              if (isSpeakerMuted) {
                setIsSpeakerMuted(false)
              } else {
                setIsSpeakerMuted(true)
                speaker.stop()
              }
            }}
            aria-label={isSpeakerMuted ? "Unmute speaker" : "Mute speaker"}
            className={cn(
              "grid h-12 w-12 place-items-center rounded-full border border-line bg-raised text-muted transition-colors hover:text-text hover:bg-white/[0.08]",
              isSpeakerMuted && "bg-danger/20 text-danger border-danger/40",
            )}
          >
            {isSpeakerMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </div>
  )
}
