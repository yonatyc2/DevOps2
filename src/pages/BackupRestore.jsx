import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePolling } from '../context/PollingContext'
import ServerSelect from '../components/ServerSelect'
import './BackupRestore.css'

const DATE_EXPR = '$(date +%d_%m_%Y)'

function filterStderr(raw) {
  if (!raw) return ''
  return raw.split('\n').filter(line => {
    const l = line.trim()
    if (!l) return false
    if (l.startsWith('[sudo]')) return false
    if (/^[#\s]+$/.test(l)) return false
    if (l.includes('private server')) return false
    if (l.includes('monitored and recorded')) return false
    if (l.includes('Disconnect IMMEDIATELY')) return false
    if (l.includes('authorized user')) return false
    if (l.includes('debconf:')) return false
    if (l.includes('dpkg-preconfigure')) return false
    return true
  }).join('\n').trim()
}

function summarize(stepId, output) {
  if (!output) return ''
  const out = output.trim()
  switch (stepId) {
    case 'backup': {
      const m = out.match(/Done:\s*(\S+\.sql)/)
      return m ? `Saved to ${m[1]}` : ''
    }
    case 'verify-src':
    case 'verify-tgt': {
      const m = out.match(/\s(\d+[\.,]?\d*[KMG])\s/)
      return m ? `File size: ${m[1]}` : ''
    }
    case 'scp': {
      const m = out.match(/Copied to .+/)
      return m ? m[0] : ''
    }
    case 'terminate': {
      const rows = (out.match(/\bt\b/g) || []).length
      return rows > 0 ? `${rows} connection${rows !== 1 ? 's' : ''} terminated` : 'No active connections'
    }
    case 'drop':
      return out.split('\n').filter(l => l.startsWith('Dropped:')).join('') || ''
    case 'create':
      return out.split('\n').filter(l => l.startsWith('Created:')).join('') || ''
    case 'restore': {
      const tables = (out.match(/CREATE TABLE/g) || []).length
      const rows   = [...out.matchAll(/COPY (\d+)/g)].reduce((s, m) => s + parseInt(m[1]), 0)
      return tables > 0 ? `${tables} table${tables !== 1 ? 's' : ''} restored · ${rows.toLocaleString()} rows imported` : ''
    }
    default:
      return ''
  }
}

const PIPELINE = [
  { id: 'backup',      label: 'Backup source database',          server: 'source' },
  { id: 'verify-src',  label: 'Verify backup file on source',    server: 'source' },
  { id: 'scp',         label: 'Copy backup to target server',    server: 'source' },
  { id: 'terminate',   label: 'Terminate connections on target', server: 'target' },
  { id: 'drop',        label: 'Drop target database',            server: 'target' },
  { id: 'create',      label: 'Create target database',          server: 'target' },
  { id: 'restore',     label: 'Restore database on target',      server: 'target' },
  { id: 'verify-tgt',  label: 'Verify restored database',        server: 'target' },
]

function buildCommand(stepId, { srcDb, srcPwd, tgtDb, tgtPwd, targetHost, sshUser, sshPwd }) {
  const file = `/tmp/${srcDb}_${DATE_EXPR}.sql`
  const q = s => s.replace(/'/g, "'\\''") // escape single quotes for shell

  switch (stepId) {
    case 'backup':
      return `echo '${q(srcPwd)}' | sudo -Su postgres pg_dump -d ${srcDb} -f ${file} && echo "Done: ${file}"`
    case 'verify-src':
      return `ls -lh /tmp/${srcDb}_${DATE_EXPR}.sql`
    case 'scp':
      return `(which sshpass || echo '${q(srcPwd)}' | sudo -S apt-get install -y sshpass) && sshpass -p '${q(sshPwd)}' scp -o StrictHostKeyChecking=no ${file} ${sshUser}@${targetHost}:/tmp/ && echo "Copied to ${targetHost}:/tmp/"`
    case 'terminate':
      return `echo '${q(tgtPwd)}' | sudo -Su postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = '${tgtDb}';"`
    case 'drop':
      return `echo '${q(tgtPwd)}' | sudo -Su postgres psql -c "DROP DATABASE IF EXISTS ${tgtDb};" && echo "Dropped: ${tgtDb}"`
    case 'create':
      return `echo '${q(tgtPwd)}' | sudo -Su postgres psql -c "CREATE DATABASE ${tgtDb};" && echo "Created: ${tgtDb}"`
    case 'restore':
      return `echo '${q(tgtPwd)}' | sudo -Su postgres psql -d ${tgtDb} -f /tmp/${srcDb}_${DATE_EXPR}.sql && echo "Restore complete: ${tgtDb}"`
    case 'verify-tgt':
      return `echo '${q(tgtPwd)}' | sudo -Su postgres psql -c "SELECT datname, pg_size_pretty(pg_database_size(datname)) AS size FROM pg_database WHERE datname = '${tgtDb}';"`
    default:
      return ''
  }
}

function ElapsedTimer({ startTime, running }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!running || !startTime) { setElapsed(0); return }
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 500)
    return () => clearInterval(t)
  }, [running, startTime])
  if (!running) return null
  const m = Math.floor(elapsed / 60)
  const s = elapsed % 60
  return <span className="br-elapsed">{m > 0 ? `${m}m ` : ''}{s}s</span>
}

