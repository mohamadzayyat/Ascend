import html
import json
import re
import smtplib
import ssl
import sys
import threading
from email.message import EmailMessage
from email.utils import formataddr


_db = None
_app = None
_AppSetting = None
_setting_key = None
_event_defaults = None
_encrypt_password = None
_decrypt_password = None


def init_email_notifications(*, app, db, app_setting_model, setting_key, event_defaults, encrypt_password, decrypt_password):
    global _app, _db, _AppSetting, _setting_key, _event_defaults, _encrypt_password, _decrypt_password
    _app = app
    _db = db
    _AppSetting = app_setting_model
    _setting_key = setting_key
    _event_defaults = dict(event_defaults)
    _encrypt_password = encrypt_password
    _decrypt_password = decrypt_password


def _email_notify_defaults():
    return {
        'enabled': False,
        'host': '',
        'port': 587,
        'use_tls': False,
        'use_starttls': True,
        'username': '',
        'from_name': 'Ascend',
        'from_addr': '',
        'notify_to': '',
        'events': dict(_event_defaults or {}),
    }


def _email_notify_settings_load():
    d = _email_notify_defaults()
    rec = _db.session.get(_AppSetting, _setting_key)
    if not rec or not rec.value:
        return d
    try:
        parsed = json.loads(rec.value)
    except (TypeError, ValueError):
        return d
    if not isinstance(parsed, dict):
        return d
    for k in ('enabled', 'host', 'port', 'use_tls', 'use_starttls', 'username', 'from_name', 'from_addr', 'notify_to'):
        if k in parsed:
            d[k] = parsed[k]
    ev = parsed.get('events')
    if isinstance(ev, dict):
        merged = dict(_event_defaults or {})
        for ek, evl in ev.items():
            if ek in merged:
                merged[ek] = bool(evl)
        d['events'] = merged
    pwd_enc = parsed.get('smtp_password_encrypted') or ''
    d['smtp_password_error'] = ''
    try:
        d['smtp_password'] = _decrypt_password(pwd_enc) if pwd_enc else ''
    except Exception as exc:
        d['smtp_password'] = ''
        d['smtp_password_error'] = 'Stored SMTP password could not be decrypted. Re-enter it and save.'
        print(f'[email-notify] stored SMTP password decrypt failed: {exc}', file=sys.stderr)
    return d


def _email_notify_settings_to_api_dict(full):
    out = {k: v for k, v in full.items() if k != 'smtp_password'}
    out['has_password'] = bool(full.get('smtp_password'))
    return out


def _parse_notify_emails(s):
    if not s or not str(s).strip():
        return []
    parts = re.split(r'[\s,;]+', str(s).strip())
    out = []
    seen = set()
    for p in parts:
        q = p.strip()
        if not q or '@' not in q or len(q) > 254:
            continue
        key = q.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(q)
    return out


def _html_escape(s):
    return html.escape(str(s), quote=True)


def _email_html_template(subject, body_plain):
    lines = [ln.rstrip() for ln in str(body_plain or '').splitlines()]
    detail_rows = []
    notes = []
    for ln in lines:
        if ':' in ln and len(detail_rows) < 12:
            k, v = ln.split(':', 1)
            if k.strip() and len(k.strip()) <= 40:
                detail_rows.append((k.strip(), v.strip()))
                continue
        if ln.strip():
            notes.append(ln.strip())
    details_html = ''.join(
        f'<tr><td>{_html_escape(k)}</td><td>{_html_escape(v)}</td></tr>'
        for k, v in detail_rows
    )
    notes_html = ''.join(f'<p>{_html_escape(n)}</p>' for n in notes)
    safe_subject = _html_escape(subject)
    return f'''<!doctype html>
<html>
  <body style="margin:0;background:#f3f6fb;font-family:Inter,Segoe UI,Arial,sans-serif;color:#172033;">
    <div style="display:none;max-height:0;overflow:hidden;">{safe_subject}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6fb;padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #dfe6f2;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background:#111827;padding:24px 28px;color:#ffffff;">
              <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#38bdf8;font-weight:700;">Ascend notification</div>
              <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;font-weight:700;">{safe_subject}</h1>
            </td>
          </tr>
          <tr><td style="padding:26px 28px;">
            {f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:20px;">{details_html}</table>' if details_html else ''}
            <div style="font-size:14px;line-height:1.6;color:#344054;">{notes_html or '<p>Your Ascend panel sent this operational alert.</p>'}</div>
          </td></tr>
          <tr><td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e5eaf3;color:#667085;font-size:12px;">
            Sent by Ascend. Keep this email for your deployment and backup audit trail.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>'''


