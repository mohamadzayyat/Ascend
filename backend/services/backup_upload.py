import base64
import hashlib
import hmac
import http.client
import json
import os
import re
import ssl
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from urllib import error as urlerror
from urllib import request as urlrequest
from urllib.parse import quote, urlparse


_db = None
_AppSetting = None
_setting_key = None
_encrypt_password = None
_decrypt_password = None
_WEBDAV_UPLOAD_CHUNK_SIZE = 1024 * 1024
_WEBDAV_UPLOAD_TIMEOUT = 15 * 60
_WEBDAV_RETRY_DELAYS = (2, 6)
_S3_SINGLE_PUT_LIMIT = 5 * 1024 * 1024 * 1024
_S3_MULTIPART_THRESHOLD = 512 * 1024 * 1024
_S3_MIN_PART_SIZE = 5 * 1024 * 1024
_S3_DEFAULT_PART_SIZE = 128 * 1024 * 1024
_S3_MAX_PARTS = 10000
_S3_REQUEST_TIMEOUT = 30 * 60
_S3_RETRY_DELAYS = (2, 6, 15)
_EMPTY_SHA256 = hashlib.sha256(b'').hexdigest()


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


def _webdav_auth_header(username, password):
    token = base64.b64encode(f'{username}:{password}'.encode('utf-8')).decode('ascii')
    return f'Basic {token}'


def _webdav_request_path(parsed):
    path = parsed.path or '/'
    if parsed.query:
        path += f'?{parsed.query}'
    return path


def _webdav_connection(parsed, timeout):
    if parsed.scheme == 'https':
        return http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=timeout)
    if parsed.scheme == 'http':
        return http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=timeout)
    raise ValueError('WebDAV URL must start with http:// or https://.')


def _webdav_response_error(method, status, reason, body):
    detail = re.sub(r'\s+', ' ', (body or '').strip()) or reason or f'HTTP {status}'
    return RuntimeError(f'WebDAV {method} failed ({status}): {detail[:1000]}')


def _webdav_request(method, url, username, password, data=None, content_type=None):
    req = urlrequest.Request(url, data=data, method=method)
    req.add_header('Authorization', _webdav_auth_header(username, password))
    req.add_header('User-Agent', 'Ascend-Panel')
    if content_type:
        req.add_header('Content-Type', content_type)
    try:
        with urlrequest.urlopen(req, timeout=120) as resp:
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


def _webdav_transient_upload_error(exc):
    text = str(exc).lower()
    return (
        isinstance(exc, (ssl.SSLError, TimeoutError, ConnectionResetError, BrokenPipeError, http.client.HTTPException, OSError))
        and any(part in text for part in ('eof', 'timed out', 'timeout', 'reset', 'broken pipe', 'temporarily', 'connection aborted'))
    )


def _webdav_file_matches(url, username, password, expected_size):
    parsed = urlparse(url)
    conn = None
    try:
        conn = _webdav_connection(parsed, timeout=60)
        conn.request('HEAD', _webdav_request_path(parsed), headers={
            'Authorization': _webdav_auth_header(username, password),
            'User-Agent': 'Ascend-Panel',
        })
        resp = conn.getresponse()
        resp.read()
        if resp.status < 200 or resp.status >= 300:
            return False
        length = resp.getheader('Content-Length')
        if not length:
            return False
        try:
            return int(length) == int(expected_size)
        except (TypeError, ValueError):
            return False
    except Exception:
        return False
    finally:
        if conn:
            conn.close()


def _webdav_put_file(url, username, password, filepath, content_type):
    filepath = Path(filepath)
    size = filepath.stat().st_size
    parsed = urlparse(url)
    last_exc = None
    for attempt in range(len(_WEBDAV_RETRY_DELAYS) + 1):
        conn = None
        try:
            conn = _webdav_connection(parsed, timeout=_WEBDAV_UPLOAD_TIMEOUT)
            conn.putrequest('PUT', _webdav_request_path(parsed))
            conn.putheader('Authorization', _webdav_auth_header(username, password))
            conn.putheader('Content-Type', content_type)
            conn.putheader('Content-Length', str(size))
            conn.putheader('User-Agent', 'Ascend-Panel')
            conn.endheaders()
            with open(filepath, 'rb') as fh:
                for chunk in iter(lambda: fh.read(_WEBDAV_UPLOAD_CHUNK_SIZE), b''):
                    conn.send(chunk)
            resp = conn.getresponse()
            body = resp.read(4096).decode('utf-8', errors='replace')
            if 200 <= resp.status < 300:
                return resp.status, body.encode('utf-8')
            if resp.status >= 500 and attempt < len(_WEBDAV_RETRY_DELAYS):
                last_exc = _webdav_response_error('PUT', resp.status, resp.reason, body)
            else:
                raise _webdav_response_error('PUT', resp.status, resp.reason, body)
        except Exception as exc:
            last_exc = exc
            if _webdav_file_matches(url, username, password, size):
                return 200, b''
            if not _webdav_transient_upload_error(exc) or attempt >= len(_WEBDAV_RETRY_DELAYS):
                raise RuntimeError(f'WebDAV PUT failed after upload attempt {attempt + 1}: {exc}') from exc
        finally:
            if conn:
                conn.close()
        time.sleep(_WEBDAV_RETRY_DELAYS[attempt])
    raise RuntimeError(f'WebDAV PUT failed: {last_exc}')


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


