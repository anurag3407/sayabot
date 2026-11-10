#!/usr/bin/env bash
# Mesh production deploys on a single VPS.
#
#   ./deploy/deploy.sh                 build the current checkout, migrate, roll out
#   ./deploy/deploy.sh --ref v1.4.0    check out a tag/branch/commit first (git fetch)
#   ./deploy/deploy.sh --pull          pull prebuilt images (MESH_IMAGE_PREFIX registry) instead of building
#   ./deploy/deploy.sh rollback        return to the previous release's images
#   ./deploy/deploy.sh migrate         run database migrations only
#   ./deploy/deploy.sh seed            seed starter model prices
#   ./deploy/deploy.sh status | logs [service] | restart [service] | down | releases
#
# A release = images tagged with the git short SHA. Rollouts are health-gated: if the
# new containers are not healthy (or https://MESH_DOMAIN/api/health fails), the
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

SERVICES_CONFIG="$(env_value MESH_APP_SERVICES)"
APP_SERVICES=(${SERVICES_CONFIG:-orchestrator web})
EDGE_SERVICES=(nginx certbot)
HEALTH_TIMEOUT="${MESH_HEALTH_TIMEOUT:-180}"

c_blue=$'\033[1;34m'; c_yellow=$'\033[1;33m'; c_red=$'\033[1;31m'; c_green=$'\033[1;32m'; c_off=$'\033[0m'
log()  { printf '%s[deploy]%s %s\n' "$c_blue" "$c_off" "$*"; }
ok()   { printf '%s[deploy]%s %s\n' "$c_green" "$c_off" "$*"; }
warn() { printf '%s[deploy]%s %s\n' "$c_yellow" "$c_off" "$*" >&2; }
die()  { printf '%s[deploy]%s %s\n' "$c_red" "$c_off" "$*" >&2; exit 1; }

