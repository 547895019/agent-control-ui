#!/usr/bin/env bash
# OpenClaw Agent Control UI — update to latest version
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[openclaw-ui]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="openclaw-ui"

# ── 1. Pull latest ────────────────────────────────────────────────────────────
log "Pulling latest code..."
git -C "$INSTALL_DIR" pull --ff-only

# ── 2. Install dependencies ───────────────────────────────────────────────────
log "Updating dependencies..."
npm ci --prefer-offline 2>/dev/null || npm install

# ── 3. Build ──────────────────────────────────────────────────────────────────
log "Building..."
npm run build
log "Build complete → dist/"

# ── 4. Restart service ────────────────────────────────────────────────────────
if command -v systemctl &>/dev/null && systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  log "Restarting systemd service..."
  sudo systemctl restart "$SERVICE_NAME"
  log "Done! Service restarted."

elif [ -f "$INSTALL_DIR/start.sh" ]; then
  log "Restarting via start.sh..."
  "$INSTALL_DIR/stop.sh" 2>/dev/null || true
  "$INSTALL_DIR/start.sh"

else
  warn "No running service detected. Start manually: ./start.sh or sudo systemctl start $SERVICE_NAME"
fi
