#!/usr/bin/env python3
"""
CPanel Deployment System - Web-based powerful deployment panel
Converts the deployment wizard into a modern web interface
Features: Multi-project support, SQLite persistence, webhooks, real-time logs
"""

import os
import re
import sys
import json
import time
import hmac
import hashlib
import subprocess
import threading
import secrets
import socket
import ipaddress
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, render_template, request, jsonify, session, redirect, url_for, flash, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from flask_wtf.csrf import CSRFProtect
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import dotenv
from urllib import request as _urlreq, error as _urlerr

# ═══════════════════════════════════════════
# Setup
# ═══════════════════════════════════════════

BASE_DIR = Path(__file__).parent
LOG_DIR = BASE_DIR / "logs"

# On Linux as root: deploy to /root; otherwise local deployments dir
try:
    is_root = os.geteuid() == 0
except AttributeError:
    is_root = False  # Windows
DEPLOYMENTS_DIR = Path("/root") if is_root else BASE_DIR / "deployments"

LOG_DIR.mkdir(exist_ok=True)
DEPLOYMENTS_DIR.mkdir(exist_ok=True)

dotenv.load_dotenv(BASE_DIR / '.env')

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', secrets.token_hex(32))
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{BASE_DIR}/cpanel.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB

# Cross-origin session cookies (needed when frontend is on a different port/domain)
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_HTTPONLY'] = True
# In production with HTTPS: set SESSION_COOKIE_SECURE=True and SESSION_COOKIE_SAMESITE='None'

db = SQLAlchemy(app)
csrf = CSRFProtect(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'
login_manager.login_message = 'Please log in to access the panel.'

# CORS: allow the Next.js frontend to make credentialed requests
_cors_origin = os.environ.get('CORS_ORIGIN', 'http://localhost:3000')
CORS(app,
     origins=[_cors_origin],
     supports_credentials=True,
     allow_headers=['Content-Type', 'X-CSRFToken', 'Authorization'],
     methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])


# ═══════════════════════════════════════════
# Database Models
# ═══════════════════════════════════════════

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    email = db.Column(db.String(120), unique=True)
    is_admin = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    projects = db.relationship('Project', backref='owner', lazy=True, cascade='all, delete-orphan')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class GitHubCredential(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    username = db.Column(db.String(120), nullable=False)
    token = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    user = db.relationship('User', backref='github_creds')


class Project(db.Model):
    """A project represents a GitHub repository. It owns one or more Apps,
    each of which is an independently-deployable piece of the repo (e.g.
    a CMS, an API, and a web frontend living in a monorepo).
    """
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    name = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text)
    github_url = db.Column(db.String(500), nullable=False)
    github_branch = db.Column(db.String(120), default='main')
    folder_name = db.Column(db.String(255), nullable=False)

    enable_webhook = db.Column(db.Boolean, default=True)
    webhook_secret = db.Column(db.String(255), default=lambda: secrets.token_hex(32))
    auto_deploy = db.Column(db.Boolean, default=False)
    github_hook_id = db.Column(db.Integer)  # id of the hook we created in GitHub, if any

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # ── Deprecated columns (kept so existing SQLite DBs still load) ──
    # These were used before Apps existed; a startup migration copies
    # them into a default App for each legacy Project. Do not reference
    # in new code.
    project_type = db.Column(db.String(50))
    subdirectory = db.Column(db.String(255))
    app_port = db.Column(db.Integer)
    webhook_port = db.Column(db.Integer)
    package_manager = db.Column(db.String(20))
    build_command = db.Column(db.String(500))
    start_command = db.Column(db.String(500))
    pm2_name = db.Column(db.String(255))
    env_content = db.Column(db.Text)
    domain = db.Column(db.String(255))
    enable_ssl = db.Column(db.Boolean)
    client_max_body = db.Column(db.String(20))
    status = db.Column(db.String(50))
    last_deployment = db.Column(db.DateTime)

    apps = db.relationship('App', backref='project', lazy=True, cascade='all, delete-orphan', order_by='App.created_at')
    deployments = db.relationship('Deployment', backref='project', lazy=True, cascade='all, delete-orphan')

    def to_dict(self, include_apps=True):
        d = {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'github_url': self.github_url,
            'github_branch': self.github_branch,
            'folder_name': self.folder_name,
            'enable_webhook': self.enable_webhook,
            'webhook_secret': self.webhook_secret,
            'auto_deploy': self.auto_deploy,
            'github_hook_id': self.github_hook_id,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_apps:
            d['apps'] = [a.to_dict() for a in self.apps]
        return d


class App(db.Model):
    """A deployable unit inside a Project — one Project can have many Apps
    (e.g. ./cms, ./api, ./web inside a single monorepo)."""
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)

    name = db.Column(db.String(255), nullable=False)
    app_type = db.Column(db.String(50), default='website')  # website / api / cms / custom
    subdirectory = db.Column(db.String(255))

    package_manager = db.Column(db.String(20), default='npm')
    build_command = db.Column(db.String(500))
    start_command = db.Column(db.String(500))
    app_port = db.Column(db.Integer)
    pm2_name = db.Column(db.String(255))

    env_content = db.Column(db.Text)

    domain = db.Column(db.String(255))
    enable_ssl = db.Column(db.Boolean, default=True)
    client_max_body = db.Column(db.String(20), default='100M')

    status = db.Column(db.String(50), default='created')
    last_deployment = db.Column(db.DateTime)

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    deployments = db.relationship('Deployment', backref='app', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'project_id': self.project_id,
            'name': self.name,
            'app_type': self.app_type,
            'subdirectory': self.subdirectory,
            'package_manager': self.package_manager,
            'build_command': self.build_command,
            'start_command': self.start_command,
            'app_port': self.app_port,
            'pm2_name': self.pm2_name,
            'env_content': self.env_content,
            'domain': self.domain,
            'enable_ssl': self.enable_ssl,
            'client_max_body': self.client_max_body,
            'status': self.status,
            'last_deployment': self.last_deployment.isoformat() if self.last_deployment else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class Deployment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    app_id = db.Column(db.Integer, db.ForeignKey('app.id'))  # new deployments reference an App

    status = db.Column(db.String(50), default='pending')
    branch = db.Column(db.String(120))
    commit_hash = db.Column(db.String(40))

    log_file = db.Column(db.String(255))
    error_message = db.Column(db.Text)

    triggered_by = db.Column(db.String(50))

    started_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    completed_at = db.Column(db.DateTime)
    duration_seconds = db.Column(db.Integer)

    def to_dict(self):
        return {
            'id': self.id,
            'project_id': self.project_id,
            'app_id': self.app_id,
            'status': self.status,
            'branch': self.branch,
            'commit_hash': self.commit_hash,
            'triggered_by': self.triggered_by,
            'error_message': self.error_message,
            'started_at': self.started_at.isoformat(),
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'duration_seconds': self.duration_seconds,
        }


# ═══════════════════════════════════════════
# Login Management
# ═══════════════════════════════════════════

def _sqlite_columns(table):
    """Return the set of existing column names for a SQLite table."""
    rows = db.session.execute(db.text(f'PRAGMA table_info("{table}")')).fetchall()
    return {r[1] for r in rows}


def migrate_schema():
    """Idempotent migration from the pre-App single-table schema.

    Safe to run on every startup. Does three things:
      1. ADD COLUMN for newly-introduced columns on existing tables
         (SQLite lets us do this without touching data).
      2. Create a default App for each legacy Project that has none,
         copying the Project's old deployment fields into it.
      3. Back-fill Deployment.app_id from its project's first App.
    """
    try:
        # 1. ADD COLUMN (ignore "duplicate column" errors)
        def add_col(table, col_def):
            name = col_def.split()[0].strip('"')
            if name not in _sqlite_columns(table):
                db.session.execute(db.text(f'ALTER TABLE "{table}" ADD COLUMN {col_def}'))
        add_col('project', 'github_hook_id INTEGER')
        add_col('deployment', 'app_id INTEGER REFERENCES app(id)')
        db.session.commit()

        # 2. Backfill Apps for legacy Projects
        legacy_projects = [p for p in Project.query.all() if not p.apps]
        for p in legacy_projects:
            # Derive a sensible default App name from the project type
            default_name = (p.project_type or 'app').capitalize() if p.project_type else 'App'
            new_app = App(
                project_id=p.id,
                name=default_name,
                app_type=p.project_type or 'website',
                subdirectory=p.subdirectory,
                package_manager=p.package_manager or 'npm',
                build_command=p.build_command,
                start_command=p.start_command,
                app_port=p.app_port,
                pm2_name=p.pm2_name,
                env_content=p.env_content,
                domain=p.domain,
                enable_ssl=p.enable_ssl if p.enable_ssl is not None else True,
                client_max_body=p.client_max_body or '100M',
                status=p.status or 'created',
                last_deployment=p.last_deployment,
                created_at=p.created_at or datetime.now(timezone.utc),
            )
            db.session.add(new_app)
        db.session.commit()

        # 3. Back-fill Deployment.app_id where missing
        orphans = Deployment.query.filter_by(app_id=None).all()
        for dep in orphans:
            project = db.session.get(Project, dep.project_id)
            if project and project.apps:
                dep.app_id = project.apps[0].id
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        print(f'[migrate_schema] WARNING: migration encountered an error: {e}', file=sys.stderr)


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


@login_manager.unauthorized_handler
def unauthorized():
    """Return JSON 401 for API requests; redirect only for HTML pages."""
    if request.path.startswith('/api/'):
        return jsonify({'error': 'Unauthorized'}), 401
    return redirect(url_for('login'))


# ═══════════════════════════════════════════
# JSON Auth API (used by Next.js frontend)
# ═══════════════════════════════════════════

@app.route('/api/auth/login', methods=['POST'])
@csrf.exempt
def api_login():
    data = request.get_json(silent=True) or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return jsonify({'error': 'Username and password required'}), 400

    user = User.query.filter_by(username=username).first()
    if user and user.check_password(password):
        login_user(user, remember=data.get('remember', False))
        return jsonify({
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'is_admin': user.is_admin,
        })
    return jsonify({'error': 'Invalid username or password'}), 401


@app.route('/api/auth/logout', methods=['POST'])
@csrf.exempt
@login_required
def api_logout():
    logout_user()
    return jsonify({'status': 'logged out'})


@app.route('/api/auth/setup', methods=['POST'])
@csrf.exempt
def api_setup():
    if User.query.first():
        return jsonify({'error': 'Setup already complete. Please log in.'}), 400

    data = request.get_json(silent=True) or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')
    email = data.get('email', '').strip()

    if not username or len(username) < 3:
        return jsonify({'error': 'Username must be at least 3 characters'}), 400
    if not password or len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already exists'}), 400

    user = User(username=username, email=email or None, is_admin=True)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    login_user(user)
    return jsonify({
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'is_admin': user.is_admin,
    }), 201


# ═══════════════════════════════════════════
# Flask Template Routes (kept for server-side use)
# ═══════════════════════════════════════════

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))

    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user, remember=request.form.get('remember'))
            return redirect(url_for('dashboard'))
        flash('Invalid username or password', 'error')

    return render_template('login.html')


