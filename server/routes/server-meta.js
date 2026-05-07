import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';

const router = express.Router();
const __dir = dirname(fileURLToPath(import.meta.url));
const META_FILE = join(__dir, '../data/server-meta.json');

function read() {
  try {
    return JSON.parse(readFileSync(META_FILE, 'utf8')) || {};
  } catch { return {}; }
}
function write(data) {
  writeFileSync(META_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// GET /api/server-meta — full metadata map
router.get('/', (_req, res) => res.json(read()));

// PUT /api/server-meta/:id — upsert group / displayName for a server
router.put('/:id', (req, res) => {
  const { group = '', displayName = '' } = req.body;
  const meta = read();
  meta[req.params.id] = { group: group.trim(), displayName: displayName.trim() };
  write(meta);
  res.json({ ok: true });
});

// DELETE /api/server-meta/:id — clear metadata for a server
router.delete('/:id', (req, res) => {
  const meta = read();
  delete meta[req.params.id];
  write(meta);
  res.json({ ok: true });
});

export default router;
