import json
import os
import platform
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, jsonify, request
from flask_login import login_required

bp = Blueprint('security_center', __name__)

BASE_DIR = None
DEPLOYMENTS_DIR = None
STATIC_SITES_DIR = None
SECURITY_DIR = None
STATE_PATH = None
SCAN_LOG_PATH = None
INSTALL_LOG_PATH = None
QUARANTINE_DIR = None
_admin_required = None
_audit_log = None
_notify_email_async = None


def _now():
    return datetime.now(timezone.utc).isoformat()


def _load_json(path, default):
    try:
        data = json.loads(Path(path).read_text(encoding='utf-8'))
        return data if isinstance(data, type(default)) else default
    except Exception:
        return default


def _write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, indent=2), encoding='utf-8')
    tmp.replace(path)


def _tail(path, max_chars=60000):
    try:
        text = Path(path).read_text(encoding='utf-8', errors='replace')
    except Exception:
        return ''
    return text[-max_chars:]


def _run(cmd, timeout=4):
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors='replace', timeout=timeout)
        return proc.returncode, (proc.stdout or '').strip(), (proc.stderr or '').strip()
    except Exception as exc:
        return 1, '', str(exc)


def _tool_version(name, args):
    path = shutil.which(name)
    if not path:
        return {'installed': False, 'path': None, 'version': None}
    rc, out, err = _run([path] + args)
    first = (out or err).splitlines()[0] if (out or err) else ''
    return {'installed': True, 'path': path, 'version': first[:180], 'returncode': rc}


def _freshclam_status():
    db_dir = Path('/var/lib/clamav')
    files = []
    if db_dir.exists():
        for name in ('main.cvd', 'main.cld', 'daily.cvd', 'daily.cld', 'bytecode.cvd', 'bytecode.cld'):
            p = db_dir / name
            if p.exists():
                try:
                    files.append({'name': name, 'updated_at': datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat()})
                except OSError:
                    pass
    return {'database_files': files}


def _service_active(name):
    if shutil.which('systemctl') is None:
        return {'available': False, 'active': None}
    rc, out, _ = _run(['systemctl', 'is-active', name])
    return {'available': True, 'active': out or 'unknown', 'ok': rc == 0}


def _scan_paths():
    candidates = [
        {'key': 'web_roots', 'label': 'Web roots', 'path': '/var/www'},
        {'key': 'tmp', 'label': 'Temporary files', 'path': '/tmp'},
        {'key': 'deployments', 'label': 'Ascend deployments', 'path': str(DEPLOYMENTS_DIR)},
        {'key': 'static_sites', 'label': 'Static sites', 'path': str(STATIC_SITES_DIR)},
        {'key': 'ascend', 'label': 'Ascend panel files', 'path': str(BASE_DIR)},
    ]
    return [{**c, 'exists': Path(c['path']).exists()} for c in candidates]


def _current_status():
    state = _load_json(STATE_PATH, {})
    clamscan = _tool_version('clamscan', ['--version'])
    freshclam = _tool_version('freshclam', ['--version'])
    return {
        'server': {
            'platform': platform.platform(),
            'linux': platform.system().lower() == 'linux',
            'is_root': (hasattr(os, 'geteuid') and os.geteuid() == 0),
        },
        'tools': {
            'clamscan': clamscan,
            'freshclam': freshclam,
            'clamav_freshclam_service': _service_active('clamav-freshclam.service'),
            'clamav_daemon_service': _service_active('clamav-daemon.service'),
            'definitions': _freshclam_status(),
        },
        'state': state,
        'scan_paths': _scan_paths(),
        'logs': {
            'scan': str(SCAN_LOG_PATH),
            'install': str(INSTALL_LOG_PATH),
        },
        'updated_at': _now(),
    }


def _spawn_worker(args, log_path):
    cmd = [sys.executable, '-m', 'backend.security.worker'] + args
    Path(log_path).parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, 'a', encoding='utf-8') as log:
        if os.name == 'nt':
            flags = getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0) | getattr(subprocess, 'DETACHED_PROCESS', 0)
            proc = subprocess.Popen(cmd, cwd=str(BASE_DIR), stdout=log, stderr=subprocess.STDOUT, close_fds=True, creationflags=flags)
        else:
            proc = subprocess.Popen(cmd, cwd=str(BASE_DIR), stdout=log, stderr=subprocess.STDOUT, close_fds=True, start_new_session=True)
    return {'pid': proc.pid, 'cmd': cmd}


def _maybe_notify_findings(status):
    scan = ((status.get('state') or {}).get('scan') or {})
    findings = scan.get('findings') or []
    if not findings or scan.get('status') != 'infected':
        return
    try:
        lines = [f"- {f.get('path')}: {f.get('signature')}" for f in findings[:20]]
        _notify_email_async(
            'system_alert',
            f'Ascend security alert: {len(findings)} infected file(s) detected',
            'ClamAV detected infected files on this server.\n\n' + '\n'.join(lines) + f'\n\nTime (UTC): {_now()}',
        )
    except Exception:
        pass


