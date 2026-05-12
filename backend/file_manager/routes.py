import hmac
import ipaddress
import os
import re
import shutil
import socket
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import Blueprint, after_this_request, jsonify, request, send_file, session
from flask_login import current_user, login_required
from werkzeug.security import check_password_hash, generate_password_hash

from backend.services.share_links import create_share_link

bp = Blueprint('file_manager', __name__)

app = None
db = None
csrf = None
DEPLOYMENTS_DIR = None
App = None
Project = None
AppSetting = None
iso_utc = None
_notify_email_async = None
_app_deploy_dir = None
SHELL_PASSPHRASE_SETTING_KEY = None


def register_file_manager_feature(*, flask_app, db_instance, csrf_protect, deployments_dir, app_model, project_model, app_setting_model, iso_utc_func, notify_email_async, app_deploy_dir, shell_passphrase_setting_key):
    global app, db, csrf, DEPLOYMENTS_DIR, App, Project, AppSetting, iso_utc, _notify_email_async, _app_deploy_dir, SHELL_PASSPHRASE_SETTING_KEY
    app = flask_app
    db = db_instance
    csrf = csrf_protect
    DEPLOYMENTS_DIR = deployments_dir
    App = app_model
    Project = project_model
    AppSetting = app_setting_model
    iso_utc = iso_utc_func
    _notify_email_async = notify_email_async
    _app_deploy_dir = app_deploy_dir
    SHELL_PASSPHRASE_SETTING_KEY = shell_passphrase_setting_key
    csrf.exempt(bp)
    app.register_blueprint(bp)

# File Manager (per-app)
# ═══════════════════════════════════════════

MAX_EDIT_FILE_BYTES = 2 * 1024 * 1024  # 2MB cap for read/write through the editor
MAX_URL_DOWNLOAD_BYTES = 1024 * 1024 * 1024  # 1GB cap for server-side URL downloads
MAX_SEARCH_FILE_BYTES = 1024 * 1024  # Keep content search responsive and avoid large/binary files.
HIDDEN_NAMES = {'node_modules', '.git'}
SEARCH_TEXT_EXTS = {
    '', 'txt', 'md', 'json', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'css', 'scss',
    'sass', 'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'env',
    'sh', 'bash', 'zsh', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp',
    'sql', 'php', 'vue', 'svelte', 'conf', 'log', 'gitignore', 'dockerfile',
    'prettierrc', 'eslintrc', 'babelrc', 'editorconfig', 'lock', 'csv', 'tsv',
    'patch', 'diff', 'rst',
}


class ServerFileScope:
    pass


SERVER_FILE_SCOPE = ServerFileScope()
SERVER_FILES_ROOT = Path(os.environ.get('SERVER_FILES_ROOT', '/')).resolve()
_SERVER_FILES_ATTEMPTS = {}
_SERVER_FILES_ATTEMPT_LIMIT = 5
_SERVER_FILES_LOCKOUT_SECONDS = 60


def _fm_owned_app(app_id):
    a = App.query.get_or_404(app_id)
    if a.project.user_id != current_user.id:
        return None, (jsonify({'error': 'Unauthorized'}), 403)
    return a, None


def _fm_owned_project(project_id):
    p = Project.query.get_or_404(project_id)
    if p.user_id != current_user.id:
        return None, (jsonify({'error': 'Unauthorized'}), 403)
    return p, None


def _shell_passphrase_env():
    """Optional env-var override. Lets operators pin a passphrase outside the DB.

    Honoured by both the terminal and the server-files endpoints. SERVER_FILES_PASSPHRASE
    is recognised for backward compat but is no longer required.
    """
    raw = os.environ.get('TERMINAL_PASSPHRASE') or os.environ.get('SERVER_FILES_PASSPHRASE')
    return raw or None


def _shell_passphrase_hash():
    rec = db.session.get(AppSetting, SHELL_PASSPHRASE_SETTING_KEY)
    return rec.value if rec and rec.value else None


def shell_passphrase_is_configured():
    return bool(_shell_passphrase_env() or _shell_passphrase_hash())


def _shell_passphrase_ok(given):
    if not given:
        return False
    env = _shell_passphrase_env()
    if env is not None:
        return hmac.compare_digest(str(given), env)
    stored = _shell_passphrase_hash()
    if not stored:
        return False
    return check_password_hash(stored, str(given))


def set_shell_passphrase(plaintext):
    """Persist a new shell passphrase. Plaintext is hashed before storage."""
    if not plaintext or len(plaintext) < 8:
        raise ValueError('Passphrase must be at least 8 characters.')
    hashed = generate_password_hash(plaintext)
    rec = db.session.get(AppSetting, SHELL_PASSPHRASE_SETTING_KEY)
    if rec is None:
        rec = AppSetting(key=SHELL_PASSPHRASE_SETTING_KEY, value=hashed)
        db.session.add(rec)
    else:
        rec.value = hashed
    db.session.commit()


def _server_files_passphrase_ok(given):
    return _shell_passphrase_ok(given)


def _server_files_unlocked():
    return bool(session.get('server_files_unlocked'))


def _fm_owned_server():
    if not _server_files_unlocked():
        return None, (jsonify({'error': 'Server files are locked'}), 423)
    if not getattr(current_user, 'is_admin', False):
        return None, (jsonify({'error': 'Unauthorized'}), 403)
    return SERVER_FILE_SCOPE, None


def _fm_scope_base(scope):
    """Resolved filesystem root for an App, Project, or server-wide scope."""
    if isinstance(scope, ServerFileScope):
        return SERVER_FILES_ROOT
    if isinstance(scope, App):
        return _app_deploy_dir(scope).resolve()
    # Project
    return (DEPLOYMENTS_DIR / scope.folder_name).resolve()


def _fm_resolve(scope, relpath, must_exist=True):
    """Resolve `relpath` under the scope's base dir and confirm it stays inside.

    `scope` can be an App or a Project row. Returns (base, target). Raises
    ValueError on escape, FileNotFoundError if must_exist and missing.
    """
    base = _fm_scope_base(scope)
    rel = (relpath or '').replace('\\', '/').lstrip('/')
    target = (base / rel).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        raise ValueError('Path escapes scope directory')
    if must_exist and not target.exists():
        raise FileNotFoundError(str(target))
    return base, target


