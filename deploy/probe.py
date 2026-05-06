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
    e = err.read().decode().strip()
    print(f'\n$ {cmd}')
    if o: print(o)
    if e: print(f'  stderr: {e}')

# 1. Show exactly what nginx has loaded for port 80
run('cat /etc/nginx/sites-enabled/devops-assistant')
run('cat /etc/nginx/sites-enabled/corporateloans.co.zw')

# 2. Test each Host header — which title/root does nginx actually serve?
run('curl -s -H "Host: 192.168.150.190"       http://127.0.0.1/ | grep -o "<title>[^<]*</title>"')
run('curl -s -H "Host: corporateloans.co.zw"   http://127.0.0.1/ | grep -o "<title>[^<]*</title>"')
run('curl -s -H "Host: anything-else"          http://127.0.0.1/ | grep -o "<title>[^<]*</title>"')
run('curl -s                                    http://127.0.0.1/ | grep -o "<title>[^<]*</title>"')

# 3. Which config nginx thinks is default_server on port 80?
run('nginx -T 2>/dev/null | grep -A3 "default_server"')

# 4. Check the actual index.html in each web root
run('head -5 /var/www/devops-assistant/index.html 2>/dev/null || echo "NOT FOUND"')
run('head -5 /var/www/corporateloans.co.zw/index.html 2>/dev/null || echo "NOT FOUND"')

client.close()
