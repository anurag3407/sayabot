import { NextResponse } from "next/server"
import { getOrgAccess, isOrgAdmin } from "@/lib/auth"
import { requireRouteUser } from "@/lib/route-auth"
import { storeProviderKey } from "@/lib/provider-key-store"
import {
  getCopilotInternalToken,
  pollCopilotDeviceCode,
  startCopilotDeviceFlow,
} from "@/lib/connectors/copilot"

/** Starts GitHub's device sign-in: the person enters the code shown on github.com/login/device. */
export async function GET() {
  const auth = await requireRouteUser()
  if ("response" in auth) return auth.response
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

/**
 * Polls the device sign-in. Once GitHub says yes, checks the account has a Copilot plan and saves
 * the GitHub token to the workspace (`org`, admins only), encrypted. Each call to Copilot later
 * swaps it for a short-lived Copilot token on the server; no token is sent back here.
 */
export async function POST(request: Request) {
  const auth = await requireRouteUser()
  if ("response" in auth) return auth.response
  try {
    const body = (await request.json().catch(() => ({}))) as { deviceCode?: string; org?: string }
    if (!body.deviceCode) {
      return NextResponse.json({ error: "Missing deviceCode" }, { status: 400 })
    }
    const access = body.org ? await getOrgAccess(body.org, { user: auth.user }) : null
    if (!access || !isOrgAdmin(access.role)) {
      return NextResponse.json(
        { error: "Only workspace admins can connect AI accounts" },
        { status: 403 },
      )
    }

    const poll = await pollCopilotDeviceCode(body.deviceCode)
    if (!poll.token) return NextResponse.json({ status: poll.status })

    const session = await getCopilotInternalToken(poll.token)
    const plan = session.plan ?? "individual"
    const saved = await storeProviderKey({
      access,
      provider: "copilot",
      secret: poll.token,
      label: `GitHub Copilot (${plan})`,
      verify: true,
    })
    if (!saved.ok)
      return NextResponse.json({ status: "error", error: saved.error }, { status: 422 })
    return NextResponse.json({ status: "complete", plan, label: saved.label, last4: saved.last4 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to poll Copilot status" },
      { status: 500 },
    )
  }
}
