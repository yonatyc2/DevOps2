import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePolling } from '../context/PollingContext'
import { THRESH } from '../lib/serverHealth'
import './HistoryView.css'

const RANGES = [
  { key: '24h', label: '24 h'  },
  { key: '7d',  label: '7 d'   },
  { key: '30d', label: '30 d'  },
]

function fmtTs(ts, range) {
  const d = new Date(ts)
  if (range === '24h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (range === '7d')  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function LineChart({ points, valueKey, color, label, thresholds = {}, range }) {
  const data = points.filter(p => p[valueKey] != null)
  if (data.length < 2) return (
    <div className="hv-chart">
      <span className="hv-chart-label">{label}</span>
      <div className="hv-chart-empty">Not enough data yet</div>
    </div>
  )

  const W = 600, H = 130
  const PAD = { t: 10, r: 14, b: 28, l: 36 }
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b

  const minTs = data[0].ts
  const maxTs = data[data.length - 1].ts
  const tsRange = maxTs - minTs || 1

  const toX = ts => PAD.l + ((ts - minTs) / tsRange) * cW
  const toY = v  => PAD.t + (1 - Math.min(100, Math.max(0, v)) / 100) * cH

  const coords = data.map(p => [toX(p.ts), toY(p[valueKey])])
  const linePath = 'M ' + coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ')
  const areaPath = linePath
    + ` L ${coords[coords.length - 1][0].toFixed(1)},${(PAD.t + cH).toFixed(1)}`
    + ` L ${coords[0][0].toFixed(1)},${(PAD.t + cH).toFixed(1)} Z`

  const gradId = `hv-g-${valueKey}`
  const tickCount = Math.min(6, data.length)
  const ticks = Array.from({ length: tickCount }, (_, i) =>
    minTs + (tsRange * i / Math.max(tickCount - 1, 1))
  )

  return (
    <div className="hv-chart">
      <span className="hv-chart-label">{label}</span>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[25, 50, 75, 100].map(v => (
          <g key={v}>
            <line x1={PAD.l} y1={toY(v)} x2={W - PAD.r} y2={toY(v)}
              stroke="rgba(255,255,255,0.055)" strokeWidth="1" />
            <text x={PAD.l - 5} y={toY(v) + 3.5} textAnchor="end"
              fontSize="9" fill="rgba(255,255,255,0.27)">{v}</text>
          </g>
        ))}

        {/* Threshold dashes */}
        {thresholds.warn != null && (
          <line x1={PAD.l} y1={toY(thresholds.warn)} x2={W - PAD.r} y2={toY(thresholds.warn)}
            stroke="rgba(251,191,36,0.5)" strokeWidth="1" strokeDasharray="4,3" />
        )}
        {thresholds.crit != null && (
          <line x1={PAD.l} y1={toY(thresholds.crit)} x2={W - PAD.r} y2={toY(thresholds.crit)}
            stroke="rgba(248,113,113,0.5)" strokeWidth="1" strokeDasharray="4,3" />
        )}

        {/* Area + line */}
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="1.5"
          strokeLinejoin="round" strokeLinecap="round" />

        {/* Bottom axis */}
        <line x1={PAD.l} y1={PAD.t + cH} x2={W - PAD.r} y2={PAD.t + cH}
          stroke="rgba(255,255,255,0.1)" strokeWidth="1" />

        {ticks.map((ts, i) => (
          <text key={i}
            x={toX(ts).toFixed(1)}
            y={H - 5}
            textAnchor={i === 0 ? 'start' : i === tickCount - 1 ? 'end' : 'middle'}
            fontSize="9"
            fill="rgba(255,255,255,0.27)"
          >
            {fmtTs(ts, range)}
          </text>
        ))}
      </svg>
    </div>
  )
}

