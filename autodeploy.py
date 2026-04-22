#!/usr/bin/env python3
"""
deploy_wizard.py  v3 — Comprehensive, re-runnable, production-hardened
Ubuntu + Nginx + Certbot + PM2 + GitHub (token clone) + .env + Autodeploy (Flask)

Changes in v3:
 ✅ GitHub credentials saved to ~/.deploy_wizard_settings.json and reused as defaults
 ✅ Clone method always 'url' (no prompt)
 ✅ Shallow clone removed
 ✅ Firewall (UFW) setup removed entirely
 ✅ Auto-detect free ports for app/webhook with smart defaults
 ✅ Multi-app config auto-detects subdirectory names and suggests PM2 names from repo
 ✅ Rollback "no" no longer crashes — continues execution cleanly
 ✅ Build errors: prompt to skip build and continue (instead of hard stop)
"""

import os
import re
import json
import time
import signal
import socket
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

BASE_DIR = Path("/root")
LOG_FILE = BASE_DIR / "deploy_wizard.log"
SETTINGS_FILE = BASE_DIR / ".deploy_wizard_settings.json"

NGINX_AVAIL = Path("/etc/nginx/sites-available")
NGINX_ENABLED = Path("/etc/nginx/sites-enabled")

DEFAULT_CLIENT_MAX_BODY = "100M"

# Track state for rollback
_rollback_actions: list[dict] = []
_interrupted = False


# ═══════════════════════════════════════════
# Settings persistence
# ═══════════════════════════════════════════

def load_settings() -> dict:
    if SETTINGS_FILE.exists():
        try:
            return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def save_settings(data: dict):
    existing = load_settings()
    existing.update(data)
    try:
        SETTINGS_FILE.write_text(json.dumps(existing, indent=2), encoding="utf-8")
        os.chmod(SETTINGS_FILE, 0o600)
    except Exception as e:
        log(f"⚠ Could not save settings: {e}")


# ═══════════════════════════════════════════
# Utilities: logging, shell, prompt, signal
# ═══════════════════════════════════════════

def log(msg: str):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    try:
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def shlex_quote(s: str) -> str:
    return "'" + s.replace("'", "'\"'\"'") + "'"


def run(cmd: str, cwd: str | None = None, check: bool = True,
        env: dict | None = None, redact: str | None = None):
    show_cmd = cmd
    if redact:
        show_cmd = show_cmd.replace(redact, "***")
    log(f"$ {show_cmd}")
    p = subprocess.run(cmd, shell=True, cwd=cwd, text=True, capture_output=True, env=env)
    out = (p.stdout or "").strip()
    err = (p.stderr or "").strip()
    if out:
        log(out)
    if err:
        log(err)
    if check and p.returncode != 0:
        raise RuntimeError(f"Command failed ({p.returncode}): {show_cmd}")
    return p


def require_root():
    if os.geteuid() != 0:
        raise SystemExit("Run as root:  sudo python3 deploy_wizard.py")


def prompt(msg: str, default: str | None = None, required: bool = True) -> str:
    suffix = f" [{default}]" if default is not None else ""
    while True:
        try:
            v = input(f"{msg}{suffix}: ").strip()
        except EOFError:
            if default is not None:
                return default
            raise
        if not v and default is not None:
            return default
        if v or not required:
            return v


def prompt_yesno(msg: str, default: str = "yes") -> bool:
    v = prompt(f"{msg} (yes/no)", default=default).lower()
    return v in ("y", "yes", "true", "1")


def prompt_multiline(msg: str) -> str:
    print(msg)
    print("Paste content. End with a single line containing:  __END__")
    lines = []
    while True:
        try:
            line = input()
        except EOFError:
            break
        if line.strip() == "__END__":
            break
        lines.append(line)
    return "\n".join(lines).rstrip() + "\n"


def sanitize_name(name: str) -> str:
    name = name.strip()
    name = re.sub(r"[^a-zA-Z0-9._-]+", "-", name)
    name = re.sub(r"-{2,}", "-", name).strip("-")
    if not name:
        raise ValueError("Invalid name")
    return name


