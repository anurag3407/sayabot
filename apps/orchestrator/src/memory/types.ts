import type {
  epistemicStatusEnum,
  memoryKindEnum,
  memoryLinkTypeEnum,
  memoryScopeEnum,
  memorySourceEnum,
  openLoopStatusEnum,
} from "@sayabot/db"

export type EpistemicStatus = (typeof epistemicStatusEnum.enumValues)[number]
export type OpenLoopStatus = (typeof openLoopStatusEnum.enumValues)[number]
export type MemoryLinkType = (typeof memoryLinkTypeEnum.enumValues)[number]
export type MemoryScope = (typeof memoryScopeEnum.enumValues)[number]
export type MemoryKind = (typeof memoryKindEnum.enumValues)[number]
export type MemorySource = (typeof memorySourceEnum.enumValues)[number]

export interface MemoryLinkInput {
  targetMemoryId?: string | null
  targetSlug?: string | null
  relationship?: MemoryLinkType
  weight?: number
}

export interface CognitiveWriteInput {
  orgId: string
  scope: MemoryScope
  agentId?: string | null
  roomId?: string | null
  kind: MemoryKind
  title: string
  body: string
  tags?: string[]
  source?: MemorySource
  sourceRef?: string | null
  confidence?: number
  pinned?: boolean
  perspective?: string
  emotionalSalience?: number
  epistemicStatus?: EpistemicStatus
  evidenceRefs?: string[]
  targetAgentId?: string | null
  decayHalfLifeDays?: number
  links?: MemoryLinkInput[]
  createdByUserId?: string | null
  createdByAgentId?: string | null
}

export interface CognitiveRecallInput {
  orgId: string
  query: string
  scope?: MemoryScope
  agentId?: string | null
  roomId?: string | null
  limit?: number
  epistemicFilter?: EpistemicStatus[]
  minSalience?: number
  includeLinks?: boolean
}

export interface MemoryLinkView {
  id: string
  targetMemoryId?: string | null
  targetSlug?: string | null
  relationship: MemoryLinkType
  weight: number
}

export interface ScoredMemoryItem {
  id: string
  scope: MemoryScope
  kind: MemoryKind
  title: string
  body: string
  pinned: boolean
  confidence: number
  emotionalSalience: number
  epistemicStatus: EpistemicStatus
  perspective: string
  retention: number
  score: number
  tags: string[]
  links?: MemoryLinkView[]
}

export interface OpenLoopItem {
  id: string
  agentId: string
  roomId?: string | null
  description: string
  status: OpenLoopStatus
  dueAt?: Date | null
  blockerReason?: string | null
  resolution?: string | null
  sourceRef?: string | null
  createdAt: Date
  updatedAt: Date
}