function PredictionCard({ prediction }) {
  if (!prediction) return (
    <div className="hv-prediction hv-prediction--stable">
      <h3 className="hv-pred-title">Disk fill prediction</h3>
      <p className="hv-pred-note">Need at least 3 data points over 7 days to predict.</p>
    </div>
  )

  const { daysUntilFull, rateGbPerDay, diskUsedGb, diskTotalGb, basedOnPoints, confidence } = prediction
  const urgency = daysUntilFull == null ? 'stable'
    : daysUntilFull < 7  ? 'crit'
    : daysUntilFull < 30 ? 'warn'
    : 'ok'

  const fillLabel = daysUntilFull == null
    ? 'Stable / shrinking'
    : daysUntilFull > 365
      ? `> 1 year`
      : `~${daysUntilFull} days`

  return (
    <div className={`hv-prediction hv-prediction--${urgency}`}>
      <h3 className="hv-pred-title">Disk fill prediction</h3>
      <div className="hv-pred-grid">
        <div className="hv-pred-stat">
          <span className="hv-pred-label">Full in</span>
          <span className={`hv-pred-value hv-pred-value--${urgency}`}>{fillLabel}</span>
        </div>
        <div className="hv-pred-stat">
          <span className="hv-pred-label">Growth rate</span>
          <span className="hv-pred-value">
            {rateGbPerDay > 0 ? `+${rateGbPerDay}` : rateGbPerDay} GB/day
          </span>
        </div>
        {diskUsedGb != null && diskTotalGb != null && (
          <div className="hv-pred-stat">
            <span className="hv-pred-label">Disk used</span>
            <span className="hv-pred-value">{diskUsedGb} / {diskTotalGb} GB</span>
          </div>
        )}
        <div className="hv-pred-stat">
          <span className="hv-pred-label">Confidence</span>
          <span className="hv-pred-value">{confidence} ({basedOnPoints} pts)</span>
        </div>
      </div>
    </div>
  )
}

export default function HistoryView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { servers } = usePolling()

  const [serverId, setServerId] = useState(searchParams.get('serverId') || '')
  const [range,    setRange]    = useState(searchParams.get('range')    || '24h')
  const [data,     setData]     = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    if (!serverId) return
    setSearchParams({ serverId, range }, { replace: true })
    setLoading(true)
    setError('')
    fetch(`/api/history/${encodeURIComponent(serverId)}?range=${range}`)
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.error || r.statusText)))
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [serverId, range])

  const server = servers.find(s => s.id === serverId)

  return (
    <div className="hv-page">
      <div className="hv-toolbar">
        <div className="hv-controls">
          <select
            className="hv-select"
            value={serverId}
            onChange={e => setServerId(e.target.value)}
          >
            <option value="">Select a server…</option>
            {servers.map(s => (
              <option key={s.id} value={s.id}>{s.name || s.host}</option>
            ))}
          </select>
          <div className="hv-range-tabs">
            {RANGES.map(r => (
              <button
                key={r.key}
                type="button"
                className={`hv-range-tab${range === r.key ? ' active' : ''}`}
                onClick={() => setRange(r.key)}
                disabled={!serverId}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {server && <span className="hv-server-label">{server.name || server.host}</span>}
      </div>

      {!serverId && (
        <div className="hv-state">Select a server to view its history.</div>
      )}
      {serverId && loading && <div className="hv-state">Loading…</div>}
      {serverId && error   && <div className="hv-state hv-state--err">{error}</div>}

      {serverId && data && !loading && (
        <div className="hv-body">
          {data.points.length < 2 ? (
            <div className="hv-state">
              No data yet for this range. History accumulates from background polls (every 5 min).
            </div>
          ) : (
            <div className="hv-charts">
              <LineChart points={data.points} valueKey="cpu"  color="#60a5fa" label="CPU %"
                thresholds={{ warn: THRESH.cpu.warn,  crit: THRESH.cpu.crit  }} range={range} />
              <LineChart points={data.points} valueKey="mem"  color="#34d399" label="Memory %"
                thresholds={{ warn: THRESH.mem.warn,  crit: THRESH.mem.crit  }} range={range} />
              <LineChart points={data.points} valueKey="disk" color="#a78bfa" label="Disk %"
                thresholds={{ warn: THRESH.disk.warn, crit: THRESH.disk.crit }} range={range} />
            </div>
          )}

          <PredictionCard prediction={data.prediction} />

          <p className="hv-footnote">
            {data.points.length} data points in range · prediction uses 7-day linear regression
          </p>
        </div>
      )}
    </div>
  )
}
