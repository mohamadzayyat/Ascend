# 🚀 CPanel - Powerful Deployment Management System

A modern, web-based deployment panel that transforms your deployment process into an intuitive interface. Deploy websites, APIs, and CMS platforms from the same GitHub repository with ease.

## Features

✨ **Modern Web Interface** - Built with Next.js and Tailwind CSS
🔐 **Secure** - User authentication and role-based access control
⚡ **Real-time Logs** - Stream deployment logs live to your browser
🔗 **Multi-Project Support** - Manage unlimited deployments
🎯 **Auto-Deployment** - GitHub webhook integration for automatic deployments
📦 **Package Manager Support** - NPM, Yarn, PNPM
🌐 **Domain Management** - Automatic Nginx configuration and SSL with Certbot
💾 **Persistent Storage** - SQLite database for configurations and history
🚀 **PM2 Integration** - Process management and auto-restart
📊 **Dashboard** - Real-time stats and project overview

## Architecture

```
CPanel/
├── app.py                 # Flask backend API
├── requirements.txt       # Python dependencies
├── cpanel.db             # SQLite database
└── frontend/             # Next.js frontend
    ├── pages/
    ├── components/
    ├── lib/
    ├── styles/
    └── package.json
```

## Quick Start

### Prerequisites

- Python 3.9+
- Node.js 16+
- Ubuntu/Debian VPS with root access
- GitHub Personal Access Token (for cloning private repos)

### Backend Setup

1. Clone and enter the project:
```bash
cd /opt/cpanel
```

2. Create Python virtual environment:
```bash
python3 -m venv venv
source venv/bin/activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Set up environment:
```bash
cp .env.example .env
# Edit .env with your settings
```

5. Initialize database:
```bash
flask --app app init-db
```

6. Run the backend:
```bash
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

### Frontend Setup

1. Navigate to frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Build for production:
```bash
npm run build
```

4. Start the frontend:
```bash
npm start
```

Or run in development:
```bash
npm run dev
```

## Using the Panel

### 1. Initial Setup

1. Access http://your-vps:5000/setup
2. Create an admin account
3. Log in to the dashboard

### 2. Add GitHub Credentials

1. Go to Settings → GitHub Credentials
2. Add your GitHub username and Personal Access Token
3. Credentials are saved for future use

### 3. Create a Project

1. Click "New Project" on dashboard
2. Fill in project details:
   - Name, description
   - GitHub URL and branch
   - Project type (Website, API, CMS, Custom)
   - Build and start commands
   - Domain name (optional)
3. Click "Create Project"

### 4. Deploy a Project

1. Go to project details
2. Click "Start Deployment"
3. Watch real-time logs in the Deployments tab
4. Once complete, your app will be running

### 5. Set Up Auto-Deployment

1. Edit project settings
2. Enable "Auto-deploy on GitHub push"
3. Copy the webhook URL from project details
4. Add webhook to GitHub repository settings:
   - Payload URL: `http://your-vps/webhook/github/{webhook_secret}`
   - Content type: application/json
   - Events: Push events

## Supported Project Types

### Website
- HTML, Vue, React, Angular, Next.js
- Automatic Nginx proxy setup
- SSL with Certbot

### API
- Node.js, Python, Ruby
- Port forwarding with Nginx
- Environment variable support

### CMS
- WordPress, Strapi, Ghost
- Database connectivity
- File uploads support

### Custom
- Any Node.js or Python application
- Custom build and start commands

## Environment Variables

Create a `.env` file in the root directory:

```bash
# Flask
SECRET_KEY=your-secret-key-here
FLASK_ENV=production

# Database
DATABASE_URL=sqlite:///cpanel.db

# Server
HOST=0.0.0.0
PORT=5000

# CORS
CORS_ORIGINS=http://localhost:3000,https://your-domain.com
```

## API Endpoints

### Authentication
- `POST /login` - User login
- `POST /logout` - User logout
- `POST /setup` - Initial setup
- `GET /api/current-user` - Get current user

### Projects
- `GET /api/projects` - List projects
- `GET /api/project/{id}` - Get project details
- `POST /project/new` - Create project
- `POST /project/{id}/edit` - Update project
- `POST /project/{id}/delete` - Delete project

### Deployments
- `POST /api/project/{id}/deploy` - Start deployment
- `GET /api/deployment/{id}/status` - Get deployment status
- `GET /api/deployment/{id}/log` - Get deployment logs

### Webhooks
- `POST /webhook/github/{secret}` - GitHub webhook

## Deployment Process

When you click deploy or trigger via webhook, CPanel:

1. **Clone/Update Repository** - Fetches latest code from GitHub
2. **Setup Environment** - Creates .env file with your variables
3. **Install Dependencies** - Runs npm/yarn/pnpm install
4. **Build Project** - Executes build command
5. **Start Application** - Launches with PM2
6. **Configure Nginx** - Sets up reverse proxy
7. **Enable SSL** - Creates/renews SSL certificate with Certbot

All steps are logged in real-time and visible in the deployment logs.

## Scaling to Production

### Using Systemd

Create `/etc/systemd/system/cpanel.service`:

```ini
[Unit]
Description=CPanel Deployment Panel
After=network.target

[Service]
Type=notify
User=root
WorkingDirectory=/opt/cpanel
Environment="PATH=/opt/cpanel/venv/bin"
ExecStart=/opt/cpanel/venv/bin/gunicorn -w 4 -b 0.0.0.0:5000 app:app
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
systemctl enable cpanel
systemctl start cpanel
```

### Reverse Proxy with Nginx

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Troubleshooting

### Deploy fails with "Command not found"
- Ensure all dependencies are installed: `apt-get install -y nodejs npm git nginx certbot python3-certbot-nginx`

### GitHub credentials not working
- Verify your Personal Access Token is still valid
- Check token has `repo` scope permissions

### SSL certificate errors
- Ensure domain is pointing to your VPS
- Check email is valid for Let's Encrypt registration
- Review Certbot logs: `certbot logs`

### PM2 app not starting
- Check app logs: `pm2 logs app-name`
- Verify start command is correct
- Check port is available: `netstat -tlnp`

## Database Schema

SQLite database includes:
- **Users** - Admin accounts
- **Projects** - Deployment configurations
- **Deployments** - Deployment history and logs
- **GitHubCredentials** - Saved GitHub credentials

## Security Notes

1. Always use HTTPS in production
2. Keep your admin password strong
3. Regularly backup your database
4. Limit VPS firewall to necessary ports
5. Use strong GitHub Personal Access Tokens
6. Review deployment logs for any issues

## Performance Tips

1. Use SSD for database and logs
2. Set up log rotation for large deployments
3. Monitor memory usage for build processes
4. Cache dependencies when possible
5. Use CDN for static files

## Support & Contributing

For issues, questions, or contributions:
- Review logs in `/root/deploy_wizard.log`
- Check deployment logs in the panel
- Monitor system resources during builds

## License

MIT License - Feel free to use and modify for your needs

## Changelog

### v1.0.0
- Initial release
- Multi-project deployment support
- Real-time logs streaming
- GitHub webhook integration
- Auto-SSL setup
- PM2 process management
- SQLite persistence
- Modern Next.js frontend

---

Made with ❤️ for developers who want simple, powerful deployments
