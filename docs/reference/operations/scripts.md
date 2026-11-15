# Operational Scripts (`deploy/scripts/`)

Three shell scripts cover the one-time host preparation that `deploy/deploy.sh` assumes: hardening a fresh Ubuntu/Debian VPS (`setup-vps.sh`), installing the per-agent computer backend (`setup-computers.sh`), and issuing the first Let's Encrypt certificate (`init-letsencrypt.sh`). They are idempotent where possible and deliberately refuse to run when a precondition is missing. `deploy/install.sh` (documented in [deployment.md](deployment.md)) chains the last two together for first-time setup.

Source files: `deploy/scripts/setup-vps.sh`, `deploy/scripts/setup-computers.sh`, `deploy/scripts/init-letsencrypt.sh`

---

## 🖥️ `setup-vps.sh` — VPS Hardening + Docker

One-time setup for a fresh **Ubuntu 22.04/24.04 or Debian 12** server; dies on any other distro and must run as root.

```bash
scp deploy/scripts/setup-vps.sh root@VPS:/root/
ssh root@VPS 'bash /root/setup-vps.sh --user deploy --ssh-key "ssh-ed25519 AAAA... you@laptop"'
```

Options: `--user NAME` (default `deploy`), `--ssh-key "PUBLIC KEY"`, `--ssh-port N`, `--swap SIZE|0` (default `4G`), `--no-ssh-hardening`. What it installs and configures, in order (setup-vps.sh:53-190):

1. **Packages**: `apt-get update/upgrade` (keeping existing conffiles), then `ca-certificates curl gnupg git ufw fail2ban unattended-upgrades apt-listchanges jq htop chrony`.
2. **Unattended security upgrades**: writes `/etc/apt/apt.conf.d/20auto-upgrades` (daily package-list update, daily unattended upgrade, 7-day autoclean) and enables `unattended-upgrades` + `chrony`; sets the timezone to UTC.
3. **Docker Engine + Compose plugin**: only if `docker` is absent — Docker's official apt repo (GPG keyring at `/etc/apt/keyrings/docker.asc`), then `docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`. Always writes `/etc/docker/daemon.json` with json-file log rotation (`max-size 20m`, `max-file 5` — mirroring the compose logging anchor), `live-restore: true`, and `no-new-privileges: true`.
4. **Deploy user**: creates a passwordless `deploy` user, adds it to the `docker` group, creates a 700 `~/.ssh`, appends the given key to `authorized_keys` (deduplicated), or copies root's keys when none were given so login works immediately.
5. **SSH hardening** — only skipped when no key is in place ("so you are not locked out"): writes `/etc/ssh/sshd_config.d/99-sayabot-hardening.conf` with the chosen port, `PermitRootLogin prohibit-password`, `PasswordAuthentication no`, `MaxAuthTries 4`, `LoginGraceTime 30`, no X11/agent forwarding, and keepalive settings. Validates with `sshd -t` before reloading, opens the new port in UFW first, and handles Ubuntu 24.04's `ssh.socket` activation.
6. **Firewall**: UFW default deny incoming / allow outgoing; only the SSH port, 80/tcp ("http (ACME + redirect)"), and 443/tcp are opened — "Docker publishes only nginx's 80/443; nothing else is reachable from outside" (setup-vps.sh:149).
7. **fail2ban**: a `sayabot.local` sshd jail — systemd backend, `maxretry 5` in 10 min, 1h ban.
8. **Swap + kernel**: creates the swap file (default 4G — "Next.js builds need ~3 GB of memory") and adds it to `/etc/fstab` if no swap exists; writes `/etc/sysctl.d/99-sayabot.conf` (`vm.swappiness=10`, `somaxconn=4096`, `tcp_max_syn_backlog=4096`, port range `10240 65535`, `tcp_syncookies=1`, `fs.file-max=1048576`) and applies it.

It finishes by printing the exact next steps: clone the repo, copy `.env.production.example`, run `init-letsencrypt.sh`, then `./deploy/deploy.sh`. Re-running is safe: user creation, key appends, swap, and package installs all check before acting, and SSH hardening only activates once a key exists.

## 🤖 `setup-computers.sh` — Per-Agent Computer Backend

Prepares the Linux host that gives every agent its own computer (microVM or sandboxed container) and prints the `COMPUTER_BACKEND` settings to add to `.env.production`.

