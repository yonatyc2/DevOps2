"""
Reconfigure devops-assistant nginx vhost:
  - server_name: devops-assistant.equals.co.zw
  - HTTP  (80)  → redirect to HTTPS
  - HTTPS (443) → serve app + proxy Node.js API
  - Uses existing wildcard cert star.equals.co.zw
"""
import paramiko, io

HOST = '192.168.150.190'
USER = 'equals'
PASS = '123QWEasdZXC'
APP_DIR   = '/var/www/devops-assistant'
SVC_NAME  = 'devops-assistant'
DOMAIN    = 'devops-assistant.equals.co.zw'

NGINX_CONF = f"""\
server {{
    listen 80;
    server_name {DOMAIN};
    return 301 https://$host$request_uri;
}}

server {{
    listen 443 ssl http2;
    server_name {DOMAIN};

    ssl_certificate     /etc/ssl/equals/star.equals.co.zw.crt;
    ssl_certificate_key /etc/ssl/equals/star.equals.co.zw.key;

    root {APP_DIR};
    index index.html;

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/javascript;
    gzip_min_length 1024;

    location /api/logs/ {{
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_read_timeout 60s;
    }}

    location /api/certs/ {{
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_read_timeout 30s;
    }}

    location /api/registry/ {{
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_read_timeout 30s;
    }}

    location /api/health {{
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
    }}

    location / {{
        try_files $uri $uri/ /index.html;
    }}

    location ~* \\.(js|css|png|jpg|ico|svg|woff2?)$ {{
        expires 1y;
        add_header Cache-Control "public, immutable";
    }}

    location ~ /\\.(?!well-known) {{
        deny all;
    }}
}}

# Keep IP access working (no default_server conflict now)
server {{
    listen 80 default_server;
    server_name 192.168.150.190 _;
    root {APP_DIR};
    index index.html;

    location /api/logs/     {{ proxy_pass http://127.0.0.1:3001; proxy_http_version 1.1; proxy_set_header Host $host; }}
    location /api/certs/    {{ proxy_pass http://127.0.0.1:3001; proxy_http_version 1.1; proxy_set_header Host $host; }}
    location /api/registry/ {{ proxy_pass http://127.0.0.1:3001; proxy_http_version 1.1; proxy_set_header Host $host; }}
    location /api/health    {{ proxy_pass http://127.0.0.1:3001; proxy_http_version 1.1; proxy_set_header Host $host; }}
    location / {{ try_files $uri $uri/ /index.html; }}
}}
"""

def run(client, cmd, sudo=False, check=True):
    if sudo:
        cmd = f'echo {PASS} | sudo -S bash -c {repr(cmd)}'
    _, stdout, stderr = client.exec_command(cmd, get_pty=sudo)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    rc  = stdout.channel.recv_exit_status()
    return out, err

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=10,
               allow_agent=False, look_for_keys=False)
sftp = client.open_sftp()

print('Checking SSL cert exists...')
out, _ = run(client, 'ls -la /etc/ssl/equals/')
print(out)

print('\nWriting new nginx config...')
sftp.putfo(io.BytesIO(NGINX_CONF.encode()), '/tmp/devops-assistant-nginx.conf')
run(client, f'cp /tmp/devops-assistant-nginx.conf /etc/nginx/sites-available/{SVC_NAME}', sudo=True)

print('Testing config...')
out, err = run(client, 'nginx -t 2>&1', sudo=True)
combined = (out + err).replace('[sudo] password for equals: ', '').strip()
print(combined)

if 'successful' not in combined:
    print('ERROR: nginx config test failed — not reloading.')
else:
    print('Reloading nginx...')
    run(client, 'systemctl reload nginx', sudo=True)

    print('\nVerifying routing...')
    out, _ = run(client, f'curl -sk -o /dev/null -w "HTTPS %{{http_code}}" https://127.0.0.1/ -H "Host: {DOMAIN}"')
    print(f'  https://{DOMAIN}  -> {out}')

    out, _ = run(client, f'curl -s -o /dev/null -w "HTTP  %{{http_code}}" http://127.0.0.1/ -H "Host: {DOMAIN}"')
    print(f'  http://{DOMAIN}   -> {out}  (expect 301 redirect)')

    out, _ = run(client, 'curl -s -o /dev/null -w "IP    %{http_code}" http://127.0.0.1/')
    print(f'  http://192.168.150.190   -> {out}')

sftp.close()
client.close()

print(f'\nDone.')
print(f'  HTTPS: https://{DOMAIN}/')
print(f'  HTTP → HTTPS redirect active')
print(f'  DNS:  point {DOMAIN} -> 192.168.150.190')
