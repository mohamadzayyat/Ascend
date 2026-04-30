import re
import secrets
import subprocess
import threading
import json
from datetime import datetime, timezone
from pathlib import Path


_app = None
_db = None
_DatabaseConnection = None
_BackupArchive = None
_DatabaseRestoreJob = None
_open_mysql = None
_run_backup = None
_mysqldump_env = None
_iso_utc = None

_restore_jobs = {}
_restore_jobs_lock = threading.Lock()


def init_database_restore(*, app, db, database_connection_model, backup_archive_model, restore_job_model, open_mysql, run_backup, mysqldump_env, iso_utc):
    global _app, _db, _DatabaseConnection, _BackupArchive, _DatabaseRestoreJob, _open_mysql, _run_backup, _mysqldump_env, _iso_utc
    _app = app
    _db = db
    _DatabaseConnection = database_connection_model
    _BackupArchive = backup_archive_model
    _DatabaseRestoreJob = restore_job_model
    _open_mysql = open_mysql
    _run_backup = run_backup
    _mysqldump_env = mysqldump_env
    _iso_utc = iso_utc


def _restore_job_persist(job_id, payload):
    if _DatabaseRestoreJob is None:
        return
    try:
        rec = _db.session.get(_DatabaseRestoreJob, job_id)
        if rec is None:
            rec = _DatabaseRestoreJob(id=job_id)
        rec.connection_id = int(payload.get('connection_id') or 0)
        rec.backup_id = int(payload.get('backup_id') or 0)
        rec.status = payload.get('status') or 'queued'
        rec.payload = json.dumps(payload)
        _db.session.add(rec)
        _db.session.commit()
    except Exception:
        _db.session.rollback()


def _restore_job_load(job_id):
    if _DatabaseRestoreJob is None:
        return {}
    try:
        rec = _db.session.get(_DatabaseRestoreJob, job_id)
        if not rec or not rec.payload:
            return {}
        return json.loads(rec.payload) or {}
    except Exception:
        _db.session.rollback()
        return {}


def _restore_job_update(job_id, **patch):
    with _restore_jobs_lock:
        cur = dict(_restore_jobs.get(job_id) or {})
        cur.update(patch)
        cur['updated_at'] = _iso_utc(datetime.now(timezone.utc))
        _restore_jobs[job_id] = cur
    _restore_job_persist(job_id, cur)


def _mysql_ident(raw, label='identifier'):
    s = (raw or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9_$]+', s):
        raise ValueError(f'Invalid {label}. Use letters, numbers, underscore, or $.')
    return s


def _mysql_collation(raw):
    s = (raw or 'utf8mb4_general_ci').strip()
    if not re.fullmatch(r'[A-Za-z0-9_]+', s):
        raise ValueError('Invalid collation.')
    return s


def _mysql_charset_from_collation(collation):
    return (collation.split('_', 1)[0] or 'utf8mb4').strip() or 'utf8mb4'


_DEFINER_RE = re.compile(
    r'\bDEFINER\s*=\s*(?:`[^`]*`|\'[^\']*\'|"[^"]*"|[^\s*/]+)\s*@\s*(?:`[^`]*`|\'[^\']*\'|"[^"]*"|[^\s*/]+)\s*',
    re.IGNORECASE,
)
_COLLATE_EQ_RE = re.compile(r'(\bCOLLATE\s*=\s*)[A-Za-z0-9_]+', re.IGNORECASE)
_COLLATE_SPACE_RE = re.compile(r'(\bCOLLATE\s+)[A-Za-z0-9_]+', re.IGNORECASE)
_MARIADB_TABLE_OPTIONS_RE = re.compile(
    r'\s+(?:PAGE_CHECKSUM|TRANSACTIONAL)\s*=\s*(?:0|1|DEFAULT)\b',
    re.IGNORECASE,
)


def _rewrite_dump_line_for_target(line, target_db, charset, collation, mariadb_mysql_compat=False):
    text = line.decode('utf-8', errors='replace')
    if re.match(r'^\s*CREATE\s+DATABASE\b', text, re.IGNORECASE):
        return f'CREATE DATABASE IF NOT EXISTS `{target_db}` DEFAULT CHARACTER SET {charset} COLLATE {collation};\n'.encode('utf-8')
    if re.match(r'^\s*USE\s+`?[^`;]+`?\s*;', text, re.IGNORECASE):
        return f'USE `{target_db}`;\n'.encode('utf-8')
    if re.match(r'^\s*DROP\s+DATABASE\b', text, re.IGNORECASE):
        return b''
    if mariadb_mysql_compat:
        stripped = text.strip()
        if 'enable the sandbox mode' in stripped:
            return b''
        if re.match(r'^(?:/\*!\d+\s*)?SET\s+@mariadb_', stripped, re.IGNORECASE):
            return b''
        text = _DEFINER_RE.sub('', text)
        text = _COLLATE_EQ_RE.sub(lambda m: f'{m.group(1)}{collation}', text)
        text = _COLLATE_SPACE_RE.sub(lambda m: f'{m.group(1)}{collation}', text)
        text = _MARIADB_TABLE_OPTIONS_RE.sub('', text)
        return text.encode('utf-8')
    return line


