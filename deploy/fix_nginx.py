"""
Fix Nginx: add /api/ -> Spring Boot 8080 proxy to BOTH the domain and IP fallback blocks.
"""
import paramiko, io

HOST = '192.168.150.190'
USER = 'equals'
PASS = '123QWEasdZXC'
APP_DIR  = '/var/www/devops-assistant'
SVC_NAME = 'devops-assistant'
DOMAIN   = 'devops-assistant.equals.co.zw'

NGINX_CONF = f"""\
# ── HTTP -> HTTPS redirect (domain) ─────────────────────────────────────────
server {{
    listen 80;
    server_name {DOMAIN};
    return 301 https://$host$request_uri;
}}

# ── HTTPS main site (domain) ─────────────────────────────────────────────────
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

    # Node.js specific routes (port 3001) — must come before /api/ catch-all
    location /api/logs/     {{ proxy_pass http://127.0.0.1:3001; proxy_http_version 1.1; proxy_set_header Host $host; proxy_read_timeout 60s; }}
    location /api/certs/    {{ proxy_pass http://127.0.0.1:3001; proxy_http_version 1.1; proxy_set_header Host $host; proxy_read_timeout 30s; }}
    location /api/registry/ {{ proxy_pass http://127.0.0.1:3001; proxy_http_version 1.1; proxy_set_header Host $host; proxy_read_timeout 30s; }}
    location /api/health    {{ proxy_pass http://127.0.0.1:3001; proxy_http_version 1.1; proxy_set_header Host $host; }}

    # Spring Boot catch-all (port 8080) — servers, chat, snapshot, commands
    location /api/ {{
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_read_timeout 120s;
    }}

    location / {{ try_files $uri $uri/ /index.html; }}

    location ~* \\.(js|css|png|jpg|ico|svg|woff2?)$ {{
        expires 1y;
        add_header Cache-Control "public, immutable";
    }}

    location ~ /\\.(?!well-known) {{ deny all; }}
}}

# ── IP / plain HTTP fallback (default_server) ────────────────────────────────
server {{
    listen 80 default_server;
    server_name 192.168.150.190 _;

    root {APP_DIR};
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/javascript;
    gzip_min_length 1024;

    # Node.js specific routes (port 3001)
    location /api/logs/     {{ proxy_pass http://127.0.0.1:3001; proxy_http_version 1.1; proxy_set_header Host $host; proxy_read_timeout 60s; }}
    location /api/certs/    {{ proxy_pass http://127.0.0.1:3001; proxy_http_version 1.1; proxy_set_header Host $host; proxy_read_timeout 30s; }}
    location /api/registry/ {{ proxy_pass http://127.0.0.1:3001; proxy_http_version 1.1; proxy_set_header Host $host; proxy_read_timeout 30s; }}
    location /api/health    {{ proxy_pass http://127.0.0.1:3001; proxy_http_version 1.1; proxy_set_header Host $host; }}

    # Spring Boot catch-all (port 8080)
    location /api/ {{
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_read_timeout 120s;
    }}

    location / {{ try_files $uri $uri/ /index.html; }}
}}
"""

def run(client, cmd, sudo=False):
    if sudo:
        cmd = f'echo {PASS} | sudo -S bash -c {repr(cmd)}'
    _, stdout, stderr = client.exec_command(cmd, get_pty=sudo)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    stdout.channel.recv_exit_status()
    return out, err

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=10,
               allow_agent=False, look_for_keys=False)
sftp = client.open_sftp()

print('Writing updated Nginx config...')
sftp.putfo(io.BytesIO(NGINX_CONF.encode()), '/tmp/devops-assistant-nginx.conf')
run(client, f'cp /tmp/devops-assistant-nginx.conf /etc/nginx/sites-available/{SVC_NAME}', sudo=True)

print('Testing config...')
out, err = run(client, 'nginx -t 2>&1', sudo=True)
result = (out + err).replace('[sudo] password for equals: ', '').strip()
print(result)

if 'successful' not in result:
    print('ERROR: config test failed - not reloading.')
    sftp.close(); client.close(); exit(1)

print('Reloading Nginx...')
run(client, 'systemctl reload nginx', sudo=True)

print('\nVerifying all routes...')
tests = [
    ('http://127.0.0.1/api/health',    '3001 health'),
    ('http://127.0.0.1/api/servers',   'Spring Boot servers'),
    ('http://127.0.0.1/api/chat/mode', 'Spring Boot chat mode'),
    ('http://127.0.0.1/api/logs/',     '3001 logs (expect 405/200)'),
]
for url, label in tests:
    out, _ = run(client, f'curl -s -o /dev/null -w "%{{http_code}}" {url}')
    print(f'  {out}  {url}  ({label})')

print('\nChecking actual response from /api/chat/mode and /api/servers:')
out, _ = run(client, 'curl -s http://127.0.0.1/api/chat/mode')
print(f'  /api/chat/mode  -> {out}')
out, _ = run(client, 'curl -s http://127.0.0.1/api/servers')
print(f'  /api/servers    -> {out}')

sftp.close()
client.close()
print('\nDone. Hard-refresh the browser (Ctrl+Shift+R) and check the AI Assistant.')
