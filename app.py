#!/usr/bin/env python3
"""
CPanel Deployment System - Web-based powerful deployment panel
Converts the deployment wizard into a modern web interface
Features: Multi-project support, SQLite persistence, webhooks, real-time logs
"""

import os
import sys
import json
import time
import hmac
import hashlib
import subprocess
import threading
import secrets
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, render_template, request, jsonify, session, redirect, url_for, flash, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from flask_wtf.csrf import CSRFProtect
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import dotenv

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
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    name = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text)
    github_url = db.Column(db.String(500), nullable=False)
    github_branch = db.Column(db.String(120), default='main')

    project_type = db.Column(db.String(50), default='website')
    folder_name = db.Column(db.String(255), nullable=False)
    subdirectory = db.Column(db.String(255))

    app_port = db.Column(db.Integer)
    webhook_port = db.Column(db.Integer)

    package_manager = db.Column(db.String(20), default='npm')
    build_command = db.Column(db.String(500))
    start_command = db.Column(db.String(500))
    pm2_name = db.Column(db.String(255))

    env_content = db.Column(db.Text)

    domain = db.Column(db.String(255))
    enable_ssl = db.Column(db.Boolean, default=True)
    client_max_body = db.Column(db.String(20), default='100M')

    enable_webhook = db.Column(db.Boolean, default=True)
    webhook_secret = db.Column(db.String(255), default=lambda: secrets.token_hex(32))
    auto_deploy = db.Column(db.Boolean, default=False)

    status = db.Column(db.String(50), default='created')
    last_deployment = db.Column(db.DateTime)

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    deployments = db.relationship('Deployment', backref='project', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'github_url': self.github_url,
            'github_branch': self.github_branch,
            'project_type': self.project_type,
            'folder_name': self.folder_name,
            'subdirectory': self.subdirectory,
            'app_port': self.app_port,
            'pm2_name': self.pm2_name,
            'build_command': self.build_command,
            'start_command': self.start_command,
            'package_manager': self.package_manager,
            'env_content': self.env_content,
            'domain': self.domain,
            'enable_ssl': self.enable_ssl,
            'client_max_body': self.client_max_body,
            'enable_webhook': self.enable_webhook,
            'webhook_secret': self.webhook_secret,
            'auto_deploy': self.auto_deploy,
            'status': self.status,
            'last_deployment': self.last_deployment.isoformat() if self.last_deployment else None,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class Deployment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)

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

