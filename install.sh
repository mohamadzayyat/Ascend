#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Ascend — One-file installer  (safe to re-run after any failure)
#
#  Architecture:
#    Nginx  :8716  (public)  ─┬─ /api/* /webhook/*  → Flask  127.0.0.1:8765
#                              └─ everything else    → Next.js 127.0.0.1:8717
#
#  Usage:  sudo bash install.sh
#  Or:     curl -fsSL https://raw.githubusercontent.com/mohamadzayyat/Ascend/main/install.sh | sudo bash
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

# ── Ports ───────────────────────────────────────────────────────
PANEL_PORT=8716          # public-facing Nginx port
BACKEND_PORT=8765        # Flask (internal, 127.0.0.1 only)
FRONTEND_PORT=8717       # Next.js (internal, 127.0.0.1 only)

REPO_URL="https://github.com/mohamadzayyat/Ascend.git"
NODE_MAJOR=20
ADMIN_CREDENTIALS_FILE="/root/.ascend-admin-credentials"

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

# Abort if a port is bound by a process that isn't ours.
# Allowed owners per port:
#   PANEL_PORT    → nginx (the reverse proxy we configure)
#   BACKEND_PORT  → ascend-backend.service
#   FRONTEND_PORT → ascend-frontend.service
# Any other binding is a real conflict.
port_used_by_other() {
    local port=$1
    local expected=$2
    local pids
    pids=$(ss -tlnpH "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u)
    [[ -z "$pids" ]] && return 1
    for pid in $pids; do
        local comm unit
        comm=$(ps -o comm= -p "$pid" 2>/dev/null | tr -d ' ')
        unit=$(ps -o unit= -p "$pid" 2>/dev/null | tr -d ' ')
        case "$expected" in
            nginx)           [[ "$comm" == "nginx" || "$unit" == "nginx.service" ]] && continue ;;
            ascend-backend)  [[ "$unit" == "ascend-backend.service" ]] && continue ;;
            ascend-frontend) [[ "$unit" == "ascend-frontend.service" ]] && continue ;;
        esac
        return 0
    done
    return 1
}

check_ports() {
    section "Checking port availability"
    local conflict=0
    local expected
    for p in $PANEL_PORT $BACKEND_PORT $FRONTEND_PORT; do
        if [[ $p == "$PANEL_PORT" ]]; then
            expected=nginx
        elif [[ $p == "$BACKEND_PORT" ]]; then
            expected=ascend-backend
        else
            expected=ascend-frontend
        fi

        if port_used_by_other "$p" "$expected"; then
            warn "Port $p is already in use by another process:"
            ss -tlnp "sport = :$p" 2>/dev/null | tail -n +2 | sed 's/^/    /'
            conflict=1
        else
            ok "Port $p is free (or owned by $expected)"
        fi
    done
    [[ $conflict -eq 0 ]] || die "Port conflict detected. Free the port(s) above or edit PANEL_PORT/BACKEND_PORT/FRONTEND_PORT in install.sh."
}

# Detect CPU count for gunicorn worker calculation: (2 * CPU) + 1, capped at 9.
detect_worker_count() {
    local cpus
    cpus=$(nproc 2>/dev/null || echo 1)
    local workers=$(( cpus * 2 + 1 ))
    [[ $workers -gt 9 ]] && workers=9
    [[ $workers -lt 2 ]] && workers=2
    echo "$workers"
}

# ── System packages ─────────────────────────────────────────────

# Check a binary; install apt packages only if it is missing.
apt_install() {
    local cmd=$1 label=$2; shift 2
    if command -v "$cmd" &>/dev/null; then
        ok "$label already installed  ($($cmd --version 2>&1 | head -1))"
    else
        info "Installing $label…"
        apt-get install -y -qq "$@" 2>/dev/null
        ok "$label installed"
    fi
}

install_system_deps() {
    section "Checking system packages"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq

    apt_install python3  "Python 3" python3 python3-pip python3-venv
    apt_install git      "Git"      git
    apt_install curl     "curl"     curl wget
    apt_install nginx    "Nginx"    nginx
    apt_install certbot  "Certbot"  certbot python3-certbot-nginx

    if command -v gcc &>/dev/null; then
        ok "build-essential already installed  (gcc $(gcc --version | head -1 | awk '{print $NF}'))"
    else
        info "Installing build-essential…"
        apt-get install -y -qq build-essential 2>/dev/null
        ok "build-essential installed"
    fi
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
        info "Node.js v$ver is too old (need ≥18) — upgrading to $NODE_MAJOR…"
    else
        info "Node.js not found — installing v$NODE_MAJOR…"
    fi
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - -qq 2>/dev/null
    apt-get install -y -qq nodejs 2>/dev/null
    ok "Node.js $(node -v) installed"
}

