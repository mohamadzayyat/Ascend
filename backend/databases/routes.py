import json
import ipaddress
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file
from flask_login import current_user, login_required
from werkzeug.utils import secure_filename

from backend.services.backup_upload import _backup_upload_settings_load, _upload_backup_to_remote
from backend.services.database_restore import get_restore_job, init_database_restore, start_restore_job
from backend.services.email_notifications import _notify_email_async
from backend.services.share_links import create_share_link

bp = Blueprint('databases', __name__)

app = None
db = None
csrf = None
BASE_DIR = None
DatabaseConnection = None
BackupSchedule = None
BackupArchive = None
_encrypt_password = None
_decrypt_password = None
iso_utc = None
DB_BACKUPS_ROOT = None
MAX_SQL_URL_DOWNLOAD_BYTES = 1024 * 1024 * 1024


def register_database_feature(*, flask_app, db_instance, csrf_protect, base_dir, database_connection_model, backup_schedule_model, backup_archive_model, encrypt_password, decrypt_password, iso_utc_func):
    global app, db, csrf, BASE_DIR, DatabaseConnection, BackupSchedule, BackupArchive, _encrypt_password, _decrypt_password, iso_utc, DB_BACKUPS_ROOT
    app = flask_app
    db = db_instance
    csrf = csrf_protect
    BASE_DIR = base_dir
    DatabaseConnection = database_connection_model
    BackupSchedule = backup_schedule_model
    BackupArchive = backup_archive_model
    _encrypt_password = encrypt_password
    _decrypt_password = decrypt_password
    iso_utc = iso_utc_func
    DB_BACKUPS_ROOT = BASE_DIR / 'db-backups'
    DB_BACKUPS_ROOT.mkdir(exist_ok=True)
    init_database_restore(
        app=app,
        db=db,
        database_connection_model=DatabaseConnection,
        backup_archive_model=BackupArchive,
        open_mysql=_open_mysql,
        run_backup=_run_backup,
        mysqldump_env=_mysqldump_env,
        iso_utc=iso_utc,
    )
    csrf.exempt(bp)
    app.register_blueprint(bp)
    return _reschedule_backup_jobs

# Database screen — MySQL/MariaDB connections, browse, SQL runner, backups
# ═══════════════════════════════════════════

# Destructive SQL the runner requires explicit confirmation for. We trip on
# the first whitespace-delimited keyword; the goal is "did the user mean to
# nuke data?" not perfect SQL parsing.
_DESTRUCTIVE_PREFIXES = ('drop', 'truncate', 'rename')
_UNSAFE_WRITE_RE = re.compile(r'^\s*(update|delete)\b(?![^;]*\bwhere\b)', re.IGNORECASE | re.DOTALL)


def _valid_identifier(name):
    return bool(re.fullmatch(r'[A-Za-z0-9_$]+', name or ''))


def _qi(name):
    if not _valid_identifier(name):
        raise ValueError('Invalid identifier.')
    return f'`{name}`'


def _coerce_json_value(v):
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, bytes):
        try:
            return v.decode('utf-8')
        except UnicodeDecodeError:
            return f'<binary {len(v)} bytes>'
    return str(v)


def _table_primary_key_columns(cur, database, table):
    cur.execute("""
        SELECT COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND CONSTRAINT_NAME = 'PRIMARY'
        ORDER BY ORDINAL_POSITION
    """, (database, table))
    return [r[0] for r in cur.fetchall()]


def _safe_dir_name(name):
    """Sanitize a connection name for use as a directory under db-backups/."""
    safe = re.sub(r'[^A-Za-z0-9_.-]', '_', name or '').strip('._') or 'connection'
    return safe[:80]


def _admin_required():
    role = (getattr(current_user, 'role', '') or ('admin' if getattr(current_user, 'is_admin', False) else '')).strip().lower()
    if not getattr(current_user, 'is_admin', False) and role != 'database':
        return jsonify({'error': 'Database role required.'}), 403
    return None


def _conn_owned(conn_id):
    conn = db.session.get(DatabaseConnection, conn_id)
    if conn is None:
        return None, (jsonify({'error': 'Connection not found.'}), 404)
    if conn.user_id != current_user.id:
        return None, (jsonify({'error': 'Unauthorized'}), 403)
    return conn, None


def _open_mysql(conn, database=None):
    """Open a PyMySQL connection. Caller is responsible for closing it.
    `database` overrides the connection's default DB; pass '' to connect
    server-wide (needed for SHOW DATABASES)."""
    import pymysql
    db_name = database if database is not None else (conn.default_database or '')
    kwargs = {
        'host': conn.host,
        'port': int(conn.port or 3306),
        'user': conn.username,
        'password': _decrypt_password(conn.password_encrypted),
        'connect_timeout': 8,
        'read_timeout': 30,
        'write_timeout': 30,
        'charset': 'utf8mb4',
    }
    if db_name:
        kwargs['database'] = db_name
    return pymysql.connect(**kwargs)


def _mysqldump_env(conn):
    """Build env + argv prefix for invoking mysqldump/mysql without leaking
    the password on the command line (uses MYSQL_PWD env var)."""
    env = os.environ.copy()
    env['MYSQL_PWD'] = _decrypt_password(conn.password_encrypted)
    base_args = [
        '--host', conn.host,
        '--port', str(conn.port or 3306),
        '--user', conn.username,
    ]
    return env, base_args


def _valid_mysql_token(value):
    return bool(re.fullmatch(r'[A-Za-z0-9_]+', value or ''))


def _valid_mysql_user(value):
    return bool(re.fullmatch(r'[A-Za-z0-9_.$-]{1,80}', value or ''))


def _valid_mysql_host(value):
    return bool(re.fullmatch(r'[A-Za-z0-9_.:%-]{1,255}', value or ''))


_MYSQL_PRIVILEGES = {
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP',
    'INDEX', 'ALTER', 'CREATE TEMPORARY TABLES', 'LOCK TABLES',
    'EXECUTE', 'CREATE VIEW', 'SHOW VIEW', 'TRIGGER', 'EVENT',
    'REFERENCES',
}

_COLUMN_TYPES = {
    'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'VARCHAR', 'CHAR',
    'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'DECIMAL', 'DATE', 'DATETIME',
    'TIMESTAMP', 'TIME', 'BOOLEAN', 'JSON', 'DOUBLE', 'FLOAT',
}


def _mysql_user_ref(username, host):
    if not _valid_mysql_user(username) or not _valid_mysql_host(host):
        raise ValueError('Invalid MySQL username or host.')
    return f"'{username.replace(chr(39), chr(39) + chr(39))}'@'{host.replace(chr(39), chr(39) + chr(39))}'"


def _normalize_privileges(raw):
    if isinstance(raw, str):
        raw = [p.strip() for p in raw.split(',')]
    privs = [str(p or '').strip().upper() for p in (raw or []) if str(p or '').strip()]
    if not privs:
        privs = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    if 'ALL PRIVILEGES' in privs or 'ALL' in privs:
        return ['ALL PRIVILEGES']
    invalid = [p for p in privs if p not in _MYSQL_PRIVILEGES]
    if invalid:
        raise ValueError(f'Invalid privilege: {invalid[0]}')
    return sorted(set(privs))


def _sql_string(value):
    return "'" + str(value).replace("\\", "\\\\").replace("'", "''") + "'"


def _column_definition_sql(col):
    name = (col.get('name') or '').strip()
    if not _valid_identifier(name):
        raise ValueError('Invalid column name.')
    data_type = (col.get('type') or 'VARCHAR').strip().upper()
    if data_type not in _COLUMN_TYPES:
        raise ValueError('Unsupported column type.')
    length = str(col.get('length') or '').strip()
    if length:
        if not re.fullmatch(r'\d+(?:\s*,\s*\d+)?', length):
            raise ValueError('Invalid column length/precision.')
        type_sql = f'{data_type}({length.replace(" ", "")})'
    elif data_type == 'VARCHAR':
        type_sql = 'VARCHAR(255)'
    else:
        type_sql = data_type
    parts = [_qi(name), type_sql]
    parts.append('NULL' if bool(col.get('nullable')) else 'NOT NULL')
    default = col.get('default')
    if default is not None and str(default) != '':
        d = str(default).strip()
        if d.upper() == 'NULL':
            parts.append('DEFAULT NULL')
        elif d.upper() in ('CURRENT_TIMESTAMP', 'CURRENT_TIMESTAMP()'):
            parts.append('DEFAULT CURRENT_TIMESTAMP')
        else:
            parts.append(f'DEFAULT {_sql_string(default)}')
    if bool(col.get('auto_increment')):
        parts.append('AUTO_INCREMENT')
    comment = str(col.get('comment') or '').strip()
    if comment:
        parts.append(f'COMMENT {_sql_string(comment[:1024])}')
    return ' '.join(parts)


