import { useState, useRef, useEffect, useMemo } from 'react'
import './SentinelOps.css'

const API_BASE = '/api'
const SECTION_LAYOUT_KEY = 'sentinelops.systemLayout.v1'
const SECTION_IDS = ['disk', 'docker', 'postgres', 'nginx', 'performance']

const defaultSectionLayout = () => ({
  order: [...SECTION_IDS],
  spans: {
    disk: 1,
    docker: 1,
    postgres: 1,
    nginx: 1,
    performance: 2,
  },
})

const normalizeSectionLayout = (value) => {
  const fallback = defaultSectionLayout()
  if (!value || typeof value !== 'object') return fallback

  const rawOrder = Array.isArray(value.order) ? value.order : []
  const uniqueOrder = rawOrder.filter((id, idx) => SECTION_IDS.includes(id) && rawOrder.indexOf(id) === idx)
  const missingIds = SECTION_IDS.filter((id) => !uniqueOrder.includes(id))
  const order = [...uniqueOrder, ...missingIds]

  const rawSpans = value.spans && typeof value.spans === 'object' ? value.spans : {}
  const spans = SECTION_IDS.reduce((acc, id) => {
    const num = Number(rawSpans[id])
    const safe = Number.isFinite(num) ? Math.max(1, Math.min(4, Math.round(num))) : fallback.spans[id]
    acc[id] = safe
    return acc
  }, {})

  return { order, spans }
}

const loadSectionLayout = () => {
  try {
    const raw = localStorage.getItem(SECTION_LAYOUT_KEY)
    if (!raw) return defaultSectionLayout()
    return normalizeSectionLayout(JSON.parse(raw))
  } catch {
    return defaultSectionLayout()
  }
}

