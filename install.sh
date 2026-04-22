#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Ascend — One-file installer
#  Usage:  sudo bash install.sh
#  Or:     curl -fsSL https://raw.githubusercontent.com/mohamadzayyat/Ascend/main/install.sh | sudo bash
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

# ── Defaults ────────────────────────────────────────────────────
BACKEND_PORT=8716
FRONTEND_PORT=8717
REPO_URL="https://github.com/mohamadzayyat/Ascend.git"
NODE_MAJOR=20

# Detect install dir: use script's own directory if app.py is there,
# otherwise clone fresh into /opt/ascend
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo /tmp)"
if [[ -f "$SCRIPT_DIR/app.py" ]]; then
    INSTALL_DIR="$SCRIPT_DIR"
else
    INSTALL_DIR="/opt/ascend"
fi

# ── Colors ──────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "  ${CYAN}•${NC} $*"; }
ok()      { echo -e "  ${GREEN}✓${NC} $*"; }
warn()    { echo -e "  ${YELLOW}!${NC} $*"; }
die()     { echo -e "\n  ${RED}✗ ERROR:${NC} $*\n" >&2; exit 1; }
section() { echo -e "\n${BOLD}${BLUE}▶ $*${NC}"; }

banner() {
    echo -e "${BOLD}${CYAN}"
    cat <<'EOF'
     _    ____  ____ _____ _   _ ____
    / \  / ___||  _ \_   _| \ | |  _ \
   / _ \ \___ \| |_) || | |  \| | | | |
  / ___ \ ___) |  __/ | | | |\  | |_| |
 /_/   \_\____/|_|    |_| |_| \_|____/

  Deployment Management System
EOF
    echo -e "${NC}"
}

# ── Preflight ───────────────────────────────────────────────────

check_root() {
    [[ $EUID -eq 0 ]] || die "Please run as root:  sudo bash install.sh"
}

check_os() {
    if [[ -f /etc/os-release ]]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        info "OS: ${PRETTY_NAME:-Unknown}"
        [[ "$ID" =~ ^(ubuntu|debian)$ ]] || warn "Tested on Ubuntu/Debian. Other distros may need manual adjustments."
    else
        warn "Cannot detect OS — proceeding anyway."
    fi
}

check_systemd() {
    command -v systemctl &>/dev/null || die "systemd is required but not found."
}

# ── System packages ─────────────────────────────────────────────

install_system_deps() {
    section "Installing system packages"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq \
        python3 python3-pip python3-venv \
        git curl wget \
        nginx certbot python3-certbot-nginx \
        build-essential \
        2>/dev/null
    ok "apt packages ready"
}

install_node() {
    section "Checking Node.js"
    if command -v node &>/dev/null; then
        local ver
        ver=$(node -v | sed 's/v//' | cut -d. -f1)
        if [[ $ver -ge 18 ]]; then
            ok "Node.js $(node -v) already installed"
            return
        fi
        info "Node.js $ver is too old — upgrading to $NODE_MAJOR…"
    else
        info "Node.js not found — installing $NODE_MAJOR…"
    fi
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - -qq 2>/dev/null
    apt-get install -y -qq nodejs 2>/dev/null
    ok "Node.js $(node -v) installed"
}

install_pm2() {
    section "Checking PM2"
    if command -v pm2 &>/dev/null; then
        ok "PM2 already installed"
        return
    fi
    npm install -g pm2 --silent
    ok "PM2 installed"
}

# ── Source code ─────────────────────────────────────────────────

get_source() {
    section "Setting up source code"
    if [[ "$INSTALL_DIR" != "/opt/ascend" ]]; then
        ok "Running from existing repo at $INSTALL_DIR"
        return
    fi

    if [[ -d "$INSTALL_DIR/.git" ]]; then
        info "Existing install found — pulling latest…"
        git -C "$INSTALL_DIR" pull --ff-only --quiet
        ok "Updated to latest version"
    else
        info "Cloning Ascend into $INSTALL_DIR…"
        git clone --quiet "$REPO_URL" "$INSTALL_DIR"
        ok "Cloned successfully"
    fi
}

# ── Python backend ──────────────────────────────────────────────

setup_python() {
    section "Setting up Python environment"
    python3 -m venv "$INSTALL_DIR/venv"
    "$INSTALL_DIR/venv/bin/pip" install --quiet --upgrade pip
    "$INSTALL_DIR/venv/bin/pip" install --quiet -r "$INSTALL_DIR/requirements.txt"
    ok "Python dependencies installed"
}

setup_backend_env() {
    section "Configuring backend"
    local env_file="$INSTALL_DIR/.env"

    if [[ -f "$env_file" ]]; then
        ok ".env already exists — keeping current config"
        return
    fi

    local secret_key
    secret_key=$(python3 -c "import secrets; print(secrets.token_hex(48))")

    cat > "$env_file" <<EOF
SECRET_KEY=$secret_key
FLASK_ENV=production
PORT=$BACKEND_PORT
CORS_ORIGIN=http://localhost:$FRONTEND_PORT
SQLALCHEMY_DATABASE_URI=sqlite:////$INSTALL_DIR/ascend.db
EOF
    chmod 600 "$env_file"
    ok ".env created with a generated SECRET_KEY"
}

init_db() {
    section "Initialising database"
    cd "$INSTALL_DIR"
    venv/bin/python - <<'PYEOF'
from app import app, db, User
with app.app_context():
    db.create_all()
print("  Database schema ready")
PYEOF
    ok "Database ready at $INSTALL_DIR/ascend.db"
}

