import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './JobHistory.css'

function StatusBadge({ status }) {
  const map = { ok: 'Done', failed: 'Failed' }
  return (
    <span className={`jh-badge jh-badge--${status}`}>{map[status] || status}</span>
  )
}

function StepRow({ step }) {
  const [open, setOpen] = useState(false)
  const hasOutput = step.output || step.error
  return (
    <div className={`jh-step ${step.error ? 'jh-step--err' : 'jh-step--ok'}`}>
      <button type="button" className="jh-step-toggle" onClick={() => setOpen(o => !o)} disabled={!hasOutput}>
        <span className="jh-step-label">{step.label}</span>
        {hasOutput && <span className="jh-toggle-arrow">{open ? '▴' : '▾'}</span>}
      </button>
      {open && hasOutput && (
        <pre className={`jh-step-output ${step.error ? 'jh-step-output--err' : ''}`}>
          {step.output || step.error}
        </pre>
      )}
    </div>
  )
}

function JobCard({ job }) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()
  const date = new Date(job.ts)

  return (
    <div className={`jh-card jh-card--${job.status}`}>
      <div className="jh-card-header">
        <div className="jh-card-meta">
          <span className="jh-job-name">{job.taskName}</span>
          <span className="jh-job-server">{job.serverLabel || job.serverId}</span>
        </div>
        <div className="jh-card-right">
          <StatusBadge status={job.status} />
          <span className="jh-job-ts" title={date.toISOString()}>
            {date.toLocaleDateString([], { month: 'short', day: 'numeric' })} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <button
            type="button"
            className="jh-rerun-btn"
            onClick={() => navigate(`/tasks/${job.taskId}?serverId=${encodeURIComponent(job.serverId)}`)}
          >
            Re-run
          </button>
          <button
            type="button"
            className="jh-expand-btn"
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? 'Hide' : 'Details'}
          </button>
        </div>
      </div>

      {expanded && job.steps && (
        <div className="jh-steps">
          {job.steps.map((s, i) => <StepRow key={i} step={s} />)}
        </div>
      )}
    </div>
  )
}

export default function JobHistory() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/jobs')
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setJobs(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [])

  return (
    <div className="jh-page">
      <div className="jh-toolbar">
        <h1 className="jh-title">Job History</h1>
        <button type="button" className="jh-tasks-btn" onClick={() => navigate('/tasks')}>← Tasks</button>
      </div>

      {loading && <p className="jh-state">Loading…</p>}
      {error   && <p className="jh-state jh-state--err">{error}</p>}

      {!loading && !error && jobs.length === 0 && (
        <p className="jh-state">No jobs saved yet. Run a task and click "Save to History".</p>
      )}

      {!loading && !error && jobs.length > 0 && (
        <div className="jh-list">
          {jobs.map(job => <JobCard key={job.id} job={job} />)}
        </div>
      )}
    </div>
  )
}