def register_security_feature(*, flask_app, csrf_protect, base_dir, deployments_dir, static_sites_dir, admin_required, audit_log, notify_email_async):
    global BASE_DIR, DEPLOYMENTS_DIR, STATIC_SITES_DIR, SECURITY_DIR, STATE_PATH, SCAN_LOG_PATH, INSTALL_LOG_PATH, QUARANTINE_DIR
    global _admin_required, _audit_log, _notify_email_async
    BASE_DIR = Path(base_dir)
    DEPLOYMENTS_DIR = Path(deployments_dir)
    STATIC_SITES_DIR = Path(static_sites_dir)
    SECURITY_DIR = BASE_DIR / 'security'
    STATE_PATH = SECURITY_DIR / 'security-state.json'
    SCAN_LOG_PATH = SECURITY_DIR / 'scan.log'
    INSTALL_LOG_PATH = SECURITY_DIR / 'install.log'
    QUARANTINE_DIR = SECURITY_DIR / 'quarantine'
    SECURITY_DIR.mkdir(parents=True, exist_ok=True)
    QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)
    _admin_required = admin_required
    _audit_log = audit_log
    _notify_email_async = notify_email_async
    csrf_protect.exempt(bp)
    flask_app.register_blueprint(bp)


@bp.route('/api/security/status')
@login_required
def api_security_status():
    status = _current_status()
    scan = ((status.get('state') or {}).get('scan') or {})
    state = status.get('state') or {}
    notify_key = scan.get('started_at')
    if scan.get('status') == 'infected' and notify_key and state.get('last_infected_scan_notified') != notify_key:
        _maybe_notify_findings(status)
        state['last_infected_scan_notified'] = notify_key
        _write_json(STATE_PATH, state)
        status['state'] = state
    return jsonify(status)


@bp.route('/api/security/install/start', methods=['POST'])
@login_required
def api_security_install_start():
    gate = _admin_required()
    if gate:
        return gate
    state = _load_json(STATE_PATH, {})
    if (state.get('install') or {}).get('status') == 'running':
        return jsonify({'message': 'ClamAV install is already running.', 'state': state})
    state['install'] = {'status': 'starting', 'started_at': _now(), 'message': 'Starting ClamAV install...'}
    _write_json(STATE_PATH, state)
    launch = _spawn_worker(['install', '--state', str(STATE_PATH), '--log', str(INSTALL_LOG_PATH)], INSTALL_LOG_PATH)
    state['install']['pid'] = launch['pid']
    _write_json(STATE_PATH, state)
    _audit_log('security.clamav_install_started', 'ok', 'ClamAV install started', {'pid': launch['pid']})
    return jsonify({'message': 'ClamAV install started.', 'pid': launch['pid']})


@bp.route('/api/security/scan/start', methods=['POST'])
@login_required
def api_security_scan_start():
    gate = _admin_required()
    if gate:
        return gate
    data = request.get_json(silent=True) or {}
    selected = data.get('paths')
    path_map = {p['key']: p['path'] for p in _scan_paths()}
    if isinstance(selected, list) and selected:
        paths = [path_map.get(str(p), str(p)) for p in selected]
    else:
        paths = [path_map['web_roots'], path_map['tmp'], path_map['deployments'], path_map['static_sites']]
    paths = [str(Path(p)) for p in paths if p]
    state = _load_json(STATE_PATH, {})
    if (state.get('scan') or {}).get('status') == 'running':
        return jsonify({'error': 'A security scan is already running.'}), 409
    state['scan'] = {'status': 'starting', 'started_at': _now(), 'paths': paths, 'message': 'Starting scan...'}
    _write_json(STATE_PATH, state)
    args = ['scan', '--state', str(STATE_PATH), '--log', str(SCAN_LOG_PATH), '--quarantine-dir', str(QUARANTINE_DIR)]
    if data.get('quarantine', True):
        args.append('--quarantine')
    args.extend(paths)
    launch = _spawn_worker(args, SCAN_LOG_PATH)
    state['scan']['pid'] = launch['pid']
    _write_json(STATE_PATH, state)
    _audit_log('security.scan_started', 'ok', 'Security scan started', {'pid': launch['pid'], 'paths': paths})
    return jsonify({'message': 'Security scan started.', 'pid': launch['pid']})


@bp.route('/api/security/logs')
@login_required
def api_security_logs():
    kind = (request.args.get('kind') or 'scan').strip().lower()
    path = INSTALL_LOG_PATH if kind == 'install' else SCAN_LOG_PATH
    return jsonify({'kind': kind, 'path': str(path), 'log': _tail(path)})


@bp.route('/api/security/findings', methods=['DELETE'])
@login_required
def api_security_findings_clear():
    gate = _admin_required()
    if gate:
        return gate
    state = _load_json(STATE_PATH, {})
    state['findings'] = []
    if isinstance(state.get('scan'), dict):
        state['scan']['findings'] = []
    _write_json(STATE_PATH, state)
    _audit_log('security.findings_cleared', 'ok', 'Security findings were cleared')
    return jsonify({'message': 'Security findings cleared.'})


@bp.route('/api/security/quarantine', methods=['DELETE'])
@login_required
def api_security_quarantine_clear():
    gate = _admin_required()
    if gate:
        return gate
    state = _load_json(STATE_PATH, {})
    removed = 0
    for item in list(state.get('quarantine') or []):
        q = item.get('quarantine_path')
        if q:
            try:
                Path(q).unlink(missing_ok=True)
                removed += 1
            except Exception:
                pass
    state['quarantine'] = []
    _write_json(STATE_PATH, state)
    _audit_log('security.quarantine_cleared', 'ok', 'Security quarantine cleared', {'removed': removed})
    return jsonify({'message': 'Quarantine cleared.', 'removed': removed})
