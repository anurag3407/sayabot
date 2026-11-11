export type TaskPriority = "low" | "medium" | "high" | "urgent"

export function roomNameSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function taskPriority(metadata: unknown): TaskPriority {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || !("priority" in metadata)) {
    return "medium"
  }
  const value = (metadata as { priority?: unknown }).priority
  if (value === "low" || value === "medium" || value === "high" || value === "urgent") return value
  return "medium"
}

/** Columns the tasks table actually has. Priority lives in metadata; number is assigned by the database. */
export function taskInsertRow(input: {
  orgId: string
  roomId: string
  userId: string
  title: string
  description?: string
  priority?: TaskPriority
  budgetTurns?: number
}) {
  const priority = input.priority ?? "medium"
  const turns =
    typeof input.budgetTurns === "number" && Number.isFinite(input.budgetTurns) && input.budgetTurns > 0
      ? Math.min(60, Math.floor(input.budgetTurns))
      : 12
  return {
    org_id: input.orgId,
    room_id: input.roomId,
    title: input.title.trim(),
    description: input.description?.trim() || "",
    status: "open" as const,
    kind: "task" as const,
    budget_turns: turns,
    created_by: input.userId,
    metadata: { priority },
  }
}
