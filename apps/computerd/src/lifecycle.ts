import { DockerClient } from "./docker"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://orchestrator:4000"
const INTERNAL_SECRET = process.env.ORCHESTRATOR_INTERNAL_SECRET || ""
const IMAGE_TAG = process.env.COMPUTE_IMAGE_TAG || "latest"

const inFlightEnsure = new Map<string, Promise<{ status: string; ip?: string }>>()

async function notifyOrchestratorState(
  agentId: string,
  status: "none" | "starting" | "running" | "stopped" | "error",
  containerId?: string | null,
  containerIp?: string | null,
  error?: string | null,
) {
  try {
    await fetch(`${ORCHESTRATOR_URL}/internal/computer/state`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({
        agentId,
        status,
        containerId,
        containerIp,
        error,
      }),
    })
  } catch (e) {
    console.warn(`[computerd] failed to notify orchestrator of agent ${agentId} state`, e)
  }
}

async function getGrantsEnv(agentId: string): Promise<Record<string, string>> {
  try {
    const res = await fetch(
      `${ORCHESTRATOR_URL}/internal/computer/${encodeURIComponent(agentId)}/grants-env`,
      {
        headers: { "x-internal-secret": INTERNAL_SECRET },
      },
    )
    if (res.ok) {
      const data = (await res.json()) as { env?: Record<string, string> }
      return data.env ?? {}
    }
  } catch {}
  return {}
}

export class ComputerLifecycle {
  private docker = new DockerClient()

  async ensure(
    agentId: string,
    orgId: string,
    profile: "standard" | "browser" = "standard",
  ): Promise<{ status: string; ip?: string }> {
    const existing = inFlightEnsure.get(agentId)
    if (existing) return existing

    const promise = (async () => {
      const containerName = `bot-${agentId}`
      const inspect = await this.docker.inspectContainer(containerName)

      if (inspect) {
        if (inspect.State?.Running) {
          const ip =
            inspect.NetworkSettings?.Networks?.botnet?.IPAddress ||
            inspect.NetworkSettings?.IPAddress
          return { status: "running", ip }
        }

        // Start container
        await notifyOrchestratorState(agentId, "starting", inspect.Id)
        await this.docker.startContainer(containerName)
        const startedInspect = await this.docker.inspectContainer(containerName)
        const ip =
          startedInspect.NetworkSettings?.Networks?.botnet?.IPAddress ||
          startedInspect.NetworkSettings?.IPAddress
        await notifyOrchestratorState(agentId, "running", inspect.Id, ip)
        return { status: "running", ip }
      }

      // Create container
      await notifyOrchestratorState(agentId, "starting")
      const grantsEnv = await getGrantsEnv(agentId)
      const envList = [
        "NODE_ENV=production",
        "HTTP_PROXY=http://egress:8080",
        "HTTPS_PROXY=http://egress:8080",
        "http_proxy=http://egress:8080",
        "https_proxy=http://egress:8080",
        'NO_PROXY=""',
        ...Object.entries(grantsEnv).map(([k, v]) => `${k}=${v}`),
      ]

      const image =
        profile === "browser"
          ? `saaya/computer:${IMAGE_TAG}-browser`
          : `saaya/computer:${IMAGE_TAG}`

      const created = await this.docker.createContainer({
        name: containerName,
        Image: image,
        Env: envList,
        Labels: {
          "saaya.agent": agentId,
          "saaya.org": orgId,
        },
        HostConfig: {
          Runtime: process.env.RUNSC_ENABLED === "true" ? "runsc" : undefined,
          NetworkMode: "botnet",
          ReadonlyRootfs: true,
          Tmpfs: {
            "/tmp": "size=512m,mode=1777",
            "/run": "size=16m,mode=1777",
          },
          Binds: [
            `saaya-bot-${agentId}:/home/bot:rw`,
            `saaya-egress-ca:/usr/local/share/ca-certificates/saaya:ro`,
          ],
          NanoCpus: 1000 * 1e6,
          Memory: 1024 * 1024 * 1024,
          MemorySwap: 1024 * 1024 * 1024,
          PidsLimit: 512,
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges:true"],
          RestartPolicy: { Name: "no" },
        },
      })

      await this.docker.startContainer(containerName)
      const inspectAfterStart = await this.docker.inspectContainer(containerName)
      const ip =
        inspectAfterStart.NetworkSettings?.Networks?.botnet?.IPAddress ||
        inspectAfterStart.NetworkSettings?.IPAddress
      await notifyOrchestratorState(agentId, "running", created.Id, ip)

      return { status: "running", ip }
    })().finally(() => {
      inFlightEnsure.delete(agentId)
    })

    inFlightEnsure.set(agentId, promise)
    return promise
  }

  async execAgentd(agentId: string, payload: Record<string, unknown>): Promise<any> {
    const containerName = `bot-${agentId}`
    await this.ensure(agentId, "system")

    const exec = await this.docker.execCreate(containerName, [
      "/opt/agentd/agentd-cli",
      JSON.stringify(payload),
    ])

    const res = await this.docker.execStart(exec.Id)
    const text = await res.text()

    // Parse NDJSON lines
    const lines = text.split("\n").filter((l) => l.trim().length > 0)
    const frames = []
    for (const l of lines) {
      try {
        frames.push(JSON.parse(l))
      } catch {}
    }
    return frames
  }

  async stop(agentId: string): Promise<void> {
    const containerName = `bot-${agentId}`
    try {
      await this.docker.stopContainer(containerName, 10)
    } catch {}
    await notifyOrchestratorState(agentId, "stopped")
  }

  async remove(agentId: string, deleteDisk = false): Promise<void> {
    const containerName = `bot-${agentId}`
    try {
      await this.docker.removeContainer(containerName, true)
    } catch {}
    if (deleteDisk) {
      try {
        await this.docker.removeVolume(`saaya-bot-${agentId}`)
      } catch {}
    }
    await notifyOrchestratorState(agentId, "none")
  }
}
