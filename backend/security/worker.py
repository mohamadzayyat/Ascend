import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def _now():
    return datetime.now(timezone.utc).isoformat()


def _write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, indent=2), encoding='utf-8')
    tmp.replace(path)


def _append_log(path, line):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a', encoding='utf-8', errors='replace') as fh:
        fh.write(line)
        if not line.endswith('\n'):
            fh.write('\n')


def _safe_quarantine_name(source):
    raw = str(source).strip().replace('\\', '/')
    safe = re.sub(r'[^A-Za-z0-9._-]+', '_', raw).strip('._')
    return safe[-180:] or 'infected-file'


def _parse_clamav_findings(output):
    findings = []
    for line in output.splitlines():
        if ' FOUND' not in line:
            continue
        left, _, _ = line.rpartition(' FOUND')
        path, sep, signature = left.rpartition(': ')
        if not sep:
            path, signature = left, 'Malware detected'
        findings.append({
            'path': path.strip(),
            'signature': signature.strip() or 'Malware detected',
            'severity': 'critical',
            'detected_at': _now(),
        })
    return findings


def _load_state(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except Exception:
        return {}


def install_clamav(args):
    state = {
        'install': {
            'status': 'running',
            'started_at': _now(),
            'finished_at': None,
            'message': 'Installing ClamAV packages...',
        }
    }
    _write_json(args.state, state)
    Path(args.log).write_text('', encoding='utf-8')

    if platform.system().lower() != 'linux':
        state['install'].update({
            'status': 'failed',
            'finished_at': _now(),
            'message': 'ClamAV auto-install is only available on Linux servers.',
        })
        _write_json(args.state, state)
        _append_log(args.log, state['install']['message'])
        return 1

    if shutil.which('apt-get') is None:
        state['install'].update({
            'status': 'failed',
            'finished_at': _now(),
            'message': 'apt-get was not found. Install clamav and clamav-daemon manually.',
        })
        _write_json(args.state, state)
        _append_log(args.log, state['install']['message'])
        return 1

    commands = [
        ['apt-get', 'update'],
        ['apt-get', 'install', '-y', 'clamav', 'clamav-daemon'],
        ['freshclam'],
        ['systemctl', 'enable', '--now', 'clamav-freshclam'],
    ]
    if shutil.which('systemctl') is None:
        commands = commands[:-1]

    rc = 0
    for cmd in commands:
        _append_log(args.log, f'$ {" ".join(cmd)}')
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors='replace')
        for line in proc.stdout or []:
            _append_log(args.log, line.rstrip('\n'))
        proc.wait()
        if proc.returncode not in (0,):
            # freshclam may fail if the daemon already owns the lock; keep going when clamscan exists.
            if cmd[0] == 'freshclam' and shutil.which('clamscan'):
                _append_log(args.log, 'freshclam returned non-zero; continuing because clamscan is installed.')
                continue
            rc = proc.returncode
            break

    ok = rc == 0 and shutil.which('clamscan') is not None
    state['install'].update({
        'status': 'success' if ok else 'failed',
        'finished_at': _now(),
        'message': 'ClamAV is installed.' if ok else 'ClamAV install failed. Review the install log.',
    })
    _write_json(args.state, state)
    return 0 if ok else (rc or 1)


def scan(args):
    paths = [p for p in (args.paths or []) if p]
    state = {
        'scan': {
            'status': 'running',
            'started_at': _now(),
            'finished_at': None,
            'paths': paths,
            'findings': [],
            'message': 'Scanning...',
            'returncode': None,
        }
    }
    _write_json(args.state, state)
    Path(args.log).write_text('', encoding='utf-8')

    clamscan = shutil.which('clamscan')
    if not clamscan:
        state['scan'].update({
            'status': 'failed',
            'finished_at': _now(),
            'message': 'clamscan is not installed. Install ClamAV first.',
            'returncode': 127,
        })
        _write_json(args.state, state)
        _append_log(args.log, state['scan']['message'])
        return 127

    existing = [p for p in paths if Path(p).exists()]
    missing = [p for p in paths if not Path(p).exists()]
    for p in missing:
        _append_log(args.log, f'Skipping missing path: {p}')
    if not existing:
        state['scan'].update({
            'status': 'failed',
            'finished_at': _now(),
            'message': 'No selected scan paths exist on this server.',
            'returncode': 2,
        })
        _write_json(args.state, state)
        _append_log(args.log, state['scan']['message'])
        return 2

    cmd = [
        clamscan,
        '--recursive',
        '--infected',
        '--no-summary',
        '--exclude-dir=/.git$',
        '--exclude-dir=/node_modules$',
    ] + existing
    _append_log(args.log, f'$ {" ".join(cmd)}')
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors='replace')
    collected = []
    for line in proc.stdout or []:
        collected.append(line)
        _append_log(args.log, line.rstrip('\n'))
    proc.wait()

    output = ''.join(collected)
    findings = _parse_clamav_findings(output)
    quarantine_records = []
    if args.quarantine and findings:
        qdir = Path(args.quarantine_dir)
        qdir.mkdir(parents=True, exist_ok=True)
        for item in findings:
            src = Path(item['path'])
            if not src.exists() or not src.is_file():
                item['quarantine_status'] = 'not_moved'
                continue
            target = qdir / f'{datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")}-{_safe_quarantine_name(src)}'
            try:
                shutil.move(str(src), str(target))
                item['quarantine_status'] = 'moved'
                item['quarantine_path'] = str(target)
                quarantine_records.append({
                    'original_path': str(src),
                    'quarantine_path': str(target),
                    'signature': item['signature'],
                    'moved_at': _now(),
                })
            except Exception as exc:
                item['quarantine_status'] = 'failed'
                item['quarantine_error'] = str(exc)

    previous = _load_state(args.state)
    status = 'success'
    message = 'No malware detected.'
    if findings:
        status = 'infected'
        message = f'{len(findings)} infected file(s) detected.'
    if proc.returncode not in (0, 1):
        status = 'failed'
        message = 'ClamAV scan failed. Review the scan log.'

    previous['scan'] = {
        'status': status,
        'started_at': state['scan']['started_at'],
        'finished_at': _now(),
        'paths': paths,
        'findings': findings,
        'message': message,
        'returncode': proc.returncode,
    }
    previous['findings'] = (findings + previous.get('findings', []))[:500]
    previous['quarantine'] = (quarantine_records + previous.get('quarantine', []))[:500]
    _write_json(args.state, previous)
    _append_log(args.log, message)
    return proc.returncode


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='cmd', required=True)

    p_install = sub.add_parser('install')
    p_install.add_argument('--state', required=True)
    p_install.add_argument('--log', required=True)

    p_scan = sub.add_parser('scan')
    p_scan.add_argument('--state', required=True)
    p_scan.add_argument('--log', required=True)
    p_scan.add_argument('--quarantine-dir', required=True)
    p_scan.add_argument('--quarantine', action='store_true')
    p_scan.add_argument('paths', nargs='*')

    args = parser.parse_args()
    if args.cmd == 'install':
        return install_clamav(args)
    if args.cmd == 'scan':
        return scan(args)
    return 2


if __name__ == '__main__':
    raise SystemExit(main())

