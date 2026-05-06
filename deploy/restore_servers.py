"""
1. Fix ENCRYPTION_SECRET in systemd to match the original app's secret
2. Upload servers.json to /opt/sentinelops/data/
3. Restart Spring Boot and verify servers load
"""
import paramiko, io, shutil

HOST     = '192.168.150.190'
USER     = 'equals'
PASS     = '123QWEasdZXC'
DATA_DIR = '/opt/sentinelops/data'

# Must match what encrypted the original servers.json
ENCRYPTION_SECRET = 'sentinelops-default-change-in-production'

SERVERS_JSON_LOCAL = r'D:\Vibe Coding Project\DEVOPS Agent\backend\data\servers.json'

SYSTEMD_UNIT = f"""\
[Unit]
Description=SentinelOps AI - Spring Boot backend
After=network.target

[Service]
Type=simple
User=equals
WorkingDirectory=/opt/sentinelops
ExecStart=/usr/bin/java -jar /opt/sentinelops/sentinelops-ai.jar
Restart=on-failure
RestartSec=10
Environment=SERVER_PORT=8080
Environment=ENCRYPTION_SECRET={ENCRYPTION_SECRET}

StandardOutput=journal
StandardError=journal
SyslogIdentifier=sentinelops

[Install]
WantedBy=multi-user.target
"""

def run(client, cmd, sudo=False):
    if sudo:
        cmd = f'echo {PASS} | sudo -S bash -c {repr(cmd)}'
    _, stdout, stderr = client.exec_command(cmd, get_pty=sudo)
    out = stdout.read().decode().strip()
    stdout.channel.recv_exit_status()
    return out

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=10,
               allow_agent=False, look_for_keys=False)
sftp = client.open_sftp()

print('==> Creating data directory...')
run(client, f'mkdir -p {DATA_DIR} && chown equals:equals {DATA_DIR}', sudo=True)
print(f'    {DATA_DIR} ready')

print('\n==> Uploading servers.json...')
sftp.put(SERVERS_JSON_LOCAL, f'{DATA_DIR}/servers.json')
out = run(client, f'wc -l {DATA_DIR}/servers.json')
print(f'    uploaded — {out}')

print('\n==> Updating systemd service with correct encryption secret...')
sftp.putfo(io.BytesIO(SYSTEMD_UNIT.encode()), '/tmp/sentinelops.service')
run(client, 'cp /tmp/sentinelops.service /etc/systemd/system/sentinelops.service', sudo=True)
run(client, 'systemctl daemon-reload', sudo=True)
run(client, 'systemctl restart sentinelops', sudo=True)

print('\n==> Waiting for Spring Boot to restart...')
import time
for i in range(12):
    time.sleep(3)
    out = run(client, 'curl -s http://localhost:8080/api/servers 2>/dev/null | head -c 80')
    if out.startswith('[') and len(out) > 5:
        print(f'    attempt {i+1}: got data!')
        break
    print(f'    attempt {i+1}: {out[:60] or "not ready"}')

print('\n==> Checking servers loaded...')
out = run(client, 'curl -s http://localhost:8080/api/servers')
import json
try:
    servers = json.loads(out)
    print(f'    Loaded {len(servers)} servers:')
    for s in servers:
        print(f'      - {s["name"]}  ({s["host"]})')
except Exception:
    print(f'    Raw response: {out[:300]}')

sftp.close()
client.close()
print('\nDone. Refresh the AI Assistant page — all servers should appear in the dropdown.')
