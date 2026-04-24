# CPanel VPS Deployment Guide

Complete guide to deploy CPanel on your Ubuntu/Debian VPS.

## Step 1: Server Preparation

SSH into your VPS as root:

```bash
ssh root@your-vps-ip
```

Update system:
```bash
apt-get update && apt-get upgrade -y
```

Install core dependencies:
```bash
apt-get install -y \
    build-essential \
    curl \
    wget \
    git \
    python3 \
    python3-pip \
    python3-venv \
    nodejs \
    npm \
    nginx \
    certbot \
    python3-certbot-nginx \
    pm2
```

Install PM2 globally:
```bash
npm install -g pm2
pm2 startup
```

## Step 2: Clone CPanel Repository

```bash
cd /opt
git clone https://github.com/YOUR_USERNAME/cpanel.git
cd cpanel
chmod +x *.py
```

## Step 3: Backend Setup

Create virtual environment:
```bash
python3 -m venv venv
source venv/bin/activate
```

Install Python packages:
```bash
pip install -r requirements.txt
```

Create .env file:
```bash
cp .env.example .env
nano .env
```

Edit as needed (most defaults are fine for production).

Initialize the database:
```bash
python3 -c "from app import app, db; app.app_context().push(); db.create_all()"
```

## Step 4: Frontend Setup

Navigate to frontend:
```bash
cd frontend
npm install
npm run build
```

## Step 5: Run with PM2

Create PM2 ecosystem config:

```bash
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'cpanel-backend',
      script: './venv/bin/python',
      args: '-m gunicorn --worker-class gthread -w 4 --threads 8 -b 127.0.0.1:5000 --timeout 0 app:app',
      cwd: '/opt/cpanel',
      instances: 1,
      exec_mode: 'cluster',
      error_file: '/var/log/cpanel/backend-error.log',
      out_file: '/var/log/cpanel/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 4000,
      watch: false,
      max_memory_restart: '1G',
    },
    {
      name: 'cpanel-frontend',
      script: 'npm',
      args: 'start',
      cwd: '/opt/cpanel/frontend',
      instances: 1,
      exec_mode: 'fork',
      error_file: '/var/log/cpanel/frontend-error.log',
      out_file: '/var/log/cpanel/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 4000,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
EOF
```

Create log directory:
```bash
mkdir -p /var/log/cpanel
```

Start with PM2:
```bash
cd /opt/cpanel
pm2 start ecosystem.config.js
pm2 save
```

Monitor processes:
```bash
pm2 monit
```

## Step 6: Nginx Configuration

Create Nginx config:

```bash
cat > /etc/nginx/sites-available/cpanel << 'EOF'
upstream cpanel_backend {
    server 127.0.0.1:5000;
}

upstream cpanel_frontend {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name _;
    client_max_body_size 6G;
    
    # Redirect to HTTPS (after SSL setup)
    # return 301 https://$server_name$request_uri;

    # API
    location /api/ {
        proxy_pass http://cpanel_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_connect_timeout 300s;
    }

    # Webhooks
    location /webhook/ {
        proxy_pass http://cpanel_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Frontend
    location / {
        proxy_pass http://cpanel_frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Connection "upgrade";
        proxy_set_header Upgrade $http_upgrade;
    }
}
EOF
```

Enable site:
```bash
ln -s /etc/nginx/sites-available/cpanel /etc/nginx/sites-enabled/cpanel
rm /etc/nginx/sites-enabled/default
```

Test and reload Nginx:
```bash
nginx -t
systemctl reload nginx
```

## Step 7: SSL Setup (Optional but Recommended)

Get SSL certificate:
```bash
certbot --nginx -d your-domain.com -d www.your-domain.com
```

Auto-renewal:
```bash
systemctl enable certbot.timer
systemctl start certbot.timer
```

## Step 8: Firewall Setup

If using UFW:
```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

## Step 9: Access the Panel

1. Visit `http://your-vps-ip` or `https://your-domain.com`
2. Complete the setup form to create admin account
3. Log in and start creating projects!

## Step 10: Backup Strategy

Create backup script:

```bash
cat > /opt/cpanel/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/opt/cpanel/backups"
mkdir -p $BACKUP_DIR
DATE=$(date +%Y%m%d_%H%M%S)

# Backup database
cp /opt/cpanel/cpanel.db $BACKUP_DIR/cpanel_$DATE.db

# Keep only last 7 days
find $BACKUP_DIR -name "cpanel_*.db" -mtime +7 -delete

echo "Backup completed: $BACKUP_DIR/cpanel_$DATE.db"
EOF

chmod +x /opt/cpanel/backup.sh
```

Add to crontab:
```bash
crontab -e
# Add: 0 2 * * * /opt/cpanel/backup.sh
```

## Monitoring

Check PM2 logs:
```bash
pm2 logs cpanel-backend
pm2 logs cpanel-frontend
```

Check Nginx errors:
```bash
tail -f /var/log/nginx/error.log
```

Check system resources:
```bash
pm2 monit
```

## Updates

To update CPanel:

```bash
cd /opt/cpanel
git pull origin main
# Restart services
pm2 restart all
```

## Troubleshooting

### Ports already in use
```bash
# Find process on port
lsof -i :5000
lsof -i :3000
lsof -i :80

# Kill process
kill -9 PID
```

### PM2 not starting
```bash
# Clear PM2 cache
pm2 flush
pm2 kill
pm2 start ecosystem.config.js
```

### Database errors
```bash
# Reinitialize database
rm /opt/cpanel/cpanel.db
python3 -c "from app import app, db; app.app_context().push(); db.create_all()"
```

### Permission issues
```bash
# Ensure proper ownership
chown -R root:root /opt/cpanel
chmod -R 755 /opt/cpanel
```

## Production Checklist

- [ ] Server updated and patched
- [ ] All dependencies installed
- [ ] Python virtual environment created
- [ ] .env file configured
- [ ] Database initialized
- [ ] Frontend built for production
- [ ] PM2 configured and running
- [ ] Nginx configured and tested
- [ ] SSL certificate installed
- [ ] Firewall rules configured
- [ ] Backup script running
- [ ] Admin account created and password changed
- [ ] GitHub credentials configured
- [ ] First project deployed successfully

## Performance Tips

1. Use SSD storage
2. Configure swap if RAM < 2GB
3. Enable HTTP2 in Nginx
4. Use gzip compression
5. Monitor PM2 memory usage
6. Set up log rotation

## Support

For issues:
1. Check PM2 logs
2. Check Nginx error log
3. Review deployment logs in CPanel UI
4. Check system resources with `pm2 monit`

---

That's it! Your CPanel deployment panel is now running on your VPS.
