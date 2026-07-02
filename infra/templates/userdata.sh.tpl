#!/bin/bash
set -euxo pipefail
exec > >(tee /var/log/userdata.log | logger -t user-data) 2>&1

dnf update -y
dnf install -y python3.11 python3.11-pip nginx git

python3.11 -m pip install --upgrade pip

APP_DIR=/opt/investment_manager

%{ if git_repo_url != "" }
git clone --branch ${git_branch} ${git_repo_url} $APP_DIR
%{ else }
mkdir -p $APP_DIR
echo "Manual deploy: copy your project files to $APP_DIR" > $APP_DIR/README_DEPLOY.txt
%{ endif }

cd $APP_DIR
if [ -f requirements.txt ]; then
  python3.11 -m pip install -r requirements.txt
fi

cat > /etc/systemd/system/investment-manager.service <<'SERVICE'
[Unit]
Description=4RCH3R Investment Manager (FastAPI)
After=network.target

[Service]
User=nobody
Group=nobody
WorkingDirectory=/opt/investment_manager
ExecStart=/usr/local/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 1
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=investment-manager
Environment=AWS_DEFAULT_REGION=${aws_region}

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable investment-manager

if [ -f $APP_DIR/backend/main.py ]; then
  systemctl start investment-manager
fi

cat > /etc/nginx/conf.d/investment-manager.conf <<'NGINX'
server {
    listen 80 default_server;
    server_name _;

    location / {
        proxy_pass         http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 310s;
        proxy_send_timeout 310s;
        client_max_body_size 50M;
    }
}
NGINX

rm -f /etc/nginx/conf.d/default.conf
nginx -t && systemctl enable --now nginx

%{ if enable_ssl == "true" && domain_name != "" }
dnf install -y augeas-libs
python3.11 -m pip install certbot certbot-nginx
certbot --nginx \
  --non-interactive \
  --agree-tos \
  --email "${admin_email}" \
  -d "${domain_name}" \
  --redirect
echo "0 3 * * * root certbot renew --quiet" > /etc/cron.d/certbot-renew
%{ endif }

echo "UserData complete"
