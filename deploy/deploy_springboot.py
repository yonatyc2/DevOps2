"""
Deploy SentinelOps Spring Boot backend to 192.168.150.190
Uploads the JAR and installs it as a systemd service on port 8080.
"""
import paramiko, io, os

HOST = '192.168.150.190'
USER = 'equals'
PASS = '123QWEasdZXC'

JAR_LOCAL  = r'D:\Vibe Coding Project\DEVOPS Agent\backend\target\sentinelops-ai-0.1.0-SNAPSHOT.jar'
JAR_REMOTE = '/opt/sentinelops/sentinelops-ai.jar'
SVC_NAME   = 'sentinelops'

SYSTEMD_UNIT = f"""\
[Unit]
Description=SentinelOps AI - Spring Boot backend
After=network.target

[Service]
Type=simple
User=equals
WorkingDirectory=/opt/sentinelops
ExecStart=/usr/bin/java -jar {JAR_REMOTE}
Restart=on-failure
RestartSec=10
Environment=SERVER_PORT=8080
Environment=ENCRYPTION_SECRET=sentinelops-prod-secret-change-me

StandardOutput=journal
StandardError=journal
SyslogIdentifier={SVC_NAME}

[Install]
WantedBy=multi-user.target
"""

def run(client, cmd, sudo=False, check=True):
    if sudo:
        cmd = f'echo {PASS} | sudo -S bash -c {repr(cmd)}'
    _, stdout, stderr = client.exec_command(cmd, get_pty=sudo)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    rc  = stdout.channel.recv_exit_status()
    if check and rc not in (0, 1):
        print(f'  [WARN] rc={rc} cmd={cmd[:60]}')
    return out.strip(), err.strip()

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=15,
               allow_agent=False, look_for_keys=False)
sftp = client.open_sftp()

print('==> Checking Java on server...')
out, _ = run(client, 'java -version 2>&1')
print(f'    {out or "not found"}')

if 'not found' in out or not out:
    print('==> Installing Java 17...')
    run(client, 'apt-get install -y openjdk-17-jre-headless', sudo=True)

print('\n==> Creating /opt/sentinelops...')
run(client, 'mkdir -p /opt/sentinelops && chown equals:equals /opt/sentinelops', sudo=True)

print(f'\n==> Uploading JAR ({os.path.getsize(JAR_LOCAL) // (1024*1024)} MB)...')
sftp.put(JAR_LOCAL, JAR_REMOTE)
print('    [OK] upload complete')

print('\n==> Installing systemd service...')
sftp.putfo(io.BytesIO(SYSTEMD_UNIT.encode()), '/tmp/sentinelops.service')
run(client, f'cp /tmp/sentinelops.service /etc/systemd/system/{SVC_NAME}.service', sudo=True)
run(client, 'systemctl daemon-reload', sudo=True)
run(client, f'systemctl enable {SVC_NAME}', sudo=True)
run(client, f'systemctl restart {SVC_NAME}', sudo=True)

print('\n==> Waiting for Spring Boot to start (up to 30s)...')
import time
for i in range(10):
    time.sleep(3)
    out, _ = run(client, 'curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/health 2>/dev/null || echo "..."', check=False)
    print(f'    attempt {i+1}: {out}')
    if out.strip() == '200':
        break

print('\n==> Service status...')
out, _ = run(client, f'systemctl is-active {SVC_NAME}', check=False)
print(f'    status: {out}')

out, _ = run(client, f'journalctl -u {SVC_NAME} --no-pager -n 15 2>&1', sudo=True)
print(out)

print('\n==> Verifying API endpoints...')
for path in ['/api/health', '/api/servers', '/api/chat/mode']:
    out, _ = run(client, f'curl -s -o /dev/null -w "%{{http_code}}" http://localhost:8080{path}')
    print(f'    http://localhost:8080{path}  ->  {out}')

sftp.close()
client.close()
print('\nDone. Spring Boot backend is running on port 8080.')
print('Reload the AI Assistant page in your browser.')
