import { NextResponse } from "next/server"
import {
  getCopilotInternalToken,
  pollCopilotDeviceCode,
  startCopilotDeviceFlow,
} from "@/lib/connectors/copilot"

export async function GET() {
  try {
    const flow = await startCopilotDeviceFlow()
    return NextResponse.json(flow)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start Copilot device flow" },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { deviceCode?: string }
    if (!body.deviceCode) {
      return NextResponse.json({ error: "Missing deviceCode" }, { status: 400 })
    }

    const poll = await pollCopilotDeviceCode(body.deviceCode)
    if (poll.token) {
      const session = await getCopilotInternalToken(poll.token)
      return NextResponse.json({
        status: "complete",
        session,
      })
    }

    return NextResponse.json({
      status: poll.status,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to poll Copilot status" },
      { status: 500 },
    )
  }
}
