import { pgEnum } from "drizzle-orm/pg-core"

export const orgRoleEnum = pgEnum("org_role", ["owner", "admin", "member"])
export const roomMemberRoleEnum = pgEnum("room_member_role", ["admin", "member"])
export const roomKindEnum = pgEnum("room_kind", ["public", "private", "dm"])
export const turnModeEnum = pgEnum("turn_mode", ["mentions", "debate", "moderated"])
export const agentKindEnum = pgEnum("agent_kind", ["llm", "external"])
export const providerEnum = pgEnum("provider", [
  "openai",
  "anthropic",
  "google",
  "groq",
  "cerebras",
  "openai-compatible",
])
export const senderTypeEnum = pgEnum("sender_type", ["human", "agent", "system"])
export const messageStatusEnum = pgEnum("message_status", [
  "streaming",
  "complete",
  "error",
  "halted",
])
export const turnSessionStateEnum = pgEnum("turn_session_state", [
  "active",
  "complete",
  "halted",
  "superseded",
])
export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "running",
  "complete",
  "error",
  "halted",
  "waiting",
])
export const turnRoleEnum = pgEnum("turn_role", [
  "responder",
  "producer",
  "critic",
  "summarizer",
  "moderator",
])
export const canvasKindEnum = pgEnum("canvas_kind", ["markdown", "code", "svg", "html"])
export const mcpTransportEnum = pgEnum("mcp_transport", ["http", "sse", "stdio"])
export const toolCallStatusEnum = pgEnum("tool_call_status", [
  "pending_approval",
  "approved",
  "rejected",
  "running",
  "done",
  "error",
])
export const builtinToolEnum = pgEnum("builtin_tool", [
  "web_search",
  "github_bridge",
  "postgres_inspector",
])
export const meetingKindEnum = pgEnum("meeting_kind", ["meeting", "checkin"])
export const meetingStatusEnum = pgEnum("meeting_status", [
  "scheduled",
  "active",
  "ended",
  "canceled",
])
export const taskKindEnum = pgEnum("task_kind", ["task", "request"])
export const taskStatusEnum = pgEnum("task_status", ["open", "in_progress", "stuck", "done"])
export const unblockNeedsEnum = pgEnum("unblock_needs", [
  "human_answer",
  "another_agent",
  "credential",
  "external_access",
  "time",
  "other",
])
export const outcomeKindEnum = pgEnum("outcome_kind", [
  "artifact",
  "submission",
  "external_change",
  "decision",
  "none",
  "legacy",
])
export const checkinModeEnum = pgEnum("checkin_mode", ["stream", "digest"])

export const vaultSecretKindEnum = pgEnum("vault_secret_kind", [
  "api_token",
  "basic_auth",
  "password",
  "header_set",
  "github_app",
])
export const secretInjectEnum = pgEnum("secret_inject", ["header", "basic", "query", "body"])
export const computerStatusEnum = pgEnum("computer_status", [
  "none",
  "stopped",
  "starting",
  "running",
  "stopping",
  "error",
  "over_quota",
])
export const computerProfileEnum = pgEnum("computer_profile", ["standard", "browser"])
export const agentVisibilityEnum = pgEnum("agent_visibility", ["private", "org"])

export const memoryScopeEnum = pgEnum("memory_scope", ["agent", "room", "org"])
export const memoryKindEnum = pgEnum("memory_kind", [
  "fact",
  "preference",
  "decision",
  "procedure",
  "episode",
])
export const memorySourceEnum = pgEnum("memory_source", [
  "agent",
  "human",
  "compaction",
  "consolidation",
  "import",
])

export const epistemicStatusEnum = pgEnum("epistemic_status", [
  "hypothesis",
  "belief",
  "verified",
  "withdrawn",
  "superseded",
])

export const openLoopStatusEnum = pgEnum("open_loop_status", [
  "open",
  "in_progress",
  "blocked",
  "resolved",
  "dropped",
])

export const memoryLinkTypeEnum = pgEnum("memory_link_type", [
  "relates_to",
  "depends_on",
  "caused_by",
  "contradicts",
  "supersedes",
  "supports",
])

export const routineStatusEnum = pgEnum("routine_status", [
  "idle",
  "running",
  "success",
  "failed",
])

export const vectorProviderKindEnum = pgEnum("vector_provider_kind", [
  "vector_db",
  "embedding",
])


