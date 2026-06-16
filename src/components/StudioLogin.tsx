import React from 'react';

type StudioLoginProps = {
  onLogin: (email: string) => Promise<void>;
  onRefresh: () => void;
  onProviderLogin: (provider: 'google' | 'discord') => Promise<void>;
};

const StudioLogin: React.FC<StudioLoginProps> = ({ onLogin, onRefresh, onProviderLogin }) => {
  const [email, setEmail] = React.useState('');
  const [status, setStatus] = React.useState<'idle' | 'sent' | 'error'>('idle');
  const [message, setMessage] = React.useState('');
  const hasSupabase = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

  return (
    <div className="flex h-screen w-full bg-gray-950 text-white overflow-hidden">
      <div className="hidden lg:flex w-1/2 relative bg-neutral-900 items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-700/20 via-neutral-900 to-black opacity-90 z-10" />
        <div className="relative z-20 p-12 text-left max-w-md">
          <div className="text-xs uppercase tracking-[0.3em] text-amber-300 mb-6">
            AI Video Production Editor
          </div>
          <h1 className="text-5xl font-black mb-4 tracking-tight">AI Video Production Editor</h1>
          <p className="text-base text-neutral-300 leading-relaxed">
            Login required for the web app. 7‑day trial + Bring‑Your‑Own‑Keys lifetime
            access for 29€ or hosted credits via subscription.
          </p>
          <div className="mt-8 space-y-2 text-sm text-neutral-400">
            <div>• Trial: 7 days, full access (BYOK)</div>
            <div>• Lifetime BYOK: one‑time 29€</div>
            <div>• Hosted Credits: top‑up and pay per generation</div>
          </div>
          <a
            href="./studio.html"
            className="inline-flex mt-8 px-4 py-2 rounded-full border border-white/20 text-sm hover:bg-white/10"
          >
            Manage Billing
          </a>
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-8 bg-gray-950 relative">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center lg:text-left">
            <h2 className="text-3xl font-bold tracking-tight text-white">Sign in</h2>
            <p className="mt-2 text-sm text-gray-400">
              {hasSupabase ? 'Magic link will be sent to your email.' : 'Supabase not configured.'}
            </p>
          </div>

          <div className="space-y-4">
            <div className="grid gap-2">
              <button
                className="w-full border border-gray-800 text-gray-200 py-3 rounded-lg hover:bg-white/5"
                onClick={async () => {
                  setStatus('idle');
                  setMessage('');
                  try {
                    await onProviderLogin('google');
                  } catch (error) {
                    setStatus('error');
                    setMessage(error instanceof Error ? error.message : 'Google login failed.');
                  }
                }}
              >
                Continue with Google
              </button>
              <button
                className="w-full border border-gray-800 text-gray-200 py-3 rounded-lg hover:bg-white/5"
                onClick={async () => {
                  setStatus('idle');
                  setMessage('');
                  try {
                    await onProviderLogin('discord');
                  } catch (error) {
                    console.error('Discord login error:', error);
                    setStatus('error');
                    setMessage(error instanceof Error ? error.message : 'Discord login failed.');
                  }
                }}
              >
                Continue with Discord
              </button>
            </div>

            <div className="flex items-center gap-3 text-xs text-gray-600">
              <div className="flex-1 h-px bg-gray-800" />
              OR
              <div className="flex-1 h-px bg-gray-800" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-900 border border-gray-800 rounded-lg p-3 text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all"
                placeholder="you@domain.com"
              />
            </div>

            <button
              className="w-full bg-white text-black font-semibold py-3 px-4 rounded-lg transition-all hover:bg-gray-200"
              onClick={async () => {
                if (!email) return;
                setStatus('idle');
                setMessage('');
                try {
                  await onLogin(email);
                  setStatus('sent');
                  setMessage('Check your inbox for the magic link.');
                } catch (error) {
                  setStatus('error');
                  setMessage(error instanceof Error ? error.message : 'Login failed. Try again.');
                }
              }}
            >
              Send Magic Link
            </button>

            {hasSupabase && status === 'sent' && (
              <button
                className="w-full border border-gray-800 text-gray-200 py-2 rounded-lg"
                onClick={onRefresh}
              >
                I already clicked the link
              </button>
            )}
          </div>

          {message && (
            <p className="text-sm" style={{ color: status === 'error' ? '#f87171' : '#9ca3af' }}>
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default StudioLogin;
