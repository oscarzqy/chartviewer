#!/usr/bin/env bash
# Run this on the VPS when you get a domain to upgrade from HTTP to HTTPS.
# DNS must already point to this server before running.
#
# Usage: bash setup-domain.sh yourdomain.com
set -euo pipefail

DOMAIN="${1:?Usage: bash setup-domain.sh <yourdomain.com>}"
APP_DIR="/opt/chartviewer"

echo "==> Installing Caddy..."
apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -q
apt-get install -y -q caddy

echo "==> Stopping Nginx (Caddy takes over port 80/443)..."
systemctl stop nginx
systemctl disable nginx

echo "==> Configuring Caddy for $DOMAIN..."
sed "s/yourdomain.com/$DOMAIN/g" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable --now caddy

echo ""
echo "Done! ChartViewer is now live at https://$DOMAIN"
echo "TLS certificate will be provisioned automatically by Let's Encrypt."
