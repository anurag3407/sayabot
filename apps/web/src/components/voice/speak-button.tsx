"use client"

import { useSpeech } from "@/lib/tts"
import { Volume2, Square, Loader2 } from "lucide-react"
import { cn } from "@/lib/format"

export interface SpeakButtonProps {
  messageId: string
  text: string
  className?: string
}

export function SpeakButton({ messageId, text, className }: SpeakButtonProps) {
  const { status, toggle, isMessagePlaying } = useSpeech()

  if (!text || !text.trim()) return null

  const isCurrent = status.messageId === messageId
  const isPlaying = isMessagePlaying(messageId)
  const isPreparing = isCurrent && status.state === "preparing"

  const label = isPlaying ? "Stop reading aloud" : isPreparing ? "Preparing audio…" : "Read aloud"

  return (
    <button
      type="button"
      onClick={() => toggle(messageId, text)}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-white/[0.06] hover:text-text",
        (isPlaying || isPreparing) && "text-accent bg-accent-soft hover:bg-accent-soft",
        className,
      )}
    >
      {isPreparing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : isPlaying ? (
        <Square className="h-3 w-3 fill-current" aria-hidden="true" />
      ) : (
        <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  )
}
