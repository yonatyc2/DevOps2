"""
Deploy Node.js backend changes + update Nginx config.
Uploads server/ files, creates data/ directory, restarts service, patches Nginx.
"""
import paramiko, io, sys
from pathlib import Path

HOST     = '192.168.150.190'
USER     = 'equals'
PASS     = '123QWEasdZXC'
APP_DIR  = '/var/www/devops-assistant'
SVC_NAME = 'devops-assistant'
LOCAL_ROOT = Path(__file__).parent.parent

# Read nginx.conf from repo
NGINX_CONF = (LOCAL_ROOT / 'deploy' / 'nginx.conf').read_text()

def run(client, cmd, sudo=False):
    if sudo:
        cmd = f'echo {PASS} | sudo -S bash -c {repr(cmd)}'
    _, stdout, stderr = client.exec_command(cmd, get_pty=sudo)
    out = stdout.read().decode().strip()
    stdout.channel.recv_exit_status()
    return out

def sftp_put_dir(sftp, local_dir, remote_dir):
    try: sftp.stat(remote_dir)
    except FileNotFoundError: sftp.mkdir(remote_dir)
    count = 0
    for item in sorted(local_dir.rglob('*')):
        if any(p in item.parts for p in ('node_modules', '__pycache__')):
            continue
        rel = item.relative_to(local_dir)
        remote_path = remote_dir + '/' + str(rel).replace('\\', '/')
        if item.is_dir():
            try: sftp.stat(remote_path)
            except FileNotFoundError: sftp.mkdir(remote_path)
        else:
            sftp.put(str(item), remote_path)
            count += 1
    return count

print(f'==> Connecting to {HOST}...')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=15,
               allow_agent=False, look_for_keys=False)
sftp = client.open_sftp()
print('    connected')

# Grant write access
print(f'\n==> Granting write access to {APP_DIR}...')
run(client, f'chown -R {USER}:{USER} {APP_DIR}', sudo=True)

# Upload server/ files
print('\n==> Uploading server/ files...')
count = sftp_put_dir(sftp, LOCAL_ROOT / 'server', f'{APP_DIR}/server')
print(f'    {count} files uploaded')

# Create data/ directory for history.ndjson
print('\n==> Creating data/ directory...')
run(client, f'mkdir -p {APP_DIR}/data', sudo=False)

# Restore ownership
print('\n==> Restoring www-data ownership...')
run(client, f'chown -R www-data:www-data {APP_DIR}', sudo=True)
print('    done')

# Restart Node.js service
print(f'\n==> Restarting {SVC_NAME} service...')
run(client, f'systemctl restart {SVC_NAME}', sudo=True)
import time; time.sleep(2)
status = run(client, f'systemctl is-active {SVC_NAME}', sudo=False)
print(f'    status: {status}')

# Update Nginx config
print('\n==> Updating Nginx config...')
sftp.putfo(io.BytesIO(NGINX_CONF.encode()), '/tmp/devops-assistant-nginx.conf')
run(client, f'cp /tmp/devops-assistant-nginx.conf /etc/nginx/sites-available/{SVC_NAME}', sudo=True)
test = run(client, 'nginx -t 2>&1', sudo=True).replace('[sudo] password for equals: ', '').strip()
print(f'    {test}')
if 'successful' not in test:
    print('ERROR: nginx config test failed')
    sftp.close(); client.close(); sys.exit(1)
run(client, 'systemctl reload nginx', sudo=True)
print('    nginx reloaded')

# Smoke tests
print('\n==> Smoke tests...')
for path in ['/api/health', '/api/history/test-id?range=24h']:
    code = run(client, f'curl -s -o /dev/null -w "%{{http_code}}" http://localhost{path}')
    print(f'    {code}  {path}')

sftp.close()
client.close()
print('\nDone. Now run upload_frontend.py to deploy the React build.')
