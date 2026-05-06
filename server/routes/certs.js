import express from 'express';
import tls from 'tls';
import forge from 'node-forge';

const router = express.Router();

function checkCert(host, port = 443) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, rejectUnauthorized: false, servername: host, timeout: 8000 },
      () => {
        const cert = socket.getPeerCertificate(true);
        socket.destroy();
        if (!cert || !cert.subject) {
          return reject(new Error('No certificate returned'));
        }
        resolve(cert);
      }
    );
    socket.on('error', reject);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Connection timed out'));
    });
  });
}

function parseCert(raw) {
  // node's tls module gives us a parsed cert; enrich with forge for SANs
  const now = new Date();
  const validTo = new Date(raw.valid_to);
  const validFrom = new Date(raw.valid_from);
  const daysLeft = Math.ceil((validTo - now) / (1000 * 60 * 60 * 24));

  const sans = raw.subjectaltname
    ? raw.subjectaltname.split(', ').map(s => s.replace(/^(DNS|IP Address):/, '').trim())
    : [];

  return {
    subject: raw.subject,
    issuer: raw.issuer,
    validFrom: validFrom.toISOString(),
    validTo: validTo.toISOString(),
    daysLeft,
    expired: daysLeft < 0,
    expiringSoon: daysLeft >= 0 && daysLeft <= 30,
    sans,
    serialNumber: raw.serialNumber,
    fingerprint: raw.fingerprint,
  };
}

// POST /api/certs/check — { host, port? }
router.post('/check', async (req, res) => {
  const { host, port = 443 } = req.body;
  if (!host) return res.status(400).json({ error: 'host is required' });

  try {
    const raw = await checkCert(host, port);
    const cert = parseCert(raw);
    res.json({ ok: true, host, port, cert });
  } catch (err) {
    res.json({ ok: false, host, port, error: err.message });
  }
});

// POST /api/certs/check-san — check if a hostname/IP is covered by the cert SANs
router.post('/check-san', async (req, res) => {
  const { host, port = 443, checkFor } = req.body;
  if (!host || !checkFor) return res.status(400).json({ error: 'host and checkFor are required' });

  try {
    const raw = await checkCert(host, port);
    const cert = parseCert(raw);
    const covered = cert.sans.some(
      san => san.toLowerCase() === checkFor.toLowerCase()
    );
    res.json({ ok: true, covered, cert, checkFor });
  } catch (err) {
    res.json({ ok: false, host, error: err.message });
  }
});

// POST /api/certs/bulk — check multiple hosts at once
router.post('/bulk', async (req, res) => {
  const { hosts } = req.body;
  if (!Array.isArray(hosts) || hosts.length === 0) {
    return res.status(400).json({ error: 'hosts array is required' });
  }

  const results = await Promise.all(
    hosts.map(async ({ host, port = 443 }) => {
      try {
        const raw = await checkCert(host, port);
        const cert = parseCert(raw);
        return { host, port, ok: true, cert };
      } catch (err) {
        return { host, port, ok: false, error: err.message };
      }
    })
  );

  res.json(results);
});

export default router;
