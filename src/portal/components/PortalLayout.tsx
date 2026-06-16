import React from 'react';
import { HashLink } from './HashRouter';
import type { PortalUser } from '../services/auth';

type NavItem = {
  to: string;
  label: string;
  badge?: string;
  minRole?: PortalUser['role'];
};

const navItems: NavItem[] = [
  { to: '/', label: 'Overview' },
  { to: '/teams', label: 'Teams' },
  { to: '/projects', label: 'Projects' },
  { to: '/billing', label: 'Billing' },
  { to: '/analytics', label: 'Analytics', minRole: 'admin' },
];

const roleRank: Record<PortalUser['role'], number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

type PortalLayoutProps = {
  activePath: string;
  role: PortalUser['role'];
  onLogout: () => void;
  children: React.ReactNode;
};

export const PortalLayout: React.FC<PortalLayoutProps> = ({ activePath, role, onLogout, children }) => (
  <div className="portal-shell">
    <header className="portal-header">
      <div>
        <div className="brand">AI Video Production Editor</div>
        <div className="tagline">Portal · Teams · Projects</div>
      </div>
      <button className="button secondary" onClick={onLogout}>
        Sign out
      </button>
    </header>
    <div className="portal-main">
      <aside className="sidebar">
        <h4>Navigation</h4>
        {navItems
          .filter(item => !item.minRole || roleRank[role] >= roleRank[item.minRole])
          .map(item => (
            <HashLink
              key={item.to}
              to={item.to}
              className={`nav-link${activePath === item.to ? ' active' : ''}`}
            >
              <span>{item.label}</span>
              {item.badge && <span>{item.badge}</span>}
            </HashLink>
          ))}
        <div className="panel" style={{ padding: '14px', gap: '8px' }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--muted)' }}>
            Embed quick link
          </div>
          <HashLink to="/projects" className="button primary" style={{ justifyContent: 'center' }}>
            Launch Embed
          </HashLink>
        </div>
      </aside>
      <div className="content">{children}</div>
    </div>
  </div>
);