@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))


@app.route('/setup', methods=['GET', 'POST'])
def setup():
    if User.query.first():
        return redirect(url_for('login'))

    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        email = request.form.get('email', '').strip()

        if not username or len(username) < 3:
            flash('Username must be at least 3 characters', 'error')
        elif not password or len(password) < 6:
            flash('Password must be at least 6 characters', 'error')
        elif User.query.filter_by(username=username).first():
            flash('Username already exists', 'error')
        else:
            user = User(username=username, email=email or None, is_admin=True)
            user.set_password(password)
            db.session.add(user)
            db.session.commit()
            flash('Admin user created! Please log in.', 'success')
            return redirect(url_for('login'))

    return render_template('setup.html')


@app.route('/')
@login_required
def dashboard():
    projects = Project.query.filter_by(user_id=current_user.id).all()
    all_apps = [a for p in projects for a in p.apps]
    stats = {
        'total_projects': len(projects),
        'deployed': sum(1 for a in all_apps if a.status == 'deployed'),
        'errors': sum(1 for a in all_apps if a.status == 'error'),
        'deploying': sum(1 for a in all_apps if a.status == 'deploying'),
    }
    return render_template('dashboard.html', projects=projects, stats=stats)


# ═══════════════════════════════════════════
# JSON Projects API
# ═══════════════════════════════════════════

@app.route('/api/current-user')
@login_required
def api_current_user():
    return jsonify({
        'id': current_user.id,
        'username': current_user.username,
        'email': current_user.email,
        'is_admin': current_user.is_admin,
    })


@app.route('/api/projects', methods=['GET'])
@login_required
def api_projects():
    projects = Project.query.filter_by(user_id=current_user.id).all()
    return jsonify([p.to_dict() for p in projects])