def write_file(path: Path, content: str, mode: int = 0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    os.chmod(path, mode)
    log(f"✅ wrote: {path} (mode {oct(mode)})")


def add_rollback(action: str, **kwargs):
    _rollback_actions.append({"action": action, **kwargs})


def do_rollback():
    if not _rollback_actions:
        return
    log("⚠ Rolling back changes...")
    for item in reversed(_rollback_actions):
        try:
            act = item["action"]
            if act == "remove_dir" and item.get("path"):
                p = Path(item["path"])
                if p.exists():
                    shutil.rmtree(p)
                    log(f"  ↩ Removed directory: {p}")
            elif act == "remove_file" and item.get("path"):
                p = Path(item["path"])
                if p.exists():
                    p.unlink()
                    log(f"  ↩ Removed file: {p}")
            elif act == "pm2_delete" and item.get("name"):
                run(f"pm2 delete {shlex_quote(item['name'])}", check=False)
                run("pm2 save", check=False)
                log(f"  ↩ Deleted PM2 app: {item['name']}")
            elif act == "nginx_remove" and item.get("site"):
                enabled = NGINX_ENABLED / item["site"]
                avail = NGINX_AVAIL / item["site"]
                if enabled.exists() or enabled.is_symlink():
                    enabled.unlink()
                if avail.exists():
                    avail.unlink()
                run("systemctl reload nginx", check=False)
                log(f"  ↩ Removed nginx site: {item['site']}")
        except Exception as e:
            log(f"  ⚠ Rollback step failed: {e}")


def _signal_handler(sig, frame):
    global _interrupted
    _interrupted = True
    log("\n⚠ Ctrl+C received. Cleaning up...")
    if prompt_yesno("Rollback all changes made so far?", default="no"):
        do_rollback()
    log("Exiting.")
    sys.exit(1)


signal.signal(signal.SIGINT, _signal_handler)


# ═══════════════════════════════════════════
# Port utilities
# ═══════════════════════════════════════════

def is_port_open(host: str, port: int, timeout: float = 0.8) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def is_local_port_free(port: int) -> bool:
    return not is_port_open("127.0.0.1", port)


def find_free_port(start: int, end: int = 65535, exclude: list[int] | None = None) -> int:
    """Find the first free port starting from `start`, skipping excluded ports."""
    exclude = exclude or []
    for port in range(start, end):
        if port not in exclude and is_local_port_free(port):
            return port
    raise RuntimeError(f"No free port found in range {start}-{end}")


def prompt_port(msg: str, preferred: int, exclude: list[int] | None = None) -> int:
    """
    Find a free port near `preferred`, show it as default, let user override.
    Warns if chosen port is in use.
    """
    exclude = exclude or []
    if is_local_port_free(preferred) and preferred not in exclude:
        default_port = preferred
    else:
        log(f"ℹ Port {preferred} is in use or reserved, scanning for a free port...")
        default_port = find_free_port(preferred + 1, exclude=exclude)
        log(f"ℹ Found free port: {default_port}")
    val = int(prompt(msg, default=str(default_port)))
    if not is_local_port_free(val):
        log(f"⚠ Port {val} is already in use!")
        p = run(f"ss -tlnp | grep ':{val} '", check=False)
        if p.stdout:
            log(f"  Process on port: {p.stdout.strip()}")
        if not prompt_yesno("Continue anyway?", default="yes"):
            raise RuntimeError(f"Port {val} is in use.")
    return val


# ═══════════════════════════════════════════
# GitHub credentials (saved/loaded)
# ═══════════════════════════════════════════

def prompt_github_credentials() -> tuple[str, str]:
    """
    Load saved GitHub credentials from settings file.
    Prompt only if not saved or user wants to change them.
    """
    settings = load_settings()
    saved_user = settings.get("github_username", "")
    saved_token = settings.get("github_token", "")

    if saved_user and saved_token:
        log(f"ℹ Saved GitHub username: {saved_user}")
        if prompt_yesno("Use saved GitHub credentials?", default="yes"):
            return saved_user, saved_token

    gh_user = prompt("GitHub username", default=saved_user if saved_user else None)
    gh_token = prompt("GitHub token (PAT)")

    save_settings({"github_username": gh_user, "github_token": gh_token})
    log("✅ GitHub credentials saved to settings.")
    return gh_user, gh_token


# ═══════════════════════════════════════════
# System checks
# ═══════════════════════════════════════════

def ensure_cmd(binname: str) -> bool:
    return shutil.which(binname) is not None


def resolve_domain(domain: str) -> str | None:
    try:
        return socket.gethostbyname(domain)
    except Exception:
        return None


def get_public_ip() -> str | None:
    try:
        req = Request("https://api.ipify.org?format=json", headers={"User-Agent": "deploy-wizard"})
        with urlopen(req, timeout=6) as r:
            data = json.loads(r.read().decode("utf-8"))
            return data.get("ip")
    except Exception:
        return None


def http_get(url: str, timeout: int = 10) -> tuple[int, str]:
    try:
        req = Request(url, headers={"User-Agent": "deploy-wizard"})
        with urlopen(req, timeout=timeout) as r:
            body = r.read(4000).decode("utf-8", errors="replace")
            return r.status, body
    except HTTPError as e:
        return e.code, str(e)
    except URLError as e:
        return 0, str(e)


def check_swap():
    """Warn if the server has < 512 MB of swap and < 1 GB RAM."""
    try:
        mem = run("free -m", check=False)
        for line in (mem.stdout or "").splitlines():
            parts = line.split()
            if parts and parts[0].lower() == "mem:":
                total_ram = int(parts[1])
                if total_ram < 1024:
                    log(f"⚠ Low RAM detected: {total_ram} MB. Builds may fail.")
            if parts and parts[0].lower() == "swap:":
                total_swap = int(parts[1])
                if total_swap < 512:
                    log(f"⚠ Low/no swap detected: {total_swap} MB.")
                    if prompt_yesno("Create a 2 GB swap file?", default="yes"):
                        run("fallocate -l 2G /swapfile", check=False)
                        run("chmod 600 /swapfile")
                        run("mkswap /swapfile")
                        run("swapon /swapfile")
                        fstab = Path("/etc/fstab")
                        if "/swapfile" not in fstab.read_text():
                            with fstab.open("a") as f:
                                f.write("\n/swapfile swap swap defaults 0 0\n")
                        log("✅ 2 GB swap created and enabled.")
    except Exception as e:
        log(f"ℹ Could not check swap: {e}")


def ensure_dependencies(auto_install: bool):
    needed = ["git", "nginx", "certbot", "node", "npm", "pm2", "python3", "pip3"]
    missing = [b for b in needed if not ensure_cmd(b)]

    if not missing:
        log("✅ Dependencies OK.")
        return

    log(f"⚠ Missing: {', '.join(missing)}")
    if not auto_install:
        raise RuntimeError("Install missing dependencies then rerun (or enable auto-install).")

    log("Installing core dependencies via apt/npm...")
    run("apt-get update -y")

    if "node" in missing or "npm" in missing:
        p = run("node -v", check=False)
        major = 0
        if p.returncode == 0:
            try:
                major = int(re.search(r"v(\d+)", p.stdout or "").group(1))
            except Exception:
                pass
        if major < 18:
            log("ℹ Installing Node.js 20.x via NodeSource...")
            run("curl -fsSL https://deb.nodesource.com/setup_20.x | bash -", check=False)

    run("apt-get install -y git nginx certbot python3-certbot-nginx python3-pip curl")
    run("apt-get install -y nodejs", check=False)

    if not ensure_cmd("pm2"):
        run("npm i -g pm2")

    missing2 = [b for b in needed if not ensure_cmd(b)]
    if missing2:
        raise RuntimeError(f"Still missing after install: {missing2}")

    log("✅ Dependencies installed.")


def check_node_engines(project_dir: Path):
    pkg = project_dir / "package.json"
    if not pkg.exists():
        log("ℹ No package.json found; skipping Node version check.")
        return
    try:
        data = json.loads(pkg.read_text(encoding="utf-8"))
        engines = data.get("engines") or {}
        req = engines.get("node")
        node_v = (run("node -v", check=False).stdout or "").strip()
        if req:
            log(f"ℹ package.json engines.node = {req} ; current node = {node_v}")
        else:
            log(f"ℹ current node = {node_v} ; no engines.node constraint found.")
    except Exception as e:
        log(f"⚠ Could not parse package.json for engines: {e}")


def check_apache_conflict():
    p = run("ss -tlnp | grep ':80 '", check=False)
    output = (p.stdout or "")
    if "apache2" in output.lower() or "httpd" in output.lower():
        log("⚠ Apache is running on port 80! This will conflict with Nginx.")
        if prompt_yesno("Stop and disable Apache?", default="yes"):
            run("systemctl stop apache2", check=False)
            run("systemctl disable apache2", check=False)
            log("✅ Apache stopped and disabled.")
        else:
            log("⚠ Continuing anyway — Nginx may fail to bind port 80.")


# ═══════════════════════════════════════════
# Git clone / update
# ═══════════════════════════════════════════

def detect_default_branch(dest: Path) -> str:
    p = run("git remote show origin 2>/dev/null | grep 'HEAD branch'", cwd=str(dest), check=False)
    match = re.search(r"HEAD branch:\s*(\S+)", p.stdout or "")
    if match:
        branch = match.group(1)
        log(f"ℹ Remote default branch detected: {branch}")
        return branch

    p = run("git branch -r", cwd=str(dest), check=False)
    branches = (p.stdout or "")
    for candidate in ("origin/main", "origin/master", "origin/develop"):
        if candidate in branches:
            branch = candidate.replace("origin/", "")
            log(f"ℹ Fallback branch detected: {branch}")
            return branch

    log("⚠ Could not detect default branch, assuming 'main'.")
    return "main"


def clone_repo(repo_https: str, folder_name: str, username: str, token: str) -> tuple[Path, str]:
    """
    Always uses URL-embedded token. Returns (project_dir, default_branch).
    Re-runnable: exists+.git → update, exists+non-git → offer delete+re-clone.
    """
    folder_name = sanitize_name(folder_name)
    dest = BASE_DIR / folder_name

    if dest.exists():
        git_dir = dest / ".git"
        if git_dir.exists() and git_dir.is_dir():
            log(f"ℹ Folder exists and is a git repo. Updating: {dest}")

            p = run("git remote get-url origin", cwd=str(dest), check=False)
            current_origin = (p.stdout or "").strip()
            if current_origin and current_origin != repo_https:
                log(f"ℹ Updating origin URL to: {repo_https}")
                run(f"git remote set-url origin {shlex_quote(repo_https)}", cwd=str(dest))

            run("git fetch --all --prune", cwd=str(dest))
            branch = detect_default_branch(dest)
            run(f"git reset --hard origin/{branch}", cwd=str(dest))

            if (dest / ".gitmodules").exists():
                log("ℹ Initializing git submodules...")
                run("git submodule update --init --recursive", cwd=str(dest))

            return dest, branch

        log(f"⚠ Folder exists but is NOT a git repo: {dest}")
        if prompt_yesno("Delete it and re-clone?", default="yes"):
            shutil.rmtree(dest)
            log(f"✅ Removed: {dest}")
        else:
            raise RuntimeError(f"Cannot continue — {dest} exists and is not a git repo.")

    if not repo_https.startswith("https://"):
        if repo_https.startswith("git@"):
            log("⚠ SSH URL detected. Converting to HTTPS...")
            m = re.match(r"git@([^:]+):(.+)", repo_https)
            if m:
                repo_https = f"https://{m.group(1)}/{m.group(2)}"
                log(f"ℹ Converted to: {repo_https}")
            else:
                raise RuntimeError("Could not convert SSH URL to HTTPS.")
        else:
            raise RuntimeError("Repo must be HTTPS URL (https://...) or SSH URL (git@...)")

    log(f"Cloning into: {dest}")
    repo_with_creds = repo_https.replace("https://", f"https://{username}:{token}@")
    run(f"git clone {shlex_quote(repo_with_creds)} {shlex_quote(str(dest))}", redact=token)

    add_rollback("remove_dir", path=str(dest))

    branch = detect_default_branch(dest)

    if (dest / ".gitmodules").exists():
        log("ℹ Initializing git submodules...")
        run("git submodule update --init --recursive", cwd=str(dest))

    return dest, branch


# ═══════════════════════════════════════════
# .env placement  (monorepo-friendly)
# ═══════════════════════════════════════════

def choose_env_target(project_dir: Path) -> Path:
    items = []
    for p in sorted(project_dir.iterdir()):
        if p.name.startswith("."):
            continue
        items.append(p.name + ("/" if p.is_dir() else ""))

    if items:
        log("Repo top-level contents:")
        for it in items[:50]:
            log(f"  {it}")
        if len(items) > 50:
            log("  ...")

    rel = prompt("Where should I write the .env? (relative to repo root)", default=".env")
    rel = rel.strip().lstrip("/").replace("\\", "/")

    if rel.endswith("/"):
        rel = rel + ".env"

    target = project_dir / rel

    if target.exists() and target.is_dir():
        target = target / ".env"

    if not target.parent.exists():
        if prompt_yesno(f"Directory {target.parent} doesn't exist. Create it?", default="yes"):
            target.parent.mkdir(parents=True, exist_ok=True)
        else:
            raise RuntimeError(f"Target folder does not exist: {target.parent}")

    return target


def maybe_extra_env(project_dir: Path):
    while prompt_yesno("Write another .env file in the repo? (e.g. for frontend, worker, etc.)", default="no"):
        env_content = prompt_multiline("Paste the extra .env now, end with __END__:")
        env_path = choose_env_target(project_dir)
        write_file(env_path, env_content, mode=0o600)
        log(f"✅ Extra .env written to: {env_path}")


# ═══════════════════════════════════════════
# Package manager detection + install/build
# ═══════════════════════════════════════════

def detect_package_manager(project_dir: Path) -> str:
    if (project_dir / "pnpm-lock.yaml").exists():
        if not ensure_cmd("pnpm"):
            run("npm i -g pnpm", check=False)
        if ensure_cmd("pnpm"):
            return "pnpm"
    if (project_dir / "yarn.lock").exists():
        if not ensure_cmd("yarn"):
            run("npm i -g yarn", check=False)
        if ensure_cmd("yarn"):
            return "yarn"
    return "npm"


def has_script(project_dir: Path, script_name: str) -> bool:
    pkg = project_dir / "package.json"
    if not pkg.exists():
        return False
    try:
        data = json.loads(pkg.read_text(encoding="utf-8"))
        return script_name in (data.get("scripts") or {})
    except Exception:
        return False


def package_install_build(work_dir: Path, do_build: bool) -> str:
    """
    Run install + optional build. Returns package manager name.
    On build failure, prompts to skip rather than hard-crashing.
    """
    if not (work_dir / "package.json").exists():
        raise RuntimeError(f"No package.json found in {work_dir}")

    pm = detect_package_manager(work_dir)
    log(f"ℹ Using package manager: {pm}")

    # Install
    if pm == "npm":
        lock = work_dir / "package-lock.json"
        run("npm ci" if lock.exists() else "npm install", cwd=str(work_dir))
    elif pm == "yarn":
        run("yarn install --frozen-lockfile", cwd=str(work_dir))
    elif pm == "pnpm":
        run("pnpm install --frozen-lockfile", cwd=str(work_dir))

    # Build
    if do_build:
        if has_script(work_dir, "build"):
            log(f"$ {pm} run build")
            p = subprocess.run(f"{pm} run build", shell=True, cwd=str(work_dir),
                               text=True, capture_output=True)
            if (p.stdout or "").strip():
                log(p.stdout.strip())
            if (p.stderr or "").strip():
                log(p.stderr.strip())
            if p.returncode != 0:
                log(f"❌ Build failed (exit code {p.returncode})")
                log("  Common causes:")
                log("  • Missing Prisma client  → run: npx prisma generate")
                log("  • Missing env vars       → check .env file")
                log("  • TypeScript errors      → fix in source code")
                if prompt_yesno("Skip build and continue deployment anyway?", default="yes"):
                    log("⚠ Skipping build. App may not work correctly until build is fixed.")
                else:
                    raise RuntimeError("Build failed. Fix errors above and rerun.")
        else:
            log("⚠ No 'build' script found in package.json. Skipping build.")
            if not prompt_yesno("Continue without building?", default="yes"):
                raise RuntimeError("Build required but no build script found.")

    return pm


def choose_work_directory(project_dir: Path) -> Path:
    if (project_dir / "package.json").exists():
        if prompt_yesno(f"Run npm install/build at repo root ({project_dir.name}/)?", default="yes"):
            return project_dir

    candidates = []
    for child in sorted(project_dir.iterdir()):
        if child.is_dir() and (child / "package.json").exists() and not child.name.startswith("."):
            candidates.append(child.name)

    if candidates:
        log(f"ℹ Directories with package.json: {', '.join(candidates)}")

    subdir = prompt("Which subdirectory to run install/build in?",
                    default=candidates[0] if candidates else "backend")
    work = project_dir / subdir
    if not (work / "package.json").exists():
        raise RuntimeError(f"No package.json in {work}")
    return work


# ═══════════════════════════════════════════
# PM2 ecosystem + management
# ═══════════════════════════════════════════

def detect_existing_pm2_apps() -> list[dict]:
    p = run("pm2 jlist", check=False)
    try:
        return json.loads(p.stdout or "[]")
    except Exception:
        return []


def generate_ecosystem(work_dir: Path, app_name: str, start_command: str) -> Path:
    app_name = sanitize_name(app_name)

    existing = detect_existing_pm2_apps()
    for app in existing:
        if app.get("name") == app_name:
            log(f"ℹ PM2 app '{app_name}' already exists. It will be reloaded.")
            break

    eco = f"""module.exports = {{
  apps: [
    {{
      name: "{app_name}",
      cwd: "{str(work_dir)}",
      script: "bash",
      args: ["-lc", {json.dumps(start_command)}],
      autorestart: true,
      watch: false,
      max_memory_restart: "800M",
      env: {{
        NODE_ENV: "production"
      }}
    }}
  ]
}};
"""
    eco_path = work_dir / "ecosystem.config.js"
    write_file(eco_path, eco, mode=0o644)
    return eco_path


def pm2_reload(ecosystem_path: Path, app_name: str | None = None):
    run(f"pm2 startOrReload {shlex_quote(str(ecosystem_path))}")
    run("pm2 save")
    run("pm2 list", check=False)
    if app_name:
        add_rollback("pm2_delete", name=app_name)


def pm2_wait_online(app_name: str, seconds: int = 25) -> bool:
    deadline = time.time() + seconds
    last_status = "unknown"
    while time.time() < deadline:
        p = run("pm2 jlist", check=False)
        try:
            data = json.loads(p.stdout or "[]")
            for app in data:
                if app.get("name") == app_name:
                    status = (app.get("pm2_env") or {}).get("status")
                    last_status = status or "unknown"
                    if status == "online":
                        log(f"✅ PM2 app '{app_name}' is online.")
                        return True
                    if status == "errored":
                        log(f"❌ PM2 app '{app_name}' errored. Check logs: pm2 logs {app_name}")
                        run(f"pm2 logs {shlex_quote(app_name)} --lines 20 --nostream", check=False)
                        return False
        except Exception:
            pass
        time.sleep(1)

    log(f"⚠ PM2 app '{app_name}' status: {last_status} (timed out after {seconds}s).")
    run(f"pm2 logs {shlex_quote(app_name)} --lines 20 --nostream", check=False)
    return False


def pm2_setup_startup_and_logrotate():
    log("ℹ Configuring PM2 startup (reboot persistence)...")
    run("pm2 startup systemd -u root --hp /root", check=False)
    run("pm2 save", check=False)

    log("ℹ Setting up PM2 log rotation...")
    run("pm2 install pm2-logrotate", check=False)
    run("pm2 set pm2-logrotate:max_size 50M", check=False)
    run("pm2 set pm2-logrotate:retain 7", check=False)
    run("pm2 set pm2-logrotate:compress true", check=False)
    log("✅ PM2 startup and log rotation configured.")


# ═══════════════════════════════════════════
# Nginx + Certbot
# ═══════════════════════════════════════════

def check_nginx_conflicts(server_name: str, site_name: str):
    default_enabled = NGINX_ENABLED / "default"
    if default_enabled.exists() or default_enabled.is_symlink():
        log("ℹ Default nginx site is enabled.")
        if prompt_yesno("Disable the default nginx site to avoid conflicts?", default="yes"):
            if default_enabled.is_symlink() or default_enabled.exists():
                default_enabled.unlink()
                log("✅ Default nginx site disabled.")

    existing = NGINX_AVAIL / site_name
    if existing.exists():
        log(f"⚠ Nginx config already exists: {existing}")
        if prompt_yesno("Overwrite it?", default="yes"):
            if (NGINX_ENABLED / site_name).exists() or (NGINX_ENABLED / site_name).is_symlink():
                (NGINX_ENABLED / site_name).unlink()
            existing.unlink()
        else:
            raise RuntimeError("Cannot continue — nginx config already exists.")

    p = run(f"grep -rl 'server_name.*{server_name}' /etc/nginx/sites-available/ 2>/dev/null || true",
            check=False)
    conflicts = [l.strip() for l in (p.stdout or "").splitlines() if l.strip()]
    if conflicts:
        log(f"⚠ Found existing nginx configs referencing '{server_name}':")
        for c in conflicts:
            log(f"  - {c}")
        if not prompt_yesno("Continue anyway? (may cause duplicate server_name)", default="no"):
            raise RuntimeError("Resolve nginx conflicts first.")


def create_nginx_site(server_name: str, site_name: str, upstream_port: int) -> Path:
    site_name = sanitize_name(site_name)
    conf_path = NGINX_AVAIL / site_name

    conf = f"""server {{
    listen 80;
    listen [::]:80;

    server_name {server_name};

    client_max_body_size {DEFAULT_CLIENT_MAX_BODY};

    location / {{
        proxy_pass http://127.0.0.1:{upstream_port};
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;

        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 300;
    }}
}}
"""
    write_file(conf_path, conf, mode=0o644)

    enabled_link = NGINX_ENABLED / site_name
    if enabled_link.exists() or enabled_link.is_symlink():
        enabled_link.unlink()
    enabled_link.symlink_to(conf_path)

    add_rollback("nginx_remove", site=site_name)

    run("nginx -t")
    run("systemctl reload nginx")
    log(f"✅ Nginx site enabled: {conf_path}")
    return conf_path


def create_nginx_multi_site(server_name: str, site_name: str, apps: list[dict]) -> Path:
    site_name = sanitize_name(site_name)
    conf_path = NGINX_AVAIL / site_name

    upstreams = ""
    for app in apps:
        upstreams += f"""
upstream {sanitize_name(app['name'])}_upstream {{
    server 127.0.0.1:{app['port']};
}}
"""

    locations = ""
    for app in apps:
        loc = app.get('location', '/')
        upstream = f"{sanitize_name(app['name'])}_upstream"

        if app.get('strip_prefix') and loc != '/':
            locations += f"""
    location {loc} {{
        rewrite ^{loc}(.*)$ $1 break;
        proxy_pass http://{upstream};
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;

        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 300;
    }}
"""
        else:
            locations += f"""
    location {loc} {{
        proxy_pass http://{upstream};
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;

        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 300;
    }}
"""

    conf = f"""{upstreams}
server {{
    listen 80;
    listen [::]:80;

    server_name {server_name};

    client_max_body_size {DEFAULT_CLIENT_MAX_BODY};
{locations}
}}
"""
    write_file(conf_path, conf, mode=0o644)

    enabled_link = NGINX_ENABLED / site_name
    if enabled_link.exists() or enabled_link.is_symlink():
        enabled_link.unlink()
    enabled_link.symlink_to(conf_path)

    add_rollback("nginx_remove", site=site_name)

    run("nginx -t")
    run("systemctl reload nginx")
    log(f"✅ Nginx multi-app site enabled: {conf_path}")
    return conf_path


def issue_cert(server_name: str, email: str):
    resolved = resolve_domain(server_name)
    server_ip = get_public_ip()

    if not resolved:
        log(f"⚠ Cannot resolve DNS for {server_name}. Certbot will likely fail.")
        if not prompt_yesno("Try certbot anyway?", default="no"):
            log("ℹ Skipping SSL. You can run certbot manually later:")
            log(f"   certbot --nginx -d {server_name} --non-interactive --agree-tos -m {email} --redirect")
            return

    if server_ip and resolved and resolved != server_ip:
        log(f"⚠ DNS mismatch: {server_name} → {resolved}, but server IP → {server_ip}")
        if not prompt_yesno("Try certbot anyway?", default="no"):
            log("ℹ Skipping SSL. Fix DNS then run:")
            log(f"   certbot --nginx -d {server_name} --non-interactive --agree-tos -m {email} --redirect")
            return

    run(
        f"certbot --nginx -d {shlex_quote(server_name)} "
        f"--non-interactive --agree-tos -m {shlex_quote(email)} --redirect"
    )
    run("systemctl reload nginx")
    log("✅ SSL certificate issued and nginx reloaded.")


# ═══════════════════════════════════════════
# Autodeploy webhook service
# ═══════════════════════════════════════════

def generate_autodeploy(work_dir: Path, ecosystem_path: Path,
                        webhook_port: int, github_secret: str,
                        default_branch: str, pm_name: str,
                        folder_name: str = "") -> tuple[Path, str]:
    autodeploy_name = f"autodeploy_{sanitize_name(folder_name)}" if folder_name else "autodeploy"
    auto_dir = BASE_DIR / autodeploy_name
    auto_dir.mkdir(parents=True, exist_ok=True)

    python3_path = shutil.which("python3") or "python3"

    pm = detect_package_manager(work_dir)
    if pm == "pnpm":
        install_cmd = "pnpm install --frozen-lockfile"
    elif pm == "yarn":
        install_cmd = "yarn install --frozen-lockfile"
    else:
        install_cmd = "if [ -f package-lock.json ]; then npm ci; else npm install; fi"

    build_cmd = f"{pm} run build" if has_script(work_dir, "build") else "echo 'No build script, skipping'"

    app_py = f"""from flask import Flask, request, jsonify
import subprocess, hmac, hashlib, os

APP = Flask(__name__)
GITHUB_SECRET = os.getenv("GITHUB_WEBHOOK_SECRET", "")

TARGET_DIR = {json.dumps(str(work_dir))}
ECO_PATH = {json.dumps(str(ecosystem_path))}
DEFAULT_BRANCH = {json.dumps(default_branch)}

COMMANDS = [
  "git fetch --all --prune",
  f"git reset --hard origin/{{DEFAULT_BRANCH}}",
  {json.dumps(install_cmd)},
  {json.dumps(build_cmd)},
]

def sh(cmd: str, cwd: str):
  return subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)

def verify_signature(secret: str, raw_body: bytes, sig_header: str) -> bool:
  if not secret:
    return True
  if not sig_header or not sig_header.startswith("sha256="):
    return False
  expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
  received = sig_header.split("=", 1)[1]
  return hmac.compare_digest(expected, received)

@APP.get("/health")
def health():
  return jsonify({{"status":"ok","branch":DEFAULT_BRANCH}}), 200

@APP.post("/webhook")
def webhook():
  event = request.headers.get("X-GitHub-Event", "")
  if event and event != "push":
    return jsonify({{"status":"ignored","reason":f"event={{event}}"}}), 200

  raw = request.get_data()
  sig = request.headers.get("X-Hub-Signature-256", "")
  if not verify_signature(GITHUB_SECRET, raw, sig):
    return jsonify({{"status":"error","message":"invalid signature"}}), 401

  payload = request.get_json(silent=True) or {{}}
  ref = payload.get("ref","")
  branch = ref.replace("refs/heads/","",1) if ref.startswith("refs/heads/") else ""
  if branch and branch != DEFAULT_BRANCH:
    return jsonify({{"status":"ignored","reason":f"branch={{branch}}, expected {{DEFAULT_BRANCH}}"}}), 200

  logs = []
  for cmd in COMMANDS:
    r = sh(cmd, TARGET_DIR)
    logs.append({{
      "cmd": cmd,
      "code": r.returncode,
      "out": (r.stdout or "")[-4000:],
      "err": (r.stderr or "")[-4000:]
    }})
    if r.returncode != 0:
      return jsonify({{"status":"failed","logs":logs}}), 500

  r = subprocess.run(f"pm2 startOrReload {{ECO_PATH}} && pm2 save", shell=True, capture_output=True, text=True)
  logs.append({{
    "cmd":"pm2 startOrReload + save",
    "code": r.returncode,
    "out": (r.stdout or "")[-4000:],
    "err": (r.stderr or "")[-4000:]
  }})
  if r.returncode != 0:
    return jsonify({{"status":"failed","logs":logs}}), 500

  return jsonify({{"status":"done","branch":branch or DEFAULT_BRANCH,"logs":logs}}), 200

if __name__ == "__main__":
  if not GITHUB_SECRET:
    print("WARNING: No GITHUB_WEBHOOK_SECRET set. All requests will be accepted!")
  APP.run(host="0.0.0.0", port={webhook_port})
"""
    write_file(auto_dir / "autodeploy.py", app_py, mode=0o644)

    run(f"{shlex_quote(python3_path)} -m pip install --upgrade pip", check=False)
    run(f"{shlex_quote(python3_path)} -m pip install flask", check=False)

    p = run(f"{shlex_quote(python3_path)} -c \"import flask; print(flask.__version__)\"", check=False)
    if p.returncode != 0:
        log("⚠ Flask still not importable. Trying apt fallback...")
        run("apt-get install -y python3-flask", check=False)

    eco = f"""module.exports = {{
  apps: [
    {{
      name: "{autodeploy_name}",
      cwd: "{str(auto_dir)}",
      script: "{python3_path}",
      args: ["autodeploy.py"],
      interpreter: "none",
      autorestart: true,
      watch: false,
      env: {{
        "GITHUB_WEBHOOK_SECRET": "{github_secret}"
      }}
    }}
  ]
}};
"""
    eco_path = auto_dir / "ecosystem.config.js"
    write_file(eco_path, eco, mode=0o600)
    return eco_path, autodeploy_name


def generate_multi_app_autodeploy(
    project_dir: Path,
    apps: list[dict],
    webhook_port: int,
    github_secret: str,
    default_branch: str,
    folder_name: str = ""
) -> tuple[Path, str]:
    autodeploy_name = f"autodeploy_{sanitize_name(folder_name)}" if folder_name else "autodeploy_multi"
    auto_dir = BASE_DIR / autodeploy_name
    auto_dir.mkdir(parents=True, exist_ok=True)

    python3_path = shutil.which("python3") or "python3"

    projects_dict = {}
    for app in apps:
        work_dir = app['work_dir']
        pm = detect_package_manager(Path(work_dir))

        if 'commands' in app and app['commands']:
            commands = app['commands']
        else:
            if pm == "pnpm":
                install_cmd = "pnpm install --frozen-lockfile"
            elif pm == "yarn":
                install_cmd = "yarn install --frozen-lockfile"
            else:
                install_cmd = "npm ci" if (Path(work_dir) / "package-lock.json").exists() else "npm install"

            build_cmd = f"{pm} run build" if has_script(Path(work_dir), "build") else None
            commands = [install_cmd]
            if build_cmd:
                commands.append(build_cmd)

        projects_dict[app['name']] = {
            "dir": str(work_dir),
            "ecosystem": str(app['ecosystem_path']),
            "branch": default_branch,
            "pm2": app['name'],
            "path_prefix": app.get('path_prefix', ''),
            "commands": commands
        }

    app_py = f'''from flask import Flask, request, jsonify
import subprocess, hmac, hashlib, os, json

APP = Flask(__name__)
GITHUB_SECRET = os.getenv("GITHUB_WEBHOOK_SECRET", "")
PROJECT_DIR = {json.dumps(str(project_dir))}
DEFAULT_BRANCH = {json.dumps(default_branch)}

PROJECTS = {json.dumps(projects_dict, indent=2)}

def sh(cmd: str, cwd: str):
    return subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)

def verify_signature(secret: str, raw_body: bytes, sig_header: str) -> bool:
    if not secret:
        return True
    if not sig_header or not sig_header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    received = sig_header.split("=", 1)[1]
    return hmac.compare_digest(expected, received)

def detect_affected_apps(commits: list) -> set:
    affected = set()
    for commit in commits:
        for file_list in [commit.get("added", []), commit.get("modified", []), commit.get("removed", [])]:
            for filepath in file_list:
                for app_name, cfg in PROJECTS.items():
                    prefix = cfg.get("path_prefix", "")
                    if prefix and filepath.startswith(prefix):
                        affected.add(app_name)
                    elif not prefix:
                        affected.add(app_name)
    return affected

@APP.get("/health")
def health():
    return jsonify({{"status": "ok", "branch": DEFAULT_BRANCH, "apps": list(PROJECTS.keys())}}), 200

@APP.post("/webhook")
def webhook():
    event = request.headers.get("X-GitHub-Event", "")
    if event and event != "push":
        return jsonify({{"status": "ignored", "reason": f"event={{event}}"}}), 200

    raw = request.get_data()
    sig = request.headers.get("X-Hub-Signature-256", "")
    if not verify_signature(GITHUB_SECRET, raw, sig):
        return jsonify({{"status": "error", "message": "invalid signature"}}), 401

    payload = request.get_json(silent=True) or {{}}
    ref = payload.get("ref", "")
    branch = ref.replace("refs/heads/", "", 1) if ref.startswith("refs/heads/") else ""

    if branch and branch != DEFAULT_BRANCH:
        return jsonify({{"status": "ignored", "reason": f"branch={{branch}}, expected {{DEFAULT_BRANCH}}"}}), 200

    commits = payload.get("commits", [])
    affected = detect_affected_apps(commits)

    if not affected:
        affected = set(PROJECTS.keys())

    logs = []
    deployed_apps = []

    r = sh("git fetch --all --prune", PROJECT_DIR)
    logs.append({{"cmd": "git fetch", "code": r.returncode, "out": r.stdout[-2000:], "err": r.stderr[-2000:]}})
    if r.returncode != 0:
        return jsonify({{"status": "failed", "logs": logs}}), 500

    r = sh(f"git reset --hard origin/{{DEFAULT_BRANCH}}", PROJECT_DIR)
    logs.append({{"cmd": "git reset", "code": r.returncode, "out": r.stdout[-2000:], "err": r.stderr[-2000:]}})
    if r.returncode != 0:
        return jsonify({{"status": "failed", "logs": logs}}), 500

    for app_name in affected:
        cfg = PROJECTS[app_name]
        work_dir = cfg["dir"]

        for cmd in cfg["commands"]:
            r = sh(cmd, work_dir)
            logs.append({{
                "app": app_name,
                "cmd": cmd,
                "code": r.returncode,
                "out": r.stdout[-2000:],
                "err": r.stderr[-2000:]
            }})
            if r.returncode != 0:
                return jsonify({{"status": "failed", "app": app_name, "logs": logs}}), 500

        eco = cfg["ecosystem"]
        r = sh(f"pm2 startOrReload {{eco}}", work_dir)
        logs.append({{
            "app": app_name,
            "cmd": f"pm2 startOrReload {{eco}}",
            "code": r.returncode,
            "out": r.stdout[-2000:],
            "err": r.stderr[-2000:]
        }})
        if r.returncode != 0:
            return jsonify({{"status": "failed", "app": app_name, "logs": logs}}), 500

        deployed_apps.append(app_name)

    sh("pm2 save", PROJECT_DIR)

    return jsonify({{
        "status": "done",
        "branch": branch or DEFAULT_BRANCH,
        "deployed": deployed_apps,
        "logs": logs
    }}), 200

if __name__ == "__main__":
    if not GITHUB_SECRET:
        print("WARNING: No GITHUB_WEBHOOK_SECRET set. All requests will be accepted!")
    APP.run(host="0.0.0.0", port={webhook_port})
'''
    write_file(auto_dir / "autodeploy.py", app_py, mode=0o644)

    run(f"{shlex_quote(python3_path)} -m pip install --upgrade pip", check=False)
    run(f"{shlex_quote(python3_path)} -m pip install flask", check=False)

    p = run(f"{shlex_quote(python3_path)} -c \"import flask; print(flask.__version__)\"", check=False)
    if p.returncode != 0:
        log("⚠ Flask still not importable. Trying apt fallback...")
        run("apt-get install -y python3-flask", check=False)

    eco = f"""module.exports = {{
  apps: [
    {{
      name: "{autodeploy_name}",
      cwd: "{str(auto_dir)}",
      script: "{python3_path}",
      args: ["autodeploy.py"],
      interpreter: "none",
      autorestart: true,
      watch: false,
      env: {{
        "GITHUB_WEBHOOK_SECRET": "{github_secret}"
      }}
    }}
  ]
}};
"""
    eco_path = auto_dir / "ecosystem.config.js"
    write_file(eco_path, eco, mode=0o600)
    return eco_path, autodeploy_name


# ═══════════════════════════════════════════
# MULTI-APP DEPLOYMENT FLOW
# ═══════════════════════════════════════════

def deploy_multi_app():
    """Deploy multiple apps from a monorepo with unified nginx and autodeploy."""
    require_root()
    LOG_FILE.write_text("", encoding="utf-8")
    log("═══════════════════════════════════════════")
    log("  Deploy Wizard v3 — Multi-App Mode")
    log("═══════════════════════════════════════════")

    auto_install = prompt_yesno("Auto-install missing dependencies with apt/npm?", default="yes")
    ensure_dependencies(auto_install)
    check_swap()

    server_ip = get_public_ip()
    if server_ip:
        log(f"ℹ Server public IP: {server_ip}")

    check_apache_conflict()

    # ── Step 1: Clone or Update ──────────────────────────────────────
    log("\n═══ Step 1: GitHub clone/update ═══")
    repo = prompt("GitHub HTTPS repo URL (e.g. https://github.com/org/repo.git)")
    repo_name = repo.rstrip("/").rstrip(".git").split("/")[-1] or "my-app"
    folder = sanitize_name(prompt("Folder name to clone into /root", default=repo_name))

    gh_user, gh_token = prompt_github_credentials()

    project_dir, default_branch = clone_repo(repo, folder, gh_user, gh_token)
    log(f"✅ Repo ready at: {project_dir} (branch: {default_branch})")

    # ── Step 2: Configure Apps ───────────────────────────────────────
    log("\n═══ Step 2: Configure Apps ═══")

    apps = []
    nginx_apps = []
    used_ports: list[int] = []

    log("ℹ Typical setup: API backend + CMS/Frontend")

    # Auto-detect subdirs with package.json
    pkg_dirs = []
    if project_dir.exists():
        for d in sorted(project_dir.iterdir()):
            if d.is_dir() and not d.name.startswith(".") and (d / "package.json").exists():
                pkg_dirs.append(d.name)
    if pkg_dirs:
        log(f"ℹ Found subdirs with package.json: {', '.join(pkg_dirs)}")
    else:
        log(f"ℹ No subdirs with package.json found directly under {project_dir}")

    def prompt_subdir(label: str, default: str, exclude: str = "") -> tuple[str, Path]:
        """
        Prompt for a subdirectory relative to project_dir.
        Shows the fully resolved path and re-asks if it doesn't exist.
        Returns (subdir_name, resolved_Path).
        """
        while True:
            subdir = prompt(
                f"{label} subdirectory — relative to {project_dir}/ (e.g. 'backend' or 'apps/api')",
                default=default
            )
            # Strip leading slashes / project_dir prefix in case user pastes absolute path
            subdir = subdir.strip().lstrip("/")
            if subdir.startswith(str(project_dir).lstrip("/")):
                subdir = subdir[len(str(project_dir).lstrip("/")):]
                subdir = subdir.lstrip("/")
            resolved = project_dir / subdir
            log(f"  → Resolved path: {resolved}")
            if resolved.exists():
                return subdir, resolved
            log(f"  ⚠ That path does NOT exist inside {project_dir}")
            log(f"    Available subdirs: {', '.join(pkg_dirs) if pkg_dirs else '(none detected)'}")
            if prompt_yesno("  Use it anyway (create/skip)?", default="no"):
                return subdir, resolved
            log("  Re-enter the subdirectory name.")

    # ── App 1: API ──
    log("\n── App 1: API Configuration ──")
    api_default = next(
        (d for d in pkg_dirs if any(k in d.lower() for k in ("api", "back", "server"))),
        pkg_dirs[0] if pkg_dirs else "backend"
    )
    api_subdir, api_work_dir = prompt_subdir("API", default=api_default)

    api_name = prompt("API PM2 app name", default=sanitize_name(f"{repo_name}-api"))
    api_port = prompt_port("API local port", preferred=3000, exclude=used_ports)
    used_ports.append(api_port)
    api_path_prefix = prompt("API path prefix for change detection",
                             default=api_subdir.rstrip("/") + "/")

    # ── App 2: CMS / Frontend ──
    log("\n── App 2: CMS/Frontend Configuration ──")
    cms_default = next(
        (d for d in pkg_dirs if d != api_subdir and any(k in d.lower() for k in ("cms", "front", "web", "admin", "client", "ui", "dashboard"))),
        next((d for d in pkg_dirs if d != api_subdir), "frontend")
    )
    cms_subdir, cms_work_dir = prompt_subdir("CMS/Frontend", default=cms_default)

    cms_name = prompt("CMS PM2 app name", default=sanitize_name(f"{repo_name}-cms"))
    cms_port = prompt_port("CMS local port", preferred=3001, exclude=used_ports)
    used_ports.append(cms_port)
    cms_path_prefix = prompt("CMS path prefix for change detection",
                             default=cms_subdir.rstrip("/") + "/")

    # ── Step 3: .env files ───────────────────────────────────────────
    log("\n═══ Step 3: Environment Files ═══")

    if prompt_yesno(f"Write .env for API ({api_work_dir})?", default="yes"):
        api_env = prompt_multiline("Paste API .env now, end with __END__:")
        write_file(api_work_dir / ".env", api_env, mode=0o600)
        log(f"✅ API .env written to: {api_work_dir / '.env'}")

    if prompt_yesno(f"Write .env for CMS ({cms_work_dir})?", default="yes"):
        cms_env = prompt_multiline("Paste CMS .env now, end with __END__:")
        write_file(cms_work_dir / ".env", cms_env, mode=0o600)
        log(f"✅ CMS .env written to: {cms_work_dir / '.env'}")

    # ── Step 4: Install + Build ──────────────────────────────────────
    log("\n═══ Step 4: Install + Build ═══")

    for app_config in [
        {"name": api_name, "work_dir": api_work_dir, "port": api_port, "path_prefix": api_path_prefix},
        {"name": cms_name, "work_dir": cms_work_dir, "port": cms_port, "path_prefix": cms_path_prefix},
    ]:
        work_dir = app_config["work_dir"]
        name = app_config["name"]

        if not work_dir.exists():
            log(f"⚠ {work_dir} doesn't exist, skipping {name}")
            continue

        if not (work_dir / "package.json").exists():
            log(f"⚠ No package.json in {work_dir}, skipping install/build for {name}")
            continue

        log(f"\n── Building {name} ──")
        check_node_engines(work_dir)
        do_build = prompt_yesno(f"Run build for {name}?", default="yes")
        pm = package_install_build(work_dir, do_build)

        default_start = "npm start"
        if has_script(work_dir, "start:prod"):
            default_start = f"{pm} run start:prod"
        elif has_script(work_dir, "start"):
            default_start = f"{pm} start" if pm == "npm" else f"{pm} run start"

        start_cmd = prompt(f"{name} start command", default=default_start)

        ecosystem_path = generate_ecosystem(work_dir, name, start_cmd)

        pm2_reload(ecosystem_path, name)
        online = pm2_wait_online(name, seconds=30)

        if not online:
            if not prompt_yesno(f"{name} didn't start. Continue anyway?", default="yes"):
                raise RuntimeError(f"{name} failed to start.")
            log(f"⚠ Continuing without {name} online. Fix with: pm2 logs {name}")

        apps.append({
            "name": name,
            "work_dir": work_dir,
            "port": app_config["port"],
            "path_prefix": app_config["path_prefix"],
            "ecosystem_path": ecosystem_path,
        })

        nginx_apps.append({
            "name": name,
            "port": app_config["port"],
            "location": "/" if name == cms_name else "/api",
            "strip_prefix": name != cms_name,
        })

    pm2_setup_startup_and_logrotate()

    # ── Step 5: Domain + Nginx + SSL ─────────────────────────────────
    log("\n═══ Step 5: Domain + Nginx + SSL ═══")

    domain = prompt("Domain/subdomain (FQDN), e.g. app.example.com")
    site_name = prompt("Nginx site filename", default=sanitize_name(domain.replace(".", "-")))

    log("\nNginx routing options:")
    log("  1. Single domain with path routing (/ for CMS, /api for API)")
    log("  2. Separate domains (requires DNS for each)")
    routing = prompt("Choose routing (1 or 2)", default="1")

    api_domain = domain
    cms_domain = domain

    if routing == "1":
        nginx_apps_ordered = sorted(nginx_apps, key=lambda x: 0 if x["location"] == "/" else 1, reverse=True)
        check_nginx_conflicts(domain, site_name)
        create_nginx_multi_site(domain, site_name, nginx_apps_ordered)
    else:
        api_domain = prompt("API domain", default=f"api.{domain}")
        cms_domain = prompt("CMS domain", default=domain)
        check_nginx_conflicts(api_domain, f"{site_name}-api")
        create_nginx_site(api_domain, f"{site_name}-api", api_port)
        check_nginx_conflicts(cms_domain, f"{site_name}-cms")
        create_nginx_site(cms_domain, f"{site_name}-cms", cms_port)

    email = prompt("Email for Let's Encrypt (certbot)")
    if routing == "1":
        issue_cert(domain, email)
    else:
        issue_cert(api_domain, email)
        issue_cert(cms_domain, email)

    # ── Step 6: Autodeploy webhook ───────────────────────────────────
    log("\n═══ Step 6: Auto-deploy webhook service ═══")
    webhook_port_val = None
    autodeploy_name = None

    if prompt_yesno("Set up unified auto-deploy webhook for all apps?", default="yes"):
        webhook_port_val = prompt_port("Autodeploy webhook port", preferred=9003, exclude=used_ports)

        webhook_secret = prompt("GitHub webhook secret", required=False)
        if not webhook_secret:
            log("⚠ No webhook secret provided. All POST requests to /webhook will be accepted!")

        autodeploy_ecosystem, autodeploy_name = generate_multi_app_autodeploy(
            project_dir, apps, webhook_port_val, webhook_secret or "",
            default_branch, folder_name=folder
        )
        pm2_reload(autodeploy_ecosystem, autodeploy_name)
        pm2_wait_online(autodeploy_name, seconds=20)

        time.sleep(2)
        status, body = http_get(f"http://127.0.0.1:{webhook_port_val}/health", timeout=8)
        if status != 200:
            log(f"⚠ Autodeploy health failed: HTTP {status} → {body}")
        else:
            log("✅ Autodeploy /health OK.")

        run("pm2 save", check=False)

    # ── Summary ──────────────────────────────────────────────────────
    log("\n═══════════════════════════════════════════")
    log("  MULTI-APP DEPLOYMENT COMPLETE")
    log("═══════════════════════════════════════════")
    log(f"  Project:      {project_dir}")
    log(f"  Branch:       {default_branch}")
    log(f"  Apps:")
    for app in apps:
        log(f"    - {app['name']}: {app['work_dir']} (port {app['port']})")
    if routing == "1":
        log(f"  Domain:       https://{domain}/")
        log(f"    CMS:        https://{domain}/")
        log(f"    API:        https://{domain}/api/")
    else:
        log(f"  CMS Domain:   https://{cms_domain}/")
        log(f"  API Domain:   https://{api_domain}/")
    log(f"  Nginx site:   {site_name}")
    if webhook_port_val and autodeploy_name:
        log(f"  Autodeploy:   {autodeploy_name}")
        log(f"  Webhook URL:  http://{server_ip or '<server-ip>'}:{webhook_port_val}/webhook")
        log(f"  Health:       http://{server_ip or '<server-ip>'}:{webhook_port_val}/health")
        log(f"  Path detection: {api_path_prefix} → API, {cms_path_prefix} → CMS")
    log(f"  Logs:         {LOG_FILE}")
    log("")
    log("  Useful commands:")
    for app in apps:
        log(f"    pm2 logs {app['name']}       — view {app['name']} logs")
    log(f"    pm2 monit               — monitor all apps")
    log(f"    certbot renew --dry-run — test SSL renewal")
    log("═══════════════════════════════════════════")
    log("✅ Multi-App Deploy Wizard Finished.")


# ═══════════════════════════════════════════
# SINGLE APP FLOW
# ═══════════════════════════════════════════

def main():
    require_root()
    LOG_FILE.write_text("", encoding="utf-8")
    log("═══════════════════════════════════════════")
    log("  Deploy Wizard v3 — Comprehensive Edition")
    log("═══════════════════════════════════════════")
    log("")
    log("  Deployment Modes:")
    log("    1. Single App    — Deploy one app (API or CMS)")
    log("    2. Multi App     — Deploy API + CMS together")
    log("                       (same nginx, unified webhook)")
    log("")

    mode = prompt("Choose deployment mode (1 or 2)", default="1")

    if mode == "2":
        deploy_multi_app()
        return

    # ── Single-app flow ───────────────────────────────────────────────
    auto_install = prompt_yesno("Auto-install missing dependencies with apt/npm?", default="yes")
    ensure_dependencies(auto_install)

    check_swap()

    server_ip = get_public_ip()
    if server_ip:
        log(f"ℹ Server public IP: {server_ip}")
    else:
        log("ℹ Could not detect public IP (not blocking).")

    check_apache_conflict()

    # ── Step 1: Clone or Update ──────────────────────────────────────
    log("\n═══ Step 1: GitHub clone/update ═══")
    repo = prompt("GitHub HTTPS repo URL (e.g. https://github.com/org/repo.git)")

    repo_name = repo.rstrip("/").rstrip(".git").split("/")[-1] or "my-app"
    folder = sanitize_name(prompt("Folder name to clone into /root", default=repo_name))

    gh_user, gh_token = prompt_github_credentials()

    project_dir, default_branch = clone_repo(repo, folder, gh_user, gh_token)
    log(f"✅ Repo ready at: {project_dir} (branch: {default_branch})")

    # ── Step 2: Pick work directory (monorepo) ───────────────────────
    log("\n═══ Step 2: Work directory + .env ═══")
    work_dir = choose_work_directory(project_dir)
    log(f"ℹ Work directory: {work_dir}")

    check_node_engines(work_dir)

    env_content = prompt_multiline("Paste your .env now, end with __END__:")
    env_path = choose_env_target(project_dir)
    write_file(env_path, env_content, mode=0o600)
    log(f"✅ .env written to: {env_path}")

    maybe_extra_env(project_dir)

    # ── Step 3: Install + build ──────────────────────────────────────
    log("\n═══ Step 3: Install + build ═══")
    do_build = prompt_yesno("Run build?", default="yes")
    pm = package_install_build(work_dir, do_build)
    log("✅ Install/build completed.")

    # ── Step 4: PM2 ecosystem + start ────────────────────────────────
    log("\n═══ Step 4: PM2 ecosystem + start ═══")
    app_name = prompt("PM2 app name", default=folder)

    default_start = "npm start"
    if has_script(work_dir, "start:prod"):
        default_start = f"{pm} run start:prod"
    elif has_script(work_dir, "start"):
        default_start = f"{pm} start" if pm == "npm" else f"{pm} run start"
    start_cmd = prompt("App start command", default=default_start)

    used_ports: list[int] = []
    upstream_port = prompt_port("Local app port (the port your app listens on)",
                                preferred=3000, exclude=used_ports)
    used_ports.append(upstream_port)

    ecosystem_path = generate_ecosystem(work_dir, app_name, start_cmd)
    pm2_reload(ecosystem_path, app_name)
    online = pm2_wait_online(app_name, seconds=30)

    if online:
        time.sleep(2)
        status, body = http_get(f"http://127.0.0.1:{upstream_port}/", timeout=8)
        if status == 0:
            log(f"⚠ Local app check failed at http://127.0.0.1:{upstream_port}/ → {body}")
            log("  (OK if your app doesn't serve '/'. Check pm2 logs.)")
        else:
            log(f"✅ Local app reachable (HTTP {status}).")
    else:
        if not prompt_yesno("App didn't start. Continue with Nginx/SSL setup anyway?", default="yes"):
            raise RuntimeError("App failed to start. Fix the issue and rerun the wizard.")
        log(f"⚠ Continuing. Fix startup issue with: pm2 logs {app_name}")

    pm2_setup_startup_and_logrotate()

    # ── Step 5: Domain + Nginx + SSL ─────────────────────────────────
    log("\n═══ Step 5: Domain + Nginx + SSL ═══")
    domain = prompt("Domain/subdomain (FQDN), e.g. api.example.com")
    site_name = prompt("Nginx site filename", default=sanitize_name(domain.replace(".", "-")))

    check_nginx_conflicts(domain, site_name)
    create_nginx_site(domain, site_name, upstream_port)

    status, body = http_get(f"http://{domain}/", timeout=10)
    if status == 0:
        log(f"⚠ Domain HTTP check failed: http://{domain}/ → {body}")
    else:
        log(f"✅ Domain HTTP reachable (HTTP {status}).")

    email = prompt("Email for Let's Encrypt (certbot)")
    issue_cert(domain, email)

    status, body = http_get(f"https://{domain}/", timeout=12)
    if status == 0:
        log(f"⚠ HTTPS check failed: https://{domain}/ → {body}")
    else:
        log(f"✅ Domain HTTPS reachable (HTTP {status}).")

    # ── Step 6: Autodeploy webhook ───────────────────────────────────
    log("\n═══ Step 6: Auto-deploy webhook service ═══")
    webhook_port_val = None
    autodeploy_name = None

    if prompt_yesno("Set up auto-deploy webhook?", default="yes"):
        webhook_port_val = prompt_port("Autodeploy webhook port",
                                       preferred=9003, exclude=used_ports)

        webhook_secret = prompt("GitHub webhook secret (same you will set in GitHub webhook settings)",
                                required=False)
        if not webhook_secret:
            log("⚠ No webhook secret provided.")

        autodeploy_ecosystem, autodeploy_name = generate_autodeploy(
            work_dir, ecosystem_path, webhook_port_val, webhook_secret or "",
            default_branch, pm, folder_name=folder)
        pm2_reload(autodeploy_ecosystem, autodeploy_name)
        pm2_wait_online(autodeploy_name, seconds=20)

        time.sleep(2)
        status, body = http_get(f"http://127.0.0.1:{webhook_port_val}/health", timeout=8)
        if status != 200:
            log(f"⚠ Autodeploy health failed: HTTP {status} → {body}")
        else:
            log("✅ Autodeploy /health OK.")

        run("pm2 save", check=False)

    # ── Summary ──────────────────────────────────────────────────────
    log("\n═══════════════════════════════════════════")
    log("  DEPLOYMENT COMPLETE")
    log("═══════════════════════════════════════════")
    log(f"  Project:      {project_dir}")
    log(f"  Work dir:     {work_dir}")
    log(f"  Branch:       {default_branch}")
    log(f"  .env:         {env_path}")
    log(f"  PM2 app:      {app_name} (ecosystem: {ecosystem_path})")
    log(f"  App port:     {upstream_port}")
    log(f"  Domain:       https://{domain}/")
    log(f"  Nginx site:   {site_name}")
    if webhook_port_val and autodeploy_name:
        log(f"  Autodeploy:   {autodeploy_name}")
        log(f"  Webhook URL:  http://{server_ip or '<server-ip>'}:{webhook_port_val}/webhook")
        log(f"  Health:       http://{server_ip or '<server-ip>'}:{webhook_port_val}/health")
    log(f"  Logs:         {LOG_FILE}")
    log("")
    log("  Useful commands:")
    log(f"    pm2 logs {app_name}          — view app logs")
    log(f"    pm2 restart {app_name}       — restart app")
    log(f"    pm2 monit                    — monitor all apps")
    log(f"    certbot renew --dry-run      — test SSL renewal")
    log("═══════════════════════════════════════════")
    log("✅ Deploy Wizard v3 Finished.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("\n⚠ Interrupted by user.")
        sys.exit(1)
    except Exception as e:
        log(f"\n❌ ERROR: {e}")
        log(f"Check logs: {LOG_FILE}")
        if _rollback_actions:
            if prompt_yesno("Rollback all changes?", default="no"):
                do_rollback()
            else:
                log("⚠ Skipping rollback. Partial deployment may exist.")
        # Exit with error code but do NOT re-raise (no traceback spam)
        sys.exit(1)
