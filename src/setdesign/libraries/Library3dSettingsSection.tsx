/**
 * Settings › 3D libraries: one key field per provider that has `keyStorage`, a "Get a key" link
 * and the licence summary. New providers appear here automatically (registry.ts).
 * variant "settings" uses the settings modal styles, "compact" the set design panel styles.
 */
import React, { useEffect, useReducer, useState } from 'react';
import { getLibraryKey, isProviderConfigured, listLibraryProviders, setLibraryKey, subscribeLibraryProviders } from './registry.ts';
import type { LibraryProvider } from './types.ts';

/** Ask the app to open Settings on this section (App listens for it, see the integration note). */
export const OPEN_LIBRARY_SETTINGS_EVENT = 'avpe:open-settings';
export const openLibrarySettings = () => {
  try { window.dispatchEvent(new CustomEvent(OPEN_LIBRARY_SETTINGS_EVENT, { detail: { section: 'libraries3d' } })); } catch { /* not in a browser */ }
};

const TYPE_LABEL: Record<string, string> = { model: 'Modelle', hdri: 'HDRIs', texture: 'Texturen' };

const KeyRow: React.FC<{ provider: LibraryProvider; compact: boolean }> = ({ provider, compact }) => {
  const [value, setValue] = useState(() => getLibraryKey(provider));
  const [saved, setSaved] = useState(true);
  const configured = isProviderConfigured(provider);
  const save = () => { setLibraryKey(provider, value); setSaved(true); };
  const types = provider.types.map((t) => TYPE_LABEL[t] || t).join(', ');

  if (compact) {
    return (
      <div className="sdx-lib-keyrow" data-automation-id={`library-key-${provider.id}`}>
        <div className="sdx-lib-keyrow__head">
          <strong>{provider.label}</strong>
          <span className={`sdx-lib-dot${configured ? ' is-on' : ''}`} />
          {provider.keyUrl && <a href={provider.keyUrl} target="_blank" rel="noreferrer">Key holen ↗</a>}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <input className="sdx-input" style={{ flex: 1 }} type="password" autoComplete="off" spellCheck={false} placeholder={provider.keyPlaceholder || provider.keyLabel || 'API key'} value={value}
            onChange={(event) => { setValue(event.target.value); setSaved(false); }}
            onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') save(); }} />
          <button type="button" className="sdx-btn" disabled={saved} onClick={save}>Speichern</button>
        </div>
        <div className="sdx-note">{provider.keyOnlyForDownload ? 'Suche geht ohne Key, Download braucht ihn. ' : ''}{provider.licenseSummary}</div>
      </div>
    );
  }

  return (
    <div className={`settings-provider ${configured ? 'settings-provider--on' : ''}`} data-automation-id={`library-key-${provider.id}`}>
      <div className="settings-provider__head">
        <div className="settings-provider__name">
          <span className={`settings-provider__dot ${configured ? 'settings-provider__dot--on' : ''}`} aria-hidden="true" />
          <strong>{provider.label}</strong>
          <span className="pk-chip">{types}</span>
          {configured && saved && <span className="pk-chip pk-chip--ok">saved</span>}
          {!saved && <span className="pk-chip pk-chip--accent">unsaved</span>}
        </div>
        {provider.keyUrl && <a className="settings-provider__link" href={provider.keyUrl} target="_blank" rel="noreferrer">Get a key ↗</a>}
      </div>
      <label className="settings-provider__field">
        <input type="password" value={value} placeholder={provider.keyPlaceholder || provider.keyLabel || 'API key'} aria-label={`${provider.label} ${provider.keyLabel || 'API key'}`} autoComplete="off" spellCheck={false}
          onChange={(event) => { setValue(event.target.value); setSaved(false); }}
          onBlur={() => { if (!saved) save(); }}
          onKeyDown={(event) => { if (event.key === 'Enter') save(); }} />
      </label>
      <p className="pk-hint">{provider.description} {provider.keyOnlyForDownload ? 'Search works without a key; downloads need it.' : ''}</p>
      <p className="pk-hint">Licence: {provider.licenseSummary}</p>
    </div>
  );
};

const Library3dSettingsSection: React.FC<{ variant?: 'settings' | 'compact'; only?: string[] }> = ({ variant = 'settings', only }) => {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeLibraryProviders(force), []);
  const providers = listLibraryProviders().filter((p) => !only || only.includes(p.id));
  const withKey = providers.filter((p) => p.keyStorage);
  const free = providers.filter((p) => !p.keyStorage);
  const compact = variant === 'compact';

  if (compact) {
    return (
      <div className="sdx-lib-keys">
        {withKey.map((p) => <KeyRow key={p.id} provider={p} compact />)}
        {!!free.length && <div className="sdx-note">Ohne Key: {free.map((p) => p.label).join(', ')}.</div>}
      </div>
    );
  }

  return (
    <div className="pk-stack" data-automation-id="settings-libraries3d">
      <div className="settings__head">
        <h3>3D libraries</h3>
        <p className="pk-hint">Models, HDRIs and PBR textures for Set Design (Assets tab › 3D libraries) and for agents (MCP tools library_*). All libraries are free; keys stay on this machine. Licences are shown with every result and stored with every imported object.</p>
      </div>
      <div className="settings__providers">
        {withKey.map((p) => <KeyRow key={p.id} provider={p} compact={false} />)}
        {free.map((p) => (
          <div key={p.id} className="settings-provider settings-provider--on">
            <div className="settings-provider__head">
              <div className="settings-provider__name">
                <span className="settings-provider__dot settings-provider__dot--on" aria-hidden="true" />
                <strong>{p.label}</strong>
                <span className="pk-chip">{p.types.map((t) => TYPE_LABEL[t] || t).join(', ')}</span>
                <span className="pk-chip pk-chip--ok">no key needed</span>
              </div>
              <a className="settings-provider__link" href={p.homepage} target="_blank" rel="noreferrer">{p.homepage.replace(/^https?:\/\//, '')} ↗</a>
            </div>
            <p className="pk-hint">{p.description}</p>
            <p className="pk-hint">Licence: {p.licenseSummary}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Library3dSettingsSection;
