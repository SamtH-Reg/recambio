#!/bin/bash
# PocketBase deployment script for Oracle Cloud Always Free
# Run this on a fresh Ubuntu/Debian ARM instance

set -e

PB_VERSION="0.39.11"
PB_DIR="/opt/pocketbase"
PB_DATA="$PB_DIR/pb_data"
PB_BACKUPS="$PB_DIR/backups"

echo "=== PocketBase Installer for Oracle Cloud Free ==="

# Install dependencies
sudo apt-get update -qq
sudo apt-get install -y -qq wget unzip curl

# Create directories
sudo mkdir -p "$PB_DIR" "$PB_DATA" "$PB_BACKUPS"
sudo chown -R $(whoami) "$PB_DIR"

# Download PocketBase
cd /tmp
wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_arm64.zip" -O pocketbase.zip
unzip -o pocketbase.zip
mv pocketbase "$PB_DIR/pocketbase"
chmod +x "$PB_DIR/pocketbase"

# Create systemd service
sudo tee /etc/systemd/system/pocketbase.service > /dev/null <<EOF
[Unit]
Description=PocketBase
After=network.target

[Service]
Type=simple
WorkingDirectory=$PB_DIR
ExecStart=$PB_DIR/pocketbase serve --http=0.0.0.0:8090 --dir=$PB_DATA --backupsDir=$PB_BACKUPS
Restart=always
RestartSec=5
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable pocketbase
sudo systemctl start pocketbase

echo ""
echo "=== PocketBase installed! ==="
echo "Admin UI: http://YOUR_SERVER_IP:8090/_/"
echo "API:      http://YOUR_SERVER_IP:8090/api/"
echo ""
echo "Create superuser:"
echo "  sudo $PB_DIR/pocketbase superuser create YOUR_EMAIL YOUR_PASSWORD --dir=$PB_DATA"
echo ""
echo "Or use the admin UI on first visit to set up."
