#!/bin/bash

# CPanel Quick Start Script
# This script automates the setup process for CPanel deployment panel

set -e

echo "🚀 CPanel Deployment Panel - Quick Setup"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
   echo "❌ This script must be run as root"
   exit 1
fi

# Variables
INSTALL_DIR="/opt/cpanel"
PYTHON_CMD="python3"
NODE_CMD="node"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

echo_error() {
    echo -e "${RED}✗ $1${NC}"
}

echo_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Step 1: Check dependencies
echo_info "Checking dependencies..."

if ! command -v git &> /dev/null; then
    echo_error "Git not found. Installing..."
    apt-get update
    apt-get install -y git
fi
echo_success "Git"

if ! command -v $PYTHON_CMD &> /dev/null; then
    echo_error "Python3 not found. Installing..."
    apt-get install -y python3 python3-pip python3-venv
fi
echo_success "Python3"

if ! command -v $NODE_CMD &> /dev/null; then
    echo_error "Node.js not found. Installing..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
fi
echo_success "Node.js"

if ! command -v nginx &> /dev/null; then
    echo_error "Nginx not found. Installing..."
    apt-get install -y nginx certbot python3-certbot-nginx
fi
echo_success "Nginx"

if ! command -v pm2 &> /dev/null; then
    echo_error "PM2 not found. Installing..."
    npm install -g pm2
fi
echo_success "PM2"

echo ""
echo_info "All dependencies installed!"

# Step 2: Create installation directory
echo_info "Setting up installation directory..."

if [ ! -d "$INSTALL_DIR" ]; then
    mkdir -p "$INSTALL_DIR"
    echo_success "Created $INSTALL_DIR"
else
    echo_info "Directory $INSTALL_DIR already exists"
fi

cd "$INSTALL_DIR"

# Step 3: Clone repository (if not already there)
if [ ! -f "app.py" ]; then
    echo_info "Cloning CPanel repository..."
    
    read -p "Enter GitHub repository URL: " REPO_URL
    
    git clone "$REPO_URL" temp_clone
    mv temp_clone/* .
    rm -rf temp_clone
    
    echo_success "Repository cloned"
else
    echo_info "CPanel files already present, skipping clone"
fi

# Step 4: Setup Python environment
echo_info "Setting up Python environment..."

if [ ! -d "venv" ]; then
    $PYTHON_CMD -m venv venv
    echo_success "Virtual environment created"
fi

source venv/bin/activate

# Upgrade pip
pip install --upgrade pip setuptools wheel

# Install requirements
if [ -f "requirements.txt" ]; then
    pip install -r requirements.txt
    echo_success "Python packages installed"
fi

deactivate

# Step 5: Setup frontend
echo_info "Setting up frontend..."

if [ -d "frontend" ]; then
    cd frontend
    
    if [ ! -d "node_modules" ]; then
        npm install
        echo_success "Frontend dependencies installed"
    fi
    
    if [ ! -d ".next" ]; then
        npm run build
        echo_success "Frontend built"
    fi
    
    cd ..
fi

# Step 6: Create .env file
echo_info "Creating environment configuration..."

if [ ! -f ".env" ]; then
    cat > .env << 'EOF'
SECRET_KEY=change-this-to-a-random-secret-key
FLASK_ENV=production
DEBUG=False
SQLALCHEMY_DATABASE_URI=sqlite:////opt/cpanel/cpanel.db
HOST=0.0.0.0
PORT=5000
MAX_CONTENT_LENGTH=52428800
DEPLOYMENT_DIR=/root/deployments
LOG_DIR=/root/deploy_logs
EOF
    
    # Generate a random secret key
    SECRET=$(openssl rand -hex 32)
    sed -i "s/change-this-to-a-random-secret-key/$SECRET/" .env
    
    echo_success ".env file created with random secret key"
else
    echo_info ".env file already exists"
fi

# Step 7: Initialize database
echo_info "Initializing database..."

source venv/bin/activate
$PYTHON_CMD -c "from app import app, db; app.app_context().push(); db.create_all()"
deactivate

echo_success "Database initialized"

# Step 8: Create necessary directories
echo_info "Creating necessary directories..."

mkdir -p /root/deployments
mkdir -p /root/deploy_logs
mkdir -p /var/log/cpanel
mkdir -p "$INSTALL_DIR/backups"

chmod -R 755 /root/deployments
chmod -R 755 /root/deploy_logs
chmod -R 755 /var/log/cpanel

echo_success "Directories created"

# Step 9: Create PM2 config
echo_info "Creating PM2 configuration..."

cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'cpanel-backend',
      script: './venv/bin/python',
      args: '-m gunicorn -w 4 -b 127.0.0.1:5000 app:app',
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
        NEXT_PUBLIC_API_URL: 'http://localhost:5000',
      },
    },
  ],
}
EOF

echo_success "PM2 configuration created"

# Step 10: Setup Nginx
echo_info "Setting up Nginx configuration..."

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
    client_max_body_size 100M;

    location /api/ {
        proxy_pass http://cpanel_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
    }

    location /webhook/ {
        proxy_pass http://cpanel_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /login {
        proxy_pass http://cpanel_backend;
        proxy_set_header Host $host;
    }

    location /logout {
        proxy_pass http://cpanel_backend;
        proxy_set_header Host $host;
    }

    location /setup {
        proxy_pass http://cpanel_backend;
        proxy_set_header Host $host;
    }

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

ln -sf /etc/nginx/sites-available/cpanel /etc/nginx/sites-enabled/cpanel
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl restart nginx

echo_success "Nginx configured"

# Step 11: Start PM2
echo_info "Starting services with PM2..."

cd "$INSTALL_DIR"
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

echo_success "Services started with PM2"

# Summary
echo ""
echo "=========================================="
echo -e "${GREEN}✓ CPanel setup completed!${NC}"
echo "=========================================="
echo ""
echo "📝 Next steps:"
echo ""
echo "1. Access CPanel at http://$(hostname -I | awk '{print $1}')"
echo ""
echo "2. Complete the setup wizard:"
echo "   - Create an admin account"
echo "   - Configure GitHub credentials"
echo ""
echo "3. Create your first project:"
echo "   - Add project details"
echo "   - Configure deployment settings"
echo "   - Click Deploy"
echo ""
echo "📊 Monitor services:"
echo "   pm2 monit              - Real-time monitoring"
echo "   pm2 logs               - View logs"
echo "   pm2 restart all        - Restart services"
echo ""
echo "🔧 Manage CPanel:"
echo "   cd $INSTALL_DIR"
echo "   source venv/bin/activate"
echo "   python3 app.py         - Run locally (dev mode)"
echo ""
echo "📖 Documentation:"
echo "   README.md              - Full documentation"
echo "   DEPLOYMENT_GUIDE.md    - Deployment guide"
echo ""
echo -e "${YELLOW}⚠ Remember to:${NC}"
echo "   - Change SECRET_KEY in .env for production"
echo "   - Set up SSL certificate (certbot)"
echo "   - Configure firewall rules"
echo "   - Set up regular backups"
echo ""
