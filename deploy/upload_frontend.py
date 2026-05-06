"""
Upload the React build/ directory to /var/www/devops-assistant.
Does NOT touch Nginx, Node.js service, or Spring Boot — they are already running.
"""
import paramiko, sys
from pathlib import Path

HOST     = '192.168.150.190'
USER     = 'equals'
PASS     = '123QWEasdZXC'
APP_DIR  = '/var/www/devops-assistant'
BUILD    = Path(__file__).parent.parent / 'build'

def run(client, cmd, sudo=False):
    if sudo:
        cmd = f'echo {PASS} | sudo -S bash -c {repr(cmd)}'
    _, stdout, stderr = client.exec_command(cmd, get_pty=sudo)
    out = stdout.read().decode().strip()
    stdout.channel.recv_exit_status()
    return out

def sftp_put_dir(sftp, local_dir, remote_dir):
    try:
        sftp.stat(remote_dir)
    except FileNotFoundError:
        sftp.mkdir(remote_dir)
    count = 0
    for item in sorted(local_dir.rglob('*')):
        rel = item.relative_to(local_dir)
        remote_path = remote_dir + '/' + str(rel).replace('\\', '/')
        if item.is_dir():
            try: sftp.stat(remote_path)
            except FileNotFoundError: sftp.mkdir(remote_path)
        else:
            sftp.put(str(item), remote_path)
            count += 1
    return count

if not BUILD.exists():
    print('ERROR: build/ not found - run npm run build first')
    sys.exit(1)

print(f'==> Connecting to {HOST}...')
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=15,
               allow_agent=False, look_for_keys=False)
sftp = client.open_sftp()
print('    connected')

print(f'\n==> Granting write access to {APP_DIR}...')
run(client, f'chown -R {USER}:{USER} {APP_DIR}', sudo=True)
print('    ownership set to equals')

print(f'\n==> Uploading build/ -> {APP_DIR}...')
count = sftp_put_dir(sftp, BUILD, APP_DIR)
print(f'    {count} files uploaded')

print('\n==> Restoring www-data ownership...')
run(client, f'chown -R www-data:www-data {APP_DIR}', sudo=True)
print('    ownership restored')

print('\n==> Verifying site responds...')
out = run(client, 'curl -s -o /dev/null -w "%{http_code}" http://localhost/')
print(f'    GET / -> {out}')
out = run(client, 'curl -s -o /dev/null -w "%{http_code}" http://localhost/api/servers')
print(f'    GET /api/servers -> {out}')

sftp.close()
client.close()
print('\nDone. Hard-refresh the browser (Ctrl+Shift+R).')
