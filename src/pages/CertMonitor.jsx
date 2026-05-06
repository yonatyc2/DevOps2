import { useState } from 'react';
import axios from 'axios';

const DEFAULT_HOSTS = [
  { host: '192.168.150.81',        port: 443 },
  { host: 'com.equals.docker-registry', port: 443 },
];

function daysColor(days) {
  if (days < 0)  return 'var(--danger)';
  if (days < 14) return 'var(--danger)';
  if (days < 30) return 'var(--warning)';
  return 'var(--success)';
}

function daysBarWidth(days) {
  return `${Math.max(0, Math.min(100, (days / 365) * 100))}%`;
}

function CertCard({ result }) {
  const [open, setOpen] = useState(false);
  const { host, port, ok, cert, error } = result;

  const expired   = ok && cert.expired;
  const expiring  = ok && !cert.expired && cert.expiringSoon;
  const healthy   = ok && !expired && !expiring;

  const statusLabel = !ok ? 'Unreachable' : expired ? 'EXPIRED' : expiring ? 'Expiring Soon' : 'Valid';
  const statusBadge = !ok ? 'badge-error' : expired ? 'badge-critical' : expiring ? 'badge-warn' : 'badge-ok';
  const dotClass    = !ok ? 'dot dot-err' : expired ? 'dot dot-err dot-pulse' : expiring ? 'dot dot-warn dot-pulse' : 'dot dot-ok';

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', background: 'none', border: 'none',
          padding: '16px 20px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
        }}
      >
        <div style={{ fontSize: 22, flexShrink: 0 }}>🔒</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
              {host}
              <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>:{port}</span>
            </span>
            <span className={`badge ${statusBadge}`}>
              <span className={dotClass} />
              {statusLabel}
            </span>
          </div>

          {ok && cert && (
            <div style={{ marginTop: 8 }}>
              <div className="progress-track">
                <div className="progress-fill" style={{
                  width: daysBarWidth(cert.daysLeft),
                  background: daysColor(cert.daysLeft),
                }} />
              </div>
              <p style={{ fontSize: 11, color: daysColor(cert.daysLeft), marginTop: 4 }}>
                {cert.daysLeft < 0
                  ? `Expired ${Math.abs(cert.daysLeft)} days ago`
                  : `${cert.daysLeft} days remaining`}
              </p>
            </div>
          )}
        </div>

        <span style={{
          color: 'var(--text-subtle)', fontSize: 11,
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform var(--normal)',
          flexShrink: 0,
        }}>▼</span>
      </button>

      {open && (
        <div style={{
          padding: '0 20px 20px',
          borderTop: '1px solid var(--border)',
          animation: 'fadeUp .18s ease both',
        }}>
          {!ok ? (
            <div className="alert alert-error" style={{ marginTop: 14 }}>
              ⚠️ {error}
            </div>
          ) : (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Details grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  ['Subject',   cert.subject?.CN || JSON.stringify(cert.subject)],
                  ['Issuer',    cert.issuer?.CN  || cert.issuer?.O || JSON.stringify(cert.issuer)],
                  ['Valid From', new Date(cert.validFrom).toLocaleDateString()],
                  ['Expires',   new Date(cert.validTo).toLocaleDateString()],
                ].map(([label, value]) => (
                  <div key={label} style={{
                    padding: '10px 14px',
                    background: 'var(--bg-input)',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)',
                  }}>
                    <p className="field-label" style={{ marginBottom: 4 }}>{label}</p>
                    <p style={{ fontSize: 13, color: 'var(--text)', wordBreak: 'break-word' }}>{value}</p>
                  </div>
                ))}
              </div>

              {/* SANs */}
              {cert.sans?.length > 0 && (
                <div style={{
                  padding: '12px 14px',
                  background: 'var(--bg-input)',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                }}>
                  <p className="field-label" style={{ marginBottom: 8 }}>
                    Subject Alternative Names ({cert.sans.length})
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {cert.sans.map((san, i) => (
                      <span key={i} className="tag">{san}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Fingerprint */}
              {cert.fingerprint && (
                <p style={{ fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                  SHA1: {cert.fingerprint}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CertMonitor() {
  const [results,     setResults]     = useState([]);
  const [bulkLoading, setBulkLoading] = useState(false);

  const [customHost,    setCustomHost]    = useState('');
  const [customPort,    setCustomPort]    = useState('443');
  const [customLoading, setCustomLoading] = useState(false);

  const [sanHost,    setSanHost]    = useState('');
  const [sanPort,    setSanPort]    = useState('443');
  const [sanCheck,   setSanCheck]   = useState('');
  const [sanLoading, setSanLoading] = useState(false);
  const [sanResult,  setSanResult]  = useState(null);

  async function checkBulk() {
    setBulkLoading(true);
    try {
      const { data } = await axios.post('/api/certs/bulk', { hosts: DEFAULT_HOSTS });
      setResults(data);
    } finally {
      setBulkLoading(false);
    }
  }

  async function checkCustom() {
    if (!customHost.trim()) return;
    setCustomLoading(true);
    try {
      const { data } = await axios.post('/api/certs/check', {
        host: customHost.trim(), port: parseInt(customPort, 10) || 443,
      });
      setResults(prev => {
        const rest = prev.filter(r => !(r.host === data.host && r.port === data.port));
        return [data, ...rest];
      });
    } finally {
      setCustomLoading(false);
    }
  }

  async function checkSan() {
    if (!sanHost.trim() || !sanCheck.trim()) return;
    setSanLoading(true);
    setSanResult(null);
    try {
      const { data } = await axios.post('/api/certs/check-san', {
        host: sanHost.trim(), port: parseInt(sanPort, 10) || 443, checkFor: sanCheck.trim(),
      });
      setSanResult(data);
    } catch (err) {
      setSanResult({ ok: false, error: err.message });
    } finally {
      setSanLoading(false);
    }
  }

  return (
    <div className="page">
      <div className="page-wrapper" style={{ gap: 0 }}>
        {/* Page header */}
        <div className="page-header">
          <h1 className="page-title">Certificate Monitor</h1>
          <p className="page-desc">Inspect TLS certificates — expiry, SANs, and issuer details.</p>
        </div>

        {/* ── Known hosts quick-check ─────────────── */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <span className="card-title">
              <span className="card-title-icon">🔒</span>
              Known Hosts
            </span>
            <button
              className="btn btn-primary btn-sm"
              onClick={checkBulk}
              disabled={bulkLoading}
            >
              {bulkLoading ? (
                <>
                  <span style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .6s linear infinite', display: 'inline-block' }} />
                  Checking…
                </>
              ) : '⚡ Check All'}
            </button>
          </div>
          <div className="card-body">
            {results.length === 0 ? (
              <div className="empty" style={{ padding: '32px 24px' }}>
                <div className="empty-icon">🔒</div>
                <p className="empty-title">No checks run yet</p>
                <p className="empty-desc">Click "Check All" to inspect certificates for your registry hosts.</p>
              </div>
            ) : (
              <div className="anim-fade-up">
                {results.map((r, i) => <CertCard key={i} result={r} />)}
              </div>
            )}
          </div>
        </div>

        {/* ── Two-column row ──────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Custom host */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">
                <span className="card-title-icon">🔎</span>
                Check Custom Host
              </span>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <div className="field" style={{ flex: 2 }}>
                  <label className="field-label">Hostname or IP</label>
                  <input
                    className="field-input"
                    value={customHost}
                    onChange={e => setCustomHost(e.target.value)}
                    placeholder="e.g. 192.168.1.10"
                    onKeyDown={e => e.key === 'Enter' && checkCustom()}
                  />
                </div>
                <div className="field" style={{ flex: 0, minWidth: 80 }}>
                  <label className="field-label">Port</label>
                  <input
                    className="field-input"
                    value={customPort}
                    onChange={e => setCustomPort(e.target.value)}
                    placeholder="443"
                  />
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={checkCustom}
                disabled={customLoading || !customHost.trim()}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {customLoading ? 'Checking…' : '→ Check Certificate'}
              </button>
            </div>
          </div>

          {/* SAN checker */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">
                <span className="card-title-icon">🧩</span>
                SAN Coverage Check
              </span>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <div className="field" style={{ flex: 2 }}>
                  <label className="field-label">Connect to host</label>
                  <input
                    className="field-input"
                    value={sanHost}
                    onChange={e => setSanHost(e.target.value)}
                    placeholder="Host to connect"
                  />
                </div>
                <div className="field" style={{ flex: 0, minWidth: 80 }}>
                  <label className="field-label">Port</label>
                  <input
                    className="field-input"
                    value={sanPort}
                    onChange={e => setSanPort(e.target.value)}
                    placeholder="443"
                  />
                </div>
              </div>
              <div className="field">
                <label className="field-label">Verify hostname / IP in SANs</label>
                <input
                  className="field-input"
                  value={sanCheck}
                  onChange={e => setSanCheck(e.target.value)}
                  placeholder="e.g. 192.168.150.81 or myhost.local"
                />
              </div>
              <button
                className="btn btn-secondary"
                onClick={checkSan}
                disabled={sanLoading || !sanHost.trim() || !sanCheck.trim()}
                style={{ width: '100%', justifyContent: 'center', borderColor: 'rgba(139,92,246,.4)', color: '#a78bfa' }}
              >
                {sanLoading ? 'Checking…' : '🧩 Verify SAN'}
              </button>

              {sanResult && (
                <div className="anim-fade-up">
                  {!sanResult.ok ? (
                    <div className="alert alert-error">⚠️ {sanResult.error}</div>
                  ) : (
                    <div style={{
                      padding: '14px 16px',
                      borderRadius: 'var(--radius)',
                      background: sanResult.covered ? 'var(--success-dim)' : 'var(--danger-dim)',
                      border: `1px solid ${sanResult.covered ? 'rgba(52,211,154,.3)' : 'rgba(248,113,113,.3)'}`,
                    }}>
                      <p style={{
                        fontSize: 15, fontWeight: 700,
                        color: sanResult.covered ? 'var(--success)' : 'var(--danger)',
                        marginBottom: 6,
                      }}>
                        {sanResult.covered ? '✓ Covered' : '✗ Not Covered'}
                      </p>
                      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        <span style={{ color: 'var(--accent-dim)', fontFamily: 'var(--font-mono)' }}>
                          {sanResult.checkFor}
                        </span>
                        {sanResult.covered
                          ? ' is present in the certificate SANs.'
                          : ' is NOT in the SANs — TLS will fail for this name.'}
                      </p>
                      {!sanResult.covered && sanResult.cert?.sans?.length > 0 && (
                        <p style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 8 }}>
                          Cert covers: {sanResult.cert.sans.join(', ')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
