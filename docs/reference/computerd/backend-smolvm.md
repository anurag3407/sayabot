# computerd — smolvm microVM Backend

The smolvm backend gives every agent a full microVM — its own kernel, its own disk — managed through the [smolvm](https://github.com/smol-machines/smolvm) CLI (libkrun-based, `SMOLVM_BIN`, default `smolvm`). VMs are created with **no network**; their only contacts with the host are two socket bridges: agentd's control socket exposed out (the ~1 ms fast path) and a per-agent egress socket mounted in (the only way out, with the agent's proxy credential added by computerd on the host side).

Source files: `apps/computerd/src/backends/smolvm.ts`, `apps/computerd/src/egress-bridge.ts` (the egress half — see [egress-bridge.md](egress-bridge.md))

---

## 🧰 The Runner Abstraction

`SmolvmRunner` (`smolvm.ts:32-35`) wraps the CLI so the backend can be tested without a hypervisor:

- `run(args, timeoutMs = 120_000)` — spawn, capture stdout/stderr, SIGKILL on timeout, resolve `{ code, stdout, stderr }` (`smolvm.ts:37-56`).
- `stream(args)` — async generator over the child's stdout while stderr accumulates; kills the child if the consumer exits early (`smolvm.ts:57-70`).

`spawnRunner(bin)` is the production implementation; tests inject fakes. CLI failures that indicate a missing/unrunnable binary are surfaced as `BackendUnavailableError("smolvm is not runnable: …")` by the `cli()` wrapper, which the lifecycle maps to HTTP 503.

### Naming and paths

| Constant               | Value                                                                                                                                         |
| :--------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| `machineName(agentId)` | `saaya-${agentId}` (`smolvm.ts:82`)                                                                                                           |
| `GUEST_AGENTD_SOCK`    | `/run/agentd.sock` (inside the VM, exposed to the host)                                                                                       |
| `GUEST_EGRESS_SOCK`    | `/run/saaya/egress.sock` (host socket mounted into the VM)                                                                                    |
| `defaultRunDir()`      | `~/.saaya/vm` (`SMOLVM_RUN_DIR`), per-machine dir `<runDir>/<agentId>` containing `ctl.sock` and `egress.sock` (`smolvm.ts:86-88`, `108-117`) |

Unix socket paths are capped at ~104 bytes on macOS, so `start()` warns when the ctl path approaches the limit and suggests a shorter `SMOLVM_RUN_DIR` (`smolvm.ts:175-179`).

---

## 🚀 Machine Lifecycle

### `status` / `listRunning` / `autoMaxRunning`

- Machine inventory comes from `smolvm machine ls --json` (`machines()`, `smolvm.ts:138-147`); `listRunning` filters names with the `saaya-` prefix and `state === "running"`, stripping the prefix back to the agent id.
- `autoMaxRunning` doubles host memory: `autoMaxRunning(totalmem() * 2, memMb, fraction)` — guest memory is elastic (virtio balloon), so an idle VM commits far less than its cap (`smolvm.ts:149-152`).
- `ipIdentity = false`: egress never uses IPs for smolvm; identity is the per-agent proxy credential.

### `start` (`smolvm.ts:172-187`)

```mermaid
sequenceDiagram
    participant L as lifecycle
    participant B as SmolvmBackend
    participant E as EgressBridge
    participant C as smolvm CLI
    L->>B: start(agentId, orgId, profile)
    B->>B: mkdir runDir/<agentId> mode 0700
    B->>E: listen(agentId, egress.sock) — must exist before boot
    B->>C: machine ls --json (status)
    alt missing
        B->>C: machine create … (600 s timeout; first create pulls/unpacks image)
    end
    alt not running
        B->>C: machine start --name saaya-<agentId> (180 s)
    end
    B->>B: waitForAgentd(ctl.sock, 30 s) — polls `stats` op via socketRequest
    B-->>L: { id: "saaya-<agentId>", ctlSocket }
```

`waitForAgentd` (`smolvm.ts:229-243`) exists because the host end of an exposed socket can appear before agentd listens inside the VM; it retries every 150 ms until a real `stats` request succeeds, then fails with `agentd did not come up in the VM: …`.

### `create` (`smolvm.ts:189-226`)

The machine is created with `machine create` passing:

- `--name saaya-<agentId>`, labels `saaya.agent=<agentId>` and `saaya.org=<orgId>`;
- `--image` (`SMOLVM_IMAGE` or `saaya/computer:<tag>`), `--cpus` (min 1), `--mem` (`COMPUTER_MEM_MB`), optional `--storage` (`COMPUTER_DISK_GB`);
- `--expose-socket /run/agentd.sock:<hostCtlPath>` — agentd's socket becomes a host Unix socket;
- `--mount-socket <hostEgressPath>:/run/saaya/egress.sock` — the only network path;
- `-e` environment for the guest:

```typescript
{
  NODE_ENV: "production",
  // The VM has no network; agentd relays this port to the mounted egress socket.
  HTTP_PROXY: "http://127.0.0.1:8080", HTTPS_PROXY: "http://127.0.0.1:8080",
  http_proxy: "http://127.0.0.1:8080", https_proxy: "http://127.0.0.1:8080",
  NO_PROXY: "",
  AGENTD_EGRESS_SOCK: "/run/saaya/egress.sock",
  ...grants,                       // env from orchestrator grants-env
}
```

The first create pulls/unpacks the image (600 s timeout); later creates reuse the host cache.

### `attach` (`smolvm.ts:166-170`)

For a VM that is already running (e.g. computerd restarted), attach re-opens the egress listener — `this.egress.listen(agentId, egressPath)` is idempotent per socket path — and returns the ctl socket. This is the boot-recovery path: without it, a restarted computerd would leave the VM with a dead host-side egress socket.

---

## 📞 Transport: Socket First, CLI Fallback

`transport()` (`smolvm.ts:245-262`):

1. Try `socketRequest(ready.ctlSocket, payload, responseTimeoutMs(payload))`.
2. On `TransportUnavailableError`, check `status()`: if the VM is **not running**, throw `ComputerGoneError` so the lifecycle wakes it (with admission control); if it is running, the bridge is unhealthy — fall through to the CLI.
3. `cliExec()` (`smolvm.ts:264-296`) runs `smolvm machine exec --name saaya-<agentId> -- /opt/agentd/agentd-cli <argvChunks…>` via `runner.stream`, parses stdout as NDJSON, and stops the child as soon as the final frame arrives. A non-zero exit whose stderr matches `/not running|stopped|no such machine/i` becomes `ComputerGoneError`; anything else is `agentd returned no complete response: …`.

---

## 😴 Sleep / Remove / Describe

| Operation                                           | Behaviour                                                                                                                                                                                                         |
| :-------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sleep(agentId, timeoutSec)` (`smolvm.ts:298-309`)  | `machine stop --name … -t <timeoutSec>` (60 s CLI timeout); "not running / stopped / no such machine / not found" in the output is tolerated                                                                      |
| `remove(agentId, deleteDisk)` (`smolvm.ts:315-320`) | **A VM's disk belongs to the machine**, so "remove but keep files" is just a stop; `deleteDisk: true` runs `machine delete --name … --force`, closes the egress listener, and deletes the per-agent run directory |
| `describe()` (`smolvm.ts:322-329`)                  | `isolation: "microVM (own kernel)"`, `fastPath: true`, `egress: "no network; per-agent socket → egress (proxy credential added by computerd)"`, plus the image ref                                                |

---

## ✅ Host Capability Check (`smolvmUsable`)

`smolvmUsable(runner)` (`smolvm.ts:342-358`) gates auto-selection:

1. Hardware virtualization: Apple silicon (`darwin` + `arm64`, Hypervisor.framework) or Linux with `/dev/kvm` openable for read/write (`kvmAccessible`, `smolvm.ts:332-339`). Otherwise: `no hardware virtualization (needs /dev/kvm or Apple silicon)`.
2. `smolvm --version` must exit 0 within 10 s; otherwise the stderr or `smolvm not installed (…)` is reported.

```typescript
const hv =
  (process.platform === "darwin" && process.arch === "arm64") ||
  (process.platform === "linux" && kvmAccessible())
```

The `auto` selector uses this before trying Docker (see [backends.md](backends.md)).

## 🖼️ Image Handling

`SMOLVM_IMAGE` accepts whatever `smolvm machine create --image` accepts — a registry reference (e.g. `saaya/computer:latest` from a registry) or a local tarball produced with `docker save` of the `saaya/computer` image. The first `machine create` for an image pays the pull/unpack cost (the CLI call gets a 600 s timeout, `smolvm.ts:225`); subsequent creates reuse the host cache, so the per-agent create that matters for latency is cheap. The `deploy/deploy.sh` flow builds `saaya/computer` and exports it for smolvm when `COMPUTER_BACKEND=smolvm` is configured (see [tools-and-sandboxes](../../tools-and-sandboxes.md) for the deployment matrix).

---

## 🧪 Tests

- `apps/computerd/tests/unit/smolvm-backend.test.ts` — machine naming, create args, transport fallback and `ComputerGoneError` mapping with a fake `SmolvmRunner`.
- `apps/computerd/tests/unit/transport.test.ts` — the socket protocol shared with this backend.

## 🖥️ Why a microVM (and what changes vs Docker)

| Concern             | smolvm behaviour                                                    | Docker counterpart                                |
| :------------------ | :------------------------------------------------------------------ | :------------------------------------------------ |
| Kernel              | per-VM, attacker-controlled syscalls stay in the guest              | host kernel, guarded by gVisor (optional)         |
| Network             | none by construction — the mounted egress socket is the only egress | `botnet` internal bridge + proxy env vars         |
| Egress identity     | HMAC proxy credential injected host-side                            | container IP, cached by egress (reset on reuse)   |
| Fast path           | always available (`--expose-socket`)                                | gated on Engine ≥ 1.45 + runc + `AGENTD_CTL_ROOT` |
| Sleep               | VM stops; disk is the machine's own                                 | container stops; disk is a named volume           |
| Remove without disk | just stops the VM                                                   | force-removes the container, keeps the volume     |
| Memory accounting   | elastic (balloon), cap doubled in auto sizing                       | hard `Memory`/`MemorySwap` limit                  |

The security model consequences (credential never in the guest, no network surface to attack) are described platform-wide in the [security model](../architecture/security-model.md).

---

## Related docs

- [Backend abstraction & selection](backends.md)
- [Egress bridge: per-agent socket + credential injection](egress-bridge.md)
- [Lifecycle: create, sleep, wake, evict](lifecycle.md)
- [agentd: the in-container daemon](agentd.md)
- [VPS & client deployment](../orchestrator/computers/vps-and-client.md)