@app.route('/api/projects', methods=['POST'])
@csrf.exempt
@login_required
def api_create_project():
    """Create a repo-level Project. Apps are added separately via /api/project/<id>/apps."""
    data = request.get_json(silent=True) or {}
    name = data.get('name', '').strip()
    folder_name = data.get('folder_name', '').strip()
    github_url = data.get('github_url', '').strip()

    if not name:
        return jsonify({'error': 'Project name is required'}), 400
    if not folder_name:
        return jsonify({'error': 'Folder name is required'}), 400
    if not github_url:
        return jsonify({'error': 'GitHub URL is required'}), 400

    project = Project(
        user_id=current_user.id,
        name=name,
        description=data.get('description', ''),
        github_url=github_url,
        github_branch=data.get('github_branch', 'main') or 'main',
        folder_name=folder_name,
        auto_deploy=bool(data.get('auto_deploy', False)),
        enable_webhook=bool(data.get('enable_webhook', True)),
    )
    db.session.add(project)
    db.session.commit()

    # If auto_deploy was enabled, try to install the webhook in GitHub now.
    webhook_result = None
    if project.auto_deploy and project.enable_webhook:
        webhook_result = _sync_github_webhook(project)

    body = project.to_dict()
    if webhook_result:
        body['github_webhook'] = webhook_result
    return jsonify(body), 201


