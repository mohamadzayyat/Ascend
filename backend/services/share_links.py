import json
import os
import secrets
import shutil
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from flask import after_this_request, jsonify, send_file


_db = None
_AppSetting = None
_setting_key = None

MAX_SHARE_HOURS = 168
DEFAULT_SHARE_HOURS = 24
SENSITIVE_NAMES = {
    '.env', '.env.local', '.env.production', '.env.prod', '.env.development',
    'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'authorized_keys',
    'known_hosts', 'shadow', 'passwd-', 'master.key',
}
SENSITIVE_SUFFIXES = ('.pem', '.key', '.p12', '.pfx', '.jks', '.kdb')


def init_share_links(*, db, app_setting_model, setting_key):
    global _db, _AppSetting, _setting_key
    _db = db
    _AppSetting = app_setting_model
    _setting_key = setting_key


def _utc_now_ts():
    return int(time.time())


def _iso_from_ts(ts):
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()


def _load_links():
    rec = _db.session.get(_AppSetting, _setting_key)
    if not rec or not rec.value:
        return {}
    try:
        data = json.loads(rec.value)
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _save_links(links):
    rec = _db.session.get(_AppSetting, _setting_key)
    payload = json.dumps(links, separators=(',', ':'))
    if rec is None:
        rec = _AppSetting(key=_setting_key, value=payload)
        _db.session.add(rec)
    else:
        rec.value = payload
    _db.session.commit()


def _pruned_links(links):
    now = _utc_now_ts()
    return {
        token: item for token, item in (links or {}).items()
        if isinstance(item, dict) and int(item.get('expires_at') or 0) > now
    }


def _bounded_hours(value):
    try:
        hours = int(value or DEFAULT_SHARE_HOURS)
    except (TypeError, ValueError):
        hours = DEFAULT_SHARE_HOURS
    return max(1, min(hours, MAX_SHARE_HOURS))


def _is_sensitive_path(path):
    p = Path(path)
    for part in p.parts:
        lower = part.lower()
        if lower in SENSITIVE_NAMES or lower.endswith(SENSITIVE_SUFFIXES):
            return True
    return False


def _folder_contains_sensitive_path(path):
    checked = 0
    for root, dirs, files in os.walk(str(path)):
        names = list(dirs) + list(files)
        for name in names:
            checked += 1
            if _is_sensitive_path(Path(root) / name):
                return True
            if checked > 10000:
                return True
    return False


def _safe_download_name(name, fallback):
    safe = Path(str(name or fallback)).name.strip()
    return safe or fallback


def create_share_link(path, *, download_name=None, title=None, expires_hours=None, allow_sensitive=False):
    resolved = Path(path).resolve()
    if not resolved.exists():
        raise ValueError('File or folder is not available.')
    if not allow_sensitive:
        if _is_sensitive_path(resolved):
            raise ValueError('This file looks sensitive and cannot be shared with a public link.')
        if resolved.is_dir() and _folder_contains_sensitive_path(resolved):
            raise ValueError('This folder contains sensitive-looking files and cannot be shared with a public link.')
    hours = _bounded_hours(expires_hours)
    token = secrets.token_urlsafe(32)
    expires_at = _utc_now_ts() + (hours * 3600)
    name = _safe_download_name(download_name or resolved.name, 'shared-file')
    if resolved.is_dir() and not name.lower().endswith('.zip'):
        name = f'{name}.zip'
    links = _pruned_links(_load_links())
    links[token] = {
        'path': str(resolved),
        'download_name': name,
        'title': str(title or name)[:255],
        'is_dir': resolved.is_dir(),
        'created_at': _utc_now_ts(),
        'expires_at': expires_at,
    }
    _save_links(links)
    return {
        'token': token,
        'expires_at': _iso_from_ts(expires_at),
        'download_name': name,
        'hours': hours,
    }


def public_share_download(token):
    token = str(token or '').strip()
    links = _pruned_links(_load_links())
    item = links.get(token)
    if not item:
        _save_links(links)
        return jsonify({'error': 'Share link is expired or not found.'}), 404
    path = Path(item.get('path') or '').resolve()
    if not path.exists():
        links.pop(token, None)
        _save_links(links)
        return jsonify({'error': 'Shared file is no longer available.'}), 410
    name = _safe_download_name(item.get('download_name') or path.name, 'shared-file')
    if item.get('is_dir'):
        temp_dir = tempfile.mkdtemp(prefix='ascend-share-')
        zip_path = Path(temp_dir) / name
        with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
            for root, _dirs, files in os.walk(str(path)):
                for filename in files:
                    src = Path(root) / filename
                    try:
                        src.relative_to(path)
                    except ValueError:
                        continue
                    zf.write(src, src.relative_to(path.parent).as_posix())

        @after_this_request
        def _cleanup(response):
            shutil.rmtree(temp_dir, ignore_errors=True)
            return response

        return send_file(str(zip_path), as_attachment=True, download_name=name)
    return send_file(str(path), as_attachment=True, download_name=name)