```bash
sudo ./deploy/scripts/setup-computers.sh            # auto-detect
sudo ./deploy/scripts/setup-computers.sh smolvm     # force microVMs (needs KVM)
sudo ./deploy/scripts/setup-computers.sh gvisor     # force gVisor containers (no KVM)
```

Decision logic (setup-computers.sh:28-32): `/dev/kvm` present → **smolvm** (a microVM per agent with its own kernel — strongest isolation); no `/dev/kvm` → **gVisor** (runsc with the systrap platform — works on ordinary VPSes without nested virtualization). Hosts under 2 GB RAM get a suggestion to use `COMPUTER_BACKEND=e2b` (cloud computers) instead. Linux-only; on a Mac it prints the `brew install smol-machines/tap/smolvm` instruction.

### smolvm mode — pinned version + mandatory checksum

- `SMOLVM_VERSION` is pinned to **1.34.1** (`SMOLVM_VERSION="${SMOLVM_VERSION:-1.34.1}"` — "pinned: smolvm's API changes between releases", setup-computers.sh:16).
- Downloads `smolvm-1.34.1-linux-{x86_64|arm64}.tar.gz` from the GitHub release plus `checksums.sha256`, and **refuses to install without verifying**: "No checksums published for ${SMOLVM_VERSION}; refusing to install an unverified binary" and a hard-fail on checksum mismatch (setup-computers.sh:42-45). Releases are not signed; the published SHA-256 is the only integrity check, so it is mandatory.
- Runs upstream's `install.sh` as root without `--prefix`, which performs a system install into **`/opt/smolvm`** (binary, libkrun, agent rootfs); then sanity-checks `$SMOLVM_PREFIX/smolvm --version`.
- Prints the follow-up: `COMPUTER_BACKEND=smolvm`, `SAYABOT_APP_SERVICES="orchestrator web computerd egress"`, then `./deploy/deploy.sh` — which builds the computer image and `docker save`-exports it for smolvm (see [deployment.md](deployment.md)).

### gVisor mode

- Requires Docker (`setup-vps.sh` first), installs `runsc` from gVisor's official apt repository (GPG key to `/usr/share/keyrings/gvisor-archive-keyring.gpg`, `storage.googleapis.com/gvisor/releases release main`) only if `runsc` is not already present.
- Registers the runtime with `runsc install` (edits `/etc/docker/daemon.json`), restarts Docker, verifies `docker info` lists `runsc`, and smoke-tests with `docker run --rm --runtime=runsc hello-world`.
- Prints the follow-up: `COMPUTER_BACKEND=docker`, `COMPUTER_DOCKER_RUNTIME=runsc`, plus the same `SAYABOT_APP_SERVICES` line.

Both modes are idempotent: smolvm reinstalls only on explicit invocation, and gVisor skips the apt install when `runsc` already exists.

## 🔒 `init-letsencrypt.sh` — First Certificate

Issues the initial Let's Encrypt certificate for `SAYABOT_DOMAIN`. Run once per server before the first deploy; renewal afterwards is automatic via the compose `certbot` service.

```bash
./deploy/scripts/init-letsencrypt.sh            # real certificate
./deploy/scripts/init-letsencrypt.sh --staging  # LE staging (no rate limits)
./deploy/scripts/init-letsencrypt.sh --force    # replace an existing certificate
./deploy/scripts/init-letsencrypt.sh --skip-dns-check
```

Flow (init-letsencrypt.sh:29-94):

1. Requires `.env.production` with a real `SAYABOT_DOMAIN` (placeholder rejected) and `LETSENCRYPT_EMAIL` (not `ops@example.com`).
2. Idempotency: if `certbot/conf/live/$DOMAIN/fullchain.pem` already exists, exits with "Use --force to replace it" (checked from an `alpine:3.20` container because certbot writes root-owned 0700 directories).
3. **DNS sanity check**: fetches the server's public IPv4 from `https://api.ipify.org` and compares it with the domain's `getent ahostsv4` records. On mismatch it dies — "Fix the DNS A record, set Cloudflare to DNS-only during certificate issuance, or pass --skip-dns-check" — the last option continuing with a warning (Cloudflare proxy detected). A non-resolving domain is a hard error.
4. **Port 80 handoff**: `docker compose stop nginx` so certbot's standalone challenge server can bind port 80.
5. With `--force`, removes the domain's `live/`, `archive/`, and `renewal/` state first.
6. Requests the cert via `docker compose run --rm --no-deps -p 80:80 --entrypoint certbot certbot certonly --standalone --key-type ecdsa --elliptic-curve secp384r1` (plus `--staging` when requested).
7. **Renewal mode switch**: rewrites the renewal conf from `authenticator = standalone` to `webroot` with `webroot_path = /var/www/certbot`, so future renewals happen through nginx with no downtime (init-letsencrypt.sh:85-90).
8. Prints where the cert landed and reminds that staging certs will warn browsers.

