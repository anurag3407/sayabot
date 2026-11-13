#!/usr/bin/env bash
# One-time hardening + Docker install for a fresh Ubuntu 22.04/24.04 or Debian 12 VPS.
#
#   scp deploy/scripts/setup-vps.sh root@VPS:/root/
#   ssh root@VPS 'bash /root/setup-vps.sh --user deploy --ssh-key "ssh-ed25519 AAAA... you@laptop"'
#
# Idempotent: safe to re-run. What it does:
#   • system updates + unattended security upgrades
#   • Docker Engine + Compose plugin from Docker's official apt repo, log rotation
#   • a non-root deploy user in the docker group, with your SSH key
#   • SSH hardening (keys only, no root password login) — only once a key is in place
#   • UFW firewall (22, 80, 443), fail2ban for sshd
#   • swap (Next.js builds need ~3 GB of memory), sane sysctls, UTC clock
set -Eeuo pipefail

DEPLOY_USER="deploy"
SSH_KEY=""
SSH_PORT="22"
SWAP_SIZE="4G"
HARDEN_SSH="yes"

usage() {
  cat <<EOF
Usage: $0 [--user NAME] [--ssh-key "PUBLIC KEY"] [--ssh-port N] [--swap SIZE|0] [--no-ssh-hardening]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) DEPLOY_USER="$2"; shift 2 ;;
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    --ssh-port) SSH_PORT="$2"; shift 2 ;;
    --swap) SWAP_SIZE="$2"; shift 2 ;;
    --no-ssh-hardening) HARDEN_SSH="no"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

log()  { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[setup]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[setup]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root (or with sudo)."
[[ -r /etc/os-release ]] || die "Cannot detect the OS."
. /etc/os-release
case "${ID}" in
  ubuntu|debian) ;;
  *) die "Supported: Ubuntu 22.04/24.04, Debian 12. Detected: ${PRETTY_NAME}" ;;
esac
export DEBIAN_FRONTEND=noninteractive

# ── packages ─────────────────────────────────────────────────────────────
log "Updating the system"
apt-get update -y
apt-get -o Dpkg::Options::="--force-confold" upgrade -y
apt-get install -y ca-certificates curl gnupg git ufw fail2ban unattended-upgrades \
  apt-listchanges jq htop chrony

log "Enabling unattended security upgrades"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
systemctl enable --now unattended-upgrades chrony >/dev/null
timedatectl set-timezone UTC || true

# ── docker ───────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker Engine"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  log "Docker already installed: $(docker --version)"
fi

log "Configuring the Docker daemon (log rotation, live restore)"
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true,
  "no-new-privileges": true
}
EOF
systemctl enable docker >/dev/null
systemctl restart docker

# ── deploy user ──────────────────────────────────────────────────────────
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  log "Creating user ${DEPLOY_USER}"
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
AUTH_KEYS="$DEPLOY_HOME/.ssh/authorized_keys"
touch "$AUTH_KEYS"
if [[ -n "$SSH_KEY" ]] && ! grep -qF "$SSH_KEY" "$AUTH_KEYS"; then
  echo "$SSH_KEY" >>"$AUTH_KEYS"
fi
# Reuse root's keys when none were given, so the user can log in right away.
if [[ ! -s "$AUTH_KEYS" && -s /root/.ssh/authorized_keys ]]; then
  cp /root/.ssh/authorized_keys "$AUTH_KEYS"
fi
chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTH_KEYS"
chmod 600 "$AUTH_KEYS"

# ── ssh hardening ────────────────────────────────────────────────────────
if [[ "$HARDEN_SSH" == "yes" ]]; then
  if [[ -s "$AUTH_KEYS" ]]; then
    log "Hardening SSH (key-only auth, no root password login, port ${SSH_PORT})"
    cat >/etc/ssh/sshd_config.d/99-sayabot-hardening.conf <<EOF
Port ${SSH_PORT}
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 4
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
    sshd -t || die "sshd config test failed; not reloading"
    # Open the (possibly new) port before sshd moves to it.
    ufw allow "${SSH_PORT}/tcp" comment "ssh" >/dev/null
    if systemctl is-active --quiet ssh.socket; then
      # Ubuntu 24.04 socket activation: the listening port comes from the socket unit.
      systemctl daemon-reload
      systemctl restart ssh.socket
    fi
    systemctl reload ssh 2>/dev/null || systemctl reload sshd
  else
    warn "No SSH key for ${DEPLOY_USER}; skipping SSH hardening so you are not locked out."
    warn "Re-run with --ssh-key \"ssh-ed25519 ...\" to enable it."
  fi
fi

# ── firewall ─────────────────────────────────────────────────────────────
# Docker publishes only nginx's 80/443; nothing else is reachable from outside.
log "Configuring UFW"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "${SSH_PORT}/tcp" comment "ssh" >/dev/null
ufw allow 80/tcp comment "http (ACME + redirect)" >/dev/null
ufw allow 443/tcp comment "https" >/dev/null
ufw --force enable >/dev/null

log "Configuring fail2ban for sshd"
cat >/etc/fail2ban/jail.d/sayabot.local <<EOF
[sshd]
enabled  = true
port     = ${SSH_PORT}
backend  = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
systemctl enable --now fail2ban >/dev/null
systemctl restart fail2ban

# ── swap + kernel ────────────────────────────────────────────────────────
if [[ "$SWAP_SIZE" != "0" ]] && ! swapon --show | grep -q .; then
  log "Creating ${SWAP_SIZE} swap file"
  fallocate -l "$SWAP_SIZE" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=$(( ${SWAP_SIZE%G} * 1024 ))
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

log "Applying sysctl tuning"
cat >/etc/sysctl.d/99-sayabot.conf <<'EOF'
vm.swappiness = 10
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.ip_local_port_range = 10240 65535
net.ipv4.tcp_syncookies = 1
fs.file-max = 1048576
EOF
sysctl --system >/dev/null

log "Done."
cat <<EOF

Next steps (as ${DEPLOY_USER}):
  ssh -p ${SSH_PORT} ${DEPLOY_USER}@<this-server>
  git clone <your repo> ~/sayabot && cd ~/sayabot
  cp deploy/.env.production.example deploy/.env.production && chmod 600 deploy/.env.production
  \$EDITOR deploy/.env.production
  ./deploy/scripts/init-letsencrypt.sh
  ./deploy/deploy.sh

EOF
