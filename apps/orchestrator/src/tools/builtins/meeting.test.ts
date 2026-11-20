import { describe, expect, it, beforeEach } from "vitest"
import {
  detectMeetingPlatform,
  meetingRegistry,
  runMeetingSession,
} from "../../meetings/meetbot"
import { meetingTools } from "./meeting"

describe("meeting tools and meetbot", () => {
  beforeEach(() => {
    meetingRegistry.clear()
  })

  it("detects meeting platforms correctly from URLs", () => {
    expect(detectMeetingPlatform("https://meet.google.com/abc-defg-hij")).toBe("meet")
    expect(detectMeetingPlatform("https://teams.microsoft.com/l/meetup-join/19%3ameeting")).toBe(
      "teams",
    )
    expect(detectMeetingPlatform("https://meet.jit.si/MyProjectSync")).toBe("jitsi")
  })

  it("runs a meeting session and manages lifecycle", async () => {
    const session = await runMeetingSession({
      url: "https://meet.google.com/xyz-uvwx-rst",
      botName: "Test Bot",
      roomId: "room-1",
      orgId: "org-1",
      agentId: "agent-1",
    })

    expect(session.status).toBe("transcribing")
    expect(session.platform).toBe("meet")
    expect(session.chatMessages).toHaveLength(1)
    expect(session.chatMessages[0]?.text).toContain("Test Bot has joined")

    // Record transcript chunk
    meetingRegistry.recordTranscript(session.id, {
      speaker: "Alice Smith",
      text: "Let's review the quarterly revenue roadmap.",
      timestamp: new Date().toISOString(),
    })

    const fetched = meetingRegistry.getSession(session.id)!
    expect(fetched.transcript).toHaveLength(1)
    expect(fetched.participants.has("Alice Smith")).toBe(true)

    // End session
    expect(meetingRegistry.endSession(session.id)).toBe(true)
    expect(meetingRegistry.getSession(session.id)!.status).toBe("ended")
  })

  it("executes meeting tools properly with approval gates", async () => {
    const tools = meetingTools({
      orgId: "org-1",
      agentId: "agent-1",
      roomId: "room-1",
      botName: "Sayabot Assistant",
    })

    const joinTool = tools.find((t) => t.name === "meeting_join")!
    const statusTool = tools.find((t) => t.name === "meeting_status")!
    const chatTool = tools.find((t) => t.name === "meeting_post_chat")!
    const leaveTool = tools.find((t) => t.name === "meeting_leave")!

    // Verify dangerous flags
    expect(joinTool.dangerous).toBe(true)
    expect(chatTool.dangerous).toBe(true)
    expect(statusTool.dangerous).toBe(false)
    expect(leaveTool.dangerous).toBe(false)

    // Join
    const joinRes = (await joinTool.execute({
      meeting_url: "https://meet.jit.si/SprintPlanning",
      objective: "Track sprint tasks",
    })) as any

    expect(joinRes.ok).toBe(true)
    expect(joinRes.platform).toBe("jitsi")
    const meetingId = joinRes.meeting_id

    // Status
    const statusRes = (await statusTool.execute({ meeting_id: meetingId })) as any
    expect(statusRes.ok).toBe(true)
    expect(statusRes.status).toBe("transcribing")

    // Post chat
    const chatRes = (await chatTool.execute({
      meeting_id: meetingId,
      message: "Here is the sprint dashboard link.",
    })) as any
    expect(chatRes.ok).toBe(true)

    // Leave
    const leaveRes = (await leaveTool.execute({ meeting_id: meetingId })) as any
    expect(leaveRes.ok).toBe(true)
    expect(leaveRes.status).toBe("ended")
  })
})
