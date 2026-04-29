import json
import os
import ipaddress
import platform
import re
import shutil
import subprocess
import sys
import threading
import time
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
CROWDSEC_LOG_PATH = None
QUARANTINE_DIR = None
_admin_required = None
_audit_log = None
_notify_email_async = None
_CROWDSEC_DECISIONS_CACHE = {'at': 0.0, 'data': None}
_CROWDSEC_DECISIONS_LOCK = threading.Lock()
_CROWDSEC_DECISIONS_RUNNING = False
_AUTO_SSH_BLOCK_LOCK = threading.Lock()
_AUTO_SSH_BLOCK_RUNNING = False

STATUS_CROWDSEC_CACHE_SECONDS = 20
AUTO_SSH_BLOCK_INTERVAL_SECONDS = 300

THREAT_RE = re.compile(
    r'(getxmrig|xmrig|c3pool|stratum\+(?:tcp|ssl)://|auto\.c3pool\.org|80\.13\.111\.125|/root/\.config/\.logrotate|\.logrotate)',
    re.IGNORECASE,
)
THREAT_SCAN_PATHS = [
    '/etc/cron.d',
    '/etc/cron.daily',
    '/etc/cron.hourly',
    '/etc/cron.weekly',
    '/etc/cron.monthly',
    '/var/spool/cron',
    '/etc/systemd',
    '/lib/systemd',
    '/root',
    '/home',
    '/tmp',
    '/var/tmp',
]
BOUNCER_SERVICE_CANDIDATES = [
    'crowdsec-firewall-bouncer.service',
    'crowdsec-firewall-bouncer-iptables.service',
    'crowdsec-firewall-bouncer-nftables.service',
]


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


def _safe_read_lines(path, max_bytes=1024 * 1024):
    try:
        p = Path(path)
        if not p.is_file() or p.stat().st_size > max_bytes:
            return []
        return p.read_text(encoding='utf-8', errors='replace').splitlines()
    except Exception:
        return []


def _is_cleanup_backup(path):
    name = Path(path).name
    return '.ascend-clean-' in name and name.endswith('.bak')


def _cleanup_backup_path(source_path):
    raw = str(source_path).replace('\\', '/').strip('/')
    safe = re.sub(r'[^A-Za-z0-9._-]+', '_', raw).strip('._') or 'persistence'
    backup_dir = SECURITY_DIR / 'cleanup-backups'
    backup_dir.mkdir(parents=True, exist_ok=True)
    return backup_dir / f'{safe}.ascend-clean-{int(time.time())}.bak'


def _scan_threat_processes():
    rc, out, err = _run(['ps', 'auxww'], timeout=8)
    rows = []
    if rc != 0:
        return {'items': [], 'error': err or 'Could not list processes.'}
    for line in out.splitlines()[1:]:
        if not THREAT_RE.search(line):
            continue
        parts = line.split(None, 10)
        if len(parts) < 11:
            continue
        rows.append({
            'pid': parts[1],
            'user': parts[0],
            'cpu': parts[2],
            'mem': parts[3],
            'command': parts[10],
        })
    return {'items': rows, 'error': ''}


def _scan_threat_files():
    findings = []
    roots = [Path(p) for p in THREAT_SCAN_PATHS if Path(p).exists()]
    for root in roots:
        try:
            iterator = root.rglob('*') if root.is_dir() else [root]
            for path in iterator:
                try:
                    if not path.is_file() or path.is_symlink():
                        continue
                    if path.name in {'.bash_history', '.zsh_history', '.python_history', '.mysql_history'}:
                        continue
                    if any(part in {'node_modules', '.git', 'venv', '__pycache__'} for part in path.parts):
                        continue
                    lines = _safe_read_lines(path)
                    if not lines:
                        continue
                    for idx, line in enumerate(lines, 1):
                        if THREAT_RE.search(line):
                            findings.append({
                                'path': str(path),
                                'line': idx,
                                'match': line.strip()[:1000],
                                'kind': 'persistence',
                                'is_cleanup_backup': _is_cleanup_backup(path),
                            })
                            break
                except (OSError, PermissionError):
                    continue
        except (OSError, PermissionError):
            continue
    return findings[:500]


def _post_persistence_cleanup(path):
    results = []
    systemctl = shutil.which('systemctl')
    if not systemctl:
        return results
    try:
        resolved = Path(path).resolve()
    except Exception:
        return results
    systemd_roots = [Path('/etc/systemd'), Path('/lib/systemd')]
    if not any(str(resolved).startswith(str(root)) for root in systemd_roots):
        return results
    if resolved.suffix == '.service':
        unit = resolved.name
        for cmd in ([systemctl, 'disable', '--now', unit], [systemctl, 'daemon-reload']):
            rc, out, err = _run(cmd, timeout=12)
            results.append({'cmd': ' '.join(cmd), 'returncode': rc, 'stdout': out, 'stderr': err})
    return results