export default function SentinelOps() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [includeContext, setIncludeContext] = useState(false)
  const [snapshot, setSnapshot] = useState(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [snapshotError, setSnapshotError] = useState(null)
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(0)
  const [commandModalOpen, setCommandModalOpen] = useState(false)
  const [commandInput, setCommandInput] = useState('')
  const [commandAnalysis, setCommandAnalysis] = useState(null)
  const [commandExecuteResult, setCommandExecuteResult] = useState(null)
  const [commandLoading, setCommandLoading] = useState(false)
  const [serverModalOpen, setServerModalOpen] = useState(false)
  const [serverModalMode, setServerModalMode] = useState('add')
  const [serverSaving, setServerSaving] = useState(false)
  const [serverFormError, setServerFormError] = useState('')
  const [serverForm, setServerForm] = useState({
    name: '',
    host: '',
    port: 22,
    username: '',
    authType: 'PASSWORD',
    password: '',
    privateKey: '',
  })
  const [containerActionLoadingKey, setContainerActionLoadingKey] = useState('')
  const [containerActionFeedback, setContainerActionFeedback] = useState('')
  const [servers, setServers] = useState([])
  const [selectedServerId, setSelectedServerId] = useState('')
  const [analytics, setAnalytics] = useState({ anomalies: [] })
  const [chatMode, setChatMode] = useState('UNKNOWN')
  const [ussdLogs, setUssdLogs] = useState([])
  const [ussdLogsLoading, setUssdLogsLoading] = useState(false)
  const [ussdLogsError, setUssdLogsError] = useState('')
  const [ussdLogsFetchedAt, setUssdLogsFetchedAt] = useState('')
  const [draggingSectionId, setDraggingSectionId] = useState('')
  const [sectionLayout, setSectionLayout] = useState(() => loadSectionLayout())
  const messagesEndRef = useRef(null)

  const groupedServers = useMemo(() => {
    const formatEnvironmentLabel = (raw) => {
      if (!raw) return 'Other'
      const normalized = String(raw).trim().toLowerCase()
      if (!normalized) return 'Other'
      if (normalized === 'cabs') return 'CABS'
      return normalized.charAt(0).toUpperCase() + normalized.slice(1)
    }

    const getEnvironmentKey = (server) => {
      const source = String(server?.name || server?.host || '').trim()
      if (!source) return 'other'
      const key = source.split(/[-_\s.]/)[0]?.toLowerCase()
      return key || 'other'
    }

    const map = new Map()
    for (const server of servers || []) {
      const envKey = getEnvironmentKey(server)
      if (!map.has(envKey)) map.set(envKey, [])
      map.get(envKey).push(server)
    }

    const sortedEntries = Array.from(map.entries())
      .map(([envKey, items]) => ({
        envKey,
        label: formatEnvironmentLabel(envKey),
        items: [...items].sort((a, b) =>
          String(a?.name || a?.host || '').localeCompare(String(b?.name || b?.host || ''))
        ),
      }))
      .sort((a, b) => {
        if (a.envKey === 'other') return 1
        if (b.envKey === 'other') return -1
        return a.label.localeCompare(b.label)
      })

    return sortedEntries
  }, [servers])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const fetchServers = async () => {
    try {
      const res = await fetch(`${API_BASE}/servers`)
      if (res.ok) {
        const data = await res.json()
        setServers(data || [])
      }
    } catch (_) {}
  }

  const fetchChatMode = async () => {
    try {
      const res = await fetch(`${API_BASE}/chat/mode`)
      if (!res.ok) {
        setChatMode('UNKNOWN')
        return
      }
      const data = await safeJson(res)
      setChatMode(data.mode || 'UNKNOWN')
    } catch (_) {
      setChatMode('UNKNOWN')
    }
  }

  const safeJson = async (res) => {
    const text = await res.text()
    if (!text.trim()) return {}
    try {
      return JSON.parse(text)
    } catch {
      return { error: res.statusText || 'Invalid response' }
    }
  }

  const fetchSnapshot = async () => {
    setSnapshotLoading(true)
    setSnapshotError(null)
    try {
      const url = selectedServerId ? `${API_BASE}/snapshot?serverId=${encodeURIComponent(selectedServerId)}` : `${API_BASE}/snapshot`
      const res = await fetch(url)
      const data = await safeJson(res)
      if (!res.ok) {
        setSnapshotError(data.error || res.statusText || 'Request failed')
        setSnapshot(null)
        return
      }
      setSnapshot(data)
    } catch (err) {
      setSnapshotError(err.message)
      setSnapshot(null)
    } finally {
      setSnapshotLoading(false)
    }
  }

  const fetchAnalytics = async () => {
    if (!selectedServerId) return
    try {
      const anomaliesRes = await fetch(`${API_BASE}/analytics/anomalies?serverId=${encodeURIComponent(selectedServerId)}&lastN=20`)
      const anomalies = anomaliesRes.ok ? await anomaliesRes.json() : []
      setAnalytics({ anomalies })
    } catch (_) {
      setAnalytics({ anomalies: [] })
    }
  }

  const selectedServer = useMemo(() => {
    if (!selectedServerId) return null
    return (servers || []).find((s) => s.id === selectedServerId) || null
  }, [servers, selectedServerId])

  const isSelectedServerNginx = useMemo(() => {
    const name = String(selectedServer?.name || '').toLowerCase()
    return name.includes('nginx')
  }, [selectedServer])

  const fetchUssdLogs = async (showLoading = false) => {
    if (!selectedServerId) return
    if (showLoading) setUssdLogsLoading(true)
    setUssdLogsError('')
    try {
      const url = `${API_BASE}/nginx/ussd-logs?serverId=${encodeURIComponent(selectedServerId)}&limit=80`
      const res = await fetch(url)
      const data = await safeJson(res)
      if (!res.ok) {
        setUssdLogsError(data.error || res.statusText || 'Failed to fetch USSD logs')
        return
      }
      setUssdLogs(data.lines || [])
      setUssdLogsFetchedAt(data.fetchedAt || '')
    } catch (err) {
      setUssdLogsError(err.message || 'Failed to fetch USSD logs')
    } finally {
      if (showLoading) setUssdLogsLoading(false)
    }
  }

  useEffect(() => {
    fetchServers()
    fetchChatMode()
    const preselect = sessionStorage.getItem('sentinelops.selectedServer')
    if (preselect) {
      setSelectedServerId(preselect)
      sessionStorage.removeItem('sentinelops.selectedServer')
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(SECTION_LAYOUT_KEY, JSON.stringify(sectionLayout))
    } catch (_) {}
  }, [sectionLayout])

  useEffect(() => {
    fetchSnapshot()
  }, [selectedServerId])

  useEffect(() => {
    if (!autoRefreshSeconds || autoRefreshSeconds <= 0) return
    const intervalId = setInterval(() => {
      fetchSnapshot()
    }, autoRefreshSeconds * 1000)
    return () => clearInterval(intervalId)
  }, [autoRefreshSeconds, selectedServerId])

  useEffect(() => {
    if (selectedServerId) {
      fetch(`${API_BASE}/servers/${selectedServerId}/health`).then(() => fetchServers())
    }
  }, [selectedServerId])

  useEffect(() => {
    if (snapshot && selectedServerId) fetchAnalytics()
  }, [snapshot, selectedServerId])

  useEffect(() => {
    if (!selectedServerId || !isSelectedServerNginx) {
      setUssdLogs([])
      setUssdLogsError('')
      setUssdLogsFetchedAt('')
      return
    }
    fetchUssdLogs(true)
    const intervalId = setInterval(() => {
      fetchUssdLogs(false)
    }, 5000)
    return () => clearInterval(intervalId)
  }, [selectedServerId, isSelectedServerNginx])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMessage = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          includeSystemContext: includeContext,
          serverId: selectedServerId || null,
        }),
      })
      const data = await safeJson(res)
      const content = !res.ok ? (data.error || res.statusText || 'Request failed') : (data.response ?? 'No response received.')
      if (data.mode) setChatMode(data.mode)
      setMessages((prev) => [...prev, { role: 'assistant', content }])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message}. Is the Spring Boot backend running on port 8080?` },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const openCommandModal = () => {
    setCommandModalOpen(true)
    setCommandInput('')
    setCommandAnalysis(null)
    setCommandExecuteResult(null)
  }

  const openServerModal = () => {
    setServerModalMode('add')
    setServerModalOpen(true)
    setServerSaving(false)
    setServerFormError('')
    setServerForm({
      name: '',
      host: '',
      port: 22,
      username: '',
      authType: 'PASSWORD',
      password: '',
      privateKey: '',
    })
  }

  const openEditServerModal = () => {
    if (!selectedServer) return
    setServerModalMode('edit')
    setServerModalOpen(true)
    setServerSaving(false)
    setServerFormError('')
    setServerForm({
      name: selectedServer.name || '',
      host: selectedServer.host || '',
      port: selectedServer.port || 22,
      username: selectedServer.username || '',
      authType: selectedServer.authType || 'PASSWORD',
      password: '',
      privateKey: '',
    })
  }

  const closeServerModal = () => {
    setServerModalOpen(false)
    setServerModalMode('add')
    setServerSaving(false)
    setServerFormError('')
  }

  const submitServerForm = async () => {
    if (serverSaving) return
    const name = String(serverForm.name || '').trim()
    const host = String(serverForm.host || '').trim()
    const username = String(serverForm.username || '').trim()
    const port = Number(serverForm.port || 22)
    const authType = String(serverForm.authType || 'PASSWORD')
    const password = String(serverForm.password || '')
    const privateKey = String(serverForm.privateKey || '')

    if (!host || !username) {
      setServerFormError('Host and username are required.')
      return
    }
    if (authType === 'PASSWORD' && !password.trim()) {
      setServerFormError('Password is required for PASSWORD auth type.')
      return
    }
    if (authType === 'PRIVATE_KEY' && !privateKey.trim()) {
      setServerFormError('Private key is required for PRIVATE_KEY auth type.')
      return
    }

    setServerSaving(true)
    setServerFormError('')
    try {
      const payload = {
        name: name || host,
        host,
        port: Number.isFinite(port) && port > 0 ? port : 22,
        username,
        authType,
        password: authType === 'PASSWORD' ? password : undefined,
        privateKey: authType === 'PRIVATE_KEY' ? privateKey : undefined,
      }
      const isEdit = serverModalMode === 'edit' && selectedServer?.id
      const endpoint = isEdit ? `${API_BASE}/servers/${selectedServer.id}` : `${API_BASE}/servers`
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await safeJson(res)
      if (!res.ok) {
        setServerFormError(data.error || res.statusText || 'Failed to add server.')
        return
      }
      await fetchServers()
      if (data?.id) setSelectedServerId(data.id)
      if (isEdit && selectedServer?.id) {
        setSelectedServerId(selectedServer.id)
      }
      closeServerModal()
    } catch (err) {
      setServerFormError(err.message || 'Failed to add server.')
    } finally {
      setServerSaving(false)
    }
  }

  const deleteSelectedServer = async () => {
    if (!selectedServer?.id || serverSaving) return
    const confirmed = window.confirm(`Delete server "${selectedServer.name || selectedServer.host}"?`)
    if (!confirmed) return
    setServerSaving(true)
    setServerFormError('')
    try {
      const res = await fetch(`${API_BASE}/servers/${selectedServer.id}`, {
        method: 'DELETE',
      })
      if (!res.ok && res.status !== 204) {
        const data = await safeJson(res)
        setServerFormError(data.error || res.statusText || 'Failed to delete server.')
        return
      }
      await fetchServers()
      setSelectedServerId('')
      closeServerModal()
    } catch (err) {
      setServerFormError(err.message || 'Failed to delete server.')
    } finally {
      setServerSaving(false)
    }
  }

  const closeCommandModal = () => {
    setCommandModalOpen(false)
    setCommandInput('')
    setCommandAnalysis(null)
    setCommandExecuteResult(null)
  }

  const analyzeCommand = async () => {
    const cmd = commandInput.trim()
    if (!cmd || commandLoading) return
    setCommandLoading(true)
    setCommandExecuteResult(null)
    try {
      const res = await fetch(`${API_BASE}/commands/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      })
      const data = await safeJson(res)
      if (!res.ok) {
        setCommandAnalysis({ riskLevel: 'LOW', reason: 'Analysis failed: ' + (data.error || res.statusText), rollbackSuggestion: '' })
      } else {
        setCommandAnalysis(data)
      }
    } catch (err) {
      setCommandAnalysis({ riskLevel: 'LOW', reason: 'Analysis failed: ' + err.message, rollbackSuggestion: '' })
    } finally {
      setCommandLoading(false)
    }
  }

  const executeCommand = async () => {
    const cmd = commandInput.trim()
    if (!cmd || !commandAnalysis || commandLoading) return
    setCommandLoading(true)
    try {
      const res = await fetch(`${API_BASE}/commands/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: cmd,
          confirmedRiskLevel: commandAnalysis.riskLevel,
          serverId: selectedServerId || null,
        }),
      })
      const data = await safeJson(res)
      if (!res.ok) {
        setCommandExecuteResult({ executed: false, rejectionReason: data.error || res.statusText || 'Request failed' })
      } else {
        setCommandExecuteResult(data)
      }
    } catch (err) {
      setCommandExecuteResult({ executed: false, rejectionReason: err.message })
    } finally {
      setCommandLoading(false)
    }
  }

  const executeContainerAction = async (container, action) => {
    const target = container?.name || container?.id
    if (!target) return

    const commandByAction = {
      start: `docker start ${target}`,
      restart: `docker restart ${target}`,
      stop: `docker stop ${target}`,
    }
    const command = commandByAction[action]
    if (!command) return

    const loadingKey = `${action}:${target}`
    setContainerActionLoadingKey(loadingKey)
    setContainerActionFeedback('')
    try {
      const analyzeRes = await fetch(`${API_BASE}/commands/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      })
      const analysis = await safeJson(analyzeRes)
      if (!analyzeRes.ok) {
        setContainerActionFeedback(`Failed to analyze command: ${analysis.error || analyzeRes.statusText}`)
        return
      }

      const riskLevel = analysis.riskLevel || 'LOW'
      const reason = analysis.reason || 'No reason provided.'
      const proceed = window.confirm(
        `${action.toUpperCase()} ${target}?\n\nRisk: ${riskLevel}\n${reason}`
      )
      if (!proceed) return

      const executeRes = await fetch(`${API_BASE}/commands/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          confirmedRiskLevel: riskLevel,
          serverId: selectedServerId || null,
        }),
      })
      const result = await safeJson(executeRes)
      if (!executeRes.ok || !result.executed) {
        setContainerActionFeedback(
          `Failed to ${action} ${target}: ${result.rejectionReason || result.error || executeRes.statusText}`
        )
        return
      }

      setContainerActionFeedback(`Success: ${action} executed for ${target} (exit code ${result.exitCode}).`)
      fetchSnapshot()
    } catch (err) {
      setContainerActionFeedback(`Failed to ${action} ${target}: ${err.message}`)
    } finally {
      setContainerActionLoadingKey('')
    }
  }

  const riskLabel = (level) => {
    if (!level) return ''
    const s = String(level)
    return s.charAt(0) + s.slice(1).toLowerCase()
  }

  const mbToGb = (mb) => {
    const val = Number(mb || 0)
    return (val / 1024).toFixed(2)
  }

  const parseSizeToGb = (value) => {
    if (!value) return null
    const text = String(value).trim()
    const match = text.match(/^([0-9]*\.?[0-9]+)\s*([kKmMgGtTpP]?)i?[bB]?$/)
    if (!match) return null
    const num = Number(match[1])
    if (!Number.isFinite(num)) return null
    const unit = (match[2] || '').toUpperCase()
    const factors = { '': 1 / (1024 ** 3), K: 1 / (1024 ** 2), M: 1 / 1024, G: 1, T: 1024, P: 1024 ** 2 }
    const factor = Object.prototype.hasOwnProperty.call(factors, unit) ? factors[unit] : null
    if (factor == null) return null
    return num * factor
  }

  const formatDiskGb = (value) => {
    const gb = parseSizeToGb(value)
    if (gb == null) return 'N/A'
    return `${gb.toFixed(2)} GB`
  }

  const getSectionStyle = (sectionId) => {
    const idx = sectionLayout.order.indexOf(sectionId)
    const order = idx >= 0 ? idx : 999
    const span = Math.max(1, Math.min(4, Number(sectionLayout.spans?.[sectionId] || 1)))
    return {
      order,
      gridColumn: `span ${span}`,
    }
  }

  const resizeSection = (sectionId, delta) => {
    setSectionLayout((prev) => {
      const current = Number(prev.spans?.[sectionId] || 1)
      const next = Math.max(1, Math.min(4, current + delta))
      return {
        ...prev,
        spans: {
          ...prev.spans,
          [sectionId]: next,
        },
      }
    })
  }

  const onSectionDragStart = (sectionId) => {
    setDraggingSectionId(sectionId)
  }

  const onSectionDrop = (targetSectionId) => {
    if (!draggingSectionId || draggingSectionId === targetSectionId) {
      setDraggingSectionId('')
      return
    }
    setSectionLayout((prev) => {
      const order = [...prev.order]
      const from = order.indexOf(draggingSectionId)
      const to = order.indexOf(targetSectionId)
      if (from < 0 || to < 0) return prev
      order.splice(from, 1)
      order.splice(to, 0, draggingSectionId)
      return { ...prev, order }
    })
    setDraggingSectionId('')
  }

  const renderSectionHeader = (title, sectionId) => (
    <div className="section-head">
      <h3>{title}</h3>
      <div className="section-tools">
        <button
          type="button"
          className="section-tool-btn"
          title="Shrink section"
          onClick={() => resizeSection(sectionId, -1)}
        >
          -
        </button>
        <button
          type="button"
          className="section-tool-btn"
          title="Expand section"
          onClick={() => resizeSection(sectionId, 1)}
        >
          +
        </button>
        <span className="section-drag-hint" title="Drag to reorder">drag</span>
      </div>
    </div>
  )

  const anomalyCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 }
    for (const a of analytics.anomalies || []) {
      const sev = String(a?.severity || '').toLowerCase()
      if (sev === 'high' || sev === 'medium' || sev === 'low') counts[sev] += 1
    }
    return counts
  }, [analytics.anomalies])

  return (
    <div className="app">
      {/* ── Compact control bar (replaces duplicate page title) ── */}
      <header className="header">
        <div className="header-top">
          <div className={`mode-badge mode-badge--${String(chatMode).toLowerCase()}`}>
            {chatMode === 'OPENAI' ? '🟢 OpenAI mode' : chatMode === 'LOCAL' ? '🟡 Local mode' : '⚪ Mode unknown'}
          </div>
          <div className="header-actions">
            <div className="server-select-wrap">
              <label className="server-label">Server</label>
              <select
                className="server-select"
                value={selectedServerId}
                onChange={(e) => setSelectedServerId(e.target.value)}
              >
                <option value="">Default (config)</option>
                {groupedServers.map((group) => (
                  <optgroup key={group.envKey} label={`${group.label} (${group.items.length})`}>
                    {group.items.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name || s.host} {s.health ? `(${s.health})` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <button type="button" className="add-server-btn" onClick={openServerModal}>
              + Add server
            </button>
            <button
              type="button"
              className="add-server-btn"
              onClick={openEditServerModal}
              disabled={!selectedServerId}
              title={selectedServerId ? 'Edit selected server' : 'Select a server first'}
            >
              ✎ Manage
            </button>
            <button type="button" className="execute-cmd-btn" onClick={openCommandModal}>
              ⚡ Execute command
            </button>
          </div>
        </div>
      </header>

      {selectedServerId && (
        <div className="anomaly-banner">
          <div className="anomaly-banner-header">
            <h2 className="anomaly-banner-title">Analytics &amp; anomalies</h2>
          </div>
          <div className="anomaly-detected-block">
            <h3 className="anomaly-detected-title">Detected</h3>
            <div className="anomaly-counters">
              <span className="anomaly-counter anomaly-counter--high">High: {anomalyCounts.high}</span>
              <span className="anomaly-counter anomaly-counter--medium">Medium: {anomalyCounts.medium}</span>
              <span className="anomaly-counter anomaly-counter--low">Low: {anomalyCounts.low}</span>
            </div>
          </div>
          <ul className="anomaly-banner-list">
            {(analytics.anomalies || []).map((a, i) => (
              <li key={i} className={`anomaly-banner-item anomaly--${(a.severity || '').toLowerCase()}`}>
                <span className="anomaly-type">{a.type}</span> {a.message}
              </li>
            ))}
            {(!analytics.anomalies || analytics.anomalies.length === 0) && (
              <li className="anomaly-banner-item anomaly--low">No anomalies detected.</li>
            )}
          </ul>
        </div>
      )}

      <div className="system-panel">
        <div className="system-panel-header">
          <h2>System state</h2>
          <div className="system-panel-controls">
            <label className="refresh-interval-label">
              Auto-refresh
              <select
                className="refresh-interval-select"
                value={autoRefreshSeconds}
                onChange={(e) => setAutoRefreshSeconds(Number(e.target.value))}
              >
                <option value={0}>Manual</option>
                <option value={10}>10 sec</option>
                <option value={20}>20 sec</option>
                <option value={30}>30 sec</option>
                <option value={60}>1 min</option>
                <option value={180}>3 min</option>
              </select>
            </label>
            <button type="button" className="refresh-btn" onClick={fetchSnapshot} disabled={snapshotLoading}>
              {snapshotLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        {snapshotError && <p className="system-panel-error">{snapshotError}</p>}
        {snapshot && !snapshotError && (
          <div className="system-panel-content">
            {snapshot.linux && (
              <>
                {snapshot.linux.diskUsage?.length > 0 && (
                  <div
                    className={`panel-section panel-section--disk ${draggingSectionId === 'disk' ? 'is-dragging' : ''}`}
                    style={getSectionStyle('disk')}
                    draggable
                    onDragStart={() => onSectionDragStart('disk')}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onSectionDrop('disk')}
                    onDragEnd={() => setDraggingSectionId('')}
                  >
                    {renderSectionHeader('Disk', 'disk')}
                    <div className="disk-header">
                      <span className="disk-header-mount">Filesystem / Mount</span>
                      <span className="disk-header-size">Used / Total</span>
                    </div>
                    {snapshot.linux.diskUsage.map((d, i) => {
                      const pct = parseInt(String(d.usePercent).replace('%', ''), 10) || 0
                      const isHigh = pct >= 90
                      const isWarn = pct >= 75
                      return (
                        <div key={i} className="disk-row">
                          <div className="disk-target">
                            <span className="disk-fs mono">{d.filesystem}</span>
                            <span className="disk-mount-path">{d.mountedOn || '-'}</span>
                          </div>
                          <div className="disk-bar-wrap">
                            <div
                              className={`disk-bar ${isHigh ? 'disk-bar--high' : isWarn ? 'disk-bar--warn' : ''}`}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          <span className="disk-pct">{d.usePercent}</span>
                          <span className="disk-size-gb">{formatDiskGb(d.used)} / {formatDiskGb(d.size)}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
                {(snapshot.linux.memory || snapshot.linux.cpuUsagePercent != null || snapshot.linux.uptime?.uptimeString) && (
                  <div
                    className={`panel-section panel-section--performance ${draggingSectionId === 'performance' ? 'is-dragging' : ''}`}
                    style={getSectionStyle('performance')}
                    draggable
                    onDragStart={() => onSectionDragStart('performance')}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onSectionDrop('performance')}
                    onDragEnd={() => setDraggingSectionId('')}
                  >
                    {renderSectionHeader('Performance', 'performance')}
                    {snapshot.linux.memory && (
                      <>
                        <div className="memory-row">
                          <span className="memory-label">RAM</span>
                          <div className="disk-bar-wrap">
                            <div
                              className="disk-bar memory-bar"
                              style={{
                                width: `${snapshot.linux.memory.memTotalMb
                                  ? Math.min(100, (100 * snapshot.linux.memory.memUsedMb) / snapshot.linux.memory.memTotalMb)
                                  : 0}%`,
                              }}
                            />
                          </div>
                          <span className="memory-value">
                            {mbToGb(snapshot.linux.memory.memUsedMb)} / {mbToGb(snapshot.linux.memory.memTotalMb)} GB
                          </span>
                        </div>
                        {snapshot.linux.memory.swapTotalMb > 0 && (
                          <div className="memory-row">
                            <span className="memory-label">Swap</span>
                            <div className="disk-bar-wrap">
                              <div
                                className="disk-bar memory-bar memory-bar--swap"
                                style={{
                                  width: `${(100 * snapshot.linux.memory.swapUsedMb) / snapshot.linux.memory.swapTotalMb}%`,
                                }}
                              />
                            </div>
                            <span className="memory-value">
                              {mbToGb(snapshot.linux.memory.swapUsedMb)} / {mbToGb(snapshot.linux.memory.swapTotalMb)} GB
                            </span>
                          </div>
                        )}
                      </>
                    )}
                    {snapshot.linux.cpuUsagePercent != null && (() => {
                      const cpuPct = Number(snapshot.linux.cpuUsagePercent || 0)
                      const cpuIsHigh = cpuPct >= 90
                      const cpuIsWarn = cpuPct >= 75
                      return (
                        <div className="memory-row">
                          <span className="memory-label">CPU</span>
                          <div className="disk-bar-wrap">
                            <div
                              className={`disk-bar cpu-bar ${cpuIsHigh ? 'cpu-bar--high' : cpuIsWarn ? 'cpu-bar--warn' : ''}`}
                              style={{ width: `${Math.min(100, Math.max(0, cpuPct))}%` }}
                            />
                          </div>
                          <span className="memory-value">{cpuPct.toFixed(1)}%</span>
                        </div>
                      )
                    })()}
                    {snapshot.linux.uptime?.uptimeString && (
                      <>
                        <p className="uptime-text mono">{snapshot.linux.uptime.uptimeString}</p>
                        {(snapshot.linux.uptime.load1 != null) && (
                          <p className="load-text">Load: {snapshot.linux.uptime.load1}, {snapshot.linux.uptime.load5}, {snapshot.linux.uptime.load15}</p>
                        )}
                      </>
                    )}
                  </div>
                )}
                {snapshot.linux.error && <p className="panel-error">{snapshot.linux.error}</p>}
              </>
            )}
            {snapshot.docker?.containers?.length > 0 && (
              <div
                className={`panel-section panel-section--docker ${draggingSectionId === 'docker' ? 'is-dragging' : ''}`}
                style={getSectionStyle('docker')}
                draggable
                onDragStart={() => onSectionDragStart('docker')}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onSectionDrop('docker')}
                onDragEnd={() => setDraggingSectionId('')}
              >
                {renderSectionHeader('Docker', 'docker')}
                <ul className="container-list">
                  {snapshot.docker.containers.map((c, i) => (
                    <li key={i} className={`container-item container-item--${(c.state || '').toLowerCase()}`}>
                      {(() => {
                        const isRunning = String(c.state || '').toLowerCase() === 'running'
                        const keyBase = c.name || c.id
                        return (
                          <>
                      <span className="container-name">{c.name}</span>
                      <span className="container-state">{c.state}</span>
                      {c.uptime && <span className="container-uptime" title="Container uptime">{c.uptime}</span>}
                      {c.restartCount > 0 && <span className="container-restarts" title="Restart count">{c.restartCount} restarts</span>}
                      <div className="container-actions">
                        <button
                          type="button"
                          className="container-action-btn"
                          disabled={isRunning || containerActionLoadingKey === `start:${keyBase}`}
                          onClick={() => executeContainerAction(c, 'start')}
                        >
                          {containerActionLoadingKey === `start:${keyBase}` ? 'Starting…' : 'Start'}
                        </button>
                        <button
                          type="button"
                          className="container-action-btn"
                          disabled={containerActionLoadingKey === `restart:${keyBase}`}
                          onClick={() => executeContainerAction(c, 'restart')}
                        >
                          {containerActionLoadingKey === `restart:${keyBase}` ? 'Restarting…' : 'Restart'}
                        </button>
                        <button
                          type="button"
                          className="container-action-btn container-action-btn--danger"
                          disabled={!isRunning || containerActionLoadingKey === `stop:${keyBase}`}
                          onClick={() => executeContainerAction(c, 'stop')}
                        >
                          {containerActionLoadingKey === `stop:${keyBase}` ? 'Stopping…' : 'Stop'}
                        </button>
                      </div>
                          </>
                        )
                      })()}
                    </li>
                  ))}
                </ul>
                {containerActionFeedback && <p className="container-action-feedback">{containerActionFeedback}</p>}
              </div>
            )}
            {snapshot.postgres && (snapshot.postgres.activeConnections !== undefined || snapshot.postgres.databaseSizes?.length > 0) && (
              <div
                className={`panel-section panel-section--postgres ${draggingSectionId === 'postgres' ? 'is-dragging' : ''}`}
                style={getSectionStyle('postgres')}
                draggable
                onDragStart={() => onSectionDragStart('postgres')}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onSectionDrop('postgres')}
                onDragEnd={() => setDraggingSectionId('')}
              >
                {renderSectionHeader('PostgreSQL', 'postgres')}
                {snapshot.postgres.activeConnections !== undefined && (
                  <p>Active connections: {snapshot.postgres.activeConnections}</p>
                )}
                {snapshot.postgres.databaseSizes?.length > 0 && (
                  <ul className="db-list">
                    {snapshot.postgres.databaseSizes.slice(0, 3).map((db, i) => (
                      <li key={i} className="mono">{db.name}: {db.size}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {snapshot.nginx && (
              <div
                className={`panel-section panel-section--nginx ${draggingSectionId === 'nginx' ? 'is-dragging' : ''}`}
                style={getSectionStyle('nginx')}
                draggable
                onDragStart={() => onSectionDragStart('nginx')}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onSectionDrop('nginx')}
                onDragEnd={() => setDraggingSectionId('')}
              >
                {renderSectionHeader('Nginx', 'nginx')}
                <p className="nginx-line">
                  Service:{' '}
                  <span className={`nginx-status-badge ${snapshot.nginx.running ? 'nginx-status-badge--up' : 'nginx-status-badge--down'}`}>
                    {snapshot.nginx.serviceStatus || (snapshot.nginx.running ? 'up' : 'down')}
                  </span>
                </p>
                {snapshot.nginx.localHttpCode && (
                  <p className="nginx-line">
                    Local HTTP response: <span className="mono">{snapshot.nginx.localHttpCode}</span>
                  </p>
                )}
                {snapshot.nginx.responseCodeCounts && Object.keys(snapshot.nginx.responseCodeCounts).length > 0 && (
                  <div className="nginx-codes">
                    {Object.entries(snapshot.nginx.responseCodeCounts)
                      .sort((a, b) => Number(a[0]) - Number(b[0]))
                      .map(([code, count]) => (
                        <span key={code} className="nginx-code-chip">
                          {code}: {count}
                        </span>
                      ))}
                  </div>
                )}
                {(isSelectedServerNginx || snapshot.nginx.ussdLogLines?.length > 0) && (
                  <div className="nginx-logs-wrap">
                    <p className="nginx-line nginx-logs-title">
                      USSD access log (latest {(isSelectedServerNginx ? ussdLogs.length : (snapshot.nginx.ussdLogLines?.length || 0))} lines)
                    </p>
                    {ussdLogsLoading && isSelectedServerNginx && <p className="nginx-line nginx-logs-meta">Loading USSD logs…</p>}
                    {ussdLogsError && isSelectedServerNginx && <p className="panel-error">{ussdLogsError}</p>}
                    {isSelectedServerNginx && ussdLogsFetchedAt && (
                      <p className="nginx-line nginx-logs-meta">Last updated: {new Date(ussdLogsFetchedAt).toLocaleTimeString()}</p>
                    )}
                    <pre className="nginx-logs mono">
                      {(isSelectedServerNginx ? ussdLogs : (snapshot.nginx.ussdLogLines || [])).join('\n')}
                    </pre>
                  </div>
                )}
                {snapshot.nginx.error && <p className="panel-error">{snapshot.nginx.error}</p>}
              </div>
            )}
            {!snapshot.linux?.diskUsage?.length && !snapshot.linux?.memory?.memTotalMb && !snapshot.docker?.containers?.length && !snapshot.postgres?.activeConnections && !snapshot.linux?.error && (
              <p className="system-panel-muted">No snapshot data (SSH may be unconfigured).</p>
            )}
          </div>
        )}
      </div>

      <main className="main">
        <div className="messages">
          {messages.length === 0 && (
            <div className="welcome">
              <p>Ask anything about your infrastructure.</p>
              <p className="examples">
                e.g. "Why is /data almost full?", "Why is Docker restarting?", "Can I safely remove sdb1?"
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`message message--${msg.role}`}>
              <span className="message-role">{msg.role === 'user' ? 'You' : 'SentinelOps'}</span>
              <div className="message-content">{msg.content}</div>
            </div>
          ))}
          {loading && (
            <div className="message message--assistant">
              <span className="message-role">SentinelOps</span>
              <div className="message-content typing">Thinking…</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={includeContext}
              onChange={(e) => setIncludeContext(e.target.checked)}
            />
            Include system context (full snapshot: Linux, Docker, Postgres)
          </label>
          <div className="input-row">
            <textarea
              className="input"
              placeholder="Ask a question…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={loading}
            />
            <button
              className="send-btn"
              onClick={sendMessage}
              disabled={loading || !input.trim()}
            >
              Send
            </button>
          </div>
        </div>
      </main>

      {commandModalOpen && (
        <div className="modal-overlay" onClick={closeCommandModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Approve command</h2>
              <button type="button" className="modal-close" onClick={closeCommandModal} aria-label="Close">&times;</button>
            </div>
            <div className="modal-body">
              <label className="modal-label">Command to run on server</label>
              <textarea
                className="modal-input mono"
                placeholder="e.g. df -h"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                rows={2}
                disabled={commandLoading}
              />
              {!commandAnalysis ? (
                <button type="button" className="modal-btn modal-btn--primary" onClick={analyzeCommand} disabled={commandLoading || !commandInput.trim()}>
                  {commandLoading ? 'Analyzing…' : 'Analyze risk'}
                </button>
              ) : (
                <>
                  <div className="risk-section">
                    <span className="modal-label">Risk level</span>
                    <span className={`risk-badge risk-badge--${(commandAnalysis.riskLevel || '').toLowerCase()}`}>
                      {riskLabel(commandAnalysis.riskLevel)}
                    </span>
                  </div>
                  <p className="risk-reason">{commandAnalysis.reason}</p>
                  {commandAnalysis.rollbackSuggestion && (
                    <p className="risk-rollback"><strong>Rollback:</strong> {commandAnalysis.rollbackSuggestion}</p>
                  )}
                  {commandExecuteResult ? (
                    <div className="execute-result">
                      {commandExecuteResult.executed ? (
                        <>
                          <p className="execute-status execute-status--ok">Command executed (exit code: {commandExecuteResult.exitCode})</p>
                          {commandExecuteResult.stdout && <pre className="execute-output">{commandExecuteResult.stdout}</pre>}
                          {commandExecuteResult.stderr && <pre className="execute-output execute-output--err">{commandExecuteResult.stderr}</pre>}
                          {commandExecuteResult.rollbackSuggestion && (
                            <p className="risk-rollback"><strong>Rollback:</strong> {commandExecuteResult.rollbackSuggestion}</p>
                          )}
                        </>
                      ) : (
                        <p className="execute-status execute-status--fail">{commandExecuteResult.rejectionReason}</p>
                      )}
                    </div>
                  ) : (
                    <div className="modal-actions">
                      <button type="button" className="modal-btn modal-btn--primary" onClick={executeCommand} disabled={commandLoading}>
                        {commandLoading ? 'Running…' : 'Approve & run'}
                      </button>
                      <button type="button" className="modal-btn modal-btn--secondary" onClick={() => { setCommandAnalysis(null); setCommandExecuteResult(null); }} disabled={commandLoading}>
                        Back
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {serverModalOpen && (
        <div className="modal-overlay" onClick={closeServerModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{serverModalMode === 'edit' ? 'Manage server' : 'Add server'}</h2>
              <button type="button" className="modal-close" onClick={closeServerModal} aria-label="Close">&times;</button>
            </div>
            <div className="modal-body">
              <label className="modal-label">Name</label>
              <input
                className="modal-input"
                value={serverForm.name}
                onChange={(e) => setServerForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. cabs-appserver4"
                disabled={serverSaving}
              />
              <label className="modal-label">Host/IP</label>
              <input
                className="modal-input"
                value={serverForm.host}
                onChange={(e) => setServerForm((p) => ({ ...p, host: e.target.value }))}
                placeholder="e.g. 192.168.150.90"
                disabled={serverSaving}
              />
              <div className="server-form-row">
                <div className="server-form-col">
                  <label className="modal-label">Port</label>
                  <input
                    className="modal-input"
                    type="number"
                    min="1"
                    value={serverForm.port}
                    onChange={(e) => setServerForm((p) => ({ ...p, port: Number(e.target.value) }))}
                    disabled={serverSaving}
                  />
                </div>
                <div className="server-form-col">
                  <label className="modal-label">Username</label>
                  <input
                    className="modal-input"
                    value={serverForm.username}
                    onChange={(e) => setServerForm((p) => ({ ...p, username: e.target.value }))}
                    disabled={serverSaving}
                  />
                </div>
              </div>
              <label className="modal-label">Auth type</label>
              <select
                className="modal-input"
                value={serverForm.authType}
                onChange={(e) => setServerForm((p) => ({ ...p, authType: e.target.value }))}
                disabled={serverSaving}
              >
                <option value="PASSWORD">PASSWORD</option>
                <option value="PRIVATE_KEY">PRIVATE_KEY</option>
              </select>
              {serverForm.authType === 'PASSWORD' ? (
                <>
                  <label className="modal-label">Password</label>
                  <input
                    className="modal-input"
                    type="password"
                    value={serverForm.password}
                    onChange={(e) => setServerForm((p) => ({ ...p, password: e.target.value }))}
                    disabled={serverSaving}
                  />
                </>
              ) : (
                <>
                  <label className="modal-label">Private key</label>
                  <textarea
                    className="modal-input mono"
                    rows={5}
                    value={serverForm.privateKey}
                    onChange={(e) => setServerForm((p) => ({ ...p, privateKey: e.target.value }))}
                    disabled={serverSaving}
                  />
                </>
              )}
              {serverFormError && <p className="panel-error">{serverFormError}</p>}
              <div className="modal-actions">
                <button type="button" className="modal-btn modal-btn--primary" onClick={submitServerForm} disabled={serverSaving}>
                  {serverSaving ? 'Saving…' : serverModalMode === 'edit' ? 'Save changes' : 'Save server'}
                </button>
                {serverModalMode === 'edit' && (
                  <button type="button" className="modal-btn modal-btn--danger" onClick={deleteSelectedServer} disabled={serverSaving}>
                    Delete server
                  </button>
                )}
                <button type="button" className="modal-btn modal-btn--secondary" onClick={closeServerModal} disabled={serverSaving}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
