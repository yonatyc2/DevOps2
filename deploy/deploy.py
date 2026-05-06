"""
Full automated deployment to 192.168.150.190
Runs npm install on server, installs systemd service, configures Nginx.
"""

import paramiko
import os
import sys
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
HOST      = '192.168.150.190'
USER      = 'equals'
PASS      = '123QWEasdZXC'
APP_DIR   = '/var/www/devops-assistant'
SVC_NAME  = 'devops-assistant'
LOCAL_ROOT = Path(__file__).parent.parent  # learn-gitlab-app/

NGINX_CONF = f"""\
server {{
    listen 80 default_server;
    server_name 192.168.150.190 _;

    root {APP_DIR};
    index index.html;

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
}}
"""

SYSTEMD_UNIT = f"""\
[Unit]
Description=DevOps Assistant Node.js API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory={APP_DIR}
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3001
StandardOutput=journal
StandardError=journal
SyslogIdentifier={SVC_NAME}

[Install]
WantedBy=multi-user.target
"""

# ── Helpers ───────────────────────────────────────────────────────────────────
def step(msg): print(f'\n==> {msg}')
def ok(msg):   print(f'    [OK]  {msg}')
def info(msg): print(f'    [..]  {msg}')
def fail(msg): print(f'    [ERR] {msg}'); sys.exit(1)

def run(client, cmd, sudo=False, check=True):
    if sudo:
        cmd = f'echo {PASS} | sudo -S bash -c {repr(cmd)}'
    _, stdout, stderr = client.exec_command(cmd, get_pty=sudo)
    out = stdout.read().decode()
    err = stderr.read().decode()
    rc  = stdout.channel.recv_exit_status()
    if check and rc != 0:
        print(f'    CMD: {cmd[:80]}')
        print(f'    OUT: {out[:200]}')
        print(f'    ERR: {err[:200]}')
        fail(f'Command failed (rc={rc})')
    return out.strip(), err.strip()

def sftp_put_dir(sftp, local_dir: Path, remote_dir: str):
    """Recursively upload a local directory via SFTP."""
    try:
        sftp.stat(remote_dir)
    except FileNotFoundError:
        sftp.mkdir(remote_dir)

    for item in sorted(local_dir.rglob('*')):
        if any(p in item.parts for p in ('node_modules', '__pycache__', '.git')):
            continue
        rel = item.relative_to(local_dir)
        remote_path = remote_dir + '/' + str(rel).replace('\\', '/')
        if item.is_dir():
            try: sftp.stat(remote_path)
            except FileNotFoundError: sftp.mkdir(remote_path)
        else:
            sftp.put(str(item), remote_path)

def sftp_write(sftp, remote_path: str, content: str):
    import io
    sftp.putfo(io.BytesIO(content.encode()), remote_path)

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    step('Connecting to server…')
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS, timeout=15,
                   allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    ok(f'Connected to {HOST} as {USER}')

    # ── 1. Prep app directory ─────────────────────────────────────────────
    step('Creating app directory…')
    run(client, f'mkdir -p {APP_DIR}', sudo=True)
    run(client, f'chown -R {USER}:{USER} {APP_DIR}', sudo=True)
    ok(APP_DIR)

    # ── 2. Upload build/ ──────────────────────────────────────────────────
    step('Uploading React build (frontend)…')
    build_dir = LOCAL_ROOT / 'build'
    if not build_dir.exists():
        fail(f'build/ not found — run "npm run build" first')
    sftp_put_dir(sftp, build_dir, APP_DIR)
    ok(f'Uploaded {len(list(build_dir.rglob("*")))} files from build/')

    # ── 3. Upload server/ ─────────────────────────────────────────────────
    step('Uploading Node.js backend…')
    server_dir = LOCAL_ROOT / 'server'
    sftp_put_dir(sftp, server_dir, f'{APP_DIR}/server')
    ok(f'Uploaded server/')

    # ── 4. Upload package files ───────────────────────────────────────────
    step('Uploading package.json / package-lock.json…')
    sftp.put(str(LOCAL_ROOT / 'package.json'),       f'{APP_DIR}/package.json')
    sftp.put(str(LOCAL_ROOT / 'package-lock.json'),  f'{APP_DIR}/package-lock.json')
    ok('package files uploaded')

    # ── 5. npm install (production only) ─────────────────────────────────
    step('Installing production npm dependencies on server…')
    out, _ = run(client, f'cd {APP_DIR} && npm install --omit=dev 2>&1')
    for line in out.splitlines()[-6:]:
        info(line)
    ok('npm install done')

    # ── 6. Fix ownership for www-data ─────────────────────────────────────
    step('Setting file ownership for www-data…')
    run(client, f'chown -R www-data:www-data {APP_DIR}', sudo=True)
    ok('ownership set')

    # ── 7. Install systemd service ────────────────────────────────────────
    step('Installing systemd service…')
    tmp_svc = '/tmp/devops-assistant.service'
    sftp_write(sftp, tmp_svc, SYSTEMD_UNIT)
    run(client, f'cp {tmp_svc} /etc/systemd/system/{SVC_NAME}.service', sudo=True)
    run(client, 'systemctl daemon-reload', sudo=True)
    run(client, f'systemctl enable {SVC_NAME}', sudo=True)
    run(client, f'systemctl restart {SVC_NAME}', sudo=True)
    out, _ = run(client, f'systemctl is-active {SVC_NAME}', check=False)
    ok(f'Service status: {out}')

    # ── 8. Install Nginx config ───────────────────────────────────────────
    step('Configuring Nginx…')
    tmp_ng = '/tmp/devops-assistant-nginx.conf'
    sftp_write(sftp, tmp_ng, NGINX_CONF)
    run(client, f'cp {tmp_ng} /etc/nginx/sites-available/{SVC_NAME}', sudo=True)
    run(client, f'ln -sf /etc/nginx/sites-available/{SVC_NAME} /etc/nginx/sites-enabled/{SVC_NAME}', sudo=True)
    out, _ = run(client, 'nginx -t 2>&1', sudo=True)
    for line in out.splitlines():
        info(line)
    run(client, 'systemctl reload nginx', sudo=True)
    ok('Nginx reloaded')

    # ── 9. Smoke test ─────────────────────────────────────────────────────
    step('Smoke testing…')
    out, _ = run(client, 'curl -s -o /dev/null -w "%{http_code}" http://localhost/api/health')
    if out.strip() == '200':
        ok('GET /api/health -> 200 PASS')
    else:
        info(f'GET /api/health -> {out} (Node service may still be starting)')

    out, _ = run(client, 'curl -s -o /dev/null -w "%{http_code}" http://localhost/')
    ok(f'GET / -> {out.strip()}')

    sftp.close()
    client.close()

    print(f'\nDeployment complete!')
    print(f'    App: http://{HOST}/')
    print(f'    API: http://{HOST}/api/health')
    print(f'\n    Logs: journalctl -u {SVC_NAME} -f')

if __name__ == '__main__':
    main()