compose() { MESH_TAG="${MESH_TAG:-latest}" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

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
  for key in MESH_DOMAIN NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY \
             DATABASE_URL MESH_KEK ORCHESTRATOR_INTERNAL_SECRET; do
    [[ -n "$(env_value "$key")" ]] || missing+=("$key")
  done
  ((${#missing[@]} == 0)) || die "Empty required values in $ENV_FILE: ${missing[*]}"

  DOMAIN="$(env_value MESH_DOMAIN)"
  [[ "$DOMAIN" != "mesh.example.com" ]] || die "Set MESH_DOMAIN to your real domain."
  [[ "$(env_value DATABASE_URL)" != *":6543/"* ]] || die "DATABASE_URL uses the transaction pooler (6543). Use the session pooler (5432)."
  (( $(env_value ORCHESTRATOR_INTERNAL_SECRET | wc -c) > 16 )) || die "ORCHESTRATOR_INTERNAL_SECRET must be at least 16 characters."

  for key in NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_COLLAB_URL ORCHESTRATOR_URL; do
    [[ -z "$(env_value "$key")" ]] || warn "$key is set in $ENV_FILE but is derived by docker-compose.yml; it will be overridden."
  done

  if ! docker run --rm -v "$DEPLOY_DIR/certbot/conf:/etc/letsencrypt:ro" alpine:3.20 \
       test -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" >/dev/null 2>&1; then
    die "No TLS certificate for $DOMAIN yet. Run ./deploy/scripts/init-letsencrypt.sh first."
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
  prefix="$(env_value MESH_IMAGE_PREFIX)"; prefix="${prefix:-mesh}"
  for svc in "${APP_SERVICES[@]}"; do
    docker image inspect "$prefix/$svc:$tag" >/dev/null 2>&1 || return 1
  done
}

prune_old_images() {
  local keep prefix
  keep="$(env_value MESH_KEEP_RELEASES)"; keep="${keep:-3}"
  prefix="$(env_value MESH_IMAGE_PREFIX)"; prefix="${prefix:-mesh}"
  [[ -f "$RELEASES_FILE" ]] || return 0
  mapfile -t keep_tags < <(awk '{print $1}' "$RELEASES_FILE" | tail -n "$keep")
  for image in "${APP_SERVICES[@]}"; do
    docker image ls "$prefix/$image" --format '{{.Tag}}' | while read -r tag; do
      [[ "$tag" == "latest" || " ${keep_tags[*]} " == *" $tag "* ]] && continue
      docker image rm "$prefix/$image:$tag" >/dev/null 2>&1 || true
    done
  done
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -f --filter "until=168h" >/dev/null 2>&1 || true
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
  log "Building images for $MESH_TAG (first build takes several minutes)"
  DOCKER_BUILDKIT=1 compose build --pull "${APP_SERVICES[@]}"
  # Keep a moving `latest` so manual `docker compose` commands use the newest release.
  local prefix; prefix="$(env_value MESH_IMAGE_PREFIX)"; prefix="${prefix:-mesh}"
  for svc in "${APP_SERVICES[@]}"; do
    docker tag "$prefix/$svc:$MESH_TAG" "$prefix/$svc:latest"
  done
}

pull_images() {
  log "Pulling images for $MESH_TAG"
  compose pull "${APP_SERVICES[@]}"
}

run_migrations() {
  log "Running database migrations"
  compose --profile tools run --rm migrate || die "Migrations failed. Nothing was rolled out; the running release is untouched."
}

roll_out() {
  log "Starting orchestrator and web ($MESH_TAG)"
  compose up -d --no-build --remove-orphans "${APP_SERVICES[@]}"
  wait_healthy "${APP_SERVICES[@]}" || return 1
  log "Starting nginx and certbot"
  compose up -d --no-build "${EDGE_SERVICES[@]}"
  # Pick up config edits even when the nginx container itself was not recreated.
  compose exec -T nginx nginx -t >/dev/null 2>&1 && compose exec -T nginx nginx -s reload >/dev/null 2>&1 || true
  public_check
}

rollback_to() {
  local tag="$1"
  [[ -n "$tag" ]] || die "No previous release recorded to roll back to."
  images_exist "$tag" || die "Images for release $tag are no longer on this host."
  warn "Rolling back to $tag"
  MESH_TAG="$tag"
  export MESH_TAG
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
  MESH_TAG="$(git -C "$REPO_DIR" rev-parse --short=12 HEAD)"
  export MESH_TAG
  log "Deploying $MESH_TAG to $DOMAIN${previous:+ (current: $previous)}"

  if (( pull )); then pull_images; else build_images; fi
  [[ "${SKIP_MIGRATIONS:-0}" == "1" ]] || run_migrations

  if roll_out; then
    record_release "$MESH_TAG"
    prune_old_images
    ok "Release $MESH_TAG is live at https://$DOMAIN"
  else
    warn "Release $MESH_TAG failed its health checks."
    if [[ -n "$previous" && "$previous" != "$MESH_TAG" ]]; then
      rollback_to "$previous" || die "Rollback to $previous also failed. Check: ./deploy/deploy.sh logs"
      die "Deploy of $MESH_TAG failed and was rolled back to $previous."
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

usage() { sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

main() {
  local cmd="${1:-deploy}"
  [[ $# -gt 0 ]] && shift
  case "$cmd" in
    deploy|--ref|--pull|--skip-migrations)
      [[ "$cmd" == deploy ]] || set -- "$cmd" "$@"
      cmd_deploy "$@" ;;
    rollback) cmd_rollback "$@" ;;
    migrate) preflight; MESH_TAG="$(current_release)"; MESH_TAG="${MESH_TAG:-latest}"; export MESH_TAG; run_migrations; ok "Migrations applied" ;;
    seed)
      preflight; MESH_TAG="$(current_release)"; MESH_TAG="${MESH_TAG:-latest}"; export MESH_TAG
      compose --profile tools run --rm migrate node --import tsx src/seed.ts ;;
    status)
      MESH_TAG="$(current_release)"; export MESH_TAG
      compose ps
      echo; log "Current release: ${MESH_TAG:-none}" ;;
    logs) MESH_TAG="$(current_release)"; export MESH_TAG; compose logs -f --tail 200 "$@" ;;
    restart) MESH_TAG="$(current_release)"; export MESH_TAG; compose restart "$@" ;;
    down) MESH_TAG="$(current_release)"; export MESH_TAG; compose down ;;
    releases) [[ -f "$RELEASES_FILE" ]] && cat "$RELEASES_FILE" || echo "No releases yet." ;;
    -h|--help|help) usage ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
