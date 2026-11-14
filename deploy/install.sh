#!/usr/bin/env bash
# Sayabot setup for your own server. Asks a few questions, generates every secret, writes
# deploy/.env.production and (if you like) starts Sayabot.
#
#   ./deploy/install.sh                  interactive
#   ./deploy/install.sh --yes \
#     --domain sayabot.example.com --email you@example.com [--name "Acme's Sayabot"] \
#     [--tunnel-token TOKEN] [--supabase-url URL --supabase-anon-key KEY \
#      --supabase-service-key KEY --database-url URL]
#
# Without --supabase-*, Supabase runs on this server too (fully self-hosted, the default).
# Re-running keeps your existing secrets (above all SAYABOT_KEK: losing it makes every saved
# key unreadable); it only fills in what's missing.
set -Eeuo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$DEPLOY_DIR/.env.production"

c_blue=$'\033[1;34m'; c_green=$'\033[1;32m'; c_yellow=$'\033[1;33m'; c_red=$'\033[1;31m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s%s%s\n' "$c_blue" "$*" "$c_off"; }
ok()   { printf '%s✓%s %s\n' "$c_green" "$c_off" "$*"; }
warn() { printf '%s!%s %s\n' "$c_yellow" "$c_off" "$*" >&2; }
die()  { printf '%s✗%s %s\n' "$c_red" "$c_off" "$*" >&2; exit 1; }

YES=0
DOMAIN="" EMAIL="" NAME="" TUNNEL_TOKEN=""
SB_URL="" SB_ANON="" SB_SERVICE="" DB_URL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) YES=1; shift ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --tunnel-token) TUNNEL_TOKEN="$2"; shift 2 ;;
    --supabase-url) SB_URL="$2"; shift 2 ;;
    --supabase-anon-key) SB_ANON="$2"; shift 2 ;;
    --supabase-service-key) SB_SERVICE="$2"; shift 2 ;;
    --database-url) DB_URL="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done

# ── helpers ──────────────────────────────────────────────────────────────
command -v openssl >/dev/null || die "openssl is needed to generate secrets (apt install openssl)."

ask() { # ask VAR "Question" "default"
  local var="$1" question="$2" default="${3:-}" answer
  if (( YES )); then printf -v "$var" '%s' "${!var:-$default}"; return; fi
  if [[ -n "$default" ]]; then read -r -p "  $question [$default]: " answer; else read -r -p "  $question: " answer; fi
  printf -v "$var" '%s' "${answer:-$default}"
}
ask_secret() { # ask_secret VAR "Question"
  local var="$1" question="$2" answer
  if (( YES )); then return; fi
  read -r -s -p "  $question: " answer; echo
  printf -v "$var" '%s' "$answer"
}
confirm() { # confirm "Question" default(y/n)
  local answer default="${2:-y}"
  if (( YES )); then [[ "$default" == y ]]; return; fi
  read -r -p "  $1 [$( [[ $default == y ]] && echo Y/n || echo y/N )]: " answer
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy] ]]
}

