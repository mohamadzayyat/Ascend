# Ascend

Ascend is a self-hosted VPS control panel for deploying projects, managing databases, monitoring a server, and responding to security issues from a clean web UI.

It is built for the common "one VPS, many apps" workflow: connect GitHub, choose a branch and app type, deploy, manage Nginx/SSL, watch logs, back up databases, and keep an eye on server health without jumping between tools.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, Tailwind CSS, SWR |
| Backend | Flask, SQLAlchemy, Flask-Login |
| Process manager | PM2 |
| Web server | Nginx + Certbot |
| Database | SQLite |
| Security tooling | ClamAV, CrowdSec, system process inspection |

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/mohamadzayyat/Ascend/main/install.sh | sudo bash
```

The installer:

- Clones/updates Ascend in `/opt/ascend`
- Installs Python, Node.js, Nginx, Certbot, PM2, and required packages
- Builds the frontend
- Creates `ascend-backend` and `ascend-frontend` systemd services
- Configures Nginx as the public panel gateway
- Opens port `8716` in common firewalls when available
- Saves initial admin credentials at `/root/.ascend-admin-credentials`

After install, open:

```text
http://your-server-ip:8716
```

Re-run the same command to update Ascend.

## Core Features

### Dashboard

- Server resource summary
- Project/app overview
- Backup health cards
- SSL report
- Critical system alerts
- Recent project activity

### Projects & Deployments

- Multi-project app management
- Website, API, static, Node.js, and PHP app types
- Branch selection from GitHub repositories
- Monorepo/subdirectory support with validation
- Per-app environment variables
- Custom build and run commands
- Deployment history and live logs
- Redeploy, restart, and SSL retry actions
- App disk usage recalculation

### GitHub Integration

- Store GitHub credentials in Settings
- Deploy private or public repositories
- Branch-aware deployment
- GitHub webhook endpoint for push-based deployments
- HMAC-secured webhook secrets

### Nginx & SSL

- Automatic Nginx site generation
- Reverse proxy for dynamic apps
- Static site hosting from build output
- SPA fallback support
- Let's Encrypt certificates through Certbot
- Existing certificate reuse
- Certificate expansion for additional domains such as `www`
- Cloudflare-aware DNS/HTTP preflight behavior
- Client body size configuration

### PHP Hosting

- PHP app type with php-fpm + Nginx
- PHP version selection
- Composer install options
- PHP runtime detection
- PHP version install workflow when a selected version is missing

### Databases

- MySQL/MariaDB connection management
- Create databases with charset/collation defaults
- Default charset/collation: `utf8mb4` / `utf8mb4_general_ci`
- Browse databases, tables, table design, and records
- SQL import support
- SQL query runner
- Manual backups
- Scheduled backups
- Backup history, download, and delete
- Restore backups to an existing database or a new database
- Restore safety backup before replacing an existing database
- Restore progress tracking

### Remote Backups

- Remote upload support using WebDAV-compatible storage
- Koofr-compatible backup upload flow
- Remote backup test action
- Backup upload status displayed in the dashboard
- Ascend panel self-backup and restore in Settings

### Email Notifications

- SMTP configuration
- Sender name and from address
- Test email action
- Professional HTML email templates
- Notification settings for deployments, backups, login, project/app events, terminal/file unlocks, and system alerts
- Sent email log tab with cleanup

### Security Center

- ClamAV install/repair workflow
- Malware scans with selectable paths
- Quarantine support
- Scan findings and logs
- CrowdSec install/repair workflow
- Firewall bouncer repair with service detection
- Active CrowdSec IP blocks
- Manual unblock
- SSH failed-login summaries
- Automatic SSH brute-force blocking
- Threats tab for miner/persistence detection
- Suspicious process detection
- Cron/systemd/profile persistence detection
- Immutable flag detection and repair
- Delete confirmed malicious cleanup backup files

Security detection includes strong indicators such as:

- `xmrig`
- `getxmrig`
- `c3pool`
- `stratum+tcp://` and `stratum+ssl://`
- suspicious `/root/.config/.logrotate` miner persistence

### System

