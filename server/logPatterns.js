// Rule-based log analysis patterns for DevOps troubleshooting
export const patterns = [
  // ── Nginx / HTTP Gateway ──────────────────────────────────────────────────
  {
    id: 'nginx-502',
    severity: 'critical',
    category: 'Nginx',
    pattern: /502 bad gateway|upstream connect error|no live upstreams|connect\(\) failed.*Connection refused/i,
    title: '502 Bad Gateway — Upstream Unreachable',
    rootCause: 'Nginx cannot reach the upstream service. The backend container is down, crashed, or not listening on the expected port.',
    fixes: [
      'Check the upstream container is running: `docker ps | grep <service>`',
      'Verify the container port binding matches nginx upstream config',
      'Check container logs: `docker logs <container> --tail 100`',
      'Restart the upstream service: `docker restart <container>`',
      'Confirm nginx upstream host/port in nginx.conf matches the Docker network alias',
    ],
  },
  {
    id: 'nginx-504',
    severity: 'critical',
    category: 'Nginx',
    pattern: /504 gateway time.?out|upstream timed out.*Gateway Time/i,
    title: '504 Gateway Timeout — Upstream Slow/Unresponsive',
    rootCause: 'The upstream service accepted the connection but did not respond within nginx\'s proxy_read_timeout.',
    fixes: [
      'Increase `proxy_read_timeout` and `proxy_send_timeout` in nginx.conf',
      'Check upstream service performance — it may be under load or deadlocked',
      'Look for long-running DB queries or Feign call chains in downstream logs',
      'Add health check endpoint to upstream and monitor response time',
    ],
  },
  {
    id: 'nginx-tls-cert',
    severity: 'critical',
    category: 'TLS / Nginx',
    pattern: /SSL_CTX_use_certificate|no ssl certificates|SSL handshake failed|certificate verify failed|unable to verify the first certificate/i,
    title: 'TLS Certificate Error in Nginx',
    rootCause: 'Nginx cannot load the SSL certificate or the upstream TLS handshake is failing.',
    fixes: [
      'Verify cert and key paths in nginx.conf: `ssl_certificate` / `ssl_certificate_key`',
      'Check cert expiry: `openssl x509 -in /path/to/cert.pem -noout -dates`',
      'Ensure the full chain (including intermediates) is present in the cert file',
      'If proxying to HTTPS upstream: add `proxy_ssl_verify off` for self-signed certs, or provide the CA cert',
    ],
  },
  {
    id: 'nginx-tls-san',
    severity: 'high',
    category: 'TLS',
    pattern: /subject alternative name|SAN.*mismatch|hostname.*did not match|certificate.*Common Name|IP SAN/i,
    title: 'TLS SAN Mismatch — Certificate Does Not Cover Hostname',
    rootCause: 'The certificate\'s Subject Alternative Names do not include the hostname or IP being accessed.',
    fixes: [
      'Regenerate the certificate including all required SANs (hostname, IP, aliases)',
      'Add the target IP/hostname to the SAN list in your openssl.cnf: `subjectAltName = DNS:hostname, IP:x.x.x.x`',
      'Re-issue cert and restart nginx: `nginx -s reload`',
      'For internal registries: ensure the Docker daemon trusts the CA (`/etc/docker/certs.d/<host>/ca.crt`)',
    ],
  },

  // ── Spring Boot / Feign ──────────────────────────────────────────────────
  {
    id: 'feign-timeout',
    severity: 'critical',
    category: 'Spring Boot / Feign',
    pattern: /feign.*timeout|RetryableException.*timed out|Read timed out|feign\.RetryableException|HystrixRuntimeException.*timed/i,
    title: 'Feign Client Timeout',
    rootCause: 'A Feign HTTP client call to a downstream service exceeded the configured connect/read timeout.',
    fixes: [
      'Check the downstream service is healthy: `docker ps` and inspect its logs',
      'Increase Feign timeouts in application.yml: `feign.client.config.default.connectTimeout` / `readTimeout`',
      'Enable Feign logging to see which endpoint is slow: `feign.client.config.default.loggerLevel: FULL`',
      'Add circuit breaker (Resilience4j) to fail fast and avoid thread starvation',
      'Check if downstream is behind a VIP/LB that is healthy',
    ],
  },
  {
    id: 'feign-connection-refused',
    severity: 'critical',
    category: 'Spring Boot / Feign',
    pattern: /Connection refused.*feign|feign.*Connection refused|com\.netflix\.hystrix.*Connection refused/i,
    title: 'Feign — Connection Refused to Downstream Service',
    rootCause: 'The downstream service Feign is calling is not reachable — wrong host, wrong port, or service is down.',
    fixes: [
      'Verify the target URL in application.yml / Feign `@FeignClient(url=...)`',
      'Confirm the target service container is running and its port is exposed',
      'Check service discovery registration (Eureka/Consul) if used',
      'Ping the downstream host from inside the calling container: `docker exec -it <container> curl <url>`',
    ],
  },
  {
    id: 'spring-oom',
    severity: 'critical',
    category: 'Spring Boot',
    pattern: /OutOfMemoryError|java\.lang\.OutOfMemoryError|GC overhead limit exceeded/i,
    title: 'JVM OutOfMemoryError',
    rootCause: 'The JVM heap or metaspace is exhausted.',
    fixes: [
      'Increase heap: set `-Xmx` in `JAVA_OPTS` (e.g., `-Xmx512m`)',
      'Check for memory leaks — look for unbounded caches, open streams, or retained objects',
      'Enable GC logging: `-Xlog:gc*:file=/tmp/gc.log`',
      'Set Docker memory limit above JVM heap to prevent OOM kill: `mem_limit: 1g`',
    ],
  },
  {
    id: 'spring-startup-fail',
    severity: 'critical',
    category: 'Spring Boot',
    pattern: /APPLICATION FAILED TO START|BeanCreationException|UnsatisfiedDependencyException|Error creating bean/i,
    title: 'Spring Boot Application Failed to Start',
    rootCause: 'A Spring bean failed to initialize — missing config, bad wiring, or DB/broker unreachable at startup.',
    fixes: [
      'Read the full stack trace above this line — the root cause is usually a few lines up',
      'Check all required environment variables are set (DB URL, passwords, ports)',
      'Verify DB/Kafka/Redis are accessible before the app starts (use `depends_on` with health checks in docker-compose)',
      'Run with `--debug` flag to get detailed auto-configuration report',
    ],
  },

  // ── PostgreSQL ────────────────────────────────────────────────────────────
  {
    id: 'pg-lock',
    severity: 'high',
    category: 'PostgreSQL',
    pattern: /deadlock detected|lock wait timeout|waiting for.*lock|ERROR.*deadlock/i,
    title: 'PostgreSQL Lock Contention / Deadlock',
    rootCause: 'Two or more transactions are blocking each other or a transaction is holding a lock too long.',
    fixes: [
      'Identify blocking queries: `SELECT * FROM pg_stat_activity WHERE wait_event_type = \'Lock\';`',
      'Kill offending backends: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE ...;`',
      'Review transaction ordering in application code to prevent deadlocks',
      'Add statement timeout: `SET statement_timeout = \'30s\'`',
      'Check for long-running idle transactions that hold locks',
    ],
  },
  {
    id: 'pg-connection',
    severity: 'critical',
    category: 'PostgreSQL',
    pattern: /FATAL.*password authentication failed|FATAL.*role.*does not exist|could not connect to server|Connection to.*postgres.*refused/i,
    title: 'PostgreSQL Connection Failure',
    rootCause: 'Application cannot connect to PostgreSQL — wrong credentials, host, port, or the DB is down.',
    fixes: [
      'Verify DB_HOST, DB_PORT, DB_USER, DB_PASSWORD environment variables',
      'Check PostgreSQL is running: `docker ps | grep postgres`',
      'Test connectivity from the app container: `docker exec -it <app> psql -h <host> -U <user> -d <db>`',
      'Check `pg_hba.conf` allows connections from the app\'s IP/subnet',
    ],
  },
  {
    id: 'pg-max-connections',
    severity: 'high',
    category: 'PostgreSQL',
    pattern: /FATAL.*remaining connection slots|too many connections|connection pool exhausted/i,
    title: 'PostgreSQL Max Connections Reached',
    rootCause: 'The connection pool is exhausted — too many clients or pool not releasing connections.',
    fixes: [
      'Check current connections: `SELECT count(*) FROM pg_stat_activity;`',
      'Increase `max_connections` in postgresql.conf (restart required)',
      'Add a connection pooler: PgBouncer in front of PostgreSQL',
      'Reduce pool size in application: `spring.datasource.hikari.maximum-pool-size`',
    ],
  },

  // ── Docker / Registry ────────────────────────────────────────────────────
  {
    id: 'docker-manifest-unknown',
    severity: 'critical',
    category: 'Docker Registry',
    pattern: /manifest unknown|manifest.*not found|Error response from daemon.*not found|repository.*not found/i,
    title: 'Docker Manifest / Image Not Found',
    rootCause: 'The requested image tag does not exist in the registry, or the repository name is incorrect.',
    fixes: [
      'List available tags in the registry via the Registry UI or: `curl -k https://<registry>/v2/<name>/tags/list`',
      'Verify the full image path: `<registry>/<repo>:<tag>`',
      'Ensure the image was pushed successfully before pulling',
      'Check for typos in the image name or tag',
    ],
  },
  {
    id: 'docker-tls',
    severity: 'critical',
    category: 'Docker Registry',
    pattern: /x509.*certificate.*unknown authority|x509.*certificate signed by unknown|tls.*handshake|http: server gave HTTP response to HTTPS/i,
    title: 'Docker Registry TLS Error',
    rootCause: 'Docker does not trust the registry\'s TLS certificate (self-signed or custom CA).',
    fixes: [
      'Copy the registry CA cert to `/etc/docker/certs.d/<registry-host>/ca.crt`',
      'Restart Docker daemon after adding the cert',
      'As a temporary workaround, add registry to insecure-registries in `/etc/docker/daemon.json`',
      'Verify cert is valid: `openssl s_client -connect <registry>:443 -showcerts`',
    ],
  },
  {
    id: 'docker-auth',
    severity: 'high',
    category: 'Docker Registry',
    pattern: /unauthorized.*authentication required|401 Unauthorized|denied.*requested access|login required/i,
    title: 'Docker Registry Authentication Failure',
    rootCause: 'Docker is not authenticated to the registry, or credentials are incorrect/expired.',
    fixes: [
      'Login to the registry: `docker login <registry-host>`',
      'Check credentials in `~/.docker/config.json`',
      'If using CI/CD: ensure the registry secret is correctly mounted in the pipeline',
      'Verify the registry user has pull/push permissions for the repository',
    ],
  },
  {
    id: 'docker-daemon-down',
    severity: 'critical',
    category: 'Docker',
    pattern: /Cannot connect to the Docker daemon|Is the docker daemon running|docker.*connection refused/i,
    title: 'Docker Daemon Not Running',
    rootCause: 'The Docker daemon is stopped or the socket is not accessible.',
    fixes: [
      'Start Docker: `sudo systemctl start docker`',
      'Check status: `sudo systemctl status docker`',
      'Check socket permissions: `ls -la /var/run/docker.sock`',
      'Add user to docker group: `sudo usermod -aG docker $USER` (then re-login)',
    ],
  },

  // ── Jenkins ───────────────────────────────────────────────────────────────
  {
    id: 'jenkins-build-fail',
    severity: 'high',
    category: 'Jenkins',
    pattern: /BUILD FAILURE|ERROR.*Failed to execute goal|FAILED.*Compilation failure|Process exited with code [1-9]/i,
    title: 'Jenkins Build Failure',
    rootCause: 'A Maven/Gradle build step failed — compilation error, test failure, or missing dependency.',
    fixes: [
      'Scroll up for the first ERROR line — that is the root cause',
      'Run the build locally to reproduce: `mvn clean package` or `gradle build`',
      'Check for missing environment variables in the Jenkins pipeline',
      'Verify artifact repository (Nexus/Artifactory) is accessible from Jenkins',
    ],
  },
  {
    id: 'jenkins-no-space',
    severity: 'high',
    category: 'Jenkins',
    pattern: /No space left on device|disk space|ENOSPC/i,
    title: 'Jenkins — No Space Left on Device',
    rootCause: 'The Jenkins agent or Docker host has run out of disk space.',
    fixes: [
      'Free Docker space: `docker system prune -af`',
      'Clean old Jenkins workspaces: `rm -rf /var/lib/jenkins/workspace/*`',
      'Check disk usage: `df -h` and `du -sh /var/lib/docker`',
      'Set up periodic cleanup in Jenkins or Docker',
    ],
  },

  // ── Generic ───────────────────────────────────────────────────────────────
  {
    id: 'connection-timeout',
    severity: 'high',
    category: 'Network',
    pattern: /connection timed out|ETIMEDOUT|i\/o timeout|connect: connection timed out/i,
    title: 'Network Connection Timeout',
    rootCause: 'A TCP connection attempt reached no response — firewall drop, wrong host, or service unreachable.',
    fixes: [
      'Check if the target host/port is reachable: `nc -zv <host> <port>` or `telnet <host> <port>`',
      'Review firewall rules (iptables / security groups / cloud NSG)',
      'Confirm the service is listening on the expected port: `ss -tlnp | grep <port>`',
      'Check DNS resolution: `nslookup <host>`',
    ],
  },
  {
    id: 'oom-killed',
    severity: 'critical',
    category: 'Docker / Linux',
    pattern: /Killed|OOM killer|out of memory: kill process|memory cgroup out of memory/i,
    title: 'Process Killed by OOM Killer',
    rootCause: 'The Linux kernel OOM killer terminated a process because the host or container ran out of memory.',
    fixes: [
      'Increase container memory limit in docker-compose.yml: `mem_limit: 1g`',
      'Check host memory: `free -h` and `dmesg | grep -i oom`',
      'Profile application memory usage and reduce heap size or cache sizes',
      'Add swap space as a short-term mitigation',
    ],
  },
];

export function analyzeLog(logText) {
  const findings = [];

  for (const p of patterns) {
    if (p.pattern.test(logText)) {
      // Extract up to 3 matching lines for context
      const lines = logText.split('\n');
      const matchingLines = lines
        .filter(l => p.pattern.test(l))
        .slice(0, 3)
        .map(l => l.trim());

      findings.push({
        id: p.id,
        severity: p.severity,
        category: p.category,
        title: p.title,
        rootCause: p.rootCause,
        fixes: p.fixes,
        matchingLines,
      });
    }
  }

  // Sort by severity: critical > high > medium > low
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return findings;
}