function StepRow({ step, index, result, running, canRun, runningAll, onRun, srcServer, tgtServer, startTime }) {
  const serverName = step.server === 'source'
    ? (srcServer?.displayName || srcServer?.name || srcServer?.host || '—')
    : (tgtServer?.displayName || tgtServer?.name || tgtServer?.host || '—')

  const summary     = result && !result.error ? summarize(step.id, result.output) : ''
  const cleanStderr = filterStderr(result?.stderr)

  const SLOW_STEPS = new Set(['backup', 'restore'])
  const stepLabel  = running
    ? (SLOW_STEPS.has(step.id) ? (step.id === 'backup' ? 'Backing up…' : 'Restoring…') : 'Running…')
    : null

  return (
    <div className={`br-step ${result ? (result.error ? 'br-step--err' : 'br-step--ok') : ''} ${running ? 'br-step--running' : ''}`}>
      <div className="br-step-header">
        <span className="br-step-num">{index + 1}</span>
        <span className={`br-server-badge br-server-badge--${step.server}`}>
          {step.server === 'source' ? 'SRC' : 'TGT'}
        </span>
        <span className="br-step-label">{step.label}</span>
        <span className="br-step-server">{serverName}</span>
        {result && !running && (
          <span className={`br-badge ${result.error ? 'br-badge--err' : 'br-badge--ok'}`}>
            {result.error ? 'Failed' : 'Done'}
          </span>
        )}
        {running && <span className="br-badge br-badge--running">{stepLabel}</span>}
        <ElapsedTimer startTime={startTime} running={running} />
        <button
          type="button"
          className="br-run-step-btn"
          onClick={onRun}
          disabled={!canRun || runningAll || running}
        >
          ▶ Run
        </button>
      </div>
      {running && (
        <div className="br-progress-wrap">
          <div className="br-progress-track">
            <div className="br-progress-bar" />
          </div>
        </div>
      )}
      {result?.command && <pre className="br-cmd">$ {result.command}</pre>}
      {summary && <div className="br-summary">{summary}</div>}
      {result?.output && <pre className="br-output">{result.output.trim()}</pre>}
      {cleanStderr    && <pre className="br-output br-output--warn">{cleanStderr}</pre>}
      {result?.error  && <pre className="br-output br-output--err">{result.error}</pre>}
    </div>
  )
}

