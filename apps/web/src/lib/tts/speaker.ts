/**
 * Client-side Text-to-Speech playback manager with streaming prefetch.
 *
 * Implements ultra-low latency TTFB optimization:
 * 1. Chunks long text via `/api/v1/tts/prepare` (speech-text normalizer with 90-char TTFB fast-path).
 * 2. Sliding window prefetch (maintains 3 ahead) via `/api/v1/tts/speak`.
 * 3. Seamless utterance-by-utterance audio playback.
 * 4. Clean cancellation, pausing, and Blob URL lifecycle management.
 */

export type SpeechState = "idle" | "preparing" | "playing" | "paused" | "error"

export interface SpeakerStatus {
  state: SpeechState
  messageId: string | null
  utteranceIndex: number
  totalUtterances: number
  error: string | null
}

export interface PlayOptions {
  provider?: string
  voice?: string
  speed?: number
}

type Listener = (status: SpeakerStatus) => void

export class SpeakerManager {
  private status: SpeakerStatus = {
    state: "idle",
    messageId: null,
    utteranceIndex: 0,
    totalUtterances: 0,
    error: null,
  }

  private listeners = new Set<Listener>()
  private audio: HTMLAudioElement | null = null
  private abortController: AbortController | null = null
  private blobUrls: string[] = []
  private prefetchPromises = new Map<number, Promise<string | null>>()
  private utterances: string[] = []
  private currentIndex = 0
  private options: PlayOptions = {}
  private PREFETCH_WINDOW = 3

  constructor() {
    if (typeof window !== "undefined") {
      this.audio = new Audio()
      this.audio.addEventListener("ended", () => this.handleUtteranceEnded())
      this.audio.addEventListener("error", (e) => this.handleAudioError(e))
    }
  }

  getStatus(): SpeakerStatus {
    return { ...this.status }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.getStatus())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(patch: Partial<SpeakerStatus>) {
    this.status = { ...this.status, ...patch }
    for (const listener of this.listeners) {
      try {
        listener(this.getStatus())
      } catch (err) {
        console.error("Speaker listener error", err)
      }
    }
  }

  async play(messageId: string, text: string, options?: PlayOptions): Promise<void> {
    // If already playing this message, toggle pause/play
    if (this.status.messageId === messageId) {
      if (this.status.state === "playing") {
        this.pause()
        return
      }
      if (this.status.state === "paused") {
        this.resume()
        return
      }
    }

    // Stop previous playback
    this.stop()

    this.options = options ?? {}
    this.abortController = new AbortController()
    const signal = this.abortController.signal

    this.notify({
      state: "preparing",
      messageId,
      utteranceIndex: 0,
      totalUtterances: 0,
      error: null,
    })

    try {
      // 1. Prepare utterances via orchestrator TTS prepare endpoint
      const prepRes = await fetch("/api/v1/tts/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal,
      })

      if (!prepRes.ok) {
        throw new Error(`TTS prepare failed: HTTP ${prepRes.status}`)
      }

      const { utterances } = (await prepRes.json()) as { utterances: string[] }
      if (!utterances || utterances.length === 0) {
        this.notify({ state: "idle", messageId: null })
        return
      }

      this.utterances = utterances
      this.currentIndex = 0
      this.notify({
        totalUtterances: utterances.length,
        utteranceIndex: 0,
      })

      // 2. Prefetch first window of utterances
      for (let i = 0; i < Math.min(this.PREFETCH_WINDOW, utterances.length); i++) {
        this.queuePrefetch(i, signal)
      }

      // 3. Play first utterance as soon as ready
      await this.playNextUtterance(signal)
    } catch (err: unknown) {
      if (signal.aborted) return
      const message = err instanceof Error ? err.message : "TTS synthesis error"
      console.warn("TTS playback failed:", message)
      this.notify({
        state: "error",
        error: message,
      })
      setTimeout(() => {
        if (this.status.state === "error") {
          this.notify({ state: "idle", messageId: null, error: null })
        }
      }, 3000)
    }
  }

  private queuePrefetch(index: number, signal: AbortSignal): Promise<string | null> {
    if (this.prefetchPromises.has(index)) {
      return this.prefetchPromises.get(index)!
    }

    if (index >= this.utterances.length) {
      return Promise.resolve(null)
    }

    const text = this.utterances[index]
    const promise = (async () => {
      try {
        const res = await fetch("/api/v1/tts/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            provider: this.options.provider,
            voice: this.options.voice,
          }),
          signal,
        })

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }

        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        this.blobUrls.push(url)
        return url
      } catch (err: unknown) {
        if (signal.aborted) return null
        console.warn(`Failed to prefetch utterance ${index}:`, err)
        return null
      }
    })()

    this.prefetchPromises.set(index, promise)
    return promise
  }

  private async playNextUtterance(signal: AbortSignal) {
    if (this.currentIndex >= this.utterances.length) {
      this.stop()
      return
    }

    const index = this.currentIndex
    this.notify({
      utteranceIndex: index,
      state: "playing",
    })

    // Advance prefetch window
    const lookahead = index + this.PREFETCH_WINDOW
    if (lookahead < this.utterances.length) {
      this.queuePrefetch(lookahead, signal)
    }

    const url = await this.queuePrefetch(index, signal)
    if (!url || signal.aborted) {
      // If single chunk failed, try advancing
      if (!signal.aborted && this.currentIndex < this.utterances.length - 1) {
        this.currentIndex++
        await this.playNextUtterance(signal)
      } else {
        this.stop()
      }
      return
    }

    if (!this.audio) return
    this.audio.src = url
    if (this.options.speed && this.options.speed > 0) {
      this.audio.playbackRate = this.options.speed
    } else {
      this.audio.playbackRate = 1
    }

    try {
      await this.audio.play()
    } catch (err) {
      if (!signal.aborted) {
        console.warn("Audio playback play() error:", err)
        this.handleUtteranceEnded()
      }
    }
  }

  private handleUtteranceEnded() {
    if (this.status.state !== "playing") return
    this.currentIndex++
    if (this.abortController && !this.abortController.signal.aborted) {
      void this.playNextUtterance(this.abortController.signal)
    }
  }

  private handleAudioError(e: Event) {
    console.warn("Audio element error:", e)
    this.handleUtteranceEnded()
  }

  pause() {
    if (this.audio && this.status.state === "playing") {
      this.audio.pause()
      this.notify({ state: "paused" })
    }
  }

  resume() {
    if (this.audio && this.status.state === "paused") {
      this.audio.play().catch(console.warn)
      this.notify({ state: "playing" })
    }
  }

  stop() {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }

    if (this.audio) {
      this.audio.pause()
      this.audio.removeAttribute("src")
      this.audio.load()
    }

    for (const url of this.blobUrls) {
      try {
        URL.revokeObjectURL(url)
      } catch {
        // Ignored
      }
    }

    this.blobUrls = []
    this.prefetchPromises.clear()
    this.utterances = []
    this.currentIndex = 0

    this.notify({
      state: "idle",
      messageId: null,
      utteranceIndex: 0,
      totalUtterances: 0,
      error: null,
    })
  }
}

// Global singleton instance for web application
export const speaker = new SpeakerManager()