def _scan_immutable_files():
    candidates = [
        '/var/spool/cron/crontabs/root',
        '/var/spool/cron/root',
        '/root/.config/.logrotate',
    ]
    rows = []
    lsattr = shutil.which('lsattr')
    if not lsattr:
        return rows
    for path in candidates:
        if not Path(path).exists():
            continue
        rc, out, _ = _run([lsattr, path], timeout=5)
        if rc == 0 and out:
            attrs = out.split()[0]
            if 'i' in attrs:
                rows.append({'path': path, 'attrs': attrs, 'reason': 'Immutable flag prevents cleanup or edits.'})
    return rows


def _threat_status():
    processes = _scan_threat_processes()
    files = _scan_threat_files()
    immutable = _scan_immutable_files()
    return {
        'processes': processes.get('items') or [],
        'process_error': processes.get('error') or '',
        'persistence': files,
        'immutable': immutable,
        'checked_at': _now(),
    }


def _remove_line_from_file(path, line_no):
    path = Path(path)
    lines = _safe_read_lines(path, max_bytes=5 * 1024 * 1024)
    if not lines:
        raise ValueError('File is empty or cannot be read safely.')
    idx = int(line_no) - 1
    if idx < 0 or idx >= len(lines):
        raise ValueError('Line number is out of range.')
    removed = lines.pop(idx)
    backup = _cleanup_backup_path(path)
    shutil.copy2(path, backup)
    path.write_text('\n'.join(lines) + ('\n' if lines else ''), encoding='utf-8')
    return removed, str(backup)


def _run_repair_steps(steps, timeout=45):
    results = []
    ok = True
    for step in steps:
        rc, out, err = _run(step, timeout=timeout)
        results.append({
            'cmd': ' '.join(step),
            'returncode': rc,
            'stdout': out[-4000:],
            'stderr': err[-4000:],
        })
        if rc != 0:
            ok = False
            break
    return ok, results


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
    return {'available': True, 'name': name, 'active': out or 'unknown', 'ok': rc == 0}


def _systemd_unit_exists(name):
    if shutil.which('systemctl') is None:
        return False
    rc, _, _ = _run(['systemctl', 'cat', name], timeout=3)
    return rc == 0


def _first_existing_service(candidates):
    for name in candidates:
        if _systemd_unit_exists(name):
            return name
    return candidates[0] if candidates else ''


def _service_active_any(candidates):
    if shutil.which('systemctl') is None:
        return {'available': False, 'active': None, 'checked': candidates}
    rows = []
    for name in candidates:
        info = _service_active(name)
        info['exists'] = _systemd_unit_exists(name)
        rows.append(info)
        if info.get('ok'):
            return {**info, 'checked': candidates, 'alternatives': rows}
    existing = next((row for row in rows if row.get('exists')), None)
    return {**(existing or rows[0]), 'checked': candidates, 'alternatives': rows}


def _crowdsec_version():
    path = shutil.which('crowdsec')
    if not path:
        return {'installed': False, 'path': None, 'version': None}
    rc, out, err = _run([path, '-version'])
    text = out or err
    first = text.splitlines()[0] if text else ''
    return {'installed': True, 'path': path, 'version': first[:180], 'returncode': rc}


