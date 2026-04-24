# Ascend — Deployment Management System

A modern, web-based deployment panel that turns your VPS into a self-hosted deployment platform. Manage unlimited projects, stream live logs, and auto-deploy on every GitHub push — all from a clean dashboard.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, Tailwind CSS, SWR |
| Backend | Flask, SQLAlchemy, Flask-Login |
| Process manager | PM2 |
| Web server | Nginx + Certbot (auto-SSL) |
| Database | SQLite |

## Features

- **Multi-project dashboard** — manage websites, APIs, CMS, and custom apps from one place
- **Real-time deployment logs** — streamed live to the browser as they happen
- **GitHub webhooks** — auto-deploy on push with HMAC signature verification
- **Nginx + SSL automation** — virtual host and Let's Encrypt cert created automatically
- **Environment variables** — per-project `.env` stored and applied at deploy time
- **Monorepo support** — deploy from a subdirectory of any repository
- **Deployment history** — full log archive for every past deployment

## Ports

| Service | Default port |
|---|---|
| Flask backend | **8716** |
| Next.js frontend | **8717** |

Both are configurable via `.env` / npm scripts and sit well above common VPS service ports (MySQL 3306, PostgreSQL 5432, Redis 6379).

## Project Structure

```
Ascend/
├── app.py                # Flask API — auth, projects, deployments, webhooks
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── frontend/
    ├── pages/            # Next.js pages (login, dashboard, projects, settings)
    ├── components/       # UI components (ProjectCard, DeploymentLogs, …)
    ├── lib/
    │   ├── api.js        # Axios client pointing at the Flask API
    │   ├── store.js      # Zustand global state
    │   └── hooks/
    │       └── useAuth.js  # SWR hooks for auth, projects, deployments
    └── styles/
```

## Installation

### One command (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/mohamadzayyat/Ascend/main/install.sh | sudo bash
```

Or if you already cloned the repo:

```bash
sudo bash install.sh
```

The script handles everything automatically:
- Installs Python 3, Node.js 20, Nginx, Certbot, PM2
- Clones the repo into `/opt/ascend`
- Generates a secure `SECRET_KEY`
- Builds the Next.js frontend
- Creates and starts `ascend-backend` + `ascend-frontend` systemd services
- Opens firewall ports (if ufw is active)

When it finishes, open `http://your-server-ip:8717` and create your admin account.

---

## Manual Setup

### Requirements

- Python 3.9+
- Node.js 18+
- Ubuntu/Debian VPS (for Nginx/PM2/Certbot features)

### 1. Clone

```bash
git clone https://github.com/mohamadzayyat/Ascend.git
cd Ascend
```

### 2. Backend

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env — set SECRET_KEY at minimum

python app.py
# Runs on http://0.0.0.0:8716
```

### 3. Frontend

```bash
cd frontend
npm install

# Development
npm run dev        # http://localhost:8717

# Production
npm run build
npm start
```

### 4. First Login

Open `http://your-vps:8717` → you'll be redirected to `/setup` to create the admin account.

## Configuration

Copy `.env.example` to `.env` and set:

```bash
SECRET_KEY=your-random-secret-key
PORT=8716
CORS_ORIGIN=http://localhost:8717   # or your production domain

# Optional: persist the DB outside the project dir
SQLALCHEMY_DATABASE_URI=sqlite:////opt/ascend/ascend.db
```

For the frontend, edit `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://your-vps:8716
```

## Docker

```bash
docker-compose up -d
```

Nginx handles ports 80/443 publicly; Flask (8716) and Next.js (8717) are internal.

## API Reference

### Auth
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Login (JSON) |
| `POST` | `/api/auth/logout` | Logout |
| `POST` | `/api/auth/setup` | Create first admin |
| `GET` | `/api/current-user` | Current session user |

### Projects
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/projects` | Create project |
| `GET` | `/api/project/{id}` | Get project |
| `PUT` | `/api/project/{id}` | Update project |
| `DELETE` | `/api/project/{id}` | Delete project |

### Deployments
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/project/{id}/deploy` | Trigger deployment |
| `GET` | `/api/project/{id}/deployments` | Deployment history |
| `GET` | `/api/deployment/{id}/status` | Deployment status |
| `GET` | `/api/deployment/{id}/log` | Deployment log |

### Webhook
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/webhook/github/{secret}` | GitHub push webhook |

## Deployment Flow

When a deployment is triggered (manually or via webhook), Ascend:

1. Clones or fast-forwards the repository from GitHub
2. Optionally enters a subdirectory (monorepo support)
3. Writes the project's `.env` file
4. Runs `npm install` (or yarn/pnpm)
5. Runs the build command
6. Restarts the PM2 process
7. Writes the Nginx virtual host and reloads
8. Obtains/renews the SSL certificate via Certbot

All output is streamed to a log file and exposed via the API in real time.

## Production (systemd)

```ini
# /etc/systemd/system/ascend.service
[Unit]
Description=Ascend Deployment Panel
After=network.target

[Service]
User=root
WorkingDirectory=/opt/ascend
Environment="PATH=/opt/ascend/venv/bin"
ExecStart=/opt/ascend/venv/bin/gunicorn -w 4 -b 0.0.0.0:8716 app:app
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable ascend && systemctl start ascend
```

## Nginx reverse proxy (optional)

If you want to serve the frontend through nginx instead of directly on 8717:

```nginx
server {
    listen 80;
    server_name panel.yourdomain.com;

    # Next.js frontend
    location / {
        proxy_pass http://127.0.0.1:8717;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Flask API
    location /api/ {
        proxy_pass http://127.0.0.1:8716;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Troubleshooting

**Frontend can't reach the backend**
- Check `NEXT_PUBLIC_API_URL` in `frontend/.env.local` matches the backend port (8716)
- Ensure `CORS_ORIGIN` in `.env` matches the frontend origin

**Deploy fails immediately**
- Add GitHub credentials first: Settings → GitHub Credentials
- Verify the Personal Access Token has `repo` scope

**SSL certificate fails**
- The domain must point to this VPS before running Certbot
- Check with `dig your-domain.com`

**PM2 process not starting**
- Check logs: `pm2 logs <app-name>`
- Ensure the start command and app port are correct in project settings

## License

MIT
