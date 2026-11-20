"use client"

import { useEffect, useState } from "react"
import { Volume2, X, Play, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, Select } from "@/components/ui/field"
import { speaker } from "@/lib/tts"
import { showToast } from "@/components/ui/toast"

export interface VoiceSettingsDialogProps {
  isOpen: boolean
  onClose: () => void
  roomId?: string
}

interface VoiceOption {
  id: string
  name: string
  gender?: string
  accent?: string
  previewUrl?: string
}

const PROVIDERS = [
  { id: "elevenlabs", label: "ElevenLabs (Ultra-realistic, expressive)" },
  { id: "fish", label: "Fish Audio (Low latency, bilingual S2.1)" },
  { id: "openai", label: "OpenAI TTS (tts-1 alloy, echo, fable, onyx, nova, shimmer)" },
  { id: "gemini", label: "Gemini Flash Lite TTS (30 voices, Aoede, Kore, Puck…)" },
  { id: "grok", label: "xAI / Grok TTS (Grok standard voices)" },
  { id: "chatterbox", label: "Chatterbox (Local OpenAI-compatible server)" },
  { id: "system", label: "System / macOS say (Built-in offline)" },
]

export function VoiceSettingsDialog({ isOpen, onClose, roomId }: VoiceSettingsDialogProps) {
  const [provider, setProvider] = useState("openai")
  const [voice, setVoice] = useState("")
  const [speed, setSpeed] = useState("1")
  const [voiceNoteEveryReply, setVoiceNoteEveryReply] = useState(false)
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [loadingVoices, setLoadingVoices] = useState(false)
  const [testingVoice, setTestingVoice] = useState(false)

  // Load stored preferences
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const storedProvider = localStorage.getItem("sayabot_voice_provider")
      if (storedProvider) setProvider(storedProvider)
      const storedVoice = localStorage.getItem("sayabot_voice_id")
      if (storedVoice) setVoice(storedVoice)
      const storedSpeed = localStorage.getItem("sayabot_voice_speed")
      if (storedSpeed) setSpeed(storedSpeed)
      const storedAutoNote = localStorage.getItem(`sayabot_auto_voicenote_${roomId || "global"}`)
      if (storedAutoNote) setVoiceNoteEveryReply(storedAutoNote === "true")
    } catch {
      // Ignored
    }
  }, [roomId, isOpen])

  // Fetch available voices whenever provider changes
  useEffect(() => {
    if (!isOpen) return
    let active = true
    setLoadingVoices(true)

    fetch(`/api/v1/tts/voices?provider=${provider}`)
      .then((res) => (res.ok ? res.json() : { voices: [] }))
      .then((data: { voices?: VoiceOption[] }) => {
        if (!active) return
        const list = data.voices || []
        setVoices(list)
        if (list.length > 0) {
          setVoice((current) =>
            list.some((v) => v.id === current) ? current : (list[0]?.id ?? ""),
          )
        } else {
          setVoice("")
        }
      })
      .catch((err) => {
        console.warn("Failed to load voices:", err)
      })
      .finally(() => {
        if (active) setLoadingVoices(false)
      })

    return () => {
      active = false
    }
  }, [provider, isOpen])

  async function handleTestVoice() {
    if (testingVoice) {
      speaker.stop()
      setTestingVoice(false)
      return
    }

    setTestingVoice(true)
    try {
      await speaker.play(
        "preview",
        `Hello! This is a test of ${provider} speech synthesis in Sayabot. Natural turns, clean pronunciation, and zero latency.`,
        {
          provider,
          voice,
          speed: parseFloat(speed) || 1,
        },
      )
    } finally {
      setTestingVoice(false)
    }
  }

  function handleSave() {
    try {
      localStorage.setItem("sayabot_voice_provider", provider)
      localStorage.setItem("sayabot_voice_id", voice)
      localStorage.setItem("sayabot_voice_speed", speed)
      localStorage.setItem(
        `sayabot_auto_voicenote_${roomId || "global"}`,
        voiceNoteEveryReply ? "true" : "false",
      )
      showToast({ tone: "success", message: "Voice preferences saved" })
      onClose()
    } catch {
      showToast({ tone: "danger", message: "Failed to persist preferences" })
    }
  }

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Voice & Speech Settings"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    >
      <div className="relative flex flex-col w-full max-w-md rounded-2xl border border-line bg-panel p-6 shadow-xl">
        <div className="flex items-center justify-between pb-4 border-b border-line">
          <div className="flex items-center gap-2">
            <Volume2 className="h-5 w-5 text-accent" />
            <h2 className="text-[16px] font-semibold text-text">Voice Settings</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-full p-1 text-faint hover:text-text hover:bg-raised transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 py-4 text-[13.5px]">
          {/* Provider selector */}
          <Field label="Voice Provider" htmlFor="tts-provider">
            <Select
              id="tts-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>

          {/* Voice selector */}
          <Field label="Voice" htmlFor="tts-voice">
            {loadingVoices ? (
              <div className="flex items-center gap-2 text-muted text-[13px] py-1">
                <Loader2 className="h-4 w-4 animate-spin text-accent" /> Loading voices…
              </div>
            ) : voices.length > 0 ? (
              <Select id="tts-voice" value={voice} onChange={(e) => setVoice(e.target.value)}>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} {v.gender ? `(${v.gender}${v.accent ? `, ${v.accent}` : ""})` : ""}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="text-faint text-[12.5px] py-1">
                Default voice catalog for {provider}
              </div>
            )}
          </Field>

          {/* Speed selector */}
          <Field label="Speech Rate" htmlFor="tts-speed">
            <Select id="tts-speed" value={speed} onChange={(e) => setSpeed(e.target.value)}>
              <option value="0.85">0.85x (Slower)</option>
              <option value="1">1.0x (Normal)</option>
              <option value="1.15">1.15x (Brisk)</option>
              <option value="1.3">1.3x (Fast)</option>
            </Select>
          </Field>

          {/* Auto voice note toggle */}
          <div className="flex items-start gap-3 rounded-xl border border-line bg-raised/40 p-3">
            <input
              type="checkbox"
              id="auto-voice-note"
              checked={voiceNoteEveryReply}
              onChange={(e) => setVoiceNoteEveryReply(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-line text-accent focus:ring-accent"
            />
            <label htmlFor="auto-voice-note" className="cursor-pointer select-none">
              <span className="block font-medium text-text text-[13px]">
                Voice note with every reply
              </span>
              <span className="block text-[12px] text-faint">
                Automatically generate and attach an interactive voice note bubble to every bot
                reply in this room.
              </span>
            </label>
          </div>
        </div>

        {/* Footer controls */}
        <div className="flex items-center justify-between pt-4 border-t border-line">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTestVoice}
            disabled={testingVoice}
            className="gap-1.5"
          >
            {testingVoice ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" />
            )}
            Test Voice
          </Button>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
