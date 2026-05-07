import { useState, useEffect, useCallback } from 'react'
import { usePolling } from '../context/PollingContext'
import './ServerManager.css'

function ServerRow({ server, onSave }) {
  const [group,       setGroup]       = useState(server.group       || '')
  const [displayName, setDisplayName] = useState(server.displayName || '')
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)

  const dirty = group !== (server.group || '') || displayName !== (server.displayName || '')

  async function save() {
    setSaving(true)
    await fetch(`/api/server-meta/${encodeURIComponent(server.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group, displayName }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    onSave()
  }

  async function clear() {
    await fetch(`/api/server-meta/${encodeURIComponent(server.id)}`, { method: 'DELETE' })
    setGroup('')
    setDisplayName('')
    onSave()
  }

  return (
    <tr className="sm-row">
      <td className="sm-cell sm-cell--host">
        <span className="sm-hostname">{server.name || server.host}</span>
        <span className="sm-ip">{server.host}</span>
      </td>
      <td className="sm-cell">
        <input
          className="sm-input"
          type="text"
          placeholder="e.g. CABS"
          value={group}
          onChange={e => setGroup(e.target.value)}
        />
      </td>
      <td className="sm-cell">
        <input
          className="sm-input"
          type="text"
          placeholder="e.g. CABS Production"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
        />
      </td>
      <td className="sm-cell sm-cell--actions">
        <button
          type="button"
          className={`sm-save-btn ${saved ? 'sm-save-btn--saved' : ''}`}
          onClick={save}
          disabled={saving || !dirty}
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
        </button>
        {(server.group || server.displayName) && (
          <button type="button" className="sm-clear-btn" onClick={clear} title="Clear metadata">
            ✕
          </button>
        )}
      </td>
    </tr>
  )
}

export default function ServerManager() {
  const { servers, refreshServers } = usePolling()
  const [filter, setFilter] = useState('')

  useEffect(() => { refreshServers() }, [refreshServers])

  const query = filter.toLowerCase()
  const visible = servers.filter(s =>
    !query ||
    (s.name || '').toLowerCase().includes(query) ||
    (s.host || '').toLowerCase().includes(query) ||
    (s.group || '').toLowerCase().includes(query) ||
    (s.displayName || '').toLowerCase().includes(query)
  )

  const groups = [...new Set(servers.map(s => s.group).filter(Boolean))].sort()

  return (
    <div className="sm-page">
      <div className="sm-toolbar">
        <h1 className="sm-title">Server Labels</h1>
        <input
          className="sm-search"
          type="search"
          placeholder="Filter servers…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <button type="button" className="sm-refresh-btn" onClick={refreshServers} title="Refresh server list">
          ↻ Refresh
        </button>
      </div>

      <p className="sm-hint">
        Assign a <strong>Group</strong> (e.g. CABS, Core Banking) and a <strong>Display Name</strong> (e.g. CABS Production) to each server.
        Servers in the same group will appear together in dropdown menus across the app.
      </p>

      {groups.length > 0 && (
        <div className="sm-groups">
          {groups.map(g => (
            <span key={g} className="sm-group-tag">{g}</span>
          ))}
        </div>
      )}

      {servers.length === 0 ? (
        <p className="sm-empty">No servers found. Add servers via the AI Assistant.</p>
      ) : (
        <div className="sm-table-wrap">
          <table className="sm-table">
            <thead>
              <tr>
                <th className="sm-th">Server</th>
                <th className="sm-th">Group</th>
                <th className="sm-th">Display Name</th>
                <th className="sm-th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(s => (
                <ServerRow key={s.id} server={s} onSave={refreshServers} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
