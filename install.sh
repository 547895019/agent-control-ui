#!/usr/bin/env bash
# OpenClaw Agent Control UI — one-click installer
# Usage:
#   ./install.sh              # default port 8080
#   PORT=3000 ./install.sh    # custom port

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[openclaw-ui]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[error]${NC} $*"; exit 1; }

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="openclaw-ui"
PORT="${PORT:-8080}"
NODE_BIN="$(command -v node)"

# ── 1. Check Node.js ──────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  err "Node.js not found. Install Node.js >= 18: https://nodejs.org"
fi

NODE_MAJOR=$(node -e "console.log(parseInt(process.versions.node))")
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node.js >= 18 required (current: $(node --version))"
fi
log "Node.js $(node --version) ✓"

# ── 2. Install dependencies ───────────────────────────────────────────────────
log "Installing dependencies..."
npm ci --prefer-offline 2>/dev/null || npm install

# ── 3. Build ──────────────────────────────────────────────────────────────────
log "Building..."
npm run build
log "Build complete → dist/"

# ── 4. Register systemd service (Linux only) ─────────────────────────────────
if command -v systemctl &>/dev/null && [ -d /etc/systemd/system ]; then
  SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
  log "Creating systemd service: $SERVICE_FILE"

  sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=OpenClaw Agent Control UI
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_BIN $INSTALL_DIR/server.mjs
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=$PORT

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable  "$SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"

  echo ""
  log "Service registered and started!"
  log "  URL    : http://localhost:$PORT"
  log "  Status : sudo systemctl status $SERVICE_NAME"
  log "  Stop   : sudo systemctl stop   $SERVICE_NAME"
  log "  Logs   : sudo journalctl -u $SERVICE_NAME -f"

else
  # ── Fallback: generate start/stop scripts ────────────────────────────────
  warn "systemd not found — generating start.sh / stop.sh instead"

  cat > "$INSTALL_DIR/start.sh" <<EOF
#!/usr/bin/env bash
cd "$INSTALL_DIR"
PORT=$PORT nohup $NODE_BIN server.mjs > openclaw-ui.log 2>&1 &
echo \$! > openclaw-ui.pid
echo "Started on http://localhost:$PORT  (pid \$(cat openclaw-ui.pid))"
EOF

  cat > "$INSTALL_DIR/stop.sh" <<EOF
#!/usr/bin/env bash
PID_FILE="$INSTALL_DIR/openclaw-ui.pid"
if [ -f "\$PID_FILE" ]; then
  kill "\$(cat \$PID_FILE)" && rm "\$PID_FILE" && echo "Stopped."
else
  echo "Not running."
fi
EOF

  chmod +x "$INSTALL_DIR/start.sh" "$INSTALL_DIR/stop.sh"

  echo ""
  log "Done!"
  log "  Start : ./start.sh"
  log "  Stop  : ./stop.sh"
  log "  URL   : http://localhost:$PORT"
fi