install_pm2() {
    section "Checking PM2"
    if command -v pm2 &>/dev/null; then
        ok "PM2 already installed  ($(pm2 --version))"
        return
    fi
    info "Installing PM2…"
    npm install -g pm2 --silent
    ok "PM2 $(pm2 --version) installed"
}

# ── Source code ─────────────────────────────────────────────────

get_source() {
    section "Setting up source code"

    # Already running from inside a cloned repo
    if [[ "$INSTALL_DIR" != "/opt/ascend" ]]; then
        ok "Using existing repo at $INSTALL_DIR"
        return
    fi

    # Directory exists but has no .git → previous clone was interrupted
    if [[ -d "$INSTALL_DIR" && ! -d "$INSTALL_DIR/.git" ]]; then
        warn "Incomplete directory found at $INSTALL_DIR — removing and re-cloning…"
        rm -rf "$INSTALL_DIR"
    fi

    if [[ -d "$INSTALL_DIR/.git" ]]; then
        info "Existing install found — pulling latest…"
        # Reset any local changes so pull always succeeds
        git -C "$INSTALL_DIR" fetch --quiet origin
        git -C "$INSTALL_DIR" reset --hard --quiet "origin/$(git -C "$INSTALL_DIR" rev-parse --abbrev-ref HEAD)"
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

    # Recreate venv if the python binary inside it is missing (broken venv)
    if [[ -d "$INSTALL_DIR/venv" && ! -x "$INSTALL_DIR/venv/bin/python3" ]]; then
        warn "Broken virtual environment detected — recreating…"
        rm -rf "$INSTALL_DIR/venv"
    fi

    python3 -m venv "$INSTALL_DIR/venv"
    "$INSTALL_DIR/venv/bin/pip" install --quiet --upgrade pip
    "$INSTALL_DIR/venv/bin/pip" install --quiet -r "$INSTALL_DIR/requirements.txt"
    ok "Python dependencies installed"
}

setup_backend_env() {
    section "Configuring backend"
    local env_file="$INSTALL_DIR/.env"
    local public_ip
    public_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
    if [[ -z "$public_ip" ]]; then
        public_ip="your-server-ip"
    fi
    local panel_public_url="http://$public_ip:$PANEL_PORT"

    upsert_env() {
        local key="$1"
        local value="$2"
        if grep -q "^${key}=" "$env_file" 2>/dev/null; then
            sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
        else
            echo "${key}=${value}" >> "$env_file"
        fi
    }

    if [[ -f "$env_file" ]]; then
        upsert_env "HOST" "127.0.0.1"
        upsert_env "PORT" "$BACKEND_PORT"
        upsert_env "CORS_ORIGIN" "http://localhost:$PANEL_PORT"
        upsert_env "PANEL_PUBLIC_URL" "$panel_public_url"
        ok ".env updated (PANEL_PUBLIC_URL=$panel_public_url)"
        return
    fi

    local secret_key
    secret_key=$(python3 -c "import secrets; print(secrets.token_hex(48))")

    cat > "$env_file" <<EOF
SECRET_KEY=$secret_key
FLASK_ENV=production
HOST=127.0.0.1
PORT=$BACKEND_PORT
CORS_ORIGIN=http://localhost:$PANEL_PORT
PANEL_PUBLIC_URL=$panel_public_url
SQLALCHEMY_DATABASE_URI=sqlite:////$INSTALL_DIR/ascend.db
EOF
    chmod 600 "$env_file"
    ok ".env created with a generated SECRET_KEY"
}

init_db() {
    section "Initialising database"
    cd "$INSTALL_DIR"
    # db.create_all() and migrate_schema() both run on import (see app.py),
    # so just importing is enough — this is idempotent.
    venv/bin/python - <<'PYEOF'
import app  # triggers db.create_all() + migrate_schema() inside app.py
PYEOF
    ok "Database ready at $INSTALL_DIR/ascend.db"
}

create_initial_admin() {
    section "Securing initial admin"
    cd "$INSTALL_DIR"

    local existing_users
    existing_users=$(venv/bin/python - <<'PYEOF'
import app
with app.app.app_context():
    print(app.User.query.count())
PYEOF
)
    if [[ "$existing_users" != "0" ]]; then
        ok "Admin setup already complete; /setup is locked"
        return
    fi

    local username password generated=0
    username="${ASCEND_ADMIN_USERNAME:-admin}"
    if [[ -n "${ASCEND_ADMIN_PASSWORD:-}" ]]; then
        password="$ASCEND_ADMIN_PASSWORD"
    else
        password=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))")
        generated=1
    fi

    ASCEND_ADMIN_USERNAME="$username" ASCEND_ADMIN_PASSWORD="$password" venv/bin/python - <<'PYEOF'
