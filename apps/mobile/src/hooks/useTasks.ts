import { useCallback, useEffect, useState } from "react"
import { supabase } from "../core/supabase"
import type { TaskItem } from "../types"

export function useTasks(roomId?: string) {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from("tasks")
        .select(
          "id, number, title, description, status, kind, priority, assignee_agent_id, assignee_user_id, budget_turns, turns_used, cost_usd, unblock_needs"
        )
        .order("created_at", { ascending: false })
        .limit(50)

      if (roomId) {
        query = query.eq("room_id", roomId)
      }

      const { data, error } = await query
      if (error) throw error

      if (data) {
        setTasks(
          data.map((t: any) => ({
            id: t.id,
            number: t.number,
            title: t.title,
            description: t.description,
            status: t.status,
            kind: t.kind,
            priority: t.priority,
            assigneeAgentId: t.assignee_agent_id,
            assigneeUserId: t.assignee_user_id,
            budgetTurns: t.budget_turns ?? 12,
            turnsUsed: t.turns_used ?? 0,
            costUsd: Number(t.cost_usd ?? 0),
            unblockNeeds: t.unblock_needs,
          }))
        )
      }
    } catch (err) {
      console.error("[useTasks] fetchTasks error:", err)
    } finally {
      setLoading(false)
    }
  }, [roomId])

  const createTask = useCallback(
    async (params: {
      title: string
      description?: string
      priority?: "low" | "medium" | "high" | "urgent"
      budgetTurns?: number
    }) => {
      const { data: orgData } = await supabase
        .from("orgs")
        .select("id")
        .limit(1)
        .maybeSingle()

      const { data: maxTask } = await supabase
        .from("tasks")
        .select("number")
        .order("number", { ascending: false })
        .limit(1)
        .maybeSingle()

      const nextNum = (maxTask?.number || 0) + 1

      const { data, error } = await supabase
        .from("tasks")
        .insert({
          org_id: orgData?.id,
          number: nextNum,
          title: params.title.trim(),
          description: params.description?.trim() || null,
          status: "open",
          kind: "task",
          priority: params.priority || "medium",
          budget_turns: params.budgetTurns || 12,
        })
        .select()
        .single()

      if (error) throw error

      const newTask: TaskItem = {
        id: data.id,
        number: data.number,
        title: data.title,
        description: data.description,
        status: data.status,
        kind: data.kind,
        priority: data.priority,
        assigneeAgentId: data.assignee_agent_id,
        assigneeUserId: data.assignee_user_id,
        budgetTurns: data.budget_turns ?? 12,
        turnsUsed: 0,
        costUsd: 0,
        unblockNeeds: data.unblock_needs,
      }

      setTasks((prev) => [newTask, ...prev])
      return newTask
    },
    []
  )

  useEffect(() => {
    fetchTasks()

    const channel = supabase
      .channel("tasks:live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {
        fetchTasks()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchTasks])

  return { tasks, loading, refresh: fetchTasks, createTask }
}
