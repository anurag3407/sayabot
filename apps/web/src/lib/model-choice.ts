import "server-only"
import { isSayaModel, MAC_CLI_APP_IDS, MAC_CLI_APPS, sayaModelLabel, sayaModelValue } from "@sayabot/core"
import { EFFORT_LEVELS } from "@sayabot/llm/models/effort"
import { createAdminClient } from "@/lib/supabase/admin"
import { sayaAi } from "@/lib/env"
import { localDetectionAllowed } from "@/lib/local-agents"
import { parseMacKeyId } from "@/lib/model-catalog"

/**
 * A pick in the model picker (provider account `keyId` + model + effort) checked and turned into
 * what a bot stores: its key, its model and where it runs. Shared by the bot's default and by
 * "only this chat", so both accept exactly the same choices.
 */

/** Every agent app a Mac can run bots with (MAC_CLI_APPS in @sayabot/core). */
export const MAC_APPS: readonly string[] = MAC_CLI_APP_IDS
export const LOCAL_MODEL_APPS = ["ollama", "lmstudio"] as const
const SERVER_APPS = ["claude-code", "codex", "cursor"] as const

const APP_NAMES: Record<string, string> = {
  ...Object.fromEntries(MAC_CLI_APPS.map((app) => [app.id, app.name])),
  ollama: "Ollama",
  lmstudio: "LM Studio",
}

/** Model ids reach a command line on the Mac or the server, so only plain ones pass. */
const MODEL_ID = /^[\w.:/@+[\]~-]{1,160}$/
const EFFORTS = new Set<string>(EFFORT_LEVELS)

export interface ResolvedChoice {
  providerKeyId: string | null
  agentModel: string | null
  /** params.runner, or null to run on the server through the key / server model. */
  runner: Record<string, unknown> | null
  effort: string | null
  /** For the confirmation: "Claude Opus 5.5 on Anurag's MacBook". */
  label: string
  /** A Mac only runs its owner's bots: set when this choice makes that person the owner. */
  macOwnerUserId: string | null
}

export type ChoiceResult = { ok: true; choice: ResolvedChoice } | { ok: false; error: string }

export async function resolveModelChoice(input: {
  orgId: string
  /** The person picking. A Mac must be theirs. */
  userId: string
  /** The request's host, which decides whether apps on the server's own computer count. */
  requestHost: string | null
  keyId: string | null
  model: string | null
  effort?: string | null
}): Promise<ChoiceResult> {
  const admin = createAdminClient()
  const model = input.model?.trim().slice(0, 200) || null
  const effort = input.effort && EFFORTS.has(input.effort) ? input.effort : null
  const keyId = input.keyId

  // An app on the person's own Mac: Claude Code, Codex… or a model served there (Ollama).
  if (keyId?.startsWith("host:")) {
    const parsed = parseMacKeyId(keyId)
    if (!parsed) return { ok: false, error: "That computer isn't valid" }
    // The older picker sent `host:<id>` with the app as the model.
    const app = parsed.app ?? model
    const appModel = parsed.app ? model : null
    const { data: host } = await admin
      .from("desktop_hosts")
      .select("id, user_id, name, revoked_at")
      .eq("id", parsed.hostId)
      .maybeSingle()
    if (!host || host.revoked_at || host.user_id !== input.userId) {
      return { ok: false, error: "You can only pick a computer you set up yourself" }
    }
    const isLocalModel = (LOCAL_MODEL_APPS as readonly string[]).includes(app ?? "")
    if (!app || (!isLocalModel && !MAC_APPS.includes(app))) {
      return { ok: false, error: "Pick an app on that computer" }
    }
    const chosen = appModel && appModel !== "default" ? appModel : null
    if (chosen && !MODEL_ID.test(chosen)) return { ok: false, error: "That model id isn't valid" }
    if (isLocalModel && !chosen) return { ok: false, error: `Pick a model in ${APP_NAMES[app]}` }
    return {
      ok: true,
      choice: {
        providerKeyId: null,
        agentModel: null,
        runner: { hostId: host.id, app, ...(chosen ? { model: chosen } : {}) },
        effort: isLocalModel ? null : effort,
        label: `${chosen ?? `${APP_NAMES[app]} default`} on ${host.name}`,
        macOwnerUserId: input.userId,
      },
    }
  }

  // Claude Code / Codex signed in on the machine Sayabot itself runs on.
  if (keyId?.startsWith("cli:")) {
    const app = keyId.slice(4)
    if (!(SERVER_APPS as readonly string[]).includes(app)) return { ok: false, error: "Pick Claude Code, Codex or Cursor" }
    if (!localDetectionAllowed(input.requestHost)) {
      return { ok: false, error: "Apps on this computer are only available when Sayabot runs on your own machine" }
    }
    if (model && model !== "default" && !MODEL_ID.test(model)) return { ok: false, error: "That model id isn't valid" }
    return {
      ok: true,
      choice: {
        providerKeyId: null,
        agentModel: null,
        runner: { where: "server", app, ...(model && model !== "default" ? { model } : {}) },
        effort,
        label: `${model && model !== "default" ? model : "the default model"} · ${APP_NAMES[app]}`,
        macOwnerUserId: null,
      },
    }
  }

  // A saved API key of this workspace.
  if (keyId) {
    const { data: key } = await admin.from("provider_keys").select("id, org_id").eq("id", keyId).maybeSingle()
    if (!key || key.org_id !== input.orgId) return { ok: false, error: "That provider account isn't in this workspace" }
    if (!model) return { ok: false, error: "Pick a model" }
    return {
      ok: true,
      choice: { providerKeyId: key.id, agentModel: model, runner: null, effort, label: model, macOwnerUserId: null },
    }
  }

  // The server's own models (Saya AI). Store the alias, never the real id, so .env changes reach
  // the bot. null means "Automatic": follow the server's current default.
  if (model) {
    const saya = sayaAi()
    if (!saya) return { ok: false, error: "This server has no Saya AI models set up" }
    if (!isSayaModel(model) || !saya.models.some((m) => sayaModelValue(m.alias) === model)) {
      return { ok: false, error: "That Saya AI model isn't offered by this server any more" }
    }
  }
  const saya = sayaAi()
  return {
    ok: true,
    choice: {
      providerKeyId: null,
      agentModel: model,
      runner: null,
      effort,
      label: saya ? sayaModelLabel(saya, model) : "the default model",
      macOwnerUserId: null,
    },
  }
}
