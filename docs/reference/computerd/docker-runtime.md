# computerd — Docker Runtime Layer

`src/docker.ts` is computerd's zero-dependency Docker Engine API client: endpoint discovery across Docker Desktop/OrbStack/Colima/Rancher sockets, Unix-socket HTTP with streaming bodies, container/volume/network CRUD, exec attach, and a demuxer for Docker's multiplexed stream format. The `DockerBackend` that builds actual agent containers on top of this client is covered in [backends.md](backends.md).

Source files: `apps/computerd/src/docker.ts`, `apps/computerd/src/backends/docker.ts` (consumers — see [backends.md](backends.md))

---

## 🔌 Endpoint Discovery (`detectDockerUrl`)

`detectDockerUrl(env, exists, home)` (`docker.ts:12-27`) finds a usable Docker endpoint without configuration:

```typescript
if (env.DOCKER_HOST) return env.DOCKER_HOST
const candidates = [
  "/var/run/docker.sock",                       // VPS / compose / standard Linux
  join(home, ".docker/run/docker.sock"),        // Docker Desktop (macOS)
  join(home, ".orbstack/run/docker.sock"),      // OrbStack
  join(home, ".colima/default/docker.sock"),    // Colima
  join(home, ".rd/docker.sock"),                // Rancher Desktop
]
for (const p of candidates) if (exists(p)) return `unix://${p}`
return "http://docker-proxy:2375"               // TCP proxy service name
```

1. `DOCKER_HOST` wins if set.
2. Otherwise the first existing socket path wins:

| Candidate | Runtime |
| :--- | :--- |
| `/var/run/docker.sock` | VPS / compose / standard Linux daemon |
| `~/.docker/run/docker.sock` | Docker Desktop (macOS) |
| `~/.orbstack/run/docker.sock` | OrbStack |
| `~/.colima/default/docker.sock` | Colima |
| `~/.rd/docker.sock` | Rancher Desktop |

3. Fallback: `http://docker-proxy:2375` (a TCP proxy service name).

Socket URLs (`/path` or `unix://path`) are routed through `unixRequest` (`docker.ts:37-75`), a hand-rolled `http.request({ socketPath, ... })` wrapper that rebuilds a Web `Response` and — critically — **streams the body** via `Readable.toWeb(res)` so long-running exec output is not buffered in memory. `204`/`304` responses get a `null` body and `res.resume()`.

---

## 🛠️ `DockerClient`

`DockerClient` (`docker.ts:124-251`) normalizes every call through `raw()` (socket or `fetch`) and `request()`:

- Non-OK responses throw `DockerApiError(message, status)` including the response body (`docker.ts:140-153`).
- JSON content types are parsed; other bodies are returned as the raw `Response` (callers stream them, e.g. exec attach). Parsed JSON responses cancel any unconsumed body (`res.body?.cancel()`) so sockets do not leak.
- `inspectContainer` maps a 404 to `null` instead of throwing (`docker.ts:155-162`).

| Method | Engine API | Notes |
| :--- | :--- | :--- |
| `inspectContainer(idOrName)` | `GET /containers/{id}/json` | `null` on 404 |
| `listContainers(label, all = false)` | `GET /containers/json` | label-filtered summaries; computerd filters on `saaya.agent` |
| `createContainer(config)` | `POST /containers/create?name=…` | full `DockerContainerConfig` body |
| `startContainer` / `stopContainer(t)` / `removeContainer(force, v=true)` | `POST …/start`, `POST …/stop?t=`, `DELETE /containers/{id}` | stop timeout, force+volume removal |
| `removeVolume(name, force)` | `DELETE /volumes/{name}` | used by "delete disk" |
| `inspectNetwork(name)` / `createNetwork(name, internal)` | `GET`/`POST /networks/…` | creates the internal `botnet` bridge on first use |
| `info()` | `GET /info` | `MemTotal` (auto capacity), `NCPU`, `Runtimes` (gVisor detection) |
| `version()` | `GET /version` | `ApiVersion` gates the volume-subpath fast path (≥ 1.45) |
| `execCreate(idOrName, cmd)` | `POST /containers/{id}/exec` | `AttachStdout`/`AttachStderr`, returns exec id |
| `execStart(execId)` | `POST /exec/{id}/start` | raw streamed `Response` (multiplexed attach stream) |
| `ping()` | `GET /_ping` | boolean reachability probe used by backend auto-selection |

### Container config shape

`DockerContainerConfig` (`docker.ts:94-115`) mirrors the Engine API create body, including `HostConfig.Runtime` (gVisor `runsc`), `ReadonlyRootfs`, `Tmpfs`, `Binds` and volume-subpath `Mounts` (`VolumeOptions.Subpath`), `NanoCpus`/`Memory`/`MemorySwap`/`PidsLimit`, `CapDrop`, `SecurityOpt`, and `RestartPolicy`.

---

## 📦 How Agent Containers Use It

The concrete container spec built on this client lives in `backends/docker.ts` (full treatment in [backends.md](backends.md)); the resource-naming facts:

