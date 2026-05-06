import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';

const router = express.Router();
const __dir = dirname(fileURLToPath(import.meta.url));
const tasks = JSON.parse(readFileSync(join(__dir, '../data/tasks.json'), 'utf8'));

router.get('/', (_req, res) => res.json(tasks));

router.get('/:id', (req, res) => {
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

export default router;
