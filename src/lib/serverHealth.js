export const THRESH = {
  disk:     { warn: 70, crit: 85 },
  cpu:      { warn: 75, crit: 90 },
  mem:      { warn: 80, crit: 90 },
  restarts: { crit: 3 },
}

export function classify(value, thresholds) {
  if (value == null || !Number.isFinite(value)) return 'unknown'
  if (thresholds.crit != null && value >= thresholds.crit) return 'crit'
  if (thresholds.warn != null && value >= thresholds.warn) return 'warn'
  return 'ok'
}

export function maxDiskPct(snap) {
  const disks = snap?.linux?.diskUsage || []
  if (!disks.length) return null
  return Math.max(...disks.map(d => parseInt(String(d.usePercent).replace('%', ''), 10) || 0))
}

export function maxContainerRestarts(snap) {
  const containers = snap?.docker?.containers || []
  if (!containers.length) return 0
  return Math.max(0, ...containers.map(c => c.restartCount || 0))
}

export function snapStatus(snap) {
  if (!snap) return 'offline'
  const diskPct = maxDiskPct(snap)
  const cpuPct  = snap.linux?.cpuUsagePercent ?? null
  const memPct  = snap.linux?.memory
    ? (100 * snap.linux.memory.memUsedMb) / snap.linux.memory.memTotalMb
    : null
  const maxRestarts = maxContainerRestarts(snap)
  const statuses = [
    classify(diskPct, THRESH.disk),
    classify(cpuPct,  THRESH.cpu),
    classify(memPct,  THRESH.mem),
    maxRestarts >= THRESH.restarts.crit ? 'crit' : 'ok',
  ]
  if (statuses.includes('crit')) return 'crit'
  if (statuses.includes('warn')) return 'warn'
  return 'ok'
}