`deploy/install.sh` calls this automatically before the first `deploy.sh` when no tunnel token is configured, and `deploy.sh`'s preflight refuses to roll out until the certificate exists.

## 📌 Pinned Versions & Integrity

| Component | Version / source | Integrity mechanism |
| :--- | :--- | :--- |
| smolvm | `1.34.1` (override with `SMOLVM_VERSION` env) | mandatory `sha256sum -c` against the release's `checksums.sha256`; install **refuses** without it |
| gVisor (`runsc`) | whatever the `release` apt channel currently ships | official gVisor archive GPG key (`gvisor.dev/archive.key` → `/usr/share/keyrings/gvisor-archive-keyring.gpg`) |
| Docker Engine | `download.docker.com/linux/<distro>` stable apt repo | repo GPG keyring at `/etc/apt/keyrings/docker.asc` |
| Let's Encrypt cert | ECDSA `secp384r1` key, standalone issuance | cert state lives in `deploy/certbot/conf` (root-owned 0700, inspected via an `alpine:3.20` container) |
| OS | Ubuntu 22.04/24.04, Debian 12 | hard `die` on anything else |

The scripts deliberately avoid one class of risk: smolvm releases are **not signed**, so the published SHA-256 is treated as the only integrity check and is enforced ("refusing to install an unverified binary", setup-computers.sh:44).

## ♻️ Idempotency Matrix

| Script | Safe to re-run? | Guarantees |
| :--- | :--- | :--- |
| `setup-vps.sh` | Yes | skips Docker install if present; user creation, SSH key appends (grep-dedup), swap file, and sysctl all check before acting; SSH hardening only activates once a key exists |
| `setup-computers.sh` | Yes | `runsc` apt install skipped when the binary exists; smolvm reinstalls into `/opt/smolvm` (same pinned version → same result) |
| `init-letsencrypt.sh` | Yes | exits early when `certbot/conf/live/$DOMAIN/fullchain.pem` exists unless `--force`; `--force` removes `live/`, `archive/`, `renewal/` for the domain first |

## 🔧 Variables the Scripts Set or Read

Scripts both read and write `deploy/.env.production`. What each stage expects afterward:

| Script | Writes (suggests) | Reads |
| :--- | :--- | :--- |
| `setup-vps.sh` | nothing (host only) | `--user`, `--ssh-key`, `--ssh-port`, `--swap`, `--no-ssh-hardening` flags |
| `setup-computers.sh` | prints `COMPUTER_BACKEND`, `COMPUTER_DOCKER_RUNTIME`, `SAYABOT_APP_SERVICES` to add manually | `SMOLVM_VERSION`, mode arg (`auto`/`smolvm`/`gvisor`) |
| `init-letsencrypt.sh` | certbot state only (no env writes) | `SAYABOT_DOMAIN`/`MESH_DOMAIN`, `LETSENCRYPT_EMAIL`, optional `--staging`/`--force`/`--skip-dns-check` |

The consistent pattern is that scripts prepare the host and **print** the `.env.production` lines; only `deploy/install.sh` writes environment files (see [deployment.md](deployment.md)).

## 🧾 Related Files Outside `scripts/`

- `deploy/install.sh` — interactive `.env.production` generator that chains `init-letsencrypt.sh` → `deploy.sh` (see [deployment.md](deployment.md)).
- `deploy/deploy.sh` — the deploy/rollback/migrate/backup entry point that all scripts hand off to.
- `deploy/.env.production.example` — template listing every variable the scripts above expect, including `COMPUTER_BACKEND`, `SAYABOT_APP_SERVICES`, and `SMOLVM_VERSION` overrides.

---

## Related docs

- [deployment.md](deployment.md) — compose stack, deploy.sh stages, computer image build
- [troubleshooting.md](troubleshooting.md) — backend selection and TLS failures
- [../computerd/](../computerd/) — computerd reference (backends, agentd, confinement)
- [../../tools-and-sandboxes.md](../../tools-and-sandboxes.md) — sandbox backends compared
- [../../self-hosting.md](../../self-hosting.md) — self-hosting overview
