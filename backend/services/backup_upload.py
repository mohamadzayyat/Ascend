import base64
import hashlib
import hmac
import http.client
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
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
        's3_bucket': '',
        's3_region': 'us-east-1',
        's3_prefix': 'database-backups',
        's3_access_key_id': '',
        'include_link_in_success_email': True,
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
    for k in (
        'enabled',
        'provider',
        'webdav_url',
        'username',
        'remote_path',
        's3_bucket',
        's3_region',
        's3_prefix',
        's3_access_key_id',
        'include_link_in_success_email',
    ):
        if k in parsed:
            d[k] = parsed[k]
    if d.get('provider') not in ('webdav', 's3'):
        d['provider'] = 'webdav'
    pwd_enc = parsed.get('password_encrypted') or ''
    d['password_error'] = ''
    try:
        d['password'] = _decrypt_password(pwd_enc) if pwd_enc else ''
    except Exception as exc:
        d['password'] = ''
        d['password_error'] = 'Stored backup upload password could not be decrypted. Re-enter it and save.'
        print(f'[backup-upload] stored password decrypt failed: {exc}', file=sys.stderr)
    s3_secret_enc = parsed.get('s3_secret_access_key_encrypted') or ''
    d['s3_secret_access_key_error'] = ''
    try:
        d['s3_secret_access_key'] = _decrypt_password(s3_secret_enc) if s3_secret_enc else ''
    except Exception as exc:
        d['s3_secret_access_key'] = ''
        d['s3_secret_access_key_error'] = 'Stored S3 secret access key could not be decrypted. Re-enter it and save.'
        print(f'[backup-upload] stored S3 secret decrypt failed: {exc}', file=sys.stderr)
    return d


def _backup_upload_settings_to_api_dict(full):
    out = {k: v for k, v in full.items() if k not in ('password', 's3_secret_access_key')}
    out['has_password'] = bool(full.get('password'))
    out['has_s3_secret_access_key'] = bool(full.get('s3_secret_access_key'))
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
        body = ''
        try:
            body = (exc.read() or b'').decode('utf-8', errors='replace')
        except Exception:
            body = ''
        detail = re.sub(r'\s+', ' ', body).strip() or exc.reason or f'HTTP {exc.code}'
        raise RuntimeError(f'WebDAV {method} failed ({exc.code}): {detail[:1000]}') from exc


def _backup_content_type(filename):
    lower = str(filename or '').lower()
    if lower.endswith('.zip'):
        return 'application/zip'
    if lower.endswith('.txt'):
        return 'text/plain; charset=utf-8'
    return 'application/sql'


def _s3_object_key(settings, filename):
    prefix = (settings.get('s3_prefix') or '').strip().strip('/')
    safe_name = Path(str(filename or '')).name
    if not safe_name:
        raise ValueError('Backup filename is missing.')
    return '/'.join([p for p in (prefix, safe_name) if p])


def _s3_signature_key(secret_key, date_stamp, region, service):
    key = ('AWS4' + secret_key).encode('utf-8')
    for msg in (date_stamp, region, service, 'aws4_request'):
        key = hmac.new(key, msg.encode('utf-8'), hashlib.sha256).digest()
    return key


def _s3_file_sha256(filepath):
    digest = hashlib.sha256()
    with open(filepath, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _s3_upload(filepath, filename, settings):
    bucket = (settings.get('s3_bucket') or '').strip()
    region = (settings.get('s3_region') or '').strip() or 'us-east-1'
    access_key = (settings.get('s3_access_key_id') or '').strip()
    secret_key = settings.get('s3_secret_access_key') or ''
    if not bucket or not region or not access_key or not secret_key:
        raise ValueError('Backup upload is enabled but S3 bucket, region, access key, or secret access key is missing.')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{1,61}[A-Za-z0-9]', bucket):
        raise ValueError('S3 bucket name is invalid.')
    if not re.fullmatch(r'[a-z0-9-]+', region):
        raise ValueError('S3 region is invalid.')

    key = _s3_object_key(settings, filename)
    encoded_key = quote(key, safe='/~')
    if '.' in bucket:
        host = f's3.{region}.amazonaws.com'
        canonical_uri = f'/{quote(bucket, safe="")}/{encoded_key}'
    else:
        host = f'{bucket}.s3.{region}.amazonaws.com'
        canonical_uri = f'/{encoded_key}'
    now = datetime.now(timezone.utc)
    amz_date = now.strftime('%Y%m%dT%H%M%SZ')
    date_stamp = now.strftime('%Y%m%d')
    payload_hash = _s3_file_sha256(filepath)
    content_type = _backup_content_type(filename)
    content_length = os.path.getsize(filepath)

    canonical_headers = (
        f'host:{host}\n'
        f'x-amz-content-sha256:{payload_hash}\n'
        f'x-amz-date:{amz_date}\n'
    )
    signed_headers = 'host;x-amz-content-sha256;x-amz-date'
    canonical_request = '\n'.join([
        'PUT',
        canonical_uri,
        '',
        canonical_headers,
        signed_headers,
        payload_hash,
    ])
    credential_scope = f'{date_stamp}/{region}/s3/aws4_request'
    string_to_sign = '\n'.join([
        'AWS4-HMAC-SHA256',
        amz_date,
        credential_scope,
        hashlib.sha256(canonical_request.encode('utf-8')).hexdigest(),
    ])
    signature = hmac.new(
        _s3_signature_key(secret_key, date_stamp, region, 's3'),
        string_to_sign.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()
    authorization = (
        f'AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, '
        f'SignedHeaders={signed_headers}, Signature={signature}'
    )
    headers = {
        'Authorization': authorization,
        'Content-Length': str(content_length),
        'Content-Type': content_type,
        'Host': host,
        'x-amz-content-sha256': payload_hash,
        'x-amz-date': amz_date,
    }

    conn = http.client.HTTPSConnection(host, timeout=120)
    try:
        with open(filepath, 'rb') as fh:
            conn.request('PUT', canonical_uri, body=fh, headers=headers)
            resp = conn.getresponse()
            body = resp.read(4096).decode('utf-8', errors='replace')
        if resp.status >= 300:
            detail = body.strip() or resp.reason or f'HTTP {resp.status}'
            raise RuntimeError(f'S3 upload failed ({resp.status}): {detail[:1000]}')
    finally:
        conn.close()
    return f's3://{bucket}/{key}'


def _upload_backup_to_remote(filepath, filename, *, force=False):
    settings = _backup_upload_settings_load()
    if not force and not settings.get('enabled'):
        return None
    provider = (settings.get('provider') or 'webdav').strip().lower()
    if provider == 's3':
        return _s3_upload(filepath, filename, settings)
    if provider != 'webdav':
        raise ValueError(f'Unsupported backup upload provider: {provider}')
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
    content_type = _backup_content_type(filename)
    with open(filepath, 'rb') as fh:
        _webdav_request('PUT', target, username, password, data=fh.read(), content_type=content_type)
    return target
