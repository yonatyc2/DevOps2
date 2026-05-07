import { NavLink } from 'react-router-dom';
import { usePolling } from '../context/PollingContext';

const navItems = [
  { to: '/',          label: 'Log Analyzer',    icon: '🔍', end: true  },
  { to: '/certs',     label: 'Cert Monitor',    icon: '🔒', end: false },
  { to: '/registry',  label: 'Docker Registry', icon: '🐳', end: false },
  { to: '/grid',      label: 'Server Grid',     icon: '⬡',  end: false, badge: true },
  { to: '/history',   label: 'History',         icon: '📈', end: false },
  { to: '/tasks',     label: 'Daily Tasks',     icon: '✅', end: false },
  { to: '/servers',   label: 'Servers',         icon: '🖥️', end: false },
  { to: '/assistant', label: 'AI Assistant',    icon: '🤖', end: false },
];

function fmt(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function Layout({ children }) {
  const { alerts, polling, nextPollIn, lastPolledAt, pollNow, dismissAlerts } = usePolling()

  return (
    <div className="layout">
      <nav className="layout-nav">
        <div className="layout-brand">
          <div className="layout-brand-icon">⚡</div>
          <span>DevOps Assistant</span>
        </div>

        <div className="layout-nav-items">
          {navItems.map(({ to, label, icon, end, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `layout-nav-link${isActive ? ' active' : ''}`
              }
            >
              <span className="layout-nav-icon">{icon}</span>
              {label}
              {badge && alerts.length > 0 && (
                <span
                  className="layout-alert-badge"
                  title={`${alerts.length} degradation alert${alerts.length !== 1 ? 's' : ''} — click to dismiss`}
                  onClick={e => { e.preventDefault(); e.stopPropagation(); dismissAlerts() }}
                >
                  {alerts.length}
                </span>
              )}
            </NavLink>
          ))}
        </div>

        <div className="layout-poll-status">
          <span className={`layout-poll-dot ${polling ? 'layout-poll-dot--active' : ''}`} />
          <span className="layout-poll-label">
            {polling ? 'Polling…' : lastPolledAt ? `Next ${fmt(nextPollIn)}` : 'Starting…'}
          </span>
          {!polling && (
            <button type="button" className="layout-poll-now" onClick={pollNow} title="Poll now">
              ↻
            </button>
          )}
        </div>
      </nav>

      <div className="layout-content">
        {children}
      </div>
    </div>
  );
}
