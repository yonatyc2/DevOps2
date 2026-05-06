import { Router } from 'express'
import { createReadStream, existsSync, mkdirSync } from 'fs'
import { appendFile, writeFile } from 'fs/promises'
import { createInterface } from 'readline'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR    = join(__dirname, '..', '..', 'data')
const HISTORY_FILE = join(DATA_DIR, 'history.ndjson')
const THIRTY_DAYS  = 30 * 24 * 3600_000

mkdirSync(DATA_DIR, { recursive: true })

const router = Router()

async function readAllLines(serverIdFilter) {
  if (!existsSync(HISTORY_FILE)) return []
  const lines = []
  const rl = createInterface({ input: createReadStream(HISTORY_FILE), crlfDelay: Infinity })
  for await (const raw of rl) {
    if (!raw.trim()) continue
    try {
      const obj = JSON.parse(raw)
      if (!serverIdFilter || obj.sid === serverIdFilter) lines.push(obj)
    } catch {}
  }
  return lines
}

// Prune on startup — keep only last 30 days
async function pruneOld() {
  if (!existsSync(HISTORY_FILE)) return
  const cutoff = Date.now() - THIRTY_DAYS
  const kept = await readAllLines(null)
  const fresh = kept.filter(l => l.ts >= cutoff)
  if (fresh.length < kept.length) {
    await writeFile(HISTORY_FILE, fresh.map(l => JSON.stringify(l)).join('\n') + '\n')
  }
}
pruneOld().catch(() => {})

// POST /api/history/batch
// Body: [{ serverId, capturedAt, cpuPct, memPct, diskPct, diskUsedGb, diskTotalGb }]
router.post('/batch', async (req, res) => {
  const rows = req.body
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'Expected array' })
  const lines = rows.map(r => JSON.stringify({
    sid:  String(r.serverId   || ''),
    ts:   Number(r.capturedAt) || Date.now(),
    cpu:  r.cpuPct      != null ? +r.cpuPct      : null,
    mem:  r.memPct      != null ? +r.memPct      : null,
    disk: r.diskPct     != null ? +r.diskPct     : null,
    du:   r.diskUsedGb  != null ? +r.diskUsedGb  : null,
    dt:   r.diskTotalGb != null ? +r.diskTotalGb : null,
  })).join('\n') + '\n'
  try {
    await appendFile(HISTORY_FILE, lines)
    res.json({ stored: rows.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

function linreg(pts) {
  const n = pts.length
  if (n < 2) return null
  const mt = pts.reduce((s, p) => s + p.t, 0) / n
  const mv = pts.reduce((s, p) => s + p.v, 0) / n
  const num = pts.reduce((s, p) => s + (p.t - mt) * (p.v - mv), 0)
  const den = pts.reduce((s, p) => s + (p.t - mt) ** 2, 0)
  if (den === 0) return null
  const slope = num / den
  return { slope, intercept: mv - slope * mt }
}

// GET /api/history/:serverId?range=24h|7d|30d
router.get('/:serverId', async (req, res) => {
  const { serverId } = req.params
  const range   = req.query.range || '24h'
  const rangeMs = { '24h': 86400_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000 }
  const since   = Date.now() - (rangeMs[range] ?? rangeMs['24h'])

  const all         = await readAllLines(serverId)
  const rangePoints = all
    .filter(l => l.ts >= since)
    .map(l => ({ ts: l.ts, cpu: l.cpu, mem: l.mem, disk: l.disk, diskUsed: l.du, diskTotal: l.dt }))

  // Prediction: always use last 7 days regardless of view range
  const predPts = all
    .filter(l => l.ts >= Date.now() - 7 * 86400_000 && l.du != null && l.dt != null)

  let prediction = null
  if (predPts.length >= 3) {
    const reg = linreg(predPts.map(l => ({ t: l.ts, v: l.du })))
    if (reg) {
      const latest      = predPts[predPts.length - 1]
      const projUsed    = reg.slope * latest.ts + reg.intercept
      const ratePerDay  = reg.slope * 86400_000
      const daysUntilFull = ratePerDay > 0.001
        ? Math.max(0, (latest.dt - projUsed) / ratePerDay)
        : null
      const confidence = predPts.length >= 24 ? 'high' : predPts.length >= 6 ? 'medium' : 'low'
      prediction = {
        daysUntilFull:  daysUntilFull != null ? Math.round(daysUntilFull * 10) / 10 : null,
        rateGbPerDay:   Math.round(ratePerDay * 100) / 100,
        diskUsedGb:     Math.round(projUsed * 10) / 10,
        diskTotalGb:    Math.round(latest.dt * 10) / 10,
        basedOnPoints:  predPts.length,
        confidence,
      }
    }
  }

  res.json({ serverId, range, points: rangePoints, prediction })
})

export default router
