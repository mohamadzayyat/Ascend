# CPanel Quick Reference

## 🚀 Quick Start Commands

### Initial Setup
```bash
sudo bash setup.sh                    # Automated setup script
# Then visit: http://your-vps/setup
```

### Manual Start/Stop
```bash
cd /opt/cpanel

# Start all services
pm2 start ecosystem.config.js

# Stop all services
pm2 stop all

# Restart all services
pm2 restart all

# View logs
pm2 logs
pm2 logs cpanel-backend
pm2 logs cpanel-frontend

# Monitor
pm2 monit
```

---

## 📝 Common Tasks

### Add a New Project

1. Click **+ New Project** on dashboard
2. Fill in project details:
   - **Name**: Human-readable project name
   - **GitHub URL**: `https://github.com/user/repo`
   - **Branch**: `main` (or your branch)
   - **Type**: Website/API/CMS/Custom
   - **Folder Name**: Where to clone (e.g., `myapp`)
3. Add build commands:
   - **Build**: `npm run build`
   - **Start**: `npm start`
4. Set domain (optional) for auto Nginx config
5. Click **Create Project**

### Deploy a Project

**Option 1: Manual Deploy**
1. Go to project details
2. Click **Start Deployment** button
3. Watch logs in **Deployments** tab
4. Done!

**Option 2: Auto-Deploy via Webhook**
1. Go to project settings
2. Enable **Auto-deploy on GitHub push**
3. Copy webhook URL
4. Go to GitHub repo → Settings → Webhooks
5. Add webhook with:
   - **Payload URL**: `http://your-vps/webhook/github/{webhook_secret}`
   - **Content type**: `application/json`
   - **Events**: Push events

### Configure Environment Variables

1. Go to project → Settings tab
2. Scroll to **Environment Variables**
3. Enter variables in format:
   ```
   DATABASE_URL=postgresql://user:pass@host/db
   API_KEY=your-secret-key
   NODE_ENV=production
   ```
4. Click **Save Changes**
5. Redeploy for changes to take effect

### Add GitHub Credentials

1. Go to **GitHub Credentials** in sidebar
2. Click **Add Credentials**
3. Enter GitHub username
4. Generate Personal Access Token:
   - GitHub → Settings → Developer settings → Personal access tokens → Generate new token
   - Scopes: `repo` (full control)
   - Copy token
5. Paste token in panel
6. Click **Add**

### Setup Custom Domain & SSL

1. Point domain DNS to your VPS IP
2. Go to project → Settings
3. Enter **Domain**: `example.com`
4. Enable **Enable SSL**
5. Save changes
6. Deploy the project
7. Certbot will automatically create SSL certificate

---

## 🔍 Troubleshooting

### Project won't deploy
```bash
# Check PM2 logs
pm2 logs cpanel-backend

# Check Nginx errors
tail -f /var/log/nginx/error.log

# Restart services
pm2 restart all
```

### "GitHub credentials not working"
```bash
# Verify credentials in panel
# Settings → GitHub Credentials

# Check token is still valid:
# GitHub → Settings → Developer settings → Personal access tokens

# Token needs "repo" scope
```

### "Port already in use"
```bash
# Find process on port
lsof -i :5000
lsof -i :3000

# Kill process
kill -9 <PID>

# Or use different port in ecosystem.config.js
```

### "Nginx won't reload"
```bash
# Test Nginx config
nginx -t

# Check for syntax errors
# Review /etc/nginx/sites-available/cpanel

# Restart Nginx
systemctl restart nginx
```

### "SSL certificate error"
```bash
# Check domain points to VPS
nslookup your-domain.com

# Check Certbot logs
certbot logs

# Manual renewal
certbot renew --force-renewal

# Check permissions
sudo chown -R root:root /etc/letsencrypt/
```

### "Application not starting with PM2"
```bash
# Check application logs
pm2 logs app-name

# Verify start command works manually
cd /root/deployments/your-app
npm start          # or your start command

# Check available port
netstat -tlnp | grep :5000
```

### Database issues
```bash
# Reset database (WARNING: deletes all data)
rm /opt/cpanel/cpanel.db
python3 -c "from app import app, db; app.app_context().push(); db.create_all()"

# Backup database
cp /opt/cpanel/cpanel.db /opt/cpanel/backups/cpanel_$(date +%s).db
```

---

## 📊 Monitoring & Maintenance

### Check System Health
```bash
# Real-time monitoring
pm2 monit

# Check processes
pm2 list

# Check disk usage
df -h

# Check memory usage
free -h

# Check running processes
ps aux | grep cpanel
```

