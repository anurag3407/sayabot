import { createAdminClient } from "@/lib/supabase/admin"
import { randomBytes } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"

const registerSchema = z.object({
  client_name: z.string().min(1).max(100),
  redirect_uris: z.array(z.string().url()).min(1),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: parsed.error.issues[0]?.message },
      { status: 400 },
    )
  }

  const clientId = `mcp_cli_${randomBytes(12).toString("hex")}`
  const admin = createAdminClient()

  const { error } = await admin.from("oauth_clients").insert({
    client_id: clientId,
    client_name: parsed.data.client_name,
    redirect_uris: parsed.data.redirect_uris,
    metadata: body ?? {},
  })

  if (error) {
    return NextResponse.json(
      { error: "server_error", error_description: error.message },
      { status: 500 },
    )
  }

  return NextResponse.json(
    {
      client_id: clientId,
      client_name: parsed.data.client_name,
      redirect_uris: parsed.data.redirect_uris,
      response_types: ["code"],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
    },
    { status: 201 },
  )
}
