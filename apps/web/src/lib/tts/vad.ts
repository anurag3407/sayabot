/**
 * Browser Web Audio Voice Activity Detection (VAD) and 16kHz WAV Recorder.
 *
 * Implements real-time browser voice endpointing:
 * - RMS energy calculation per frame
 * - Speech start detection (RMS > speechThreshold for minSpeechMs)
 * - Silence endpointing (RMS < silenceThreshold for silenceTimeoutMs, default ~1.7s)
 * - Downsamples audio buffer to 16,000 Hz 16-bit mono WAV for speech-to-text models
 */

export interface VadOptions {
  speechThreshold?: number // RMS threshold to trigger speech (default 0.04)
  silenceThreshold?: number // RMS threshold to consider silence (default 0.02)
  silenceTimeoutMs?: number // Milliseconds of silence before auto-stopping (default 1700ms)
  minSpeechMs?: number // Minimum speech duration before silence counter activates (default 400ms)
  maxDurationMs?: number // Maximum total recording duration (default 60000ms / 1 min)
  onSpeechStart?: () => void
  onSpeechEnd?: (blob: Blob) => void
  onVolumeChange?: (volume: number) => void // 0 to 1
  onError?: (err: Error) => void
}

export interface RecordingSession {
  stop(): Promise<Blob>
  cancel(): void
}

/**
 * Encodes Float32 PCM samples into a 16-bit mono 16kHz WAV Blob.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const targetRate = 16000
  const downsampled = downsampleBuffer(samples, sampleRate, targetRate)
  const buffer = new ArrayBuffer(44 + downsampled.length * 2)
  const view = new DataView(buffer)

  // RIFF identifier
  writeString(view, 0, "RIFF")
  // file length
  view.setUint32(4, 36 + downsampled.length * 2, true)
  // RIFF type
  writeString(view, 8, "WAVE")
  // format chunk identifier
  writeString(view, 12, "fmt ")
  // format chunk length
  view.setUint32(16, 16, true)
  // sample format (raw PCM = 1)
  view.setUint16(20, 1, true)
  // channel count (mono = 1)
  view.setUint16(22, 1, true)
  // sample rate
  view.setUint32(24, targetRate, true)
  // byte rate (sampleRate * blockAlign)
  view.setUint32(28, targetRate * 2, true)
  // block align (channels * bytes per sample = 1 * 2 = 2)
  view.setUint16(32, 2, true)
  // bits per sample
  view.setUint16(34, 16, true)
  // data chunk identifier
  writeString(view, 36, "data")
  // data chunk length
  view.setUint32(40, downsampled.length * 2, true)

  // Write 16-bit PCM samples
  let offset = 44
  for (let i = 0; i < downsampled.length; i++) {
    const s = Math.max(-1, Math.min(1, downsampled[i]!))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }

  return new Blob([buffer], { type: "audio/wav" })
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

function downsampleBuffer(
  buffer: Float32Array,
  inputRate: number,
  outputRate: number,
): Float32Array {
  if (outputRate === inputRate) {
    return buffer
  }
  const sampleRateRatio = inputRate / outputRate
  const newLength = Math.round(buffer.length / sampleRateRatio)
  const result = new Float32Array(newLength)
  let offsetResult = 0
  let offsetBuffer = 0

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio)
    let accum = 0
    let count = 0
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i]!
      count++
    }
    result[offsetResult] = count > 0 ? accum / count : 0
    offsetResult++
    offsetBuffer = nextOffsetBuffer
  }

  return result
}

/**
 * Starts recording microphone input with real-time VAD silence endpointing.
 */
export async function startRecording(options: VadOptions = {}): Promise<RecordingSession> {
  const {
    speechThreshold = 0.04,
    silenceThreshold = 0.02,
    silenceTimeoutMs = 1700,
    minSpeechMs = 400,
    maxDurationMs = 60000,
    onSpeechStart,
    onSpeechEnd,
    onVolumeChange,
    onError,
  } = options

  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    const err = new Error("Microphone recording is not supported in this browser.")
    onError?.(err)
    throw err
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })

  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const audioContext = new AudioContextClass()
  const source = audioContext.createMediaStreamSource(stream)

  // Use ScriptProcessorNode for wide cross-browser audio buffer access
  const bufferSize = 4096
  const processor = audioContext.createScriptProcessor(bufferSize, 1, 1)

  const recordedChunks: Float32Array[] = []
  let totalLength = 0
  let isSpeaking = false
  let speechStartTime = 0
  let silenceStartTime = 0
  let isStopped = false

  let maxTimer: ReturnType<typeof setTimeout> | null = null

  function cleanup() {
    isStopped = true
    if (maxTimer) clearTimeout(maxTimer)
    try {
      source.disconnect()
      processor.disconnect()
      stream.getTracks().forEach((track) => track.stop())
      if (audioContext.state !== "closed") {
        void audioContext.close()
      }
    } catch {
      // Ignored
    }
  }

  function finish(): Blob {
    cleanup()
    const merged = new Float32Array(totalLength)
    let offset = 0
    for (const chunk of recordedChunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    return encodeWav(merged, audioContext.sampleRate)
  }

  processor.onaudioprocess = (e) => {
    if (isStopped) return

    const inputData = e.inputBuffer.getChannelData(0)
    // Copy chunk
    const chunk = new Float32Array(inputData)
    recordedChunks.push(chunk)
    totalLength += chunk.length

    // Calculate RMS energy
    let sum = 0
    for (let i = 0; i < inputData.length; i++) {
      sum += inputData[i]! * inputData[i]!
    }
    const rms = Math.sqrt(sum / inputData.length)
    const normalizedVolume = Math.min(1, rms * 5)
    onVolumeChange?.(normalizedVolume)

    const now = Date.now()

    if (rms >= speechThreshold) {
      if (!isSpeaking) {
        isSpeaking = true
        speechStartTime = now
        onSpeechStart?.()
      }
      silenceStartTime = 0
    } else if (isSpeaking && rms < silenceThreshold) {
      const speechDuration = now - speechStartTime
      if (speechDuration >= minSpeechMs) {
        if (!silenceStartTime) {
          silenceStartTime = now
        } else if (now - silenceStartTime >= silenceTimeoutMs) {
          // Endpoint reached!
          const blob = finish()
          onSpeechEnd?.(blob)
        }
      }
    }
  }

  source.connect(processor)
  processor.connect(audioContext.destination)

  if (maxDurationMs > 0) {
    maxTimer = setTimeout(() => {
      if (!isStopped) {
        const blob = finish()
        onSpeechEnd?.(blob)
      }
    }, maxDurationMs)
  }

  return {
    async stop(): Promise<Blob> {
      if (isStopped) {
        const merged = new Float32Array(totalLength)
        let offset = 0
        for (const chunk of recordedChunks) {
          merged.set(chunk, offset)
          offset += chunk.length
        }
        return encodeWav(merged, audioContext.sampleRate)
      }
      return finish()
    },
    cancel() {
      cleanup()
    },
  }
}
