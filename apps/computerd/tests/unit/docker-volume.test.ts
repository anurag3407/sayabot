import { describe, expect, it } from "vitest"
import { DockerBackend, volumeName } from "../../src/backends/docker"

describe("local VM disk", () => {
  it("keeps the named volume when the container is removed", async () => {
    const calls: string[] = []
    const docker = {
      removeContainer: async () => {
        calls.push("container")
      },
      removeVolume: async () => {
        calls.push("volume")
      },
    }
    const backend = new DockerBackend(docker as never, {
      imageTag: "test",
      network: "botnet",
      memMb: 512,
      cpus: 1,
      runtime: "runc",
      ctlVolume: "ctl",
      orchestratorGrantsEnv: async () => ({}),
    })
    await backend.remove("agent-1", false)
    expect(volumeName("agent-1")).toBe("saaya-bot-agent-1")
    expect(calls).toEqual(["container"])
    await backend.remove("agent-1", true)
    expect(calls).toEqual(["container", "container", "volume"])
  })
})