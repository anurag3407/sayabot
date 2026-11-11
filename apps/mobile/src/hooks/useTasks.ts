import { useCallback, useEffect, useState } from "react"
import { supabase } from "../core/supabase"
import { taskInsertRow, taskPriority, type TaskPriority } from "../core/workspace-draft"
import type { TaskItem } from "../types"

function mapTask(row: {
  id: string
  number: number
  title: string
  description: string | null
  status: TaskItem["status"]
  kind: TaskItem["kind"]
  assignee_agent_id: string | null
  assignee_user_id: string | null
  budget_turns: number | null
  turns_used: number | null
  cost_usd: number | string | null
  unblock_needs: string | null
  metadata: unknown
}): TaskItem {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    description: row.description,
    status: row.status,
    kind: row.kind,
    priority: taskPriority(row.metadata),
    assigneeAgentId: row.assignee_agent_id,
    assigneeUserId: row.assignee_user_id,
    budgetTurns: row.budget_turns ?? 12,
    turnsUsed: row.turns_used ?? 0,
    costUsd: Number(row.cost_usd ?? 0),
    unblockNeeds: row.unblock_needs,
  }
}

export function useTasks(roomId?: string) {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setTasks([])
        setError("Sign in to load your tasks.")
        return
      }

      let query = supabase
        .from("tasks")
        .select(
          "id, number, title, description, status, kind, assignee_agent_id, assignee_user_id, budget_turns, turns_used, cost_usd, unblock_needs, metadata",
        )
        .order("created_at", { ascending: false })
        .limit(50)

      if (roomId) {
        query = query.eq("room_id", roomId)
      }

      const { data, error: queryError } = await query
      if (queryError) throw queryError
      setTasks((data ?? []).map((row) => mapTask(row)))
    } catch (err) {
      console.error("[useTasks] fetchTasks error:", err)
      setError(err instanceof Error ? err.message : "Could not load tasks.")
    } finally {
      setLoading(false)
    }
  }, [roomId])

  const createTask = useCallback(
    async (params: {
      orgId: string
      roomId?: string
      title: string
      description?: string
      priority?: TaskPriority
      budgetTurns?: number
    }) => {
      const targetRoomId = params.roomId || roomId
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error("Sign in to create a task.")
      if (!params.orgId || !targetRoomId) {
        throw new Error("Choose a room. Tasks belong to a room so an agent knows where to work.")
      }

      const { data, error: insertError } = await supabase
        .from("tasks")
        .insert(
          taskInsertRow({
            orgId: params.orgId,
            roomId: targetRoomId,
            userId: user.id,
            title: params.title,
            description: params.description,
            priority: params.priority,
            budgetTurns: params.budgetTurns,
          }),
        )
        .select(
          "id, number, title, description, status, kind, assignee_agent_id, assignee_user_id, budget_turns, turns_used, cost_usd, unblock_needs, metadata",
        )
        .single()

      if (insertError) throw insertError

      const newTask = mapTask(data)
      setTasks((prev) => [newTask, ...prev])
      return newTask
    },
    [roomId],
  )

  useEffect(() => {
    void fetchTasks()

    const channel = supabase
      .channel("tasks:live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {
        void fetchTasks()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [fetchTasks])

  return { tasks, loading, error, refresh: fetchTasks, createTask }
}
