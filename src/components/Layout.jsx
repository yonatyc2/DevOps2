import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/',          label: 'Log Analyzer',   icon: '🔍', end: true  },
  { to: '/certs',     label: 'Cert Monitor',   icon: '🔒', end: false },
  { to: '/registry',  label: 'Docker Registry',icon: '🐳', end: false },
  { to: '/assistant', label: 'AI Assistant',   icon: '🤖', end: false },
];

export default function Layout({ children }) {
  return (
    <div className="layout">
      <nav className="layout-nav">
        <div className="layout-brand">
          <div className="layout-brand-icon">⚡</div>
          <span>DevOps Assistant</span>
        </div>

        <div className="layout-nav-items">
          {navItems.map(({ to, label, icon, end }) => (
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
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="layout-content">
        {children}
      </div>
    </div>
  );
}