- PM2 process inventory
- Listening ports
- Enabled Nginx sites
- SSL certificate inventory and renewal status
- PHP runtime detection
- Live htop-style process monitor
- Per-core CPU bars
- Load average, uptime, memory, swap, and task count
- Process table with PID, user, state, CPU, memory, RSS, threads, runtime, and command
- Process filtering and pause/resume live refresh

### Files & Terminal

- Web terminal
- Server file manager
- Locked/unlocked security events for terminal and file access

### Settings

- Email settings and email log
- GitHub credentials
- Users
- Two-factor authentication with authenticator setup
- Display settings with multiple dark and light themes
- Ascend self-backup and restore

### Audit & Updates

- Audit log for important actions
- Update Center
- Detached update runner so the update process survives service restarts
- Update status and logs

## Ports

| Service | Default |
|---|---|
| Public Nginx panel gateway | `8716` |
| Flask/Gunicorn backend | `127.0.0.1:8765` |
| Next.js frontend | `127.0.0.1:8717` |

The installer exposes `8716` publicly and keeps backend/frontend internal behind Nginx.

## Project Structure

```text
Ascend/
├── app.py
├── backend/
│   ├── databases/
│   ├── file_manager/
│   ├── security/
│   └── services/
├── frontend/
│   ├── pages/
│   ├── components/
│   ├── lib/
│   └── styles/
├── install.sh
├── requirements.txt
├── Dockerfile
└── docker-compose.yml
```

## Manual Development

### Backend

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Environment

Common backend variables:

```bash
SECRET_KEY=replace-with-a-random-secret
SQLALCHEMY_DATABASE_URI=sqlite:////opt/ascend/ascend.db
```

Common frontend variable:

```bash
NEXT_PUBLIC_API_URL=http://your-server-ip:8716
```

The production installer writes the needed service environment automatically.

## Useful Commands

```bash
systemctl status ascend-backend ascend-frontend nginx
systemctl restart ascend-backend ascend-frontend
journalctl -u ascend-backend -f
journalctl -u ascend-frontend -f
```

Firewall check:

```bash
sudo firewall-cmd --add-port=8716/tcp
sudo firewall-cmd --permanent --add-port=8716/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-ports
```

## API Highlights

| Area | Endpoint Examples |
|---|---|
| Auth | `/api/auth/login`, `/api/auth/logout`, `/api/auth/setup`, `/api/current-user` |
| Projects | `/api/projects`, `/api/project/{id}` |
| Apps | `/api/project/{id}/apps`, `/api/app/{id}` |
| Deployments | `/api/project/{id}/deploy`, `/api/deployment/{id}/log` |
| System | `/api/system/stats`, `/api/system/process-monitor`, `/api/system/pm2`, `/api/system/ports` |
| Databases | `/api/databases/...` |
| Backups | `/api/backups/health`, database backup/restore endpoints |
| Settings | `/api/settings/email-notifications`, `/api/settings/display`, `/api/settings/ascend-backups` |
| Security | `/api/security/status`, `/api/security/scan/start`, `/api/security/threats`, `/api/security/repair` |
| Webhooks | `/webhook/github/{secret}` |

## Troubleshooting

### Panel does not open publicly

- Make sure port `8716` is open in the active firewall.
- Check `systemctl status ascend-backend ascend-frontend nginx`.
- Check Nginx error logs.

### Deployment fails during SSL

- Confirm DNS points to the server.
- If using Cloudflare proxy, make sure SSL mode and proxy settings match your deployment goal.
- For certificate expansion, Ascend passes Certbot the required expansion flow.

### Static site returns 403/500

- Nginx must be able to read the deployed static output.
- Ascend avoids serving static sites directly from unreadable root-only paths.

### CrowdSec detects attackers but blocks do not work

- Open Security Center > IP Protection.
- Use Repair on Firewall bouncer.
- Confirm the bouncer service is active.

### Security tab shows miner persistence

Entries containing `getxmrig`, `xmrig`, `c3pool`, or `stratum+ssl://` are serious indicators. Remove live persistence lines first, then delete Ascend cleanup backups if they are confirmed malicious.

## License

MIT