def _fm_entry(p, base):
    try:
        st = p.stat()
    except OSError:
        return None
    is_dir = p.is_dir()
    rel = str(p.relative_to(base)).replace('\\', '/')
    return {
        'name': p.name,
        'path': rel,
        'is_dir': is_dir,
        'size': None if is_dir else st.st_size,
        'mtime': iso_utc(datetime.fromtimestamp(st.st_mtime, tz=timezone.utc)),
    }


def _fm_searchable_text_file(p):
    if not p.is_file():
        return False
    name = p.name.lower()
    ext = name.rsplit('.', 1)[-1] if '.' in name else ''
    if name in SEARCH_TEXT_EXTS or ext in SEARCH_TEXT_EXTS:
        try:
            return p.stat().st_size <= MAX_SEARCH_FILE_BYTES
        except OSError:
            return False
    return False


def _fm_find_content_match(p, query):
    try:
        with p.open('r', encoding='utf-8') as fh:
            for line_no, line in enumerate(fh, start=1):
                clean = line.rstrip('\r\n')
                if query in clean.lower():
                    return {
                        'type': 'content',
                        'line': line_no,
                        'text': clean[:240],
                    }
    except (OSError, UnicodeDecodeError):
        return None
    return None


def _fm_rel(target, base):
    return '' if target == base else str(target.relative_to(base)).replace('\\', '/')


def _fm_safe_extract_zip(zip_path, target_dir, base):
    target_dir = target_dir.resolve()
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.infolist():
            member_path = (target_dir / member.filename).resolve()
            try:
                member_path.relative_to(target_dir)
                member_path.relative_to(base)
            except ValueError:
                raise ValueError(f'Unsafe entry: {member.filename}')
        zf.extractall(target_dir)


def _fm_handle_list(scope):
    relpath = request.args.get('path', '')
    show_hidden = request.args.get('show_hidden') in ('1', 'true', 'yes')
    raw_search = (request.args.get('search') or '').strip()
    search = raw_search.lower()
    search_contents = request.args.get('search_contents') in ('1', 'true', 'yes')
    search_limit = 250
    try:
        base, target = _fm_resolve(scope, relpath, must_exist=False)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    if not base.exists():
        return jsonify({
            'base_path': str(base),
            'path': '',
            'exists': False,
            'entries': [],
        })
    if not target.exists():
        return jsonify({'error': 'Path not found'}), 404
    if not target.is_dir():
        return jsonify({'error': 'Path is not a directory'}), 400

    entries = []
    if search:
        count = 0
        try:
            children = sorted(target.rglob('*'), key=lambda p: (not p.is_dir(), str(p).lower()))
        except OSError as exc:
            return jsonify({'error': f'Cannot search directory: {exc.strerror or exc}'}), 403
        for child in children:
            if child == target:
                continue
            rel = _fm_rel(child, base)
            parts = [part for part in rel.split('/') if part]
            if not show_hidden and any(part in HIDDEN_NAMES for part in parts):
                continue
            path_matches = search in child.name.lower() or search in rel.lower()
            content_match = None
            if not path_matches and search_contents and _fm_searchable_text_file(child):
                content_match = _fm_find_content_match(child, search)
            if not path_matches and not content_match:
                continue
            entry = _fm_entry(child, base)
            if entry:
                if content_match:
                    entry['match'] = content_match
                elif path_matches:
                    entry['match'] = {'type': 'path'}
                entries.append(entry)
                count += 1
                if count >= search_limit:
                    break
    else:
        try:
            children = sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError as exc:
            return jsonify({'error': f'Cannot read directory: {exc.strerror or exc}'}), 403
        for child in children:
            if not show_hidden and child.name in HIDDEN_NAMES:
                continue
            entry = _fm_entry(child, base)
            if entry:
                entries.append(entry)

    return jsonify({
        'base_path': str(base),
        'path': _fm_rel(target, base),
        'exists': True,
        'entries': entries,
        'search': raw_search,
        'search_contents': search_contents,
        'search_limited': bool(search and len(entries) >= search_limit),
    })


def _fm_handle_read(scope):
    try:
        base, target = _fm_resolve(scope, request.args.get('path', ''))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except FileNotFoundError:
        return jsonify({'error': 'File not found'}), 404
    if not target.is_file():
        return jsonify({'error': 'Not a file'}), 400
    size = target.stat().st_size
    if size > MAX_EDIT_FILE_BYTES:
        return jsonify({
            'error': f'File is {size} bytes; editor limit is {MAX_EDIT_FILE_BYTES}. Download it instead.'
        }), 413
    try:
        content = target.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        return jsonify({'error': 'File is not UTF-8 text. Use download instead.'}), 415
    return jsonify({'path': _fm_rel(target, base), 'content': content, 'size': size})


def _fm_handle_write(scope):
    data = request.get_json(silent=True) or {}
    relpath = data.get('path', '')
    content = data.get('content', '')
    if not relpath:
        return jsonify({'error': 'path required'}), 400
    if not isinstance(content, str):
        return jsonify({'error': 'content must be a string'}), 400
    if len(content.encode('utf-8')) > MAX_EDIT_FILE_BYTES:
        return jsonify({'error': 'Content exceeds editor limit'}), 413
    try:
        base, target = _fm_resolve(scope, relpath, must_exist=False)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    if target == base:
        return jsonify({'error': 'Invalid path'}), 400
    if target.exists() and target.is_dir():
        return jsonify({'error': 'Path is a directory'}), 400
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')
    return jsonify({'status': 'ok', 'path': _fm_rel(target, base), 'size': target.stat().st_size})


def _fm_handle_download(scope):
    try:
        _, target = _fm_resolve(scope, request.args.get('path', ''))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except FileNotFoundError:
        return jsonify({'error': 'File not found'}), 404
    if not target.is_file():
        return jsonify({'error': 'Not a file'}), 400
    return send_file(str(target), as_attachment=True, download_name=target.name)


def _fm_url_public_hostname(url):
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
    return parsed


def _fm_download_filename(parsed, explicit_name):
    raw = (explicit_name or '').strip()
    if raw:
        name = Path(raw.replace('\\', '/')).name
    else:
        name = Path(urllib.parse.unquote(parsed.path or '').replace('\\', '/')).name
    name = re.sub(r'[\x00-\x1f<>:"|?*]+', '_', name or '').strip('. ')
    return name or f'download-{int(time.time())}'