@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


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
    stats = {
        'total_projects': len(projects),
        'deployed': sum(1 for p in projects if p.status == 'deployed'),
        'errors': sum(1 for p in projects if p.status == 'error'),
        'deploying': sum(1 for p in projects if p.status == 'deploying'),
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

    app_port = data.get('app_port')
    if app_port is not None:
        try:
            app_port = int(app_port)
        except (ValueError, TypeError):
            app_port = None

    project = Project(
        user_id=current_user.id,
        name=name,
        description=data.get('description', ''),
        github_url=github_url,
        github_branch=data.get('github_branch', 'main'),
        project_type=data.get('project_type', 'website'),
        folder_name=folder_name,
        subdirectory=data.get('subdirectory', ''),
        domain=data.get('domain', ''),
        app_port=app_port,
        pm2_name=data.get('pm2_name', ''),
        build_command=data.get('build_command', ''),
        start_command=data.get('start_command', ''),
        package_manager=data.get('package_manager', 'npm'),
        enable_ssl=bool(data.get('enable_ssl', True)),
        auto_deploy=bool(data.get('auto_deploy', False)),
        client_max_body=data.get('client_max_body', '100M'),
    )

    db.session.add(project)
    db.session.commit()
    return jsonify(project.to_dict()), 201


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

    for field in ['name', 'description', 'github_url', 'github_branch', 'project_type',
                  'folder_name', 'subdirectory', 'domain', 'pm2_name', 'build_command',
                  'start_command', 'package_manager', 'env_content', 'client_max_body']:
        if field in data:
            setattr(project, field, data[field])

    if 'enable_ssl' in data:
        project.enable_ssl = bool(data['enable_ssl'])
    if 'auto_deploy' in data:
        project.auto_deploy = bool(data['auto_deploy'])
    if 'enable_webhook' in data:
        project.enable_webhook = bool(data['enable_webhook'])

    if 'app_port' in data:
        try:
            project.app_port = int(data['app_port']) if data['app_port'] else None
        except (ValueError, TypeError):
            project.app_port = None

    project.updated_at = datetime.now(timezone.utc)
    db.session.commit()
    return jsonify(project.to_dict())


@app.route('/api/project/<int:project_id>', methods=['DELETE'])
@csrf.exempt
@login_required
def api_delete_project(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    db.session.delete(project)
    db.session.commit()
    return jsonify({'status': 'deleted'})


# ═══════════════════════════════════════════
# Deployment API Routes
# ═══════════════════════════════════════════

@app.route('/api/project/<int:project_id>/deploy', methods=['POST'])
@csrf.exempt
@login_required
def api_deploy(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    # Fetch credentials now while we're in the request context
    cred = GitHubCredential.query.filter_by(user_id=current_user.id).first()
    if not cred:
        return jsonify({'error': 'No GitHub credentials configured. Add credentials in Settings.'}), 400

    if project.status == 'deploying':
        return jsonify({'error': 'A deployment is already in progress'}), 409

    deployment = Deployment(
        project_id=project_id,
        status='pending',
        branch=project.github_branch,
        triggered_by='manual'
    )
    db.session.add(deployment)
    project.status = 'deploying'
    db.session.commit()

    # Pass all needed data to the thread; never use current_user inside the thread
    thread = threading.Thread(
        target=deploy_project_bg,
        args=(deployment.id, cred.username, cred.token),
        daemon=True
    )
    thread.start()

    return jsonify({'id': deployment.id, 'status': 'pending'})


@app.route('/api/project/<int:project_id>/deployments', methods=['GET'])
@login_required
def api_project_deployments(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    deployments = Deployment.query.filter_by(project_id=project_id).order_by(
        Deployment.started_at.desc()
    ).limit(20).all()

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
# GitHub Webhook
# ═══════════════════════════════════════════

@app.route('/webhook/github/<webhook_secret>', methods=['POST'])
@csrf.exempt
def github_webhook(webhook_secret):
    project = Project.query.filter_by(webhook_secret=webhook_secret).first()
    if not project or not project.enable_webhook or not project.auto_deploy:
        return jsonify({'error': 'Not found'}), 404

    # Verify GitHub signature
    signature_header = request.headers.get('X-Hub-Signature-256', '')
    if signature_header:
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

    # Get credentials for the project owner
    cred = GitHubCredential.query.filter_by(user_id=project.user_id).first()
    if not cred:
        return jsonify({'error': 'No GitHub credentials for project owner'}), 500

    deployment = Deployment(
        project_id=project.id,
        status='pending',
        branch=pushed_branch or project.github_branch,
        commit_hash=data.get('after', '')[:40],
        triggered_by='webhook'
    )
    db.session.add(deployment)
    project.status = 'deploying'
    db.session.commit()

    thread = threading.Thread(
        target=deploy_project_bg,
        args=(deployment.id, cred.username, cred.token),
        daemon=True
    )
    thread.start()

    return jsonify({'status': 'pending', 'deployment_id': deployment.id})


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

def deploy_project_bg(deployment_id, github_username, github_token):
    """Background task: runs inside its own app context."""
    with app.app_context():
        deployment = db.session.get(Deployment, deployment_id)
        if not deployment:
            return

        project = deployment.project
        log_file = LOG_DIR / f"deploy_{deployment_id}_{int(time.time())}.log"
        deployment.log_file = str(log_file)
        deployment.status = 'running'
        db.session.commit()

        start_time = time.time()

        try:
            with open(log_file, 'w', encoding='utf-8') as log:
                log.write(f"=== Deployment Started: {datetime.now(timezone.utc).isoformat()} ===\n")
                log.write(f"Project: {project.name}\n")
                log.write(f"Type: {project.project_type}\n")
                log.write(f"GitHub URL: {project.github_url}\n")
                log.write(f"Branch: {project.github_branch}\n")
                if project.subdirectory:
                    log.write(f"Subdirectory: {project.subdirectory}\n")
                log.write("\n")

                clone_dir = DEPLOYMENTS_DIR / project.folder_name

                log.write("Step 1: Cloning/updating repository...\n")
                if clone_dir.exists():
                    log.write("  Repository exists, fetching latest...\n")
                    ok = run_cmd(
                        ['git', '-C', str(clone_dir), 'fetch', '--all'],
                        log
                    ) and run_cmd(
                        ['git', '-C', str(clone_dir), 'reset', '--hard',
                         f'origin/{project.github_branch}'],
                        log
                    )
                else:
                    log.write(f"  Cloning to {clone_dir}...\n")
                    # Embed credentials in URL (never logged)
                    repo_url = project.github_url.replace(
                        'https://',
                        f'https://{github_username}:{github_token}@'
                    )
                    ok = run_cmd(['git', 'clone', repo_url, str(clone_dir)], log, redact=repo_url)

                if not ok:
                    raise RuntimeError("Failed to clone/update repository")

                deploy_dir = clone_dir
                if project.subdirectory:
                    deploy_dir = clone_dir / project.subdirectory.strip('/')
                    log.write(f"  Using subdirectory: {project.subdirectory}\n")
                    if not deploy_dir.exists():
                        raise RuntimeError(f"Subdirectory not found: {project.subdirectory}")

                if project.env_content:
                    log.write("\nStep 2: Writing .env file...\n")
                    (deploy_dir / '.env').write_text(project.env_content, encoding='utf-8')
                    log.write("  .env written\n")

                if (deploy_dir / 'package.json').exists():
                    pm = project.package_manager or 'npm'
                    log.write(f"\nStep 3: Installing dependencies ({pm} install)...\n")
                    if not run_cmd([pm, 'install'], log, cwd=deploy_dir):
                        raise RuntimeError(f"{pm} install failed")

                    if project.build_command:
                        log.write(f"\nStep 4: Building ({project.build_command})...\n")
                        if not run_cmd(project.build_command, log, cwd=deploy_dir, shell=True):
                            raise RuntimeError("Build failed")

                if project.start_command and project.pm2_name:
                    log.write(f"\nStep 5: Starting with PM2 as '{project.pm2_name}'...\n")
                    run_cmd(['pm2', 'delete', project.pm2_name], log, check=False)
                    if not run_cmd(
                        ['pm2', 'start', project.start_command,
                         '--name', project.pm2_name],
                        log, cwd=deploy_dir
                    ):
                        raise RuntimeError("pm2 start failed")
                    run_cmd(['pm2', 'save'], log)

                if project.domain:
                    log.write("\nStep 6: Configuring Nginx...\n")
                    setup_nginx_config(project, log)

                log.write("\n=== Deployment Completed Successfully ===\n")
                deployment.status = 'success'
                project.status = 'deployed'
                project.last_deployment = datetime.now(timezone.utc)

        except Exception as e:
            deployment.status = 'failed'
            deployment.error_message = str(e)
            project.status = 'error'
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


def setup_nginx_config(project, log_file):
    """Write an Nginx virtual host and optionally obtain an SSL cert."""
    try:
        log_file.write(f"  Domain: {project.domain}\n")

        nginx_config = (
            f"server {{\n"
            f"    listen 80;\n"
            f"    server_name {project.domain} www.{project.domain};\n"
            f"    client_max_body_size {project.client_max_body};\n"
            f"\n"
            f"    location / {{\n"
            f"        proxy_pass http://127.0.0.1:{project.app_port};\n"
            f"        proxy_set_header Host $host;\n"
            f"        proxy_set_header X-Real-IP $remote_addr;\n"
            f"        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
            f"        proxy_set_header X-Forwarded-Proto $scheme;\n"
            f"    }}\n"
            f"}}\n"
        )

        config_path = f"/etc/nginx/sites-available/{project.domain}"
        with open(config_path, 'w') as f:
            f.write(nginx_config)
        log_file.write(f"  Config written: {config_path}\n")

        enabled_path = f"/etc/nginx/sites-enabled/{project.domain}"
        if not os.path.exists(enabled_path):
            os.symlink(config_path, enabled_path)

        test = subprocess.run(['nginx', '-t'], capture_output=True)
        if test.returncode == 0:
            subprocess.run(['systemctl', 'reload', 'nginx'], capture_output=True)
            log_file.write("  Nginx reloaded\n")

            if project.enable_ssl:
                log_file.write("  Obtaining SSL certificate...\n")
                subprocess.run([
                    'certbot', '--nginx',
                    '-d', project.domain,
                    '-d', f'www.{project.domain}',
                    '--non-interactive', '--agree-tos',
                    '-m', f'admin@{project.domain}',
                ], capture_output=True)
        else:
            log_file.write(f"  Nginx test failed: {test.stderr.decode()}\n")

    except Exception as e:
        log_file.write(f"  Nginx setup error: {e}\n")


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
    return {'db': db, 'User': User, 'Project': Project, 'Deployment': Deployment}


if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        if not User.query.first():
            print("No users found. Visit http://localhost:5000/setup or http://localhost:3000/setup")
        app.run(debug=False, host='0.0.0.0', port=int(os.environ.get('PORT', 8716)))
