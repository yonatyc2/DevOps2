import express from 'express';
import axios from 'axios';
import https from 'https';

const router = express.Router();

const REGISTRY_HOST = process.env.REGISTRY_HOST || '192.168.150.81';
const REGISTRY_PORT = process.env.REGISTRY_PORT || '443';
const REGISTRY_BASE = `https://${REGISTRY_HOST}:${REGISTRY_PORT}/v2`;

const agent = new https.Agent({ rejectUnauthorized: false });

function registryAxios() {
  return {
    httpsAgent: agent,
    timeout: 8000,
    auth: process.env.REGISTRY_USER
      ? { username: process.env.REGISTRY_USER, password: process.env.REGISTRY_PASS }
      : undefined,
  };
}

// GET /api/registry/ping
router.get('/ping', async (req, res) => {
  try {
    await axios.get(`${REGISTRY_BASE}/`, registryAxios());
    res.json({ ok: true, host: REGISTRY_HOST });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// GET /api/registry/catalog
router.get('/catalog', async (req, res) => {
  try {
    const { data } = await axios.get(`${REGISTRY_BASE}/_catalog`, { ...registryAxios(), params: { n: 100 } });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/registry/tags?repo=<name>
router.get('/tags', async (req, res) => {
  const { repo } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo query param is required' });
  try {
    const { data } = await axios.get(`${REGISTRY_BASE}/${repo}/tags/list`, registryAxios());
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/registry/manifest?repo=<name>&ref=<tag>
router.get('/manifest', async (req, res) => {
  const { repo, ref = 'latest' } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo query param is required' });
  try {
    const response = await axios.get(`${REGISTRY_BASE}/${repo}/manifests/${ref}`, {
      ...registryAxios(),
      headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' },
    });
    res.json({
      exists: true,
      digest: response.headers['docker-content-digest'],
      manifest: response.data,
    });
  } catch (err) {
    if (err.response?.status === 404) {
      res.json({ exists: false });
    } else {
      res.status(502).json({ error: err.message });
    }
  }
});

// POST /api/registry/validate  { image: "repo/name:tag" }
router.post('/validate', async (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'image is required' });

  const colonIdx = image.lastIndexOf(':');
  const name = colonIdx !== -1 ? image.slice(0, colonIdx) : image;
  const tag = colonIdx !== -1 ? image.slice(colonIdx + 1) : 'latest';
  const result = { image, name, tag, checks: [] };

  // Check tag exists
  try {
    const response = await axios.get(`${REGISTRY_BASE}/${name}/manifests/${tag}`, {
      ...registryAxios(),
      headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' },
    });
    result.checks.push({ label: 'Image tag exists', status: 'ok' });
    result.checks.push({
      label: 'Manifest digest',
      status: 'ok',
      detail: response.headers['docker-content-digest'],
    });
  } catch (err) {
    result.checks.push({
      label: 'Image tag exists',
      status: 'fail',
      detail: err.response?.status === 404 ? 'Tag not found in registry' : err.message,
    });
  }

  // Check TLS connectivity
  try {
    await axios.get(`${REGISTRY_BASE}/`, registryAxios());
    result.checks.push({ label: 'Registry TLS reachable', status: 'ok' });
  } catch (err) {
    result.checks.push({ label: 'Registry TLS reachable', status: 'fail', detail: err.message });
  }

  res.json(result);
});

export default router;
