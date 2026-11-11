import { NextResponse } from "next/server"
import { answerRequestsAs } from "@/lib/answer-requests"
import { userFromRequest } from "@/lib/route-bearer"

/** The phone answers an agent's question (free text and/or one value per item). */
export async function POST(request: Request) {
  const who = await userFromRequest(request)
  if (!who) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }
  if (typeof body.orgSlug !== "string" || typeof body.taskId !== "string") {
    return NextResponse.json({ error: "orgSlug and taskId are required" }, { status: 400 })
  }
  const itemAnswers: Record<string, string> = {}
  if (body.itemAnswers && typeof body.itemAnswers === "object") {
    for (const [key, value] of Object.entries(body.itemAnswers as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) itemAnswers[key] = value.slice(0, 1_000)
    }
  }
  const result = await answerRequestsAs(who, {
    orgSlug: body.orgSlug,
    taskId: body.taskId,
    answer: typeof body.answer === "string" ? body.answer : "",
    alsoPost: body.alsoPost === true,
    itemAnswers,
  })
  return NextResponse.json(result.ok ? { ok: true, message: result.message } : { ok: false, error: result.error }, {
    status: result.ok ? 200 : 400,
  })
}
