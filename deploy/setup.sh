#!/usr/bin/env bash
# VPS first-time setup script — run once on a fresh Hetzner Ubuntu server.
# Works with just an IP address. Add a domain later with: bash setup.sh --domain yourdomain.com
#
# Usage:
#   bash setup.sh                        # IP-only (HTTP on port 80)
#   bash setup.sh --domain example.com  # with domain (HTTPS via Let's Encrypt)
set -euo pipefail

DOMAIN=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain) DOMAIN="$2"; shift 2 ;;
        *) echo "Unknown argument: $1"; exit 1 ;;
    esac
done

APP_DIR="/opt/chartviewer"
REPO="https://github.com/oscarzqy/chartviewer.git"

echo "==> Installing Docker..."
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
apt-get update -q
apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin git
systemctl enable --now docker

echo "==> Cloning repository to $APP_DIR..."
git clone "$REPO" "$APP_DIR"
cd "$APP_DIR"

echo "==> Creating .env — fill in your secrets..."
cp .env.example .env
echo ""
echo "  Edit $APP_DIR/.env with your real credentials before continuing:"
echo "    ADMIN_USER, ADMIN_PASSWORD, JWT_SECRET_KEY"
echo ""
read -rp "Press Enter once .env is updated to continue..."

if [[ -n "$DOMAIN" ]]; then
    echo "==> Installing Caddy (HTTPS mode for $DOMAIN)..."
    apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -q
    apt-get install -y -q caddy

    echo "==> Starting app..."
    docker compose up -d --build

    sed "s/yourdomain.com/$DOMAIN/g" deploy/Caddyfile > /etc/caddy/Caddyfile
    systemctl reload caddy
    echo ""
    echo "Done! ChartViewer is live at https://$DOMAIN"
else
    echo "==> Installing Nginx (HTTP/IP mode)..."
    apt-get install -y -q nginx

    echo "==> Starting app..."
    docker compose up -d --build

    # Nginx proxies port 80 -> app on 8080
    cat > /etc/nginx/sites-available/chartviewer <<'EOF'
server {
    listen 80 default_server;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF
    ln -sf /etc/nginx/sites-available/chartviewer /etc/nginx/sites-enabled/chartviewer
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx

    VPS_IP=$(curl -s https://api.ipify.org)
    echo ""
    echo "Done! ChartViewer is live at http://$VPS_IP"
    echo ""
    echo "When you have a domain, run: bash $APP_DIR/deploy/setup-domain.sh yourdomain.com"
fi

echo "Use 'cd $APP_DIR && make logs' to watch logs."