def _crowdsec_decisions():
    cscli = shutil.which('cscli')
    if not cscli:
        return {'available': False, 'items': [], 'error': 'cscli is not installed.'}
    rc, out, err = _run([cscli, 'decisions', 'list', '-o', 'json'], timeout=5)
    if rc != 0:
        return {'available': True, 'items': [], 'error': err or out or 'Could not list CrowdSec decisions.'}
    try:
        parsed = json.loads(out or '[]')
    except json.JSONDecodeError:
        return {'available': True, 'items': [], 'error': 'CrowdSec returned invalid JSON.'}
    if isinstance(parsed, dict):
        raw_items = parsed.get('decisions') or parsed.get('items') or parsed.get('data') or []
    else:
        raw_items = parsed
    text_by_id = {}
    text_by_reason = {}
    rc_text, out_text, _ = _run([cscli, 'decisions', 'list'], timeout=2)
    if rc_text == 0 and out_text:
        ip_re = re.compile(r'(?<![\w:])(?:\d{1,3}\.){3}\d{1,3}(?![\w:])')
        for line in out_text.splitlines():
            ips = [ip for ip in ip_re.findall(line) if _valid_public_ip(ip)]
            if not ips:
                continue
            cols = [c.strip() for c in re.split(r'\s{2,}|\|', line) if c.strip()]
            for col in cols:
                if col.isdigit():
                    text_by_id.setdefault(col, ips[0])
            for marker in ('crowdsecurity/', 'manual ', 'automatic '):
                if marker in line:
                    text_by_reason.setdefault(marker, ips[0])

    def pick(obj, *keys):
        for key in keys:
            if key in obj and obj.get(key) not in (None, ''):
                return obj.get(key)
        lowered = {str(k).lower().replace('-', '_').replace(' ', '_'): v for k, v in obj.items()}
        for key in keys:
            normalized = str(key).lower().replace('-', '_').replace(' ', '_')
            if lowered.get(normalized) not in (None, ''):
                return lowered.get(normalized)
        return None

    def scalar(value):
        if value is None:
            return None
        if isinstance(value, (str, int, float, bool)):
            return str(value)
        try:
            return json.dumps(value, sort_keys=True)
        except Exception:
            return str(value)

    def find_ip_deep(value):
        if value is None:
            return None
        if isinstance(value, dict):
            for key in ('value', 'Value', 'scope_value', 'ScopeValue', 'ip', 'IP', 'source_ip', 'SourceIP'):
                if key in value and _valid_public_ip(value.get(key)):
                    return str(value.get(key))
            for nested in value.values():
                found = find_ip_deep(nested)
                if found:
                    return found
        elif isinstance(value, list):
            for nested in value:
                found = find_ip_deep(nested)
                if found:
                    return found
        else:
            text = str(value)
            for ip in re.findall(r'(?<![\w:])(?:\d{1,3}\.){3}\d{1,3}(?![\w:])', text):
                if _valid_public_ip(ip):
                    return ip
        return None

    state = _load_json(STATE_PATH, {})
    block_history = state.get('crowdsec_block_history') if isinstance(state.get('crowdsec_block_history'), dict) else {}
    items = []
    for item in raw_items if isinstance(raw_items, list) else []:
        if not isinstance(item, dict):
            continue
        scope_value = pick(item, 'value', 'Value', 'scope_value', 'ScopeValue', 'scope_value_text', 'IP', 'ip')
        scope = pick(item, 'scope', 'Scope')
        scope_and_value = pick(item, 'scope:value', 'Scope:Value', 'scope_value_pair')
        if not scope_value and isinstance(scope_and_value, str) and ':' in scope_and_value:
            left, _, right = scope_and_value.partition(':')
            scope = scope or left.strip()
            scope_value = right.strip()
        item_id = scalar(pick(item, 'id', 'ID'))
        reason_text = scalar(pick(item, 'reason', 'Reason'))
        value_text = scalar(scope_value) or find_ip_deep(item) or text_by_id.get(item_id or '') or text_by_reason.get(reason_text or '')
        history = block_history.get(value_text or '') if value_text else None
        items.append({
            'id': item_id,
            'value': value_text,
            'scope': scalar(scope),
            'type': scalar(pick(item, 'type', 'Type')),
            'origin': scalar(pick(item, 'origin', 'Origin', 'source', 'Source')),
            'reason': reason_text,
            'duration': scalar(pick(item, 'duration', 'Duration')),
            'until': scalar(pick(item, 'until', 'Until', 'expiration', 'Expiration')),
            'created_at': scalar(pick(item, 'created_at', 'CreatedAt', 'created', 'Created', 'start_at', 'StartAt')),
            'blocked_at': scalar((history or {}).get('blocked_at')) or scalar(pick(item, 'created_at', 'CreatedAt', 'created', 'Created', 'start_at', 'StartAt')),
            'blocked_by': scalar((history or {}).get('blocked_by')) or scalar(pick(item, 'origin', 'Origin', 'source', 'Source')),
            'scenario': scalar(pick(item, 'scenario', 'Scenario')),
            'raw': item,
        })
    return {'available': True, 'items': items, 'error': ''}


def _cached_crowdsec_decisions():
    global _CROWDSEC_DECISIONS_RUNNING
    if not shutil.which('cscli'):
        return {'available': False, 'items': [], 'error': 'cscli is not installed.'}
    now_ts = time.monotonic()
    cached = _CROWDSEC_DECISIONS_CACHE.get('data')
    if cached is not None and now_ts - float(_CROWDSEC_DECISIONS_CACHE.get('at') or 0) < STATUS_CROWDSEC_CACHE_SECONDS:
        return cached
    state = _load_json(STATE_PATH, {})
    shared = state.get('crowdsec_decisions_cache') if isinstance(state.get('crowdsec_decisions_cache'), dict) else None
    if shared and cached is None:
        _CROWDSEC_DECISIONS_CACHE['data'] = shared
        _CROWDSEC_DECISIONS_CACHE['at'] = now_ts
        cached = shared
    with _CROWDSEC_DECISIONS_LOCK:
        if not _CROWDSEC_DECISIONS_RUNNING:
            _CROWDSEC_DECISIONS_RUNNING = True

            def worker():
                global _CROWDSEC_DECISIONS_RUNNING
                try:
                    data = _crowdsec_decisions()
                    _CROWDSEC_DECISIONS_CACHE['at'] = time.monotonic()
                    _CROWDSEC_DECISIONS_CACHE['data'] = data
                    state = _load_json(STATE_PATH, {})
                    state['crowdsec_decisions_cache'] = data
                    _write_json(STATE_PATH, state)
                finally:
                    with _CROWDSEC_DECISIONS_LOCK:
                        _CROWDSEC_DECISIONS_RUNNING = False

            threading.Thread(target=worker, daemon=True, name='ascend-crowdsec-decisions').start()
    fallback = cached or shared or {'available': True, 'items': [], 'error': ''}
    return {**fallback, 'refreshing': True}


