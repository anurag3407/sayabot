"use client"

import { useState, useRef } from "react"
import { Mic, Loader2, Square } from "lucide-react"
import { startRecording, type RecordingSession } from "@/lib/tts/vad"
import { cn } from "@/lib/format"
import { showToast } from "@/components/ui/toast"

export interface DictationButtonProps {
  onTranscript: (text: string) => void
  disabled?: boolean
  className?: string
}

export function DictationButton({ onTranscript, disabled, className }: DictationButtonProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [volume, setVolume] = useState(0)
  const sessionRef = useRef<RecordingSession | null>(null)

  async function handleToggle() {
    if (disabled || isTranscribing) return

    if (isRecording) {
      // User manually stopped recording
      await finishRecording()
      return
    }

    // Start recording
    try {
      const session = await startRecording({
        silenceTimeoutMs: 1700,
        minSpeechMs: 400,
        onVolumeChange: (vol) => setVolume(vol),
        onSpeechEnd: async (blob) => {
          // Automatic endpoint reached via VAD
          setIsRecording(false)
          sessionRef.current = null
          await transcribeBlob(blob)
        },
        onError: (err) => {
          setIsRecording(false)
          sessionRef.current = null
          showToast({ tone: "danger", message: err.message })
        },
      })

      sessionRef.current = session
      setIsRecording(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to access microphone"
      showToast({ tone: "danger", message: msg })
    }
  }

  async function finishRecording() {
    if (!sessionRef.current) return
    const session = sessionRef.current
    sessionRef.current = null
    setIsRecording(false)

    try {
      const blob = await session.stop()
      await transcribeBlob(blob)
    } catch (err: unknown) {
      console.warn("Recording stop error:", err)
    }
  }

  async function transcribeBlob(blob: Blob) {
    if (blob.size < 1000) {
      // Audio too short or empty
      return
    }

    setIsTranscribing(true)
    try {
      const formData = new FormData()
      formData.append("file", blob, "dictation.wav")

      const res = await fetch("/api/v1/tts/transcribe", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        throw new Error(`Transcription failed: HTTP ${res.status}`)
      }

      const data = (await res.json()) as { text?: string }
      if (data.text && data.text.trim()) {
        onTranscript(data.text.trim())
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Voice transcription failed"
      showToast({ tone: "danger", message: msg })
    } finally {
      setIsTranscribing(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={disabled || isTranscribing}
      aria-label={
        isTranscribing
          ? "Transcribing voice"
          : isRecording
            ? "Stop dictation"
            : "Dictate voice message"
      }
      title={
        isTranscribing
          ? "Transcribing…"
          : isRecording
            ? "Listening (click or pause to send)"
            : "Dictate voice message"
      }
      className={cn(
        "relative grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-all duration-150 hover:bg-white/[0.06] hover:text-text",
        isRecording && "bg-danger/20 text-danger hover:bg-danger/30 hover:text-danger",
        isTranscribing && "cursor-wait opacity-80",
        className,
      )}
    >
      {/* Audio volume pulse ring when recording */}
      {isRecording ? (
        <span
          className="absolute inset-0 rounded-full border border-danger/60 transition-transform duration-75"
          style={{ transform: `scale(${1 + volume * 0.4})` }}
          aria-hidden="true"
        />
      ) : null}

      {isTranscribing ? (
        <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
      ) : isRecording ? (
        <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
      ) : (
        <Mic className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  )
}
