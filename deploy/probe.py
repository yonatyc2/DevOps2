import paramiko

HOST = '192.168.150.190'
USER = 'equals'
PASS = '123QWEasdZXC'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=10,
               allow_agent=False, look_for_keys=False)

def run(cmd):
    _, out, err = client.exec_command(cmd)
    o = out.read().decode().strip()
    print(f'$ {cmd}\n{o}\n')

# Where is Spring Boot storing data?
run('find /opt/sentinelops -type f 2>/dev/null')
run('cat /etc/systemd/system/sentinelops.service')

client.close()
