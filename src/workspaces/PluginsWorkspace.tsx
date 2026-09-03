import React, { useEffect, useMemo, useState } from 'react';
import {
  FEATURED_PLUGINS,
  inspectGitHubPlugin,
  installPlugin,
  loadInstalledPlugins,
  removePlugin,
  setPluginEnabled,
  subscribePlugins,
  updatePlugin,
  type PluginAsset,
  type PluginPreview,
  type PluginRecord,
} from '../services/pluginService';
import { BoxIcon, DownloadIcon, SearchIcon, TrashIcon, XIcon } from '../components/icons';

const ASSET_KIND_LABELS: Record<PluginAsset['kind'], string> = {
  lut: 'LUT',
  dctl: 'DCTL',
  ofx: 'OpenFX',
  installer: 'Installer',
  preset: 'Preset',
  script: 'Script',
  doc: 'Docs',
  other: 'File',
};

const HOST_LABELS: Record<NonNullable<PluginAsset['host']>, string> = {
  resolve: 'DaVinci Resolve',
  premiere: 'Premiere Pro',
  nuke: 'Nuke',
  studio: 'This studio',
  any: 'Any host',
};

const formatBytes = (value?: number) => {
  if (!value) return '';
  if (value < 1_000_000) return `${Math.max(1, Math.round(value / 1_000))} KB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
};

const detectPlatform = (): PluginAsset['platform'] => {
  if (typeof navigator === 'undefined') return 'any';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'any';
};

const groupAssets = (assets: PluginAsset[]) => {
  const groups = new Map<PluginAsset['kind'], PluginAsset[]>();
  assets.forEach((asset) => {
    const list = groups.get(asset.kind) || [];
    list.push(asset);
    groups.set(asset.kind, list);
  });
  const order: PluginAsset['kind'][] = ['installer', 'lut', 'dctl', 'ofx', 'preset', 'doc', 'script', 'other'];
  return order.filter((kind) => groups.has(kind)).map((kind) => ({ kind, assets: groups.get(kind)! }));
};

const AssetList: React.FC<{ assets: PluginAsset[]; compact?: boolean }> = ({ assets, compact }) => {
  const platform = detectPlatform();
  const groups = groupAssets(assets);
  if (groups.length === 0) return <p className="plugin-empty">No downloadable files detected in this repository.</p>;
  return (
    <div className="plugin-assets">
      {groups.map((group) => (
        <div key={group.kind} className="plugin-assets__group">
          <div className="plugin-assets__title">
            {ASSET_KIND_LABELS[group.kind]}
            <span>{group.assets.length}</span>
          </div>
          <ul className="plugin-assets__list" role="list">
            {group.assets.slice(0, compact ? 6 : 40).map((asset) => {
              const recommended = group.kind === 'installer' && (asset.platform === platform);
              return (
                <li key={asset.id} className={`plugin-asset ${recommended ? 'plugin-asset--recommended' : ''}`}>
                  <div className="plugin-asset__text">
                    <span className="plugin-asset__name" title={asset.path || asset.name}>{asset.name}</span>
                    <span className="plugin-asset__meta">
                      {asset.host && asset.host !== 'any' ? HOST_LABELS[asset.host] : ''}
                      {asset.platform && asset.platform !== 'any' ? ` · ${asset.platform}` : ''}
                      {asset.size ? ` · ${formatBytes(asset.size)}` : ''}
                      {recommended ? ' · for this Mac/PC' : ''}
                    </span>
                  </div>
                  <a className="toolbar-button toolbar-button--text" href={asset.url} target="_blank" rel="noreferrer" download={group.kind === 'installer' ? true : undefined}>
                    <DownloadIcon className="w-3.5 h-3.5" />
                    {group.kind === 'installer' ? 'Download' : 'Open'}
                  </a>
                </li>
              );
            })}
            {group.assets.length > (compact ? 6 : 40) && (
              <li className="plugin-asset__more">+{group.assets.length - (compact ? 6 : 40)} more</li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
};

const PluginsWorkspace: React.FC<{ onOpenGrading?: () => void }> = ({ onOpenGrading }) => {
  const [installed, setInstalled] = useState<PluginRecord[]>(() => loadInstalledPlugins());
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<PluginPreview | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => subscribePlugins(() => setInstalled(loadInstalledPlugins())), []);

  const selected = useMemo(() => installed.find((plugin) => plugin.id === selectedId) || null, [installed, selectedId]);
  const installedIds = useMemo(() => new Set(installed.map((plugin) => plugin.id)), [installed]);
  const lutCount = installed.filter((plugin) => plugin.enabled).reduce((sum, plugin) => sum + plugin.luts.length, 0);

  const handleInspect = async (source: string) => {
    if (!source.trim()) return;
    setBusy(true);
    setPreview(null);
    setStatus(null);
    try {
      const result = await inspectGitHubPlugin(source, setStatus);
      setPreview(result);
      setStatus(`Found ${result.assets.length} file${result.assets.length === 1 ? '' : 's'}${result.lutCandidates.length ? `, including ${result.lutCandidates.length} LUT${result.lutCandidates.length === 1 ? '' : 's'} that can be used directly in Color` : ''}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not read that repository.');
    } finally {
      setBusy(false);
    }
  };

  const handleInstall = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const record = await installPlugin(preview, setStatus);
      setSelectedId(record.id);
      setPreview(null);
      setInput('');
      setStatus(`${record.name} installed${record.luts.length ? ` with ${record.luts.length} LUT${record.luts.length === 1 ? '' : 's'}` : ''}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Install failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async (plugin: PluginRecord) => {
    setBusy(true);
    try {
      await updatePlugin(plugin, setStatus);
      setStatus(`${plugin.name} is up to date.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="plugins-workspace">
      <aside className="plugins-sidebar">
        <div className="plugins-sidebar__head">
          <span className="plugins-sidebar__title">Installed</span>
          <span className="plugins-sidebar__count">{installed.length}</span>
        </div>
        {installed.length === 0 && (
          <p className="plugin-empty">Nothing installed yet. Add a plugin from GitHub on the right.</p>
        )}
        <ul className="plugins-list" role="list">
          {installed.map((plugin) => (
            <li key={plugin.id}>
              <button
                type="button"
                className={`plugins-list__item ${selectedId === plugin.id ? 'plugins-list__item--active' : ''} ${plugin.enabled ? '' : 'plugins-list__item--disabled'}`}
                onClick={() => setSelectedId(plugin.id)}
              >
                <span className="plugins-list__icon"><BoxIcon className="w-4 h-4" /></span>
                <span className="plugins-list__text">
                  <span className="plugins-list__name">{plugin.name}</span>
                  <span className="plugins-list__meta">{plugin.version || 'latest'}{plugin.luts.length ? ` · ${plugin.luts.length} LUTs` : ''}{plugin.enabled ? '' : ' · off'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {lutCount > 0 && (
          <div className="plugins-sidebar__foot">
            <p>{lutCount} plugin LUT{lutCount === 1 ? '' : 's'} available in Color.</p>
            {onOpenGrading && <button type="button" className="toolbar-button toolbar-button--text" onClick={onOpenGrading}>Open Color</button>}
          </div>
        )}
      </aside>

      <div className="plugins-main">
        {selected ? (
          <section className="plugin-detail">
            <div className="plugin-detail__head">
              <div className="min-w-0">
                <h2 className="plugin-detail__title">{selected.name}</h2>
                <p className="plugin-detail__meta">
                  {selected.author ? `${selected.author} · ` : ''}{selected.version || 'latest'}{selected.license ? ` · ${selected.license}` : ''}{typeof selected.stars === 'number' ? ` · ★ ${selected.stars}` : ''}
                </p>
              </div>
              <div className="plugin-detail__actions">
                <label className="plugin-toggle">
                  <input type="checkbox" checked={selected.enabled} onChange={(event) => setPluginEnabled(selected.id, event.target.checked)} />
                  <span>{selected.enabled ? 'Enabled' : 'Disabled'}</span>
                </label>
                <button type="button" className="app-button app-secondary text-xs" onClick={() => handleUpdate(selected)} disabled={busy}>Check for updates</button>
                <a className="app-button app-tertiary text-xs" href={selected.homepage} target="_blank" rel="noreferrer">GitHub</a>
                <button type="button" className="toolbar-button toolbar-button--icon" onClick={() => { removePlugin(selected.id); setSelectedId(null); }} title="Uninstall">
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
            <p className="plugin-detail__description">{selected.description}</p>
            {selected.tags.length > 0 && (
              <div className="plugin-tags">{selected.tags.map((tag) => <span key={tag} className="status-chip">{tag}</span>)}</div>
            )}
            {selected.luts.length > 0 && (
              <div className="plugin-luts">
                <div className="plugin-assets__title">Ready in Color <span>{selected.luts.length}</span></div>
                <div className="plugin-luts__grid">
                  {selected.luts.map((lut) => <span key={lut.id} className="plugin-lut">{lut.name}</span>)}
                </div>
              </div>
            )}
            <AssetList assets={selected.assets} />
            {selected.readme && (
              <details className="plugin-readme">
                <summary>README</summary>
                <pre>{selected.readme}</pre>
              </details>
            )}
          </section>
        ) : (
          <section className="plugin-install">
            <div className="plugin-install__hero">
              <h2>Plugins</h2>
              <p>Install effect packs, LUTs, DCTLs and presets straight from GitHub. Files the studio understands (.cube LUTs) become available in Color right away; host plugins for DaVinci Resolve, Premiere or Nuke get one-click installer downloads.</p>
            </div>
            <form
              className="plugin-install__form"
              onSubmit={(event) => { event.preventDefault(); void handleInspect(input); }}
            >
              <SearchIcon className="w-4 h-4 app-muted" />
              <input
                className="app-input"
                placeholder="https://github.com/owner/repo  or  owner/repo"
                value={input}
                onChange={(event) => setInput(event.target.value)}
              />
              <button type="submit" className="app-button app-primary text-xs" disabled={busy || !input.trim()}>
                {busy ? 'Reading…' : 'Inspect'}
              </button>
            </form>
            {status && <p className="plugin-status">{status}</p>}

            {preview && (
              <div className="plugin-preview">
                <div className="plugin-detail__head">
                  <div className="min-w-0">
                    <h3 className="plugin-detail__title">{preview.name}</h3>
                    <p className="plugin-detail__meta">
                      {preview.author ? `${preview.author} · ` : ''}{preview.version || 'latest'}{preview.license ? ` · ${preview.license}` : ''}{typeof preview.stars === 'number' ? ` · ★ ${preview.stars}` : ''}
                      {preview.source === 'manifest' ? ' · manifest found' : ' · derived from repository'}
                    </p>
                  </div>
                  <div className="plugin-detail__actions">
                    <button type="button" className="app-button app-primary text-xs" onClick={handleInstall} disabled={busy}>
                      {installedIds.has(preview.id) ? 'Reinstall' : 'Install'}
                    </button>
                    <button type="button" className="toolbar-button toolbar-button--icon" onClick={() => setPreview(null)} aria-label="Dismiss"><XIcon className="w-4 h-4" /></button>
                  </div>
                </div>
                <p className="plugin-detail__description">{preview.description}</p>
                {preview.tags.length > 0 && <div className="plugin-tags">{preview.tags.map((tag) => <span key={tag} className="status-chip">{tag}</span>)}</div>}
                <AssetList assets={preview.assets} compact />
              </div>
            )}

            <div className="plugin-featured">
              <div className="plugin-assets__title">Featured</div>
              <div className="plugin-featured__grid">
                {FEATURED_PLUGINS.map((entry) => (
                  <article key={entry.id} className="plugin-card">
                    <div className="plugin-card__icon"><BoxIcon className="w-5 h-5" /></div>
                    <div className="plugin-card__body">
                      <h3>{entry.name}</h3>
                      <p>{entry.description}</p>
                      <div className="plugin-tags">{entry.tags.map((tag) => <span key={tag} className="status-chip">{tag}</span>)}</div>
                    </div>
                    <div className="plugin-card__actions">
                      {installedIds.has(entry.id) ? (
                        <button type="button" className="app-button app-secondary text-xs" onClick={() => setSelectedId(entry.id)}>Installed</button>
                      ) : (
                        <button type="button" className="app-button app-primary text-xs" onClick={() => { setInput(entry.repoUrl); void handleInspect(entry.repoUrl); }} disabled={busy}>Get</button>
                      )}
                      <a className="toolbar-button toolbar-button--text" href={entry.repoUrl} target="_blank" rel="noreferrer">GitHub</a>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="plugin-help">
              <h4>Make your own plugin</h4>
              <p>Add a <code>studio-plugin.json</code> to a public repository with <code>name</code>, <code>description</code>, <code>version</code>, and an <code>assets</code> list (<code>url</code>, <code>kind</code>: lut / dctl / ofx / installer / preset, optional <code>platform</code> and <code>host</code>). Without a manifest the studio still scans releases and files.</p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default PluginsWorkspace;