def _aws_quote(value):
    return quote(str(value), safe='-_.~')


def _s3_canonical_query(params=None):
    items = []
    if params:
        for key, value in params:
            items.append((_aws_quote(key), _aws_quote(value)))
    items.sort()
    return '&'.join(f'{key}={value}' for key, value in items)


def _s3_target(bucket, region, key):
    encoded_key = quote(key, safe='/~')
    if '.' in bucket:
        return f's3.{region}.amazonaws.com', f'/{quote(bucket, safe="")}/{encoded_key}'
    return f'{bucket}.s3.{region}.amazonaws.com', f'/{encoded_key}'


def _s3_signed_headers(access_key, secret_key, region, method, host, canonical_uri, query_params, payload_hash):
    now = datetime.now(timezone.utc)
    amz_date = now.strftime('%Y%m%dT%H%M%SZ')
    date_stamp = now.strftime('%Y%m%d')
    canonical_headers = (
        f'host:{host}\n'
        f'x-amz-content-sha256:{payload_hash}\n'
        f'x-amz-date:{amz_date}\n'
    )
    signed_headers = 'host;x-amz-content-sha256;x-amz-date'
    canonical_request = '\n'.join([
        method,
        canonical_uri,
        _s3_canonical_query(query_params),
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
    return {
        'Authorization': (
            f'AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, '
            f'SignedHeaders={signed_headers}, Signature={signature}'
        ),
        'Host': host,
        'x-amz-content-sha256': payload_hash,
        'x-amz-date': amz_date,
    }


def _s3_transient_error(exc):
    text = str(exc).lower()
    return (
        isinstance(exc, (ssl.SSLError, TimeoutError, ConnectionResetError, BrokenPipeError, http.client.HTTPException, OSError))
        and any(part in text for part in ('eof', 'timed out', 'timeout', 'reset', 'broken pipe', 'temporarily', 'connection aborted'))
    )


def _s3_request(settings, method, key, query_params=None, body=b'', payload_hash=None, content_type=None, timeout=_S3_REQUEST_TIMEOUT):
    bucket = (settings.get('s3_bucket') or '').strip()
    region = (settings.get('s3_region') or '').strip() or 'us-east-1'
    access_key = (settings.get('s3_access_key_id') or '').strip()
    secret_key = settings.get('s3_secret_access_key') or ''
    host, canonical_uri = _s3_target(bucket, region, key)
    query_params = query_params or []
    request_path = canonical_uri
    canonical_query = _s3_canonical_query(query_params)
    if canonical_query:
        request_path = f'{request_path}?{canonical_query}'
    if payload_hash is None:
        payload_hash = hashlib.sha256(body or b'').hexdigest()
    headers = _s3_signed_headers(access_key, secret_key, region, method, host, canonical_uri, query_params, payload_hash)
    if content_type:
        headers['Content-Type'] = content_type
    if body is not None:
        headers['Content-Length'] = str(len(body))
    conn = http.client.HTTPSConnection(host, timeout=timeout)
    try:
        conn.request(method, request_path, body=body, headers=headers)
        resp = conn.getresponse()
        data = resp.read()
        if resp.status >= 300:
            detail = data.decode('utf-8', errors='replace').strip() or resp.reason or f'HTTP {resp.status}'
            raise RuntimeError(f'S3 {method} failed ({resp.status}): {detail[:1000]}')
        return resp, data
    finally:
        conn.close()


def _s3_request_with_retries(settings, method, key, query_params=None, body=b'', payload_hash=None, content_type=None, timeout=_S3_REQUEST_TIMEOUT):
    last_exc = None
    for attempt in range(len(_S3_RETRY_DELAYS) + 1):
        try:
            return _s3_request(settings, method, key, query_params, body, payload_hash, content_type, timeout)
        except Exception as exc:
            last_exc = exc
            retryable_status = re.search(r'S3 \w+ failed \((5\d\d)\)', str(exc))
            if not (_s3_transient_error(exc) or retryable_status) or attempt >= len(_S3_RETRY_DELAYS):
                raise
            time.sleep(_S3_RETRY_DELAYS[attempt])
    raise RuntimeError(f'S3 {method} failed: {last_exc}')


def _s3_multipart_part_size(size):
    configured = int(os.environ.get('ASCEND_S3_MULTIPART_PART_SIZE', _S3_DEFAULT_PART_SIZE) or _S3_DEFAULT_PART_SIZE)
    part_size = max(_S3_MIN_PART_SIZE, configured)
    minimum_for_part_count = (int(size) + _S3_MAX_PARTS - 1) // _S3_MAX_PARTS
    part_size = max(part_size, minimum_for_part_count)
    return ((part_size + 1024 * 1024 - 1) // (1024 * 1024)) * 1024 * 1024


def _s3_create_multipart_upload(settings, key, content_type):
    _resp, body = _s3_request_with_retries(
        settings,
        'POST',
        key,
        query_params=[('uploads', '')],
        body=b'',
        payload_hash=_EMPTY_SHA256,
        content_type=content_type,
    )
    try:
        root = ET.fromstring(body)
        upload_id = root.findtext('.//{*}UploadId') or root.findtext('UploadId')
    except Exception as exc:
        raise RuntimeError(f'S3 multipart create returned invalid XML: {exc}') from exc
    if not upload_id:
        raise RuntimeError('S3 multipart create did not return an UploadId.')
    return upload_id


def _s3_abort_multipart_upload(settings, key, upload_id):
    try:
        _s3_request_with_retries(
            settings,
            'DELETE',
            key,
            query_params=[('uploadId', upload_id)],
            body=b'',
            payload_hash=_EMPTY_SHA256,
        )
    except Exception:
        pass


def _s3_upload_part(settings, key, upload_id, part_number, chunk):
    payload_hash = hashlib.sha256(chunk).hexdigest()
    resp, _body = _s3_request_with_retries(
        settings,
        'PUT',
        key,
        query_params=[('partNumber', str(part_number)), ('uploadId', upload_id)],
        body=chunk,
        payload_hash=payload_hash,
        timeout=_S3_REQUEST_TIMEOUT,
    )
    etag = resp.getheader('ETag')
    if not etag:
        raise RuntimeError(f'S3 upload part {part_number} did not return an ETag.')
    return etag


def _s3_complete_multipart_upload(settings, key, upload_id, parts):
    items = ''.join(
        f'<Part><PartNumber>{part["part_number"]}</PartNumber><ETag>{part["etag"]}</ETag></Part>'
        for part in parts
    )
    body = f'<CompleteMultipartUpload>{items}</CompleteMultipartUpload>'.encode('utf-8')
    _s3_request_with_retries(
        settings,
        'POST',
        key,
        query_params=[('uploadId', upload_id)],
        body=body,
        payload_hash=hashlib.sha256(body).hexdigest(),
        content_type='application/xml',
    )


def _s3_multipart_upload(filepath, filename, settings, content_type):
    key = _s3_object_key(settings, filename)
    filepath = Path(filepath)
    upload_id = _s3_create_multipart_upload(settings, key, content_type)
    parts = []
    part_size = _s3_multipart_part_size(filepath.stat().st_size)
    try:
        with open(filepath, 'rb') as fh:
            part_number = 1
            while True:
                chunk = fh.read(part_size)
                if not chunk:
                    break
                etag = _s3_upload_part(settings, key, upload_id, part_number, chunk)
                parts.append({'part_number': part_number, 'etag': etag})
                part_number += 1
        if not parts:
            raise RuntimeError('S3 multipart upload has no parts.')
        _s3_complete_multipart_upload(settings, key, upload_id, parts)
    except Exception:
        _s3_abort_multipart_upload(settings, key, upload_id)
        raise
    return f's3://{settings.get("s3_bucket")}/{key}'


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
    content_type = _backup_content_type(filename)
    content_length = os.path.getsize(filepath)
    if content_length >= _S3_MULTIPART_THRESHOLD or content_length > _S3_SINGLE_PUT_LIMIT:
        return _s3_multipart_upload(filepath, filename, settings, content_type)

    host, canonical_uri = _s3_target(bucket, region, key)
    now = datetime.now(timezone.utc)
    amz_date = now.strftime('%Y%m%dT%H%M%SZ')
    date_stamp = now.strftime('%Y%m%d')
    payload_hash = _s3_file_sha256(filepath)

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
    _webdav_put_file(target, username, password, filepath, content_type)
    return target