import os
import app

username = os.environ['ASCEND_ADMIN_USERNAME']
password = os.environ['ASCEND_ADMIN_PASSWORD']

with app.app.app_context():
    if app.User.query.first():
        raise SystemExit(0)

    user = app.User(username=username, is_admin=True)
    user.set_password(password)
    app.db.session.add(user)
    app.db.session.commit()
PYEOF

    if [[ "$generated" -eq 1 ]]; then
        cat > "$ADMIN_CREDENTIALS_FILE" <<EOF
Ascend initial admin
URL: http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PANEL_PORT
Username: $username
Password: $password
EOF
        chmod 600 "$ADMIN_CREDENTIALS_FILE"
        ok "Generated admin user '$username' and saved credentials to $ADMIN_CREDENTIALS_FILE"
    else
        ok "Created admin user '$username' from ASCEND_ADMIN_USERNAME/ASCEND_ADMIN_PASSWORD"
    fi
}

# ── Next.js frontend ────────────────────────────────────────────

setup_frontend_env() {
    section "Configuring frontend"
    local fe_env="$INSTALL_DIR/frontend/.env.local"
    # Always (re)write with empty API URL — Nginx provides same-origin routing
    echo "NEXT_PUBLIC_API_URL=" > "$fe_env"
    ok "frontend/.env.local set to empty (relative URLs via Nginx)"
}

build_frontend() {
    section "Building Next.js frontend"
    cd "$INSTALL_DIR/frontend"

    info "Installing npm packages…"
    # npm install is always safe to re-run; updates if package.json changed
    npm install --silent

    # Always wipe the previous build — a partial .next causes cryptic errors
    if [[ -d ".next" ]]; then
        info "Removing previous build artifacts…"
        rm -rf .next
    fi

    info "Building…"
    npm run build
    cd "$INSTALL_DIR"
    ok "Frontend built successfully"
}

# ── Nginx reverse proxy ─────────────────────────────────────────

