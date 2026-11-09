#!/usr/bin/env bash
# Issues the first Let's Encrypt certificate for MESH_DOMAIN. Run once per server,
# before the first deploy (renewal is automatic afterwards via the certbot service).
#
#   ./deploy/scripts/init-letsencrypt.sh            # real certificate
#   ./deploy/scripts/init-letsencrypt.sh --staging  # test against LE staging (no rate limits)
#   ./deploy/scripts/init-letsencrypt.sh --force    # replace an existing certificate
set -Eeuo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$DEPLOY_DIR/.env.production"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$DEPLOY_DIR/docker-compose.yml")

STAGING=0
FORCE=0
SKIP_DNS_CHECK=0
for arg in "$@"; do
  case "$arg" in
    --staging) STAGING=1 ;;
    --force) FORCE=1 ;;
    --skip-dns-check) SKIP_DNS_CHECK=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

log() { printf '\033[1;34m[tls]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[tls]\033[0m %s\n' "$*" >&2; exit 1; }

[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE (copy .env.production.example first)."
env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
DOMAIN="$(env_value MESH_DOMAIN)"
EMAIL="$(env_value LETSENCRYPT_EMAIL)"
[[ -n "$DOMAIN" && "$DOMAIN" != "mesh.example.com" ]] || die "Set MESH_DOMAIN in $ENV_FILE."
[[ -n "$EMAIL" && "$EMAIL" != "ops@example.com" ]] || die "Set LETSENCRYPT_EMAIL in $ENV_FILE."

mkdir -p "$DEPLOY_DIR/certbot/conf" "$DEPLOY_DIR/certbot/www"
# Certbot writes root-owned 0700 directories, so inspect and edit them from a container.
in_certs() { docker run --rm -v "$DEPLOY_DIR/certbot/conf:/etc/letsencrypt" alpine:3.20 sh -c "$1"; }

if in_certs "test -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem" && [[ $FORCE -eq 0 ]]; then
  log "A certificate for $DOMAIN already exists. Use --force to replace it."
  exit 0
fi

# DNS sanity check: Let's Encrypt must reach this machine on port 80.
PUBLIC_IP="$(curl -fsS4 --max-time 5 https://api.ipify.org || true)"
DNS_IPS="$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u | tr '\n' ' ' || true)"
if [[ -n "$PUBLIC_IP" && -n "$DNS_IPS" && " $DNS_IPS " != *" $PUBLIC_IP "* ]]; then
  if [[ $SKIP_DNS_CHECK -eq 1 ]]; then
    log "$DOMAIN resolves to [$DNS_IPS] while server is $PUBLIC_IP (Cloudflare proxy or CDN detected). Continuing with --skip-dns-check..."
  else
    die "$DOMAIN resolves to [$DNS_IPS] but this server is $PUBLIC_IP. Fix the DNS A record, set Cloudflare to DNS-only during certificate issuance, or pass --skip-dns-check."
  fi
fi
[[ -n "$DNS_IPS" ]] || die "$DOMAIN does not resolve yet. Create the DNS A record first."

# Free port 80 for certbot's standalone challenge server.
"${COMPOSE[@]}" stop nginx >/dev/null 2>&1 || true

if [[ $FORCE -eq 1 ]]; then
  in_certs "rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf"
fi

STAGING_FLAG=()
[[ $STAGING -eq 1 ]] && STAGING_FLAG=(--staging)

log "Requesting a certificate for $DOMAIN"
"${COMPOSE[@]}" run --rm --no-deps -p 80:80 --entrypoint certbot certbot \
  certonly --standalone --non-interactive --agree-tos --no-eff-email \
  --email "$EMAIL" -d "$DOMAIN" \
  --key-type ecdsa --elliptic-curve secp384r1 \
  "${STAGING_FLAG[@]}"

# Switch future renewals to the webroot served by nginx, so they need no downtime.
in_certs "
  f=/etc/letsencrypt/renewal/$DOMAIN.conf
  [ -f \$f ] || exit 0
  sed -i 's/^authenticator = standalone/authenticator = webroot/' \$f
  grep -q '^webroot_path' \$f || sed -i '/^\[renewalparams\]/a webroot_path = /var/www/certbot,' \$f
"

log "Certificate ready at certbot/conf/live/$DOMAIN"
[[ $STAGING -eq 1 ]] && log "This is a STAGING certificate (browsers will warn). Re-run without --staging, with --force."
log "Next: ./deploy/deploy.sh"
