import { z } from "zod"
import {
  detectMeetingPlatform,
  meetingRegistry,
  runMeetingSession,
} from "../../meetings/meetbot"
import type { ToolSpec } from "../audited"

export interface MeetingToolsOptions {
  orgId: string
  agentId: string
  roomId: string
  botName?: string
}

export function meetingTools(opts: MeetingToolsOptions): ToolSpec[] {
  const { orgId, agentId, roomId, botName } = opts

  const joinMeetingTool: ToolSpec = {
    name: "meeting_join",
    description:
      "Join a Google Meet, Microsoft Teams, or Jitsi video meeting as an autonomous participant to listen, transcribe dialogue with speaker identification, and take minutes. Waits for a person's approval.",
    schema: z.object({
      meeting_url: z.string().url().describe("The meeting invitation URL (Google Meet, Teams, or Jitsi)"),
      objective: z
        .string()
        .optional()
        .describe("Specific agenda, topics to track, or action items to extract"),
      max_duration_minutes: z
        .number()
        .int()
        .min(1)
        .max(240)
        .optional()
        .default(60)
        .describe("Maximum duration to remain in call before auto-leaving"),
    }),
    dangerous: true, // External corporate video call joining requires human approval
    execute: async (input: {
      meeting_url: string
      objective?: string
      max_duration_minutes?: number
    }) => {
      const platform = detectMeetingPlatform(input.meeting_url)

      const session = await runMeetingSession({
        url: input.meeting_url,
        platform,
        botName: botName || "Sayabot AI Assistant",
        maxDurationMinutes: input.max_duration_minutes,
        roomId,
        orgId,
        agentId,
      })

      return {
        ok: true,
        meeting_id: session.id,
        platform,
        status: session.status,
        message: `Successfully connected to ${platform} meeting. Transcribing conversation and monitoring for action items.`,
      }
    },
  }

  const meetingStatusTool: ToolSpec = {
    name: "meeting_status",
    description:
      "Check the live status of an active meeting, including participants, duration, and recent transcript lines.",
    schema: z.object({
      meeting_id: z.string().min(1).describe("Active meeting ID returned from meeting_join"),
    }),
    dangerous: false,
    execute: async (input: { meeting_id: string }) => {
      const session = meetingRegistry.getSession(input.meeting_id)
      if (!session) {
        return { ok: false, error: `No active meeting session found for ID: ${input.meeting_id}` }
      }

      return {
        ok: true,
        meeting_id: session.id,
        platform: session.platform,
        status: session.status,
        started_at: session.startedAt,
        participants: Array.from(session.participants),
        transcript_count: session.transcript.length,
        recent_transcript: session.transcript.slice(-10),
        chat_messages_count: session.chatMessages.length,
      }
    },
  }

  const meetingChatTool: ToolSpec = {
    name: "meeting_post_chat",
    description: "Post a message into the text chat panel of an active video meeting. Waits for approval.",
    schema: z.object({
      meeting_id: z.string().min(1).describe("Active meeting ID"),
      message: z.string().min(1).max(1000).describe("Message to post in the meeting chat"),
    }),
    dangerous: true,
    execute: async (input: { meeting_id: string; message: string }) => {
      const session = meetingRegistry.getSession(input.meeting_id)
      if (!session) {
        return { ok: false, error: `No active meeting session found for ID: ${input.meeting_id}` }
      }

      meetingRegistry.postChatMessage(input.meeting_id, session.botName, input.message)
      return { ok: true, meeting_id: input.meeting_id, posted: input.message }
    },
  }

  const leaveMeetingTool: ToolSpec = {
    name: "meeting_leave",
    description: "Cleanly disconnect and leave an active meeting session.",
    schema: z.object({
      meeting_id: z.string().min(1).describe("Active meeting ID to leave"),
      summary_reason: z.string().optional().describe("Optional parting summary or reason for leaving"),
    }),
    dangerous: false,
    execute: async (input: { meeting_id: string; summary_reason?: string }) => {
      const success = meetingRegistry.endSession(input.meeting_id, input.summary_reason)
      if (!success) {
        return { ok: false, error: `Meeting session ${input.meeting_id} was not active or already ended.` }
      }

      const session = meetingRegistry.getSession(input.meeting_id)
      return {
        ok: true,
        meeting_id: input.meeting_id,
        status: "ended",
        total_transcript_lines: session?.transcript.length || 0,
      }
    },
  }

  return [joinMeetingTool, meetingStatusTool, meetingChatTool, leaveMeetingTool]
}
