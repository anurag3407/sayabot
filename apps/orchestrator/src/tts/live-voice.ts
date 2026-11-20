import { randomUUID } from "node:crypto"

export interface LiveVoiceSession {
  sessionId: string
  roomId: string
  orgId: string
  agentId: string
  provider: "gemini" | "openai" | "elevenlabs" | "fish"
  status: "idle" | "listening" | "speaking" | "closed"
  createdAt: string
  activeParticipants: Set<string>
  spokenHistory: Array<{ speaker: string; text: string; at: string }>
}

class LiveVoiceSessionManager {
  private sessions = new Map<string, LiveVoiceSession>()

  createSession(args: {
    roomId: string
    orgId: string
    agentId: string
    provider?: "gemini" | "openai" | "elevenlabs" | "fish"
  }): LiveVoiceSession {
    const sessionId = randomUUID()
    const session: LiveVoiceSession = {
      sessionId,
      roomId: args.roomId,
      orgId: args.orgId,
      agentId: args.agentId,
      provider: args.provider || "gemini",
      status: "idle",
      createdAt: new Date().toISOString(),
      activeParticipants: new Set(["agent:" + args.agentId]),
      spokenHistory: [],
    }

    this.sessions.set(sessionId, session)
    return session
  }

  getSession(sessionId: string): LiveVoiceSession | undefined {
    return this.sessions.get(sessionId)
  }

  getSessionForRoom(roomId: string): LiveVoiceSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.roomId === roomId && session.status !== "closed") {
        return session
      }
    }
    return undefined
  }

  recordSpokenUtterance(sessionId: string, speaker: string, text: string) {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.spokenHistory.push({ speaker, text, at: new Date().toISOString() })
    }
  }

  closeSession(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.status = "closed"
      this.sessions.delete(sessionId)
    }
  }
}

export const liveVoiceSessionManager = new LiveVoiceSessionManager()
