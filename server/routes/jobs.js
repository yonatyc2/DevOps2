import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';

const router = express.Router();
const __dir = dirname(fileURLToPath(import.meta.url));
const JOBS_FILE = join(__dir, '../data/jobs.ndjson');
const SPRING_BOOT = 'http://127.0.0.1:8080';

const tasks = JSON.parse(readFileSync(join(__dir, '../data/tasks.json'), 'utf8'));

function interpolate(template, params) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? params[key] : `{{${key}}}`
  );
}

// POST /api/jobs/run — execute an arbitrary command (used by workflow pages)
router.post('/run', async (req, res) => {
  const { serverId, command, maskedValues = [] } = req.body
  if (!serverId || !command)
    return res.status(400).json({ error: 'serverId and command required' })

  let displayCommand = command
  for (const v of maskedValues) {
    if (v) displayCommand = displayCommand.split(v).join('***')
  }

  try {
    const r = await fetch(`${SPRING_BOOT}/api/commands/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, command, confirmedRiskLevel: 'HIGH' }),
    })
    const body = await r.json()
    if (!r.ok) return res.status(r.status).json({ error: body.error || r.statusText })
    res.json({ output: body.output ?? body.result ?? JSON.stringify(body), command: displayCommand })
  } catch (err) {
    res.status(502).json({ error: `Spring Boot unreachable: ${err.message}` })
  }
})

// POST /api/jobs/step — execute one step via Spring Boot
router.post('/step', async (req, res) => {
  const { serverId, taskId, stepIndex, params = {} } = req.body;
  if (!serverId || !taskId || stepIndex == null)
    return res.status(400).json({ error: 'serverId, taskId, stepIndex required' });

  const task = tasks.find(t => t.id === taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const step = task.steps[stepIndex];
  if (!step) return res.status(404).json({ error: 'Step not found' });

  const command = interpolate(step.command, params);

  // Build a display-safe version with masked param values
  const maskedValues = task.params
    .filter(p => p.masked)
    .map(p => params[p.key])
    .filter(Boolean)
  let displayCommand = command
  for (const v of maskedValues) {
    displayCommand = displayCommand.split(v).join('***')
  }

  try {
    const r = await fetch(`${SPRING_BOOT}/api/commands/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, command, confirmedRiskLevel: 'HIGH' }),
    });
    const body = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: body.error || r.statusText });
    res.json({ output: body.output ?? body.result ?? JSON.stringify(body), command: displayCommand });
  } catch (err) {
    res.status(502).json({ error: `Spring Boot unreachable: ${err.message}` });
  }
});

// POST /api/jobs/save — persist a completed job run
router.post('/save', (req, res) => {
  const { serverId, serverLabel, taskId, taskName, steps, status } = req.body;
  if (!serverId || !taskId) return res.status(400).json({ error: 'serverId, taskId required' });
  const record = { id: Date.now().toString(36), ts: Date.now(), serverId, serverLabel, taskId, taskName, steps, status };
  appendFileSync(JOBS_FILE, JSON.stringify(record) + '\n', 'utf8');
  res.json({ ok: true, id: record.id });
});

// GET /api/jobs — recent job history
router.get('/', (_req, res) => {
  if (!existsSync(JOBS_FILE)) return res.json([]);
  const lines = readFileSync(JOBS_FILE, 'utf8').trim().split('\n').filter(Boolean);
  const records = [];
  for (const line of lines) {
    try { records.push(JSON.parse(line)); } catch { /* skip corrupt */ }
  }
  records.sort((a, b) => b.ts - a.ts);
  res.json(records.slice(0, 100));
});

export default router;