def _fm_handle_download_url(scope):
    data = request.get_json(silent=True) or {}
    relpath = data.get('path', '')
    url = str(data.get('url') or '').strip()
    if not url:
        return jsonify({'error': 'URL is required.'}), 400
    try:
        parsed = _fm_url_public_hostname(url)
        base, target_dir = _fm_resolve(scope, relpath, must_exist=False)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    target_dir.mkdir(parents=True, exist_ok=True)
    if not target_dir.is_dir():
        return jsonify({'error': 'Target is not a directory'}), 400

    filename = _fm_download_filename(parsed, data.get('filename'))
    dest = (target_dir / filename).resolve()
    try:
        dest.relative_to(base)
    except ValueError:
        return jsonify({'error': 'Invalid target filename.'}), 400

    request_obj = urllib.request.Request(url, headers={'User-Agent': 'AscendFileManager/1.0'})
    tmp = dest.with_name(f'.{dest.name}.download-{os.getpid()}')
    total = 0
    try:
        with urllib.request.urlopen(request_obj, timeout=30) as res, open(tmp, 'wb') as out:
            length = res.headers.get('Content-Length')
            if length and int(length) > MAX_URL_DOWNLOAD_BYTES:
                raise ValueError('Remote file is larger than the 1GB download limit.')
            while True:
                chunk = res.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_URL_DOWNLOAD_BYTES:
                    raise ValueError('Remote file is larger than the 1GB download limit.')
                out.write(chunk)
        tmp.replace(dest)
    except Exception as exc:
        try:
            tmp.unlink()
        except OSError:
            pass
        return jsonify({'error': f'Download failed: {str(exc)[:300]}'}), 400
    return jsonify({'status': 'ok', 'path': _fm_rel(dest, base), 'name': dest.name, 'size': dest.stat().st_size})


def _fm_handle_upload(scope):
    relpath = request.form.get('path', '')
    unzip = request.form.get('unzip') in ('1', 'true', 'yes')
    try:
        base, target_dir = _fm_resolve(scope, relpath, must_exist=False)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    target_dir.mkdir(parents=True, exist_ok=True)
    if not target_dir.is_dir():
        return jsonify({'error': 'Target is not a directory'}), 400

    files = request.files.getlist('files')
    if not files:
        return jsonify({'error': 'No files uploaded'}), 400

    written = []
    for f in files:
        if not f.filename:
            continue
        safe_name = Path(f.filename.replace('\\', '/')).name
        if not safe_name or safe_name in ('.', '..'):
            return jsonify({'error': f'Invalid filename: {f.filename}'}), 400
        dest = (target_dir / safe_name).resolve()
        try:
            dest.relative_to(base)
        except ValueError:
            return jsonify({'error': f'Invalid filename: {f.filename}'}), 400
        f.save(str(dest))
        if unzip and safe_name.lower().endswith('.zip'):
            try:
                _fm_safe_extract_zip(dest, target_dir, base)
            except (ValueError, zipfile.BadZipFile) as exc:
                dest.unlink(missing_ok=True)
                return jsonify({'error': f'Failed to unzip {safe_name}: {exc}'}), 400
            dest.unlink(missing_ok=True)
            written.append({'name': safe_name, 'unzipped': True})
            continue
        written.append({'name': safe_name, 'unzipped': False})

    return jsonify({'status': 'ok', 'files': written})


def _fm_handle_extract(scope):
    data = request.get_json(silent=True) or {}
    relpath = data.get('path', '')
    if not relpath:
        return jsonify({'error': 'path required'}), 400
    if not relpath.lower().endswith('.zip'):
        return jsonify({'error': 'Only .zip files can be unzipped'}), 400
    try:
        base, zip_path = _fm_resolve(scope, relpath)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except FileNotFoundError:
        return jsonify({'error': 'Zip file not found'}), 404
    if not zip_path.is_file():
        return jsonify({'error': 'Not a file'}), 400
    try:
        _fm_safe_extract_zip(zip_path, zip_path.parent, base)
    except (ValueError, zipfile.BadZipFile) as exc:
        return jsonify({'error': f'Failed to unzip {zip_path.name}: {exc}'}), 400
    except OSError as exc:
        return jsonify({'error': f'Failed to unzip {zip_path.name}: {exc.strerror or exc}'}), 500
    return jsonify({'status': 'ok', 'path': _fm_rel(zip_path.parent, base)})


def _fm_handle_mkdir(scope):
    data = request.get_json(silent=True) or {}
    relpath = data.get('path', '')
    if not relpath:
        return jsonify({'error': 'path required'}), 400
    try:
        base, target = _fm_resolve(scope, relpath, must_exist=False)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    if target == base:
        return jsonify({'error': 'Invalid path'}), 400
    if target.exists():
        return jsonify({'error': 'Already exists'}), 409
    target.mkdir(parents=True)
    return jsonify({'status': 'ok', 'path': _fm_rel(target, base)})


def _fm_handle_rename(scope):
    data = request.get_json(silent=True) or {}
    src = data.get('from', '')
    dst = data.get('to', '')
    if not src or not dst:
        return jsonify({'error': 'from and to required'}), 400
    try:
        base, src_p = _fm_resolve(scope, src)
        _, dst_p = _fm_resolve(scope, dst, must_exist=False)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except FileNotFoundError:
        return jsonify({'error': 'Source not found'}), 404
    if src_p == base or dst_p == base:
        return jsonify({'error': 'Invalid path'}), 400
    if dst_p.exists():
        return jsonify({'error': 'Destination exists'}), 409
    try:
        dst_p.parent.mkdir(parents=True, exist_ok=True)
        src_p.rename(dst_p)
    except OSError as exc:
        return jsonify({'error': f'Rename failed: {exc.strerror or exc}'}), 500
    return jsonify({'status': 'ok', 'path': _fm_rel(dst_p, base)})


def _fm_handle_copy(scope):
    data = request.get_json(silent=True) or {}
    src = data.get('from', '')
    dst = data.get('to', '')
    if not src or not dst:
        return jsonify({'error': 'from and to required'}), 400
    try:
        base, src_p = _fm_resolve(scope, src)
        _, dst_p = _fm_resolve(scope, dst, must_exist=False)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except FileNotFoundError:
        return jsonify({'error': 'Source not found'}), 404
    if src_p == base or dst_p == base:
        return jsonify({'error': 'Invalid path'}), 400
    if dst_p.exists():
        return jsonify({'error': 'Destination exists'}), 409
    try:
        src_p.relative_to(dst_p)
        return jsonify({'error': 'Cannot copy a directory into itself'}), 400
    except ValueError:
        pass
    dst_p.parent.mkdir(parents=True, exist_ok=True)
    if src_p.is_dir():
        shutil.copytree(src_p, dst_p)
    else:
        shutil.copy2(src_p, dst_p)
    return jsonify({'status': 'ok', 'path': _fm_rel(dst_p, base)})


