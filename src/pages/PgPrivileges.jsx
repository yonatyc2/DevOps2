import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePolling } from '../context/PollingContext'
import ServerSelect from '../components/ServerSelect'
import './PgPrivileges.css'

const PRIVS = [
  { key: 'rolsuper',       label: 'Superuser',    onSql: 'SUPERUSER',   offSql: 'NOSUPERUSER',   danger: true  },
  { key: 'rolcreaterole',  label: 'Create Role',  onSql: 'CREATEROLE',  offSql: 'NOCREATEROLE',  danger: false },
  { key: 'rolcreatedb',    label: 'Create DB',    onSql: 'CREATEDB',    offSql: 'NOCREATEDB',    danger: false },
  { key: 'rolcanlogin',    label: 'Login',        onSql: 'LOGIN',       offSql: 'NOLOGIN',       danger: false },
  { key: 'rolreplication', label: 'Replication',  onSql: 'REPLICATION', offSql: 'NOREPLICATION', danger: true  },
  { key: 'rolbypassrls',   label: 'Bypass RLS',   onSql: 'BYPASSRLS',  offSql: 'NOBYPASSRLS',   danger: true  },
]

function parseRoles(stdout) {
  return stdout
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const [rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls] = line.split('|')
      if (!rolname) return null
      return {
        name:          rolname,
        rolsuper:       rolsuper       === 't',
        rolcreaterole:  rolcreaterole  === 't',
        rolcreatedb:    rolcreatedb    === 't',
        rolcanlogin:    rolcanlogin    === 't',
        rolreplication: rolreplication === 't',
        rolbypassrls:   rolbypassrls   === 't',
      }
    })
    .filter(Boolean)
}

