import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import './ServerGrid.css'

const API_BASE = '/api'
const TREND_MAX = 20
const TREND_KEY = (id) => `devops.trend.${id}`
const BATCH_SIZE = 6

const THRESH = {
  disk:     { warn: 70, crit: 85 },
  cpu:      { warn: 75, crit: 90 },
  mem:      { warn: 80, crit: 90 },
  restarts: { crit: 3 },
}

function classify(value, thresholds) {
  if (value == null || !Number.isFinite(value)) return 'unknown'
  if (thresholds.crit != null && value >= thresholds.crit) return 'crit'
  if (thresholds.warn != null && value >= thresholds.warn) return 'warn'
  return 'ok'
}

function maxDiskPct(snap) {
  const disks = snap?.linux?.diskUsage || []
  if (!disks.length) return null
  return Math.max(...disks.map(d => parseInt(String(d.usePercent).replace('%', ''), 10) || 0))
}

function maxContainerRestarts(snap) {
  const containers = snap?.docker?.containers || []
  if (!containers.length) return 0
  return Math.max(0, ...containers.map(c => c.restartCount || 0))
}

function cardStatus(snap) {
  if (!snap) return 'offline'
  const diskPct = maxDiskPct(snap)
  const cpuPct = snap.linux?.cpuUsagePercent ?? null
  const memPct = snap.linux?.memory
    ? (100 * snap.linux.memory.memUsedMb) / snap.linux.memory.memTotalMb
    : null
  const maxRestarts = maxContainerRestarts(snap)

  const statuses = [
    classify(diskPct, THRESH.disk),
    classify(cpuPct, THRESH.cpu),
    classify(memPct, THRESH.mem),
    maxRestarts >= THRESH.restarts.crit ? 'crit' : 'ok',
  ]
  if (statuses.includes('crit')) return 'crit'
  if (statuses.includes('warn')) return 'warn'
  return 'ok'
}