# ── Next.js frontend ────────────────────────────────────────────

setup_frontend_env() {
    local fe_env="$INSTALL_DIR/frontend/.env.local"
    if [[ ! -f "$fe_env" ]]; then
        echo "NEXT_PUBLIC_API_URL=http://localhost:$BACKEND_PORT" > "$fe_env"
        ok "frontend/.env.local created"
    else
        ok "frontend/.env.local already exists"
    fi
}

build_frontend() {
    section "Building Next.js frontend"
    cd "$INSTALL_DIR/frontend"
    info "Running npm install…"
    npm install --silent
    info "Running npm run build…"
    npm run build --silent
    cd "$INSTALL_DIR"
    ok "Frontend built"
}

# ── Systemd services ────────────────────────────────────────────

create_services() {
    section "Creating systemd services"
    local node_bin
    node_bin=$(command -v node)

    # Backend
    cat > /etc/systemd/system/ascend-backend.service <<EOF
[Unit]
Description=Ascend Backend API (Flask/Gunicorn)
After=network.target

[Service]
User=root
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$INSTALL_DIR/venv/bin/gunicorn \\
    --workers 4 \\
    --bind 0.0.0.0:$BACKEND_PORT \\
    --timeout 120 \\
    --access-logfile - \\
    app:app
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ascend-backend

[Install]
WantedBy=multi-user.target
EOF

    # Frontend
    cat > /etc/systemd/system/ascend-frontend.service <<EOF
[Unit]
Description=Ascend Frontend (Next.js)
After=network.target ascend-backend.service
Wants=ascend-backend.service

[Service]
User=root
WorkingDirectory=$INSTALL_DIR/frontend
Environment=NEXT_PUBLIC_API_URL=http://localhost:$BACKEND_PORT
Environment=PORT=$FRONTEND_PORT
ExecStart=$node_bin $INSTALL_DIR/frontend/node_modules/.bin/next start -p $FRONTEND_PORT
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ascend-frontend

[Install]
WantedBy=multi-user.target
EOF

    ok "ascend-backend.service created"
    ok "ascend-frontend.service created"
}

start_services() {
    section "Starting services"
    systemctl daemon-reload
    systemctl enable ascend-backend ascend-frontend --quiet
    systemctl restart ascend-backend
    systemctl restart ascend-frontend
    sleep 3

    if systemctl is-active --quiet ascend-backend; then
        ok "Backend  → running on port $BACKEND_PORT"
    else
        warn "Backend may have failed. Check: journalctl -u ascend-backend -n 50"
    fi

    if systemctl is-active --quiet ascend-frontend; then
        ok "Frontend → running on port $FRONTEND_PORT"
    else
        warn "Frontend may have failed. Check: journalctl -u ascend-frontend -n 50"
    fi
}

# ── Firewall ─────────────────────────────────────────────────────

open_firewall() {
    if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
        section "Opening firewall ports"
        ufw allow "$BACKEND_PORT/tcp"  comment "Ascend API"      >/dev/null
        ufw allow "$FRONTEND_PORT/tcp" comment "Ascend Frontend" >/dev/null
        ok "Ports $BACKEND_PORT and $FRONTEND_PORT allowed in ufw"
    fi
}

# ── Summary ──────────────────────────────────────────────────────

print_summary() {
    local ip
    ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "your-server-ip")

    echo
    echo -e "${BOLD}${GREEN}╔═══════════════════════════════════════════════════╗"
    echo -e "║          Ascend installed successfully!           ║"
    echo -e "╚═══════════════════════════════════════════════════╝${NC}"
    echo
    echo -e "  ${BOLD}Open your browser and go to:${NC}"
    echo -e "  ${CYAN}http://$ip:$FRONTEND_PORT${NC}"
    echo
    echo -e "  ${BOLD}Create your admin account on first visit${NC} (/setup)"
    echo
    echo -e "  ${BOLD}Service management:${NC}"
    echo -e "    systemctl status  ascend-backend ascend-frontend"
    echo -e "    systemctl restart ascend-backend ascend-frontend"
    echo -e "    systemctl stop    ascend-backend ascend-frontend"
    echo
    echo -e "  ${BOLD}Live logs:${NC}"
    echo -e "    journalctl -u ascend-backend  -f"
    echo -e "    journalctl -u ascend-frontend -f"
    echo
    echo -e "  ${BOLD}Config:${NC}"
    echo -e "    $INSTALL_DIR/.env                  (backend)"
    echo -e "    $INSTALL_DIR/frontend/.env.local   (frontend)"
    echo
    echo -e "  ${BOLD}Add a custom domain + SSL later:${NC}"
    echo -e "    certbot --nginx -d yourdomain.com"
    echo
    echo -e "  ${BOLD}To update Ascend in the future:${NC}"
    echo -e "    sudo bash $INSTALL_DIR/install.sh"
    echo
    echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════${NC}"
    echo
}

# ── Main ─────────────────────────────────────────────────────────

main() {
    clear
    banner

    check_root
    check_os
    check_systemd

    install_system_deps
    install_node
    install_pm2

    get_source
    setup_python
    setup_backend_env
    init_db

    setup_frontend_env
    build_frontend

    create_services
    start_services
    open_firewall

    print_summary
}

main "$@"