@app.route('/api/project/<int:project_id>', methods=['GET'])
@login_required
def api_get_project(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    return jsonify(project.to_dict())


@app.route('/api/project/<int:project_id>', methods=['PUT'])
@csrf.exempt
@login_required
def api_update_project(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    data = request.get_json(silent=True) or {}
    prev_auto_deploy = project.auto_deploy

    for field in ['name', 'description', 'github_url', 'github_branch', 'folder_name']:
        if field in data:
            setattr(project, field, data[field])

    if 'enable_webhook' in data:
        project.enable_webhook = bool(data['enable_webhook'])
    if 'auto_deploy' in data:
        project.auto_deploy = bool(data['auto_deploy'])

    project.updated_at = datetime.now(timezone.utc)
    db.session.commit()

    webhook_result = None
    if (
        project.auto_deploy != prev_auto_deploy
        or 'github_url' in data
        or 'enable_webhook' in data
    ):
        webhook_result = _sync_github_webhook(project)

    body = project.to_dict()
    if webhook_result:
        body['github_webhook'] = webhook_result
    return jsonify(body)


@app.route('/api/project/<int:project_id>', methods=['DELETE'])
@csrf.exempt
@login_required
def api_delete_project(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    # Best-effort cleanup of the GitHub webhook before we delete the row
    if project.github_hook_id:
        _delete_github_webhook(project)

    db.session.delete(project)
    db.session.commit()
    return jsonify({'status': 'deleted'})


# ═══════════════════════════════════════════
# App API (the actual deployable units)
# ═══════════════════════════════════════════

def _parse_port(v):
    try:
        n = int(v)
        return n if 1 <= n <= 65535 else None
    except (ValueError, TypeError):
        return None


def _check_port_conflict(port, exclude_app_id=None):
    """Return a reason string if the port is unusable, or None if it is free.

    Checks (in order): other Ascend apps -> Nginx listen directives -> any live listener.
    Uses the /api/system caches so it's cheap enough to call on every create/update.
    """
    if not port:
        return None
    # Another Ascend app
    clash = App.query.filter(App.app_port == port).filter(App.id != (exclude_app_id or -1)).first()
    if clash:
        return f"port {port} is already used by another Ascend app ({clash.name})"
    # Nginx sites
    for site in _cached('nginx', _SYSTEM_TTL, _load_nginx_sites):
        if port in site.get('listen_ports', []):
            return f"port {port} is already configured in Nginx site '{site['name']}'"
    # Any live listener. On updates we only call this when the port is changing,
    # so the app's current PM2 process does not block normal edits.
    for p in _cached('ports', _SYSTEM_TTL, _load_listening_ports):
        if p['port'] == port:
            return f"port {port} is currently bound by process '{p.get('process') or 'unknown'}'"
    return None


def _used_app_ports(exclude_app_id=None):
    used = {
        p
        for (p,) in App.query.with_entities(App.app_port).filter(App.app_port.isnot(None)).all()
        if p
    }
    if exclude_app_id:
        current = db.session.get(App, exclude_app_id)
        if current and current.app_port:
            used.discard(current.app_port)
    for row in _cached('ports', _SYSTEM_TTL, _load_listening_ports):
        if row.get('port'):
            used.add(row['port'])
    for site in _cached('nginx', _SYSTEM_TTL, _load_nginx_sites):
        used.update(site.get('listen_ports', []))
    return used


def _suggest_app_port(start=3000, end=65535, exclude_app_id=None):
    try:
        start = int(start)
    except (TypeError, ValueError):
        start = 3000
    start = max(1, min(start, 65535))
    end = max(start, min(int(end or 65535), 65535))

    used = _used_app_ports(exclude_app_id=exclude_app_id)
    for port in range(start, end + 1):
        if port not in used:
            return port
    return None


def _normalize_domain(domain):
    domain = (domain or '').strip().lower()
    domain = re.sub(r'^https?://', '', domain)
    domain = domain.split('/')[0].split(':')[0].strip().strip('.')
    return domain or None


def _is_public_ip(value):
    try:
        ip = ipaddress.ip_address(value)
        return ip.is_global
    except ValueError:
        return False


def _load_server_public_ips():
    configured = (
        os.environ.get('ASCEND_PUBLIC_IPS')
        or os.environ.get('PANEL_PUBLIC_IPS')
        or os.environ.get('PANEL_PUBLIC_IP')
        or ''
    )
    ips = {
        item.strip()
        for item in configured.replace(';', ',').split(',')
        if item.strip()
    }

    for cmd in (['hostname', '-I'], ['ip', '-o', 'addr', 'show', 'scope', 'global']):
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
            if result.returncode == 0:
                for token in re.findall(r'(?<![\w:])(?:\d{1,3}\.){3}\d{1,3}(?![\w:])|[0-9a-fA-F:]{3,}', result.stdout):
                    token = token.split('/')[0]
                    if _is_public_ip(token):
                        ips.add(token)
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

    # Last resort for NAT/cloud hosts. Cached by _cached(), so this will not run often.
    if not ips:
        for url in ('https://api.ipify.org', 'https://api64.ipify.org'):
            try:
                with _urlreq.urlopen(url, timeout=3) as resp:
                    ip = resp.read().decode('utf-8', errors='replace').strip()
                    if _is_public_ip(ip):
                        ips.add(ip)
            except Exception:
                pass

    return sorted(ips)


def _resolve_domain_ips(domain):
    domain = _normalize_domain(domain)
    if not domain:
        return []
    resolved = set()
    for family in (socket.AF_INET, socket.AF_INET6):
        try:
            for item in socket.getaddrinfo(domain, None, family, socket.SOCK_STREAM):
                resolved.add(item[4][0])
        except socket.gaierror:
            pass
    return sorted(resolved)


def _check_domain_points_to_server(domain):
    domain = _normalize_domain(domain)
    if not domain:
        return {'ok': True, 'domain': None, 'domain_ips': [], 'server_ips': []}

    domain_ips = _resolve_domain_ips(domain)
    server_ips = _cached('server_public_ips', 60, _load_server_public_ips)
    matches = sorted(set(domain_ips) & set(server_ips))

    if not domain_ips:
        return {
            'ok': False,
            'domain': domain,
            'domain_ips': [],
            'server_ips': server_ips,
            'error': f'{domain} does not resolve to any A/AAAA record yet.',
        }
    if not server_ips:
        return {
            'ok': False,
            'domain': domain,
            'domain_ips': domain_ips,
            'server_ips': [],
            'error': 'Could not determine this server public IP. Set ASCEND_PUBLIC_IPS in .env.',
        }
    if not matches:
        return {
            'ok': False,
            'domain': domain,
            'domain_ips': domain_ips,
            'server_ips': server_ips,
            'error': (
                f'{domain} resolves to {", ".join(domain_ips)}, but this server is '
                f'{", ".join(server_ips)}. Point the domain DNS to this server before enabling SSL.'
            ),
        }
    return {
        'ok': True,
        'domain': domain,
        'domain_ips': domain_ips,
        'server_ips': server_ips,
        'matches': matches,
    }


def _domain_validation_response(domain):
    check = _check_domain_points_to_server(domain)
    if check.get('ok'):
        return None
    return jsonify({'error': check['error'], 'dns': check}), 409


def _app_fields_from_dict(data, allow_all=True):
    """Extract App fields from request JSON, validated/cleaned."""
    out = {}
    for field in ['name', 'app_type', 'subdirectory', 'package_manager',
                  'build_command', 'start_command', 'pm2_name',
                  'env_content', 'domain', 'client_max_body']:
        if field in data:
            val = data[field]
            val = (val.strip() if isinstance(val, str) else val) or None
            out[field] = _normalize_domain(val) if field == 'domain' else val
    if 'enable_ssl' in data:
        out['enable_ssl'] = bool(data['enable_ssl'])
    if 'app_port' in data and allow_all:
        out['app_port'] = _parse_port(data['app_port'])
    return out


@app.route('/api/project/<int:project_id>/apps', methods=['GET'])
@login_required
def api_list_apps(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    return jsonify([a.to_dict() for a in project.apps])


@app.route('/api/project/<int:project_id>/apps', methods=['POST'])
@csrf.exempt
@login_required
def api_create_app(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'App name is required'}), 400

    fields = _app_fields_from_dict(data)
    port = fields.get('app_port')
    if port:
        conflict = _check_port_conflict(port)
        if conflict:
            return jsonify({'error': conflict}), 409
    if fields.get('domain') and fields.get('enable_ssl', True):
        dns_error = _domain_validation_response(fields['domain'])
        if dns_error:
            return dns_error

    new_app = App(project_id=project.id, name=name)
    for k, v in fields.items():
        setattr(new_app, k, v)
    # Auto-generate a pm2_name if not provided
    if not new_app.pm2_name:
        new_app.pm2_name = f"{project.folder_name}-{re.sub(r'[^a-zA-Z0-9_-]+', '-', name.lower())}"
    db.session.add(new_app)
    db.session.commit()
    return jsonify(new_app.to_dict()), 201


@app.route('/api/app/<int:app_id>', methods=['GET'])
@login_required
def api_get_app(app_id):
    a = App.query.get_or_404(app_id)
    if a.project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    return jsonify(a.to_dict())


@app.route('/api/app/<int:app_id>', methods=['PUT'])
@csrf.exempt
@login_required
def api_update_app(app_id):
    a = App.query.get_or_404(app_id)
    if a.project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    data = request.get_json(silent=True) or {}
    fields = _app_fields_from_dict(data)

    if 'app_port' in fields and fields['app_port'] and fields['app_port'] != a.app_port:
        conflict = _check_port_conflict(fields['app_port'], exclude_app_id=a.id)
        if conflict:
            return jsonify({'error': conflict}), 409
    next_domain = fields['domain'] if 'domain' in fields else a.domain
    next_enable_ssl = fields['enable_ssl'] if 'enable_ssl' in fields else a.enable_ssl
    if next_domain and next_enable_ssl:
        dns_error = _domain_validation_response(next_domain)
        if dns_error:
            return dns_error

    for k, v in fields.items():
        setattr(a, k, v)
    a.updated_at = datetime.now(timezone.utc)
    db.session.commit()
    return jsonify(a.to_dict())


@app.route('/api/app/<int:app_id>', methods=['DELETE'])
@csrf.exempt
@login_required
def api_delete_app(app_id):
    a = App.query.get_or_404(app_id)
    if a.project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    # Best-effort: stop the pm2 process so the port is freed
    if a.pm2_name:
        try:
            subprocess.run(['pm2', 'delete', a.pm2_name], capture_output=True, timeout=10)
        except Exception:
            pass

    db.session.delete(a)
    db.session.commit()
    return jsonify({'status': 'deleted'})


@app.route('/api/app/<int:app_id>/deploy', methods=['POST'])
@csrf.exempt
@login_required
def api_deploy_app(app_id):
    a = App.query.get_or_404(app_id)
    if a.project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    cred = GitHubCredential.query.filter_by(user_id=current_user.id).first()
    if not cred:
        return jsonify({'error': 'No GitHub credentials configured. Add credentials in Settings.'}), 400
    if a.status == 'deploying':
        return jsonify({'error': 'A deployment is already in progress for this app'}), 409

    deployment = Deployment(
        project_id=a.project_id,
        app_id=a.id,
        status='pending',
        branch=a.project.github_branch,
        triggered_by='manual',
    )
    db.session.add(deployment)
    a.status = 'deploying'
    db.session.commit()

    threading.Thread(
        target=deploy_app_bg,
        args=(deployment.id, cred.username, cred.token),
        daemon=True,
    ).start()
    return jsonify({'id': deployment.id, 'status': 'pending'})


@app.route('/api/app/<int:app_id>/deployments', methods=['GET'])
@login_required
def api_app_deployments(app_id):
    a = App.query.get_or_404(app_id)
    if a.project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    deployments = Deployment.query.filter_by(app_id=a.id).order_by(
        Deployment.started_at.desc()
    ).limit(20).all()
    return jsonify([d.to_dict() for d in deployments])


# ═══════════════════════════════════════════
# Legacy deploy-all endpoint — deploys every app in the project
# ═══════════════════════════════════════════

@app.route('/api/project/<int:project_id>/deploy', methods=['POST'])
@csrf.exempt
@login_required
def api_deploy(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    cred = GitHubCredential.query.filter_by(user_id=current_user.id).first()
    if not cred:
        return jsonify({'error': 'No GitHub credentials configured. Add credentials in Settings.'}), 400
    if not project.apps:
        return jsonify({'error': 'Project has no apps yet — add one before deploying'}), 400

    deployment_ids = []
    for a in project.apps:
        if a.status == 'deploying':
            continue
        dep = Deployment(
            project_id=project.id, app_id=a.id,
            status='pending', branch=project.github_branch, triggered_by='manual',
        )
        db.session.add(dep)
        a.status = 'deploying'
        db.session.commit()
        threading.Thread(
            target=deploy_app_bg,
            args=(dep.id, cred.username, cred.token),
            daemon=True,
        ).start()
        deployment_ids.append(dep.id)

    return jsonify({'deployment_ids': deployment_ids, 'status': 'pending'})


@app.route('/api/project/<int:project_id>/deployments', methods=['GET'])
@login_required
def api_project_deployments(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    deployments = Deployment.query.filter_by(project_id=project_id).order_by(
        Deployment.started_at.desc()
    ).limit(50).all()
    return jsonify([d.to_dict() for d in deployments])


@app.route('/api/deployment/<int:deployment_id>/log')
@login_required
def api_deployment_log(deployment_id):
    deployment = Deployment.query.get_or_404(deployment_id)
    if deployment.project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    if not deployment.log_file or not Path(deployment.log_file).exists():
        return jsonify({'log': '', 'status': deployment.status})

    log_content = Path(deployment.log_file).read_text(encoding='utf-8', errors='replace')
    return jsonify({'log': log_content, 'status': deployment.status})


@app.route('/api/deployment/<int:deployment_id>/status')
@login_required
def api_deployment_status(deployment_id):
    deployment = Deployment.query.get_or_404(deployment_id)
    if deployment.project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    return jsonify(deployment.to_dict())


# ═══════════════════════════════════════════
# GitHub Webhook (inbound from GitHub push)
# ═══════════════════════════════════════════

def _parse_github_repo(url):
    """Extract (owner, repo) from a GitHub URL. Returns (None, None) on failure."""
    if not url:
        return None, None
    m = re.search(r'github\.com[:/]+([\w.-]+)/([\w.-]+?)(?:\.git)?/?$', url.strip())
    if not m:
        return None, None
    return m.group(1), m.group(2)


def _github_api(method, path, token, body=None, timeout=10):
    """Minimal GitHub API client using urllib. Returns (status, json|None)."""
    req = _urlreq.Request(
        f'https://api.github.com{path}',
        method=method,
        headers={
            'Accept': 'application/vnd.github+json',
            'Authorization': f'token {token}',
            'User-Agent': 'Ascend-Panel',
            'X-GitHub-Api-Version': '2022-11-28',
        },
        data=json.dumps(body).encode() if body is not None else None,
    )
    if body is not None:
        req.add_header('Content-Type', 'application/json')
    try:
        with _urlreq.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode('utf-8', errors='replace') or 'null'
            return resp.status, json.loads(raw)
    except _urlerr.HTTPError as e:
        raw = (e.read() or b'').decode('utf-8', errors='replace')
        try:
            return e.code, json.loads(raw) if raw else None
        except json.JSONDecodeError:
            return e.code, {'message': raw}
    except (_urlerr.URLError, TimeoutError) as e:
        return 0, {'message': str(e)}


def _sync_github_webhook(project):
    """Ensure GitHub has a webhook matching this project's auto_deploy state.

    - If auto_deploy=True and enable_webhook=True: create or update a GitHub
      webhook that points at /webhook/github/<secret>.
    - If auto_deploy=False or enable_webhook=False: delete the stored webhook.
    Returns a dict describing the outcome — never raises."""
    cred = GitHubCredential.query.filter_by(user_id=project.user_id).first()
    if not cred:
        return {'status': 'skipped', 'reason': 'no GitHub credentials on file'}

    owner, repo = _parse_github_repo(project.github_url)
    if not owner or not repo:
        return {'status': 'skipped', 'reason': 'could not parse github_url'}

    base = _public_panel_url()
    if not base:
        return {'status': 'skipped', 'reason': 'panel URL unknown (set PANEL_PUBLIC_URL env var)'}
    hook_url = f'{base}/webhook/github/{project.webhook_secret}'

    if not project.auto_deploy or not project.enable_webhook:
        # Turn it off
        if project.github_hook_id:
            status, _ = _github_api('DELETE',
                                    f'/repos/{owner}/{repo}/hooks/{project.github_hook_id}',
                                    cred.token)
            project.github_hook_id = None
            db.session.commit()
            return {'status': 'deleted' if status in (204, 404) else f'delete_failed({status})'}
        return {'status': 'disabled'}

    # Turn it on / update it
    config = {
        'url': hook_url,
        'content_type': 'json',
        'secret': project.webhook_secret,
        'insecure_ssl': '0',
    }
    payload = {'name': 'web', 'active': True, 'events': ['push'], 'config': config}

    if project.github_hook_id:
        status, resp = _github_api(
            'PATCH', f'/repos/{owner}/{repo}/hooks/{project.github_hook_id}',
            cred.token, payload,
        )
        if status == 200:
            return {'status': 'updated', 'hook_id': project.github_hook_id, 'url': hook_url}
        if status == 404:
            project.github_hook_id = None  # fall through to create
            db.session.commit()
        else:
            return {'status': 'update_failed', 'code': status, 'message': (resp or {}).get('message')}

    status, resp = _github_api('POST', f'/repos/{owner}/{repo}/hooks', cred.token, payload)
    if status in (200, 201) and isinstance(resp, dict) and 'id' in resp:
        project.github_hook_id = resp['id']
        db.session.commit()
        return {'status': 'created', 'hook_id': resp['id'], 'url': hook_url}
    return {'status': 'create_failed', 'code': status, 'message': (resp or {}).get('message')}


def _delete_github_webhook(project):
    cred = GitHubCredential.query.filter_by(user_id=project.user_id).first()
    if not cred or not project.github_hook_id:
        return
    owner, repo = _parse_github_repo(project.github_url)
    if not owner or not repo:
        return
    _github_api('DELETE', f'/repos/{owner}/{repo}/hooks/{project.github_hook_id}', cred.token)


def _public_panel_url():
    """Return the base URL GitHub should hit to reach our webhook endpoint.

    Priority: PANEL_PUBLIC_URL env var → X-Forwarded-Host header of the current
    request → Host header. Must be reachable from the public internet, so
    callers that configure a real domain should set PANEL_PUBLIC_URL.
    """
    explicit = os.environ.get('PANEL_PUBLIC_URL', '').strip().rstrip('/')
    if explicit:
        return explicit
    try:
        if request:
            proto = request.headers.get('X-Forwarded-Proto', 'http')
            host = request.headers.get('X-Forwarded-Host') or request.headers.get('Host')
            if host:
                return f'{proto}://{host}'
    except RuntimeError:
        # Outside of a request context
        pass
    return None


@app.route('/webhook/github/<webhook_secret>', methods=['POST'])
@csrf.exempt
def github_webhook(webhook_secret):
    project = Project.query.filter_by(webhook_secret=webhook_secret).first()
    if not project or not project.enable_webhook or not project.auto_deploy:
        return jsonify({'error': 'Not found'}), 404

    # Verify GitHub signature — required, never optional.
    signature_header = request.headers.get('X-Hub-Signature-256', '')
    if not signature_header:
        return jsonify({'error': 'Missing signature'}), 403
    expected = 'sha256=' + hmac.new(
        webhook_secret.encode(), request.data, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(signature_header, expected):
        return jsonify({'error': 'Invalid signature'}), 403

    data = request.get_json(force=True) or {}

    # Only deploy on push to the configured branch
    pushed_branch = data.get('ref', '').replace('refs/heads/', '')
    if pushed_branch and pushed_branch != project.github_branch:
        return jsonify({'status': 'skipped', 'reason': 'branch mismatch'})

    cred = GitHubCredential.query.filter_by(user_id=project.user_id).first()
    if not cred:
        return jsonify({'error': 'No GitHub credentials for project owner'}), 500

    if not project.apps:
        return jsonify({'status': 'skipped', 'reason': 'project has no apps'}), 200

    commit = data.get('after', '')[:40]
    deployment_ids = []
    for a in project.apps:
        if a.status == 'deploying':
            continue
        dep = Deployment(
            project_id=project.id,
            app_id=a.id,
            status='pending',
            branch=pushed_branch or project.github_branch,
            commit_hash=commit,
            triggered_by='webhook',
        )
        db.session.add(dep)
        a.status = 'deploying'
        db.session.commit()
        threading.Thread(
            target=deploy_app_bg,
            args=(dep.id, cred.username, cred.token),
            daemon=True,
        ).start()
        deployment_ids.append(dep.id)

    return jsonify({'status': 'pending', 'deployment_ids': deployment_ids})


# ═══════════════════════════════════════════
# GitHub Credentials API
# ═══════════════════════════════════════════

@app.route('/api/github-credentials', methods=['GET'])
@login_required
def api_github_credentials():
    creds = GitHubCredential.query.filter_by(user_id=current_user.id).all()
    return jsonify([{
        'id': c.id,
        'username': c.username,
        'created_at': c.created_at.isoformat()
    } for c in creds])


@app.route('/api/github-credentials', methods=['POST'])
@csrf.exempt
@login_required
def api_add_github_credential():
    data = request.get_json(silent=True) or {}
    username = data.get('username', '').strip()
    token = data.get('token', '').strip()

    if not username or not token:
        return jsonify({'error': 'Username and token required'}), 400

    cred = GitHubCredential(user_id=current_user.id, username=username, token=token)
    db.session.add(cred)
    db.session.commit()
    return jsonify({'id': cred.id, 'username': cred.username}), 201


@app.route('/api/github-credentials/<int:cred_id>', methods=['DELETE'])
@csrf.exempt
@login_required
def api_delete_github_credential(cred_id):
    cred = db.session.get(GitHubCredential, cred_id)
    if not cred:
        return jsonify({'error': 'Not found'}), 404
    if cred.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    db.session.delete(cred)
    db.session.commit()
    return jsonify({'status': 'deleted'})


# ═══════════════════════════════════════════
# Background Deployment Process
# ═══════════════════════════════════════════

def _ensure_repo_cloned(project, github_username, github_token, log):
    """Clone or fast-forward the project's repo. Returns the clone dir path."""
    clone_dir = DEPLOYMENTS_DIR / project.folder_name
    log.write("Step 1: Cloning/updating repository...\n")
    if clone_dir.exists():
        log.write("  Repository exists, fetching latest...\n")
        ok = run_cmd(['git', '-C', str(clone_dir), 'fetch', '--all'], log) \
             and run_cmd(['git', '-C', str(clone_dir), 'reset', '--hard',
                          f'origin/{project.github_branch}'], log)
    else:
        log.write(f"  Cloning to {clone_dir}...\n")
        repo_url = project.github_url.replace('https://',
                                              f'https://{github_username}:{github_token}@')
        ok = run_cmd(['git', 'clone', repo_url, str(clone_dir)], log, redact=repo_url)
    if not ok:
        raise RuntimeError("Failed to clone/update repository")
    return clone_dir


def deploy_app_bg(deployment_id, github_username, github_token):
    """Background task: deploy a single App. Runs in its own app context."""
    with app.app_context():
        deployment = db.session.get(Deployment, deployment_id)
        if not deployment:
            return

        app_row = deployment.app
        project = deployment.project
        if not app_row:
            deployment.status = 'failed'
            deployment.error_message = 'Deployment has no associated app'
            db.session.commit()
            return

        log_file = LOG_DIR / f"deploy_{deployment_id}_{int(time.time())}.log"
        deployment.log_file = str(log_file)
        deployment.status = 'running'
        app_row.status = 'deploying'
        db.session.commit()

        start_time = time.time()

        try:
            with open(log_file, 'w', encoding='utf-8') as log:
                log.write(f"=== Deployment Started: {datetime.now(timezone.utc).isoformat()} ===\n")
                log.write(f"Project: {project.name}\n")
                log.write(f"App: {app_row.name} ({app_row.app_type})\n")
                log.write(f"GitHub URL: {project.github_url}\n")
                log.write(f"Branch: {project.github_branch}\n")
                if app_row.subdirectory:
                    log.write(f"Subdirectory: {app_row.subdirectory}\n")
                log.write("\n")

                with _repo_lock(project.id):
                    clone_dir = _ensure_repo_cloned(project, github_username, github_token, log)

                deploy_dir = clone_dir
                if app_row.subdirectory:
                    deploy_dir = clone_dir / app_row.subdirectory.strip('/')
                    log.write(f"  Using subdirectory: {app_row.subdirectory}\n")
                    if not deploy_dir.exists():
                        raise RuntimeError(f"Subdirectory not found: {app_row.subdirectory}")

                if app_row.env_content:
                    log.write("\nStep 2: Writing .env file...\n")
                    (deploy_dir / '.env').write_text(app_row.env_content, encoding='utf-8')
                    log.write("  .env written\n")

                if (deploy_dir / 'package.json').exists():
                    pm = app_row.package_manager or 'npm'
                    log.write(f"\nStep 3: Installing dependencies ({pm} install)...\n")
                    if not run_cmd([pm, 'install'], log, cwd=deploy_dir):
                        raise RuntimeError(f"{pm} install failed")

                    if app_row.build_command:
                        log.write(f"\nStep 4: Building ({app_row.build_command})...\n")
                        if not run_cmd(app_row.build_command, log, cwd=deploy_dir, shell=True):
                            raise RuntimeError("Build failed")

                if app_row.start_command and app_row.pm2_name:
                    log.write(f"\nStep 5: Starting with PM2 as '{app_row.pm2_name}'...\n")
                    run_cmd(['pm2', 'delete', app_row.pm2_name], log, check=False)
                    if not run_cmd(
                        ['pm2', 'start', app_row.start_command,
                         '--name', app_row.pm2_name],
                        log, cwd=deploy_dir
                    ):
                        raise RuntimeError("pm2 start failed")
                    run_cmd(['pm2', 'save'], log)

                if app_row.domain:
                    log.write("\nStep 6: Configuring Nginx...\n")
                    if app_row.enable_ssl:
                        dns = _check_domain_points_to_server(app_row.domain)
                        if not dns.get('ok'):
                            log.write(f"  DNS check failed: {dns.get('error')}\n")
                            raise RuntimeError(dns.get('error') or 'Domain DNS does not point to this server')
                    if not setup_nginx_config(app_row, log):
                        raise RuntimeError("Nginx configuration failed — see log above")

                log.write("\n=== Deployment Completed Successfully ===\n")
                deployment.status = 'success'
                app_row.status = 'deployed'
                app_row.last_deployment = datetime.now(timezone.utc)

        except Exception as e:
            deployment.status = 'failed'
            deployment.error_message = str(e)
            app_row.status = 'error'
            try:
                with open(log_file, 'a', encoding='utf-8') as log:
                    log.write(f"\n!!! Deployment Failed: {e} !!!\n")
            except Exception:
                pass

        finally:
            deployment.completed_at = datetime.now(timezone.utc)
            deployment.duration_seconds = int(time.time() - start_time)
            db.session.commit()


def run_cmd(cmd, log_file, cwd=None, shell=False, check=True, redact=None):
    """Run a command and stream output to the log file."""
    try:
        result = subprocess.run(
            cmd,
            shell=shell,
            capture_output=True,
            text=True,
            timeout=600,
            cwd=str(cwd) if cwd else None,
        )
        stdout = result.stdout
        stderr = result.stderr

        # Remove credentials from log output
        if redact:
            stdout = stdout.replace(redact, '<redacted>')
            stderr = stderr.replace(redact, '<redacted>')

        if stdout:
            log_file.write(stdout + '\n')
        if stderr:
            log_file.write('STDERR: ' + stderr + '\n')

        if check and result.returncode != 0:
            return False
        return True
    except subprocess.TimeoutExpired:
        log_file.write('ERROR: Command timed out after 600s\n')
        return False
    except Exception as e:
        log_file.write(f'Exception running command: {e}\n')
        return False


def setup_nginx_config(app_row, log_file):
    """Write an Nginx virtual host and optionally obtain an SSL cert.

    Returns True on success, False if the config failed to write, test,
    or reload — caller should treat False as a deployment failure so
    domains don't silently 502 after a bad config lands.
    """
    log_file.write(f"  Domain: {app_row.domain}\n")

    nginx_config = (
        f"server {{\n"
        f"    listen 80;\n"
        f"    server_name {app_row.domain} www.{app_row.domain};\n"
        f"    client_max_body_size {app_row.client_max_body};\n"
        f"\n"
        f"    location / {{\n"
        f"        proxy_pass http://127.0.0.1:{app_row.app_port};\n"
        f"        proxy_set_header Host $host;\n"
        f"        proxy_set_header X-Real-IP $remote_addr;\n"
        f"        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
        f"        proxy_set_header X-Forwarded-Proto $scheme;\n"
        f"    }}\n"
        f"}}\n"
    )

    config_path = f"/etc/nginx/sites-available/{app_row.domain}"
    enabled_path = f"/etc/nginx/sites-enabled/{app_row.domain}"
    # Back up any existing config so we can roll back on validation failure
    backup_path = None
    if os.path.exists(config_path):
        backup_path = config_path + '.ascend.bak'
        try:
            with open(config_path, 'rb') as src, open(backup_path, 'wb') as dst:
                dst.write(src.read())
        except Exception as e:
            log_file.write(f"  Warning: could not back up existing config: {e}\n")

    try:
        with open(config_path, 'w') as f:
            f.write(nginx_config)
        log_file.write(f"  Config written: {config_path}\n")

        if not os.path.exists(enabled_path):
            os.symlink(config_path, enabled_path)

        test = subprocess.run(['nginx', '-t'], capture_output=True)
        if test.returncode != 0:
            log_file.write(f"  Nginx test failed: {test.stderr.decode()}\n")
            # Roll back
            if backup_path and os.path.exists(backup_path):
                with open(backup_path, 'rb') as src, open(config_path, 'wb') as dst:
                    dst.write(src.read())
                log_file.write("  Rolled back to previous config.\n")
            elif not backup_path and os.path.islink(enabled_path):
                os.unlink(enabled_path)
            return False

        reload = subprocess.run(['systemctl', 'reload', 'nginx'], capture_output=True)
        if reload.returncode != 0:
            log_file.write(f"  Nginx reload failed: {reload.stderr.decode()}\n")
            return False
        log_file.write("  Nginx reloaded\n")

        if app_row.enable_ssl:
            log_file.write("  Obtaining SSL certificate...\n")
            cert = subprocess.run([
                'certbot', '--nginx',
                '-d', app_row.domain,
                '--non-interactive', '--agree-tos',
                '-m', f'admin@{app_row.domain}',
            ], capture_output=True)
            if cert.returncode != 0:
                # Cert failure is non-fatal — site still serves on HTTP
                log_file.write(f"  Warning: certbot failed: {cert.stderr.decode()}\n")

        return True

    except Exception as e:
        log_file.write(f"  Nginx setup error: {e}\n")
        return False
    finally:
        if backup_path and os.path.exists(backup_path):
            try:
                os.remove(backup_path)
            except Exception:
                pass


# ═══════════════════════════════════════════
# System API (read-only introspection)
# ═══════════════════════════════════════════

# Short-lived caches so repeated page loads don't hammer CLI tools.
_system_cache = {}
_SYSTEM_TTL = 5  # seconds
_repo_locks = {}


def _repo_lock(project_id):
    lock = _repo_locks.get(project_id)
    if lock is None:
        lock = threading.Lock()
        _repo_locks[project_id] = lock
    return lock


def _cached(key, ttl, builder):
    """Return cached value for `key` if fresh, else recompute via `builder()`."""
    now = time.time()
    entry = _system_cache.get(key)
    if entry and now - entry[0] < ttl:
        return entry[1]
    value = builder()
    _system_cache[key] = (now, value)
    return value


def _pm2_summary(proc):
    """Flatten a single `pm2 jlist` entry to the fields we care about."""
    env = proc.get('pm2_env') or {}
    monit = proc.get('monit') or {}
    pm_uptime = env.get('pm_uptime') or 0
    status = env.get('status', 'unknown')
    uptime_ms = int(time.time() * 1000) - pm_uptime if status == 'online' and pm_uptime else 0
    port = None
    exec_env = env.get('env') or {}
    if isinstance(exec_env, dict):
        port = exec_env.get('PORT') or exec_env.get('port')
    return {
        'name': proc.get('name'),
        'pid': proc.get('pid') or 0,
        'status': status,
        'restarts': env.get('restart_time', 0),
        'uptime_ms': uptime_ms,
        'cpu': monit.get('cpu', 0),
        'memory_mb': round((monit.get('memory') or 0) / 1024 / 1024, 1),
        'exec_path': env.get('pm_exec_path'),
        'cwd': env.get('pm_cwd'),
        'port': int(port) if port and str(port).isdigit() else None,
    }


def _load_pm2_processes():
    try:
        result = subprocess.run(['pm2', 'jlist'], capture_output=True, timeout=10)
        if result.returncode != 0:
            return []
        out = result.stdout.decode('utf-8', errors='replace').strip() or '[]'
        # pm2 sometimes prints warning lines before the JSON — grab the first '['.
        idx = out.find('[')
        if idx > 0:
            out = out[idx:]
        return [_pm2_summary(p) for p in json.loads(out)]
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
        return []


def _load_listening_ports():
    try:
        result = subprocess.run(['ss', '-tlnp'], capture_output=True, timeout=5)
        if result.returncode != 0:
            return []
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []

    seen = {}
    for line in result.stdout.decode('utf-8', errors='replace').splitlines()[1:]:
        parts = line.split()
        if len(parts) < 4:
            continue
        local = parts[3]
        m = re.search(r':(\d+)$', local)
        if not m:
            continue
        port = int(m.group(1))
        proc_match = re.search(r'\("([^"]+)",pid=(\d+)', line)
        if port not in seen:
            seen[port] = {
                'port': port,
                'address': local,
                'process': proc_match.group(1) if proc_match else '',
                'pid': int(proc_match.group(2)) if proc_match else None,
            }
    return sorted(seen.values(), key=lambda x: x['port'])


def _load_nginx_sites():
    sites_dir = '/etc/nginx/sites-enabled'
    if not os.path.isdir(sites_dir):
        return []
    sites = []
    for name in sorted(os.listdir(sites_dir)):
        path = os.path.join(sites_dir, name)
        try:
            with open(path, 'r', errors='replace') as f:
                content = f.read()
        except OSError:
            continue
        listens = re.findall(r'\blisten\s+(?:\[?[\w:.]+\]?:)?(\d+)([^;]*);', content)
        ports = sorted({int(p) for p, _ in listens})
        has_ssl = any('ssl' in tail for _, tail in listens)
        server_names = []
        for sn in re.findall(r'\bserver_name\s+([^;]+);', content):
            server_names.extend(sn.split())
        proxies = re.findall(r'\bproxy_pass\s+([^;]+);', content)
        sites.append({
            'name': name,
            'server_names': server_names,
            'proxy_targets': proxies,
            'listen_ports': ports,
            'ssl': has_ssl,
        })
    return sites


def _is_port_listening(port):
    try:
        result = subprocess.run(
            ['ss', '-tln', f'sport = :{port}'],
            capture_output=True, timeout=3
        )
        return b'LISTEN' in result.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None


@app.route('/api/system/pm2')
@login_required
def api_system_pm2():
    return jsonify({
        'processes': _cached('pm2', _SYSTEM_TTL, _load_pm2_processes),
    })


@app.route('/api/system/ports')
@login_required
def api_system_ports():
    return jsonify({
        'ports': _cached('ports', _SYSTEM_TTL, _load_listening_ports),
    })


@app.route('/api/system/nginx')
@login_required
def api_system_nginx():
    return jsonify({
        'sites': _cached('nginx', _SYSTEM_TTL, _load_nginx_sites),
    })


@app.route('/api/system/dns-check')
@login_required
def api_system_dns_check():
    domain = request.args.get('domain', '')
    return jsonify(_check_domain_points_to_server(domain))


@app.route('/api/system/suggest-port')
@login_required
def api_system_suggest_port():
    start = request.args.get('start', 3000)
    exclude_app_id = _parse_port(request.args.get('exclude_app_id'))
    port = _suggest_app_port(start=start, exclude_app_id=exclude_app_id)
    if not port:
        return jsonify({'error': 'No free port found in the requested range'}), 409
    try:
        normalized_start = int(start)
    except (TypeError, ValueError):
        normalized_start = 3000
    return jsonify({'port': port, 'start': normalized_start})


@app.route('/api/app/<int:app_id>/runtime')
@login_required
def api_app_runtime(app_id):
    a = db.session.get(App, app_id)
    if not a or a.project.user_id != current_user.id:
        return jsonify({'error': 'Not found'}), 404

    pm2_status = None
    if a.pm2_name:
        for p in _cached('pm2', _SYSTEM_TTL, _load_pm2_processes):
            if p.get('name') == a.pm2_name:
                pm2_status = p
                break

    project = a.project
    webhook_path = None
    if project.enable_webhook and project.webhook_secret:
        webhook_path = f'/webhook/github/{project.webhook_secret}'

    return jsonify({
        'pm2': pm2_status,
        'port': a.app_port,
        'port_listening': _is_port_listening(a.app_port) if a.app_port else None,
        'webhook_path': webhook_path,
        'domain': a.domain,
        'status': a.status,
    })


# ═══════════════════════════════════════════
# Error Handlers
# ═══════════════════════════════════════════

@app.errorhandler(404)
def page_not_found(e):
    if request.path.startswith('/api/'):
        return jsonify({'error': 'Not found'}), 404
    return render_template('404.html'), 404


@app.errorhandler(500)
def server_error(e):
    if request.path.startswith('/api/'):
        return jsonify({'error': 'Internal server error'}), 500
    return render_template('500.html'), 500


@app.shell_context_processor
def make_shell_context():
    return {'db': db, 'User': User, 'Project': Project, 'App': App, 'Deployment': Deployment}


with app.app_context():
    db.create_all()
    migrate_schema()


if __name__ == '__main__':
    with app.app_context():
        if not User.query.first():
            print("No users found. Visit /setup to create the admin account.")
        host = os.environ.get('HOST', '127.0.0.1')
        port = int(os.environ.get('PORT', 8765))
        app.run(debug=False, host=host, port=port)