def _database_create_sql(name, charset='utf8mb4', collation='utf8mb4_general_ci', if_not_exists=False):
    charset = (charset or 'utf8mb4').strip()
    collation = (collation or 'utf8mb4_general_ci').strip()
    if not _valid_mysql_token(charset) or not _valid_mysql_token(collation):
        raise ValueError('Invalid character set or collation.')
    ine = ' IF NOT EXISTS' if if_not_exists else ''
    return f'CREATE DATABASE{ine} {_qi(name)} CHARACTER SET {charset} COLLATE {collation}'


# ── Connection CRUD ─────────────────────────────────────────────

@bp.route('/api/databases/connections', methods=['GET'])
@login_required
def api_db_connections_list():
    err = _admin_required()
    if err:
        return err
    rows = DatabaseConnection.query.filter_by(user_id=current_user.id).order_by(DatabaseConnection.name).all()
    return jsonify({'connections': [r.to_dict() for r in rows]})


@bp.route('/api/databases/connections', methods=['POST'])
@login_required
def api_db_connections_create():
    err = _admin_required()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    host = (data.get('host') or '').strip()
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    if not name or not host or not username:
        return jsonify({'error': 'name, host, and username are required.'}), 400
    if DatabaseConnection.query.filter_by(user_id=current_user.id, name=name).first():
        return jsonify({'error': 'A connection with that name already exists.'}), 409
    try:
        port = int(data.get('port') or 3306)
    except (TypeError, ValueError):
        return jsonify({'error': 'port must be an integer.'}), 400
    conn = DatabaseConnection(
        user_id=current_user.id,
        name=name,
        host=host,
        port=port,
        username=username,
        password_encrypted=_encrypt_password(password),
        default_database=(data.get('default_database') or '').strip() or None,
    )
    db.session.add(conn)
    db.session.commit()
    return jsonify({'connection': conn.to_dict()}), 201


