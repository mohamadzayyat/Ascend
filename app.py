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
import shutil
import zipfile
import subprocess
import threading
import secrets
import socket
import ipaddress
import tempfile
import platform
import struct
import base64
from datetime import datetime, timezone
from pathlib import Path

import psutil

# Prime cpu_percent so subsequent non-blocking reads return a real value.
# psutil docs: the first interval=None call returns a meaningless 0.0.
psutil.cpu_percent(interval=None)
_net_sample = {'t': None, 'sent': 0, 'recv': 0}

from flask import Flask, render_template, request, jsonify, session, redirect, url_for, flash, send_file, after_this_request
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from flask_wtf.csrf import CSRFProtect
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import dotenv
from urllib import request as _urlreq, error as _urlerr
from backend.extensions import db
from backend.services.backup_upload import (
    init_backup_upload,
    _backup_upload_settings_load,
    _backup_upload_settings_to_api_dict,
    _upload_backup_to_remote,
)
from backend.services.email_notifications import (
    init_email_notifications,
    _email_notify_settings_load,
    _email_notify_settings_to_api_dict,
    _email_notify_delivery_status_record,
    _email_notify_log_clear,
    _email_notify_log_load,
    _notify_email_async,
    _parse_notify_emails,
    _smtp_send_raw,
)

# ═══════════════════════════════════════════
# Setup
# ═══════════════════════════════════════════

BASE_DIR = Path(__file__).parent
LOG_DIR = BASE_DIR / "logs"
ACME_WEBROOT = Path("/var/www/letsencrypt")

# On Linux as root: deploy to /root; otherwise local deployments dir
try:
    is_root = os.geteuid() == 0
except AttributeError:
    is_root = False  # Windows
DEPLOYMENTS_DIR = Path("/root") if is_root else BASE_DIR / "deployments"

LOG_DIR.mkdir(exist_ok=True)
DEPLOYMENTS_DIR.mkdir(exist_ok=True)

dotenv.load_dotenv(BASE_DIR / '.env')

MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024 * 1024
# Multipart form-data adds request overhead around the file bytes. Keep the
# transport ceiling above 5 GiB so a real 5 GiB file is accepted.
DEFAULT_MAX_CONTENT_LENGTH = 6 * 1024 * 1024 * 1024
DEFAULT_CLIENT_MAX_BODY = '6G'


def _env_int(name, default):
    raw = os.environ.get(name)
    if raw is None:
        return default
    raw = raw.split('#', 1)[0].strip()
    return int(raw) if raw else default


app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', secrets.token_hex(32))
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{BASE_DIR}/cpanel.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = max(
    _env_int('MAX_CONTENT_LENGTH', DEFAULT_MAX_CONTENT_LENGTH),
    DEFAULT_MAX_CONTENT_LENGTH,
)

# Cross-origin session cookies (needed when frontend is on a different port/domain)
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_HTTPONLY'] = True
# In production with HTTPS: set SESSION_COOKIE_SECURE=True and SESSION_COOKIE_SAMESITE='None'

db.init_app(app)
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

from backend.models import (
    iso_utc,
    User,
    GitHubCredential,
    Project,
    App,
    AppSetting,
    DatabaseConnection,
    BackupSchedule,
    BackupArchive,
    Deployment,
)

SHELL_PASSPHRASE_SETTING_KEY = 'shell_passphrase_hash'
EMAIL_NOTIFY_SETTING_KEY = 'email_notifications_v1'
BACKUP_UPLOAD_SETTING_KEY = 'backup_upload_v1'
AUDIT_LOG_SETTING_KEY = 'audit_log_v1'

_EMAIL_NOTIFY_EVENT_DEFAULTS = {
    'backup_success': False,
    'backup_failed': True,
    'panel_login': False,
    'project_created': True,
    'project_deleted': True,
    'app_deleted': False,
    'deployment_success': False,
    'deployment_failed': True,
    'terminal_unlock': True,
    'server_files_unlock': True,
}


def _fernet_cipher():
    """Derive a Fernet key from SECRET_KEY. Stable across restarts as long
    as SECRET_KEY doesn't change. Avoids managing yet another secret in .env."""
    from cryptography.fernet import Fernet
    secret = (app.config.get('SECRET_KEY') or '').encode('utf-8')
    if not secret:
        raise RuntimeError('SECRET_KEY is empty - cannot derive credential cipher.')
    key_material = hashlib.sha256(secret + b'|db-creds-v1').digest()
    return Fernet(base64.urlsafe_b64encode(key_material))


def _encrypt_password(plaintext):
    if plaintext is None:
        plaintext = ''
    return _fernet_cipher().encrypt(plaintext.encode('utf-8')).decode('ascii')


def _decrypt_password(ciphertext):
    if not ciphertext:
        return ''
    return _fernet_cipher().decrypt(ciphertext.encode('ascii')).decode('utf-8')


init_email_notifications(
    app=app,
    db=db,
    app_setting_model=AppSetting,
    setting_key=EMAIL_NOTIFY_SETTING_KEY,
    event_defaults=_EMAIL_NOTIFY_EVENT_DEFAULTS,
    encrypt_password=_encrypt_password,
    decrypt_password=_decrypt_password,
)
init_backup_upload(
    db=db,
    app_setting_model=AppSetting,
    setting_key=BACKUP_UPLOAD_SETTING_KEY,
    encrypt_password=_encrypt_password,
    decrypt_password=_decrypt_password,
)


def _admin_required():
    if not getattr(current_user, 'is_admin', False):
        return jsonify({'error': 'Admin only.'}), 403
    return None


def _json_setting_load(key, default):
    try:
        rec = db.session.get(AppSetting, key)
        if not rec or not rec.value:
            return default
        parsed = json.loads(rec.value)
        if isinstance(default, list):
            return parsed if isinstance(parsed, list) else default
        if isinstance(default, dict):
            return parsed if isinstance(parsed, dict) else default
        return parsed
    except Exception:
        return default


def _json_setting_save(key, value):
    rec = db.session.get(AppSetting, key)
    if rec is None:
        rec = AppSetting(key=key, value=json.dumps(value))
        db.session.add(rec)
    else:
        rec.value = json.dumps(value)
    db.session.commit()


def _audit_log(event, status='ok', message='', metadata=None, user=None):
    try:
        actor = user if user is not None else (current_user if current_user and not current_user.is_anonymous else None)
        entry = {
            'id': f'{datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")}-{secrets.token_hex(3)}',
            'event': str(event),
            'status': str(status),
            'message': str(message or '')[:1000],
            'metadata': metadata if isinstance(metadata, dict) else {},
            'user_id': getattr(actor, 'id', None),
            'username': getattr(actor, 'username', None),
            'ip': ((request.headers.get('X-Forwarded-For') or request.remote_addr or '').split(',')[0].strip() if request else ''),
            'at': datetime.now(timezone.utc).isoformat(),
        }
        rows = _json_setting_load(AUDIT_LOG_SETTING_KEY, [])
        rows.insert(0, entry)
        _json_setting_save(AUDIT_LOG_SETTING_KEY, rows[:1000])
    except Exception as exc:
        try:
            db.session.rollback()
        except Exception:
            pass
        print(f'[audit] log failed: {exc}', file=sys.stderr)


def _totp_secret_generate():
    return base64.b32encode(secrets.token_bytes(20)).decode('ascii').rstrip('=')


def _totp_secret_normalize(secret):
    return re.sub(r'[^A-Z2-7]', '', str(secret or '').upper())


