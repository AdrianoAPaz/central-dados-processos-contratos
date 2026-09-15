import type { ReactNode } from 'react';
import { APP_NAME } from '../config';

export function Layout({ children }: { children: ReactNode }) {
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

        {/* Item de exemplo — acrescente mais conforme o projeto crescer. */}
        <nav className="sidebar-nav">
          <a className="sidebar-link active" href="/">
            Início
          </a>
        </nav>
      </aside>
      <div className="main-content">{children}</div>
    </div>
  );
}
