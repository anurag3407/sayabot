import { describe, expect, it } from "vitest"
import {
  findAvailablePort,
  createLocalSession,
  getEmbeddedEngineStatus,
  stopEmbeddedEngine,
} from "./embedded-engine"

describe("Embedded Engine (Zero-Config Desktop Mode)", () => {
  it("finds an available local port", async () => {
    const port = await findAvailablePort(4800)
    expect(port).toBeGreaterThanOrEqual(4800)
    expect(typeof port).toBe("number")
  })

  it("generates a valid local auth session without external network", () => {
    const session = createLocalSession("http://127.0.0.1:4000")
    expect(session.userId).toBe("00000000-0000-0000-0000-000000000001")
    expect(session.email).toBe("local@sayabot.local")
    expect(session.serverUrl).toBe("http://127.0.0.1:4000")
    expect(session.accessToken).toBeDefined()
    expect(session.accessToken.split(".").length).toBe(3)
  })

  it("reports initial embedded engine status structure", () => {
    const status = getEmbeddedEngineStatus()
    expect(status).toHaveProperty("running")
    expect(status).toHaveProperty("port")
    expect(status).toHaveProperty("serverUrl")
    expect(status).toHaveProperty("dbReady")
  })

  it("safely handles stopEmbeddedEngine when no engine is active", async () => {
    await stopEmbeddedEngine()
    const status = getEmbeddedEngineStatus()
    expect(status.running).toBe(false)
  })
})