def _totp_code(secret, for_time=None, interval=30):
    secret = _totp_secret_normalize(secret)
    if not secret:
        return ''
    padded = secret + ('=' * ((8 - len(secret) % 8) % 8))
    key = base64.b32decode(padded, casefold=True)
    counter = int((for_time if for_time is not None else time.time()) // interval)
    digest = hmac.new(key, struct.pack('>Q', counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code_int = struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return f'{code_int % 1000000:06d}'


def _totp_verify(secret, code, window=1):
    code = re.sub(r'\D', '', str(code or ''))
    if len(code) != 6:
        return False
    now = time.time()
    return any(hmac.compare_digest(_totp_code(secret, now + (i * 30)), code) for i in range(-window, window + 1))


def _user_otp_secret(user):
    if not user or not user.otp_secret_encrypted:
        return ''
    try:
        return _decrypt_password(user.otp_secret_encrypted)
    except Exception as exc:
        print(f'[2fa] could not decrypt OTP secret for user {getattr(user, "id", "?")}: {exc}', file=sys.stderr)
        return ''


# Login Management
# ═══════════════════════════════════════════

def _sqlite_columns(table):
    """Return the set of existing column names for a SQLite table."""
    rows = db.session.execute(db.text(f'PRAGMA table_info("{table}")')).fetchall()
    return {r[1] for r in rows}


def _migrate_backup_schedule_targets():
    """Move legacy JSON `databases` into `target_database`; split multi-DB rows."""
    try:
        if 'target_database' not in _sqlite_columns('backup_schedule'):
            return
        changed = False
        for s in list(BackupSchedule.query.all()):
            raw = s.databases
            if not raw or not str(raw).strip():
                continue
            try:
                arr = [str(x).strip() for x in (json.loads(raw) or []) if str(x).strip()]
            except (TypeError, ValueError):
                s.databases = None
                changed = True
                continue
            if len(arr) <= 1:
                if arr and not (s.target_database or '').strip():
                    s.target_database = arr[0][:255]
                s.databases = None
                changed = True
                continue
            s.target_database = arr[0][:255]
            s.databases = None
            changed = True
            for name in arr[1:]:
                db.session.add(BackupSchedule(
                    connection_id=s.connection_id,
                    enabled=s.enabled,
                    every_hours=s.every_hours,
                    at_hour=s.at_hour,
                    at_minute=s.at_minute,
                    schedule_timezone=s.schedule_timezone,
                    retention_days=s.retention_days,
                    target_database=name[:255],
                    databases=None,
                ))
        if changed:
            db.session.commit()
    except Exception as e:
        db.session.rollback()
        print(f'[migrate_schema] backup_schedule target migration: {e}', file=sys.stderr)


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
        add_col('app', 'disk_size_bytes BIGINT')
        add_col('app', 'disk_size_computed_at DATETIME')
        add_col('backup_schedule', 'at_hour INTEGER DEFAULT 2')
        add_col('backup_schedule', 'schedule_timezone VARCHAR(64)')
        add_col('backup_schedule', "target_database VARCHAR(255) DEFAULT ''")
        add_col('user', 'otp_secret_encrypted TEXT')
        add_col('user', 'otp_enabled BOOLEAN DEFAULT 0')
        db.session.commit()
        _migrate_backup_schedule_targets()

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
                client_max_body=p.client_max_body or DEFAULT_CLIENT_MAX_BODY,
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
        if bool(getattr(user, 'otp_enabled', False)):
            otp = data.get('otp') or data.get('two_factor_code') or ''
            if not otp:
                _audit_log('auth.login_2fa_required', 'blocked', f'2FA required for {user.username}', user=user)
                return jsonify({'error': 'Two-factor code required.', 'two_factor_required': True}), 428
            if not _totp_verify(_user_otp_secret(user), otp):
                _audit_log('auth.login_2fa_failed', 'failed', f'Invalid 2FA code for {user.username}', user=user)
                return jsonify({'error': 'Invalid two-factor code.', 'two_factor_required': True}), 401
        login_user(user, remember=data.get('remember', False))
        ip = (request.headers.get('X-Forwarded-For') or request.remote_addr or '').split(',')[0].strip()
        _audit_log('auth.login', 'ok', f'{user.username} signed in', user=user)
        _notify_email_async(
            'panel_login',
            f'Ascend: login - {user.username}',
            f'User {user.username} signed in to the panel.\nIP: {ip}\nTime (UTC): {datetime.now(timezone.utc).isoformat()}',
        )
        return jsonify({
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'is_admin': user.is_admin,
            'two_factor_enabled': bool(getattr(user, 'otp_enabled', False)),
        })
    _audit_log('auth.login_failed', 'failed', f'Invalid login for {username or "unknown"}', user=user)
    return jsonify({'error': 'Invalid username or password'}), 401


@app.route('/api/auth/logout', methods=['POST'])
@csrf.exempt
@login_required
def api_logout():
    _audit_log('auth.logout', 'ok', f'{current_user.username} signed out')
    logout_user()
    return jsonify({'status': 'logged out'})


@app.route('/api/setup-status')
def api_setup_status():
    return jsonify({'initialized': User.query.first() is not None})


@app.route('/api/auth/setup', methods=['POST'])
@csrf.exempt
def api_setup():
    lock_file = None
    try:
        import fcntl

        lock_file = open('/tmp/ascend-setup.lock', 'w')
        fcntl.flock(lock_file, fcntl.LOCK_EX)
    except Exception:
        lock_file = None

    try:
        with _setup_lock:
            if User.query.first():
                return jsonify({'error': 'Setup already complete. Please log in.'}), 409

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
    finally:
        if lock_file:
            try:
                import fcntl
                fcntl.flock(lock_file, fcntl.LOCK_UN)
                lock_file.close()
            except Exception:
                pass


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
        otp = request.form.get('otp') or ''
        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            if bool(getattr(user, 'otp_enabled', False)) and not _totp_verify(_user_otp_secret(user), otp):
                _audit_log('auth.login_2fa_failed', 'failed', f'Invalid/missing 2FA code for {user.username}', user=user)
                flash('Two-factor code required.', 'error')
                return render_template('login.html')
            login_user(user, remember=request.form.get('remember'))
            ip = (request.headers.get('X-Forwarded-For') or request.remote_addr or '').split(',')[0].strip()
            _audit_log('auth.login', 'ok', f'{user.username} signed in', user=user)
            _notify_email_async(
                'panel_login',
                f'Ascend: login - {user.username}',
                f'User {user.username} signed in (web form).\nIP: {ip}\nTime (UTC): {datetime.now(timezone.utc).isoformat()}',
            )
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
        'two_factor_enabled': bool(getattr(current_user, 'otp_enabled', False)),
    })


@app.route('/api/settings/email-notifications', methods=['GET', 'PUT'])
@csrf.exempt
@login_required
def api_settings_email_notifications():
    err = _admin_required()
    if err:
        return err
    if request.method == 'GET':
        full = _email_notify_settings_load()
        return jsonify(_email_notify_settings_to_api_dict(full))
    data = request.get_json(silent=True) or {}
    cur = _email_notify_settings_load()
    if 'enabled' in data:
        cur['enabled'] = bool(data['enabled'])
    for k in ('host', 'username', 'from_name', 'from_addr', 'notify_to'):
        if k in data and isinstance(data[k], str):
            cur[k] = data[k].strip()
    if 'port' in data:
        try:
            cur['port'] = int(data['port'])
        except (TypeError, ValueError):
            pass
    if 'use_tls' in data:
        cur['use_tls'] = bool(data['use_tls'])
    if 'use_starttls' in data:
        cur['use_starttls'] = bool(data['use_starttls'])
    if 'events' in data and isinstance(data['events'], dict):
        for ek in _EMAIL_NOTIFY_EVENT_DEFAULTS:
            if ek in data['events']:
                cur['events'][ek] = bool(data['events'][ek])
    if bool(data.get('clear_smtp_password')):
        cur['smtp_password'] = ''
    elif isinstance(data.get('smtp_password'), str) and data['smtp_password'].strip():
        cur['smtp_password'] = data['smtp_password'].strip()

    try:
        pnum = int(cur.get('port') or 587)
    except (TypeError, ValueError):
        pnum = 587
    cur['port'] = pnum
    # Port 465 is always implicit TLS; STARTTLS does not apply (and confuses some clients).
    if pnum == 465:
        cur['use_tls'] = True
        cur['use_starttls'] = False

    persist = {
        'enabled': bool(cur['enabled']),
        'host': (cur.get('host') or '').strip(),
        'port': int(cur.get('port') or 587),
        'use_tls': bool(cur.get('use_tls')),
        'use_starttls': bool(cur.get('use_starttls')),
        'username': (cur.get('username') or '').strip(),
        'from_name': (cur.get('from_name') or '').strip() or 'Ascend',
        'from_addr': (cur.get('from_addr') or '').strip(),
        'notify_to': (cur.get('notify_to') or '').strip(),
        'events': dict(cur['events']),
        'smtp_password_encrypted': _encrypt_password(cur['smtp_password']) if cur.get('smtp_password') else '',
    }
    rec = db.session.get(AppSetting, EMAIL_NOTIFY_SETTING_KEY)
    if rec is None:
        rec = AppSetting(key=EMAIL_NOTIFY_SETTING_KEY, value=json.dumps(persist))
        db.session.add(rec)
    else:
        rec.value = json.dumps(persist)
    db.session.commit()
    _audit_log('settings.email_notifications_updated', 'ok', 'Email notification settings updated')
    fresh = _email_notify_settings_load()
    return jsonify(_email_notify_settings_to_api_dict(fresh))


@app.route('/api/settings/email-notifications/test', methods=['POST'])
@csrf.exempt
@login_required
def api_settings_email_notifications_test():
    err = _admin_required()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    full = _email_notify_settings_load()
    if not (full.get('host') or '').strip():
        return jsonify({'error': 'Configure SMTP host and save before testing.'}), 400
    to_override = (data.get('to') or '').strip()
    recipients = _parse_notify_emails(to_override) if to_override else _parse_notify_emails(full.get('notify_to') or '')
    if not recipients:
        return jsonify({'error': 'Set “Send alerts to” and save, or pass `to` in the request body.'}), 400
    subject = (data.get('subject') or 'Ascend: test email').strip()[:900]
    body = (data.get('body') or (
        'This is a test message from Ascend.\n\n'
        'If you received this, SMTP settings are working.'
    )).strip()[:500000]
    try:
        _smtp_send_raw(full, recipients, subject, body)
    except Exception as e:
        _email_notify_delivery_status_record('test', 'failed', str(e), subject, recipients, body)
        return jsonify({'error': str(e)}), 502
    _email_notify_delivery_status_record('test', 'sent', 'Test email sent successfully.', subject, recipients, body)
    return jsonify({'ok': True, 'sent_to': recipients})


@app.route('/api/settings/email-notifications/log', methods=['GET', 'DELETE'])
@csrf.exempt
@login_required
def api_settings_email_notifications_log():
    err = _admin_required()
    if err:
        return err
    if request.method == 'DELETE':
        if not _email_notify_log_clear():
            return jsonify({'error': 'Failed to clear email log.'}), 500
        return jsonify({'ok': True, 'items': []})
    limit = request.args.get('limit', 200)
    return jsonify({'items': _email_notify_log_load(limit)})


@app.route('/api/settings/security', methods=['GET'])
@login_required
def api_settings_security():
    return jsonify({
        'two_factor_enabled': bool(getattr(current_user, 'otp_enabled', False)),
        'username': current_user.username,
    })


@app.route('/api/settings/security/2fa/setup', methods=['POST'])
@csrf.exempt
@login_required
def api_settings_security_2fa_setup():
    secret = _totp_secret_generate()
    current_user.otp_secret_encrypted = _encrypt_password(secret)
    current_user.otp_enabled = False
    db.session.commit()
    issuer = 'Ascend'
    label = f'{issuer}:{current_user.username}'
    otpauth = (
        f'otpauth://totp/{label}?'
        f'secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30'
    )
    _audit_log('security.2fa_setup_started', 'ok', '2FA setup secret generated')
    return jsonify({'secret': secret, 'otpauth_uri': otpauth})


@app.route('/api/settings/security/2fa/enable', methods=['POST'])
@csrf.exempt
@login_required
def api_settings_security_2fa_enable():
    data = request.get_json(silent=True) or {}
    secret = _user_otp_secret(current_user)
    if not secret:
        return jsonify({'error': 'Start 2FA setup first.'}), 400
    if not _totp_verify(secret, data.get('code') or ''):
        _audit_log('security.2fa_enable_failed', 'failed', 'Invalid 2FA setup code')
        return jsonify({'error': 'Invalid authenticator code.'}), 400
    current_user.otp_enabled = True
    db.session.commit()
    _audit_log('security.2fa_enabled', 'ok', '2FA enabled')
    return jsonify({'ok': True, 'two_factor_enabled': True})


@app.route('/api/settings/security/2fa/disable', methods=['POST'])
@csrf.exempt
@login_required
def api_settings_security_2fa_disable():
    data = request.get_json(silent=True) or {}
    if not current_user.check_password(data.get('password') or ''):
        _audit_log('security.2fa_disable_failed', 'failed', 'Invalid password while disabling 2FA')
        return jsonify({'error': 'Password is incorrect.'}), 400
    secret = _user_otp_secret(current_user)
    if current_user.otp_enabled and secret and not _totp_verify(secret, data.get('code') or ''):
        _audit_log('security.2fa_disable_failed', 'failed', 'Invalid 2FA code while disabling 2FA')
        return jsonify({'error': 'Invalid authenticator code.'}), 400
    current_user.otp_enabled = False
    current_user.otp_secret_encrypted = None
    db.session.commit()
    _audit_log('security.2fa_disabled', 'ok', '2FA disabled')
    return jsonify({'ok': True, 'two_factor_enabled': False})


@app.route('/api/audit-log', methods=['GET', 'DELETE'])
@csrf.exempt
@login_required
def api_audit_log():
    err = _admin_required()
    if err:
        return err
    if request.method == 'DELETE':
        _json_setting_save(AUDIT_LOG_SETTING_KEY, [])
        return jsonify({'ok': True, 'items': []})
    try:
        limit = max(1, min(int(request.args.get('limit', 250)), 1000))
    except (TypeError, ValueError):
        limit = 250
    return jsonify({'items': _json_setting_load(AUDIT_LOG_SETTING_KEY, [])[:limit]})


def _backup_health_status(last_backup, enabled_schedules):
    if not last_backup:
        return 'warning' if enabled_schedules else 'idle'
    if last_backup.status == 'failed':
        return 'failed'
    if last_backup.status == 'pending':
        return 'running'
    if last_backup.completed_at:
        age_hours = (datetime.now(timezone.utc) - (last_backup.completed_at.replace(tzinfo=timezone.utc) if last_backup.completed_at.tzinfo is None else last_backup.completed_at)).total_seconds() / 3600
        if enabled_schedules and age_hours > 30:
            return 'stale'
    return 'healthy'


@app.route('/api/backups/health')
@login_required
def api_backup_health():
    rows = []
    conns = DatabaseConnection.query.filter_by(user_id=current_user.id).order_by(DatabaseConnection.name.asc()).all()
    for conn in conns:
        backups = BackupArchive.query.filter_by(connection_id=conn.id).order_by(BackupArchive.started_at.desc()).limit(20).all()
        last = backups[0] if backups else None
        schedules = BackupSchedule.query.filter_by(connection_id=conn.id).all()
        enabled = [s for s in schedules if s.enabled]
        failed_count = sum(1 for b in backups if b.status == 'failed')
        success_count = sum(1 for b in backups if b.status == 'success')
        latest_schedule = None
        if schedules:
            latest_schedule = max(schedules, key=lambda s: s.updated_at or s.created_at or datetime.min)
        rows.append({
            'connection': conn.to_dict(),
            'status': _backup_health_status(last, enabled),
            'last_backup': last.to_dict() if last else None,
            'recent_success_count': success_count,
            'recent_failed_count': failed_count,
            'schedule_count': len(schedules),
            'enabled_schedule_count': len(enabled),
            'last_schedule_status': latest_schedule.last_run_status if latest_schedule else None,
            'last_schedule_error': latest_schedule.last_run_error if latest_schedule else None,
            'last_schedule_run_at': iso_utc(latest_schedule.last_run_at) if latest_schedule else None,
            'total_success_size_bytes': sum((b.size_bytes or 0) for b in backups if b.status == 'success'),
        })
    return jsonify({'items': rows})


@app.route('/api/settings/backup-upload', methods=['GET', 'PUT'])
@csrf.exempt
@login_required
def api_settings_backup_upload():
    err = _admin_required()
    if err:
        return err
    if request.method == 'GET':
        return jsonify(_backup_upload_settings_to_api_dict(_backup_upload_settings_load()))
    data = request.get_json(silent=True) or {}
    cur = _backup_upload_settings_load()
    if 'enabled' in data:
        cur['enabled'] = bool(data['enabled'])
    for k in ('provider', 'webdav_url', 'username', 'remote_path'):
        if k in data and isinstance(data[k], str):
            cur[k] = data[k].strip()
    if bool(data.get('clear_password')):
        cur['password'] = ''
    elif isinstance(data.get('password'), str) and data['password'].strip():
        cur['password'] = data['password'].strip()
    persist = {
        'enabled': bool(cur.get('enabled')),
        'provider': 'webdav',
        'webdav_url': (cur.get('webdav_url') or '').strip(),
        'username': (cur.get('username') or '').strip(),
        'remote_path': (cur.get('remote_path') or '').strip().strip('/'),
        'password_encrypted': _encrypt_password(cur['password']) if cur.get('password') else '',
    }
    rec = db.session.get(AppSetting, BACKUP_UPLOAD_SETTING_KEY)
    if rec is None:
        rec = AppSetting(key=BACKUP_UPLOAD_SETTING_KEY, value=json.dumps(persist))
        db.session.add(rec)
    else:
        rec.value = json.dumps(persist)
    db.session.commit()
    _audit_log('settings.backup_upload_updated', 'ok', 'Remote backup upload settings updated')
    return jsonify(_backup_upload_settings_to_api_dict(_backup_upload_settings_load()))


@app.route('/api/settings/backup-upload/test', methods=['POST'])
@csrf.exempt
@login_required
def api_settings_backup_upload_test():
    err = _admin_required()
    if err:
        return err
    full = _backup_upload_settings_load()
    if not (full.get('webdav_url') or '').strip():
        return jsonify({'error': 'Set the WebDAV URL and save before testing.'}), 400
    if not (full.get('username') or '').strip() or not full.get('password'):
        return jsonify({'error': 'Set the WebDAV username and app password first. Koofr requires a generated WebDAV/app password, not your normal login password.'}), 400
    tmp = None
    try:
        tmp = tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False, encoding='utf-8')
        tmp.write(f'Ascend backup upload test\nUTC: {datetime.now(timezone.utc).isoformat()}\n')
        tmp.close()
        target = _upload_backup_to_remote(tmp.name, f'ascend-upload-test-{int(time.time())}.txt')
    except Exception as e:
        _audit_log('backup_upload.test', 'failed', str(e))
        return jsonify({'error': str(e)}), 502
    finally:
        if tmp is not None:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
    _audit_log('backup_upload.test', 'ok', 'Remote backup upload test succeeded', {'uploaded_to': target})
    return jsonify({'ok': True, 'uploaded_to': target})


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
    _audit_log('project.created', 'ok', f'Project created: {project.name}', {'project_id': project.id})

    _notify_email_async(
        'project_created',
        f'Ascend: project created — {project.name}',
        f'Project: {project.name}\nFolder: {project.folder_name}\nGitHub: {project.github_url}\n'
        f'By user id: {current_user.id} ({current_user.username})\nTime (UTC): {datetime.now(timezone.utc).isoformat()}',
    )

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
    _audit_log('project.updated', 'ok', f'Project updated: {project.name}', {'project_id': project.id})

    webhook_result = None
    if project.auto_deploy or prev_auto_deploy or 'enable_webhook' in data:
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

    pname = project.name
    pfolder = project.folder_name

    # Best-effort cleanup of the GitHub webhook before we delete the row
    if project.github_hook_id:
        _delete_github_webhook(project)

    db.session.delete(project)
    db.session.commit()
    _audit_log('project.deleted', 'ok', f'Project deleted: {pname}', {'folder': pfolder})
    _notify_email_async(
        'project_deleted',
        f'Ascend: project deleted — {pname}',
        f'Project “{pname}” (folder {pfolder}) was deleted by {current_user.username}.\n'
        f'Time (UTC): {datetime.now(timezone.utc).isoformat()}',
    )
    return jsonify({'status': 'deleted'})


