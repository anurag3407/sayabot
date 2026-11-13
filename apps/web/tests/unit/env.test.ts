import { afterEach, describe, expect, it, vi } from "vitest"

// src/lib/env.ts imports "server-only", which throws outside a server bundle.
vi.mock("server-only", () => ({}))

// Vitest loads the repo .env into process.env, so every test starts by
// clearing the vars it cares about, then stubbing what it needs.
const KEYS = [
  "ORCHESTRATOR_URL", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SITE_URL", "SAYABOT_KEK", "MESH_KEK",
  "SSO_ENABLED", "NEXT_PUBLIC_SSO_ENABLED", "GITHUB_AUTH_ENABLED", "NEXT_PUBLIC_GITHUB_AUTH_ENABLED",
  "GOOGLE_AUTH_ENABLED", "NEXT_PUBLIC_GOOGLE_AUTH_ENABLED", "DEV_OPENAI_COMPAT_BASE_URL", "DEV_OPENAI_COMPAT_MODEL",
] as const

async function load(env: Record<string, string>) {
  vi.resetModules()
  for (const k of KEYS) vi.stubEnv(k, undefined as never)
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  return import("../../src/lib/env")
}

describe("web env helpers", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

  it("requireEnv throws naming the variable", async () => {
    const { requireEnv } = await load({})
    expect(() => requireEnv("DEFINITELY_UNSET_XYZ")).toThrow(/DEFINITELY_UNSET_XYZ is not set/)
  })

  it("URL getters strip trailing slashes and default sensibly", async () => {
    const { getOrchestratorUrl, getAppUrl } = await load({ ORCHESTRATOR_URL: "http://o:4000/", NEXT_PUBLIC_APP_URL: "https://app.example///" })
    expect(getOrchestratorUrl()).toBe("http://o:4000")
    expect(getAppUrl()).toBe("https://app.example")
    const { getOrchestratorUrl: defO, getAppUrl: defA } = await load({})
    expect(defO()).toBe("http://localhost:4000")
    expect(defA()).toBe("http://localhost:3000")
  })

  it("getKek prefers SAYABOT_KEK, allows MESH_KEK, throws when neither", async () => {
    expect((await load({ SAYABOT_KEK: "s", MESH_KEK: "m" })).getKek()).toBe("s")
    expect((await load({ MESH_KEK: "m" })).getKek()).toBe("m")
    const { getKek } = await load({})
    expect(() => getKek()).toThrow(/SAYABOT_KEK/)
  })

  it("feature flags are strict 'true'", async () => {
    const m = await load({ SSO_ENABLED: "true", GITHUB_AUTH_ENABLED: "1", GOOGLE_AUTH_ENABLED: "TRUE" })
    expect(m.ssoEnabled()).toBe(true)
    expect(m.githubAuthEnabled()).toBe(true) // envBool also accepts "1"
    expect(m.googleAuthEnabled()).toBe(false) // "TRUE" is not accepted
    expect(m.devModelConfigured()).toBe(false)
  })

  it("devModelConfigured needs a base URL, model and key, like the orchestrator", async () => {
    expect((await load({ DEV_OPENAI_COMPAT_BASE_URL: "http://x" })).devModelConfigured()).toBe(false)
    // Without a key the orchestrator can't run it, so the picker must not offer it.
    expect((await load({ DEV_OPENAI_COMPAT_BASE_URL: "http://x", DEV_OPENAI_COMPAT_MODEL: "m" })).devModelConfigured()).toBe(false)
    expect(
      (await load({ DEV_OPENAI_COMPAT_BASE_URL: "http://x", DEV_OPENAI_COMPAT_MODEL: "m", DEV_OPENAI_COMPAT_API_KEY: "k" })).devModelConfigured(),
    ).toBe(true)
  })

  it("exposes Saya AI to clients without the key, endpoint or real ids", async () => {
    const m = await load({
      SAYA_AI_BASE_URL: "https://llm.example.com/v1",
      SAYA_AI_API_KEY: "sk-secret",
      SAYA_AI_MODELS: "pro=real-model-id|Saya Pro",
    })
    expect(m.devModelConfigured()).toBe(true)
    const view = m.sayaAiPublic()
    expect(view?.models).toEqual([{ value: "saya/pro", label: "Saya Pro" }])
    expect(JSON.stringify(view)).not.toMatch(/sk-secret|llm\.example|real-model-id/)
  })
})
