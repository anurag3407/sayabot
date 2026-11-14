#!/usr/bin/env bash
# Sayabot production deploys on a single VPS.
#
#   ./deploy/deploy.sh                 build the current checkout, migrate, roll out
#   ./deploy/deploy.sh --ref v1.4.0    check out a tag/branch/commit first (git fetch)
#   ./deploy/deploy.sh --pull          pull prebuilt images (SAYABOT_IMAGE_PREFIX registry) instead of building
#   ./deploy/deploy.sh rollback        return to the previous release's images
#   ./deploy/deploy.sh migrate         run database migrations only
#   ./deploy/deploy.sh seed            seed starter model prices
#   ./deploy/deploy.sh reload          apply .env.production edits (e.g. SAYA_AI_* models) without a build
#   ./deploy/deploy.sh status | logs [service] | restart [service] | down | releases
#
# A release = images tagged with the git short SHA. Rollouts are health-gated: if the
# new containers are not healthy (or https://SAYABOT_DOMAIN/api/health fails), the
# previous release is restored automatically. Migrations are forward-only, so keep
# them backwards compatible with the previous release (add columns, don't drop them).
set -Eeuo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
ENV_FILE="$DEPLOY_DIR/.env.production"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
RELEASES_FILE="$DEPLOY_DIR/.releases"
LOCK_FILE="$DEPLOY_DIR/.deploy.lock"

