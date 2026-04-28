import base64
import json
from urllib import error as urlerror
from urllib import request as urlrequest
from urllib.parse import quote


_db = None
_AppSetting = None
_setting_key = None
_encrypt_password = None
_decrypt_password = None


def init_backup_upload(*, db, app_setting_model, setting_key, encrypt_password, decrypt_password):
    global _db, _AppSetting, _setting_key, _encrypt_password, _decrypt_password
    _db = db
    _AppSetting = app_setting_model
    _setting_key = setting_key
    _encrypt_password = encrypt_password
    _decrypt_password = decrypt_password


def _backup_upload_defaults():
    return {
        'enabled': False,
        'provider': 'webdav',
        'webdav_url': 'https://app.koofr.net/dav/Koofr/Ascend-Backups',
        'username': '',
        'remote_path': '',
    }


def _backup_upload_settings_load():
    d = _backup_upload_defaults()
    rec = _db.session.get(_AppSetting, _setting_key)
    if not rec or not rec.value:
        return d
    try:
        parsed = json.loads(rec.value)
    except (TypeError, ValueError):
        return d
    if not isinstance(parsed, dict):
        return d
    for k in ('enabled', 'provider', 'webdav_url', 'username', 'remote_path'):
        if k in parsed:
            d[k] = parsed[k]
    pwd_enc = parsed.get('password_encrypted') or ''
    d['password'] = _decrypt_password(pwd_enc) if pwd_enc else ''
    return d


def _backup_upload_settings_to_api_dict(full):
    out = {k: v for k, v in full.items() if k != 'password'}
    out['has_password'] = bool(full.get('password'))
    return out


def _webdav_join(base_url, *parts):
    base = (base_url or '').strip().rstrip('/')
    clean = [quote(str(p).strip('/')) for p in parts if str(p or '').strip('/')]
    return '/'.join([base, *clean])


def _webdav_request(method, url, username, password, data=None, content_type=None):
    req = urlrequest.Request(url, data=data, method=method)
    token = base64.b64encode(f'{username}:{password}'.encode('utf-8')).decode('ascii')
    req.add_header('Authorization', f'Basic {token}')
    if content_type:
        req.add_header('Content-Type', content_type)
    try:
        with urlrequest.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read()
    except urlerror.HTTPError as exc:
        if method == 'MKCOL' and exc.code in (405, 409):
            return exc.code, b''
        raise


def _upload_backup_to_remote(filepath, filename):
    settings = _backup_upload_settings_load()
    if not settings.get('enabled'):
        return None
    url = (settings.get('webdav_url') or '').strip()
    username = (settings.get('username') or '').strip()
    password = settings.get('password') or ''
    if not url or not username or not password:
        raise ValueError('Backup upload is enabled but WebDAV URL, username, or password is missing.')
    remote_path = (settings.get('remote_path') or '').strip().strip('/')
    _webdav_request('MKCOL', url.rstrip('/'), username, password)
    if remote_path:
        current = url.rstrip('/')
        for part in [p for p in remote_path.split('/') if p]:
            current = _webdav_join(current, part)
            _webdav_request('MKCOL', current, username, password)
    target = _webdav_join(url, remote_path, filename)
    with open(filepath, 'rb') as fh:
        _webdav_request('PUT', target, username, password, data=fh.read(), content_type='application/sql')
    return target
