"use client"

import { useEffect, useRef, useState } from "react"
import { Play, Pause, ChevronDown, ChevronUp, Mic } from "lucide-react"
import { cn } from "@/lib/format"

export interface VoiceNoteBubbleProps {
  audioUrl: string
  durationMs?: number
  text?: string
  provider?: string
  voice?: string
  className?: string
}

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "0:00"
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

export function VoiceNoteBubble({
  audioUrl,
  durationMs,
  text,
  provider,
  voice,
  className,
}: VoiceNoteBubbleProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(durationMs ? durationMs / 1000 : 0)
  const [playbackRate, setPlaybackRate] = useState<number>(1)
  const [showTranscript, setShowTranscript] = useState(false)

  // Generate pseudo-waveform bars based on text/url hash for consistent look
  const waveformHeights = useRef<number[]>(
    Array.from({ length: 28 }, (_, i) => {
      const seed = ((i * 37 + (text?.length ?? 13)) % 100) / 100
      return Math.max(15, Math.min(100, Math.round(seed * 85 + 15)))
    }),
  ).current

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }
    const onTimeUpdate = () => setCurrentTime(audio.currentTime)
    const onLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setDuration(audio.duration)
      }
    }

    audio.addEventListener("play", onPlay)
    audio.addEventListener("pause", onPause)
    audio.addEventListener("ended", onEnded)
    audio.addEventListener("timeupdate", onTimeUpdate)
    audio.addEventListener("loadedmetadata", onLoadedMetadata)

    return () => {
      audio.removeEventListener("play", onPlay)
      audio.removeEventListener("pause", onPause)
      audio.removeEventListener("ended", onEnded)
      audio.removeEventListener("timeupdate", onTimeUpdate)
      audio.removeEventListener("loadedmetadata", onLoadedMetadata)
    }
  }, [audioUrl])

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
    } else {
      audio.play().catch(console.warn)
    }
  }

  function toggleRate() {
    const audio = audioRef.current
    if (!audio) return
    const rates = [1, 1.5, 2]
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length
    const nextRate = rates[nextIdx] ?? 1
    audio.playbackRate = nextRate
    setPlaybackRate(nextRate)
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audio.currentTime = pos * duration
    setCurrentTime(pos * duration)
  }

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0

  return (
    <div
      className={cn(
        "my-2 flex flex-col rounded-2xl border border-line bg-panel p-3 shadow-xs max-w-md",
        className,
      )}
    >
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      <div className="flex items-center gap-3">
        {/* Play/Pause Button */}
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause voice note" : "Play voice note"}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-void shadow-sm transition-transform active:scale-95 hover:brightness-105"
        >
          {isPlaying ? (
            <Pause className="h-5 w-5 fill-current" />
          ) : (
            <Play className="h-5 w-5 fill-current ml-0.5" />
          )}
        </button>

        {/* Waveform and progress */}
        <div className="flex flex-1 flex-col justify-center gap-1.5 min-w-0">
          <div
            onClick={handleSeek}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={currentTime}
            aria-label="Audio progress"
            className="flex h-7 items-center gap-[3px] cursor-pointer py-1"
          >
            {waveformHeights.map((h, i) => {
              const barProgress = (i + 1) / waveformHeights.length
              const active = barProgress <= progress
              return (
                <div
                  key={i}
                  className={cn(
                    "w-1 rounded-full transition-colors duration-100",
                    active ? "bg-accent" : "bg-white/[0.15] hover:bg-white/[0.25]",
                  )}
                  style={{ height: `${h}%` }}
                />
              )
            })}
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono text-faint">
            <span>{formatDuration(currentTime)}</span>
            <span>{formatDuration(duration)}</span>
          </div>
        </div>

        {/* Speed button */}
        <button
          type="button"
          onClick={toggleRate}
          aria-label={`Playback speed ${playbackRate}x`}
          className="shrink-0 rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted hover:border-line-strong hover:text-text transition-colors"
        >
          {playbackRate}x
        </button>
      </div>

      {/* Meta & Transcript toggle */}
      <div className="mt-2 flex items-center justify-between border-t border-line/40 pt-1.5 text-[11px] text-faint">
        <div className="flex items-center gap-1.5">
          <Mic className="h-3 w-3 text-accent" />
          <span>Voice Note</span>
          {provider ? (
            <span>
              • {provider}
              {voice ? ` (${voice})` : ""}
            </span>
          ) : null}
        </div>

        {text ? (
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="inline-flex items-center gap-1 text-muted hover:text-text transition-colors"
          >
            <span>Transcript</span>
            {showTranscript ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        ) : null}
      </div>

      {/* Collapsible transcript */}
      {showTranscript && text ? (
        <div className="mt-2 rounded-lg bg-raised/50 p-2.5 text-[13px] leading-relaxed text-muted">
          {text}
        </div>
      ) : null}
    </div>
  )
}
