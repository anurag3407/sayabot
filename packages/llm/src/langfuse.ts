import { Langfuse } from "langfuse"

let client: Langfuse | null = null

export interface LangfuseConfig {
  publicKey?: string
  secretKey?: string
  baseUrl?: string
}

export function isLangfuseConfigured(config?: LangfuseConfig): boolean {
  const pk = config?.publicKey ?? process.env.LANGFUSE_PUBLIC_KEY
  const sk = config?.secretKey ?? process.env.LANGFUSE_SECRET_KEY
  return Boolean(pk && sk)
}

export function getLangfuseClient(config?: LangfuseConfig): Langfuse | null {
  if (!isLangfuseConfigured(config)) return null
  if (!client || config) {
    const pk = config?.publicKey ?? process.env.LANGFUSE_PUBLIC_KEY!
    const sk = config?.secretKey ?? process.env.LANGFUSE_SECRET_KEY!
    const baseUrl =
      config?.baseUrl ??
      process.env.LANGFUSE_BASEURL ??
      process.env.LANGFUSE_HOST ??
      "https://cloud.langfuse.com"

    const instance = new Langfuse({
      publicKey: pk,
      secretKey: sk,
      baseUrl,
      flushAt: 1,
    })
    if (!config) client = instance
    return instance
  }
  return client
}

export async function flushLangfuse(): Promise<void> {
  if (client) {
    try {
      await client.flushAsync()
    } catch {
      // Best-effort flush; never crash the runtime
    }
  }
}

export interface TraceArgs {
  id: string
  name: string
  sessionId?: string
  userId?: string
  metadata?: Record<string, unknown>
  tags?: string[]
}

export interface StepRecordArgs {
  traceId: string
  stepIdx: number
  kind: string
  name?: string
  input?: unknown
  output?: unknown
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  startedAt?: Date
  finishedAt?: Date
}

export async function recordStepToLangfuse(args: StepRecordArgs): Promise<void> {
  const lf = getLangfuseClient()
  if (!lf) return

  try {
    const isModel = args.kind === "model"
    const spanName = args.name || `${args.kind}:${args.stepIdx}`
    if (isModel) {
      lf.generation({
        traceId: args.traceId,
        name: spanName,
        startTime: args.startedAt ?? new Date(),
        endTime: args.finishedAt ?? new Date(),
        input: args.input,
        output: args.output,
        usage: args.usage
          ? {
              promptTokens: args.usage.inputTokens,
              completionTokens: args.usage.outputTokens,
              totalTokens: args.usage.totalTokens,
            }
          : undefined,
        metadata: {
          stepIdx: args.stepIdx,
          kind: args.kind,
        },
      })
    } else {
      lf.span({
        traceId: args.traceId,
        name: spanName,
        startTime: args.startedAt ?? new Date(),
        endTime: args.finishedAt ?? new Date(),
        input: args.input,
        output: args.output,
        metadata: {
          stepIdx: args.stepIdx,
          kind: args.kind,
        },
      })
    }
  } catch {
    // Non-blocking telemetry
  }
}

export async function recordScoreToLangfuse(args: {
  traceId: string
  name: string
  value: number
  comment?: string
}): Promise<void> {
  const lf = getLangfuseClient()
  if (!lf) return

  try {
    lf.score({
      traceId: args.traceId,
      name: args.name,
      value: args.value,
      comment: args.comment,
    })
  } catch {
    // Non-blocking
  }
}
