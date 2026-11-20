import type { Metadata } from "next"
import { requireOrgAccess } from "@/lib/auth"
import { listMemberViews, listOrgAgents, listRooms } from "@/lib/queries"
import { loadTasks } from "@/lib/queries-ia"
import { TasksView } from "@/components/ia/tasks-view"

export const metadata: Metadata = { title: "Tasks" }

export default async function TasksPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAccess(orgSlug)
  const [tasks, rooms, members, agents] = await Promise.all([
    loadTasks(access),
    listRooms(access.org.id),
    listMemberViews(access.org.id),
    listOrgAgents(access.org.id),
  ])
  return (
    <TasksView
      orgSlug={orgSlug}
      tasks={tasks}
      rooms={rooms
        .filter((room) => room.kind !== "dm")
        .map((room) => ({ id: room.id, name: room.name }))}
      members={members.map((member) => ({
        userId: member.userId,
        displayName: member.displayName,
      }))}
      agents={agents.map((agent) => ({
        id: agent.id,
        handle: agent.handle,
        displayName: agent.displayName,
      }))}
    />
  )
}