def _fm_handle_delete(scope):
    data = request.get_json(silent=True) or {}
    relpath = data.get('path')
    relpaths = data.get('paths')
    if relpaths is None:
        relpaths = [relpath] if relpath else []
    if not isinstance(relpaths, list) or not relpaths:
        return jsonify({'error': 'path or paths required'}), 400

    deleted = []
    try:
        base = _fm_scope_base(scope)
        targets = []
        for item in relpaths:
            _, target = _fm_resolve(scope, item)
            if target == base:
                return jsonify({'error': 'Cannot delete root'}), 400
            targets.append((item, target))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except FileNotFoundError:
        return jsonify({'error': 'Not found'}), 404

    for item, target in sorted(targets, key=lambda t: len(str(t[1])), reverse=True):
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
        deleted.append(item)
    return jsonify({'status': 'ok', 'deleted': deleted})


def _fm_archive_name(name):
    cleaned = re.sub(r'[^A-Za-z0-9._-]+', '-', (name or '').strip()).strip('.-')
    if not cleaned:
        cleaned = f'archive-{datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")}'
    if not cleaned.lower().endswith('.zip'):
        cleaned += '.zip'
    return cleaned


def _fm_collect_archive_targets(scope, relpaths):
    if not isinstance(relpaths, list) or not relpaths:
        raise ValueError('paths required')
    base = _fm_scope_base(scope)
    targets = []
    seen = set()
    for item in relpaths:
        _, target = _fm_resolve(scope, item)
        if target == base:
            raise ValueError('Cannot archive root')
        key = str(target)
        if key in seen:
            continue
        seen.add(key)
        targets.append(target)
    return base, targets


def _fm_write_zip(zip_path, base, targets):
    with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        for target in targets:
            if target.is_dir():
                children = list(target.rglob('*'))
                if not children:
                    zf.writestr(f"{_fm_rel(target, base).rstrip('/')}/", '')
                    continue
                for child in children:
                    if child.is_dir():
                        continue
                    zf.write(child, arcname=_fm_rel(child, base))
            else:
                zf.write(target, arcname=_fm_rel(target, base))


def _fm_handle_archive(scope):
    data = request.get_json(silent=True) or {}
    relpaths = data.get('paths')
    mode = (data.get('mode') or 'download').strip().lower()
    current_path = data.get('current_path', '')
    output_name = _fm_archive_name(data.get('output_name'))

    try:
        base, targets = _fm_collect_archive_targets(scope, relpaths)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except FileNotFoundError:
        return jsonify({'error': 'Not found'}), 404

    if mode == 'create':
        try:
            _, target_dir = _fm_resolve(scope, current_path, must_exist=False)
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
        target_dir.mkdir(parents=True, exist_ok=True)
        if not target_dir.is_dir():
            return jsonify({'error': 'Target is not a directory'}), 400
        zip_path = (target_dir / output_name).resolve()
        try:
            zip_path.relative_to(base)
        except ValueError:
            return jsonify({'error': 'Archive path escapes scope directory'}), 400
        _fm_write_zip(zip_path, base, targets)
        return jsonify({
            'status': 'ok',
            'created': _fm_rel(zip_path, base),
            'output_name': output_name,
        })

    temp_dir = tempfile.mkdtemp(prefix='ascend-fm-')
    zip_path = Path(temp_dir) / output_name
    _fm_write_zip(zip_path, base, targets)
    @after_this_request
    def _cleanup_archive(response):
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass
        return response
    return send_file(str(zip_path), as_attachment=True, download_name=output_name)


