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

INSTALL_LOG="/var/log/ascend-install-latest.log"

on_error() {
    local line=$1 cmd=$2
    echo -e "\n  ${RED}ERROR:${NC} Installer failed at line $line while running: $cmd" >&2
    echo -e "  ${YELLOW}!${NC} Full log: $INSTALL_LOG" >&2
}
trap 'on_error "$LINENO" "$BASH_COMMAND"' ERR

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

setup_logging() {
    mkdir -p "$(dirname "$INSTALL_LOG")"
    : > "$INSTALL_LOG"
    exec > >(tee -a "$INSTALL_LOG") 2>&1
    info "Installer log: $INSTALL_LOG"
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

running_inside_ascend_backend() {
    local pid unit cgroup ppid
    pid=$$
    while [[ -n "$pid" && "$pid" -gt 1 ]]; do
        unit=$(ps -o unit= -p "$pid" 2>/dev/null | tr -d ' ' || true)
        [[ "$unit" == "ascend-backend.service" ]] && return 0
        cgroup=$(cat "/proc/$pid/cgroup" 2>/dev/null || true)
        [[ "$cgroup" == *"ascend-backend.service"* ]] && return 0
        ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
        [[ -z "$ppid" || "$ppid" == "$pid" ]] && break
        pid=$ppid
    done
    return 1
}

check_not_panel_terminal() {
    if running_inside_ascend_backend; then
        die "Do not run this installer from the Ascend web terminal. Run it from SSH or tmux because the update restarts ascend-backend."
    fi
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
    pids=$(ss -tlnpH "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)
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

# Wait for any other process holding the apt/dpkg locks to release them.
# Fresh Ubuntu VPSes auto-run unattended-upgrades on first boot, which can
# tie up the lock for several minutes — so just wait politely and explain
# what's happening instead of crashing on "Could not get lock".
wait_for_apt_lock() {
    local locks=(/var/lib/apt/lists/lock /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock)
    local waited=0
    local max_wait=600   # 10 min
    while fuser "${locks[@]}" >/dev/null 2>&1; do
        if [[ $waited -eq 0 ]]; then
            local holders
            holders=$(fuser "${locks[@]}" 2>&1 | grep -oE '[0-9]+' | sort -u | tr '\n' ' ' || true)
            warn "Another apt/dpkg process is holding the package lock (PIDs: ${holders:-?})."
            warn "This is normal on freshly-booted servers — waiting up to ${max_wait}s for it to finish…"
        elif (( waited % 30 == 0 )); then
            info "Still waiting on apt lock (${waited}s elapsed)…"
        fi
        sleep 5
        waited=$(( waited + 5 ))
        if (( waited >= max_wait )); then
            local stuck
            stuck=$(fuser "${locks[@]}" 2>&1 | grep -oE '[0-9]+' | sort -u | head -1 || true)
            if [[ -n "$stuck" ]]; then
                warn "apt lock still held after ${max_wait}s. Holding process:"
                ps -fp "$stuck" 2>&1 | sed 's/^/    /' >&2 || true
            fi
            die "Timed out waiting for apt lock. If the holding process is stuck (e.g. apt-get update wedged for hours), see the README troubleshooting section."
        fi
    done
    if [[ $waited -gt 0 ]]; then
        ok "apt lock released after ${waited}s — continuing."
    fi
    return 0
}

# Check a binary; install apt packages only if it is missing.
# Note: we deliberately do NOT redirect stderr to /dev/null on apt-get install
# — silent failures here are nearly impossible to debug (the user just sees
# the next "ok" line missing).
apt_install() {
    local cmd=$1 label=$2; shift 2
    if command -v "$cmd" &>/dev/null; then
        ok "$label already installed  ($($cmd --version 2>&1 | head -1))"
    else
        info "Installing $label…"
        wait_for_apt_lock
        apt-get install -y -qq "$@"
        ok "$label installed"
    fi
}

install_system_deps() {
    section "Checking system packages"
    export DEBIAN_FRONTEND=noninteractive
    wait_for_apt_lock
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
        wait_for_apt_lock
        apt-get install -y -qq build-essential
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

    # Shell passphrase gates the web terminal and server-files browser.
    # If the operator didn't pin one via env, generate a random one so we
    # never ship the public-repo default. Skip generation if a hash already
    # exists in the DB (covers re-runs after a partial first install).
    local shell_passphrase shell_generated=0 shell_action="kept"
    if [[ -n "${ASCEND_SHELL_PASSPHRASE:-}" ]]; then
        shell_passphrase="$ASCEND_SHELL_PASSPHRASE"
        shell_action="set"
    else
        local existing_shell_hash
        existing_shell_hash=$(venv/bin/python - <<'PYEOF'
import app
with app.app.app_context():
    print(app._shell_passphrase_hash() or '')
PYEOF
)
        if [[ -z "$existing_shell_hash" ]]; then
            shell_passphrase=$(python3 -c "import secrets; print(secrets.token_urlsafe(18))")
            shell_generated=1
            shell_action="generated"
        fi
    fi

    ASCEND_ADMIN_USERNAME="$username" \
    ASCEND_ADMIN_PASSWORD="$password" \
    ASCEND_SHELL_PASSPHRASE_INTERNAL="${shell_passphrase:-}" \
    venv/bin/python - <<'PYEOF'
import os
import app

username = os.environ['ASCEND_ADMIN_USERNAME']
password = os.environ['ASCEND_ADMIN_PASSWORD']
shell_pass = os.environ.get('ASCEND_SHELL_PASSPHRASE_INTERNAL', '')

with app.app.app_context():
    if app.User.query.first():
        raise SystemExit(0)

    user = app.User(username=username, is_admin=True)
    user.set_password(password)
    app.db.session.add(user)
    app.db.session.commit()

    if shell_pass:
        app.set_shell_passphrase(shell_pass)
PYEOF

    {
        echo "Ascend initial admin"
        echo "URL: http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PANEL_PORT"
        echo "Username: $username"
        if [[ "$generated" -eq 1 ]]; then
            echo "Password: $password"
        else
            echo "Password: (provided via ASCEND_ADMIN_PASSWORD)"
        fi
        echo
        echo "Shell / server-files passphrase"
        if [[ "$shell_action" == "generated" ]]; then
            echo "  Passphrase: $shell_passphrase"
            echo "  (generated — change it later from the terminal/server-files unlock screen)"
        elif [[ "$shell_action" == "set" ]]; then
            echo "  Passphrase: (provided via ASCEND_SHELL_PASSPHRASE)"
        else
            echo "  Passphrase: (kept — admin will be prompted to set one on first use)"
        fi
    } > "$ADMIN_CREDENTIALS_FILE"
    chmod 600 "$ADMIN_CREDENTIALS_FILE"

    if [[ "$generated" -eq 1 ]]; then
        ok "Generated admin user '$username' and saved credentials to $ADMIN_CREDENTIALS_FILE"
    else
        ok "Created admin user '$username' from ASCEND_ADMIN_USERNAME/ASCEND_ADMIN_PASSWORD"
    fi
    if [[ "$shell_generated" -eq 1 ]]; then
        ok "Generated random shell passphrase (saved alongside admin credentials)"
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

    client_max_body_size 6G;

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

    # We deliberately don't pre-emptively touch /etc/nginx/sites-enabled/default
    # because real user sites might depend on it. nginx_start_or_recover will
    # only disable it if (a) nginx fails to bind a port and (b) the default
    # site is the offender.

    if ! nginx -t 2>/dev/null; then
        nginx -t   # print the actual error
        die "Nginx config test failed"
    fi

    systemctl enable nginx --quiet
    nginx_start_or_recover
    ok "Nginx configured — panel accessible on port $PANEL_PORT"
}

# Start (or reload) nginx after our site is in place. Recover from the most
# common failure: another web server (CyberPanel/LiteSpeed, Apache, etc.)
# already owns port 80/443, and stock nginx configs (default site, distro
# extras dropped into conf.d) compete for the same port. Our Ascend site only
# binds $PANEL_PORT, so any nginx config touching the conflicting port is
# safe to disable on this kind of host.
#
# Recovery scans every file under sites-enabled/ and conf.d/, renames the
# offenders to *.disabled-by-ascend (reversible — original config kept), and
# retries. If recovery fails we restore everything we touched and abort.
nginx_start_or_recover() {
    if systemctl reload nginx 2>/dev/null; then
        return 0
    fi
    if systemctl start nginx 2>/dev/null; then
        return 0
    fi

    local err
    err=$(journalctl -u nginx.service --no-pager -n 30 2>/dev/null || true)

    # nginx reports the bind failure as either "Address already in use" (errno
    # text) or just "(98: Unknown error)" depending on glibc/nginx build.
    # Errno 98 == EADDRINUSE on Linux either way, so match the bind() line.
    if ! echo "$err" | grep -qiE 'bind\(\) to .+ failed|address already in use'; then
        echo "$err" >&2
        die "Nginx failed to start. See 'systemctl status nginx' and 'journalctl -xeu nginx' for details."
    fi

    local busy_port
    busy_port=$(echo "$err" | grep -oE 'bind\(\) to (0\.0\.0\.0|\[::\]):[0-9]+' | grep -oE '[0-9]+$' | head -1)
    busy_port="${busy_port:-80}"

    local owner=""
    if command -v ss &>/dev/null; then
        owner=$(ss -tlnpH "sport = :$busy_port" 2>/dev/null | head -1 | sed -nE 's/.*users:\(\("([^"]+)".*/\1/p' || true)
    fi

    warn "Nginx couldn't bind port $busy_port (held by ${owner:-another web server})."
    warn "Scanning nginx configs for files that bind port $busy_port and disabling them…"

    # Disabled files go into a graveyard dir OUTSIDE the include paths.
    # Renaming inside sites-enabled doesn't help because the include uses
    # 'sites-enabled/*' (no extension filter), so even '*.disabled-by-ascend'
    # files still get loaded. The graveyard is only scanned by us.
    local graveyard=/etc/nginx/disabled-by-ascend
    mkdir -p "$graveyard"

    # GNU grep word boundary (\b) keeps '80' from matching '8080' or '1080'.
    local listen_re="^[[:space:]]*listen[[:space:]]+([^;#]*[: ])?\b${busy_port}\b"
    # Each entry is "original_path|graveyard_path" so we can both restore on
    # failure and print accurate restore commands on success.
    local disabled=()
    local cfg base actual dir rel safe dest
    for dir in /etc/nginx/sites-enabled /etc/nginx/conf.d; do
        [[ -d "$dir" ]] || continue
        for cfg in "$dir"/*; do
            [[ -e "$cfg" ]] || continue
            base=$(basename "$cfg")
            # Don't touch our own site
            [[ "$base" == "ascend" || "$base" == "ascend.conf" ]] && continue
            # Resolve symlinks before grepping (sites-enabled entries are usually
            # symlinks into sites-available)
            actual=$(readlink -f "$cfg" 2>/dev/null || echo "$cfg")
            if grep -qE "$listen_re" "$actual" 2>/dev/null; then
                rel="${cfg#/etc/nginx/}"
                safe="${rel//\//__}"
                dest="${graveyard}/${safe}"
                info "  Disabling $cfg (binds port $busy_port)"
                mv "$cfg" "$dest"
                disabled+=("${cfg}|${dest}")
            fi
        done
    done

    if [[ ${#disabled[@]} -eq 0 ]]; then
        echo "$err" >&2
        die "Nothing in /etc/nginx/sites-enabled or /etc/nginx/conf.d binds port $busy_port — the conflicting listen directive is probably in /etc/nginx/nginx.conf or an included snippet. Edit it manually and re-run."
    fi

    if systemctl start nginx 2>/dev/null; then
        ok "Disabled ${#disabled[@]} conflicting nginx config(s) — nginx started cleanly."
        local entry orig moved
        for entry in "${disabled[@]}"; do
            orig="${entry%%|*}"
            moved="${entry##*|}"
            ok "  $orig → $moved  (restore: sudo mv $moved $orig && sudo systemctl reload nginx)"
        done
        return 0
    fi

    # Retry didn't help — put everything back so the operator's nginx state is unchanged
    local entry orig moved
    for entry in "${disabled[@]}"; do
        orig="${entry%%|*}"
        moved="${entry##*|}"
        mv "$moved" "$orig"
    done
    rmdir "$graveyard" 2>/dev/null || true

    echo "$err" >&2
    die "Nginx still couldn't bind port $busy_port after disabling ${#disabled[@]} site(s). The conflict is likely from /etc/nginx/nginx.conf or an included snippet. All disabled files have been restored."
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
    setup_logging
    check_os
    check_systemd
    check_not_panel_terminal
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
