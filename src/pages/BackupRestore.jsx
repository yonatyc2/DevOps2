import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePolling } from '../context/PollingContext'
import './BackupRestore.css'

const DATE_EXPR = '$(date +%d_%m_%Y)'

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

function buildCommand(stepId, { srcDb, srcPwd, tgtDb, tgtPwd, targetHost, sshUser }) {
  const file = `/tmp/${srcDb}_${DATE_EXPR}.sql`
  const q = s => s.replace(/'/g, "'\\''") // escape single quotes for shell

  switch (stepId) {
    case 'backup':
      return `echo '${q(srcPwd)}' | sudo -Su postgres pg_dump -d ${srcDb} -f ${file} && echo "Done: ${file}"`
    case 'verify-src':
      return `ls -lh /tmp/${srcDb}_${DATE_EXPR}.sql`
    case 'scp':
      return `scp ${file} ${sshUser}@${targetHost}:/tmp/ && echo "Copied to ${targetHost}:/tmp/"`
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

function StepRow({ step, index, result, running, canRun, runningAll, onRun, srcServer, tgtServer }) {
  const serverName = step.server === 'source'
    ? (srcServer?.name || srcServer?.host || '—')
    : (tgtServer?.name || tgtServer?.host || '—')

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
        {running && <span className="br-badge br-badge--running">Running…</span>}
        <button
          type="button"
          className="br-run-step-btn"
          onClick={onRun}
          disabled={!canRun || runningAll || running}
        >
          ▶ Run
        </button>
      </div>
      {result?.command && <pre className="br-cmd">$ {result.command}</pre>}
      {result?.output  && <pre className="br-output">{result.output}</pre>}
      {result?.error   && <pre className="br-output br-output--err">{result.error}</pre>}
    </div>
  )
}

export default function BackupRestore() {
  const navigate = useNavigate()
  const { servers } = usePolling()

  const [srcServerId, setSrcServerId] = useState(
    sessionStorage.getItem('sentinelops.selectedServer') || ''
  )
  const [tgtServerId, setTgtServerId] = useState('')
  const [srcDb,  setSrcDb]  = useState('')
  const [tgtDb,  setTgtDb]  = useState('')
  const [srcPwd, setSrcPwd] = useState('')
  const [tgtPwd, setTgtPwd] = useState('')
  const [sshUser, setSshUser] = useState('equals')

  const [results,     setResults]     = useState(new Array(PIPELINE.length).fill(null))
  const [runningStep, setRunningStep] = useState(null)
  const [runningAll,  setRunningAll]  = useState(false)
  const [saved,       setSaved]       = useState(false)
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
    }
  }

  function canRunStep(step) {
    const f = getFields()
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
    const masked   = [fields.srcPwd, fields.tgtPwd].filter(Boolean)

    setRunningStep(index)
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
          ? { output: body.output, command: body.command }
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
            <select className="br-input" value={srcServerId} onChange={e => setSrcServerId(e.target.value)}>
              <option value="">Select server…</option>
              {servers.map(s => <option key={s.id} value={s.id}>{s.name || s.host}</option>)}
            </select>
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
        </div>

        <div className="br-arrow">→</div>

        <div className="br-panel br-panel--tgt">
          <div className="br-panel-head">TARGET</div>
          <div className="br-field-row">
            <label className="br-label">Server</label>
            <select className="br-input" value={tgtServerId} onChange={e => setTgtServerId(e.target.value)}>
              <option value="">Select server…</option>
              {servers.map(s => <option key={s.id} value={s.id}>{s.name || s.host}</option>)}
            </select>
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
          />
        ))}
      </div>
    </div>
  )
}