### View Logs
```bash
# All PM2 apps
pm2 logs

# Specific app
pm2 logs cpanel-backend
pm2 logs cpanel-frontend

# Last N lines
pm2 logs --lines 50

# Nginx access logs
tail -f /var/log/nginx/access.log

# Nginx error logs
tail -f /var/log/nginx/error.log
```

### Restart Services
```bash
# Restart specific service
pm2 restart cpanel-backend
pm2 restart cpanel-frontend

# Restart all
pm2 restart all

# Reload (zero-downtime)
pm2 reload all

# Delete and restart
pm2 delete all
pm2 start ecosystem.config.js
```

---

## 🔧 Advanced Configuration

### Change Backend Port
Edit `/opt/cpanel/ecosystem.config.js`:
```javascript
args: '-m gunicorn -w 4 -b 127.0.0.1:5001 app:app',  // Change 5000 to 5001
```
Then update Nginx config.

### Change Frontend Port
Edit `/opt/cpanel/ecosystem.config.js`:
```javascript
env: {
  NODE_ENV: 'production',
  PORT: '3001',  // Change 3000 to 3001
  NEXT_PUBLIC_API_URL: 'http://localhost:5000',
}
```

### Add More Worker Processes
Edit `/opt/cpanel/ecosystem.config.js`:
```javascript
instances: 4,  // Increase worker count
exec_mode: 'cluster',
```

### Set Environment Variables
Edit `/opt/cpanel/.env`:
```bash
# Change these values
FLASK_ENV=production
SECRET_KEY=your-random-key
PORT=5000
```

---

## 🚀 Deployment Process Flow

```
1. User initiates deploy
   ↓
2. Deployment record created (status: pending)
   ↓
3. Background thread starts
   ↓
4. Clone/update Git repository
   ↓
5. Write .env file
   ↓
6. Install dependencies
   ↓
7. Build application
   ↓
8. Stop old PM2 process (if exists)
   ↓
9. Start new PM2 process
   ↓
10. Configure Nginx (if domain set)
   ↓
11. Setup SSL (if enabled)
   ↓
12. Mark complete (status: success/failed)
   ↓
Application is online!
```

---

## 📚 File Structure

```
/opt/cpanel/
├── app.py                      # Flask backend
├── requirements.txt            # Python dependencies
├── cpanel.db                   # SQLite database
├── ecosystem.config.js         # PM2 configuration
├── .env                        # Environment variables
├── .env.example               # Environment template
├── setup.sh                   # Setup script
├── README.md                  # Full documentation
├── DEPLOYMENT_GUIDE.md        # Deployment guide
├── FEATURES.md                # Feature list
├── quick_ref.md               # This file
├── logs/                      # Application logs
├── backups/                   # Database backups
└── frontend/                  # Next.js frontend
    ├── pages/                 # Page components
    ├── components/            # Reusable components
    ├── lib/                   # Utilities & hooks
    ├── styles/                # CSS files
    ├── package.json
    └── .next/                 # Built assets
```

---

## 🔐 Security Checklist

- [ ] Change SECRET_KEY in .env
- [ ] Strong admin password (10+ chars)
- [ ] GitHub token with minimal scope
- [ ] SSL certificate enabled
- [ ] Firewall configured
- [ ] Regular backups (cron job)
- [ ] Monitor logs regularly
- [ ] Keep system updated
- [ ] Use strong database password
- [ ] Restrict access to admin IPs

---

## 💰 Resource Recommendations

### Minimum
- 1 CPU
- 1 GB RAM
- 20 GB Disk
- Good for: 1-3 small projects

### Recommended
- 2 CPUs
- 2-4 GB RAM
- 50-100 GB SSD
- Good for: 5-20 projects

### Production
- 4+ CPUs
- 8+ GB RAM
- 200+ GB SSD
- Good for: 20+ projects, high traffic

---

## 🆘 Getting Help

### Check Logs
1. Project deployment logs (in panel)
2. PM2 logs: `pm2 logs`
3. Nginx logs: `/var/log/nginx/`
4. System logs: `journalctl -xe`

### Common Issues Location
- Backend errors: `/opt/cpanel/logs/`
- Frontend build: `/opt/cpanel/frontend/.next/`
- Deployments: `/root/deploy_logs/`

### Reset/Reinstall
```bash
# Full reset (WARNING: Loses all data)
sudo bash setup.sh                    # Run setup again
```

---

Made with ❤️ for developers who want simple deployments
