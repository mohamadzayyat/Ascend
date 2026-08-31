#!/usr/bin/env python3
"""Reconcile legacy Brainspace tenant vhosts into Ascend's Nginx front door."""

from __future__ import annotations

import re
import sqlite3
import subprocess
from pathlib import Path


VHOST_ROOT = Path('/usr/local/lsws/conf/vhosts')
OUTPUT_ROOT = Path('/etc/nginx/ascend-brainspace-sites')
HOST_LIST = Path('/etc/haproxy/brainspace-hosts.lst')
ASCEND_DB = Path('/opt/ascend/cpanel.db')


def _proxy_routes(config: str) -> dict[str, str]:
    return dict(re.findall(
        r'extprocessor\s+([^\s{]+)\s*\{(?:(?!\n\}).)*?type\s+proxy'
        r'(?:(?!\n\}).)*?address\s+([^\s]+)',
        config,
        re.S,
    ))


def _handler(config: str, location: str) -> str | None:
    match = re.search(
        rf'context\s+{re.escape(location)}\s*\{{(?:(?!\n\}}).)*?handler\s+([^\s]+)',
        config,
        re.S,
    )
    return match.group(1) if match else None


def _value(config: str, key: str) -> str | None:
    match = re.search(rf'{re.escape(key)}\s+([^\s]+)', config)
    return match.group(1) if match else None


def _render_http_challenge(host: str) -> str:
    """Register a new tenant before its certificate exists.

    Certbot's HTTP-01 request must reach the shared webroot before we can render
    the HTTPS server. The next reconciliation promotes this configuration once
    the certificate and key appear.
    """
    return f'''server {{
    listen 127.0.0.1:8080;
    server_name {host};
    location /.well-known/acme-challenge/ {{ root /usr/local/lsws/Example/html; }}
    location / {{ return 503; }}
}}
'''


def _render(host: str, upstream: str, certificate: str, key: str, socket: str | None) -> str:
    socket_location = ''
    if socket:
        socket_location = f'''    location /socket.io/ {{
        proxy_pass http://{socket};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
    }}
'''
    return f'''server {{
    listen 127.0.0.1:8080;
    server_name {host};
    location /.well-known/acme-challenge/ {{ root /usr/local/lsws/Example/html; }}
    location / {{ return 301 https://$host$request_uri; }}
}}
server {{
    listen 127.0.0.1:8443 ssl;
    server_name {host};
    ssl_certificate {certificate};
    ssl_certificate_key {key};
    client_max_body_size 6G;
{socket_location}    location / {{
        proxy_pass http://{upstream};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 86400s;
    }}
}}
'''


def main() -> int:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    desired: dict[Path, str] = {}
    hosts: set[str] = set()
    managed: set[str] = set()
    if ASCEND_DB.exists():
        with sqlite3.connect(ASCEND_DB) as connection:
            for (domain,) in connection.execute(
                "select domain from app where length(coalesce(domain, '')) > 0"
            ):
                domain = domain.strip().lower()
                if domain and (Path('/etc/nginx/sites-enabled') / domain).exists():
                    hosts.add(domain)
                    managed.add(domain)
                    if domain.count('.') == 1:
                        hosts.add(f'www.{domain}')
    directories = list(VHOST_ROOT.glob('*.brain-space.app')) + [VHOST_ROOT / 'brain-space.app']
    for directory in directories:
        source = directory / 'vhost.conf'
        if not source.is_file():
            continue
        host = directory.name
        # A site generated directly by Ascend takes precedence over translation.
        if (Path('/etc/nginx/sites-enabled') / host).exists():
            hosts.add(host)
            managed.add(host)
            continue
        config = source.read_text(errors='ignore')
        proxies = _proxy_routes(config)
        root_handler = _handler(config, '/')
        if not root_handler or root_handler not in proxies:
            continue
        hosts.add(host)
        output = OUTPUT_ROOT / f'{host}.conf'
        certificate = _value(config, 'certFile')
        key = _value(config, 'keyFile')
        if not certificate or not key or not Path(certificate).exists() or not Path(key).exists():
            desired[output] = _render_http_challenge(host)
            continue
        socket_handler = _handler(config, '/socket.io/')
        socket = proxies.get(socket_handler) if socket_handler else None
        desired[output] = _render(
            host, proxies[root_handler], certificate, key, socket
        )

    changed = False
    for path in OUTPUT_ROOT.glob('*.conf'):
        if path not in desired and (path.stem not in hosts or path.stem in managed):
            path.unlink()
            changed = True
    for path, content in desired.items():
        if not path.exists() or path.read_text() != content:
            path.write_text(content)
            changed = True
    host_content = ''.join(f'{host}\n' for host in sorted(hosts))
    if not HOST_LIST.exists() or HOST_LIST.read_text() != host_content:
        HOST_LIST.write_text(host_content)
        changed = True
    if changed:
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
        subprocess.run(['haproxy', '-c', '-f', '/etc/haproxy/haproxy.cfg'], check=True)
        subprocess.run(['systemctl', 'reload', 'haproxy'], check=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