def _valid_public_ip(value):
    try:
        ip = ipaddress.ip_address(str(value))
        return not (ip.is_private or ip.is_loopback or ip.is_multicast or ip.is_reserved or ip.is_unspecified)
    except ValueError:
        return False


def _parse_ssh_failure_line(line):
    patterns = [
        r'Failed password for invalid user (?P<user>\S+) from (?P<ip>[0-9a-fA-F:.]+) port (?P<port>\d+) ssh2',
        r'Failed password for (?P<user>\S+) from (?P<ip>[0-9a-fA-F:.]+) port (?P<port>\d+) ssh2',
    ]
    for pattern in patterns:
        m = re.search(pattern, line)
        if m:
            item = m.groupdict()
            item['raw'] = line
            item['at'] = line[:15].strip() if len(line) >= 15 else ''
            return item
    return None


def _ssh_failed_logins(limit=500):
    limit = max(50, min(int(limit or 500), 2000))
    commands = [
        ['journalctl', '-u', 'ssh', '-u', 'sshd', '--since', '24 hours ago', '--no-pager', '-n', str(limit * 3)],
    ]
    lines = []
    errors = []
    for cmd in commands:
        if shutil.which(cmd[0]) is None:
            continue
        rc, out, err = _run(cmd, timeout=10)
        if rc == 0 and out:
            lines.extend(out.splitlines())
            break
        if err:
            errors.append(err)
    if not lines:
        for path in (Path('/var/log/auth.log'), Path('/var/log/secure')):
            if path.exists():
                try:
                    lines = path.read_text(encoding='utf-8', errors='replace').splitlines()[-limit * 3:]
                    break
                except Exception as exc:
                    errors.append(str(exc))

    events = []
    summary = {}
    for line in lines:
        if 'Failed password' not in line:
            continue
        item = _parse_ssh_failure_line(line)
        if not item:
            continue
        ip = item['ip']
        if not _valid_public_ip(ip):
            continue
        events.append(item)
        row = summary.setdefault(ip, {
            'ip': ip,
            'count': 0,
            'users': {},
            'first_seen': item.get('at') or '',
            'last_seen': item.get('at') or '',
            'latest_raw': item.get('raw') or '',
        })
        row['count'] += 1
        row['users'][item.get('user') or 'unknown'] = row['users'].get(item.get('user') or 'unknown', 0) + 1
        row['last_seen'] = item.get('at') or row['last_seen']
        row['latest_raw'] = item.get('raw') or row['latest_raw']
    top = sorted(summary.values(), key=lambda r: r['count'], reverse=True)
    for row in top:
        row['users'] = [{'user': k, 'count': v} for k, v in sorted(row['users'].items(), key=lambda kv: kv[1], reverse=True)]
    return {
        'events': events[-limit:][::-1],
        'summary': top[:100],
        'total': len(events),
        'errors': errors[:3],
        'window': '24 hours',
    }


def _crowdsec_add_block(ip, duration='24h', reason='manual ssh brute-force block from Ascend', blocked_by='ascend'):
    cscli = shutil.which('cscli')
    if not cscli:
        return False, 'cscli is not installed.'
    if not _valid_public_ip(ip):
        return False, 'Only public IP addresses can be blocked.'
    duration = re.sub(r'[^0-9smhdw]', '', str(duration or '24h')) or '24h'
    reason = str(reason or 'manual block from Ascend')[:160]
    cmd = [cscli, 'decisions', 'add', '--ip', ip, '--duration', duration, '--reason', reason]
    rc, out, err = _run(cmd, timeout=12)
    if rc != 0:
        return False, err or out or 'Could not add CrowdSec decision.'
    state = _load_json(STATE_PATH, {})
    history = state.get('crowdsec_block_history') if isinstance(state.get('crowdsec_block_history'), dict) else {}
    history[ip] = {
        'blocked_at': _now(),
        'duration': duration,
        'reason': reason,
        'blocked_by': blocked_by,
    }
    state['crowdsec_block_history'] = history
    _write_json(STATE_PATH, state)
    return True, out or 'Decision added.'


