import React from 'react';

type LoginProps = {
  onLoginProvider: (provider: 'discord') => Promise<unknown> | unknown;
};

export const Login: React.FC<LoginProps> = ({ onLoginProvider }) => {
  const [status, setStatus] = React.useState<'idle' | 'error' | 'redirect'>('idle');
  const [message, setMessage] = React.useState('');
  const [loadingProvider, setLoadingProvider] = React.useState<'discord' | null>(null);
  const hasSupabase = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

  const handleProviderLogin = async (provider: 'discord') => {
    if (!hasSupabase) {
      setStatus('error');
      setMessage('OAuth requires Supabase configuration.');
      return;
    }
    setLoadingProvider(provider);
    setStatus('redirect');
    setMessage('Redirecting to Discord...');
    try {
      await onLoginProvider(provider);
    } catch (error) {
      setStatus('error');
      setMessage(
        error instanceof Error
          ? error.message
          : 'Discord login failed. Check Supabase Discord OAuth settings and try again.',
      );
      setLoadingProvider(null);
    }
  };

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div>
          <div className="brand">AI Video Production Editor</div>
          <div className="tagline">Portal · Login</div>
        </div>
      </header>
      <div className="portal-main auth-main" style={{ gridTemplateColumns: '1fr' }}>
        <div className="panel auth-panel">
          <h2>Welcome back</h2>
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            Sign in with Discord to access billing, teams, and subscriptions.
          </p>

          <button
            className="button primary auth-discord-button"
            onClick={() => handleProviderLogin('discord')}
            disabled={loadingProvider !== null}
          >
            {loadingProvider === 'discord' ? 'Redirecting...' : 'Continue with Discord'}
          </button>
          <p className="auth-provider-note">
            Magic link login is disabled for the portal.
          </p>
          {message && (
            <p style={{ color: status === 'error' ? 'var(--danger)' : 'var(--muted)', margin: '12px 0 0' }}>
              {message}
            </p>
          )}
          <p className="auth-footnote">
            Your account stays linked to your team, billing data, and subscription status.
          </p>
        </div>
      </div>
    </div>
  );
};
