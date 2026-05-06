#!/bin/bash
# deploy.sh — Run this script on the Nginx server after uploading the package.
# Usage: sudo bash deploy.sh

set -e

APP_DIR="/var/www/devops-assistant"
SERVICE="devops-assistant"

echo "==> Creating app directory..."
mkdir -p "$APP_DIR"

echo "==> Copying frontend build..."
cp -r build/. "$APP_DIR/"

echo "==> Copying Node.js backend..."
cp -r server "$APP_DIR/server"
cp package.json "$APP_DIR/package.json"
cp package-lock.json "$APP_DIR/package-lock.json"

echo "==> Installing production dependencies..."
cd "$APP_DIR"
npm install --omit=dev

echo "==> Installing systemd service..."
cp /tmp/devops-assistant.service /etc/systemd/system/devops-assistant.service
systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"

echo "==> Installing Nginx config..."
cp /tmp/nginx.conf /etc/nginx/sites-available/devops-assistant
ln -sf /etc/nginx/sites-available/devops-assistant /etc/nginx/sites-enabled/devops-assistant
rm -f /etc/nginx/sites-enabled/default

echo "==> Testing and reloading Nginx..."
nginx -t && systemctl reload nginx

echo ""
echo "✅  Deployment complete."
echo "    Frontend : http://$(hostname -I | awk '{print $1}')/"
echo "    API health: http://$(hostname -I | awk '{print $1}')/api/health"
echo ""
echo "    View logs: journalctl -u $SERVICE -f"