def _run_restore_job(job_id, conn_id, backup_id, target_database, collation, replace_existing, mariadb_mysql_compat):
    with _app.app_context():
        conn = _db.session.get(_DatabaseConnection, conn_id)
        archive = _db.session.get(_BackupArchive, backup_id)
        if conn is None or archive is None or archive.connection_id != conn_id:
            _restore_job_update(job_id, status='failed', error='Connection or backup not found.', progress=100)
            return
        path = Path(archive.filepath)
        if archive.status != 'success' or not path.exists():
            _restore_job_update(job_id, status='failed', error='Backup file is not available.', progress=100)
            return
        try:
            target_database = _mysql_ident(target_database, 'database name')
            collation = _mysql_collation(collation)
            charset = _mysql_charset_from_collation(collation)
        except ValueError as exc:
            _restore_job_update(job_id, status='failed', error=str(exc), progress=100)
            return
        safety_id = None
        try:
            _restore_job_update(job_id, status='running', phase='Checking target database', progress=2)
            client = _open_mysql(conn, database='')
            try:
                with client.cursor() as cur:
                    cur.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=%s', (target_database,))
                    exists = bool(cur.fetchone())
            finally:
                client.close()
            if exists:
                _restore_job_update(job_id, phase='Backing up current target database', progress=8)
                safety_id = _run_backup(conn.id, schedule_id=None, triggered_by='restore-safety', target_database=target_database)
                safety = _db.session.get(_BackupArchive, safety_id) if safety_id else None
                if not safety or safety.status != 'success':
                    msg = safety.error_message if safety else 'Safety backup did not complete.'
                    raise RuntimeError(f'Restore stopped because the safety backup failed: {msg}')
            _restore_job_update(job_id, phase='Preparing target database', progress=18, safety_backup_id=safety_id)
            client = _open_mysql(conn, database='')
            try:
                with client.cursor() as cur:
                    if exists and replace_existing:
                        cur.execute(f'DROP DATABASE `{target_database}`')
                    cur.execute(f'CREATE DATABASE IF NOT EXISTS `{target_database}` DEFAULT CHARACTER SET {charset} COLLATE {collation}')
                client.commit()
            finally:
                client.close()
            env, base_args = _mysqldump_env(conn)
            argv = ['mysql', '--no-defaults', *base_args, '--default-character-set=utf8mb4', target_database]
            total = max(path.stat().st_size, 1)
            done = 0
            proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            phase = 'Importing dump with MariaDB -> MySQL cleanup' if mariadb_mysql_compat else 'Importing dump'
            _restore_job_update(job_id, phase=phase, progress=20)
            pipe_closed_early = False
            with open(path, 'rb') as fh:
                for line in fh:
                    done += len(line)
                    out_line = _rewrite_dump_line_for_target(line, target_database, charset, collation, mariadb_mysql_compat)
                    if out_line and not pipe_closed_early:
                        try:
                            proc.stdin.write(out_line)
                        except (BrokenPipeError, OSError) as exc:
                            if not isinstance(exc, BrokenPipeError) and getattr(exc, 'errno', None) != 32:
                                raise
                            pipe_closed_early = True
                    if done == total or done % (512 * 1024) < len(line):
                        _restore_job_update(job_id, progress=20 + int(min(done / total, 1) * 75))
                    if pipe_closed_early:
                        break
            try:
                proc.stdin.close()
            except (BrokenPipeError, OSError):
                pass
            stderr = proc.stderr.read()
            stdout = proc.stdout.read()
            proc.wait()
            if proc.returncode != 0:
                err = (stderr or stdout or b'').decode('utf-8', errors='replace').strip()
                if pipe_closed_early and not err:
                    err = 'mysql closed the restore stream early. Check that the dump is valid for this server and database.'
                raise RuntimeError(err or f'mysql exited {proc.returncode}')
            _restore_job_update(job_id, status='success', phase='Restore complete', progress=100, completed_at=_iso_utc(datetime.now(timezone.utc)), safety_backup_id=safety_id)
        except Exception as exc:
            _restore_job_update(job_id, status='failed', phase='Restore failed', progress=100, error=str(exc)[:2000], completed_at=_iso_utc(datetime.now(timezone.utc)), safety_backup_id=safety_id)


def start_restore_job(conn, backup_id, target_database, collation, replace_existing=True, mariadb_mysql_compat=False):
    backup_id = int(backup_id)
    target_database = _mysql_ident(target_database, 'database name')
    collation = _mysql_collation(collation or 'utf8mb4_general_ci')
    archive = _db.session.get(_BackupArchive, backup_id)
    if not archive or archive.connection_id != conn.id:
        raise LookupError('Backup not found for this connection.')
    job_id = secrets.token_urlsafe(16)
    job = {
        'id': job_id,
        'connection_id': conn.id,
        'backup_id': backup_id,
        'target_database': target_database,
        'collation': collation,
        'replace_existing': bool(replace_existing),
        'mariadb_mysql_compat': bool(mariadb_mysql_compat),
        'status': 'queued',
        'phase': 'Queued',
        'progress': 0,
        'created_at': _iso_utc(datetime.now(timezone.utc)),
        'updated_at': _iso_utc(datetime.now(timezone.utc)),
    }
    with _restore_jobs_lock:
        _restore_jobs[job_id] = job
    _restore_job_persist(job_id, job)
    threading.Thread(
        target=_run_restore_job,
        args=[job_id, conn.id, backup_id, target_database, collation, bool(replace_existing), bool(mariadb_mysql_compat)],
        daemon=True,
    ).start()
    return job


def get_restore_job(job_id):
    with _restore_jobs_lock:
        job = dict(_restore_jobs.get(job_id) or {})
    return job or _restore_job_load(job_id)