def _smtp_send_raw(settings_dict, recipients, subject, body_plain):
    host = (settings_dict.get('host') or '').strip()
    if not host:
        raise ValueError('SMTP host is not configured.')
    if not recipients:
        raise ValueError('No recipient addresses.')
    try:
        port = int(settings_dict.get('port') or 587)
    except (TypeError, ValueError):
        port = 587
    use_tls = bool(settings_dict.get('use_tls'))
    use_starttls = bool(settings_dict.get('use_starttls'))
    implicit_ssl = use_tls or (port == 465)
    if implicit_ssl:
        use_starttls = False
    username = (settings_dict.get('username') or '').strip()
    password = settings_dict.get('smtp_password') or ''
    from_addr = (settings_dict.get('from_addr') or '').strip() or username or 'noreply@localhost'
    from_name = (settings_dict.get('from_name') or '').strip() or 'Ascend'

    msg = EmailMessage()
    msg['Subject'] = str(subject)[:900]
    msg['From'] = formataddr((from_name, from_addr))
    msg['To'] = ', '.join(recipients)
    body_plain = str(body_plain)[:500000]
    msg.set_content(body_plain)
    msg.add_alternative(_email_html_template(subject, body_plain), subtype='html')

    ctx = ssl.create_default_context()
    smtp_timeout = 30

    def conn_err(exc):
        hint = (
            'Check the SMTP host spelling (must match your provider, e.g. mail.enmail.co), '
            'that port 465 uses only Implicit TLS (not STARTTLS), and that this server '
            'allows outbound SMTP. Wrong host or blocked port often hangs until timeout.'
        )
        if isinstance(exc, (TimeoutError, ConnectionError, OSError)):
            return ValueError(f'SMTP connection failed or timed out: {exc}. {hint}')
        return exc

    if implicit_ssl:
        try:
            with smtplib.SMTP_SSL(host, port, timeout=smtp_timeout, context=ctx) as smtp:
                if username:
                    smtp.login(username, password)
                smtp.send_message(msg)
        except (TimeoutError, ConnectionError, OSError) as e:
            raise conn_err(e) from e
        return

    try:
        with smtplib.SMTP(host, port, timeout=smtp_timeout) as smtp:
            smtp.ehlo()
            if use_starttls:
                smtp.starttls(context=ctx)
                smtp.ehlo()
            if username:
                smtp.login(username, password)
            smtp.send_message(msg)
    except (TimeoutError, ConnectionError, OSError) as e:
        raise conn_err(e) from e


def _notify_email_send_if_subscribed(event_key, subject, body_plain):
    try:
        full = _email_notify_settings_load()
    except Exception:
        return
    if not full.get('enabled'):
        return
    ev = full.get('events') or {}
    if not ev.get(event_key):
        return
    host = (full.get('host') or '').strip()
    if not host:
        return
    recipients = _parse_notify_emails(full.get('notify_to') or '')
    if not recipients:
        return
    try:
        _smtp_send_raw(full, recipients, subject, body_plain)
    except Exception as e:
        print(f'[email-notify] send failed ({event_key}): {e}', file=sys.stderr)


def _notify_email_async(event_key, subject, body_plain):
    subject = str(subject)[:500]
    body_plain = str(body_plain)[:8000]

    def worker():
        try:
            with _app.app_context():
                _notify_email_send_if_subscribed(event_key, subject, body_plain)
        except Exception as ex:
            print(f'[email-notify] worker ({event_key}): {ex}', file=sys.stderr)

    threading.Thread(target=worker, daemon=True).start()
