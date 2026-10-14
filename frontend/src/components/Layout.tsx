import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { APP_NAME } from '../config';

const LINKS = [
  { to: '/', label: 'Contratos' },
  { to: '/processos', label: 'Processos administrativos' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="login-badge">{APP_NAME.charAt(0).toUpperCase()}</div>
          <div>
            <strong>{APP_NAME}</strong>
            <span>Delta</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {LINKS.map((link) => (
            <Link key={link.to} className={`sidebar-link${pathname === link.to ? ' active' : ''}`} to={link.to}>
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="main-content">{children}</div>
    </div>
  );
}
