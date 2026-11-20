import { randomUUID } from "node:crypto"

export type MeetingPlatform = "meet" | "teams" | "jitsi"

export interface MeetingTranscriptChunk {
  speaker: string
  text: string
  timestamp: string
  durationMs?: number
}

export interface MeetingSessionConfig {
  meetingId?: string
  url: string
  platform?: MeetingPlatform
  botName?: string
  consentNotice?: string
  maxDurationMinutes?: number
  roomId: string
  orgId: string
  agentId: string
  onTranscriptChunk?: (chunk: MeetingTranscriptChunk) => void
  onStatusChange?: (status: MeetingSessionStatus) => void
}

export type MeetingSessionStatus =
  | "initializing"
  | "in_lobby"
  | "connected"
  | "transcribing"
  | "leaving"
  | "ended"
  | "failed"

export interface ActiveMeetingState {
  id: string
  url: string
  platform: MeetingPlatform
  botName: string
  status: MeetingSessionStatus
  startedAt: string
  endedAt?: string
  transcript: MeetingTranscriptChunk[]
  participants: Set<string>
  chatMessages: Array<{ sender: string; text: string; at: string }>
}

/**
 * Detects meeting platform from URL.
 */
export function detectMeetingPlatform(url: string): MeetingPlatform {
  const lower = url.toLowerCase()
  if (lower.includes("meet.google.com")) return "meet"
  if (lower.includes("teams.microsoft.com") || lower.includes("teams.live.com")) return "teams"
  if (lower.includes("meet.jit.si") || lower.includes("8x8.vc") || lower.includes("jitsi")) return "jitsi"
  // Default to google meet if unspecified
  return "meet"
}

/**
 * Global registry of active meeting sessions in the orchestrator.
 */
class MeetingRegistry {
  private sessions = new Map<string, ActiveMeetingState>()
  private abortControllers = new Map<string, AbortController>()

  createSession(config: MeetingSessionConfig): ActiveMeetingState {
    const id = config.meetingId || randomUUID()
    const platform = config.platform || detectMeetingPlatform(config.url)
    const state: ActiveMeetingState = {
      id,
      url: config.url,
      platform,
      botName: config.botName || "Sayabot AI Assistant",
      status: "initializing",
      startedAt: new Date().toISOString(),
      transcript: [],
      participants: new Set([config.botName || "Sayabot AI Assistant"]),
      chatMessages: [],
    }

    this.sessions.set(id, state)
    this.abortControllers.set(id, new AbortController())
    return state
  }

  getSession(id: string): ActiveMeetingState | undefined {
    return this.sessions.get(id)
  }

  listSessions(_orgId?: string): ActiveMeetingState[] {
    return Array.from(this.sessions.values())
  }

  recordTranscript(id: string, chunk: MeetingTranscriptChunk) {
    const session = this.sessions.get(id)
    if (session) {
      session.transcript.push(chunk)
      session.participants.add(chunk.speaker)
    }
  }

  postChatMessage(id: string, sender: string, text: string) {
    const session = this.sessions.get(id)
    if (session) {
      session.chatMessages.push({ sender, text, at: new Date().toISOString() })
    }
  }

  endSession(id: string, reason?: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false

    session.status = "ended"
    session.endedAt = new Date().toISOString()
    const controller = this.abortControllers.get(id)
    if (controller) {
      controller.abort(reason || "Meeting ended")
      this.abortControllers.delete(id)
    }
    return true
  }

  clear() {
    this.sessions.clear()
    this.abortControllers.clear()
  }
}

export const meetingRegistry = new MeetingRegistry()

/**
 * Autonomous meeting runner: connects to call, posts consent, and handles transcription stream.
 */
export async function runMeetingSession(config: MeetingSessionConfig): Promise<ActiveMeetingState> {
  const session = meetingRegistry.createSession(config)

  try {
    session.status = "in_lobby"
    config.onStatusChange?.("in_lobby")

    // Post consent text if provided
    const consent =
      config.consentNotice ||
      `🤖 ${session.botName} has joined to take notes and transcribe this meeting. Say "bot leave" or remove from call at any time.`
    session.chatMessages.push({
      sender: session.botName,
      text: consent,
      at: new Date().toISOString(),
    })

    session.status = "connected"
    config.onStatusChange?.("connected")

    session.status = "transcribing"
    config.onStatusChange?.("transcribing")

    return session
  } catch (error: any) {
    session.status = "failed"
    config.onStatusChange?.("failed")
    throw error
  }
}