def _auto_block_ssh_repeat_attackers():
    state = _load_json(STATE_PATH, {})
    config = state.get('auto_ssh_block') if isinstance(state.get('auto_ssh_block'), dict) else {}
    enabled = config.get('enabled', True)
    threshold = max(2, min(int(config.get('threshold') or 5), 100))
    duration = str(config.get('duration') or '24h')
    result = {
        'enabled': bool(enabled),
        'threshold': threshold,
        'duration': duration,
        'blocked': [],
        'failed': [],
        'skipped': '',
        'checked_at': _now(),
    }
    if not enabled:
        result['skipped'] = 'Automatic SSH blocking is disabled.'
        state['auto_ssh_block_last'] = result
        _write_json(STATE_PATH, state)
        return result
    if shutil.which('cscli') is None:
        result['skipped'] = 'CrowdSec is not installed.'
        state['auto_ssh_block_last'] = result
        _write_json(STATE_PATH, state)
        return result

    failures = _ssh_failed_logins(2000)
    decisions = _crowdsec_decisions().get('items') or []
    already = {str(d.get('value')) for d in decisions if d.get('value')}
    recently_blocked = state.get('auto_ssh_block_recent') if isinstance(state.get('auto_ssh_block_recent'), dict) else {}
    current_keys = set()
    for row in failures.get('summary') or []:
        ip = row.get('ip')
        count = int(row.get('count') or 0)
        if not ip or count < threshold:
            continue
        current_keys.add(ip)
        if ip in already:
            continue
        if recently_blocked.get(ip) == row.get('latest_raw'):
            continue
        ok, message = _crowdsec_add_block(ip, duration, f'automatic ssh brute-force block: {count} failed logins in 24h', 'ascend-auto-ssh')
        if ok:
            result['blocked'].append({'ip': ip, 'count': count, 'message': message})
            recently_blocked[ip] = row.get('latest_raw') or _now()
        else:
            result['failed'].append({'ip': ip, 'count': count, 'error': message})
    state['auto_ssh_block_recent'] = {ip: marker for ip, marker in recently_blocked.items() if ip in current_keys}
    state['auto_ssh_block_last'] = result
    _write_json(STATE_PATH, state)
    if result['blocked'] or result['failed']:
        _audit_log(
            'security.ssh_auto_block',
            'ok' if not result['failed'] else 'failed',
            f'Automatic SSH blocker blocked {len(result["blocked"])} IP(s)',
            result,
        )
    return result


