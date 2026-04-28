import json
import secrets
from datetime import datetime, timezone

from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash

from backend.extensions import db


def iso_utc(dt):
    """Serialize datetimes as explicit UTC so browsers show correct local time.

    SQLite drops tzinfo when storing DateTime values, but all app timestamps are
    written in UTC. If tzinfo is missing, treat it as UTC instead of local time.
    """
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat().replace('+00:00', 'Z')


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
        # Aggregate disk size from whichever apps have already been measured.
        # `disk_size_missing` tells the UI how many apps still need a recalc
        # so it can show e.g. "2.3 GB (1 app not measured)".
        sizes = [a.disk_size_bytes for a in self.apps if a.disk_size_bytes is not None]
        computed = [a.disk_size_computed_at for a in self.apps if a.disk_size_computed_at is not None]
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
            'disk_size_bytes': sum(sizes) if sizes else None,
            'disk_size_computed_at': iso_utc(min(computed)) if computed else None,
            'disk_size_missing': sum(1 for a in self.apps if a.disk_size_bytes is None),
            'created_at': iso_utc(self.created_at),
            'updated_at': iso_utc(self.updated_at),
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
    client_max_body = db.Column(db.String(20), default='6G')

    status = db.Column(db.String(50), default='created')
    last_deployment = db.Column(db.DateTime)

    # Disk usage of the app's deploy directory. Populated by the file manager's
    # "recalculate" action rather than every list call, because walking a tree
    # with node_modules is expensive.
    disk_size_bytes = db.Column(db.BigInteger)
    disk_size_computed_at = db.Column(db.DateTime)

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
            'last_deployment': iso_utc(self.last_deployment),
            'disk_size_bytes': self.disk_size_bytes,
            'disk_size_computed_at': iso_utc(self.disk_size_computed_at),
            'created_at': iso_utc(self.created_at),
            'updated_at': iso_utc(self.updated_at),
        }


class AppSetting(db.Model):
    """Generic key/value store for installation-wide settings.

    Used today to hold the shell passphrase hash so each install has its own
    secret instead of relying on the public-repo default. Keep keys lowercase.
    """
    key = db.Column(db.String(64), primary_key=True)
    value = db.Column(db.Text)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class DatabaseConnection(db.Model):
    """A saved MySQL/MariaDB connection. Passwords are Fernet-encrypted at
    rest; never returned in plaintext through the API."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    host = db.Column(db.String(255), nullable=False)
    port = db.Column(db.Integer, default=3306, nullable=False)
    username = db.Column(db.String(120), nullable=False)
    password_encrypted = db.Column(db.Text, nullable=False)
    default_database = db.Column(db.String(120))  # optional default DB name
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    schedules = db.relationship('BackupSchedule', backref='connection', lazy=True, cascade='all, delete-orphan')
    backups = db.relationship('BackupArchive', backref='connection', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'host': self.host,
            'port': self.port,
            'username': self.username,
            'default_database': self.default_database,
            'created_at': iso_utc(self.created_at),
            'updated_at': iso_utc(self.updated_at),
        }


class BackupSchedule(db.Model):
    """Recurring backup job for a connection. Multiple rows allowed — each
    row targets one database (target_database) or all DBs when target is empty."""
    id = db.Column(db.Integer, primary_key=True)
    connection_id = db.Column(db.Integer, db.ForeignKey('database_connection.id'), nullable=False)
    enabled = db.Column(db.Boolean, default=True, nullable=False)
    # Simple schedule: every_hours + at_minute is enough for "daily at 03:30"
    # or "every 6 hours". Avoids exposing cron syntax to non-experts.
    every_hours = db.Column(db.Integer, default=24, nullable=False)
    at_hour = db.Column(db.Integer, default=2, nullable=False)  # 0–23 (daily / cron anchor)
    at_minute = db.Column(db.Integer, default=0, nullable=False)  # 0–59
    # IANA zone name, e.g. "America/New_York"; empty/null = server default
    schedule_timezone = db.Column(db.String(64), nullable=True)
    retention_days = db.Column(db.Integer, default=14, nullable=False)
    # Single DB name to dump; empty string = --all-databases. Replaces legacy `databases` JSON.
    target_database = db.Column(db.String(255), nullable=False, default='')
    databases = db.Column(db.Text)  # legacy JSON list; migrated into target_database / extra rows
    last_run_at = db.Column(db.DateTime)
    last_run_status = db.Column(db.String(20))  # success | failed
    last_run_error = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        td = (self.target_database or '').strip()
        legacy = []
        if self.databases:
            try:
                legacy = json.loads(self.databases) or []
            except (TypeError, ValueError):
                legacy = []
        return {
            'id': self.id,
            'connection_id': self.connection_id,
            'enabled': self.enabled,
            'every_hours': self.every_hours,
            'at_hour': self.at_hour,
            'at_minute': self.at_minute,
            'schedule_timezone': (self.schedule_timezone or '').strip() or None,
            'retention_days': self.retention_days,
            'target_database': td,
            'databases': [td] if td else (legacy or []),
            'last_run_at': iso_utc(self.last_run_at),
            'last_run_status': self.last_run_status,
            'last_run_error': self.last_run_error,
        }


class BackupArchive(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    connection_id = db.Column(db.Integer, db.ForeignKey('database_connection.id'), nullable=False)
    schedule_id = db.Column(db.Integer, db.ForeignKey('backup_schedule.id'))  # null for manual
    filename = db.Column(db.String(255), nullable=False)
    filepath = db.Column(db.String(500), nullable=False)
    size_bytes = db.Column(db.BigInteger, default=0)
    status = db.Column(db.String(20), default='pending', nullable=False)  # pending|success|failed
    error_message = db.Column(db.Text)
    triggered_by = db.Column(db.String(20), default='manual')  # manual|scheduled
    started_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    completed_at = db.Column(db.DateTime)
    duration_seconds = db.Column(db.Integer)

    def to_dict(self):
        return {
            'id': self.id,
            'connection_id': self.connection_id,
            'schedule_id': self.schedule_id,
            'filename': self.filename,
            'size_bytes': self.size_bytes,
            'status': self.status,
            'error_message': self.error_message,
            'triggered_by': self.triggered_by,
            'started_at': iso_utc(self.started_at),
            'completed_at': iso_utc(self.completed_at),
            'duration_seconds': self.duration_seconds,
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
            'started_at': iso_utc(self.started_at),
            'completed_at': iso_utc(self.completed_at),
            'duration_seconds': self.duration_seconds,
        }


# ═══════════════════════════════════════════