function buildAlterCmd(rolname, privs, sudoPwd) {
  const q = s => s.replace(/'/g, "'\\''")
  const attrs = PRIVS.map(p => privs[p.key] ? p.onSql : p.offSql).join(' ')
  return `echo '${q(sudoPwd)}' | sudo -Su postgres psql -c "ALTER ROLE ${rolname} WITH ${attrs};"`
}

function PrivBadge({ label, danger }) {
  return <span className={`pgp-badge ${danger ? 'pgp-badge--danger' : 'pgp-badge--info'}`}>{label}</span>
}

function Toggle({ priv, checked, onChange, disabled }) {
  return (
    <label className={`pgp-toggle ${priv.danger && checked ? 'pgp-toggle--danger' : ''} ${disabled ? 'pgp-toggle--disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(priv.key, e.target.checked)}
        disabled={disabled}
      />
      <span className="pgp-toggle-track">
        <span className="pgp-toggle-thumb" />
      </span>
      <span className="pgp-toggle-label">{priv.label}</span>
    </label>
  )
}

export default function PgPrivileges() {
  const navigate    = useNavigate()
  const { servers } = usePolling()

  const [serverId,  setServerId]  = useState('')
  const [sudoPwd,   setSudoPwd]   = useState('')
  const [filter,    setFilter]    = useState('')
  const [roles,     setRoles]     = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [loadErr,   setLoadErr]   = useState('')

  const [selected,  setSelected]  = useState(null)   // role name string
  const [editPrivs, setEditPrivs] = useState({})     // { rolsuper: bool, ... }
  const [applying,  setApplying]  = useState(false)
  const [applyResult, setApplyResult] = useState(null) // { ok, message, command }

  async function runCmd(command) {
    const r = await fetch('/api/jobs/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, command, maskedValues: [sudoPwd] }),
    })
    return r.json()
  }

  async function loadRoles() {
    if (!serverId || !sudoPwd) return
    setLoading(true)
    setLoadErr('')
    setRoles(null)
    setSelected(null)
    setApplyResult(null)
    const q = s => s.replace(/'/g, "'\\''")
    const cmd = `echo '${q(sudoPwd)}' | sudo -Su postgres psql -t -A -F'|' -c "SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls FROM pg_roles WHERE rolname NOT LIKE 'pg_%' ORDER BY rolname;"`
    try {
      const body = await runCmd(cmd)
      if (body.error) { setLoadErr(body.error); return }
      const parsed = parseRoles(body.output || '')
      if (!parsed.length) { setLoadErr('No roles found — check password or server.'); return }
      setRoles(parsed)
    } catch (e) {
      setLoadErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  function selectRole(role) {
    setSelected(role.name)
    const privs = {}
    for (const p of PRIVS) privs[p.key] = role[p.key]
    setEditPrivs(privs)
    setApplyResult(null)
  }

  async function applyChanges() {
    if (!selected) return
    setApplying(true)
    setApplyResult(null)
    const cmd = buildAlterCmd(selected, editPrivs, sudoPwd)
    try {
      const body = await runCmd(cmd)
      const ok = !body.error && (body.output || '').includes('ALTER ROLE')
      setApplyResult({
        ok,
        message: ok ? 'Privileges updated.' : (body.error || body.output || 'Unknown error'),
        command: body.command,
      })
      if (ok) await loadRoles()
    } catch (e) {
      setApplyResult({ ok: false, message: e.message })
    } finally {
      setApplying(false)
    }
  }

  const canLoad   = !!serverId && !!sudoPwd
  const canApply  = !!selected && !applying

  const query     = filter.toLowerCase()
  const visible   = roles
    ? roles.filter(r => !query || r.name.toLowerCase().includes(query))
    : []

  const selectedRole = roles?.find(r => r.name === selected)

  return (
    <div className="pgp-page">
      <div className="pgp-toolbar">
        <button type="button" className="pgp-back-btn" onClick={() => navigate('/tasks')}>← Tasks</button>
        <div className="pgp-title-group">
          <span className="pgp-category">PostgreSQL</span>
          <h1 className="pgp-title">Role Manager</h1>
        </div>
      </div>

      <p className="pgp-desc">
        Load all roles from a PostgreSQL server, then select a user to grant or revoke privileges.
      </p>

      {/* Config */}
      <div className="pgp-config">
        <div className="pgp-config-row">
          <label className="pgp-label">Server</label>
          <ServerSelect className="pgp-input" value={serverId} onChange={setServerId} />
        </div>
        <div className="pgp-config-row">
          <label className="pgp-label">Sudo password <span className="pgp-req">*</span></label>
          <input
            className="pgp-input"
            type="password"
            value={sudoPwd}
            onChange={e => setSudoPwd(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && canLoad && loadRoles()}
            autoComplete="current-password"
          />
        </div>
        <button
          type="button"
          className="pgp-load-btn"
          onClick={loadRoles}
          disabled={!canLoad || loading}
        >
          {loading ? 'Loading…' : '⟳ Load Roles'}
        </button>
      </div>

      {loadErr && <p className="pgp-err">{loadErr}</p>}

      {roles && (
        <div className="pgp-body">
          {/* Role list */}
          <div className="pgp-list-wrap">
            <div className="pgp-list-header">
              <span className="pgp-count">{roles.length} roles</span>
              <input
                className="pgp-search"
                type="search"
                placeholder="Filter…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
            </div>
            <div className="pgp-list">
              {visible.map(role => {
                const activePrivs = PRIVS.filter(p => role[p.key])
                return (
                  <button
                    key={role.name}
                    type="button"
                    className={`pgp-role-row ${selected === role.name ? 'pgp-role-row--active' : ''}`}
                    onClick={() => selectRole(role)}
                  >
                    <span className="pgp-role-name">{role.name}</span>
                    <span className="pgp-role-privs">
                      {activePrivs.length === 0
                        ? <span className="pgp-none">no privileges</span>
                        : activePrivs.map(p => <PrivBadge key={p.key} label={p.label} danger={p.danger} />)
                      }
                    </span>
                  </button>
                )
              })}
              {visible.length === 0 && <p className="pgp-none-msg">No roles match.</p>}
            </div>
          </div>

          {/* Edit panel */}
          {selected && (
            <div className="pgp-edit-panel">
              <div className="pgp-edit-header">
                <span className="pgp-edit-name">{selected}</span>
                <span className="pgp-edit-hint">Toggle privileges then click Apply</span>
              </div>

              <div className="pgp-toggles">
                {PRIVS.map(p => (
                  <Toggle
                    key={p.key}
                    priv={p}
                    checked={editPrivs[p.key] ?? false}
                    onChange={(key, val) => setEditPrivs(prev => ({ ...prev, [key]: val }))}
                    disabled={applying}
                  />
                ))}
              </div>

              <div className="pgp-edit-actions">
                <button
                  type="button"
                  className="pgp-apply-btn"
                  onClick={applyChanges}
                  disabled={!canApply}
                >
                  {applying ? 'Applying…' : '✓ Apply Changes'}
                </button>
                <button
                  type="button"
                  className="pgp-reset-btn"
                  onClick={() => selectRole(selectedRole)}
                  disabled={applying}
                >
                  Reset
                </button>
              </div>

              {applyResult && (
                <div className={`pgp-result ${applyResult.ok ? 'pgp-result--ok' : 'pgp-result--err'}`}>
                  {applyResult.command && (
                    <pre className="pgp-result-cmd">$ {applyResult.command}</pre>
                  )}
                  <span className="pgp-result-msg">
                    {applyResult.ok ? '✓ ' : '✗ '}{applyResult.message}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