@bp.route('/api/databases/connections/<int:conn_id>', methods=['PUT'])
@login_required
def api_db_connections_update(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    if 'name' in data:
        new_name = (data['name'] or '').strip()
        if not new_name:
            return jsonify({'error': 'name cannot be empty.'}), 400
        if new_name != conn.name and DatabaseConnection.query.filter_by(user_id=current_user.id, name=new_name).first():
            return jsonify({'error': 'A connection with that name already exists.'}), 409
        conn.name = new_name
    for field in ('host', 'username', 'default_database'):
        if field in data:
            val = (data[field] or '').strip() or (None if field == 'default_database' else '')
            if field != 'default_database' and not val:
                return jsonify({'error': f'{field} cannot be empty.'}), 400
            setattr(conn, field, val)
    if 'port' in data:
        try:
            conn.port = int(data['port'])
        except (TypeError, ValueError):
            return jsonify({'error': 'port must be an integer.'}), 400
    if 'password' in data and data['password']:
        conn.password_encrypted = _encrypt_password(data['password'])
    db.session.commit()
    return jsonify({'connection': conn.to_dict()})


@bp.route('/api/databases/connections/<int:conn_id>', methods=['DELETE'])
@login_required
def api_db_connections_delete(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    # Also remove any backup files on disk for this connection
    safe = _safe_dir_name(conn.name)
    backup_dir = DB_BACKUPS_ROOT / safe
    if backup_dir.exists():
        try:
            shutil.rmtree(backup_dir)
        except OSError:
            pass
    db.session.delete(conn)
    db.session.commit()
    return jsonify({'ok': True})


@bp.route('/api/databases/connections/<int:conn_id>/test', methods=['POST'])
@login_required
def api_db_connections_test(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    try:
        client = _open_mysql(conn, database='')
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 200
    try:
        with client.cursor() as cur:
            cur.execute('SELECT VERSION()')
            version = (cur.fetchone() or [''])[0]
    finally:
        client.close()
    return jsonify({'ok': True, 'server_version': version})


# ── Browse: databases, tables, table viewer ─────────────────────

@bp.route('/api/databases/connections/<int:conn_id>/databases')
@login_required
def api_db_databases_list(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    try:
        client = _open_mysql(conn, database='')
    except Exception as e:
        return jsonify({'error': str(e)}), 502
    try:
        with client.cursor() as cur:
            cur.execute('SHOW DATABASES')
            names = [row[0] for row in cur.fetchall()]
    except Exception as e:
        client.close()
        return jsonify({'error': f'Query failed: {str(e)}'}), 400
    finally:
        try:
            client.close()
        except:
            pass
    # Hide MySQL internals by default; UI can toggle later if needed
    hidden = {'information_schema', 'performance_schema', 'mysql', 'sys'}
    return jsonify({
        'databases': [n for n in names if n not in hidden],
        'system_databases': [n for n in names if n in hidden],
    })


@bp.route('/api/databases/connections/<int:conn_id>/databases', methods=['POST'])
@login_required
def api_db_database_create(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    charset = (data.get('charset') or 'utf8mb4').strip()
    collation = (data.get('collation') or 'utf8mb4_general_ci').strip()
    if not name:
        return jsonify({'error': 'Database name is required.'}), 400
    if len(name) > 64 or not _valid_identifier(name):
        return jsonify({'error': 'Database name may only contain letters, numbers, _, and $, up to 64 characters.'}), 400
    try:
        sql = _database_create_sql(name, charset, collation)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    try:
        client = _open_mysql(conn, database='')
    except Exception as e:
        return jsonify({'error': str(e)}), 502
    started = time.time()
    try:
        with client.cursor() as cur:
            cur.execute(sql)
        client.commit()
    except Exception as e:
        client.close()
        return jsonify({'error': str(e), 'sql': sql, 'duration_ms': int((time.time() - started) * 1000)}), 400
    client.close()
    return jsonify({
        'ok': True,
        'database': name,
        'sql': sql,
        'duration_ms': int((time.time() - started) * 1000),
    }), 201


@bp.route('/api/databases/connections/<int:conn_id>/import-sql', methods=['POST'])
@login_required
def api_db_import_sql(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    upload = request.files.get('file')
    if not upload or not upload.filename:
        return jsonify({'error': 'Choose a .sql file to import.'}), 400
    original_name = secure_filename(upload.filename) or 'import.sql'
    if not original_name.lower().endswith('.sql'):
        return jsonify({'error': 'Only .sql files are supported.'}), 400

    mode = (request.form.get('mode') or 'existing').strip().lower()
    target = (request.form.get('database') or '').strip()
    charset = (request.form.get('charset') or 'utf8mb4').strip()
    collation = (request.form.get('collation') or 'utf8mb4_general_ci').strip()
    create_first = mode == 'new'
    if create_first:
        target = (request.form.get('new_database') or target).strip()
    if not target:
        return jsonify({'error': 'Target database is required.'}), 400
    if len(target) > 64 or not _valid_identifier(target):
        return jsonify({'error': 'Database name may only contain letters, numbers, _, and $, up to 64 characters.'}), 400

    create_sql = None
    if create_first:
        try:
            create_sql = _database_create_sql(target, charset, collation)
        except ValueError as e:
            return jsonify({'error': str(e)}), 400

    import_dir = DB_BACKUPS_ROOT / 'imports'
    import_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    import_path = import_dir / f'{conn.id}-{ts}-{original_name}'
    upload.save(import_path)

    started = time.time()
    try:
        if create_first:
            client = _open_mysql(conn, database='')
            try:
                with client.cursor() as cur:
                    cur.execute(create_sql)
                client.commit()
            finally:
                client.close()

        env, base_args = _mysqldump_env(conn)
        argv = [
            'mysql', '--no-defaults', *base_args,
            '--default-character-set=utf8mb4',
            target,
        ]
        with open(import_path, 'rb') as sql_in:
            proc = subprocess.run(
                argv,
                stdin=sql_in,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                timeout=1800,
            )
        stdout = (proc.stdout or b'').decode('utf-8', errors='replace').strip()
        stderr = (proc.stderr or b'').decode('utf-8', errors='replace').strip()
        if proc.returncode != 0:
            return jsonify({
                'error': stderr or f'mysql exited {proc.returncode}',
                'database': target,
                'created_database': bool(create_first),
                'sql': create_sql,
                'duration_ms': int((time.time() - started) * 1000),
            }), 400
        return jsonify({
            'ok': True,
            'database': target,
            'created_database': bool(create_first),
            'filename': original_name,
            'stdout': stdout,
            'stderr': stderr,
            'sql': create_sql,
            'duration_ms': int((time.time() - started) * 1000),
        })
    except FileNotFoundError:
        return jsonify({'error': 'mysql client is not installed on this server.'}), 500
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Import timed out after 30 minutes.', 'database': target}), 504
    except Exception as e:
        return jsonify({'error': str(e), 'database': target}), 500
    finally:
        try:
            import_path.unlink()
        except OSError:
            pass


@bp.route('/api/databases/connections/<int:conn_id>/mysql-users')
@login_required
def api_db_mysql_users_list(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    database = (request.args.get('database') or '').strip()
    try:
        client = _open_mysql(conn, database='')
    except Exception as e:
        return jsonify({'error': str(e)}), 502
    try:
        with client.cursor() as cur:
            cur.execute("""
                SELECT User, Host
                FROM mysql.user
                WHERE User NOT IN ('mysql.sys', 'mysql.session', 'mysql.infoschema')
                ORDER BY User, Host
            """)
            users = [{'username': r[0], 'host': r[1], 'grants': []} for r in cur.fetchall()]
            if database and _valid_identifier(database):
                for row in users:
                    try:
                        cur.execute(f"SHOW GRANTS FOR {_mysql_user_ref(row['username'], row['host'])}")
                        grants = [g[0] for g in cur.fetchall()]
                        needle = f'`{database}`.'
                        row['grants'] = [g for g in grants if needle in g or ' ON *.* ' in g]
                    except Exception:
                        row['grants'] = []
    except Exception as e:
        client.close()
        return jsonify({'error': f'Could not list MySQL users: {str(e)}'}), 400
    finally:
        try:
            client.close()
        except Exception:
            pass
    return jsonify({'users': users})


@bp.route('/api/databases/connections/<int:conn_id>/mysql-users', methods=['POST'])
@login_required
def api_db_mysql_user_create(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    host = (data.get('host') or 'localhost').strip() or 'localhost'
    password = data.get('password') or ''
    database = (data.get('database') or '').strip()
    if not _valid_mysql_user(username):
        return jsonify({'error': 'Username may contain letters, numbers, _, ., $, and - only.'}), 400
    if not _valid_mysql_host(host):
        return jsonify({'error': 'Host may contain letters, numbers, %, :, ., _, and - only.'}), 400
    if not password:
        return jsonify({'error': 'Password is required.'}), 400
    if database and not _valid_identifier(database):
        return jsonify({'error': 'Invalid database name.'}), 400
    try:
        privileges = _normalize_privileges(data.get('privileges'))
        user_ref = _mysql_user_ref(username, host)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    try:
        client = _open_mysql(conn, database='')
    except Exception as e:
        return jsonify({'error': str(e)}), 502
    try:
        with client.cursor() as cur:
            cur.execute(f"CREATE USER IF NOT EXISTS {user_ref} IDENTIFIED BY %s", (password,))
            grant_sql = None
            if database:
                grant_sql = f"GRANT {', '.join(privileges)} ON {_qi(database)}.* TO {user_ref}"
                cur.execute(grant_sql)
            cur.execute('FLUSH PRIVILEGES')
        client.commit()
    except Exception as e:
        client.close()
        return jsonify({'error': str(e)}), 400
    finally:
        try:
            client.close()
        except Exception:
            pass
    return jsonify({
        'ok': True,
        'user': {'username': username, 'host': host},
        'database': database or None,
        'privileges': privileges,
    }), 201


@bp.route('/api/databases/connections/<int:conn_id>/mysql-users/grants', methods=['POST'])
@login_required
def api_db_mysql_user_grant(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    host = (data.get('host') or 'localhost').strip() or 'localhost'
    database = (data.get('database') or '').strip()
    if not database or not _valid_identifier(database):
        return jsonify({'error': 'Choose a valid database.'}), 400
    try:
        privileges = _normalize_privileges(data.get('privileges'))
        user_ref = _mysql_user_ref(username, host)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    try:
        client = _open_mysql(conn, database='')
    except Exception as e:
        return jsonify({'error': str(e)}), 502
    try:
        with client.cursor() as cur:
            cur.execute(f"GRANT {', '.join(privileges)} ON {_qi(database)}.* TO {user_ref}")
            cur.execute('FLUSH PRIVILEGES')
        client.commit()
    except Exception as e:
        client.close()
        return jsonify({'error': str(e)}), 400
    finally:
        try:
            client.close()
        except Exception:
            pass
    return jsonify({'ok': True, 'user': {'username': username, 'host': host}, 'database': database, 'privileges': privileges})


@bp.route('/api/databases/connections/<int:conn_id>/mysql-users', methods=['DELETE'])
@login_required
def api_db_mysql_user_delete(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    host = (data.get('host') or 'localhost').strip() or 'localhost'
    confirm_text = (data.get('confirm_text') or '').strip()
    if confirm_text != f'{username}@{host}':
        return jsonify({'error': f'Type {username}@{host} to confirm deletion.'}), 400
    try:
        user_ref = _mysql_user_ref(username, host)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    try:
        client = _open_mysql(conn, database='')
    except Exception as e:
        return jsonify({'error': str(e)}), 502
    try:
        with client.cursor() as cur:
            cur.execute(f"DROP USER IF EXISTS {user_ref}")
            cur.execute('FLUSH PRIVILEGES')
        client.commit()
    except Exception as e:
        client.close()
        return jsonify({'error': str(e)}), 400
    finally:
        try:
            client.close()
        except Exception:
            pass
    return jsonify({'ok': True})


@bp.route('/api/databases/connections/<int:conn_id>/tables')
@login_required
def api_db_tables_list(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    database = (request.args.get('database') or '').strip()
    if not database:
        return jsonify({'error': 'database query param is required.'}), 400
    try:
        client = _open_mysql(conn, database=database)
    except Exception as e:
        return jsonify({'error': str(e)}), 502
    try:
        with client.cursor() as cur:
            cur.execute("""
                SELECT table_name, table_rows, data_length + index_length AS size_bytes
                FROM information_schema.tables
                WHERE table_schema = %s
                ORDER BY table_name
            """, (database,))
            rows = [
                {'name': r[0], 'rows': int(r[1] or 0), 'size_bytes': int(r[2] or 0)}
                for r in cur.fetchall()
            ]
    except Exception as e:
        client.close()
        return jsonify({'error': f'Query failed: {str(e)}'}), 400
    finally:
        try:
            client.close()
        except:
            pass
    return jsonify({'tables': rows})


@bp.route('/api/databases/connections/<int:conn_id>/tables', methods=['POST'])
@login_required
def api_db_table_create(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    database = (data.get('database') or '').strip()
    table = (data.get('table') or '').strip()
    columns = data.get('columns') or []
    engine = (data.get('engine') or 'InnoDB').strip()
    charset = (data.get('charset') or 'utf8mb4').strip()
    collation = (data.get('collation') or 'utf8mb4_general_ci').strip()
    primary_key = (data.get('primary_key') or '').strip()
    if not _valid_identifier(database) or not _valid_identifier(table):
        return jsonify({'error': 'Invalid database or table name.'}), 400
    if not columns:
        return jsonify({'error': 'Add at least one column.'}), 400
    if not _valid_mysql_token(engine) or not _valid_mysql_token(charset) or not _valid_mysql_token(collation):
        return jsonify({'error': 'Invalid engine, charset, or collation.'}), 400
    try:
        col_defs = [_column_definition_sql(c) for c in columns]
        if primary_key:
            if not _valid_identifier(primary_key):
                return jsonify({'error': 'Invalid primary key column.'}), 400
            col_defs.append(f'PRIMARY KEY ({_qi(primary_key)})')
        sql = (
            f'CREATE TABLE {_qi(table)} (\n  '
            + ',\n  '.join(col_defs)
            + f'\n) ENGINE={engine} DEFAULT CHARSET={charset} COLLATE={collation}'
        )
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    try:
        client = _open_mysql(conn, database=database)
    except Exception as e:
        return jsonify({'error': str(e)}), 502
    started = time.time()
    try:
        with client.cursor() as cur:
            cur.execute(sql)
        client.commit()
    except Exception as e:
        client.close()
        return jsonify({'error': str(e), 'sql': sql, 'duration_ms': int((time.time() - started) * 1000)}), 400
    finally:
        try:
            client.close()
        except Exception:
            pass
    return jsonify({'ok': True, 'table': table, 'sql': sql, 'duration_ms': int((time.time() - started) * 1000)}), 201


@bp.route('/api/databases/connections/<int:conn_id>/table-columns', methods=['POST'])
@login_required
def api_db_table_column_add(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    data, database, table = _db_table_request_data()
    column = data.get('column') or {}
    after = (data.get('after') or '').strip()
    try:
        col_sql = _column_definition_sql(column)
        after_sql = ''
        if after:
            if not _valid_identifier(after):
                return jsonify({'error': 'Invalid AFTER column.'}), 400
            after_sql = f' AFTER {_qi(after)}'
        elif data.get('first'):
            after_sql = ' FIRST'
        sql = f'ALTER TABLE {_qi(table)} ADD COLUMN {col_sql}{after_sql}'
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    try:
        client = _open_mysql(conn, database=database)
    except Exception as e:
        return jsonify({'error': str(e)}), 502
    started = time.time()
    try:
        with client.cursor() as cur:
            cur.execute(sql)
        client.commit()
    except Exception as e:
        client.close()
        return jsonify({'error': str(e), 'sql': sql, 'duration_ms': int((time.time() - started) * 1000)}), 400
    finally:
        try:
            client.close()
        except Exception:
            pass
    return jsonify({'ok': True, 'sql': sql, 'duration_ms': int((time.time() - started) * 1000)})


@bp.route('/api/databases/connections/<int:conn_id>/database-schema')
@login_required
def api_db_database_schema(conn_id):
    """Categorized schema objects for one database (tables, views, routines)."""
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    database = (request.args.get('database') or '').strip()
    if not database or not re.fullmatch(r'[A-Za-z0-9_$]+', database):
        return jsonify({'error': 'Invalid database name.'}), 400
    try:
        client = _open_mysql(conn, database=database)
    except Exception as e:
        return jsonify({'error': str(e)}), 502
    try:
        with client.cursor() as cur:
            cur.execute("""
                SELECT table_name, table_type, table_rows,
                       COALESCE(data_length, 0) + COALESCE(index_length, 0) AS size_bytes
                FROM information_schema.tables
                WHERE table_schema = %s
                ORDER BY table_type, table_name
            """, (database,))
            tables = []
            views = []
            for r in cur.fetchall():
                name, ttype, trows, size_b = r[0], r[1], r[2], r[3]
                row = {'name': name}
                if ttype == 'BASE TABLE':
                    row['rows'] = int(trows or 0)
                    row['size_bytes'] = int(size_b or 0)
                    tables.append(row)
                elif ttype == 'VIEW':
                    views.append(row)
            cur.execute("""
                SELECT routine_name, routine_type
                FROM information_schema.routines
                WHERE routine_schema = %s
                ORDER BY routine_type, routine_name
            """, (database,))
            functions = []
            procedures = []
            for rname, rtype in cur.fetchall():
                item = {'name': rname}
                if rtype == 'FUNCTION':
                    functions.append(item)
                elif rtype == 'PROCEDURE':
                    procedures.append(item)
    except Exception as e:
        client.close()
        return jsonify({'error': f'Query failed: {str(e)}'}), 400
    finally:
        try:
            client.close()
        except Exception:
            pass
    return jsonify({
        'tables': tables,
        'views': views,
        'functions': functions,
        'procedures': procedures,
    })


@bp.route('/api/databases/connections/<int:conn_id>/table-rows')
@login_required
def api_db_table_rows(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    database = (request.args.get('database') or '').strip()
    table = (request.args.get('table') or '').strip()
    if not database or not table:
        return jsonify({'error': 'database and table are required.'}), 400
    # Identifier sanity: backtick-safe chars only. Prevents SQL injection
    # since we have to interpolate identifiers (parameterized binds don't
    # cover schema/table names).
    if not _valid_identifier(database) or not _valid_identifier(table):
        return jsonify({'error': 'Invalid database or table name.'}), 400
    try:
        page = max(int(request.args.get('page') or 1), 1)
        per_page = min(max(int(request.args.get('per_page') or 50), 1), 500)
    except (TypeError, ValueError):
        return jsonify({'error': 'page/per_page must be integers.'}), 400
    offset = (page - 1) * per_page
    search = (request.args.get('search') or '').strip()
    if len(search) > 200:
        return jsonify({'error': 'search string is too long.'}), 400
    # Strip LIKE metacharacters from user input (we add wildcards server-side).
    search_safe = re.sub(r'[%_\\]', '', search) if search else ''
    try:
        client = _open_mysql(conn, database=database)
    except Exception as e:
        return jsonify({'error': str(e)}), 502
    try:
        with client.cursor() as cur:
            primary_key = _table_primary_key_columns(cur, database, table)
            where_sql = ''
            where_args = ()
            if search_safe:
                cur.execute("""
                    SELECT COLUMN_NAME FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
                    ORDER BY ORDINAL_POSITION
                    LIMIT 48
                """, (database, table))
                colnames = [r[0] for r in cur.fetchall() if r and r[0]]
                parts = []
                for c in colnames:
                    if re.fullmatch(r'[A-Za-z0-9_$]+', c):
                        parts.append(f'CAST(`{c}` AS CHAR CHARACTER SET utf8mb4) LIKE %s')
                if parts:
                    term = f'%{search_safe}%'
                    where_sql = ' WHERE (' + ' OR '.join(parts) + ')'
                    where_args = tuple([term] * len(parts))
            count_sql = f'SELECT COUNT(*) FROM `{table}`' + where_sql
            cur.execute(count_sql, where_args)
            total = (cur.fetchone() or [0])[0]
            data_sql = f'SELECT * FROM `{table}`' + where_sql + ' LIMIT %s OFFSET %s'
            cur.execute(data_sql, where_args + (per_page, offset))
            cols = [d[0] for d in cur.description] if cur.description else []
            rows = [list(r) for r in cur.fetchall()]
    except Exception as e:
        client.close()
        return jsonify({'error': f'Query failed: {str(e)}'}), 400
    finally:
        try:
            client.close()
        except:
            pass
    rows = [[_coerce_json_value(c) for c in r] for r in rows]
    row_keys = []
    pk_indexes = [cols.index(c) for c in primary_key if c in cols]
    if primary_key and len(pk_indexes) == len(primary_key):
        for r in rows:
            row_keys.append({primary_key[i]: r[pk_indexes[i]] for i in range(len(primary_key))})
    return jsonify({
        'columns': cols,
        'rows': rows,
        'primary_key': primary_key,
        'row_keys': row_keys,
        'page': page,
        'per_page': per_page,
        'total': int(total),
        'search': search or None,
    })


def _db_table_request_data():
    data = request.get_json(silent=True) or {}
    database = (data.get('database') or request.args.get('database') or '').strip()
    table = (data.get('table') or request.args.get('table') or '').strip()
    if not _valid_identifier(database) or not _valid_identifier(table):
        raise ValueError('Invalid database or table name.')
    return data, database, table


@bp.route('/api/databases/connections/<int:conn_id>/table-design')
@login_required
def api_db_table_design(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    database = (request.args.get('database') or '').strip()
    table = (request.args.get('table') or '').strip()
    if not _valid_identifier(database) or not _valid_identifier(table):
        return jsonify({'error': 'Invalid database or table name.'}), 400
    try:
        client = _open_mysql(conn, database=database)
    except Exception as e:
        return jsonify({'error': str(e)}), 502
    try:
        with client.cursor() as cur:
            cur.execute("""
                SELECT ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE, DATA_TYPE,
                       CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE,
                       IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA,
                       COLUMN_COMMENT, CHARACTER_SET_NAME, COLLATION_NAME
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
                ORDER BY ORDINAL_POSITION
            """, (database, table))
            columns = [{
                'position': int(r[0] or 0),
                'name': r[1],
                'column_type': r[2],
                'data_type': r[3],
                'char_length': r[4],
                'numeric_precision': r[5],
                'numeric_scale': r[6],
                'nullable': r[7] == 'YES',
                'default': _coerce_json_value(r[8]),
                'key': r[9],
                'extra': r[10],
                'comment': r[11],
                'charset': r[12],
                'collation': r[13],
            } for r in cur.fetchall()]

            cur.execute("""
                SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE, COLLATION, CARDINALITY, NULLABLE
                FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
                ORDER BY INDEX_NAME, SEQ_IN_INDEX
            """, (database, table))
            indexes = []
            for r in cur.fetchall():
                indexes.append({
                    'name': r[0],
                    'unique': int(r[1] or 0) == 0,
                    'sequence': int(r[2] or 0),
                    'column': r[3],
                    'type': r[4],
                    'collation': r[5],
                    'cardinality': r[6],
                    'nullable': r[7],
                })

            cur.execute("""
                SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_SCHEMA,
                       REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                FROM information_schema.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND REFERENCED_TABLE_NAME IS NOT NULL
                ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION
            """, (database, table))
            foreign_keys = [{
                'constraint': r[0],
                'column': r[1],
                'referenced_schema': r[2],
                'referenced_table': r[3],
                'referenced_column': r[4],
            } for r in cur.fetchall()]

            cur.execute("""
                SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING, ACTION_STATEMENT
                FROM information_schema.TRIGGERS
                WHERE TRIGGER_SCHEMA = %s AND EVENT_OBJECT_TABLE = %s
                ORDER BY TRIGGER_NAME
            """, (database, table))
            triggers = [{
                'name': r[0],
                'event': r[1],
                'timing': r[2],
                'statement': r[3],
            } for r in cur.fetchall()]

            cur.execute(f'SHOW CREATE TABLE {_qi(table)}')
            create_row = cur.fetchone()
            create_sql = create_row[1] if create_row and len(create_row) > 1 else ''
    except Exception as e:
        client.close()
        return jsonify({'error': f'Query failed: {str(e)}'}), 400
    finally:
        try:
            client.close()
        except Exception:
            pass
    return jsonify({
        'database': database,
        'table': table,
        'columns': columns,
        'indexes': indexes,
        'foreign_keys': foreign_keys,
        'triggers': triggers,
        'create_sql': create_sql,
    })


def _row_key_where(key):
    if not isinstance(key, dict) or not key:
        raise ValueError('A primary-key row identity is required.')
    parts = []
    args = []
    for col, val in key.items():
        if not _valid_identifier(col):
            raise ValueError('Invalid key column.')
        parts.append(f'{_qi(col)} <=> %s')
        args.append(val)
    return ' AND '.join(parts), args


@bp.route('/api/databases/connections/<int:conn_id>/table-row', methods=['POST'])
@login_required
def api_db_table_row_insert(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    try:
        data, database, table = _db_table_request_data()
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    values = data.get('values') or {}
    if not isinstance(values, dict) or not values:
        return jsonify({'error': 'values object is required.'}), 400
    cols = []
    args = []
    for col, val in values.items():
        if not _valid_identifier(col):
            return jsonify({'error': f'Invalid column: {col}'}), 400
        cols.append(_qi(col))
        args.append(val)
    sql = f'INSERT INTO {_qi(table)} ({", ".join(cols)}) VALUES ({", ".join(["%s"] * len(cols))})'
    try:
        client = _open_mysql(conn, database=database)
        with client.cursor() as cur:
            affected = cur.execute(sql, tuple(args))
            last_id = getattr(cur, 'lastrowid', None)
        client.commit()
        client.close()
        return jsonify({'ok': True, 'affected_rows': int(affected or 0), 'last_insert_id': last_id})
    except Exception as e:
        try:
            client.close()
        except Exception:
            pass
        return jsonify({'error': str(e)}), 400


@bp.route('/api/databases/connections/<int:conn_id>/table-row', methods=['PUT'])
@login_required
def api_db_table_row_update(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    try:
        data, database, table = _db_table_request_data()
        where_sql, where_args = _row_key_where(data.get('key'))
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    values = data.get('values') or {}
    if not isinstance(values, dict) or not values:
        return jsonify({'error': 'No changed values to save.'}), 400
    sets = []
    args = []
    for col, val in values.items():
        if not _valid_identifier(col):
            return jsonify({'error': f'Invalid column: {col}'}), 400
        sets.append(f'{_qi(col)} = %s')
        args.append(val)
    sql = f'UPDATE {_qi(table)} SET {", ".join(sets)} WHERE {where_sql} LIMIT 1'
    try:
        client = _open_mysql(conn, database=database)
        with client.cursor() as cur:
            affected = cur.execute(sql, tuple(args + where_args))
        client.commit()
        client.close()
        return jsonify({'ok': True, 'affected_rows': int(affected or 0)})
    except Exception as e:
        try:
            client.close()
        except Exception:
            pass
        return jsonify({'error': str(e)}), 400


@bp.route('/api/databases/connections/<int:conn_id>/table-row', methods=['DELETE'])
@login_required
def api_db_table_row_delete(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    try:
        data, database, table = _db_table_request_data()
        where_sql, where_args = _row_key_where(data.get('key'))
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    sql = f'DELETE FROM {_qi(table)} WHERE {where_sql} LIMIT 1'
    try:
        client = _open_mysql(conn, database=database)
        with client.cursor() as cur:
            affected = cur.execute(sql, tuple(where_args))
        client.commit()
        client.close()
        return jsonify({'ok': True, 'affected_rows': int(affected or 0)})
    except Exception as e:
        try:
            client.close()
        except Exception:
            pass
        return jsonify({'error': str(e)}), 400


# ── SQL runner with destructive-query guard ─────────────────────

@bp.route('/api/databases/connections/<int:conn_id>/query', methods=['POST'])
@login_required
def api_db_query(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    sql = (data.get('sql') or '').strip()
    database = (data.get('database') or '').strip()
    confirm_destructive = bool(data.get('confirm_destructive'))
    if not sql:
        return jsonify({'error': 'sql is required.'}), 400

    # Detect risky statements unless the caller explicitly confirmed
    if not confirm_destructive:
        first_kw = sql.split(None, 1)[0].lower() if sql.split() else ''
        if first_kw in _DESTRUCTIVE_PREFIXES:
            return jsonify({
                'requires_confirmation': True,
                'reason': f'Statement starts with {first_kw.upper()} — destructive. Re-submit with confirm_destructive=true.',
            }), 200
        if _UNSAFE_WRITE_RE.match(sql):
            return jsonify({
                'requires_confirmation': True,
                'reason': 'UPDATE/DELETE without WHERE will affect every row. Re-submit with confirm_destructive=true.',
            }), 200

    try:
        client = _open_mysql(conn, database=database or None)
    except Exception as e:
        return jsonify({'error': str(e)}), 502
    started = time.time()
    try:
        with client.cursor() as cur:
            affected = cur.execute(sql)
            rows = []
            cols = []
            if cur.description:
                cols = [d[0] for d in cur.description]
                rows = [list(r) for r in cur.fetchall()]
        client.commit()
    except Exception as e:
        client.close()
        return jsonify({'error': str(e), 'duration_ms': int((time.time() - started) * 1000)}), 200
    client.close()
    def _coerce(v):
        if v is None or isinstance(v, (str, int, float, bool)):
            return v
        if isinstance(v, bytes):
            try:
                return v.decode('utf-8')
            except UnicodeDecodeError:
                return f'<binary {len(v)} bytes>'
        return str(v)
    return jsonify({
        'columns': cols,
        'rows': [[_coerce(c) for c in r] for r in rows],
        'affected_rows': int(affected or 0),
        'duration_ms': int((time.time() - started) * 1000),
    })


# ── Backup engine ───────────────────────────────────────────────

def _connection_backup_dir(conn):
    d = DB_BACKUPS_ROOT / _safe_dir_name(conn.name)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _backup_lock_path(conn_id, schedule_id=None, triggered_by='manual'):
    locks = DB_BACKUPS_ROOT / '.locks'
    locks.mkdir(parents=True, exist_ok=True)
    key = f'schedule-{int(schedule_id)}' if schedule_id is not None else f'{triggered_by or "manual"}-conn-{int(conn_id)}'
    return locks / re.sub(r'[^A-Za-z0-9_.-]', '_', key)


def _acquire_backup_lock(conn_id, schedule_id=None, triggered_by='manual', stale_after=6 * 60 * 60):
    path = _backup_lock_path(conn_id, schedule_id, triggered_by)
    try:
        path.mkdir()
        (path / 'pid').write_text(str(os.getpid()), encoding='utf-8')
        return path
    except FileExistsError:
        try:
            if time.time() - path.stat().st_mtime > stale_after:
                shutil.rmtree(path, ignore_errors=True)
                path.mkdir()
                (path / 'pid').write_text(str(os.getpid()), encoding='utf-8')
                return path
        except OSError:
            pass
        return None


def _release_backup_lock(path):
    if path:
        shutil.rmtree(path, ignore_errors=True)


def _unique_backup_path(backup_dir, base_name, timestamp):
    stem = f'{base_name}-{timestamp}'
    candidate = backup_dir / f'{stem}.sql'
    n = 2
    while candidate.exists():
        candidate = backup_dir / f'{stem}-{n}.sql'
        n += 1
    return candidate


def _public_download_url(raw_url):
    url = str(raw_url or '').strip()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname:
        raise ValueError('Only http:// and https:// URLs are supported.')
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == 'https' else 80), type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError(f'Could not resolve URL host: {exc}') from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            raise ValueError('URL host resolves to a private or unsafe address.')
    return url, parsed


def _download_sql_backup_from_url(url, dest):
    request_obj = urllib.request.Request(url, headers={'User-Agent': 'AscendDatabaseRestore/1.0'})
    tmp = dest.with_name(f'.{dest.name}.download-{os.getpid()}')
    total = 0
    try:
        with urllib.request.urlopen(request_obj, timeout=30) as res, open(tmp, 'wb') as out:
            length = res.headers.get('Content-Length')
            if length and int(length) > MAX_SQL_URL_DOWNLOAD_BYTES:
                raise ValueError('Remote SQL file is larger than the 1GB download limit.')
            while True:
                chunk = res.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_SQL_URL_DOWNLOAD_BYTES:
                    raise ValueError('Remote SQL file is larger than the 1GB download limit.')
                out.write(chunk)
        tmp.replace(dest)
        return total
    except Exception:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise


def _downloaded_backup_filename(conn, parsed, explicit_name):
    raw = str(explicit_name or '').strip()
    if raw:
        name = secure_filename(Path(raw.replace('\\', '/')).name)
    else:
        name = secure_filename(Path(urllib.parse.unquote(parsed.path or '').replace('\\', '/')).name)
    if not name:
        ts = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
        name = f'{_safe_dir_name(conn.name)}-download-{ts}.sql'
    if not name.lower().endswith('.sql'):
        raise ValueError('Only .sql files can be restored from URL right now.')
    return name


def _run_backup(conn_id, schedule_id=None, triggered_by='manual', target_database=None):
    """Synchronously run mysqldump for a connection. Records a BackupArchive
    row in either success or failed state. Used by both the manual endpoint
    and the scheduler."""
    with app.app_context():
        conn = db.session.get(DatabaseConnection, conn_id)
        if conn is None:
            return None
        lock = _acquire_backup_lock(conn.id, schedule_id, triggered_by)
        if lock is None:
            print(f'[backup] skipped duplicate run for connection={conn.id} schedule={schedule_id}', file=sys.stderr)
            return None
        backup_dir = _connection_backup_dir(conn)
        ts = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
        filepath = _unique_backup_path(backup_dir, _safe_dir_name(conn.name), ts)
        filename = filepath.name

        archive = BackupArchive(
            connection_id=conn.id,
            schedule_id=schedule_id,
            filename=filename,
            filepath=str(filepath),
            triggered_by=triggered_by,
            status='pending',
        )
        db.session.add(archive)
        db.session.commit()

        # Build mysqldump argv. --all-databases when no per-schedule filter,
        # otherwise dump only the listed databases.
        try:
            env, base_args = _mysqldump_env(conn)
        except Exception as e:
            archive.status = 'failed'
            archive.error_message = str(e)[:1000]
            archive.completed_at = datetime.now(timezone.utc)
            archive.duration_seconds = 0
            db.session.commit()
            _release_backup_lock(lock)
            return archive.id
        # --no-defaults must be first: skip ~/.my.cnf / etc. so a [client] or [mysqldump]
        # line like set-gtid-purged=OFF does not break older MariaDB mysqldump builds.
        argv = ['mysqldump', '--no-defaults', *base_args,
                '--single-transaction', '--quick', '--routines', '--events',
                '--triggers', '--default-character-set=utf8mb4']
        databases = []
        if target_database:
            td = str(target_database).strip()
            if re.fullmatch(r'[A-Za-z0-9_$]+', td):
                databases = [td]
        elif schedule_id is not None:
            sched = db.session.get(BackupSchedule, schedule_id)
            if sched:
                td = (getattr(sched, 'target_database', None) or '').strip()
                if td and re.fullmatch(r'[A-Za-z0-9_$]+', td):
                    databases = [td]
                elif sched.databases:
                    try:
                        databases = json.loads(sched.databases) or []
                    except (TypeError, ValueError):
                        databases = []
        if databases:
            argv += ['--databases', *databases]
        else:
            argv += ['--all-databases']

        started = time.time()
        uploaded_to = None
        try:
            with open(filepath, 'wb') as out:
                proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
                try:
                    while True:
                        chunk = proc.stdout.read(64 * 1024)
                        if not chunk:
                            break
                        out.write(chunk)
                except Exception as inner_exc:
                    proc.kill()
                    raise inner_exc
                stderr = proc.stderr.read()
                proc.wait()
                if proc.returncode != 0:
                    raise RuntimeError((stderr or b'').decode('utf-8', errors='replace').strip() or f'mysqldump exited {proc.returncode}')
            archive.size_bytes = filepath.stat().st_size
            archive.status = 'success'
            archive.error_message = None
            try:
                uploaded_to = _upload_backup_to_remote(str(filepath), filename)
                if uploaded_to:
                    archive.error_message = f'Uploaded to {uploaded_to}'
            except Exception as upload_exc:
                archive.error_message = f'Backup succeeded; remote upload failed: {str(upload_exc)[:900]}'
                _notify_email_async(
                    'backup_failed',
                    f'Ascend: backup upload failed - {conn.name}',
                    f'Connection: {conn.name}\nFile: {filename}\nError:\n{upload_exc}\nTime (UTC): {datetime.now(timezone.utc).isoformat()}',
                )
        except Exception as e:
            archive.status = 'failed'
            archive.error_message = str(e)[:1000]
            try:
                if filepath.exists():
                    filepath.unlink()
            except OSError:
                pass
        archive.completed_at = datetime.now(timezone.utc)
        archive.duration_seconds = int(time.time() - started)
        db.session.commit()
        _release_backup_lock(lock)
        lock = None

        cname = conn.name
        st = archive.status
        dblist = ', '.join(databases) if databases else 'all databases'
        if st == 'success':
            remote_lines = ''
            try:
                include_remote_link = bool(_backup_upload_settings_load().get('include_link_in_success_email'))
            except Exception:
                include_remote_link = False
            if uploaded_to and include_remote_link:
                remote_lines = (
                    f'Remote upload: uploaded\n'
                    f'Remote backup link: {uploaded_to}\n'
                    'Remote link note: This drive link may require the backup storage account to be signed in.\n'
                )
            elif uploaded_to:
                remote_lines = 'Remote upload: uploaded\n'
            _notify_email_async(
                'backup_success',
                f'Ascend: backup succeeded — {cname}',
                f'Connection: {cname}\nFile: {archive.filename}\nDatabases: {dblist}\nTrigger: {triggered_by}\n'
                f'Size: {archive.size_bytes or 0} bytes\n{remote_lines}Time (UTC): {archive.completed_at.isoformat()}',
            )
        else:
            err = (archive.error_message or '')[:3000]
            _notify_email_async(
                'backup_failed',
                f'Ascend: backup failed — {cname}',
                f'Connection: {cname}\nDatabases: {dblist}\nTrigger: {triggered_by}\nError:\n{err}\n'
                f'Time (UTC): {archive.completed_at.isoformat()}',
            )

        # Retention sweep: only when this run came from a schedule
        if schedule_id is not None:
            sched = db.session.get(BackupSchedule, schedule_id)
            if sched and sched.retention_days and sched.retention_days > 0:
                _apply_retention(conn.id, sched.retention_days)

        # Update schedule last-run metadata
        if schedule_id is not None:
            sched = db.session.get(BackupSchedule, schedule_id)
            if sched:
                sched.last_run_at = archive.completed_at
                sched.last_run_status = archive.status
                sched.last_run_error = archive.error_message
                db.session.commit()
        archive_id = archive.id
        _release_backup_lock(lock)
        return archive_id



def _apply_retention(connection_id, retention_days):
    cutoff = datetime.now(timezone.utc) - _timedelta(days=retention_days)
    old = BackupArchive.query.filter(
        BackupArchive.connection_id == connection_id,
        BackupArchive.started_at < cutoff,
    ).all()
    for a in old:
        try:
            p = Path(a.filepath)
            if p.exists():
                p.unlink()
        except OSError:
            pass
        db.session.delete(a)
    db.session.commit()


# Avoid circular: we already imported datetime+timezone at the top of app.py
from datetime import timedelta as _timedelta


@bp.route('/api/databases/connections/<int:conn_id>/backups')
@login_required
def api_db_backups_list(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    rows = BackupArchive.query.filter_by(connection_id=conn.id).order_by(BackupArchive.started_at.desc()).limit(200).all()
    return jsonify({'backups': [r.to_dict() for r in rows]})


@bp.route('/api/databases/connections/<int:conn_id>/backups/run', methods=['POST'])
@login_required
def api_db_backups_run(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    target_database = str(data.get('target_database') or '').strip()
    if target_database and not re.fullmatch(r'[A-Za-z0-9_$]+', target_database):
        return jsonify({'error': 'Invalid database name.'}), 400
    # Run in a background thread so the HTTP request doesn't block on a long dump
    def _run():
        _run_backup(conn.id, schedule_id=None, triggered_by='manual', target_database=target_database or None)
    threading.Thread(target=_run, daemon=True).start()
    return jsonify({'started': True, 'target_database': target_database or ''})


@bp.route('/api/databases/connections/<int:conn_id>/backups/download-url', methods=['POST'])
@login_required
def api_db_backup_download_url(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    started = datetime.now(timezone.utc)
    started_ts = time.time()
    try:
        url, parsed = _public_download_url(data.get('url'))
        filename = _downloaded_backup_filename(conn, parsed, data.get('filename'))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    backup_dir = _connection_backup_dir(conn)
    dest = (backup_dir / filename).resolve()
    if dest.exists():
        stem = dest.stem
        suffix = dest.suffix or '.sql'
        n = 2
        while dest.exists():
            dest = (backup_dir / f'{stem}-{n}{suffix}').resolve()
            n += 1
    try:
        dest.relative_to(backup_dir.resolve())
    except ValueError:
        return jsonify({'error': 'Invalid backup filename.'}), 400

    archive = BackupArchive(
        connection_id=conn.id,
        schedule_id=None,
        filename=dest.name,
        filepath=str(dest),
        triggered_by='url',
        status='pending',
        started_at=started,
    )
    db.session.add(archive)
    db.session.commit()
    try:
        size = _download_sql_backup_from_url(url, dest)
        archive.size_bytes = size
        archive.status = 'success'
        archive.completed_at = datetime.now(timezone.utc)
        archive.duration_seconds = max(0, int(time.time() - started_ts))
        db.session.commit()
        return jsonify({'ok': True, 'backup': archive.to_dict()}), 201
    except Exception as exc:
        archive.status = 'failed'
        archive.error_message = str(exc)[:1000]
        archive.completed_at = datetime.now(timezone.utc)
        archive.duration_seconds = max(0, int(time.time() - started_ts))
        db.session.commit()
        return jsonify({'error': f'Download failed: {str(exc)[:300]}', 'backup': archive.to_dict()}), 400


@bp.route('/api/databases/backups/<int:backup_id>/download')
@login_required
def api_db_backup_download(backup_id):
    err = _admin_required()
    if err:
        return err
    a = db.session.get(BackupArchive, backup_id)
    if a is None:
        return jsonify({'error': 'Backup not found.'}), 404
    conn = db.session.get(DatabaseConnection, a.connection_id)
    if conn is None or conn.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    if a.status != 'success' or not Path(a.filepath).exists():
        return jsonify({'error': 'Backup file is not available.'}), 410
    mimetype = 'text/plain; charset=utf-8' if a.filename.lower().endswith('.sql') else None
    return send_file(a.filepath, as_attachment=True, download_name=a.filename, mimetype=mimetype)


@bp.route('/api/databases/backups/<int:backup_id>/share', methods=['POST'])
@login_required
def api_db_backup_share(backup_id):
    err = _admin_required()
    if err:
        return err
    a = db.session.get(BackupArchive, backup_id)
    if a is None:
        return jsonify({'error': 'Backup not found.'}), 404
    conn = db.session.get(DatabaseConnection, a.connection_id)
    if conn is None or conn.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    if a.status != 'success' or not Path(a.filepath).exists():
        return jsonify({'error': 'Backup file is not available.'}), 410
    data = request.get_json(silent=True) or {}
    try:
        share = create_share_link(
            a.filepath,
            download_name=a.filename,
            title=f'Database backup {a.filename}',
            expires_hours=data.get('expires_hours'),
            allow_sensitive=True,
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    share['url'] = f"{request.host_url.rstrip('/')}/api/share/{share['token']}"
    return jsonify(share), 201


@bp.route('/api/databases/backups/<int:backup_id>', methods=['DELETE'])
@login_required
def api_db_backup_delete(backup_id):
    err = _admin_required()
    if err:
        return err
    a = db.session.get(BackupArchive, backup_id)
    if a is None:
        return jsonify({'error': 'Backup not found.'}), 404
    conn = db.session.get(DatabaseConnection, a.connection_id)
    if conn is None or conn.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    try:
        p = Path(a.filepath)
        if p.exists():
            p.unlink()
    except OSError:
        pass
    db.session.delete(a)
    db.session.commit()
    return jsonify({'ok': True})


# ── Schedules ───────────────────────────────────────────────────

@bp.route('/api/databases/connections/<int:conn_id>/restore-jobs', methods=['POST'])
@login_required
def api_db_restore_start(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    if bool(data.get('replace_existing')) and str(data.get('confirm_text') or '').strip() != str(data.get('target_database') or '').strip():
        return jsonify({'error': 'Type the target database name exactly to confirm restore replacement.', 'confirm_required': True, 'confirm_text': str(data.get('target_database') or '').strip()}), 400
    try:
        job = start_restore_job(
            conn,
            data.get('backup_id'),
            data.get('target_database'),
            data.get('collation') or 'utf8mb4_general_ci',
            bool(data.get('replace_existing', True)),
        )
    except LookupError as exc:
        return jsonify({'error': str(exc)}), 404
    except (TypeError, ValueError) as exc:
        return jsonify({'error': str(exc)}), 400
    return jsonify({'job': job}), 202


@bp.route('/api/databases/restore-jobs/<job_id>')
@login_required
def api_db_restore_status(job_id):
    err = _admin_required()
    if err:
        return err
    job = get_restore_job(job_id)
    if not job:
        return jsonify({'error': 'Restore job not found.'}), 404
    conn = db.session.get(DatabaseConnection, job.get('connection_id'))
    if conn is None or conn.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    return jsonify({'job': job})

def _server_timezone_name():
    """Best-effort IANA timezone for the Ascend host (used as schedule default)."""
    tz = (os.environ.get('TZ') or '').strip()
    if tz:
        return tz
    try:
        lt = datetime.now().astimezone()
        z = lt.tzinfo
        if z is not None:
            key = getattr(z, 'key', None)
            if key:
                return str(key)
    except Exception:
        pass
    return 'UTC'


_iana_tz_lower_map = None


def _iana_tz_lower_map_build():
    """Lowercase IANA name → canonical spelling (built once)."""
    global _iana_tz_lower_map
    if _iana_tz_lower_map is None:
        from zoneinfo import available_timezones
        _iana_tz_lower_map = {z.lower(): z for z in available_timezones()}
    return _iana_tz_lower_map


def _canonical_timezone_name(raw):
    """Normalize user input (e.g. Asia\\Beirut, asia/beirut) to canonical IANA id."""
    if raw is None:
        return None
    s = str(raw).strip().replace('\\', '/')
    while '//' in s:
        s = s.replace('//', '/')
    if not s:
        return None
    m = _iana_tz_lower_map_build()
    low = s.lower()
    if low in m:
        return m[low]
    from zoneinfo import ZoneInfo
    try:
        zi = ZoneInfo(s)
        return getattr(zi, 'key', None) or s
    except Exception:
        pass
    raise ValueError(
        'Unknown timezone. Use an IANA name with forward slashes, e.g. Asia/Beirut. '
        'Hour and minute are interpreted in that zone (your local time), not the server clock.',
    )


def _resolve_iana_zone(tz_name):
    """ZoneInfo for APScheduler; normalizes slashes/case; falls back to UTC."""
    from zoneinfo import ZoneInfo
    s = (tz_name or 'UTC').strip().replace('\\', '/').replace('//', '/') or 'UTC'
    m = _iana_tz_lower_map_build()
    canon = m.get(s.lower())
    if canon:
        return ZoneInfo(canon)
    try:
        return ZoneInfo(s)
    except Exception:
        return ZoneInfo('UTC')


def _normalize_schedule_target_database(val):
    if val is None:
        return ''
    s = str(val).strip()
    if not s:
        return ''
    if not re.fullmatch(r'[A-Za-z0-9_$]+', s):
        raise ValueError('Database name must be alphanumeric/underscore, or empty for all databases.')
    return s[:255]


def _apply_backup_schedule_fields(sched, data, *, partial):
    """Populate BackupSchedule from JSON. Raises ValueError on bad input."""
    if not partial or 'enabled' in data:
        sched.enabled = bool(data.get('enabled', True if not partial else sched.enabled))
    if not partial or 'every_hours' in data:
        try:
            v = int(data.get('every_hours', 24 if not partial else sched.every_hours))
        except (TypeError, ValueError):
            raise ValueError('every_hours must be an integer.')
        if not 1 <= v <= 24 * 30:
            raise ValueError('every_hours must be between 1 and 720.')
        sched.every_hours = v
    if not partial or 'at_hour' in data:
        try:
            ah = int(data.get('at_hour', 2 if not partial else sched.at_hour))
        except (TypeError, ValueError):
            raise ValueError('at_hour must be an integer.')
        if not 0 <= ah <= 23:
            raise ValueError('at_hour must be 0–23.')
        sched.at_hour = ah
    if not partial or 'at_minute' in data:
        try:
            m = int(data.get('at_minute', 0 if not partial else sched.at_minute))
        except (TypeError, ValueError):
            raise ValueError('at_minute must be an integer.')
        if not 0 <= m <= 59:
            raise ValueError('at_minute must be 0–59.')
        sched.at_minute = m
    if not partial or 'schedule_timezone' in data:
        tz_raw = data.get('schedule_timezone')
        if tz_raw is None or (isinstance(tz_raw, str) and not tz_raw.strip()):
            sched.schedule_timezone = None
        else:
            sched.schedule_timezone = _canonical_timezone_name(tz_raw)
    if not partial or 'retention_days' in data:
        try:
            r = int(data.get('retention_days', 14 if not partial else sched.retention_days))
        except (TypeError, ValueError):
            raise ValueError('retention_days must be an integer.')
        if not 1 <= r <= 365 * 5:
            raise ValueError('retention_days must be between 1 and 1825.')
        sched.retention_days = r
    if not partial or 'target_database' in data or 'databases' in data:
        if 'target_database' in data:
            sched.target_database = _normalize_schedule_target_database(data.get('target_database'))
        elif 'databases' in data:
            dbs = data.get('databases') or []
            if not isinstance(dbs, list):
                raise ValueError('databases must be a list.')
            if len(dbs) > 1:
                raise ValueError('Use separate schedule rows per database (target_database).')
            sched.target_database = _normalize_schedule_target_database(dbs[0]) if dbs else ''
        elif not partial:
            sched.target_database = ''
        sched.databases = None


def _backup_schedule_next_run_at(sched):
    ap = _ensure_scheduler()
    if not ap or not sched.enabled:
        return None
    job = ap.get_job(f'db-backup-{sched.id}')
    if not job or not job.next_run_time:
        return None
    return iso_utc(job.next_run_time)


def _schedule_dict_with_next(s):
    d = s.to_dict()
    d['next_run_at'] = _backup_schedule_next_run_at(s)
    return d


@bp.route('/api/databases/connections/<int:conn_id>/schedule', methods=['GET'])
@login_required
def api_db_schedule_get(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    rows = BackupSchedule.query.filter_by(connection_id=conn.id).order_by(BackupSchedule.id).all()
    out = [_schedule_dict_with_next(s) for s in rows]
    return jsonify({
        'schedules': out,
        'schedule': out[0] if out else None,
        'server_timezone': _server_timezone_name(),
    })


@bp.route('/api/databases/connections/<int:conn_id>/schedule', methods=['PUT'])
@login_required
def api_db_schedule_upsert(conn_id):
    """Updates the first schedule row only (legacy). Prefer /backup-schedules for multiple."""
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    sched = BackupSchedule.query.filter_by(connection_id=conn.id).order_by(BackupSchedule.id).first()
    if sched is None:
        sched = BackupSchedule(connection_id=conn.id, target_database='', databases=None)
        db.session.add(sched)
    try:
        _apply_backup_schedule_fields(sched, data, partial=True)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    db.session.commit()
    _reschedule_backup_jobs()
    return jsonify({'schedule': sched.to_dict(), 'server_timezone': _server_timezone_name()})


@bp.route('/api/databases/connections/<int:conn_id>/backup-schedules', methods=['GET'])
@login_required
def api_db_backup_schedules_list(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    rows = BackupSchedule.query.filter_by(connection_id=conn.id).order_by(BackupSchedule.id).all()
    return jsonify({
        'schedules': [_schedule_dict_with_next(s) for s in rows],
        'server_timezone': _server_timezone_name(),
    })


@bp.route('/api/databases/connections/<int:conn_id>/backup-schedules', methods=['POST'])
@login_required
def api_db_backup_schedules_create(conn_id):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    sched = BackupSchedule(connection_id=conn.id, target_database='', databases=None)
    try:
        _apply_backup_schedule_fields(sched, data, partial=False)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    db.session.add(sched)
    db.session.commit()
    _reschedule_backup_jobs()
    db.session.refresh(sched)
    return jsonify({'schedule': _schedule_dict_with_next(sched), 'server_timezone': _server_timezone_name()})


@bp.route('/api/databases/connections/<int:conn_id>/backup-schedules/<int:sid>', methods=['PUT'])
@login_required
def api_db_backup_schedules_update(conn_id, sid):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    sched = db.session.get(BackupSchedule, sid)
    if not sched or sched.connection_id != conn.id:
        return jsonify({'error': 'Schedule not found.'}), 404
    data = request.get_json(silent=True) or {}
    try:
        _apply_backup_schedule_fields(sched, data, partial=True)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    db.session.commit()
    _reschedule_backup_jobs()
    db.session.refresh(sched)
    return jsonify({'schedule': _schedule_dict_with_next(sched), 'server_timezone': _server_timezone_name()})


@bp.route('/api/databases/connections/<int:conn_id>/backup-schedules/<int:sid>', methods=['DELETE'])
@login_required
def api_db_backup_schedules_delete(conn_id, sid):
    err = _admin_required()
    if err:
        return err
    conn, err = _conn_owned(conn_id)
    if err:
        return err
    sched = db.session.get(BackupSchedule, sid)
    if not sched or sched.connection_id != conn.id:
        return jsonify({'error': 'Schedule not found.'}), 404
    for a in BackupArchive.query.filter_by(schedule_id=sid).all():
        a.schedule_id = None
    db.session.delete(sched)
    db.session.commit()
    _reschedule_backup_jobs()
    return jsonify({'ok': True})


# ── APScheduler wiring ──────────────────────────────────────────
# In-process so the panel needs no external cron. Single BackgroundScheduler
# shared across endpoints; rebuilt whenever schedules are upserted.

_db_scheduler = None


def _ensure_scheduler():
    global _db_scheduler
    if _db_scheduler is not None:
        return _db_scheduler
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
    except ImportError:
        return None
    _db_scheduler = BackgroundScheduler(timezone='UTC', daemon=True)
    _db_scheduler.start()
    return _db_scheduler


def _schedule_tz_name(s):
    raw = (s.schedule_timezone or '').strip() if s.schedule_timezone else ''
    if raw:
        return raw
    return _server_timezone_name()


def _reschedule_backup_jobs():
    sched = _ensure_scheduler()
    if sched is None:
        return
    # Remove all existing jobs we own and re-add from current DB state
    for job in list(sched.get_jobs()):
        if job.id.startswith('db-backup-'):
            sched.remove_job(job.id)
    for s in BackupSchedule.query.filter_by(enabled=True).all():
        tz_name = _schedule_tz_name(s)
        zone = _resolve_iana_zone(tz_name)
        try:
            ah = int(s.at_hour)
        except (TypeError, ValueError):
            ah = 2
        ah = max(0, min(ah, 23))
        try:
            am = int(s.at_minute)
        except (TypeError, ValueError):
            am = 0
        am = max(0, min(am, 59))
        try:
            eh = int(s.every_hours)
        except (TypeError, ValueError):
            eh = 24
        eh = max(1, min(eh, 24 * 30))
        # Daily backups: cron at clock time in the chosen timezone (real APScheduler job).
        if eh == 24:
            from apscheduler.triggers.cron import CronTrigger
            trigger = CronTrigger(hour=ah, minute=am, timezone=zone)
        else:
            from apscheduler.triggers.interval import IntervalTrigger
            now = datetime.now(timezone.utc)
            start = now.replace(second=0, microsecond=0, minute=am)
            if start <= now:
                start = start + _timedelta(hours=eh)
            try:
                trigger = IntervalTrigger(hours=eh, start_date=start, timezone=zone)
            except TypeError:
                trigger = IntervalTrigger(hours=eh, start_date=start)
        sched.add_job(
            func=_run_backup,
            trigger=trigger,
            id=f'db-backup-{s.id}',
            args=[s.connection_id, s.id, 'scheduled'],
            misfire_grace_time=600,
            coalesce=True,
            max_instances=1,
        )


# ═══════════════════════════════════════════
