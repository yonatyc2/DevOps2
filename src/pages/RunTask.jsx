import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { usePolling } from '../context/PollingContext'
import ServerSelect from '../components/ServerSelect'
import './RunTask.css'

function ParamField({ param, value, onChange }) {
  const common = {
    id: param.key,
    className: 'rt-param-input',
    value,
    onChange: e => onChange(param.key, e.target.value),
    placeholder: param.default ?? '',
  }
  if (param.type === 'number')
    return <input type="number" {...common} />
  if (param.type === 'password')
    return <input type="password" {...common} autoComplete="current-password" />
  if (param.options)
    return (
      <select className="rt-param-input" id={param.key} value={value} onChange={e => onChange(param.key, e.target.value)}>
        <option value="">Select…</option>
        {param.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  return <input type="text" {...common} />
}

function StepOutput({ step, result, running, index, onRun, disabled }) {
  return (
    <div className={`rt-step ${result ? (result.error ? 'rt-step--err' : 'rt-step--ok') : ''} ${running ? 'rt-step--running' : ''}`}>
      <div className="rt-step-header">
        <span className="rt-step-num">{index + 1}</span>
        <span className="rt-step-label">{step.label}</span>
        {result && !running && (
          <span className={`rt-step-badge ${result.error ? 'rt-step-badge--err' : 'rt-step-badge--ok'}`}>
            {result.error ? 'Failed' : 'Done'}
          </span>
        )}
        {running && <span className="rt-step-badge rt-step-badge--running">Running…</span>}
        <button
          type="button"
          className="rt-run-step-btn"
          onClick={onRun}
          disabled={disabled || running}
        >
          ▶ Run
        </button>
      </div>
      {result?.command && (
        <pre className="rt-cmd">$ {result.command}</pre>
      )}
      {result?.output && (
        <pre className="rt-output">{result.output}</pre>
      )}
      {result?.error && (
        <pre className="rt-output rt-output--err">{result.error}</pre>
      )}
    </div>
  )
}

export default function RunTask() {
  const { taskId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { servers } = usePolling()

  const [task, setTask] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [serverId, setServerId] = useState(
    searchParams.get('serverId') ||
    sessionStorage.getItem('sentinelops.selectedServer') ||
    ''
  )
  const [params, setParams] = useState({})
  const [results, setResults] = useState([])
  const [runningStep, setRunningStep] = useState(null)
  const [runningAll, setRunningAll] = useState(false)
  const [saved, setSaved] = useState(false)
  const runAllRef = useRef(false)

  useEffect(() => {
    fetch(`/api/tasks/${taskId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(t => {
        setTask(t)
        const defaults = {}
        for (const p of t.params) defaults[p.key] = p.default ?? ''
        setParams(defaults)
        setResults(new Array(t.steps.length).fill(null))
        setLoading(false)
      })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [taskId])

  function setParam(key, val) {
    setParams(p => ({ ...p, [key]: val }))
  }

  function missingParams() {
    if (!task) return []
    return task.params.filter(p => p.required && !params[p.key])
  }

  async function runStep(index) {
    if (!serverId) return
    setRunningStep(index)
    setResults(prev => {
      const next = [...prev]
      next[index] = null
      return next
    })

    try {
      const r = await fetch('/api/jobs/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, taskId, stepIndex: index, params }),
      })
      const body = await r.json()
      setResults(prev => {
        const next = [...prev]
        next[index] = r.ok ? { output: body.output, command: body.command } : { error: body.error || r.statusText }
        return next
      })
      return r.ok
    } catch (err) {
      setResults(prev => {
        const next = [...prev]
        next[index] = { error: err.message }
        return next
      })
      return false
    } finally {
      setRunningStep(null)
    }
  }

  async function runAll() {
    if (!task || !serverId) return
    runAllRef.current = true
    setRunningAll(true)
    setSaved(false)
    for (let i = 0; i < task.steps.length; i++) {
      if (!runAllRef.current) break
      const ok = await runStep(i)
      if (!ok) break
    }
    setRunningAll(false)
  }

  async function saveJob() {
    if (!task) return
    const server = servers.find(s => s.id === serverId)
    const allOk = results.every(r => r && !r.error)
    await fetch('/api/jobs/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverId,
        serverLabel: server ? (server.name || server.host) : serverId,
        taskId: task.id,
        taskName: task.name,
        steps: task.steps.map((s, i) => ({ label: s.label, ...results[i] })),
        status: allOk ? 'ok' : 'failed',
      }),
    })
    setSaved(true)
  }

  const missing = missingParams()
  const canRun = serverId && missing.length === 0
  const hasAnyResult = results.some(Boolean)
  const allDone = results.every(Boolean)

  if (loading) return <div className="rt-page"><p className="rt-state">Loading task…</p></div>
  if (error)   return <div className="rt-page"><p className="rt-state rt-state--err">{error}</p></div>
  if (!task)   return null

  return (
    <div className="rt-page">
      <div className="rt-toolbar">
        <button type="button" className="rt-back-btn" onClick={() => navigate('/tasks')}>← Tasks</button>
        <div className="rt-title-group">
          <span className="rt-category">{task.category}</span>
          <h1 className="rt-title">{task.name}</h1>
        </div>
        <button type="button" className="rt-jobs-btn" onClick={() => navigate('/jobs')}>Job History</button>
      </div>

      <p className="rt-desc">{task.description}</p>

      {/* Config panel */}
      <div className="rt-config">
        <div className="rt-config-row">
          <label className="rt-param-label" htmlFor="rt-server">Server</label>
          <ServerSelect
            id="rt-server"
            className="rt-param-input"
            value={serverId}
            onChange={setServerId}
            placeholder="Select a server…"
          />
        </div>

        {task.params.map(p => (
          <div key={p.key} className="rt-config-row">
            <label className="rt-param-label" htmlFor={p.key}>
              {p.label}
              {p.required && <span className="rt-required">*</span>}
            </label>
            <ParamField param={p} value={params[p.key] ?? ''} onChange={setParam} />
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="rt-actions">
        <button
          type="button"
          className="rt-run-all-btn"
          onClick={runAll}
          disabled={!canRun || runningAll || runningStep != null}
        >
          {runningAll ? 'Running…' : `▶▶ Run All ${task.steps.length} Steps`}
        </button>

        {hasAnyResult && !runningAll && (
          <button
            type="button"
            className={`rt-save-btn ${saved ? 'rt-save-btn--saved' : ''}`}
            onClick={saveJob}
            disabled={saved}
          >
            {saved ? '✓ Saved' : '💾 Save to History'}
          </button>
        )}

        {!serverId && <span className="rt-hint">Select a server to run tasks.</span>}
        {serverId && missing.length > 0 && (
          <span className="rt-hint">Fill in: {missing.map(p => p.label).join(', ')}</span>
        )}
      </div>

      {/* Steps */}
      <div className="rt-steps">
        {task.steps.map((step, i) => (
          <StepOutput
            key={i}
            index={i}
            step={step}
            result={results[i]}
            running={runningStep === i}
            disabled={!canRun || runningAll || runningStep != null}
            onRun={() => runStep(i)}
          />
        ))}
      </div>
    </div>
  )
}
