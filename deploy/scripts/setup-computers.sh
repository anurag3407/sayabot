#!/usr/bin/env bash
# Prepares this Linux host to give every agent its own computer, and tells you
# which COMPUTER_BACKEND to put in deploy/.env.production.
#
#   sudo ./deploy/scripts/setup-computers.sh            # auto-detect
#   sudo ./deploy/scripts/setup-computers.sh smolvm     # force microVMs (needs KVM)
#   sudo ./deploy/scripts/setup-computers.sh gvisor     # force gVisor containers (no KVM needed)
#
# Decision:
#   /dev/kvm present  → smolvm: a microVM per agent (own kernel). Strongest isolation.
#   no /dev/kvm       → Docker + gVisor (runsc, systrap platform): a syscall sandbox per
#                       agent that works on ordinary VPSes without nested virtualization.
#   too small a host  → set COMPUTER_BACKEND=e2b and E2B_API_KEY: cloud computers, nothing local.
set -euo pipefail

SMOLVM_VERSION="${SMOLVM_VERSION:-1.34.1}"   # pinned: smolvm's API changes between releases
SMOLVM_PREFIX=/opt/smolvm   # the upstream installer's system location when run as root; compose mounts it
MODE="${1:-auto}"

log()  { printf '\033[1;34m[computers]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[computers]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[computers]\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Linux" ]] || die "This script is for Linux servers. On a Mac, install smolvm with: brew install smol-machines/tap/smolvm"
[[ $EUID -eq 0 ]] || die "Run as root (sudo)."

mem_gb=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1024 / 1024 ))
if [[ "$MODE" == "auto" ]]; then
  if [[ -e /dev/kvm ]]; then MODE=smolvm; else MODE=gvisor; fi
fi
log "Host: $(nproc) vCPU, ${mem_gb} GB RAM, KVM: $([[ -e /dev/kvm ]] && echo yes || echo no) → $MODE"
(( mem_gb >= 2 )) || log "Under 2 GB RAM: consider COMPUTER_BACKEND=e2b (cloud computers) instead."

install_smolvm() {
  [[ -e /dev/kvm ]] || die "No /dev/kvm. Use a KVM-capable host (bare metal, or a VPS with nested virtualization), or run: $0 gvisor"
  local arch; case "$(uname -m)" in x86_64|amd64) arch=x86_64 ;; aarch64|arm64) arch=arm64 ;; *) die "Unsupported CPU $(uname -m)" ;; esac
  local base="https://github.com/smol-machines/smolvm/releases/download/v${SMOLVM_VERSION}"
  local tarball="smolvm-${SMOLVM_VERSION}-linux-${arch}.tar.gz"
  local tmp; tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' RETURN
  log "Downloading smolvm ${SMOLVM_VERSION}"
  curl -fsSL "$base/$tarball" -o "$tmp/$tarball"
  curl -fsSL "$base/checksums.sha256" -o "$tmp/checksums.sha256" \
    || die "No checksums published for ${SMOLVM_VERSION}; refusing to install an unverified binary."
  # Releases are not signed; the published SHA-256 is the only integrity check, so it is mandatory.
  (cd "$tmp" && grep " ${tarball}\$" checksums.sha256 | sha256sum -c -) || die "Checksum mismatch for $tarball"
  curl -fsSL "https://raw.githubusercontent.com/smol-machines/smolvm/v${SMOLVM_VERSION}/scripts/install.sh" -o "$tmp/install.sh"
  # Run as root without --prefix, the upstream installer does a system install into /opt/smolvm
  # (binary, libkrun, agent rootfs); it re-downloads the tarball verified above.
  bash "$tmp/install.sh" --version "$SMOLVM_VERSION" --no-modify-path
  "$SMOLVM_PREFIX/smolvm" --version >/dev/null || die "smolvm did not install correctly"
  ok "smolvm installed at $SMOLVM_PREFIX"
  cat <<EOF

Add to deploy/.env.production:
  COMPUTER_BACKEND=smolvm
  SAYABOT_APP_SERVICES="orchestrator web computerd egress"
Then run ./deploy/deploy.sh (it builds the computer image and exports it for smolvm).
EOF
}

install_gvisor() {
  command -v docker >/dev/null || die "Docker is not installed (run deploy/scripts/setup-vps.sh first)."
  if ! command -v runsc >/dev/null; then
    log "Installing gVisor (runsc) from the official apt repository"
    command -v apt-get >/dev/null || die "Automatic install supports Debian/Ubuntu; see https://gvisor.dev/docs/user_guide/install/"
    apt-get update -qq && apt-get install -y -qq ca-certificates curl gnupg >/dev/null
    curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor --yes -o /usr/share/keyrings/gvisor-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
      >/etc/apt/sources.list.d/gvisor.list
    apt-get update -qq && apt-get install -y -qq runsc >/dev/null
  fi
  # Registers the runsc runtime in /etc/docker/daemon.json (systrap platform: no KVM required).
  runsc install
  systemctl restart docker
  docker info --format '{{json .Runtimes}}' | grep -q runsc || die "Docker does not list the runsc runtime"
  docker run --rm --runtime=runsc hello-world >/dev/null || die "A test container under gVisor failed"
  ok "gVisor ready"
  cat <<EOF

Add to deploy/.env.production:
  COMPUTER_BACKEND=docker
  COMPUTER_DOCKER_RUNTIME=runsc
  SAYABOT_APP_SERVICES="orchestrator web computerd egress"
Then run ./deploy/deploy.sh.
EOF
}

case "$MODE" in
  smolvm) install_smolvm ;;
  gvisor) install_gvisor ;;
  *) die "Unknown mode '$MODE' (use auto, smolvm or gvisor)" ;;
esac