| Resource | Name / value | Defined at |
| :--- | :--- | :--- |
| Container | `bot-${agentId}` | `backends/docker.ts:38` |
| Disk volume | `saaya-bot-${agentId}`, bind-mounted `…:/home/bot:rw` | `backends/docker.ts:39`, `:234` |
| Control volume | `saaya-agentd`, subpath-mounted per container at `/run/agentd-ctl` | `backends/docker.ts:35`, `:191-203` |
| CA bundle | `saaya-egress-ca` volume, read-only at `/usr/local/share/ca-certificates/saaya` | `backends/docker.ts:235` |
| Network | `COMPUTER_NETWORK` (default `botnet`, internal bridge) | `backends/docker.ts:149-156` |
| gVisor | `COMPUTER_DOCKER_RUNTIME=runsc`, or `auto` picks `runsc` when present in `info().Runtimes` | `backends/docker.ts:111-120` |

The fast path (agentd Unix socket) requires a **volume subpath mount**, which needs Docker Engine API ≥ 1.45, the `runc` runtime (gVisor cannot share the host-side mount), and a host-visible `AGENTD_CTL_ROOT`; otherwise computerd falls back to `docker exec /opt/agentd/agentd-cli` (`backends/docker.ts:163-183`).

---

## 🔀 `DockerStreamDemuxer`

When `Tty` is false (computerd's exec always), Docker multiplexes stdout/stderr into one stream: each frame is an **8-byte header** — `[stream, 0, 0, 0, size uint32-BE]` — followed by `size` payload bytes; header byte `2` marks stderr (`docker.ts:253-293`).

```typescript
if (this.mode === "unknown") {
  if (this.buf.length < 8) return out
  const b = this.buf
  this.mode = (b[0] ?? 255) <= 2 && b[1] === 0 && b[2] === 0 && b[3] === 0 ? "mux" : "raw"
}
```

`DockerStreamDemuxer` handles the ambiguity defensively:

- Starts in `unknown` mode; the first ≥ 8 bytes decide between `mux` (first byte ≤ 2 and three zero bytes) and `raw` (everything is stdout — Tty containers or already-demuxed proxies).
- `push(chunk)` returns `{ stdout: Buffer[], stderr: Buffer[] }`, buffering partial frames across chunks.
- `flush()` returns leftover bytes **only in raw mode** (a short raw stream that never reached 8 bytes would otherwise be dropped).

The backend pairs the demuxer with `NdjsonParser` to turn agentd-cli's stdout into frames (see [overview.md](overview.md)). Keeping stderr separate is load-bearing: any warning the CLI prints (Node deprecation notices, daemon chatter) must never leak into the NDJSON frame stream, and the backend includes captured stderr in its final error message to make failures diagnosable.

## 🧾 Interfaces The Backend Fills In

Two typed shapes in `docker.ts` define the contract the agent-container backend consumes:

```typescript
export interface DockerMount {
  Type: "volume" | "bind"
  Source: string
  Target: string
  ReadOnly?: boolean
  VolumeOptions?: { Subpath?: string }   // used for the per-container agentd-ctl subpath
}

export interface DockerContainerConfig {
  Image: string
  name: string
  User?: string
  Env?: string[]
  Labels?: Record<string, string>
  HostConfig?: {
    Runtime?: string           // "runsc" selects gVisor
    NetworkMode?: string       // "botnet"
    ReadonlyRootfs?: boolean
    Tmpfs?: Record<string, string>
    Binds?: string[]           // volume:/home/bot + egress CA
    Mounts?: DockerMount[]
    NanoCpus?: number
    Memory?: number
    MemorySwap?: number
    PidsLimit?: number
    CapDrop?: string[]
    SecurityOpt?: string[]     // no-new-privileges
    RestartPolicy?: { Name: string }
  }
}
```

`ContainerSummary` (`{ Id, Names, Labels, State }`) is what `listContainers` returns; the backend reads `Labels["saaya.agent"]` from it to rebuild the running-computer list.

## 🧯 Error Semantics

| Condition | What happens |
| :--- | :--- |
| Docker daemon down (EACCES/ECONNREFUSED/ENOENT on the socket) | `DockerBackend.inspect` converts it to `BackendUnavailableError` → HTTP 503 "docker daemon is not reachable — start Docker Desktop/OrbStack, or set COMPUTER_BACKEND" (`backends/docker.ts:77-88`) |
| Container missing on exec create (404) or not running (409) | converted to `ComputerGoneError`, triggering the lifecycle's wake-and-retry |
| `docker stop` on an already-stopped (304) or missing (404) container | tolerated — sleep is idempotent |
| `removeContainer` / `removeVolume` failures | swallowed; removal is best-effort so a bad volume never wedges the lifecycle |

## 🧵 Concurrency Notes

- The client is stateless; all mutability lives in the backend (`networkChecked`, `ctlSupported`, `runtimeResolved` are one-time probes cached on the backend instance).
- Exec attach streams are consumed by the caller and explicitly cancelled (`reader.cancel()`) when a final frame arrives early, so a long-running command that produced its answer does not keep the socket open.
- `ping()` cancels the `/_ping` body immediately — it is a reachability probe for auto-selection, not a data call.

---

## 🧪 Tests

- `apps/computerd/tests/unit/docker.test.ts` — endpoint discovery across the socket candidates, URL normalization.
- `apps/computerd/tests/unit/docker-volume.test.ts` — volume naming and bind configuration for agent containers.
- `apps/computerd/tests/unit/lifecycle.test.ts` — uses a fake backend; Docker interactions are covered indirectly through the docker backend tests.

---

## Related docs

- [Backend abstraction & selection](backends.md)
- [computerd overview & HTTP surface](overview.md)
- [agentd: the in-container daemon](agentd.md)
- [smolvm backend (no Docker needed)](backend-smolvm.md)