def _fm_handle_share(scope):
    data = request.get_json(silent=True) or {}
    relpath = str(data.get('path') or '').strip()
    if not relpath:
        return jsonify({'error': 'Choose a file or folder to share.'}), 400
    try:
        _base, target = _fm_resolve(scope, relpath)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    if not target.exists():
        return jsonify({'error': 'File or folder not found.'}), 404
    try:
        share = create_share_link(
            target,
            download_name=f'{target.name}.zip' if target.is_dir() else target.name,
            title=target.name,
            expires_hours=data.get('expires_hours'),
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    share['url'] = f"{request.host_url.rstrip('/')}/api/share/{share['token']}"
    return jsonify(share), 201


def _fm_handle_backup(scope):
    data = request.get_json(silent=True) or {}
    source_path = str(data.get('source_path') or '').strip()
    destination_path = str(data.get('destination_path') or '').strip()
    
    if not source_path:
        return jsonify({'error': 'source_path is required'}), 400
    if not destination_path:
        return jsonify({'error': 'destination_path is required'}), 400
    
    try:
        base, source = _fm_resolve(scope, source_path)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except FileNotFoundError:
        return jsonify({'error': 'Source folder not found'}), 404
    
    # Source must be a directory
    if not source.is_dir():
        return jsonify({'error': 'Only folders can be backed up'}), 400
    
    try:
        _, dest_base = _fm_resolve(scope, destination_path, must_exist=False)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    
    # Create the destination directory if it doesn't exist
    dest_base.mkdir(parents=True, exist_ok=True)
    if not dest_base.is_dir():
        return jsonify({'error': 'Destination must be a directory'}), 400
    
    # Create a timestamped backup folder
    timestamp = datetime.now(tz=timezone.utc).strftime('%Y%m%d_%H%M%S')
    backup_name = f'{source.name}_backup_{timestamp}'
    backup_path = (dest_base / backup_name).resolve()
    
    # Verify backup path is within scope
    try:
        backup_path.relative_to(base)
    except ValueError:
        return jsonify({'error': 'Backup path escapes scope directory'}), 400
    
    # Check if backup already exists (shouldn't happen with timestamp, but be safe)
    if backup_path.exists():
        return jsonify({'error': f'{backup_name} already exists'}), 409
    
    try:
        # Copy the entire directory tree to the backup location
        shutil.copytree(source, backup_path)
    except OSError as exc:
        # Clean up partial backup if it failed
        try:
            shutil.rmtree(backup_path, ignore_errors=True)
        except Exception:
            pass
        return jsonify({'error': f'Backup failed: {exc.strerror or exc}'}), 500
    
    return jsonify({
        'status': 'ok',
        'backup_name': backup_name,
        'backup_path': _fm_rel(backup_path, base),
        'size': sum(f.stat().st_size for f in backup_path.rglob('*') if f.is_file()),
    }), 201


# ── App-scoped routes ──────────────────────────────────────────────
@bp.route('/api/app/<int:app_id>/files/list')
@login_required
def api_app_files_list(app_id):
    a, err = _fm_owned_app(app_id)
    return err or _fm_handle_list(a)


@bp.route('/api/app/<int:app_id>/files/read')
@login_required
def api_app_files_read(app_id):
    a, err = _fm_owned_app(app_id)
    return err or _fm_handle_read(a)


@bp.route('/api/app/<int:app_id>/files/write', methods=['POST'])
@login_required
def api_app_files_write(app_id):
    a, err = _fm_owned_app(app_id)
    return err or _fm_handle_write(a)


@bp.route('/api/app/<int:app_id>/files/download')
@login_required
def api_app_files_download(app_id):
    a, err = _fm_owned_app(app_id)
    return err or _fm_handle_download(a)


@bp.route('/api/app/<int:app_id>/files/download-url', methods=['POST'])
@login_required
def api_app_files_download_url(app_id):
    a, err = _fm_owned_app(app_id)
    return err or _fm_handle_download_url(a)


@bp.route('/api/app/<int:app_id>/files/upload', methods=['POST'])
@login_required
def api_app_files_upload(app_id):
    a, err = _fm_owned_app(app_id)
    return err or _fm_handle_upload(a)


@bp.route('/api/app/<int:app_id>/files/extract', methods=['POST'])
@login_required
def api_app_files_extract(app_id):
    a, err = _fm_owned_app(app_id)
    return err or _fm_handle_extract(a)


@bp.route('/api/app/<int:app_id>/files/mkdir', methods=['POST'])
@login_required
def api_app_files_mkdir(app_id):
    a, err = _fm_owned_app(app_id)
    return err or _fm_handle_mkdir(a)


@bp.route('/api/app/<int:app_id>/files/rename', methods=['POST'])
@login_required
def api_app_files_rename(app_id):
    a, err = _fm_owned_app(app_id)
    return err or _fm_handle_rename(a)


@bp.route('/api/app/<int:app_id>/files/copy', methods=['POST'])
@login_required
def api_app_files_copy(app_id):
    a, err = _fm_owned_app(app_id)
    return err or _fm_handle_copy(a)


@bp.route('/api/app/<int:app_id>/files/archive', methods=['POST'])
@login_required
def api_app_files_archive(app_id):
    a, err = _fm_owned_app(app_id)
    return err or _fm_handle_archive(a)


@bp.route('/api/app/<int:app_id>/files/share', methods=['POST'])
@login_required
def api_app_files_share(app_id):
    a, err = _fm_owned_app(app_id)
    return err or _fm_handle_share(a)


@bp.route('/api/app/<int:app_id>/files/backup', methods=['POST'])
@login_required
def api_app_files_backup(app_id):
    a, err = _fm_owned_app(app_id)
    return err or _fm_handle_backup(a)


# ── Project-scoped routes (browse the cloned repo root) ───────────
@bp.route('/api/project/<int:project_id>/files/list')
@login_required
def api_project_files_list(project_id):
    p, err = _fm_owned_project(project_id)
    return err or _fm_handle_list(p)


@bp.route('/api/project/<int:project_id>/files/read')
@login_required
def api_project_files_read(project_id):
    p, err = _fm_owned_project(project_id)
    return err or _fm_handle_read(p)


@bp.route('/api/project/<int:project_id>/files/write', methods=['POST'])
@login_required
def api_project_files_write(project_id):
    p, err = _fm_owned_project(project_id)
    return err or _fm_handle_write(p)


@bp.route('/api/project/<int:project_id>/files/download')
@login_required
def api_project_files_download(project_id):
    p, err = _fm_owned_project(project_id)
    return err or _fm_handle_download(p)


@bp.route('/api/project/<int:project_id>/files/download-url', methods=['POST'])
@login_required
def api_project_files_download_url(project_id):
    p, err = _fm_owned_project(project_id)
    return err or _fm_handle_download_url(p)


@bp.route('/api/project/<int:project_id>/files/upload', methods=['POST'])
@login_required
def api_project_files_upload(project_id):
    p, err = _fm_owned_project(project_id)
    return err or _fm_handle_upload(p)


@bp.route('/api/project/<int:project_id>/files/extract', methods=['POST'])
@login_required
def api_project_files_extract(project_id):
    p, err = _fm_owned_project(project_id)
    return err or _fm_handle_extract(p)


@bp.route('/api/project/<int:project_id>/files/mkdir', methods=['POST'])
@login_required
def api_project_files_mkdir(project_id):
    p, err = _fm_owned_project(project_id)
    return err or _fm_handle_mkdir(p)


@bp.route('/api/project/<int:project_id>/files/rename', methods=['POST'])
@login_required
def api_project_files_rename(project_id):
    p, err = _fm_owned_project(project_id)
    return err or _fm_handle_rename(p)


@bp.route('/api/project/<int:project_id>/files/copy', methods=['POST'])
@login_required
def api_project_files_copy(project_id):
    p, err = _fm_owned_project(project_id)
    return err or _fm_handle_copy(p)


@bp.route('/api/project/<int:project_id>/files/archive', methods=['POST'])
@login_required
def api_project_files_archive(project_id):
    p, err = _fm_owned_project(project_id)
    return err or _fm_handle_archive(p)


@bp.route('/api/project/<int:project_id>/files/share', methods=['POST'])
@login_required
def api_project_files_share(project_id):
    p, err = _fm_owned_project(project_id)
    return err or _fm_handle_share(p)


@bp.route('/api/project/<int:project_id>/files/backup', methods=['POST'])
@login_required
def api_project_files_backup(project_id):
    p, err = _fm_owned_project(project_id)
    return err or _fm_handle_backup(p)


@bp.route('/api/project/<int:project_id>/files/delete', methods=['POST'])
@login_required
def api_project_files_delete(project_id):
    p, err = _fm_owned_project(project_id)
    return err or _fm_handle_delete(p)


def _walk_dir_size(path):
    """Sum every regular file under `path` without following symlinks. Ignores
    stat errors on individual entries (sockets, broken symlinks, perm denied)."""
    total = 0
    # os.walk does not follow symlinks by default.
    for root, _dirs, files in os.walk(str(path)):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total


@bp.route('/api/app/<int:app_id>/files/recalculate-size', methods=['POST'])
@login_required
def api_app_files_recalc_size(app_id):
    a, err = _fm_owned_app(app_id)
    if err:
        return err
    base = _app_deploy_dir(a)
    size = _walk_dir_size(base) if base.exists() else 0
    a.disk_size_bytes = size
    a.disk_size_computed_at = datetime.now(timezone.utc)
    db.session.commit()
    return jsonify({
        'disk_size_bytes': size,
        'disk_size_computed_at': iso_utc(a.disk_size_computed_at),
    })


@bp.route('/api/project/<int:project_id>/files/recalculate-size', methods=['POST'])
@login_required
def api_project_files_recalc_size(project_id):
    p = Project.query.get_or_404(project_id)
    if p.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    now = datetime.now(timezone.utc)
    total = 0
    per_app = []
    for a in p.apps:
        base = _app_deploy_dir(a)
        size = _walk_dir_size(base) if base.exists() else 0
        a.disk_size_bytes = size
        a.disk_size_computed_at = now
        total += size
        per_app.append({'id': a.id, 'name': a.name, 'disk_size_bytes': size})
    db.session.commit()
    return jsonify({
        'disk_size_bytes': total,
        'disk_size_computed_at': iso_utc(now),
        'apps': per_app,
    })


@bp.route('/api/app/<int:app_id>/files/delete', methods=['POST'])
@login_required
def api_app_files_delete(app_id):
    a, err = _fm_owned_app(app_id)
    return err or _fm_handle_delete(a)


# ═══════════════════════════════════════════
# Server-wide file manager. This is deliberately separate from app/project
# scopes so existing deployment file manager behavior stays unchanged.
@bp.route('/api/server/files/status')
@login_required
def api_server_files_status():
    return jsonify({
        'unlocked': _server_files_unlocked(),
        'root': str(SERVER_FILES_ROOT),
        'needs_setup': not shell_passphrase_is_configured(),
        'can_setup': bool(getattr(current_user, 'is_admin', False)),
    })


@bp.route('/api/server/files/unlock', methods=['POST'])
@login_required
def api_server_files_unlock():
    if not getattr(current_user, 'is_admin', False):
        return jsonify({'error': 'Admin only.'}), 403
    data = request.get_json(silent=True) or {}
    given = data.get('passphrase', '')
    now = time.time()
    rec = _SERVER_FILES_ATTEMPTS.get(current_user.id, {'count': 0, 'until': 0.0})
    if rec['until'] > now:
        wait = int(rec['until'] - now)
        return jsonify({'error': f'Too many attempts. Try again in {wait}s.'}), 429
    if _server_files_passphrase_ok(given):
        session['server_files_unlocked'] = True
        _SERVER_FILES_ATTEMPTS.pop(current_user.id, None)
        ip = (request.headers.get('X-Forwarded-For') or request.remote_addr or '').split(',')[0].strip()
        _notify_email_async(
            'server_files_unlock',
            f'Ascend: server files unlocked — {current_user.username}',
            f'User {current_user.username} unlocked server-wide file manager (root: {SERVER_FILES_ROOT}).\n'
            f'IP: {ip}\nTime (UTC): {datetime.now(timezone.utc).isoformat()}',
        )
        return jsonify({'unlocked': True, 'root': str(SERVER_FILES_ROOT)})
    rec['count'] += 1
    if rec['count'] >= _SERVER_FILES_ATTEMPT_LIMIT:
        rec = {'count': 0, 'until': now + _SERVER_FILES_LOCKOUT_SECONDS}
    _SERVER_FILES_ATTEMPTS[current_user.id] = rec
    return jsonify({'error': 'Incorrect passphrase.'}), 401


@bp.route('/api/server/files/lock', methods=['POST'])
@login_required
def api_server_files_lock():
    session.pop('server_files_unlocked', None)
    return jsonify({'ok': True})


@bp.route('/api/server/files/list')
@login_required
def api_server_files_list():
    scope, err = _fm_owned_server()
    return err or _fm_handle_list(scope)


@bp.route('/api/server/files/read')
@login_required
def api_server_files_read():
    scope, err = _fm_owned_server()
    return err or _fm_handle_read(scope)


@bp.route('/api/server/files/write', methods=['POST'])
@login_required
def api_server_files_write():
    scope, err = _fm_owned_server()
    return err or _fm_handle_write(scope)


@bp.route('/api/server/files/download')
@login_required
def api_server_files_download():
    scope, err = _fm_owned_server()
    return err or _fm_handle_download(scope)


@bp.route('/api/server/files/download-url', methods=['POST'])
@login_required
def api_server_files_download_url():
    scope, err = _fm_owned_server()
    return err or _fm_handle_download_url(scope)


@bp.route('/api/server/files/upload', methods=['POST'])
@login_required
def api_server_files_upload():
    scope, err = _fm_owned_server()
    return err or _fm_handle_upload(scope)


@bp.route('/api/server/files/extract', methods=['POST'])
@login_required
def api_server_files_extract():
    scope, err = _fm_owned_server()
    return err or _fm_handle_extract(scope)


@bp.route('/api/server/files/mkdir', methods=['POST'])
@login_required
def api_server_files_mkdir():
    scope, err = _fm_owned_server()
    return err or _fm_handle_mkdir(scope)


@bp.route('/api/server/files/rename', methods=['POST'])
@login_required
def api_server_files_rename():
    scope, err = _fm_owned_server()
    return err or _fm_handle_rename(scope)


@bp.route('/api/server/files/copy', methods=['POST'])
@login_required
def api_server_files_copy():
    scope, err = _fm_owned_server()
    return err or _fm_handle_copy(scope)


@bp.route('/api/server/files/archive', methods=['POST'])
@login_required
def api_server_files_archive():
    scope, err = _fm_owned_server()
    return err or _fm_handle_archive(scope)


@bp.route('/api/server/files/share', methods=['POST'])
@login_required
def api_server_files_share():
    scope, err = _fm_owned_server()
    return err or _fm_handle_share(scope)


@bp.route('/api/server/files/backup', methods=['POST'])
@login_required
def api_server_files_backup():
    scope, err = _fm_owned_server()
    return err or _fm_handle_backup(scope)


@bp.route('/api/server/files/delete', methods=['POST'])
@login_required
def api_server_files_delete():
    scope, err = _fm_owned_server()
    return err or _fm_handle_delete(scope)


# ══════════════════════════════════════════════════════════════════
# Folder Backup Scheduler
# ══════════════════════════════════════════════════════════════════

_fm_scheduler = None


def _ensure_fm_scheduler():
    """Lazy-load APScheduler for folder backups."""
    global _fm_scheduler
    if _fm_scheduler is not None:
        return _fm_scheduler
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
    except ImportError:
        return None
    _fm_scheduler = BackgroundScheduler(timezone='UTC', daemon=True)
    _fm_scheduler.start()
    return _fm_scheduler


def register_fm_scheduler(flask_app):
    """Boot the folder backup scheduler. Called from app initialization."""
    def reschedule():
        _reschedule_folder_backup_jobs()
    
    with flask_app.app_context():
        try:
            reschedule()
        except Exception as e:
            print(f'[scheduler] WARNING: folder backup scheduler boot failed: {e}', file=sys.stderr)


def _get_iana_zone(tz_name):
    """Resolve IANA timezone name to ZoneInfo."""
    from zoneinfo import ZoneInfo
    try:
        if not tz_name or not tz_name.strip():
            return ZoneInfo('UTC')
        return ZoneInfo(tz_name.strip())
    except Exception:
        return ZoneInfo('UTC')


def _reschedule_folder_backup_jobs():
    """Rebuild all folder backup schedule jobs."""
    from flask import current_app
    from backend.models import FolderBackupSchedule
    
    sched = _ensure_fm_scheduler()
    if sched is None:
        return
    
    # Remove existing folder backup jobs
    for job in list(sched.get_jobs()):
        if job.id.startswith('fm-backup-'):
            sched.remove_job(job.id)
    
    # Re-add from DB
    for schedule in FolderBackupSchedule.query.filter_by(enabled=True).all():
        _schedule_folder_backup(schedule, sched)


def _schedule_folder_backup(schedule, sched=None):
    """Schedule a single folder backup job."""
    if sched is None:
        sched = _ensure_fm_scheduler()
    if sched is None:
        return
    
    tz = _get_iana_zone(schedule.schedule_timezone)
    ah = max(0, min(int(schedule.at_hour or 0), 23))
    am = max(0, min(int(schedule.at_minute or 0), 59))
    eh = max(1, min(int(schedule.every_hours or 2), 24 * 30))
    
    job_id = f'fm-backup-{schedule.id}'
    
    # Remove existing job if present
    try:
        sched.remove_job(job_id)
    except Exception:
        pass
    
    from apscheduler.triggers.cron import CronTrigger
    if eh == 24:
        # Daily backup at the selected time.
        trigger = CronTrigger(hour=ah, minute=am, timezone=tz)
    elif eh < 24:
        # Hourly backups should still honor the selected minute. For intervals
        # above one hour, at_hour is the daily anchor for the hour cadence.
        hour_expr = '*' if eh == 1 else f'{ah}-23/{eh}'
        trigger = CronTrigger(hour=hour_expr, minute=am, timezone=tz)
    else:
        # Multi-day intervals keep interval semantics because cron day steps can
        # drift around month boundaries and DST in surprising ways.
        from apscheduler.triggers.interval import IntervalTrigger
        trigger = IntervalTrigger(hours=eh, timezone=tz)
    
    sched.add_job(
        _execute_folder_backup,
        trigger=trigger,
        id=job_id,
        args=(schedule.id,),
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )


def _execute_folder_backup(schedule_id):
    """Execute a scheduled folder backup."""
    from backend.models import FolderBackupSchedule, FolderBackupArchive
    from backend.extensions import db
    
    try:
        schedule = FolderBackupSchedule.query.get(schedule_id)
        if not schedule:
            return
        
        archive = FolderBackupArchive(
            schedule_id=schedule_id,
            triggered_by='scheduled',
            backup_name=f'{schedule.source_path.split("/")[-1]}_backup_{datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")}',
            backup_path=schedule.destination_path,
            status='pending',
        )
        db.session.add(archive)
        db.session.commit()
        
        start_time = datetime.now(timezone.utc)
        try:
            # Determine scope
            if schedule.scope_type == 'app':
                scope = App.query.get(schedule.scope_id)
                if not scope:
                    raise ValueError('App not found')
            elif schedule.scope_type == 'project':
                scope = Project.query.get(schedule.scope_id)
                if not scope:
                    raise ValueError('Project not found')
            else:  # server
                scope = SERVER_FILE_SCOPE
            
            # Perform backup
            base, source = _fm_resolve(scope, schedule.source_path)
            if not source.is_dir():
                raise ValueError('Source is not a directory')
            
            _, dest_base = _fm_resolve(scope, schedule.destination_path, must_exist=False)
            dest_base.mkdir(parents=True, exist_ok=True)
            
            backup_path = (dest_base / archive.backup_name).resolve()
            backup_path.relative_to(base)  # Verify in scope
            
            shutil.copytree(source, backup_path)
            
            # Calculate size
            size = sum(f.stat().st_size for f in backup_path.rglob('*') if f.is_file())
            
            # Update archive
            archive.size_bytes = size
            archive.status = 'success'
            archive.completed_at = datetime.now(timezone.utc)
            archive.duration_seconds = int((archive.completed_at - start_time).total_seconds())
            
            # Update schedule
            schedule.last_run_at = archive.completed_at
            schedule.last_run_status = 'success'
            schedule.last_run_error = None
            
            # Clean old backups (retention policy)
            if schedule.retention_days > 0:
                cutoff = datetime.now(timezone.utc) - timedelta(days=schedule.retention_days)
                old_backups = FolderBackupArchive.query.filter(
                    FolderBackupArchive.schedule_id == schedule_id,
                    FolderBackupArchive.status == 'success',
                    FolderBackupArchive.completed_at < cutoff
                ).all()
                for old in old_backups:
                    try:
                        old_path = Path(str(base / old.backup_path / old.backup_name))
                        if old_path.exists():
                            shutil.rmtree(old_path, ignore_errors=True)
                    except Exception:
                        pass
                    db.session.delete(old)
            
            db.session.commit()
        except Exception as e:
            archive.status = 'failed'
            archive.error_message = str(e)[:500]
            archive.completed_at = datetime.now(timezone.utc)
            archive.duration_seconds = int((archive.completed_at - start_time).total_seconds())
            
            schedule.last_run_at = archive.completed_at
            schedule.last_run_status = 'failed'
            schedule.last_run_error = str(e)[:500]
            
            db.session.commit()
    except Exception as e:
        print(f'[backup scheduler] Error executing schedule {schedule_id}: {e}', file=sys.stderr)


# Folder backup schedule routes
@bp.route('/api/backup-schedules', methods=['GET'])
@login_required
def api_list_backup_schedules():
    """List all folder backup schedules for current user."""
    from backend.models import FolderBackupSchedule
    
    schedules = FolderBackupSchedule.query.filter_by(user_id=current_user.id).all()
    return jsonify([s.to_dict() for s in schedules])


@bp.route('/api/backup-schedules', methods=['POST'])
@login_required
def api_create_backup_schedule():
    """Create a new folder backup schedule."""
    from backend.models import FolderBackupSchedule
    from backend.extensions import db
    
    data = request.get_json(silent=True) or {}
    
    # Validate input
    scope_type = str(data.get('scope_type', '')).strip()
    scope_id = data.get('scope_id')
    source_path = str(data.get('source_path', '')).strip()
    destination_path = str(data.get('destination_path', '')).strip()
    every_hours = int(data.get('every_hours', 2))
    at_hour = int(data.get('at_hour', 0))
    at_minute = int(data.get('at_minute', 0))
    retention_days = int(data.get('retention_days', 7))
    
    if scope_type not in ('app', 'project', 'server'):
        return jsonify({'error': 'Invalid scope_type'}), 400
    if not source_path:
        return jsonify({'error': 'source_path required'}), 400
    if not destination_path:
        return jsonify({'error': 'destination_path required'}), 400
    
    # Validate scope ownership
    if scope_type == 'app':
        a, err = _fm_owned_app(scope_id)
        if err:
            return err
    elif scope_type == 'project':
        p, err = _fm_owned_project(scope_id)
        if err:
            return err
    else:  # server
        _, err = _fm_owned_server()
        if err:
            return err
        scope_id = None
    
    schedule = FolderBackupSchedule(
        user_id=current_user.id,
        scope_type=scope_type,
        scope_id=scope_id,
        source_path=source_path,
        destination_path=destination_path,
        every_hours=max(1, min(every_hours, 24 * 30)),
        at_hour=max(0, min(at_hour, 23)),
        at_minute=max(0, min(at_minute, 59)),
        retention_days=max(0, retention_days),
        schedule_timezone=data.get('schedule_timezone', '').strip() or None,
        enabled=True,
    )
    
    db.session.add(schedule)
    db.session.commit()
    
    # Re-schedule all jobs
    _reschedule_folder_backup_jobs()
    
    return jsonify(schedule.to_dict()), 201


@bp.route('/api/backup-schedules/<int:schedule_id>', methods=['GET'])
@login_required
def api_get_backup_schedule(schedule_id):
    """Get a specific backup schedule."""
    from backend.models import FolderBackupSchedule
    
    schedule = FolderBackupSchedule.query.get_or_404(schedule_id)
    if schedule.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    
    return jsonify(schedule.to_dict())


@bp.route('/api/backup-schedules/<int:schedule_id>', methods=['PUT'])
@login_required
def api_update_backup_schedule(schedule_id):
    """Update a backup schedule."""
    from backend.models import FolderBackupSchedule
    from backend.extensions import db
    
    schedule = FolderBackupSchedule.query.get_or_404(schedule_id)
    if schedule.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    
    data = request.get_json(silent=True) or {}
    
    # Update fields
    if 'source_path' in data:
        source_path = str(data.get('source_path', '')).strip()
        if not source_path:
            return jsonify({'error': 'source_path required'}), 400
        schedule.source_path = source_path
    if 'destination_path' in data:
        destination_path = str(data.get('destination_path', '')).strip()
        if not destination_path:
            return jsonify({'error': 'destination_path required'}), 400
        schedule.destination_path = destination_path
    if 'enabled' in data:
        schedule.enabled = bool(data.get('enabled'))
    if 'every_hours' in data:
        schedule.every_hours = max(1, min(int(data.get('every_hours', 2)), 24 * 30))
    if 'at_hour' in data:
        schedule.at_hour = max(0, min(int(data.get('at_hour', 0)), 23))
    if 'at_minute' in data:
        schedule.at_minute = max(0, min(int(data.get('at_minute', 0)), 59))
    if 'retention_days' in data:
        schedule.retention_days = max(0, int(data.get('retention_days', 7)))
    if 'schedule_timezone' in data:
        schedule.schedule_timezone = data.get('schedule_timezone', '').strip() or None
    
    schedule.updated_at = datetime.now(timezone.utc)
    db.session.commit()
    
    # Re-schedule jobs
    _reschedule_folder_backup_jobs()
    
    return jsonify(schedule.to_dict())


@bp.route('/api/backup-schedules/<int:schedule_id>', methods=['DELETE'])
@login_required
def api_delete_backup_schedule(schedule_id):
    """Delete a backup schedule."""
    from backend.models import FolderBackupSchedule
    from backend.extensions import db
    
    schedule = FolderBackupSchedule.query.get_or_404(schedule_id)
    if schedule.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    
    db.session.delete(schedule)
    db.session.commit()
    
    # Re-schedule jobs
    _reschedule_folder_backup_jobs()
    
    return jsonify({'status': 'ok'})


@bp.route('/api/backup-archives', methods=['GET'])
@login_required
def api_list_backup_archives():
    """List backup archives for current user's schedules."""
    from backend.models import FolderBackupArchive, FolderBackupSchedule
    
    schedule_ids = FolderBackupSchedule.query.filter_by(user_id=current_user.id).with_entities(FolderBackupSchedule.id).all()
    schedule_ids = [s[0] for s in schedule_ids]
    
    archives = FolderBackupArchive.query.filter(
        FolderBackupArchive.schedule_id.in_(schedule_ids)
    ).order_by(FolderBackupArchive.completed_at.desc()).limit(100).all()
    
    return jsonify([a.to_dict() for a in archives])
