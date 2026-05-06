import express from 'express';
import { analyzeLog } from '../logPatterns.js';

const router = express.Router();

// POST /api/logs/analyze — { logText: string }
router.post('/analyze', (req, res) => {
  const { logText } = req.body;
  if (!logText || typeof logText !== 'string') {
    return res.status(400).json({ error: 'logText is required' });
  }

  const findings = analyzeLog(logText);
  res.json({ findings, total: findings.length });
});

export default router;
