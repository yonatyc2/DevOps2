import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { snapStatus, maxDiskPct, parseSizeToGb } from '../lib/serverHealth'

const PollingContext = createContext(null)

const API_BASE           = '/api'
const POLL_MS            = 5 * 60 * 1000   // 5 minutes
const SERVER_REFRESH_MS  = 30 * 1000        // 30 seconds
const BATCH_SIZE         = 6
const CACHE_KEY     = 'devops.poll.snapshots'
const ALERTS_KEY    = 'devops.poll.alerts'
const STATUS_RANK   = { ok: 0, unknown: 0, warn: 1, crit: 2, offline: 3 }

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

function isDegradation(oldSnap, newSnap) {
  return (STATUS_RANK[snapStatus(newSnap)] ?? 0) > (STATUS_RANK[snapStatus(oldSnap)] ?? 0)
}

async function fetchServersWithMeta() {
  try {
    const [serversRes, metaRes] = await Promise.all([
      fetch(`${API_BASE}/servers`),
      fetch(`${API_BASE}/server-meta`),
    ])
    const list = serversRes.ok ? (await serversRes.json()) || [] : []
    const meta = metaRes.ok ? await metaRes.json() : {}
    return list.map(s => ({
      ...s,
      group:       meta[s.id]?.group       || '',
      displayName: meta[s.id]?.displayName || '',
    }))
  } catch { return [] }
}

async function batchSnapshots(serverList) {
  const out = {}
  for (let i = 0; i < serverList.length; i += BATCH_SIZE) {
    const batch = serverList.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(batch.map(async s => {
      try {
        const res = await fetch(`${API_BASE}/snapshot?serverId=${encodeURIComponent(s.id)}`)
        return { id: s.id, snap: res.ok ? await res.json() : null }
      } catch { return { id: s.id, snap: null } }
    }))
    for (const r of results)
      if (r.status === 'fulfilled' && r.value) out[r.value.id] = r.value.snap
  }
  return out
}

export function PollingProvider({ children }) {
  const [servers,     setServers]     = useState([])
  const [snapshots,   setSnapshots]   = useState(() => loadJson(CACHE_KEY, {}))
  const [alerts,      setAlerts]      = useState(() => loadJson(ALERTS_KEY, []))
  const [lastPolledAt, setLastPolledAt] = useState(null)
  const [polling,     setPolling]     = useState(false)
  const [nextPollIn,  setNextPollIn]  = useState(POLL_MS / 1000)
  const prevRef    = useRef(loadJson(CACHE_KEY, {}))
  const serversRef = useRef([])

  const runPoll = useCallback(async (serverList) => {
    if (!serverList?.length) return
    setPolling(true)
    const newSnaps = await batchSnapshots(serverList)
    const prev = prevRef.current

    // Detect degradations
    const newAlerts = serverList
      .filter(s => prev[s.id] !== undefined && isDegradation(prev[s.id], newSnaps[s.id]))
      .map(s => ({
        id:         `${s.id}-${Date.now()}`,
        serverId:   s.id,
        serverName: s.name || s.host,
        from:       snapStatus(prev[s.id]),
        to:         snapStatus(newSnaps[s.id]),
        ts:         Date.now(),
      }))

    prevRef.current = newSnaps
    setSnapshots(newSnaps)
    saveJson(CACHE_KEY, newSnaps)

    // Persist to history API (fire-and-forget)
    const histBatch = serverList.flatMap(s => {
      const snap = newSnaps[s.id]
      if (!snap) return []
      const disks = snap.linux?.diskUsage || []
      const worstDisk = disks.reduce((best, d) => {
        const pct = parseInt(String(d.usePercent).replace('%', ''), 10) || 0
        return pct > (best ? parseInt(String(best.usePercent).replace('%', ''), 10) || 0 : -1) ? d : best
      }, null)
      const memPct = snap.linux?.memory
        ? (100 * snap.linux.memory.memUsedMb) / snap.linux.memory.memTotalMb
        : null
      return [{
        serverId:    s.id,
        capturedAt:  Date.now(),
        cpuPct:      snap.linux?.cpuUsagePercent ?? null,
        memPct,
        diskPct:     maxDiskPct(snap),
        diskUsedGb:  worstDisk ? parseSizeToGb(worstDisk.used) : null,
        diskTotalGb: worstDisk ? parseSizeToGb(worstDisk.size) : null,
      }]
    })
    if (histBatch.length) {
      fetch(`${API_BASE}/history/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(histBatch),
      }).catch(() => {})
    }

    if (newAlerts.length) {
      setAlerts(prev => {
        const merged = [...prev, ...newAlerts].slice(-50)
        saveJson(ALERTS_KEY, merged)
        return merged
      })
    }

    setLastPolledAt(new Date())
    setPolling(false)
    setNextPollIn(POLL_MS / 1000)
  }, [])

  const pollNow = useCallback(() => runPoll(serversRef.current), [runPoll])

  const refreshServers = useCallback(async () => {
    const list = await fetchServersWithMeta()
    serversRef.current = list
    setServers(list)
  }, [])

  const dismissAlerts = useCallback(() => {
    setAlerts([])
    saveJson(ALERTS_KEY, [])
  }, [])

  useEffect(() => {
    let cancelled = false

    const init = async () => {
      const list = await fetchServersWithMeta()
      if (cancelled) return
      serversRef.current = list
      setServers(list)
      await runPoll(list)
    }
    init()

    const pollTimer = setInterval(async () => {
      const list = await fetchServersWithMeta()
      if (cancelled) return
      serversRef.current = list
      setServers(list)
      await runPoll(list)
    }, POLL_MS)

    const serverTimer = setInterval(async () => {
      const list = await fetchServersWithMeta()
      if (cancelled) return
      serversRef.current = list
      setServers(list)
    }, SERVER_REFRESH_MS)

    const countdownTimer = setInterval(() => {
      setNextPollIn(p => Math.max(0, p - 1))
    }, 1000)

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchServersWithMeta().then(list => {
          if (cancelled) return
          serversRef.current = list
          setServers(list)
        })
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(pollTimer)
      clearInterval(serverTimer)
      clearInterval(countdownTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [runPoll])

  return (
    <PollingContext.Provider value={{ servers, snapshots, alerts, lastPolledAt, polling, nextPollIn, pollNow, dismissAlerts, refreshServers }}>
      {children}
    </PollingContext.Provider>
  )
}

export function usePolling() {
  const ctx = useContext(PollingContext)
  if (!ctx) throw new Error('usePolling must be used inside PollingProvider')
  return ctx
}
