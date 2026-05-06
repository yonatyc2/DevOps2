import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './Tasks.css'

const CATEGORY_ICONS = {
  'PostgreSQL': '🐘',
  'Services':   '⚙️',
  'Docker':     '🐳',
  'Disk':       '💾',
  'Network':    '🌐',
  'System':     '🖥️',
}

export default function Tasks() {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')

  useEffect(() => {
    fetch('/api/tasks')
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setTasks(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [])

  const query = filter.toLowerCase()
  const visible = tasks.filter(t =>
    !query ||
    t.name.toLowerCase().includes(query) ||
    t.category.toLowerCase().includes(query) ||
    t.description.toLowerCase().includes(query)
  )

  const categories = [...new Set(visible.map(t => t.category))]

  return (
    <div className="tk-page">
      <div className="tk-toolbar">
        <h1 className="tk-title">Daily Tasks</h1>
        <input
          className="tk-search"
          type="search"
          placeholder="Filter tasks…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      {loading && <p className="tk-state">Loading tasks…</p>}
      {error   && <p className="tk-state tk-state--err">{error}</p>}

      {!loading && !error && (
        <div className="tk-body">
          {categories.map(cat => (
            <section key={cat} className="tk-section">
              <h2 className="tk-cat-heading">
                <span className="tk-cat-icon">{CATEGORY_ICONS[cat] || '📌'}</span>
                {cat}
              </h2>
              <div className="tk-grid">
                {cat === 'PostgreSQL' && (
                  <button
                    type="button"
                    className="tk-card tk-card--workflow"
                    onClick={() => navigate('/backup-restore')}
                  >
                    <span className="tk-workflow-badge">workflow</span>
                    <span className="tk-card-name">🔄 Backup &amp; Restore</span>
                    <span className="tk-card-desc">Backup a DB on source, SCP to target, drop → create → restore — all in one pipeline.</span>
                    <span className="tk-card-steps">8 steps · 2 servers</span>
                  </button>
                )}
                {visible.filter(t => t.category === cat).map(task => (
                  <button
                    key={task.id}
                    type="button"
                    className="tk-card"
                    onClick={() => navigate(`/tasks/${task.id}`)}
                  >
                    <span className="tk-card-name">{task.name}</span>
                    <span className="tk-card-desc">{task.description}</span>
                    <span className="tk-card-steps">{task.steps.length} step{task.steps.length !== 1 ? 's' : ''}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {categories.length === 0 && (
            <p className="tk-state">No tasks match your filter.</p>
          )}
        </div>
      )}
    </div>
  )
}