@app.route('/api/project/<int:project_id>/github-webhook/sync', methods=['POST'])
@csrf.exempt
@login_required
def api_sync_project_github_webhook(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    result = _sync_github_webhook(project)
    return jsonify(result)


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
    _audit_log('app.created', 'ok', f'App created: {project.name} / {new_app.name}', {'project_id': project.id, 'app_id': new_app.id})
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
    _audit_log('app.updated', 'ok', f'App updated: {a.project.name} / {a.name}', {'project_id': a.project_id, 'app_id': a.id})
    return jsonify(a.to_dict())


@app.route('/api/app/<int:app_id>', methods=['DELETE'])
@csrf.exempt
@login_required
def api_delete_app(app_id):
    a = App.query.get_or_404(app_id)
    if a.project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    proj_name = a.project.name
    app_name = a.name

    # Best-effort: stop the pm2 process so the port is freed
    if a.pm2_name:
        try:
            subprocess.run(['pm2', 'delete', a.pm2_name], capture_output=True, timeout=10)
        except Exception:
            pass

    db.session.delete(a)
    db.session.commit()
    _audit_log('app.deleted', 'ok', f'App deleted: {proj_name} / {app_name}')
    _notify_email_async(
        'app_deleted',
        f'Ascend: app deleted — {proj_name} / {app_name}',
        f'App “{app_name}” in project “{proj_name}” was deleted by {current_user.username}.\n'
        f'Time (UTC): {datetime.now(timezone.utc).isoformat()}',
    )
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
    _audit_log('deployment.started', 'ok', f'Deployment started: {a.project.name} / {a.name}', {'deployment_id': deployment.id, 'app_id': a.id})

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


@app.route('/api/app/<int:app_id>/ssl/retry', methods=['POST'])
@csrf.exempt
@login_required
def api_retry_app_ssl(app_id):
    a = App.query.get_or_404(app_id)
    if a.project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    if not a.domain:
        return jsonify({'error': 'Set a domain before retrying SSL'}), 400
    if not a.app_port:
        return jsonify({'error': 'Set an app port before retrying SSL'}), 400
    if not a.enable_ssl:
        return jsonify({'error': 'Enable SSL in app settings before retrying'}), 400

    active = Deployment.query.filter_by(app_id=a.id, triggered_by='ssl-retry').filter(
        Deployment.status.in_(['pending', 'running'])
    ).first()
    if active:
        return jsonify({'error': 'An SSL retry is already running for this app', 'id': active.id}), 409

    dep = Deployment(
        project_id=a.project_id,
        app_id=a.id,
        status='pending',
        branch=a.project.github_branch,
        triggered_by='ssl-retry',
    )
    db.session.add(dep)
    db.session.commit()
    _audit_log('ssl_retry.started', 'ok', f'SSL retry started: {a.project.name} / {a.name}', {'deployment_id': dep.id, 'app_id': a.id})

    threading.Thread(target=retry_app_ssl_bg, args=(dep.id,), daemon=True).start()
    return jsonify({'id': dep.id, 'status': 'pending'})


@app.route('/api/app/<int:app_id>/restart', methods=['POST'])
@csrf.exempt
@login_required
def api_restart_app(app_id):
    a = App.query.get_or_404(app_id)
    if a.project.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    if not a.pm2_name:
        return jsonify({'error': 'Set a PM2 name before restarting'}), 400

    active = Deployment.query.filter_by(app_id=a.id, triggered_by='restart').filter(
        Deployment.status.in_(['pending', 'running'])
    ).first()
    if active:
        return jsonify({'error': 'A restart is already running for this app', 'id': active.id}), 409

    dep = Deployment(
        project_id=a.project_id,
        app_id=a.id,
        status='pending',
        branch=a.project.github_branch,
        triggered_by='restart',
    )
    db.session.add(dep)
    db.session.commit()
    _audit_log('app.restart_started', 'ok', f'Restart started: {a.project.name} / {a.name}', {'deployment_id': dep.id, 'app_id': a.id})

    threading.Thread(target=restart_app_bg, args=(dep.id,), daemon=True).start()
    return jsonify({'id': dep.id, 'status': 'pending'})


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

    _audit_log('project.deploy_started', 'ok', f'Deploy all started: {project.name}', {'project_id': project.id, 'deployment_ids': deployment_ids})
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

    def patch_hook(hook_id):
        return _github_api(
            'PATCH', f'/repos/{owner}/{repo}/hooks/{hook_id}',
            cred.token, payload,
        )

    if project.github_hook_id:
        status, resp = patch_hook(project.github_hook_id)
        if status == 200:
            return {'status': 'updated', 'hook_id': project.github_hook_id, 'url': hook_url}
        if status == 404:
            project.github_hook_id = None  # fall through to create
            db.session.commit()
        else:
            return {'status': 'update_failed', 'code': status, 'message': (resp or {}).get('message')}

    # If the stored hook id is missing/stale, find an existing hook for this
    # project secret and update it instead of creating duplicates.
    status, hooks = _github_api('GET', f'/repos/{owner}/{repo}/hooks', cred.token)
    if status == 200 and isinstance(hooks, list):
        expected_suffix = f'/webhook/github/{project.webhook_secret}'
        for hook in hooks:
            cfg = hook.get('config') or {}
            existing_url = cfg.get('url') or ''
            if existing_url.endswith(expected_suffix):
                hook_id = hook.get('id')
                patch_status, patch_resp = patch_hook(hook_id)
                if patch_status == 200:
                    project.github_hook_id = hook_id
                    db.session.commit()
                    return {'status': 'updated', 'hook_id': hook_id, 'url': hook_url}
                return {
                    'status': 'update_failed',
                    'code': patch_status,
                    'message': (patch_resp or {}).get('message'),
                }

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
                forwarded_port = request.headers.get('X-Forwarded-Port')
                if forwarded_port and ':' not in host:
                    default_port = '443' if proto == 'https' else '80'
                    if forwarded_port != default_port:
                        host = f'{host}:{forwarded_port}'
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
        'created_at': iso_utc(c.created_at)
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


def _app_deploy_dir(app_row):
    deploy_dir = DEPLOYMENTS_DIR / app_row.project.folder_name
    if app_row.subdirectory:
        deploy_dir = deploy_dir / app_row.subdirectory.strip('/')
    return deploy_dir


def _env_with_app_port(app_row):
    content = app_row.env_content or ''
    if app_row.app_port and not re.search(r'(?m)^\s*PORT\s*=', content):
        suffix = '' if not content or content.endswith('\n') else '\n'
        content = f'{content}{suffix}PORT={app_row.app_port}\n'
    return content


def _write_app_env(app_row, deploy_dir, log):
    content = _env_with_app_port(app_row)
    if not content:
        log.write("  No .env content saved; leaving existing .env unchanged.\n")
        return
    (deploy_dir / '.env').write_text(content, encoding='utf-8')
    if app_row.app_port and not re.search(r'(?m)^\s*PORT\s*=', app_row.env_content or ''):
        log.write(f"  .env written (added PORT={app_row.app_port})\n")
    else:
        log.write("  .env written\n")


def _pm2_start_command(app_row):
    # Run arbitrary start commands through bash so commands like
    # "npm run start:prod" behave the same as they do in a terminal.
    # PM2 does not load .env files by itself, so source it here and make
    # sure the configured app port is exported for frameworks like Nest.
    command = app_row.start_command
    if app_row.app_port:
        command = f'export PORT={app_row.app_port}; {command}'
    command = f'set -a; [ -f .env ] && . ./.env; set +a; {command}'
    return [
        'pm2', 'start', 'bash',
        '--name', app_row.pm2_name,
        '--', '-lc', f'exec bash -lc {json.dumps(command)}',
    ]


def _wait_for_app_port(app_row, log, timeout=20):
    if not app_row.app_port:
        return True
    log.write(f"  Waiting for app to listen on 127.0.0.1:{app_row.app_port}...\n")
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _is_port_listening(app_row.app_port):
            log.write("  App port is listening.\n")
            return True
        time.sleep(1)
    log.write(
        f"  App did not bind to port {app_row.app_port} within {timeout}s. "
        "Check that the app reads PORT from .env or update the app port setting.\n"
    )
    return False


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

                deploy_dir = _app_deploy_dir(app_row)
                if app_row.subdirectory:
                    log.write(f"  Using subdirectory: {app_row.subdirectory}\n")
                    if not deploy_dir.exists():
                        raise RuntimeError(f"Subdirectory not found: {app_row.subdirectory}")

                if app_row.env_content:
                    log.write("\nStep 2: Writing .env file...\n")
                    _write_app_env(app_row, deploy_dir, log)
                elif app_row.app_port:
                    log.write("\nStep 2: Writing .env file...\n")
                    _write_app_env(app_row, deploy_dir, log)

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
                    if not run_cmd(_pm2_start_command(app_row), log, cwd=deploy_dir):
                        raise RuntimeError("pm2 start failed")
                    run_cmd(['pm2', 'save'], log)
                    if not _wait_for_app_port(app_row, log):
                        run_cmd(['pm2', 'logs', app_row.pm2_name, '--lines', '50', '--nostream'], log, check=False)
                        raise RuntimeError(f"App did not start listening on port {app_row.app_port}")

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
            try:
                st = deployment.status
                label = f'{project.name} / {app_row.name}'
                if st == 'success':
                    _notify_email_async(
                        'deployment_success',
                        f'Ascend: deployment succeeded — {label}',
                        f'Deployment finished successfully for {label}.\n'
                        f'Time (UTC): {datetime.now(timezone.utc).isoformat()}',
                    )
                elif st == 'failed':
                    err = (deployment.error_message or '')[:2000]
                    _notify_email_async(
                        'deployment_failed',
                        f'Ascend: deployment failed — {label}',
                        f'Deployment failed for {label}.\nError: {err}\n'
                        f'Time (UTC): {datetime.now(timezone.utc).isoformat()}',
                    )
            except Exception:
                pass


def retry_app_ssl_bg(deployment_id):
    """Background task: retry only Nginx/SSL for an existing App."""
    with app.app_context():
        deployment = db.session.get(Deployment, deployment_id)
        if not deployment:
            return

        app_row = deployment.app
        project = deployment.project
        if not app_row:
            deployment.status = 'failed'
            deployment.error_message = 'SSL retry has no associated app'
            db.session.commit()
            return

        log_file = LOG_DIR / f"ssl_retry_{deployment_id}_{int(time.time())}.log"
        deployment.log_file = str(log_file)
        deployment.status = 'running'
        db.session.commit()

        start_time = time.time()

        try:
            with open(log_file, 'w', encoding='utf-8') as log:
                log.write(f"=== SSL Retry Started: {datetime.now(timezone.utc).isoformat()} ===\n")
                log.write(f"Project: {project.name}\n")
                log.write(f"App: {app_row.name} ({app_row.app_type})\n")
                log.write(f"Domain: {app_row.domain or '-'}\n")
                log.write(f"Port: {app_row.app_port or '-'}\n\n")

                if not app_row.domain:
                    raise RuntimeError('App has no domain configured')
                if not app_row.app_port:
                    raise RuntimeError('App has no app port configured')
                if not app_row.enable_ssl:
                    raise RuntimeError('SSL is disabled for this app. Enable SSL in app settings first.')

                dns = _check_domain_points_to_server(app_row.domain)
                if not dns.get('ok'):
                    log.write(f"DNS check failed: {dns.get('error')}\n")
                    raise RuntimeError(dns.get('error') or 'Domain DNS does not point to this server')
                log.write(
                    "DNS check passed: "
                    f"{', '.join(dns.get('domain_ips') or [])} -> "
                    f"{', '.join(dns.get('server_ips') or [])}\n\n"
                )

                if not setup_nginx_config(app_row, log):
                    raise RuntimeError('SSL retry failed - see log above')

                log.write("\n=== SSL Retry Completed Successfully ===\n")
                deployment.status = 'success'

        except Exception as e:
            deployment.status = 'failed'
            deployment.error_message = str(e)
            try:
                with open(log_file, 'a', encoding='utf-8') as log:
                    log.write(f"\n!!! SSL Retry Failed: {e} !!!\n")
            except Exception:
                pass

        finally:
            deployment.completed_at = datetime.now(timezone.utc)
            deployment.duration_seconds = int(time.time() - start_time)
            db.session.commit()
            try:
                st = deployment.status
                label = f'{project.name} / {app_row.name} (SSL retry)'
                if st == 'success':
                    _notify_email_async(
                        'deployment_success',
                        f'Ascend: SSL retry succeeded — {project.name} / {app_row.name}',
                        f'{label} completed.\nTime (UTC): {datetime.now(timezone.utc).isoformat()}',
                    )
                elif st == 'failed':
                    err = (deployment.error_message or '')[:2000]
                    _notify_email_async(
                        'deployment_failed',
                        f'Ascend: SSL retry failed — {project.name} / {app_row.name}',
                        f'{label}.\nError: {err}\nTime (UTC): {datetime.now(timezone.utc).isoformat()}',
                    )
            except Exception:
                pass


def restart_app_bg(deployment_id):
    """Background task: write saved .env and restart an existing PM2 app."""
    with app.app_context():
        deployment = db.session.get(Deployment, deployment_id)
        if not deployment:
            return

        app_row = deployment.app
        project = deployment.project
        if not app_row:
            deployment.status = 'failed'
            deployment.error_message = 'Restart has no associated app'
            db.session.commit()
            return

        log_file = LOG_DIR / f"restart_{deployment_id}_{int(time.time())}.log"
        deployment.log_file = str(log_file)
        deployment.status = 'running'
        db.session.commit()

        start_time = time.time()

        try:
            with open(log_file, 'w', encoding='utf-8') as log:
                log.write(f"=== App Restart Started: {datetime.now(timezone.utc).isoformat()} ===\n")
                log.write(f"Project: {project.name}\n")
                log.write(f"App: {app_row.name} ({app_row.app_type})\n")
                log.write(f"PM2 name: {app_row.pm2_name or '-'}\n\n")

                if not app_row.pm2_name:
                    raise RuntimeError('App has no PM2 name configured')

                deploy_dir = _app_deploy_dir(app_row)
                if not deploy_dir.exists():
                    raise RuntimeError(
                        f'Deploy directory not found: {deploy_dir}. Run a full deploy first.'
                    )

                if app_row.env_content is not None or app_row.app_port:
                    log.write("Step 1: Writing saved .env file...\n")
                    _write_app_env(app_row, deploy_dir, log)
                else:
                    log.write("Step 1: No .env content saved; leaving existing .env unchanged.\n")

                log.write("\nStep 2: Restarting PM2 process...\n")
                if app_row.start_command:
                    log.write("  Recreating PM2 process so .env and PORT are loaded cleanly...\n")
                    run_cmd(['pm2', 'delete', app_row.pm2_name], log, check=False)
                    if not run_cmd(_pm2_start_command(app_row), log, cwd=deploy_dir):
                        raise RuntimeError('PM2 restart/start failed')
                else:
                    if not run_cmd(['pm2', 'restart', app_row.pm2_name, '--update-env'], log, cwd=deploy_dir):
                        raise RuntimeError('PM2 restart failed and no start command is configured')

                run_cmd(['pm2', 'save'], log, check=False)
                if not _wait_for_app_port(app_row, log):
                    run_cmd(['pm2', 'logs', app_row.pm2_name, '--lines', '50', '--nostream'], log, check=False)
                    raise RuntimeError(f"App did not start listening on port {app_row.app_port}")
                log.write("\n=== App Restart Completed Successfully ===\n")
                deployment.status = 'success'

        except Exception as e:
            deployment.status = 'failed'
            deployment.error_message = str(e)
            try:
                with open(log_file, 'a', encoding='utf-8') as log:
                    log.write(f"\n!!! App Restart Failed: {e} !!!\n")
            except Exception:
                pass

        finally:
            deployment.completed_at = datetime.now(timezone.utc)
            deployment.duration_seconds = int(time.time() - start_time)
            db.session.commit()
            try:
                st = deployment.status
                label = f'{project.name} / {app_row.name} (restart)'
                if st == 'success':
                    _notify_email_async(
                        'deployment_success',
                        f'Ascend: app restart succeeded — {project.name} / {app_row.name}',
                        f'{label} completed.\nTime (UTC): {datetime.now(timezone.utc).isoformat()}',
                    )
                elif st == 'failed':
                    err = (deployment.error_message or '')[:2000]
                    _notify_email_async(
                        'deployment_failed',
                        f'Ascend: app restart failed — {project.name} / {app_row.name}',
                        f'{label}.\nError: {err}\nTime (UTC): {datetime.now(timezone.utc).isoformat()}',
                    )
            except Exception:
                pass


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


def _verify_http_challenge_route(domain, log_file):
    """Check that public HTTP requests for this domain hit our Nginx vhost."""
    token = f"ascend-probe-{secrets.token_hex(8)}"
    body = f"ascend-ok-{secrets.token_hex(8)}"
    challenge_dir = ACME_WEBROOT / '.well-known' / 'acme-challenge'
    challenge_file = challenge_dir / token

    try:
        challenge_dir.mkdir(parents=True, exist_ok=True)
        challenge_file.write_text(body, encoding='utf-8')

        url = f'http://{domain}/.well-known/acme-challenge/{token}'
        log_file.write(f"  Checking HTTP challenge route: {url}\n")
        with _urlreq.urlopen(url, timeout=10) as resp:
            returned = resp.read().decode('utf-8', errors='replace').strip()
            status = getattr(resp, 'status', None) or resp.getcode()

        if status != 200 or returned != body:
            log_file.write(
                f"  HTTP challenge check failed: status={status}, "
                f"expected={body!r}, got={returned[:200]!r}\n"
            )
            return False

        log_file.write("  HTTP challenge route is reachable.\n")
        return True
    except Exception as e:
        log_file.write(f"  HTTP challenge check failed: {e}\n")
        return False
    finally:
        try:
            challenge_file.unlink(missing_ok=True)
        except Exception:
            pass


def _find_valid_certificate(domain, min_days=7):
    live_dir = '/etc/letsencrypt/live'
    if not domain or not os.path.isdir(live_dir):
        return None

    now = datetime.now(timezone.utc)
    for name in sorted(os.listdir(live_dir)):
        cert_dir = os.path.join(live_dir, name)
        cert_path = os.path.join(cert_dir, 'cert.pem')
        fullchain_path = os.path.join(cert_dir, 'fullchain.pem')
        privkey_path = os.path.join(cert_dir, 'privkey.pem')
        if not os.path.exists(cert_path) or not os.path.exists(fullchain_path) or not os.path.exists(privkey_path):
            continue

        try:
            result = subprocess.run(
                ['openssl', 'x509', '-in', cert_path, '-noout', '-dates', '-subject', '-ext', 'subjectAltName'],
                capture_output=True,
                text=True,
                timeout=5,
            )
        except (subprocess.TimeoutExpired, FileNotFoundError):
            continue
        if result.returncode != 0:
            continue

        not_after = None
        names = []
        subject = ''
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.startswith('notAfter='):
                not_after = _parse_openssl_date(line)
            elif line.startswith('subject='):
                subject = line.split('=', 1)[1].strip()
            elif 'DNS:' in line:
                names.extend([d.strip().lower() for d in re.findall(r'DNS:([^,\s]+)', line)])
        if not names:
            cn_match = re.search(r'CN\s*=\s*([^,]+)', subject)
            if cn_match:
                names.append(cn_match.group(1).strip().lower())

        if domain.lower() not in names or not_after is None:
            continue
        days_remaining = int((not_after - now).total_seconds() // 86400)
        if days_remaining >= min_days:
            return {
                'name': name,
                'cert_path': cert_path,
                'fullchain_path': fullchain_path,
                'privkey_path': privkey_path,
                'expires_at': not_after,
                'days_remaining': days_remaining,
            }
    return None


def _build_nginx_config(app_row, cert_info=None):
    common_proxy = (
        f"        proxy_pass http://127.0.0.1:{app_row.app_port};\n"
        f"        proxy_set_header Host $host;\n"
        f"        proxy_set_header X-Real-IP $remote_addr;\n"
        f"        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
        f"        proxy_set_header X-Forwarded-Proto $scheme;\n"
    )
    challenge = (
        f"    location ^~ /.well-known/acme-challenge/ {{\n"
        f"        root {ACME_WEBROOT};\n"
        f"        default_type text/plain;\n"
        f"        try_files $uri =404;\n"
        f"    }}\n"
    )

    if cert_info:
        ssl_options = ''
        if os.path.exists('/etc/letsencrypt/options-ssl-nginx.conf'):
            ssl_options += "    include /etc/letsencrypt/options-ssl-nginx.conf;\n"
        if os.path.exists('/etc/letsencrypt/ssl-dhparams.pem'):
            ssl_options += "    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;\n"
        return (
            f"server {{\n"
            f"    listen 80;\n"
            f"    server_name {app_row.domain};\n"
            f"{challenge}"
            f"    location / {{ return 301 https://$host$request_uri; }}\n"
            f"}}\n\n"
            f"server {{\n"
            f"    listen 443 ssl;\n"
            f"    server_name {app_row.domain};\n"
            f"    client_max_body_size {app_row.client_max_body};\n"
            f"    ssl_certificate {cert_info['fullchain_path']};\n"
            f"    ssl_certificate_key {cert_info['privkey_path']};\n"
            f"{ssl_options}"
            f"\n"
            f"{challenge}"
            f"\n"
            f"    location / {{\n"
            f"{common_proxy}"
            f"    }}\n"
            f"}}\n"
        )

    return (
        f"server {{\n"
        f"    listen 80;\n"
        f"    server_name {app_row.domain};\n"
        f"    client_max_body_size {app_row.client_max_body};\n"
        f"\n"
        f"{challenge}"
        f"\n"
        f"    location / {{\n"
        f"{common_proxy}"
        f"    }}\n"
        f"}}\n"
    )


def _run_certbot_nginx(domain, log_file):
    lock_path = '/tmp/ascend-certbot.lock'
    lock_file = None
    try:
        import fcntl

        lock_file = open(lock_path, 'w')
        log_file.write("  Waiting for certbot lock...\n")
        fcntl.flock(lock_file, fcntl.LOCK_EX)
    except Exception as e:
        log_file.write(f"  Warning: could not acquire certbot lock ({e}); continuing.\n")

    try:
        cert = subprocess.run([
            'certbot', '--nginx',
            '-d', domain,
            '--non-interactive', '--agree-tos',
            '-m', f'admin@{domain}',
        ], capture_output=True)
    finally:
        if lock_file:
            try:
                import fcntl
                fcntl.flock(lock_file, fcntl.LOCK_UN)
                lock_file.close()
            except Exception:
                pass
    return cert


def setup_nginx_config(app_row, log_file):
    """Write an Nginx virtual host and optionally obtain an SSL cert.

    Returns True on success, False if the config failed to write, test,
    or reload — caller should treat False as a deployment failure so
    domains don't silently 502 after a bad config lands.
    """
    log_file.write(f"  Domain: {app_row.domain}\n")
    existing_cert = _find_valid_certificate(app_row.domain) if app_row.enable_ssl else None
    if existing_cert:
        log_file.write(
            f"  Existing valid certificate found: {existing_cert['name']} "
            f"({existing_cert['days_remaining']}d remaining). Reusing it.\n"
        )

    nginx_config = _build_nginx_config(app_row, existing_cert)

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

        if app_row.enable_ssl and not existing_cert:
            if not _verify_http_challenge_route(app_row.domain, log_file):
                log_file.write(
                    "  SSL preflight failed: Let's Encrypt will not be able to reach "
                    "this domain over HTTP. Check DNS, firewall, port 80, and proxy settings.\n"
                )
                return False

            log_file.write("  Obtaining SSL certificate...\n")
            cert = _run_certbot_nginx(app_row.domain, log_file)
            if cert.returncode != 0:
                stdout = cert.stdout.decode('utf-8', errors='replace').strip()
                stderr = cert.stderr.decode('utf-8', errors='replace').strip()
                if stdout:
                    log_file.write(f"  Certbot stdout:\n{stdout}\n")
                if stderr:
                    log_file.write(f"  Certbot stderr:\n{stderr}\n")
                log_file.write("  Certbot failed; deployment cannot be marked successful while SSL is enabled.\n")
                return False
            log_file.write("  Certificate issued successfully.\n")

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
_setup_lock = threading.Lock()


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


def _load_pm2_logs(pm2_name, lines=120):
    if not pm2_name:
        return {'stdout': '', 'stderr': '', 'combined': ''}
    try:
        n = max(20, min(int(lines or 120), 500))
    except (TypeError, ValueError):
        n = 120
    try:
        result = subprocess.run(
            ['pm2', 'logs', pm2_name, '--lines', str(n), '--nostream'],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return {'stdout': '', 'stderr': str(e), 'combined': str(e)}

    stdout = result.stdout or ''
    stderr = result.stderr or ''
    combined = (stdout + ('\n' if stdout and stderr else '') + stderr).strip()
    return {
        'stdout': stdout[-20000:],
        'stderr': stderr[-20000:],
        'combined': combined[-30000:],
    }


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


def _parse_openssl_date(value):
    if not value:
        return None
    text = value.strip()
    if text.startswith('notAfter=') or text.startswith('notBefore='):
        text = text.split('=', 1)[1].strip()
    for fmt in ('%b %d %H:%M:%S %Y %Z', '%b %d %H:%M:%S %Y GMT'):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _load_certbot_scheduler():
    methods = []
    for timer in ('certbot.timer', 'snap.certbot.renew.timer'):
        try:
            enabled = subprocess.run(
                ['systemctl', 'is-enabled', timer],
                capture_output=True,
                text=True,
                timeout=3,
            )
            active = subprocess.run(
                ['systemctl', 'is-active', timer],
                capture_output=True,
                text=True,
                timeout=3,
            )
        except (subprocess.TimeoutExpired, FileNotFoundError):
            continue
        if enabled.returncode == 0 or active.returncode == 0:
            methods.append({
                'type': 'systemd',
                'name': timer,
                'enabled': enabled.stdout.strip() or 'unknown',
                'active': active.stdout.strip() or 'unknown',
            })

    for cron_path in ('/etc/cron.d/certbot', '/etc/cron.daily/certbot'):
        if os.path.exists(cron_path):
            methods.append({
                'type': 'cron',
                'name': cron_path,
                'enabled': 'present',
                'active': 'present',
            })

    return {
        'scheduled': bool(methods),
        'methods': methods,
    }


def _parse_renewal_config(path):
    info = {
        'exists': False,
        'path': path,
        'authenticator': None,
        'installer': None,
        'renew_hook': None,
        'deploy_hook': None,
    }
    if not os.path.isfile(path):
        return info
    info['exists'] = True
    try:
        with open(path, 'r', errors='replace') as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, value = [x.strip() for x in line.split('=', 1)]
                if key in info:
                    info[key] = value
    except OSError:
        pass
    return info


def _certificate_status(days_remaining):
    if days_remaining is None:
        return 'unknown'
    if days_remaining < 0:
        return 'expired'
    if days_remaining <= 7:
        return 'critical'
    if days_remaining <= 30:
        return 'warning'
    return 'ok'


def _load_letsencrypt_certificates():
    live_dir = '/etc/letsencrypt/live'
    scheduler = _load_certbot_scheduler()
    if not os.path.isdir(live_dir):
        return {'certificates': [], 'scheduler': scheduler}

    app_domains = {}
    try:
        for app_row in App.query.filter(App.domain.isnot(None)).all():
            if app_row.domain:
                app_domains[app_row.domain.lower()] = {
                    'app_id': app_row.id,
                    'app_name': app_row.name,
                    'project_id': app_row.project_id,
                    'project_name': app_row.project.name if app_row.project else None,
                }
    except Exception:
        app_domains = {}

    nginx_sites = _load_nginx_sites()
    site_by_domain = {}
    for site in nginx_sites:
        for name in site.get('server_names') or []:
            site_by_domain.setdefault(name.lower(), []).append(site.get('name'))

    certificates = []
    now = datetime.now(timezone.utc)
    for name in sorted(os.listdir(live_dir)):
        cert_dir = os.path.join(live_dir, name)
        cert_path = os.path.join(cert_dir, 'cert.pem')
        fullchain_path = os.path.join(cert_dir, 'fullchain.pem')
        if not os.path.isdir(cert_dir) or not os.path.exists(cert_path):
            continue

        try:
            result = subprocess.run(
                ['openssl', 'x509', '-in', cert_path, '-noout', '-dates', '-issuer', '-subject', '-ext', 'subjectAltName'],
                capture_output=True,
                text=True,
                timeout=5,
            )
        except (subprocess.TimeoutExpired, FileNotFoundError):
            result = None

        output = result.stdout if result and result.returncode == 0 else ''
        not_before = None
        not_after = None
        issuer = ''
        subject = ''
        domains = []
        for line in output.splitlines():
            line = line.strip()
            if line.startswith('notBefore='):
                not_before = _parse_openssl_date(line)
            elif line.startswith('notAfter='):
                not_after = _parse_openssl_date(line)
            elif line.startswith('issuer='):
                issuer = line.split('=', 1)[1].strip()
            elif line.startswith('subject='):
                subject = line.split('=', 1)[1].strip()
            elif 'DNS:' in line:
                domains.extend([d.strip() for d in re.findall(r'DNS:([^,\s]+)', line)])

        if not domains:
            cn_match = re.search(r'CN\s*=\s*([^,]+)', subject)
            if cn_match:
                domains = [cn_match.group(1).strip()]

        days_remaining = None
        if not_after:
            days_remaining = int((not_after - now).total_seconds() // 86400)

        renewal = _parse_renewal_config(os.path.join('/etc/letsencrypt/renewal', f'{name}.conf'))
        managed_apps = []
        nginx_site_names = set()
        for domain in domains:
            app_info = app_domains.get(domain.lower())
            if app_info and app_info not in managed_apps:
                managed_apps.append(app_info)
            for site_name in site_by_domain.get(domain.lower(), []):
                nginx_site_names.add(site_name)

        auto_renewable = bool(renewal.get('exists') and scheduler.get('scheduled'))
        certificates.append({
            'name': name,
            'domains': domains,
            'primary_domain': domains[0] if domains else name,
            'not_before': iso_utc(not_before),
            'expires_at': iso_utc(not_after),
            'days_remaining': days_remaining,
            'status': _certificate_status(days_remaining),
            'issuer': issuer,
            'cert_path': cert_path,
            'fullchain_path': fullchain_path,
            'renewal_config': renewal,
            'certbot_managed': bool(renewal.get('exists')),
            'auto_renewable': auto_renewable,
            'renewal_note': 'Certbot renewal config and scheduler detected' if auto_renewable else (
                'Renewal config exists, but no certbot timer/cron was detected' if renewal.get('exists')
                else 'No certbot renewal config found'
            ),
            'managed_by_ascend': bool(managed_apps),
            'apps': managed_apps,
            'nginx_sites': sorted(nginx_site_names),
        })

    certificates.sort(key=lambda c: (c['days_remaining'] is None, c['days_remaining'] or 999999))
    return {
        'certificates': certificates,
        'scheduler': scheduler,
    }


def _is_port_listening(port):
    try:
        result = subprocess.run(
            ['ss', '-tln', f'sport = :{port}'],
            capture_output=True, timeout=3
        )
        return b'LISTEN' in result.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None


def _load_server_stats():
    """Whole-server health snapshot. Cheap to call; safe for frequent polls."""
    # CPU: priming at import means interval=None returns the % since our last
    # call — fine for 5s-cached polling.
    cpu_percent = psutil.cpu_percent(interval=None)
    try:
        per_cpu = psutil.cpu_percent(interval=None, percpu=True)
    except Exception:
        per_cpu = []

    vm = psutil.virtual_memory()
    try:
        sw = psutil.swap_memory()
        swap = {'total': sw.total, 'used': sw.used, 'percent': sw.percent}
    except Exception:
        swap = None

    # Disk for the filesystem hosting the deploy directory (falls back to /).
    disk_target = str(DEPLOYMENTS_DIR) if DEPLOYMENTS_DIR.exists() else ('/' if os.name != 'nt' else 'C:\\')
    try:
        du = psutil.disk_usage(disk_target)
        disk = {
            'path': disk_target,
            'total': du.total,
            'used': du.used,
            'free': du.free,
            'percent': du.percent,
        }
    except Exception:
        disk = None

    # Network throughput: compute bytes/sec since the previous sample.
    now = time.time()
    io = psutil.net_io_counters()
    prev = _net_sample
    if prev['t'] is not None and now > prev['t']:
        dt = now - prev['t']
        send_rate = max(0, (io.bytes_sent - prev['sent']) / dt)
        recv_rate = max(0, (io.bytes_recv - prev['recv']) / dt)
    else:
        send_rate = None
        recv_rate = None
    _net_sample['t'] = now
    _net_sample['sent'] = io.bytes_sent
    _net_sample['recv'] = io.bytes_recv

    # Load average (Linux/macOS). psutil returns (0,0,0) on Windows fallback.
    try:
        load1, load5, load15 = psutil.getloadavg()
        load = {'1m': load1, '5m': load5, '15m': load15}
    except (AttributeError, OSError):
        load = None

    try:
        boot_ts = psutil.boot_time()
        uptime_seconds = max(0, int(now - boot_ts))
    except Exception:
        uptime_seconds = None

    try:
        proc_count = len(psutil.pids())
    except Exception:
        proc_count = None

    return {
        'hostname': socket.gethostname(),
        'platform': platform.platform(terse=True),
        'kernel': platform.release(),
        'cpu': {
            'percent': cpu_percent,
            'per_cpu': per_cpu,
            'cores_logical': psutil.cpu_count(logical=True),
            'cores_physical': psutil.cpu_count(logical=False),
        },
        'memory': {
            'total': vm.total,
            'used': vm.used,
            'available': vm.available,
            'percent': vm.percent,
        },
        'swap': swap,
        'disk': disk,
        'network': {
            'bytes_sent': io.bytes_sent,
            'bytes_recv': io.bytes_recv,
            'send_rate_bps': send_rate,
            'recv_rate_bps': recv_rate,
        },
        'load_average': load,
        'uptime_seconds': uptime_seconds,
        'process_count': proc_count,
    }


@app.route('/api/system/stats')
@login_required
def api_system_stats():
    return jsonify(_cached('server_stats', _SYSTEM_TTL, _load_server_stats))


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


@app.route('/api/system/certificates')
@login_required
def api_system_certificates():
    return jsonify(_cached('certificates', 60, _load_letsencrypt_certificates))


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


@app.route('/api/app/<int:app_id>/pm2-logs')
@login_required
def api_app_pm2_logs(app_id):
    a = db.session.get(App, app_id)
    if not a or a.project.user_id != current_user.id:
        return jsonify({'error': 'Not found'}), 404
    if not a.pm2_name:
        return jsonify({'error': 'App has no PM2 name configured'}), 400
    lines = request.args.get('lines', 120)
    return jsonify({
        'pm2_name': a.pm2_name,
        'logs': _load_pm2_logs(a.pm2_name, lines=lines),
    })


# ═══════════════════════════════════════════
# File manager/server-files routes and shell passphrase helpers live in backend.file_manager.routes.
from backend.file_manager.routes import (
    register_file_manager_feature,
    set_shell_passphrase,
    shell_passphrase_is_configured,
    _shell_passphrase_env,
    _shell_passphrase_hash,
    _shell_passphrase_ok,
)

register_file_manager_feature(
    flask_app=app,
    db_instance=db,
    csrf_protect=csrf,
    deployments_dir=DEPLOYMENTS_DIR,
    app_model=App,
    project_model=Project,
    app_setting_model=AppSetting,
    iso_utc_func=iso_utc,
    notify_email_async=_notify_email_async,
    app_deploy_dir=_app_deploy_dir,
    shell_passphrase_setting_key=SHELL_PASSPHRASE_SETTING_KEY,
)

# Terminal (server shell via xterm.js + WebSocket)
# ═══════════════════════════════════════════

try:
    import pty
    import termios
    import fcntl
    import select as _py_select
    import signal as _py_signal
    _TERMINAL_SUPPORTED = True
except ImportError:
    # Not on Linux (Windows dev host) — endpoints will return 501.
    _TERMINAL_SUPPORTED = False

# Session-scoped passphrase gate. Unlock persists until the Flask session is
# cleared (logout), after which the user must re-enter it. The passphrase
# itself is stored in the AppSetting table (or pinned via TERMINAL_PASSPHRASE).
_TERMINAL_ATTEMPTS = {}  # user_id -> {'count': int, 'until': float}
_TERMINAL_ATTEMPT_LIMIT = 5
_TERMINAL_LOCKOUT_SECONDS = 60
_TERMINAL_WS_SUPPORTED = False


def _terminal_passphrase_ok(given):
    return _shell_passphrase_ok(given)


def _terminal_unlocked():
    return bool(session.get('terminal_unlocked'))


@app.route('/api/terminal/status')
@login_required
def api_terminal_status():
    return jsonify({
        'supported': _TERMINAL_SUPPORTED and _TERMINAL_WS_SUPPORTED,
        'unlocked': _terminal_unlocked(),
        'needs_setup': not shell_passphrase_is_configured(),
        'can_setup': bool(getattr(current_user, 'is_admin', False)),
    })


@app.route('/api/terminal/unlock', methods=['POST'])
@csrf.exempt
@login_required
def api_terminal_unlock():
    if not _TERMINAL_SUPPORTED:
        return jsonify({'error': 'Terminal is only available on Linux servers.'}), 501
    if not _TERMINAL_WS_SUPPORTED:
        return jsonify({'error': 'Terminal websocket support is not installed.'}), 501
    data = request.get_json(silent=True) or {}
    given = data.get('passphrase', '')
    now = time.time()
    rec = _TERMINAL_ATTEMPTS.get(current_user.id, {'count': 0, 'until': 0.0})
    if rec['until'] > now:
        wait = int(rec['until'] - now)
        return jsonify({'error': f'Too many attempts. Try again in {wait}s.'}), 429
    if _terminal_passphrase_ok(given):
        session['terminal_unlocked'] = True
        _TERMINAL_ATTEMPTS.pop(current_user.id, None)
        ip = (request.headers.get('X-Forwarded-For') or request.remote_addr or '').split(',')[0].strip()
        _notify_email_async(
            'terminal_unlock',
            f'Ascend: web terminal unlocked — {current_user.username}',
            f'User {current_user.username} unlocked the web terminal (server shell session).\n'
            f'IP: {ip}\nTime (UTC): {datetime.now(timezone.utc).isoformat()}',
        )
        return jsonify({'unlocked': True})
    rec['count'] += 1
    if rec['count'] >= _TERMINAL_ATTEMPT_LIMIT:
        rec = {'count': 0, 'until': now + _TERMINAL_LOCKOUT_SECONDS}
    _TERMINAL_ATTEMPTS[current_user.id] = rec
    return jsonify({'error': 'Incorrect passphrase.'}), 401


@app.route('/api/terminal/lock', methods=['POST'])
@csrf.exempt
@login_required
def api_terminal_lock():
    session.pop('terminal_unlocked', None)
    return jsonify({'ok': True})


@app.route('/api/shell-passphrase', methods=['POST'])
@csrf.exempt
@login_required
def api_set_shell_passphrase():
    """Admin-only: set or rotate the shell passphrase used by the terminal
    and server-files unlock screens.

    Setting it for the first time (initial setup) requires no current passphrase.
    Rotating an existing passphrase requires `current` to match. The env-var
    pin (TERMINAL_PASSPHRASE) cannot be changed from the UI."""
    if not getattr(current_user, 'is_admin', False):
        return jsonify({'error': 'Admin only.'}), 403
    if _shell_passphrase_env() is not None:
        return jsonify({'error': 'Passphrase is pinned by TERMINAL_PASSPHRASE env var; unset it to manage from the UI.'}), 409

    data = request.get_json(silent=True) or {}
    new_pass = (data.get('new') or data.get('passphrase') or '').strip()
    current_pass = data.get('current') or ''

    existing_hash = _shell_passphrase_hash()
    if existing_hash and not check_password_hash(existing_hash, str(current_pass)):
        return jsonify({'error': 'Current passphrase is incorrect.'}), 401

    try:
        set_shell_passphrase(new_pass)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    # Auto-unlock both gates for the user who just set it — saves an extra
    # round trip on the very next request.
    session['terminal_unlocked'] = True
    session['server_files_unlocked'] = True
    return jsonify({'ok': True})


try:
    from flask_sock import Sock
    _sock = Sock(app)
    _TERMINAL_WS_SUPPORTED = True

    @_sock.route('/api/terminal/ws')
    def _terminal_ws(ws):
        # Re-check auth + unlock on every connection. Browsers send the session
        # cookie with the WebSocket handshake, so Flask-Login populates the
        # request context the same way it does for HTTP.
        def close_with_message(message):
            try:
                ws.send(f'\r\n\x1b[31m{message}\x1b[0m\r\n')
            except Exception:
                pass
            try:
                ws.close()
            except Exception:
                pass

        if not _TERMINAL_SUPPORTED:
            close_with_message('Terminal is only available on Linux servers.')
            return
        if not current_user.is_authenticated or not _terminal_unlocked():
            close_with_message('Terminal is locked. Unlock it and reconnect.')
            return

        try:
            pid, fd = pty.fork()
        except OSError:
            close_with_message('Could not start a server shell.')
            return

        if pid == 0:
            # Child: replace with an interactive login shell.
            env = os.environ.copy()
            env['TERM'] = 'xterm-256color'
            env['COLORTERM'] = 'truecolor'
            home = env.get('HOME') or '/root'
            try:
                os.chdir(home)
            except OSError:
                pass
            try:
                os.execvpe('/bin/bash', ['/bin/bash', '--login'], env)
            except OSError:
                os._exit(1)
            return

        # Parent: pump PTY <-> WebSocket.
        stop = threading.Event()

        def pump_output():
            while not stop.is_set():
                try:
                    r, _, _ = _py_select.select([fd], [], [], 0.2)
                except (OSError, ValueError):
                    break
                if fd in r:
                    try:
                        data = os.read(fd, 4096)
                    except OSError:
                        break
                    if not data:
                        break
                    try:
                        ws.send(data.decode('utf-8', errors='replace'))
                    except Exception:
                        break
            try:
                ws.close()
            except Exception:
                pass

        reader = threading.Thread(target=pump_output, daemon=True)
        reader.start()

        try:
            while True:
                msg = ws.receive()
                if msg is None:
                    break
                try:
                    obj = json.loads(msg) if isinstance(msg, str) else None
                except json.JSONDecodeError:
                    obj = None
                if not isinstance(obj, dict):
                    continue
                mtype = obj.get('type')
                if mtype == 'input':
                    data = obj.get('data', '')
                    if isinstance(data, str):
                        try:
                            os.write(fd, data.encode('utf-8'))
                        except OSError:
                            break
                elif mtype == 'resize':
                    try:
                        cols = max(1, int(obj.get('cols', 80)))
                        rows = max(1, int(obj.get('rows', 24)))
                        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
                    except (OSError, ValueError):
                        pass
        finally:
            stop.set()
            try:
                os.kill(pid, _py_signal.SIGHUP)
            except (ProcessLookupError, OSError):
                pass
            try:
                os.waitpid(pid, 0)
            except (ChildProcessError, OSError):
                pass
            try:
                os.close(fd)
            except OSError:
                pass
except ImportError:
    # flask-sock not installed — unlock endpoints still respond but WS is 404.
    pass


# ═══════════════════════════════════════════
# Database screen routes, backups, restore jobs, and schedules live in backend.databases.routes.
from backend.databases.routes import register_database_feature

_reschedule_backup_jobs = register_database_feature(
    flask_app=app,
    db_instance=db,
    csrf_protect=csrf,
    base_dir=BASE_DIR,
    database_connection_model=DatabaseConnection,
    backup_schedule_model=BackupSchedule,
    backup_archive_model=BackupArchive,
    encrypt_password=_encrypt_password,
    decrypt_password=_decrypt_password,
    iso_utc_func=iso_utc,
)

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


@app.errorhandler(413)
def payload_too_large(e):
    limit_gb = MAX_UPLOAD_FILE_BYTES // (1024 * 1024 * 1024)
    msg = f'File too large. Upload files up to {limit_gb} GB.'
    if request.path.startswith('/api/'):
        return jsonify({'error': msg}), 413
    return msg, 413


@app.shell_context_processor
def make_shell_context():
    return {
        'db': db, 'User': User, 'Project': Project, 'App': App,
        'Deployment': Deployment, 'AppSetting': AppSetting,
        'DatabaseConnection': DatabaseConnection,
        'BackupSchedule': BackupSchedule, 'BackupArchive': BackupArchive,
    }


with app.app_context():
    db.create_all()
    migrate_schema()
    # Boot the backup scheduler. Safe to call repeatedly (no-op on reload).
    try:
        _reschedule_backup_jobs()
    except Exception as e:
        print(f'[scheduler] WARNING: backup scheduler boot failed: {e}', file=sys.stderr)


if __name__ == '__main__':
    with app.app_context():
        if not User.query.first():
            print("No users found. Visit /setup to create the admin account.")
        host = os.environ.get('HOST', '127.0.0.1')
        port = int(os.environ.get('PORT', 8765))
        app.run(debug=False, host=host, port=port)
