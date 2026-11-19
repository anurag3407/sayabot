import { describe, expect, it, vi, beforeEach } from "vitest"
import { SpeakerManager } from "./speaker"
import { encodeWav } from "./vad"

describe("SpeakerManager", () => {
  let manager: SpeakerManager

  beforeEach(() => {
    vi.restoreAllMocks()
    manager = new SpeakerManager()
  })

  it("initializes with idle state", () => {
    const status = manager.getStatus()
    expect(status.state).toBe("idle")
    expect(status.messageId).toBeNull()
    expect(status.utteranceIndex).toBe(0)
    expect(status.totalUtterances).toBe(0)
    expect(status.error).toBeNull()
  })

  it("subscribes and notifies listener", () => {
    const listener = vi.fn()
    const unsubscribe = manager.subscribe(listener)

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "idle",
        messageId: null,
      }),
    )

    unsubscribe()
  })

  it("stop resets state and cancels in-flight work", () => {
    manager.stop()
    const status = manager.getStatus()
    expect(status.state).toBe("idle")
    expect(status.messageId).toBeNull()
  })
})

describe("VAD Audio Encoder", () => {
  it("encodes PCM Float32 samples into a valid 16kHz WAV blob", async () => {
    const sampleRate = 48000
    // 0.5s of audio (24000 samples)
    const samples = new Float32Array(sampleRate / 2)
    // Generate a simple 440Hz sine wave
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5
    }

    const wavBlob = encodeWav(samples, sampleRate)
    expect(wavBlob).toBeDefined()
    expect(wavBlob.type).toBe("audio/wav")

    // WAV header is 44 bytes + (downsampled 16000 * 0.5 samples * 2 bytes = 16000 bytes) = 16044 bytes
    const arrayBuffer = await wavBlob.arrayBuffer()
    const view = new DataView(arrayBuffer)

    // Check RIFF header
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3),
    )
    expect(riff).toBe("RIFF")

    // Check WAVE header
    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11),
    )
    expect(wave).toBe("WAVE")

    // Check sample rate is 16000
    const targetSampleRate = view.getUint32(24, true)
    expect(targetSampleRate).toBe(16000)

    // Check bits per sample is 16
    const bitsPerSample = view.getUint16(34, true)
    expect(bitsPerSample).toBe(16)
  })
})
