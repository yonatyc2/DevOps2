import { useState } from 'react';
import axios from 'axios';

const SEV_META = {
  critical: { cls: 'badge-critical', icon: '🔴', bar: '#f87171' },
  high:     { cls: 'badge-high',     icon: '🟠', bar: '#fb923c' },
  medium:   { cls: 'badge-medium',   icon: '🟡', bar: '#fbbf24' },
  low:      { cls: 'badge-low',      icon: '🟢', bar: '#34d39a' },
};

const SAMPLE = `2024-01-15 10:23:45.123 ERROR [payment-service] feign.RetryableException: Read timed out executing GET http://inventory-service/api/stock/check
2024-01-15 10:23:45.200 ERROR [payment-service] java.net.SocketTimeoutException: Read timed out
2024-01-15 10:23:46.001 ERROR [nginx] connect() failed (111: Connection refused) while connecting to upstream
2024-01-15 10:23:46.002 ERROR [nginx] upstream: "http://payment-service:8080/api/pay", 502 Bad Gateway
2024-01-15 10:23:50.100 FATAL [postgres] remaining connection slots are reserved for non-replication superuser connections
2024-01-15 10:23:52.001 ERROR [docker] manifest unknown: manifest not found`;

function FindingCard({ finding, index }) {
  const [open, setOpen] = useState(index === 0);
  const meta = SEV_META[finding.severity] || SEV_META.low;

  return (
    <div
      className="anim-fade-up"
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        marginBottom: 10,
        animationDelay: `${index * 40}ms`,
        transition: 'border-color var(--normal)',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-strong)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
    >
      {/* Card header — always visible */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 18px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {/* Severity bar */}
        <div style={{
          width: 4, height: 36, borderRadius: 99,
          background: meta.bar, flexShrink: 0,
        }} />

        <span className={`badge ${meta.cls}`} style={{ flexShrink: 0 }}>
          {meta.icon} {finding.severity}
        </span>

        <span style={{
          fontSize: 12, color: 'var(--text-subtle)',
          flexShrink: 0, minWidth: 100,
          background: 'var(--bg-input)',
          padding: '3px 9px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)',
        }}>
          {finding.category}
        </span>

        <span style={{ fontWeight: 600, color: 'var(--text)', flex: 1, fontSize: 13 }}>
          {finding.title}
        </span>

        <span style={{
          color: 'var(--text-subtle)', fontSize: 11,
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform var(--normal)',
          flexShrink: 0,
        }}>
          ▼
        </span>
      </button>

      {/* Expanded body */}
      {open && (
        <div style={{
          padding: '0 18px 18px',
          borderTop: '1px solid var(--border)',
          animation: 'fadeUp .18s ease both',
        }}>
          {/* Matched lines */}
          {finding.matchingLines?.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <p className="field-label" style={{ marginBottom: 8 }}>Matched lines</p>
              {finding.matchingLines.map((line, i) => (
                <div key={i} style={{
                  background: 'var(--bg-dark)',
                  border: '1px solid var(--border)',
                  borderLeft: `3px solid ${meta.bar}`,
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: '#fcd34d',
                  marginBottom: 5,
                  lineHeight: 1.5,
                  wordBreak: 'break-all',
                }}>
                  {line}
                </div>
              ))}
            </div>
          )}

          {/* Root cause */}
          <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
            <div style={{
              flexShrink: 0, marginTop: 2,
              width: 20, height: 20,
              background: 'rgba(251,191,36,.15)',
              border: '1px solid rgba(251,191,36,.3)',
              borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12,
            }}>⚑</div>
            <div>
              <p className="field-label" style={{ marginBottom: 5 }}>Root Cause</p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {finding.rootCause}
              </p>
            </div>
          </div>

          {/* Fixes */}
          <div style={{ marginTop: 16 }}>
            <p className="field-label" style={{ marginBottom: 10 }}>Suggested Fixes</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {finding.fixes.map((fix, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                  padding: '8px 12px',
                  background: 'var(--bg-input)',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                }}>
                  <span style={{
                    color: 'var(--accent-dim)', fontWeight: 700,
                    fontSize: 12, flexShrink: 0, marginTop: 1,
                    width: 20, height: 20,
                    background: 'var(--accent-bg)',
                    borderRadius: 4,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {i + 1}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55 }}>
                    {fix}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LogAnalyzer() {
  const [logText, setLogText]   = useState('');
  const [findings, setFindings] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  async function analyze() {
    if (!logText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.post('/api/logs/analyze', { logText });
      setFindings(data.findings);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  const critical = findings?.filter(f => f.severity === 'critical').length ?? 0;
  const high     = findings?.filter(f => f.severity === 'high').length ?? 0;

  return (
    <div className="page">
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        minHeight: 0, padding: '0 0 0 0',
      }}>
        {/* ── Top bar ─────────────────────────────── */}
        <div style={{
          padding: '28px 36px 0',
          display: 'flex', alignItems: 'flex-end',
          justifyContent: 'space-between', flexShrink: 0,
          flexWrap: 'wrap', gap: 16,
        }}>
          <div>
            <h1 className="page-title">Log Analyzer</h1>
            <p className="page-desc">
              Paste Docker, Nginx, Spring Boot, or PostgreSQL logs — get instant diagnosis and fixes.
            </p>
          </div>
          {findings !== null && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {critical > 0 && <span className="badge badge-critical">{critical} Critical</span>}
              {high     > 0 && <span className="badge badge-high">{high} High</span>}
              {findings.length === 0 && <span className="badge badge-ok">✓ No issues found</span>}
            </div>
          )}
        </div>

        {/* ── Split panels ────────────────────────── */}
        <div style={{
          flex: 1, display: 'flex', gap: 20, minHeight: 0,
          padding: '20px 36px 32px',
        }}>
          {/* Left — Input */}
          <div style={{
            width: 400, flexShrink: 0, display: 'flex',
            flexDirection: 'column', gap: 12,
          }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', flex: 1, fontWeight: 500 }}>
                Log input
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setLogText(SAMPLE); setFindings(null); }}
              >
                Sample
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setLogText(''); setFindings(null); }}
                disabled={!logText}
              >
                Clear
              </button>
            </div>

            {/* Textarea */}
            <textarea
              value={logText}
              onChange={e => setLogText(e.target.value)}
              placeholder="Paste your logs here…"
              style={{
                flex: 1,
                minHeight: 320,
                padding: 16,
                background: 'var(--bg-panel)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                color: 'var(--text)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                lineHeight: 1.7,
                resize: 'none',
                outline: 'none',
                transition: 'border-color var(--fast)',
              }}
              onFocus={e  => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e   => e.target.style.borderColor = 'var(--border)'}
            />

            {/* Analyze button */}
            <button
              className="btn btn-primary btn-lg"
              onClick={analyze}
              disabled={loading || !logText.trim()}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              {loading ? (
                <>
                  <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .6s linear infinite', display: 'inline-block' }} />
                  Analyzing…
                </>
              ) : (
                <> 🔍 Analyze Logs </>
              )}
            </button>

            {error && (
              <div className="alert alert-error">
                ⚠️ {error}
              </div>
            )}

            {/* Stats row */}
            {logText && (
              <div style={{
                padding: '10px 14px',
                background: 'var(--bg-input)',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                display: 'flex', gap: 20,
              }}>
                {[
                  ['Lines',    logText.split('\n').filter(Boolean).length],
                  ['Chars',    logText.length.toLocaleString()],
                ].map(([label, val]) => (
                  <div key={label}>
                    <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{val}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right — Results */}
          <div style={{
            flex: 1, minWidth: 0, display: 'flex',
            flexDirection: 'column', gap: 12,
          }}>
            {/* Results header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 32 }}>
              {findings !== null ? (
                <>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    {findings.length === 0
                      ? 'No issues detected'
                      : `${findings.length} issue${findings.length > 1 ? 's' : ''} detected`}
                  </span>
                  {findings.length > 0 && (
                    <div style={{ flex: 1, height: 1, background: 'var(--border)', marginLeft: 8 }} />
                  )}
                </>
              ) : (
                <span style={{ fontSize: 13, color: 'var(--text-subtle)' }}>
                  Results will appear here after analysis
                </span>
              )}
            </div>

            {/* Scrollable findings */}
            <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
              {findings === null && (
                <div className="empty" style={{ height: '100%' }}>
                  <div className="empty-icon">📋</div>
                  <p className="empty-title">No logs analyzed yet</p>
                  <p className="empty-desc">Paste your logs on the left and click Analyze to detect issues.</p>
                </div>
              )}

              {findings !== null && findings.length === 0 && (
                <div className="empty" style={{ height: '100%' }}>
                  <div className="empty-icon">✅</div>
                  <p className="empty-title">All clear</p>
                  <p className="empty-desc">No known error patterns were found in these logs.</p>
                </div>
              )}

              {findings?.map((f, i) => (
                <FindingCard key={f.id} finding={f} index={i} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