def _parse_iso(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except Exception:
        return None


def _auto_block_ssh_repeat_attackers_async():
    global _AUTO_SSH_BLOCK_RUNNING
    state = _load_json(STATE_PATH, {})
    last = state.get('auto_ssh_block_last') if isinstance(state.get('auto_ssh_block_last'), dict) else {}
    checked_at = _parse_iso(last.get('checked_at'))
    if checked_at:
        age = (datetime.now(timezone.utc) - checked_at).total_seconds()
        if age < AUTO_SSH_BLOCK_INTERVAL_SECONDS:
            return {**last, 'scheduled': False}
    with _AUTO_SSH_BLOCK_LOCK:
        if _AUTO_SSH_BLOCK_RUNNING:
            return {**last, 'scheduled': True, 'message': 'Automatic SSH blocker is already checking in the background.'}
        _AUTO_SSH_BLOCK_RUNNING = True

    def worker():
        global _AUTO_SSH_BLOCK_RUNNING
        try:
            _auto_block_ssh_repeat_attackers()
        finally:
            with _AUTO_SSH_BLOCK_LOCK:
                _AUTO_SSH_BLOCK_RUNNING = False

    threading.Thread(target=worker, daemon=True, name='ascend-auto-ssh-block').start()
    return {**last, 'scheduled': True, 'message': 'Automatic SSH blocker is checking in the background.'}


def _cached_threat_status():
    state = _load_json(STATE_PATH, {})
    cached = state.get('threat_status') if isinstance(state.get('threat_status'), dict) else None
    if cached:
        return {**cached, 'cached': True}
    return {'processes': [], 'process_error': '', 'persistence': [], 'immutable': [], 'checked_at': None, 'cached': True}


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
    auto_ssh_block = _auto_block_ssh_repeat_attackers_async()
    state = _load_json(STATE_PATH, {})
    clamscan = _tool_version('clamscan', ['--version'])
    freshclam = _tool_version('freshclam', ['--version'])
    cscli = _tool_version('cscli', ['version'])
    return {
        'server': {
            'platform': platform.platform(),
            'linux': platform.system().lower() == 'linux',
            'is_root': (hasattr(os, 'geteuid') and os.geteuid() == 0),
        },
        'tools': {
            'clamscan': clamscan,
            'freshclam': freshclam,
            'crowdsec': _crowdsec_version(),
            'cscli': cscli,
            'crowdsec_service': _service_active('crowdsec.service'),
            'crowdsec_firewall_bouncer_service': _service_active_any(BOUNCER_SERVICE_CANDIDATES),
            'crowdsec_decisions': _cached_crowdsec_decisions(),
            'clamav_freshclam_service': _service_active('clamav-freshclam.service'),
            'clamav_daemon_service': _service_active('clamav-daemon.service'),
            'definitions': _freshclam_status(),
        },
        'state': state,
        'auto_ssh_block': auto_ssh_block,
        'threats': _cached_threat_status(),
        'scan_paths': _scan_paths(),
        'logs': {
            'scan': str(SCAN_LOG_PATH),
            'install': str(INSTALL_LOG_PATH),
            'crowdsec': str(CROWDSEC_LOG_PATH),
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
    global BASE_DIR, DEPLOYMENTS_DIR, STATIC_SITES_DIR, SECURITY_DIR, STATE_PATH, SCAN_LOG_PATH, INSTALL_LOG_PATH, CROWDSEC_LOG_PATH, QUARANTINE_DIR
    global _admin_required, _audit_log, _notify_email_async
    BASE_DIR = Path(base_dir)
    DEPLOYMENTS_DIR = Path(deployments_dir)
    STATIC_SITES_DIR = Path(static_sites_dir)
    SECURITY_DIR = BASE_DIR / 'security'
    STATE_PATH = SECURITY_DIR / 'security-state.json'
    SCAN_LOG_PATH = SECURITY_DIR / 'scan.log'
    INSTALL_LOG_PATH = SECURITY_DIR / 'install.log'
    CROWDSEC_LOG_PATH = SECURITY_DIR / 'crowdsec-install.log'
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


@bp.route('/api/security/crowdsec/install/start', methods=['POST'])
@login_required
def api_security_crowdsec_install_start():
    gate = _admin_required()
    if gate:
        return gate
    state = _load_json(STATE_PATH, {})
    if (state.get('crowdsec_install') or {}).get('status') == 'running':
        return jsonify({'message': 'CrowdSec install is already running.', 'state': state})
    state['crowdsec_install'] = {'status': 'starting', 'started_at': _now(), 'message': 'Starting CrowdSec install...'}
    _write_json(STATE_PATH, state)
    launch = _spawn_worker(['install-crowdsec', '--state', str(STATE_PATH), '--log', str(CROWDSEC_LOG_PATH)], CROWDSEC_LOG_PATH)
    state['crowdsec_install']['pid'] = launch['pid']
    _write_json(STATE_PATH, state)
    _audit_log('security.crowdsec_install_started', 'ok', 'CrowdSec install started', {'pid': launch['pid']})
    return jsonify({'message': 'CrowdSec install started.', 'pid': launch['pid']})


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
    path = CROWDSEC_LOG_PATH if kind == 'crowdsec' else INSTALL_LOG_PATH if kind == 'install' else SCAN_LOG_PATH
    return jsonify({'kind': kind, 'path': str(path), 'log': _tail(path)})


@bp.route('/api/security/crowdsec/decisions', methods=['DELETE'])
@login_required
def api_security_crowdsec_decision_delete():
    gate = _admin_required()
    if gate:
        return gate
    data = request.get_json(silent=True) or {}
    value = str(data.get('value') or '').strip()
    decision_id = str(data.get('id') or '').strip()
    cscli = shutil.which('cscli')
    if not cscli:
        return jsonify({'error': 'cscli is not installed.'}), 400
    if decision_id:
        cmd = [cscli, 'decisions', 'delete', '--id', decision_id]
    elif value:
        cmd = [cscli, 'decisions', 'delete', '--ip', value]
    else:
        return jsonify({'error': 'Decision id or IP value is required.'}), 400
    rc, out, err = _run(cmd, timeout=10)
    if rc != 0:
        return jsonify({'error': err or out or 'Could not delete CrowdSec decision.'}), 500
    _audit_log('security.crowdsec_decision_deleted', 'ok', f'CrowdSec decision removed: {value or decision_id}', {'id': decision_id, 'value': value})
    return jsonify({'message': 'CrowdSec decision removed.', 'output': out})


@bp.route('/api/security/ssh-failures')
@login_required
def api_security_ssh_failures():
    limit = request.args.get('limit', 500)
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 500
    return jsonify(_ssh_failed_logins(limit))


@bp.route('/api/security/crowdsec/block', methods=['POST'])
@login_required
def api_security_crowdsec_block():
    gate = _admin_required()
    if gate:
        return gate
    data = request.get_json(silent=True) or {}
    ip = str(data.get('ip') or '').strip()
    duration = str(data.get('duration') or '24h').strip()
    reason = str(data.get('reason') or 'manual ssh brute-force block from Ascend').strip()
    ok, message = _crowdsec_add_block(ip, duration, reason, 'ascend-manual')
    if not ok:
        return jsonify({'error': message}), 400
    _audit_log('security.crowdsec_ip_blocked', 'ok', f'CrowdSec block added: {ip}', {'ip': ip, 'duration': duration, 'reason': reason})
    return jsonify({'message': f'{ip} blocked for {duration}.', 'output': message})


@bp.route('/api/security/ssh-failures/block-repeat', methods=['POST'])
@login_required
def api_security_ssh_failures_block_repeat():
    gate = _admin_required()
    if gate:
        return gate
    data = request.get_json(silent=True) or {}
    try:
        threshold = max(2, min(int(data.get('threshold') or 5), 100))
    except (TypeError, ValueError):
        threshold = 5
    duration = str(data.get('duration') or '24h').strip()
    failures = _ssh_failed_logins(2000)
    decisions = _crowdsec_decisions().get('items') or []
    already = {str(d.get('value')) for d in decisions if d.get('value')}
    blocked = []
    failed = []
    for row in failures.get('summary') or []:
        ip = row.get('ip')
        if not ip or ip in already or int(row.get('count') or 0) < threshold:
            continue
        ok, message = _crowdsec_add_block(ip, duration, f'ssh brute-force: {row.get("count")} failed logins in 24h', 'ascend-bulk-ssh')
        if ok:
            blocked.append({'ip': ip, 'count': row.get('count'), 'message': message})
        else:
            failed.append({'ip': ip, 'count': row.get('count'), 'error': message})
    _audit_log('security.ssh_repeat_blocked', 'ok' if not failed else 'failed', f'Blocked {len(blocked)} repeat SSH attacker(s)', {'blocked': blocked, 'failed': failed, 'threshold': threshold, 'duration': duration})
    return jsonify({'message': f'Blocked {len(blocked)} repeat SSH attacker(s).', 'blocked': blocked, 'failed': failed, 'threshold': threshold})


@bp.route('/api/security/threats')
@login_required
def api_security_threats():
    status = _threat_status()
    state = _load_json(STATE_PATH, {})
    state['threat_status'] = status
    _write_json(STATE_PATH, state)
    return jsonify(status)


@bp.route('/api/security/threats/kill', methods=['POST'])
@login_required
def api_security_threat_kill():
    gate = _admin_required()
    if gate:
        return gate
    data = request.get_json(silent=True) or {}
    pid = str(data.get('pid') or '').strip()
    if not pid.isdigit():
        return jsonify({'error': 'PID is required.'}), 400
    threats = _scan_threat_processes().get('items') or []
    if not any(str(p.get('pid')) == pid for p in threats):
        return jsonify({'error': 'PID is not currently recognized as a miner/suspicious process.'}), 400
    rc, out, err = _run(['kill', '-9', pid], timeout=5)
    if rc != 0:
        return jsonify({'error': err or out or 'Could not kill process.'}), 500
    _audit_log('security.threat_process_killed', 'ok', f'Killed suspicious process {pid}', {'pid': pid})
    return jsonify({'message': f'Process {pid} killed.'})


@bp.route('/api/security/threats/file', methods=['DELETE'])
@login_required
def api_security_threat_file_delete():
    gate = _admin_required()
    if gate:
        return gate
    data = request.get_json(silent=True) or {}
    path = Path(str(data.get('path') or ''))
    allowed_roots = [
        Path('/root'),
        Path('/tmp'),
        Path('/var/tmp'),
        Path('/home'),
        Path('/etc/cron.d'),
        Path('/etc/cron.daily'),
        Path('/etc/cron.hourly'),
        Path('/etc/cron.weekly'),
        Path('/etc/cron.monthly'),
        Path('/var/spool/cron'),
        Path('/etc/systemd'),
        Path('/lib/systemd'),
    ]
    try:
        resolved = path.resolve()
    except Exception:
        return jsonify({'error': 'Invalid path.'}), 400
    if not any(str(resolved).startswith(str(root)) for root in allowed_roots):
        return jsonify({'error': 'This path is not in an allowed threat cleanup location.'}), 400
    if not resolved.exists() or not resolved.is_file():
        return jsonify({'error': 'File not found.'}), 404
    protected_roots = [Path('/etc'), Path('/lib/systemd'), Path('/var/spool/cron')]
    if any(str(resolved).startswith(str(root)) for root in protected_roots) and not _is_cleanup_backup(resolved):
        return jsonify({'error': 'System cron/systemd files can only be deleted here when they are Ascend cleanup backups. Remove malicious lines from live files instead.'}), 400
    if not THREAT_RE.search(str(resolved)) and not any(THREAT_RE.search(line) for line in _safe_read_lines(resolved)):
        return jsonify({'error': 'File does not match current threat indicators.'}), 400
    try:
        resolved.unlink()
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500
    _audit_log('security.threat_file_deleted', 'ok', f'Deleted suspicious file {resolved}', {'path': str(resolved)})
    return jsonify({'message': f'Deleted {resolved}.'})


@bp.route('/api/security/threats/persistence-line', methods=['DELETE'])
@login_required
def api_security_threat_persistence_line_delete():
    gate = _admin_required()
    if gate:
        return gate
    data = request.get_json(silent=True) or {}
    path = Path(str(data.get('path') or ''))
    line_no = data.get('line')
    allowed_roots = [
        Path('/etc/cron.d'),
        Path('/etc/cron.daily'),
        Path('/etc/cron.hourly'),
        Path('/etc/cron.weekly'),
        Path('/etc/cron.monthly'),
        Path('/var/spool/cron'),
        Path('/root'),
        Path('/home'),
        Path('/etc/systemd'),
        Path('/lib/systemd'),
    ]
    try:
        resolved = path.resolve()
    except Exception:
        return jsonify({'error': 'Invalid path.'}), 400
    if not any(str(resolved).startswith(str(root)) for root in allowed_roots):
        return jsonify({'error': 'This path is not in an allowed persistence location.'}), 400
    lines = _safe_read_lines(resolved, max_bytes=5 * 1024 * 1024)
    try:
        idx = int(line_no) - 1
    except (TypeError, ValueError):
        return jsonify({'error': 'Line number is required.'}), 400
    if idx < 0 or idx >= len(lines) or not THREAT_RE.search(lines[idx]):
        return jsonify({'error': 'Selected line no longer matches threat indicators.'}), 400
    try:
        removed, backup = _remove_line_from_file(resolved, int(line_no))
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500
    cleanup_results = _post_persistence_cleanup(resolved)
    _audit_log('security.threat_persistence_removed', 'ok', f'Removed suspicious persistence from {resolved}:{line_no}', {'path': str(resolved), 'line': line_no, 'removed': removed, 'backup': backup, 'cleanup_results': cleanup_results})
    return jsonify({'message': 'Persistence line removed.', 'backup': backup, 'removed': removed, 'cleanup_results': cleanup_results})


@bp.route('/api/security/threats/immutable', methods=['DELETE'])
@login_required
def api_security_threat_immutable_remove():
    gate = _admin_required()
    if gate:
        return gate
    data = request.get_json(silent=True) or {}
    path = str(data.get('path') or '').strip()
    if path not in {'/var/spool/cron/crontabs/root', '/var/spool/cron/root', '/root/.config/.logrotate'}:
        return jsonify({'error': 'This immutable path is not allowed for automatic repair.'}), 400
    chattr = shutil.which('chattr')
    if not chattr:
        return jsonify({'error': 'chattr is not installed.'}), 400
    rc, out, err = _run([chattr, '-i', path], timeout=8)
    if rc != 0:
        return jsonify({'error': err or out or 'Could not remove immutable flag.'}), 500
    _audit_log('security.immutable_removed', 'ok', f'Removed immutable flag from {path}', {'path': path})
    return jsonify({'message': f'Immutable flag removed from {path}.'})


@bp.route('/api/security/repair', methods=['POST'])
@login_required
def api_security_repair():
    gate = _admin_required()
    if gate:
        return gate
    data = request.get_json(silent=True) or {}
    action = str(data.get('action') or '').strip()
    systemctl = shutil.which('systemctl')
    apt_get = shutil.which('apt-get')
    bouncer_unit = _first_existing_service(BOUNCER_SERVICE_CANDIDATES)
    bouncer_steps = []
    if apt_get and not any(_systemd_unit_exists(name) for name in BOUNCER_SERVICE_CANDIDATES):
        bouncer_steps.extend([
            [apt_get, 'update'],
            [apt_get, 'install', '-y', 'crowdsec-firewall-bouncer-iptables'],
        ])
        bouncer_unit = _first_existing_service(BOUNCER_SERVICE_CANDIDATES)
    if systemctl:
        bouncer_steps.extend([
            [systemctl, 'enable', '--now', bouncer_unit],
            [systemctl, 'restart', bouncer_unit],
        ])
    actions = {
        'clamav_restart_updates': {
            'label': 'Restart ClamAV updater',
            'steps': [[systemctl, 'restart', 'clamav-freshclam.service']] if systemctl else [],
        },
        'clamav_update_definitions': {
            'label': 'Update ClamAV definitions',
            'steps': (
                [[systemctl, 'stop', 'clamav-freshclam.service'], [shutil.which('freshclam') or 'freshclam'], [systemctl, 'start', 'clamav-freshclam.service']]
                if systemctl else [[shutil.which('freshclam') or 'freshclam']]
            ),
            'timeout': 180,
        },
        'clamav_restart_daemon': {
            'label': 'Restart ClamAV daemon',
            'steps': [[systemctl, 'restart', 'clamav-daemon.service']] if systemctl else [],
        },
        'crowdsec_restart': {
            'label': 'Restart CrowdSec',
            'steps': [[systemctl, 'restart', 'crowdsec.service']] if systemctl else [],
        },
        'crowdsec_bouncer_restart': {
            'label': 'Repair CrowdSec firewall bouncer',
            'steps': bouncer_steps,
        },
        'crowdsec_collections': {
            'label': 'Install core CrowdSec collections',
            'steps': [
                [shutil.which('cscli') or 'cscli', 'hub', 'update'],
                [shutil.which('cscli') or 'cscli', 'collections', 'install', 'crowdsecurity/linux', 'crowdsecurity/sshd', 'crowdsecurity/nginx'],
                *([[systemctl, 'restart', 'crowdsec.service']] if systemctl else []),
            ],
            'timeout': 90,
        },
        'clear_failed_state': {
            'label': 'Clear failed install state',
            'steps': [],
        },
    }
    spec = actions.get(action)
    if not spec:
        return jsonify({'error': 'Unknown repair action.'}), 400
    if action == 'clear_failed_state':
        state = _load_json(STATE_PATH, {})
        for key in ('install', 'crowdsec_install'):
            if isinstance(state.get(key), dict) and state[key].get('status') in {'failed', 'success'}:
                state[key]['status'] = 'idle'
        _write_json(STATE_PATH, state)
        _audit_log('security.repair', 'ok', spec['label'], {'action': action})
        return jsonify({'message': 'Security install state cleared.', 'results': []})
    steps = [s for s in spec.get('steps') or [] if s and s[0]]
    if not steps:
        return jsonify({'error': 'This repair needs systemctl or the required tool, but it was not found.'}), 400
    ok, results = _run_repair_steps(steps, timeout=spec.get('timeout', 45))
    status = 'ok' if ok else 'failed'
    _audit_log('security.repair', status, spec['label'], {'action': action, 'results': results})
    if not ok:
        return jsonify({'error': f'{spec["label"]} failed.', 'results': results}), 500
    return jsonify({'message': f'{spec["label"]} completed.', 'results': results})


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
