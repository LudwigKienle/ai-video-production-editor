import React, { useCallback, useEffect, useState } from 'react';
import {
  connectStudioClient,
  disconnectStudioClient,
  getStudioConnectActivity,
  getStudioConnectStatus,
  isStudioConnectAvailable,
  onStudioConnectActivity,
  regenerateStudioToken,
  type StudioConnectActivity,
  type StudioConnectClientId,
  type StudioConnectStatus,
} from '../services/studioConnectService';

const CLIENT_BLURBS: Record<StudioConnectClientId, string> = {
  'claude-code': 'In the terminal or the Claude desktop app’s Code tab.',
  codex: 'OpenAI’s coding agent, signed in with your own login.',
  'claude-desktop': 'The Claude chat app on this Mac (restart it after connecting).',
};

const copy = (text: string) => { void navigator.clipboard?.writeText(text); };

const timeAgo = (iso: string) => {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
};

/** Settings → Claude & Codex: let external agents read and write this project. */
const StudioConnectPanel: React.FC = () => {
  const [status, setStatus] = useState<StudioConnectStatus | null>(null);
  const [busy, setBusy] = useState<StudioConnectClientId | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [activity, setActivity] = useState<StudioConnectActivity[]>([]);
  const [showToken, setShowToken] = useState(false);

  const refresh = useCallback(() => { void getStudioConnectStatus().then(setStatus); }, []);

  useEffect(() => {
    if (!isStudioConnectAvailable()) return undefined;
    refresh();
    void getStudioConnectActivity().then(setActivity);
    return onStudioConnectActivity((entry) => setActivity((prev) => [entry, ...prev].slice(0, 20)));
  }, [refresh]);

  if (!isStudioConnectAvailable()) {
    return <div className="pk-alert pk-alert--info">Connecting Claude and Codex works in the desktop app only.</div>;
  }

  const toggle = async (client: StudioConnectClientId, connected: boolean) => {
    setBusy(client);
    setNotice(null);
    try {
      const result = connected ? await disconnectStudioClient(client) : await connectStudioClient(client);
      const hint = 'hint' in result && typeof result.hint === 'string' ? result.hint : '';
      setNotice({ tone: 'ok', text: connected ? 'Disconnected.' : hint || 'Connected.' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const server = status?.server;
  const curl = server?.apiUrl
    ? `curl -s -X POST ${server.apiUrl}/tools/project_get_overview -H "Authorization: Bearer $STUDIO_TOKEN"`
    : '';

  return (
    <div className="pk-stack">
      <div className="settings__head">
        <h3>Claude & Codex</h3>
        <p className="pk-hint">Work on this project from Claude Code, Codex or Claude Desktop. They read and write the script, cast, locations and storyboard and can start generations — every change shows up here while you watch.</p>
      </div>

      <p className="pk-hint">
        {server?.running
          ? <>Editor tools are available on this Mac{server.toolCount ? ` · ${server.toolCount} tools` : ''}.</>
          : 'The tool server is not running. Restart the app.'}
      </p>

      <div className="settings__providers">
        {(status?.clients || []).map((client) => (
          <div key={client.id} className={`settings-provider ${client.connected ? 'settings-provider--on' : ''}`}>
            <div className="settings-provider__head">
              <div className="settings-provider__name">
                <span className={`settings-provider__dot ${client.connected ? 'settings-provider__dot--on' : ''}`} aria-hidden="true" />
                <strong>{client.label}</strong>
                {client.connected && <span className="pk-chip pk-chip--ok">connected</span>}
                {!client.installed && !client.connected && <span className="pk-chip pk-chip--warn">not installed</span>}
              </div>
              <span className="pk-actions">
                <button
                  type="button"
                  className={client.connected ? 'edit-text-btn' : 'edit-text-btn edit-text-btn--outline'}
                  disabled={busy !== null || (!client.installed && !client.connected)}
                  onClick={() => { void toggle(client.id, client.connected); }}
                >
                  {busy === client.id ? 'Working…' : client.connected ? 'Disconnect' : 'Connect'}
                </button>
              </span>
            </div>
            <p className="pk-hint">{CLIENT_BLURBS[client.id]}</p>
          </div>
        ))}
      </div>

      {notice && <div className={`pk-alert ${notice.tone === 'error' ? 'pk-alert--danger' : 'pk-alert--ok'}`}>{notice.text}</div>}

      <p className="pk-hint">Then just ask, e.g. “Break the script into 12 storyboard shots and generate the frames” — the agent works in the open project.</p>

      {activity.length > 0 && (
        <div className="pk-stack">
          <strong className="pk-hint">Recent agent actions</strong>
          {activity.slice(0, 6).map((entry, index) => (
            <p key={`${entry.at}-${index}`} className="pk-hint">
              <code className="pk-mono">{entry.tool}</code> · {entry.ok ? 'done' : `failed: ${entry.error || ''}`} · {timeAgo(entry.at)}
            </p>
          ))}
        </div>
      )}

      <details>
        <summary className="pk-hint" style={{ cursor: 'pointer' }}>Other tools and scripts (MCP / REST)</summary>
        {server?.running && (
          <div className="pk-stack" style={{ marginTop: 8 }}>
            <p className="pk-hint">MCP (Streamable HTTP): <code className="pk-mono">{server.mcpUrl}</code></p>
            <p className="pk-hint">REST: <code className="pk-mono">GET {server.apiUrl}/tools</code> · <code className="pk-mono">POST {server.apiUrl}/tools/&lt;name&gt;</code></p>
            <p className="pk-hint">
              Token: <code className="pk-mono">{showToken ? server.token : '•'.repeat(16)}</code>{' '}
              <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={() => setShowToken((value) => !value)}>{showToken ? 'Hide' : 'Show'}</button>{' '}
              <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={() => copy(server.token)}>Copy</button>{' '}
              <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={() => { void regenerateStudioToken().then(refresh); }}>New token</button>
            </p>
            <p className="pk-hint">Send it as <code className="pk-mono">Authorization: Bearer &lt;token&gt;</code>. Connected apps above read it automatically and keep working after a new token.</p>
            <p className="pk-hint">Example: <code className="pk-mono">{curl}</code> <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={() => copy(curl)}>Copy</button></p>
          </div>
        )}
      </details>
    </div>
  );
};

export default StudioConnectPanel;
