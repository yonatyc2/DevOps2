import { useState, useEffect } from 'react';
import axios from 'axios';

function CheckRow({ label, status, detail }) {
  const ok = status === 'ok';
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '10px 14px',
      background: 'var(--bg-input)',
      borderRadius: 'var(--radius)',
      border: `1px solid ${ok ? 'rgba(52,211,154,.25)' : 'rgba(248,113,113,.25)'}`,
      marginBottom: 8,
    }}>
      <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{ok ? '✅' : '❌'}</span>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13, color: ok ? 'var(--text)' : 'var(--danger)', fontWeight: 500 }}>
          {label}
        </p>
        {detail && (
          <p style={{
            fontSize: 11, color: 'var(--text-subtle)', marginTop: 3,
            fontFamily: 'var(--font-mono)', wordBreak: 'break-all',
          }}>
            {detail}
          </p>
        )}
      </div>
      <span className={`badge ${ok ? 'badge-ok' : 'badge-error'}`} style={{ flexShrink: 0, marginTop: 1 }}>
        {ok ? 'PASS' : 'FAIL'}
      </span>
    </div>
  );
}

export default function DockerRegistry() {
  const [pingStatus,      setPingStatus]      = useState(null);
  const [repos,           setRepos]           = useState(null);
  const [loadingRepos,    setLoadingRepos]    = useState(false);
  const [selectedRepo,    setSelectedRepo]    = useState(null);
  const [tags,            setTags]            = useState(null);
  const [loadingTags,     setLoadingTags]     = useState(false);
  const [validateImage,   setValidateImage]   = useState('');
  const [validateResult,  setValidateResult]  = useState(null);
  const [validating,      setValidating]      = useState(false);
  const [repoFilter,      setRepoFilter]      = useState('');
  const [error,           setError]           = useState(null);

  useEffect(() => {
    axios.get('/api/registry/ping')
      .then(r  => setPingStatus(r.data))
      .catch(() => setPingStatus({ ok: false, error: 'Cannot reach registry' }));
  }, []);

  async function loadCatalog() {
    setLoadingRepos(true);
    setError(null);
    try {
      const { data } = await axios.get('/api/registry/catalog');
      setRepos(data.repositories || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoadingRepos(false);
    }
  }

  async function loadTags(repo) {
    setSelectedRepo(repo);
    setTags(null);
    setLoadingTags(true);
    try {
      const { data } = await axios.get('/api/registry/tags', { params: { repo } });
      setTags(data.tags || []);
    } catch {
      setTags([]);
    } finally {
      setLoadingTags(false);
    }
  }

  async function validate() {
    if (!validateImage.trim()) return;
    setValidating(true);
    setValidateResult(null);
    try {
      const { data } = await axios.post('/api/registry/validate', { image: validateImage.trim() });
      setValidateResult(data);
    } catch (err) {
      setValidateResult({ error: err.message });
    } finally {
      setValidating(false);
    }
  }

  const filteredRepos = repos?.filter(r =>
    r.toLowerCase().includes(repoFilter.toLowerCase())
  ) ?? [];

  const pingOk = pingStatus?.ok;

  return (
    <div className="page">
      <div className="page-wrapper">
        {/* Page header */}
        <div className="page-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h1 className="page-title">Docker Registry</h1>
            <p className="page-desc">Browse images, validate tags, and check TLS — 192.168.150.81 (com.equals.docker-registry)</p>
          </div>
          {/* Registry ping status */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 16px',
            background: 'var(--bg-panel)',
            border: `1px solid ${pingOk === null ? 'var(--border)' : pingOk ? 'rgba(52,211,154,.35)' : 'rgba(248,113,113,.35)'}`,
            borderRadius: 'var(--radius-lg)',
            flexShrink: 0,
          }}>
            {pingStatus === null ? (
              <>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-subtle)', animation: 'blink 1.5s ease-in-out infinite', display: 'inline-block' }} />
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Checking registry…</span>
              </>
            ) : (
              <>
                <span className={`dot ${pingOk ? 'dot-ok dot-pulse' : 'dot-err'}`} />
                <span style={{ fontSize: 13, fontWeight: 600, color: pingOk ? 'var(--success)' : 'var(--danger)' }}>
                  {pingOk ? 'Registry Online' : 'Registry Offline'}
                </span>
                {!pingOk && pingStatus.error && (
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>— {pingStatus.error}</span>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Main browse area ───────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, marginBottom: 20 }}>
          {/* Repositories */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="card-header">
              <span className="card-title">
                <span className="card-title-icon">📦</span>
                Repositories
                {repos !== null && (
                  <span className="badge badge-info" style={{ marginLeft: 4 }}>
                    {filteredRepos.length}
                  </span>
                )}
              </span>
              <button
                className="btn btn-primary btn-sm"
                onClick={loadCatalog}
                disabled={loadingRepos}
              >
                {loadingRepos ? (
                  <span style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .6s linear infinite', display: 'inline-block' }} />
                ) : '↻'} Load
              </button>
            </div>

            {repos !== null && repos.length > 4 && (
              <div style={{ padding: '10px 16px 0' }}>
                <input
                  className="field-input"
                  value={repoFilter}
                  onChange={e => setRepoFilter(e.target.value)}
                  placeholder="Filter repositories…"
                  style={{ fontSize: 12, padding: '7px 12px' }}
                />
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
              {error && <div className="alert alert-error" style={{ margin: '4px 4px 10px' }}>⚠️ {error}</div>}

              {repos === null && !loadingRepos && (
                <div className="empty">
                  <div className="empty-icon">📦</div>
                  <p className="empty-title">No catalog loaded</p>
                  <p className="empty-desc">Click "Load" to fetch all repositories from the registry.</p>
                </div>
              )}

              {loadingRepos && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
                  {[1,2,3,4].map(i => (
                    <div key={i} className="skeleton" style={{ height: 36, borderRadius: 8 }} />
                  ))}
                </div>
              )}

              {filteredRepos.map(repo => (
                <button
                  key={repo}
                  onClick={() => loadTags(repo)}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
                    marginBottom: 3,
                    background: selectedRepo === repo ? 'var(--accent-bg)' : 'transparent',
                    border: `1px solid ${selectedRepo === repo ? 'rgba(77,142,248,.35)' : 'transparent'}`,
                    color: selectedRepo === repo ? 'var(--accent-dim)' : 'var(--text-muted)',
                    fontSize: 13, fontWeight: selectedRepo === repo ? 600 : 400,
                    transition: 'all var(--fast)',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                  onMouseEnter={e => { if (selectedRepo !== repo) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)'; } }}
                  onMouseLeave={e => { if (selectedRepo !== repo) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; } }}
                >
                  <span style={{ fontSize: 14 }}>🐳</span>
                  <span className="truncate">{repo}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Tags panel */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="card-header">
              <span className="card-title">
                <span className="card-title-icon">🏷️</span>
                Tags
                {selectedRepo && (
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 12,
                    color: 'var(--accent-dim)', fontWeight: 400,
                    background: 'var(--accent-bg)',
                    padding: '2px 8px', borderRadius: 6,
                  }}>
                    {selectedRepo}
                  </span>
                )}
                {tags && (
                  <span className="badge badge-info">{tags.length}</span>
                )}
              </span>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {!selectedRepo && (
                <div className="empty">
                  <div className="empty-icon">🏷️</div>
                  <p className="empty-title">No repository selected</p>
                  <p className="empty-desc">Select a repository on the left to view its tags.</p>
                </div>
              )}

              {loadingTags && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[1,2,3].map(i => (
                    <div key={i} className="skeleton" style={{ height: 44, borderRadius: 10 }} />
                  ))}
                </div>
              )}

              {tags !== null && !loadingTags && tags.length === 0 && (
                <div className="empty">
                  <div className="empty-icon">🏷️</div>
                  <p className="empty-title">No tags</p>
                  <p className="empty-desc">This repository has no tags.</p>
                </div>
              )}

              {tags !== null && !loadingTags && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} className="anim-fade-up">
                  {tags.map(tag => (
                    <div key={tag} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      transition: 'border-color var(--fast)',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-strong)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                    >
                      <span style={{ color: 'var(--accent)', fontSize: 14 }}>⬢</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text)', flex: 1 }}>
                        {tag}
                      </span>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setValidateImage(`${selectedRepo}:${tag}`)}
                        style={{ fontSize: 11 }}
                      >
                        Validate →
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Validate image ─────────────────────── */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              <span className="card-title-icon">✅</span>
              Validate Image
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
              Simulates <code style={{ fontFamily: 'var(--font-mono)' }}>docker pull</code>
            </span>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 10, marginBottom: validateResult ? 20 : 0 }}>
              <input
                className="field-input"
                value={validateImage}
                onChange={e => setValidateImage(e.target.value)}
                placeholder="repo/image:tag"
                onKeyDown={e => e.key === 'Enter' && validate()}
                style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
              />
              <button
                className="btn btn-primary"
                onClick={validate}
                disabled={validating || !validateImage.trim()}
                style={{ flexShrink: 0 }}
              >
                {validating ? (
                  <>
                    <span style={{ width: 13, height: 13, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .6s linear infinite', display: 'inline-block' }} />
                    Checking…
                  </>
                ) : '✅ Validate'}
              </button>
            </div>

            {validateResult && (
              <div className="anim-fade-up">
                {validateResult.error ? (
                  <div className="alert alert-error">⚠️ {validateResult.error}</div>
                ) : (
                  <div>
                    <p className="field-label" style={{ marginBottom: 12 }}>
                      Results for{' '}
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-dim)' }}>
                        {validateResult.image}
                      </span>
                    </p>
                    {validateResult.checks?.map((c, i) => (
                      <CheckRow key={i} label={c.label} status={c.status} detail={c.detail} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