setup_nginx() {
    section "Configuring Nginx reverse proxy"

    local nginx_conf="/etc/nginx/sites-available/ascend"

    cat > "$nginx_conf" <<NGINX
server {
    listen $PANEL_PORT;
    server_name _;

    client_max_body_size 5G;

    # Flask API and webhooks (also carries the /api/terminal/ws WebSocket)
    location /api/ {
        proxy_pass         http://127.0.0.1:$BACKEND_PORT;
        proxy_set_header   Host \$http_host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_set_header   X-Forwarded-Host \$http_host;
        proxy_set_header   X-Forwarded-Port \$server_port;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location /webhook/ {
        proxy_pass         http://127.0.0.1:$BACKEND_PORT;
        proxy_set_header   Host \$http_host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_set_header   X-Forwarded-Host \$http_host;
        proxy_set_header   X-Forwarded-Port \$server_port;
    }

    # Next.js frontend (everything else)
    location / {
        proxy_pass         http://127.0.0.1:$FRONTEND_PORT;
        proxy_set_header   Host \$http_host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_set_header   X-Forwarded-Host \$http_host;
        proxy_set_header   X-Forwarded-Port \$server_port;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection "upgrade";
    }
}
NGINX

    # Enable site (idempotent symlink)
    local enabled="/etc/nginx/sites-enabled/ascend"
    if [[ -L "$enabled" || -f "$enabled" ]]; then
        rm -f "$enabled"
    fi
    ln -s "$nginx_conf" "$enabled"

    # Note: we do NOT touch /etc/nginx/sites-enabled/default —
    # Ascend uses port $PANEL_PORT so there is no conflict with the default site,
    # and other projects on this VPS may rely on it.

    # Test and reload
    if nginx -t 2>/dev/null; then
        systemctl enable nginx --quiet
        systemctl reload nginx 2>/dev/null || systemctl start nginx
        ok "Nginx configured — panel accessible on port $PANEL_PORT"
    else
        nginx -t   # print error
        die "Nginx config test failed"
    fi
}

# ── Systemd services ────────────────────────────────────────────

create_services() {
    section "Creating systemd services"
    local node_bin
    node_bin=$(command -v node)

    # Stop services before rewriting their unit files
    for svc in ascend-backend ascend-frontend; do
        if systemctl is-active --quiet "$svc" 2>/dev/null; then
            info "Stopping $svc for update…"
            systemctl stop "$svc"
        fi
    done

    cat > /etc/systemd/system/ascend-backend.service <<EOF
[Unit]
Description=Ascend Backend API (Flask/Gunicorn)
After=network.target

[Service]
User=root
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$INSTALL_DIR/venv/bin/gunicorn \\
    --worker-class gthread \\
    --workers $GUNICORN_WORKERS \\
    --threads 8 \\
    --bind 127.0.0.1:$BACKEND_PORT \\
    --timeout 0 \\
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

    cat > /etc/systemd/system/ascend-frontend.service <<EOF
[Unit]
Description=Ascend Frontend (Next.js)
After=network.target ascend-backend.service
Wants=ascend-backend.service

[Service]
User=root
WorkingDirectory=$INSTALL_DIR/frontend
Environment=NEXT_PUBLIC_API_URL=
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

    ok "ascend-backend.service written  (127.0.0.1:$BACKEND_PORT)"
    ok "ascend-frontend.service written (127.0.0.1:$FRONTEND_PORT)"
}

start_services() {
    section "Starting services"
    systemctl daemon-reload
    systemctl enable ascend-backend ascend-frontend --quiet
    systemctl restart ascend-backend
    systemctl restart ascend-frontend
    sleep 3

    if systemctl is-active --quiet ascend-backend; then
        ok "Backend  → running on 127.0.0.1:$BACKEND_PORT (internal)"
    else
        warn "Backend failed to start. Check: journalctl -u ascend-backend -n 50"
    fi

    if systemctl is-active --quiet ascend-frontend; then
        ok "Frontend → running on 127.0.0.1:$FRONTEND_PORT (internal)"
    else
        warn "Frontend failed to start. Check: journalctl -u ascend-frontend -n 50"
    fi
}

# ── Firewall ─────────────────────────────────────────────────────

open_firewall() {
    if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
        section "Configuring firewall"
        ufw allow "$PANEL_PORT/tcp" comment "Ascend Panel" >/dev/null
        # Block direct external access to internal ports — all traffic must go through Nginx
        ufw deny "$BACKEND_PORT/tcp"  comment "Ascend internal" >/dev/null
        ufw deny "$FRONTEND_PORT/tcp" comment "Ascend internal" >/dev/null
        ok "Port $PANEL_PORT open; ports $BACKEND_PORT and $FRONTEND_PORT blocked (internal only)"
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
    echo -e "  ${BOLD}Open your browser:${NC}"
    echo -e "  ${CYAN}http://$ip:$PANEL_PORT${NC}"
    echo
    echo -e "  ${BOLD}Admin account:${NC}"
    if [[ -f "$ADMIN_CREDENTIALS_FILE" ]]; then
        echo -e "    Initial credentials saved at $ADMIN_CREDENTIALS_FILE"
        echo -e "    View once with: sudo cat $ADMIN_CREDENTIALS_FILE"
    else
        echo -e "    Already configured. /setup is locked after the first admin exists."
    fi
    echo
    echo -e "  ${BOLD}Port layout:${NC}"
    echo -e "    $PANEL_PORT  → Nginx (public, routes to backend + frontend)"
    echo -e "    $BACKEND_PORT  → Flask/Gunicorn (internal only)"
    echo -e "    $FRONTEND_PORT  → Next.js (internal only)"
    echo
    echo -e "  ${BOLD}Service management:${NC}"
    echo -e "    systemctl status  ascend-backend ascend-frontend nginx"
    echo -e "    systemctl restart ascend-backend ascend-frontend"
    echo -e "    systemctl stop    ascend-backend ascend-frontend"
    echo
    echo -e "  ${BOLD}Live logs:${NC}"
    echo -e "    journalctl -u ascend-backend  -f"
    echo -e "    journalctl -u ascend-frontend -f"
    echo
    echo -e "  ${BOLD}Config files:${NC}"
    echo -e "    $INSTALL_DIR/.env"
    echo -e "    /etc/nginx/sites-available/ascend"
    echo
    echo -e "  ${BOLD}Add a domain + SSL:${NC}"
    echo -e "    certbot --nginx -d yourdomain.com"
    echo
    echo -e "  ${BOLD}Re-run to update:${NC}"
    echo -e "    curl -fsSL https://raw.githubusercontent.com/mohamadzayyat/Ascend/main/install.sh | sudo bash"
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
    check_ports

    GUNICORN_WORKERS=$(detect_worker_count)
    info "Gunicorn workers: $GUNICORN_WORKERS  (based on $(nproc) CPU core(s))"

    install_system_deps
    install_node
    install_pm2

    get_source
    setup_python
    setup_backend_env
    init_db
    create_initial_admin

    setup_frontend_env
    build_frontend

    create_services
    start_services
    setup_nginx
    open_firewall

    print_summary
}

main "$@"