export default function BackupRestore() {
  const navigate = useNavigate()
  const { servers } = usePolling()  // still needed for srcServer/tgtServer lookup

  const [srcServerId, setSrcServerId] = useState(
    sessionStorage.getItem('sentinelops.selectedServer') || ''
  )
  const [tgtServerId, setTgtServerId] = useState('')
  const [srcDb,  setSrcDb]  = useState('')
  const [tgtDb,  setTgtDb]  = useState('')
  const [srcPwd,  setSrcPwd]  = useState('')
  const [tgtPwd,  setTgtPwd]  = useState('')
  const [sshUser, setSshUser] = useState('equals')
  const [sshPwd,  setSshPwd]  = useState('')

  const [results,     setResults]     = useState(new Array(PIPELINE.length).fill(null))
  const [runningStep, setRunningStep] = useState(null)
  const [runningAll,  setRunningAll]  = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [startTimes,  setStartTimes]  = useState({})
  const runAllRef = useRef(false)

  const srcServer  = servers.find(s => s.id === srcServerId)
  const tgtServer  = servers.find(s => s.id === tgtServerId)
  const targetHost = tgtServer?.host || ''

  function getFields() {
    return {
      srcDb:      srcDb.trim(),
      srcPwd,
      tgtDb:      tgtDb.trim() || srcDb.trim(),
      tgtPwd:     tgtPwd || srcPwd,
      targetHost,
      sshUser:    sshUser.trim() || 'equals',
      sshPwd,
    }
  }

  function canRunStep(step) {
    const f = getFields()
    if (step.id === 'scp')
      return !!srcServerId && !!f.srcDb && !!f.srcPwd && !!f.sshPwd && !!f.targetHost
    if (step.server === 'source')
      return !!srcServerId && !!f.srcDb && !!f.srcPwd
    return !!tgtServerId && !!f.tgtDb && !!f.tgtPwd && !!f.targetHost
  }

  const canRunAll = PIPELINE.every(s => canRunStep(s))
  const hasAnyResult = results.some(Boolean)

  async function executeStep(index) {
    const step = PIPELINE[index]
    const fields = getFields()
    const command  = buildCommand(step.id, fields)
    const serverId = step.server === 'source' ? srcServerId : tgtServerId
    const masked   = [fields.srcPwd, fields.tgtPwd, fields.sshPwd].filter(Boolean)

    setRunningStep(index)
    setStartTimes(prev => ({ ...prev, [index]: Date.now() }))
    setResults(prev => { const n = [...prev]; n[index] = null; return n })

    try {
      const r = await fetch('/api/jobs/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, command, maskedValues: masked }),
      })
      const body = await r.json()
      setResults(prev => {
        const n = [...prev]
        n[index] = r.ok
          ? { output: body.output, stderr: body.stderr, exitCode: body.exitCode, command: body.command }
          : { error: body.error || r.statusText }
        return n
      })
      return r.ok
    } catch (err) {
      setResults(prev => { const n = [...prev]; n[index] = { error: err.message }; return n })
      return false
    } finally {
      setRunningStep(null)
    }
  }

  async function runAll() {
    runAllRef.current = true
    setRunningAll(true)
    setSaved(false)
    for (let i = 0; i < PIPELINE.length; i++) {
      if (!runAllRef.current) break
      const ok = await executeStep(i)
      if (!ok) break
    }
    setRunningAll(false)
  }

  async function saveJob() {
    const allOk = results.every(r => r && !r.error)
    const f = getFields()
    await fetch('/api/jobs/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverId: srcServerId,
        serverLabel: `${srcServer?.name || srcServerId} → ${tgtServer?.name || tgtServerId}`,
        taskId: 'backup-restore',
        taskName: `Backup & Restore: ${f.srcDb} → ${f.tgtDb}`,
        steps: PIPELINE.map((s, i) => ({ label: s.label, ...results[i] })),
        status: allOk ? 'ok' : 'failed',
      }),
    })
    setSaved(true)
  }

  return (
    <div className="br-page">
      <div className="br-toolbar">
        <button type="button" className="br-back-btn" onClick={() => navigate('/tasks')}>← Tasks</button>
        <div className="br-title-group">
          <span className="br-category">PostgreSQL</span>
          <h1 className="br-title">Backup &amp; Restore</h1>
        </div>
        <button type="button" className="br-jobs-btn" onClick={() => navigate('/jobs')}>Job History</button>
      </div>

      <p className="br-desc">
        Backup a database on the source server, SCP it to the target server, then drop → create → restore — all in one pipeline.
      </p>

      {/* Config panels */}
      <div className="br-panels">
        <div className="br-panel br-panel--src">
          <div className="br-panel-head">SOURCE</div>
          <div className="br-field-row">
            <label className="br-label">Server</label>
            <ServerSelect className="br-input" value={srcServerId} onChange={setSrcServerId} />
          </div>
          <div className="br-field-row">
            <label className="br-label">Database <span className="br-req">*</span></label>
            <input className="br-input" type="text" value={srcDb} onChange={e => setSrcDb(e.target.value)} placeholder="e.g. product_service_db" />
          </div>
          <div className="br-field-row">
            <label className="br-label">Sudo password <span className="br-req">*</span></label>
            <input className="br-input" type="password" value={srcPwd} onChange={e => setSrcPwd(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="br-field-row">
            <label className="br-label">SSH user (SCP)</label>
            <input className="br-input" type="text" value={sshUser} onChange={e => setSshUser(e.target.value)} placeholder="equals" />
          </div>
          <div className="br-field-row">
            <label className="br-label">SSH password (SCP) <span className="br-req">*</span></label>
            <input className="br-input" type="password" value={sshPwd} onChange={e => setSshPwd(e.target.value)} autoComplete="current-password" />
          </div>
        </div>

        <div className="br-arrow">→</div>

        <div className="br-panel br-panel--tgt">
          <div className="br-panel-head">TARGET</div>
          <div className="br-field-row">
            <label className="br-label">Server</label>
            <ServerSelect className="br-input" value={tgtServerId} onChange={setTgtServerId} />
          </div>
          <div className="br-field-row">
            <label className="br-label">Database <span className="br-req">*</span></label>
            <input className="br-input" type="text" value={tgtDb} onChange={e => setTgtDb(e.target.value)} placeholder={srcDb || 'same as source if blank'} />
          </div>
          <div className="br-field-row">
            <label className="br-label">Sudo password <span className="br-req">*</span></label>
            <input className="br-input" type="password" value={tgtPwd} onChange={e => setTgtPwd(e.target.value)} placeholder="Same as source if blank" autoComplete="current-password" />
          </div>
          {targetHost && (
            <div className="br-field-row">
              <label className="br-label">Target IP</label>
              <span className="br-host-tag">{targetHost}</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="br-actions">
        <button
          type="button"
          className="br-run-all-btn"
          onClick={runAll}
          disabled={!canRunAll || runningAll || runningStep != null}
        >
          {runningAll ? 'Running pipeline…' : `▶▶ Run Full Pipeline (${PIPELINE.length} steps)`}
        </button>
        {hasAnyResult && !runningAll && (
          <button
            type="button"
            className={`br-save-btn ${saved ? 'br-save-btn--saved' : ''}`}
            onClick={saveJob}
            disabled={saved}
          >
            {saved ? '✓ Saved' : '💾 Save to History'}
          </button>
        )}
        {!canRunAll && (
          <span className="br-hint">Fill in both sides to run the full pipeline. Individual steps can run once their side is filled.</span>
        )}
      </div>

      {/* Pipeline */}
      <div className="br-steps">
        {PIPELINE.map((step, i) => (
          <StepRow
            key={step.id}
            step={step}
            index={i}
            result={results[i]}
            running={runningStep === i}
            canRun={canRunStep(step)}
            runningAll={runningAll}
            onRun={() => executeStep(i)}
            srcServer={srcServer}
            tgtServer={tgtServer}
            startTime={startTimes[i]}
          />
        ))}
      </div>
    </div>
  )
}
