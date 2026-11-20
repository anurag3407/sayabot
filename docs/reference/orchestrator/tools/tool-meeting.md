# Autonomous Meeting Assistant Tools

> Reference guide for `meeting_join`, `meeting_status`, `meeting_post_chat`, and `meeting_leave`.

## Overview

The meeting assistant tools allow Sayabot agents to join video meetings (Google Meet, Microsoft Teams, Jitsi), post automated consent notices, transcribe audio with speaker attribution, and stream meeting minutes into Sayabot rooms and collaborative Monaco canvases.

---

## 1. `meeting_join`

Connects the agent to an external video conference as an autonomous participant.

### Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `meeting_url` | `string` | Yes | Valid Google Meet, Teams, or Jitsi invitation URL |
| `objective` | `string` | No | Specific topics, agenda items, or action points to track |
| `max_duration_minutes` | `number` | No | Maximum time in call before automatic departure (default: 60) |

### Safety Gate

- **Dangerous Flag**: `true`
- **Reason**: Joining external corporate video conferences constitutes an external visibility and privacy boundary requiring explicit human operator approval.

---

## 2. `meeting_status`

Checks the live health, participants, and recent dialogue of an active meeting.

### Output

```json
{
  "ok": true,
  "meeting_id": "meet-uuid-123",
  "platform": "meet",
  "status": "transcribing",
  "participants": ["Sayabot Assistant", "Sarah Connor", "John Doe"],
  "transcript_count": 42,
  "recent_transcript": [
    {
      "speaker": "Sarah Connor",
      "text": "Let's deploy the new microVM cluster tonight.",
      "timestamp": "2026-11-20T18:30:00Z"
    }
  ]
}
```

---

## 3. `meeting_post_chat`

Posts a message directly into the video call's text chat panel.

- **Dangerous Flag**: `true` (Sends externally visible communication).

---

## 4. `meeting_leave`

Cleanly disconnects the bot from the call and finalizes the transcript log.

- **Dangerous Flag**: `false`.