env_value() {
  (grep -E "^$1=" "$ENV_FILE" 2>/dev/null || true) | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

env_fallback() {
  local val
  val="$(env_value "$1")"
  if [[ -n "$val" ]]; then
    echo "$val"
  elif [[ $# -ge 2 ]]; then
    env_value "$2"
  fi
}

SERVICES_CONFIG="${SAYABOT_APP_SERVICES:-${MESH_APP_SERVICES:-$(env_fallback SAYABOT_APP_SERVICES MESH_APP_SERVICES)}}"
APP_SERVICES=(${SERVICES_CONFIG:-orchestrator web})
EDGE_SERVICES=(nginx certbot)
# Cloudflare Tunnel mode: no open ports, no certificate; cloudflared dials out to Cloudflare.
TUNNEL=0
[[ -n "$(env_value CLOUDFLARE_TUNNEL_TOKEN)" ]] && { TUNNEL=1; EDGE_SERVICES=(nginx cloudflared); }
HEALTH_TIMEOUT="${SAYABOT_HEALTH_TIMEOUT:-${MESH_HEALTH_TIMEOUT:-$(env_fallback SAYABOT_HEALTH_TIMEOUT MESH_HEALTH_TIMEOUT)}}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"

DOMAIN="${SAYABOT_DOMAIN:-${MESH_DOMAIN:-$(env_fallback SAYABOT_DOMAIN MESH_DOMAIN)}}"

c_blue=$'\033[1;34m'; c_yellow=$'\033[1;33m'; c_red=$'\033[1;31m'; c_green=$'\033[1;32m'; c_off=$'\033[0m'
log()  { printf '%s[deploy]%s %s\n' "$c_blue" "$c_off" "$*"; }
ok()   { printf '%s[deploy]%s %s\n' "$c_green" "$c_off" "$*"; }
warn() { printf '%s[deploy]%s %s\n' "$c_yellow" "$c_off" "$*" >&2; }
die()  { printf '%s[deploy]%s %s\n' "$c_red" "$c_off" "$*" >&2; exit 1; }

COMPOSE_ARGS=(-f "$COMPOSE_FILE")
# microVM computers (KVM hosts): computerd gets /dev/kvm and the host's smolvm install.
[[ "$(env_value COMPUTER_BACKEND)" == "smolvm" ]] && COMPOSE_ARGS+=(-f "$DEPLOY_DIR/docker-compose.smolvm.yml")
(( TUNNEL )) && COMPOSE_ARGS+=(-f "$DEPLOY_DIR/docker-compose.tunnel.yml")
compose() {
  local tag="${SAYABOT_TAG:-${MESH_TAG:-latest}}"
  SAYABOT_TAG="$tag" MESH_TAG="$tag" docker compose --env-file "$ENV_FILE" "${COMPOSE_ARGS[@]}" "$@"
}

# ── preflight ────────────────────────────────────────────────────────────
preflight() {
  command -v docker >/dev/null || die "Docker is not installed (run deploy/scripts/setup-vps.sh)."
  docker compose version >/dev/null 2>&1 || die "The Docker Compose plugin is missing."
  docker info >/dev/null 2>&1 || die "Cannot talk to Docker. Is your user in the docker group? (re-login after setup)"
  [[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE. Copy deploy/.env.production.example and fill it in."

  local perms
  perms="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE")"
  [[ "$perms" == "600" || "$perms" == "400" ]] || warn "$ENV_FILE is mode $perms; run: chmod 600 $ENV_FILE"

  local missing=()
  for key in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY \
             DATABASE_URL ORCHESTRATOR_INTERNAL_SECRET; do
    [[ -n "$(env_value "$key")" ]] || missing+=("$key")
  done

  DOMAIN="${SAYABOT_DOMAIN:-${MESH_DOMAIN:-$(env_fallback SAYABOT_DOMAIN MESH_DOMAIN)}}"
  [[ -n "$DOMAIN" ]] || missing+=(SAYABOT_DOMAIN)

  local kek
  kek="${SAYABOT_KEK:-${MESH_KEK:-$(env_fallback SAYABOT_KEK MESH_KEK)}}"
  [[ -n "$kek" ]] || missing+=(SAYABOT_KEK)

  ((${#missing[@]} == 0)) || die "Empty required values in $ENV_FILE: ${missing[*]}"

  [[ "$DOMAIN" != "sayabot.example.com" && "$DOMAIN" != "mesh.example.com" ]] || die "Set SAYABOT_DOMAIN to your real domain."
  [[ "$(env_value DATABASE_URL)" != *":6543/"* ]] || die "DATABASE_URL uses the transaction pooler (6543). Use the session pooler (5432)."
  (( $(env_value ORCHESTRATOR_INTERNAL_SECRET | wc -c) > 16 )) || die "ORCHESTRATOR_INTERNAL_SECRET must be at least 16 characters."

  for key in NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_COLLAB_URL ORCHESTRATOR_URL; do
    [[ -z "$(env_value "$key")" ]] || warn "$key is set in $ENV_FILE but is derived by docker-compose.yml; it will be overridden."
  done

  if (( TUNNEL )); then
    # docker-compose.tunnel.yml uses !reset / !override (Compose 2.24.4+).
    local cv; cv="$(docker compose version --short 2>/dev/null | sed 's/^v//')"
    [[ "$(printf '%s\n2.24.4\n' "$cv" | sort -V | head -n1)" == "2.24.4" ]] \
      || die "Cloudflare Tunnel mode needs Docker Compose 2.24.4 or newer (found $cv)."
  elif ! docker run --rm -v "$DEPLOY_DIR/certbot/conf:/etc/letsencrypt:ro" alpine:3.20 \
       test -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" >/dev/null 2>&1; then
    die "No TLS certificate for $DOMAIN yet. Run ./deploy/scripts/init-letsencrypt.sh first (or set CLOUDFLARE_TUNNEL_TOKEN)."
  fi

  local free_kb
  free_kb="$(df -Pk "$REPO_DIR" | awk 'NR==2 {print $4}')"
  (( free_kb > 4 * 1024 * 1024 )) || warn "Less than 4 GB free disk. Consider: docker system prune"
}

acquire_lock() {
  exec 9>"$LOCK_FILE"
  flock -n 9 || die "Another deploy is running (lock: $LOCK_FILE)."
}

# ── releases ─────────────────────────────────────────────────────────────
current_release() { [[ -f "$RELEASES_FILE" ]] && tail -n1 "$RELEASES_FILE" | awk '{print $1}' || true; }

record_release() {
  local tag="$1"
  local last
  last="$(current_release)"
  [[ "$last" == "$tag" ]] && return 0
  printf '%s %s %s\n' "$tag" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git -C "$REPO_DIR" log -1 --format=%s "$tag" 2>/dev/null | cut -c1-72)" >>"$RELEASES_FILE"
}

images_exist() {
  local prefix tag="$1"
  prefix="${SAYABOT_IMAGE_PREFIX:-${MESH_IMAGE_PREFIX:-$(env_fallback SAYABOT_IMAGE_PREFIX MESH_IMAGE_PREFIX)}}"
  prefix="${prefix:-sayabot}"
  for svc in "${APP_SERVICES[@]}"; do
    docker image inspect "$prefix/$svc:$tag" >/dev/null 2>&1 || return 1
  done
}

prune_old_images() {
  local keep prefix
  keep="${SAYABOT_KEEP_RELEASES:-${MESH_KEEP_RELEASES:-$(env_fallback SAYABOT_KEEP_RELEASES MESH_KEEP_RELEASES)}}"
  keep="${keep:-3}"
  prefix="${SAYABOT_IMAGE_PREFIX:-${MESH_IMAGE_PREFIX:-$(env_fallback SAYABOT_IMAGE_PREFIX MESH_IMAGE_PREFIX)}}"
  prefix="${prefix:-sayabot}"
  [[ -f "$RELEASES_FILE" ]] || return 0
  mapfile -t keep_tags < <(awk '{print $1}' "$RELEASES_FILE" | tail -n "$keep")
  for image in "${APP_SERVICES[@]}"; do
    docker image ls "$prefix/$image" --format '{{.Tag}}' | while read -r tag; do
      [[ "$tag" == "latest" || " ${keep_tags[*]} " == *" $tag "* ]] && continue
      docker image rm "$prefix/$image:$tag" >/dev/null 2>&1 || true
    done
  done
  docker container prune -f >/dev/null 2>&1 || true
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -f --filter "until=24h" --keep-storage 4GB >/dev/null 2>&1 || true
}

# ── health ───────────────────────────────────────────────────────────────
container_health() {
  local id
  id="$(compose ps -q "$1" 2>/dev/null | head -n1)"
  [[ -n "$id" ]] || { echo "missing"; return; }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id"
}

wait_healthy() {
  local deadline=$(( SECONDS + HEALTH_TIMEOUT ))
  local service status
  for service in "$@"; do
    while :; do
      status="$(container_health "$service")"
      [[ "$status" == "healthy" ]] && { log "$service is healthy"; break; }
      [[ "$status" == "unhealthy" || "$status" == "exited" || "$status" == "dead" ]] && {
        warn "$service is $status"; compose logs --tail 60 "$service" >&2 || true; return 1; }
      (( SECONDS < deadline )) || { warn "$service not healthy after ${HEALTH_TIMEOUT}s (status: $status)"; compose logs --tail 60 "$service" >&2 || true; return 1; }
      sleep 3
    done
  done
}

public_check() {
  local url="https://$DOMAIN/api/health"
  if (( TUNNEL )); then
    # nginx has no host port in tunnel mode: check it from inside, then through Cloudflare.
    local ready=0
    for _ in $(seq 1 10); do
      compose exec -T nginx curl -fsS --max-time 5 http://127.0.0.1:8080/api/health >/dev/null 2>&1 && { ready=1; break; }
      sleep 3
    done
    (( ready )) || { warn "nginx did not answer /api/health on :8080"; return 1; }
    ok "nginx :8080 responds"
    # Best effort: DNS, the tunnel's public hostname or a Cloudflare Access policy can lag or block it.
    if curl -fsS --max-time 10 "$url" >/dev/null 2>&1; then ok "$url responds through the tunnel"
    else warn "$url did not respond through Cloudflare yet. Check the tunnel's Public Hostname (→ http://nginx:8080) and that Access bypasses /api/health."; fi
    return 0
  fi
  for _ in $(seq 1 10); do
    # --resolve pins the request to this host, so the check does not depend on DNS/CDN.
    if curl -fsSk --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" "$url" >/dev/null 2>&1; then
      ok "$url responds"
      return 0
    fi
    sleep 3
  done
  warn "$url did not respond through nginx"
  return 1
}

# ── steps ────────────────────────────────────────────────────────────────
checkout() {
  local ref="$1"
  [[ -z "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]] || die "Working tree has local changes; commit or stash them first."
  log "Fetching and checking out $ref"
  git -C "$REPO_DIR" fetch --tags --prune origin
  if git -C "$REPO_DIR" show-ref --verify --quiet "refs/remotes/origin/$ref"; then
    git -C "$REPO_DIR" checkout -q -B "$ref" "origin/$ref"
  else
    git -C "$REPO_DIR" checkout -q --detach "$ref"
  fi
}

build_images() {
  log "Building images for $SAYABOT_TAG (first build takes several minutes)"
  DOCKER_BUILDKIT=1 compose build --pull "${APP_SERVICES[@]}"
  # Keep a moving `latest` so manual `docker compose` commands use the newest release.
  local prefix
  prefix="${SAYABOT_IMAGE_PREFIX:-${MESH_IMAGE_PREFIX:-$(env_fallback SAYABOT_IMAGE_PREFIX MESH_IMAGE_PREFIX)}}"
  prefix="${prefix:-sayabot}"
  for svc in "${APP_SERVICES[@]}"; do
    docker tag "$prefix/$svc:$SAYABOT_TAG" "$prefix/$svc:latest"
  done
  build_computer_image
}

pull_images() {
  log "Pulling images for $SAYABOT_TAG"
  compose pull "${APP_SERVICES[@]}"
  build_computer_image
}

# The per-agent computer image is started by computerd, not by compose, so compose
# never builds it. Without this step every computer fails with "No such image".
build_computer_image() {
  [[ " ${APP_SERVICES[*]} " == *" computerd "* ]] || return 0
  local tag; tag="$(env_value COMPUTE_IMAGE_TAG)"; tag="${tag:-latest}"
  log "Building computer image saaya/computer:$tag"
  DOCKER_BUILDKIT=1 docker build -q -f "$DEPLOY_DIR/docker/computer.Dockerfile" \
    -t "saaya/computer:$tag" "$REPO_DIR" >/dev/null || die "Building the computer image failed."
  if [[ "$(env_value COMPUTER_BACKEND)" == "smolvm" ]]; then
    # smolvm boots OCI images without a Docker daemon; hand it the same image as an archive.
    local dir="${SAAYA_STATE_DIR:-/var/lib/saaya}"
    mkdir -p "$dir" && docker save "saaya/computer:$tag" -o "$dir/computer-image.tar.tmp" \
      && mv "$dir/computer-image.tar.tmp" "$dir/computer-image.tar" || die "Exporting the computer image for smolvm failed."
  fi
}

run_migrations() {
  log "Running database migrations"
  local cid
  cid="sayabot-migrate-$(date +%s)"
  compose --profile tools run -T --no-deps --name "$cid" migrate || {
    docker rm -f "$cid" >/dev/null 2>&1 || true
    die "Migrations failed. Nothing was rolled out; the running release is untouched."
  }
  docker rm -f "$cid" >/dev/null 2>&1 || true
}

roll_out() {
  log "Starting orchestrator and web ($SAYABOT_TAG)"
  compose up -d --no-build --remove-orphans "${APP_SERVICES[@]}"
  wait_healthy "${APP_SERVICES[@]}" || return 1
  log "Starting nginx and certbot"
  compose up -d --no-build "${EDGE_SERVICES[@]}"
  # Switching to tunnel mode leaves the old certbot renewer running; it has nothing to do.
  (( TUNNEL )) && compose stop certbot >/dev/null 2>&1 || true
  # Pick up config edits even when the nginx container itself was not recreated.
  compose exec -T nginx nginx -t >/dev/null 2>&1 && compose exec -T nginx nginx -s reload >/dev/null 2>&1 || true
  public_check
}

rollback_to() {
  local tag="$1"
  [[ -n "$tag" ]] || die "No previous release recorded to roll back to."
  images_exist "$tag" || die "Images for release $tag are no longer on this host."
  warn "Rolling back to $tag"
  SAYABOT_TAG="$tag"
  MESH_TAG="$tag"
  export SAYABOT_TAG MESH_TAG
  compose up -d --no-build --remove-orphans "${APP_SERVICES[@]}"
  wait_healthy "${APP_SERVICES[@]}" && public_check && ok "Rolled back to $tag"
}

cmd_deploy() {
  local ref="" pull=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --ref) ref="$2"; shift 2 ;;
      --pull) pull=1; shift ;;
      --skip-migrations) SKIP_MIGRATIONS=1; shift ;;
      *) die "Unknown option: $1" ;;
    esac
  done
  preflight
  acquire_lock
  [[ -n "$ref" ]] && checkout "$ref"

  local previous
  previous="$(current_release)"
  SAYABOT_TAG="$(git -C "$REPO_DIR" rev-parse --short=12 HEAD)"
  MESH_TAG="$SAYABOT_TAG"
  export SAYABOT_TAG MESH_TAG
  log "Deploying $SAYABOT_TAG to $DOMAIN${previous:+ (current: $previous)}"

  if (( pull )); then pull_images; else build_images; fi
  [[ "${SKIP_MIGRATIONS:-0}" == "1" ]] || run_migrations

  if roll_out; then
    record_release "$SAYABOT_TAG"
    prune_old_images
    ok "Release $SAYABOT_TAG is live at https://$DOMAIN"
  else
    warn "Release $SAYABOT_TAG failed its health checks."
    if [[ -n "$previous" && "$previous" != "$SAYABOT_TAG" ]]; then
      rollback_to "$previous" || die "Rollback to $previous also failed. Check: ./deploy/deploy.sh logs"
      die "Deploy of $SAYABOT_TAG failed and was rolled back to $previous."
    fi
    die "Deploy failed and there is no previous release to fall back to. Check: ./deploy/deploy.sh logs"
  fi
}

cmd_rollback() {
  preflight
  acquire_lock
  local current target
  current="$(current_release)"
  target="${1:-}"
  if [[ -z "$target" ]]; then
    [[ -f "$RELEASES_FILE" ]] && (( $(wc -l <"$RELEASES_FILE") >= 2 )) || die "Need at least two recorded releases to roll back."
    target="$(tail -n2 "$RELEASES_FILE" | head -n1 | awk '{print $1}')"
  fi
  [[ "$target" != "$current" ]] || die "$target is already the current release."
  rollback_to "$target" || die "Rollback failed."
  record_release "$target"
}

usage() { sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

main() {
  local cmd="${1:-deploy}"
  [[ $# -gt 0 ]] && shift
  case "$cmd" in
    deploy|--ref|--pull|--skip-migrations)
      [[ "$cmd" == deploy ]] || set -- "$cmd" "$@"
      cmd_deploy "$@" ;;
    rollback) cmd_rollback "$@" ;;
    migrate)
      preflight
      SAYABOT_TAG="$(current_release)"
      SAYABOT_TAG="${SAYABOT_TAG:-latest}"
      MESH_TAG="$SAYABOT_TAG"
      export SAYABOT_TAG MESH_TAG
      run_migrations
      ok "Migrations applied" ;;
    seed)
      preflight
      SAYABOT_TAG="$(current_release)"
      SAYABOT_TAG="${SAYABOT_TAG:-latest}"
      MESH_TAG="$SAYABOT_TAG"
      export SAYABOT_TAG MESH_TAG
      compose --profile tools run --rm migrate node --import tsx src/seed.ts ;;
    status)
      SAYABOT_TAG="$(current_release)"
      MESH_TAG="$SAYABOT_TAG"
      export SAYABOT_TAG MESH_TAG
      compose ps
      echo; log "Current release: ${SAYABOT_TAG:-none}" ;;
    reload)
      # `restart` keeps the old environment; `up` recreates containers whose env_file changed.
      # Server-only values (SAYA_AI_*, keys, tokens) apply this way. NEXT_PUBLIC_* need a full deploy.
      preflight; acquire_lock
      SAYABOT_TAG="$(current_release)"
      [[ -n "$SAYABOT_TAG" ]] || die "No release deployed yet. Run ./deploy/deploy.sh first."
      MESH_TAG="$SAYABOT_TAG"
      export SAYABOT_TAG MESH_TAG
      log "Applying .env.production to ${APP_SERVICES[*]} ($SAYABOT_TAG)"
      compose up -d --no-build --force-recreate "${APP_SERVICES[@]}"
      wait_healthy "${APP_SERVICES[@]}" && public_check && ok "New settings are live" || die "Services are not healthy after reload. Check: ./deploy/deploy.sh logs" ;;
    logs)
      SAYABOT_TAG="$(current_release)"; MESH_TAG="$SAYABOT_TAG"; export SAYABOT_TAG MESH_TAG; compose logs -f --tail 200 "$@" ;;
    restart)
      SAYABOT_TAG="$(current_release)"; MESH_TAG="$SAYABOT_TAG"; export SAYABOT_TAG MESH_TAG; compose restart "$@" ;;
    down)
      SAYABOT_TAG="$(current_release)"; MESH_TAG="$SAYABOT_TAG"; export SAYABOT_TAG MESH_TAG; compose down ;;
    releases) [[ -f "$RELEASES_FILE" ]] && cat "$RELEASES_FILE" || echo "No releases yet." ;;
    -h|--help|help) usage ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
