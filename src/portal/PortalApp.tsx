import React from 'react';
import type { PortalUser } from './services/auth';
import { loginWithProvider, logout as logoutUser, resolveCurrentUser } from './services/auth';
import { useHashRoute } from './components/HashRouter';
import { PortalLayout } from './components/PortalLayout';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Teams } from './pages/Teams';
import { Projects } from './pages/Projects';
import { TeamDetail } from './pages/TeamDetail';
import { ProjectDetail } from './pages/ProjectDetail';
import { Billing } from './pages/Billing';
import { Analytics } from './pages/Analytics';

const routes = ['/', '/teams', '/teams/:teamId', '/projects', '/projects/:projectId', '/billing', '/analytics'];

const roleRank = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
} as const;

type Role = keyof typeof roleRank;

const canAccess = (role: Role, required: Role) => roleRank[role] >= roleRank[required];

export const PortalApp: React.FC = () => {
  const [user, setUser] = React.useState<PortalUser | null>(null);
  const [loading, setLoading] = React.useState(true);
  const match = useHashRoute(routes);

  React.useEffect(() => {
    let active = true;
    resolveCurrentUser().then((resolved) => {
      if (!active) return;
      setUser(resolved);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="portal-shell">
        <header className="portal-header">
          <div>
            <div className="brand">AI Video Production Editor</div>
            <div className="tagline">Portal · Loading</div>
          </div>
        </header>
        <div className="portal-main" style={{ gridTemplateColumns: '1fr' }}>
          <div className="panel" style={{ maxWidth: 520 }}>
            Checking your session...
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Login
        onLoginProvider={(provider) => loginWithProvider(provider)}
      />
    );
  }

  const renderRoute = () => {
    if (match.path.startsWith('/teams/') && match.params.teamId) {
      return <TeamDetail teamId={match.params.teamId} />;
    }
    if (match.path.startsWith('/projects/') && match.params.projectId) {
      return <ProjectDetail projectId={match.params.projectId} />;
    }
    switch (match.path) {
      case '/teams':
        return <Teams />;
      case '/projects':
        return <Projects />;
      case '/billing':
        return <Billing />;
      case '/analytics':
        return canAccess(user.role, 'admin') ? (
          <Analytics />
        ) : (
          <div className="panel">Access denied. Analytics requires admin role.</div>
        );
      default:
        return <Overview />;
    }
  };

  return (
    <PortalLayout
      activePath={match.path.replace(/\/(teams|projects)\/.+/, '/$1')}
      role={user.role}
      onLogout={() => {
        logoutUser().then(() => setUser(null));
      }}
    >
      {renderRoute()}
    </PortalLayout>
  );
};