function loadTrend(serverId) {
  try {
    const raw = localStorage.getItem(TREND_KEY(serverId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveTrend(serverId, entry) {
  try {
    const prev = loadTrend(serverId)
    const next = [...prev, entry].slice(-TREND_MAX)
    localStorage.setItem(TREND_KEY(serverId), JSON.stringify(next))
    return next
  } catch {
    return []
  }
}

function parseTrends(saved) {
  return {
    cpu:  saved.filter(e => e.cpu  != null).map(e => e.cpu),
    disk: saved.filter(e => e.disk != null).map(e => e.disk),
    mem:  saved.filter(e => e.mem  != null).map(e => e.mem),
  }
}

function Sparkline({ data, color = '#60a5fa', height = 28 }) {
  if (!data || data.length < 2) return <div style={{ height }} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const w = 100
  const h = height
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / range) * (h - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={height} preserveAspectRatio="none" style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function MetricBar({ value, thresholds, label }) {
  if (value == null || !Number.isFinite(value)) return null
  const status = classify(value, thresholds)
  const colors = { ok: 'var(--success)', warn: 'var(--warning)', crit: 'var(--danger)', unknown: 'var(--text-subtle)' }
  return (
    <div className="sg-metric">
      <span className="sg-metric-label">{label}</span>
      <div className="sg-metric-bar-wrap">
        <div
          className="sg-metric-bar"
          style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: colors[status] }}
        />
      </div>
      <span className="sg-metric-val">{value.toFixed(0)}%</span>
    </div>
  )
}

function ServerCard({ server, snap, trend, loading, onClick }) {
  const status = loading ? 'loading' : cardStatus(snap)
  const diskPct = snap ? maxDiskPct(snap) : null
  const cpuPct  = snap?.linux?.cpuUsagePercent ?? null
  const memPct  = snap?.linux?.memory
    ? (100 * snap.linux.memory.memUsedMb) / snap.linux.memory.memTotalMb
    : null
  const containerCount = snap?.docker?.containers?.length ?? null
  const nginxUp = snap?.nginx?.running
  const maxRestarts = snap ? maxContainerRestarts(snap) : 0

  return (
    <div
      className={`sg-card sg-card--${status}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      <div className="sg-card-header">
        <span className="sg-card-name" title={server.host}>{server.name || server.host}</span>
        <span className={`sg-status-dot sg-status-dot--${status}`} />
      </div>

      {loading && <p className="sg-loading-text">Loading…</p>}

      {!loading && snap && (
        <>
          <MetricBar value={diskPct} thresholds={THRESH.disk} label="Disk" />
          <MetricBar value={cpuPct}  thresholds={THRESH.cpu}  label="CPU"  />
          <MetricBar value={memPct}  thresholds={THRESH.mem}  label="Mem"  />

          {containerCount != null && (
            <p className="sg-meta">
              {containerCount} containers
              {maxRestarts >= THRESH.restarts.crit && <span className="sg-meta-warn"> · {maxRestarts} restarts</span>}
              {nginxUp != null && <span className={nginxUp ? '' : ' sg-meta-crit'}> · Nginx {nginxUp ? 'up' : 'DOWN'}</span>}
            </p>
          )}

          {(trend.cpu?.length >= 2 || trend.disk?.length >= 2 || trend.mem?.length >= 2) && (
            <div className="sg-trends">
              {trend.cpu?.length  >= 2 && <div className="sg-trend-row"><span className="sg-trend-label">CPU</span><Sparkline data={trend.cpu}  color="#60a5fa" /></div>}
              {trend.disk?.length >= 2 && <div className="sg-trend-row"><span className="sg-trend-label">Dsk</span><Sparkline data={trend.disk} color="#a78bfa" /></div>}
              {trend.mem?.length  >= 2 && <div className="sg-trend-row"><span className="sg-trend-label">Mem</span><Sparkline data={trend.mem}  color="#34d399" /></div>}
            </div>
          )}
        </>
      )}

      {!loading && !snap && <p className="sg-offline">Unreachable</p>}
    </div>
  )
}

function AlertsBanner({ servers, snapshots }) {
  const [collapsed, setCollapsed] = useState(false)

  const alerts = []
  for (const server of servers) {
    const snap = snapshots[server.id]
    if (!snap) continue
    const label = server.name || server.host

    const diskPct = maxDiskPct(snap)
    if (diskPct != null && diskPct >= THRESH.disk.crit)
      alerts.push({ level: 'crit', label, msg: `Disk ${diskPct}%` })
    else if (diskPct != null && diskPct >= THRESH.disk.warn)
      alerts.push({ level: 'warn', label, msg: `Disk ${diskPct}% (warning)` })

    const cpuPct = snap?.linux?.cpuUsagePercent ?? null
    if (cpuPct != null && cpuPct >= THRESH.cpu.crit)
      alerts.push({ level: 'crit', label, msg: `CPU ${cpuPct.toFixed(0)}%` })

    const memPct = snap?.linux?.memory
      ? (100 * snap.linux.memory.memUsedMb) / snap.linux.memory.memTotalMb
      : null
    if (memPct != null && memPct >= THRESH.mem.crit)
      alerts.push({ level: 'crit', label, msg: `Memory ${memPct.toFixed(0)}%` })

    for (const c of snap?.docker?.containers || []) {
      if ((c.restartCount || 0) >= THRESH.restarts.crit)
        alerts.push({ level: 'warn', label, msg: `${c.name}: ${c.restartCount} restarts` })
    }
  }

  if (!alerts.length) return null

  const hasCrit = alerts.some(a => a.level === 'crit')

  return (
    <div className={`sg-alerts sg-alerts--${hasCrit ? 'crit' : 'warn'}`}>
      <div className="sg-alerts-header" onClick={() => setCollapsed(c => !c)}>
        <span className="sg-alerts-title">
          {hasCrit ? 'Critical alerts' : 'Warnings'} — {alerts.length} issue{alerts.length !== 1 ? 's' : ''}
        </span>
        <button type="button" className="sg-alerts-toggle">{collapsed ? 'Show' : 'Hide'}</button>
      </div>
      {!collapsed && (
        <ul className="sg-alerts-list">
          {alerts.map((a, i) => (
            <li key={i} className={`sg-alert-item sg-alert-item--${a.level}`}>
              <strong>{a.label}:</strong> {a.msg}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function ServerGrid() {
  const navigate = useNavigate()
  const [servers, setServers] = useState([])
  const [snapshots, setSnapshots] = useState({})
  const [trends, setTrends] = useState({})
  const [pageLoading, setPageLoading] = useState(true)
  const [loadingIds, setLoadingIds] = useState(new Set())
  const [fetchedAt, setFetchedAt] = useState(null)
  const abortRef = useRef(null)

  const fetchSnapshotsBatched = useCallback(async (serverList, signal) => {
    for (let i = 0; i < serverList.length; i += BATCH_SIZE) {
      const batch = serverList.slice(i, i + BATCH_SIZE)
      if (signal?.aborted) break

      setLoadingIds(prev => new Set([...prev, ...batch.map(s => s.id)]))

      const results = await Promise.allSettled(
        batch.map(async (server) => {
          const res = await fetch(
            `${API_BASE}/snapshot?serverId=${encodeURIComponent(server.id)}`,
            { signal }
          )
          if (!res.ok) return { id: server.id, snap: null }
          const snap = await res.json()
          return { id: server.id, snap }
        })
      )

      if (signal?.aborted) break

      setSnapshots(prev => {
        const next = { ...prev }
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) next[r.value.id] = r.value.snap
        }
        return next
      })

      setTrends(prev => {
        const next = { ...prev }
        for (const r of results) {
          if (r.status !== 'fulfilled' || !r.value?.snap) continue
          const { id, snap } = r.value
          const entry = {
            ts:   Date.now(),
            cpu:  snap.linux?.cpuUsagePercent ?? null,
            disk: maxDiskPct(snap),
            mem:  snap.linux?.memory
              ? (100 * snap.linux.memory.memUsedMb) / snap.linux.memory.memTotalMb
              : null,
          }
          next[id] = parseTrends(saveTrend(id, entry))
        }
        return next
      })

      setLoadingIds(prev => {
        const next = new Set(prev)
        batch.forEach(s => next.delete(s.id))
        return next
      })
    }
    setFetchedAt(new Date())
  }, [])

  const loadAll = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setPageLoading(true)
    let serverList = []
    try {
      const res = await fetch(`${API_BASE}/servers`)
      if (res.ok) serverList = (await res.json()) || []
    } catch {}
    setServers(serverList)

    const initialTrends = {}
    for (const server of serverList) {
      initialTrends[server.id] = parseTrends(loadTrend(server.id))
    }
    setTrends(initialTrends)
    setPageLoading(false)

    await fetchSnapshotsBatched(serverList, controller.signal)
  }, [fetchSnapshotsBatched])

  useEffect(() => {
    loadAll()
    return () => abortRef.current?.abort()
  }, [loadAll])

  const handleCardClick = (server) => {
    sessionStorage.setItem('sentinelops.selectedServer', server.id)
    navigate('/assistant')
  }

  if (pageLoading) {
    return <div className="sg-page"><p className="sg-loading-main">Loading servers…</p></div>
  }

  return (
    <div className="sg-page">
      <div className="sg-toolbar">
        <h1 className="sg-title">Server Grid</h1>
        <div className="sg-toolbar-right">
          {fetchedAt && (
            <span className="sg-fetched-at">Updated {fetchedAt.toLocaleTimeString()}</span>
          )}
          <button
            type="button"
            className="sg-refresh-btn"
            onClick={loadAll}
            disabled={loadingIds.size > 0}
          >
            {loadingIds.size > 0 ? `Fetching ${loadingIds.size}…` : 'Refresh all'}
          </button>
        </div>
      </div>

      <AlertsBanner servers={servers} snapshots={snapshots} />

      <div className="sg-grid">
        {servers.map(server => (
          <ServerCard
            key={server.id}
            server={server}
            snap={snapshots[server.id]}
            trend={trends[server.id] || {}}
            loading={loadingIds.has(server.id) && !snapshots[server.id]}
            onClick={() => handleCardClick(server)}
          />
        ))}
        {servers.length === 0 && (
          <p className="sg-empty">No servers configured. Add some in the AI Assistant.</p>
        )}
      </div>
    </div>
  )
}
