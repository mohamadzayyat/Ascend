FROM ubuntu:22.04

# Install dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    nodejs \
    npm \
    git \
    curl \
    nginx \
    certbot \
    python3-certbot-nginx \
    && rm -rf /var/lib/apt/lists/*

# Install PM2 globally
RUN npm install -g pm2

# Create app directory
WORKDIR /opt/cpanel

# Copy application
COPY . .

# Setup Python environment
RUN python3 -m venv venv
RUN . venv/bin/activate && pip install -r requirements.txt

# Setup frontend
WORKDIR /opt/cpanel/frontend
RUN npm install
RUN npm run build

# Back to root
WORKDIR /opt/cpanel

# Create necessary directories
RUN mkdir -p /var/log/cpanel
RUN mkdir -p /root/deployments
RUN mkdir -p /root/deploy_logs

# Expose ports (nginx on 80/443, backend on 8716, frontend on 8717)
EXPOSE 80 443 8716 8717

# Create startup script
RUN echo '#!/bin/bash\n\
pm2-runtime start ecosystem.config.js\n\
' > /start.sh && chmod +x /start.sh

CMD ["/start.sh"]
