import { DockerClient } from "../docker"
import { EgressBridge, parseEgressTarget } from "../egress-bridge"
import type { ProxyIdentity } from "../identity"
import type { ComputerdConfig } from "../lifecycle"
import { DockerBackend } from "./docker"
import { defaultBundleDir, E2BBackend } from "./e2b"
import { defaultRunDir, SmolvmBackend, smolvmUsable, spawnRunner } from "./smolvm"
import { BackendUnavailableError, type ComputerBackend } from "./types"

async function grantsEnvFetcher(config: ComputerdConfig) {
  return async (agentId: string): Promise<Record<string, string>> => {
    try {
      const res = await fetch(
        `${config.orchestratorUrl}/internal/computer/${encodeURIComponent(agentId)}/grants-env`,
        {
          headers: { "x-internal-secret": config.internalSecret },
          signal: AbortSignal.timeout(5_000),
        },
      )
      if (res.ok) return ((await res.json()) as { env?: Record<string, string> }).env ?? {}
    } catch {}
    return {}
  }
}

export async function buildDocker(config: ComputerdConfig, docker = new DockerClient()) {
  return new DockerBackend(docker, {
    imageTag: config.imageTag,
    network: config.network,
    memMb: config.memMb,
    cpus: config.cpus,
    runtime: config.dockerRuntime,
    ctlRoot: config.ctlRoot,
    ctlVolume: config.ctlVolume,
    orchestratorGrantsEnv: await grantsEnvFetcher(config),
  })
}

export async function buildSmolvm(config: ComputerdConfig, identity: ProxyIdentity) {
  const bridge = new EgressBridge(parseEgressTarget(config.egressProxyUrl), (id) =>
    identity.proxyAuthorization(id),
  )
  return new SmolvmBackend(spawnRunner(config.smolvmBin), bridge, {
    image: config.smolvmImage ?? `saaya/computer:${config.imageTag}`,
    memMb: config.memMb,
    cpus: config.cpus,
    storageGb: config.storageGb,
    runDir: config.smolvmRunDir ?? defaultRunDir(),
    grantsEnv: await grantsEnvFetcher(config),
  })
}

export async function buildE2B(config: ComputerdConfig) {
  if (!config.e2bApiKey) throw new BackendUnavailableError("E2B_API_KEY is not set")
  const sdk = await import("e2b")
  return new E2BBackend(sdk, {
    apiKey: config.e2bApiKey,
    template: config.e2bTemplate,
    maxRunning: config.e2bMaxRunning,
    idleMs: config.idleMs || 10 * 60_000,
    bundleDir: config.agentdBundleDir ?? defaultBundleDir(),
  })
}

/**
 * COMPUTER_BACKEND=auto picks the strongest backend this host can run:
 *   1. smolvm — a microVM per agent (Apple silicon Mac, or Linux with /dev/kvm);
 *   2. docker — a container per agent (optionally gVisor, which needs no KVM);
 *   3. e2b    — a cloud microVM per agent, for hosts that cannot run computers at all.
 */
export async function selectBackend(
  config: ComputerdConfig,
  identity: ProxyIdentity,
): Promise<ComputerBackend> {
  if (config.backend === "docker") return buildDocker(config)
  if (config.backend === "smolvm") return buildSmolvm(config, identity)
  if (config.backend === "e2b") return buildE2B(config)

  const reasons: string[] = []
  const smol = await smolvmUsable(spawnRunner(config.smolvmBin))
  if (smol.ok) return buildSmolvm(config, identity)
  reasons.push(`smolvm: ${smol.reason}`)

  const docker = new DockerClient()
  if (await docker.ping()) return buildDocker(config, docker)
  reasons.push("docker: daemon not reachable")

  if (config.e2bApiKey) return buildE2B(config)
  reasons.push("e2b: E2B_API_KEY not set")

  console.warn(
    `[computerd] no computer backend available (${reasons.join("; ")}); defaulting to docker`,
  )
  return buildDocker(config, docker)
}