current() { [[ -f "$ENV_FILE" ]] && grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
rand_b64() { openssl rand -base64 "$1" | tr -d '\n'; }
rand_hex() { openssl rand -hex "$1"; }
rand_alnum() { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

# A Supabase API key: an HS256 JWT for `role`, signed with the JWT secret, valid ten years.
supabase_jwt() {
  local role="$1" secret="$2" now exp header payload signature
  now=$(date +%s); exp=$(( now + 10 * 365 * 24 * 3600 ))
  header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  payload=$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$role" "$now" "$exp" | b64url)
  signature=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$secret" -binary | b64url)
  printf '%s.%s.%s' "$header" "$payload" "$signature"
}

valid_domain() { [[ "$1" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]]; }
valid_email() { [[ "$1" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; }

# ── welcome ──────────────────────────────────────────────────────────────
say ""
say "${c_green}Sayabot setup${c_off}"
say "This sets up Sayabot on this server. It takes a few minutes; you can re-run it any time."

if [[ -f "$ENV_FILE" ]]; then
  ok "Found your existing settings ($ENV_FILE). Your secrets are kept; only missing values are added."
fi

# ── 1. address ───────────────────────────────────────────────────────────
step "1. Your address"
say "  The domain people will open Sayabot at, e.g. sayabot.yourcompany.com."
DOMAIN="${DOMAIN:-$(current SAYABOT_DOMAIN)}"
[[ "$DOMAIN" == "sayabot.example.com" ]] && DOMAIN=""
while :; do
  ask DOMAIN "Domain" "$DOMAIN"
  valid_domain "$DOMAIN" && break
  (( YES )) && die "--domain must be a domain name like sayabot.example.com"
  warn "That doesn't look like a domain (example: sayabot.yourcompany.com)."
  DOMAIN=""
done
NAME="${NAME:-$(current SAYABOT_INSTANCE_NAME)}"
ask NAME "Name shown in the apps" "${NAME:-Sayabot}"

# ── 2. HTTPS ─────────────────────────────────────────────────────────────
step "2. HTTPS"
TUNNEL_TOKEN="${TUNNEL_TOKEN:-$(current CLOUDFLARE_TUNNEL_TOKEN)}"
if [[ -z "$TUNNEL_TOKEN" ]] && ! (( YES )); then
  say "  a) Free certificate from Let's Encrypt (the domain's DNS must point at this server)"
  say "  b) Cloudflare Tunnel (no open ports; paste a tunnel token)"
  read -r -p "  Choose [a]: " https_choice
  if [[ "${https_choice:-a}" =~ ^[Bb] ]]; then ask_secret TUNNEL_TOKEN "Cloudflare Tunnel token"; fi
fi
if [[ -z "$TUNNEL_TOKEN" ]]; then
  EMAIL="${EMAIL:-$(current LETSENCRYPT_EMAIL)}"
  while :; do
    ask EMAIL "Email for certificate notices" "$EMAIL"
    valid_email "$EMAIL" && break
    (( YES )) && die "--email must be an email address"
    warn "Enter an email address."
    EMAIL=""
  done
  # DNS check, without calling any outside service.
  if command -v getent >/dev/null; then
    resolved=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')
    local_ips=$(hostname -I 2>/dev/null || true)
    if [[ -z "$resolved" ]]; then
      warn "$DOMAIN doesn't resolve yet. Add an A record pointing at this server before starting."
    elif [[ -n "$local_ips" ]] && ! grep -qw -F -f <(tr ' ' '\n' <<<"$resolved" | sed '/^$/d') <<<"$local_ips"; then
      say "  ${c_dim}$DOMAIN points at $resolved; this server has $local_ips. Fine if a firewall or NAT forwards to it.${c_off}"
    else
      ok "$DOMAIN points at this server."
    fi
  fi
else
  ok "Using Cloudflare Tunnel (no certificate needed)."
fi

# ── 3. database & sign-in ────────────────────────────────────────────────
step "3. Database and sign-in"
mode="$(current SAYABOT_SUPABASE)"
if [[ -n "$SB_URL" ]]; then
  mode="hosted"
elif [[ -z "$mode" ]]; then
  existing_url="$(current NEXT_PUBLIC_SUPABASE_URL)"
  if [[ -n "$existing_url" && "$existing_url" != *"your-project"* && "$existing_url" != "https://$DOMAIN" ]]; then
    mode="hosted"
  elif (( YES )); then
    mode="bundled"
  else
    say "  a) Everything on this server (recommended): nothing leaves your server"
    say "  b) My own Supabase project (supabase.com): paste its keys"
    read -r -p "  Choose [a]: " db_choice
    [[ "${db_choice:-a}" =~ ^[Bb] ]] && mode="hosted" || mode="bundled"
  fi
fi

if [[ "$mode" == "hosted" ]]; then
  say "  From your Supabase project: Project Settings → API, and Database → Connection string (Session pooler, port 5432)."
  SB_URL="${SB_URL:-$(current NEXT_PUBLIC_SUPABASE_URL)}"
  SB_ANON="${SB_ANON:-$(current NEXT_PUBLIC_SUPABASE_ANON_KEY)}"
  SB_SERVICE="${SB_SERVICE:-$(current SUPABASE_SERVICE_ROLE_KEY)}"
  DB_URL="${DB_URL:-$(current DATABASE_URL)}"
  [[ -n "$SB_URL" ]] || ask SB_URL "Project URL (https://….supabase.co)"
  [[ -n "$SB_ANON" ]] || ask_secret SB_ANON "anon public key"
  [[ -n "$SB_SERVICE" ]] || ask_secret SB_SERVICE "service_role key"
  [[ -n "$DB_URL" ]] || ask_secret DB_URL "Database connection string (port 5432)"
  [[ "$SB_URL" =~ ^https:// ]] || die "The project URL must start with https://"
  [[ -n "$SB_ANON" && -n "$SB_SERVICE" && -n "$DB_URL" ]] || die "All four Supabase values are needed."
  [[ "$DB_URL" != *":6543/"* ]] || die "Use the Session pooler (port 5432), not the Transaction pooler (6543)."
  ok "Using your Supabase project."
  say "  ${c_dim}In Supabase → Authentication → Sign In / Providers, turn on \"Allow anonymous sign-ins\" for the Mac app's no-account start.${c_off}"
else
  POSTGRES_PASSWORD="$(current POSTGRES_PASSWORD)"; POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(rand_alnum 40)}"
  JWT_SECRET="$(current JWT_SECRET)"; JWT_SECRET="${JWT_SECRET:-$(rand_alnum 48)}"
  ANON_KEY="$(current ANON_KEY)"; ANON_KEY="${ANON_KEY:-$(supabase_jwt anon "$JWT_SECRET")}"
  SERVICE_ROLE_KEY="$(current SERVICE_ROLE_KEY)"; SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-$(supabase_jwt service_role "$JWT_SECRET")}"
  SECRET_KEY_BASE="$(current SECRET_KEY_BASE)"; SECRET_KEY_BASE="${SECRET_KEY_BASE:-$(rand_alnum 64)}"
  REALTIME_DB_ENC_KEY="$(current REALTIME_DB_ENC_KEY)"; REALTIME_DB_ENC_KEY="${REALTIME_DB_ENC_KEY:-$(rand_hex 8)}"
  SB_URL="https://$DOMAIN"
  SB_ANON="$ANON_KEY"
  SB_SERVICE="$SERVICE_ROLE_KEY"
  DB_URL="postgresql://postgres:${POSTGRES_PASSWORD}@supabase-db:5432/postgres"
  ok "Supabase will run on this server (database, sign-in, live updates, file storage)."
fi

# ── 4. secrets ───────────────────────────────────────────────────────────
step "4. Secrets"
KEK="$(current SAYABOT_KEK)"; KEK="${KEK:-$(current MESH_KEK)}"
if [[ -n "$KEK" ]]; then ok "Keeping your encryption key."; else KEK="$(rand_b64 32)"; ok "Generated an encryption key for saved API keys and tokens."; fi
INTERNAL="$(current ORCHESTRATOR_INTERNAL_SECRET)"; INTERNAL="${INTERNAL:-$(rand_hex 32)}"

# ── write .env.production ────────────────────────────────────────────────
umask 077
tmp="$(mktemp "$DEPLOY_DIR/.env.production.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
{
  echo "# Written by deploy/install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Re-run it to change answers."
  echo "# Keep a copy somewhere safe: losing SAYABOT_KEK makes every saved key unreadable."
  echo
  echo "SAYABOT_DOMAIN=$DOMAIN"
  echo "SAYABOT_INSTANCE_NAME=\"$NAME\""
  echo "SAYABOT_EDITION=self-hosted"
  echo "LETSENCRYPT_EMAIL=$EMAIL"
  echo "CLOUDFLARE_TUNNEL_TOKEN=$TUNNEL_TOKEN"
  echo
  echo "SAYABOT_SUPABASE=$mode"
  echo "NEXT_PUBLIC_SUPABASE_URL=$SB_URL"
  echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$SB_ANON"
  echo "SUPABASE_SERVICE_ROLE_KEY=$SB_SERVICE"
  echo "DATABASE_URL=$DB_URL"
  if [[ "$mode" == "bundled" ]]; then
    echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
    echo "JWT_SECRET=$JWT_SECRET"
    echo "ANON_KEY=$ANON_KEY"
    echo "SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY"
    echo "SECRET_KEY_BASE=$SECRET_KEY_BASE"
    echo "REALTIME_DB_ENC_KEY=$REALTIME_DB_ENC_KEY"
  fi
  echo
  echo "SAYABOT_KEK=$KEK"
  echo "ORCHESTRATOR_INTERNAL_SECRET=$INTERNAL"
  # Everything else you had (AI models, OAuth apps, push keys…) is carried over unchanged.
  if [[ -f "$ENV_FILE" ]]; then
    echo
    echo "# ── carried over from your previous settings ──"
    managed='^(SAYABOT_DOMAIN|SAYABOT_INSTANCE_NAME|SAYABOT_EDITION|LETSENCRYPT_EMAIL|CLOUDFLARE_TUNNEL_TOKEN|SAYABOT_SUPABASE|NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|POSTGRES_PASSWORD|JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY|SECRET_KEY_BASE|REALTIME_DB_ENC_KEY|SAYABOT_KEK|MESH_KEK|ORCHESTRATOR_INTERNAL_SECRET)='
    grep -E '^[A-Z0-9_]+=' "$ENV_FILE" | grep -Ev "$managed" || true
  fi
} >"$tmp"
if [[ -f "$ENV_FILE" ]]; then cp -p "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)"; fi
mv "$tmp" "$ENV_FILE"
trap - EXIT
chmod 600 "$ENV_FILE"
ok "Saved settings to $ENV_FILE (readable only by you)."

# ── 5. start ─────────────────────────────────────────────────────────────
step "5. Start Sayabot"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  warn "Docker isn't installed yet. As root, run: bash deploy/scripts/setup-vps.sh --user \$USER"
  say "  Then run this again, or start with: ./deploy/deploy.sh"
  exit 0
fi

if confirm "Start Sayabot now? (the first build takes about 10 minutes)" y; then
  if [[ -z "$TUNNEL_TOKEN" ]]; then
    "$DEPLOY_DIR/scripts/init-letsencrypt.sh" || die "Couldn't get a certificate. Check that $DOMAIN points at this server, then run this again."
  fi
  "$DEPLOY_DIR/deploy.sh"
  say ""
  ok "Sayabot is running at https://$DOMAIN"
  say ""
  say "  Next:"
  say "  • Open https://$DOMAIN and create your account (the first workspace is yours)."
  say "  • Mac and phone: https://$DOMAIN/download → \"Open in Sayabot\", or choose \"My own server\" in the app."
  [[ "$mode" == "bundled" ]] && say "  • Back up regularly: ./deploy/deploy.sh backup (and keep $ENV_FILE safe)."
else
  say "  When you're ready: ${c_dim}./deploy/scripts/init-letsencrypt.sh && ./deploy/deploy.sh${c_off}"
fi
