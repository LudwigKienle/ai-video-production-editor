/**
 * Set Design › Assets › 3D-Bibliotheken: search Poly Haven, ambientCG, Sketchfab and Smithsonian
 * 3D, see thumbnails and licences, and bring models, HDRIs and textures into the set. Uses the
 * same import pipeline as the MCP tools library_* (src/setdesign/libraries/importer.ts).
 */
import React, { useEffect, useMemo, useReducer, useState } from 'react';
import { Download, ExternalLink, Image as ImageIcon, KeyRound, Search, Sun, Box, Paintbrush } from 'lucide-react';
import { setDesignBus } from '../../setdesign/bus.ts';
import { getCommand } from '../../setdesign/commands.ts';
import { applyLibraryTexture, importLibraryModel, setLibraryHdri, type ImportDeps } from '../../setdesign/libraries/importer.ts';
import { canSearch, isProviderConfigured, listLibraryProviders, searchLibraries, subscribeLibraryProviders, type ProviderSearchOutcome } from '../../setdesign/libraries/registry.ts';
import type { LibraryAsset, LibraryAssetType } from '../../setdesign/libraries/types.ts';
import Library3dSettingsSection, { openLibrarySettings } from '../../setdesign/libraries/Library3dSettingsSection.tsx';
import './libraryBrowser.css';

type Props = {
  projectPath?: string | null;
  onToast?: (text: string) => void;
};

const TABS: Array<{ id: LibraryAssetType; label: string; icon: React.ReactNode }> = [
  { id: 'model', label: 'Modelle', icon: <Box size={12} /> },
  { id: 'hdri', label: 'HDRI', icon: <Sun size={12} /> },
  { id: 'texture', label: 'Texturen', icon: <Paintbrush size={12} /> },
];

const RESOLUTIONS: Record<LibraryAssetType, string[]> = { model: ['1k', '2k', '4k'], hdri: ['1k', '2k', '4k', '8k'], texture: ['1k', '2k', '4k'] };
const DEFAULT_RES: Record<LibraryAssetType, string> = { model: '1k', hdri: '2k', texture: '2k' };

const licenseTone = (asset: LibraryAsset) => (!asset.license.commercial ? 'nc' : asset.license.attributionRequired ? 'by' : 'cc0');

const LibraryBrowserPanel: React.FC<Props> = ({ projectPath, onToast }) => {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeLibraryProviders(force), []);
  useEffect(() => setDesignBus.subscribe(force), []);
  const [type, setType] = useState<LibraryAssetType>('model');
  const [query, setQuery] = useState('');
  const [disabled, setDisabled] = useState<Set<string>>(() => new Set());
  const [outcomes, setOutcomes] = useState<ProviderSearchOutcome[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [showKeys, setShowKeys] = useState(false);
  const [resolution, setResolution] = useState<Record<LibraryAssetType, string>>(DEFAULT_RES);
  const [hdriBackground, setHdriBackground] = useState(true);

  const providers = listLibraryProviders().filter((p) => p.types.includes(type));
  const notReady = providers.filter((p) => !canSearch(p) || (p.keyOnlyForDownload && !isProviderConfigured(p)));
  const selection = setDesignBus.getUi().selectedIds;
  const hasMaterialSet = !!getCommand('material.set');

  const runSearch = async (nextType = type, nextQuery = query) => {
    setSearching(true);
    setStatus('');
    try {
      const ids = listLibraryProviders().filter((p) => p.types.includes(nextType) && !disabled.has(p.id)).map((p) => p.id);
      setOutcomes(ids.length ? await searchLibraries({ query: nextQuery, type: nextType, limit: 12, providers: ids }) : []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  };

  // After the first search, switching the tab searches the new type with the same words.
  useEffect(() => { if (outcomes) void runSearch(type, query); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [type]);

  const results = useMemo(() => (outcomes || []).flatMap((o) => o.assets), [outcomes]);

  const deps = (): ImportDeps => ({
    run: (id, args) => setDesignBus.run(id, args),
    hasCommand: (id) => !!getCommand(id),
    projectPath: projectPath || null,
    onProgress: setStatus,
  });

  const act = async (asset: LibraryAsset) => {
    const key = `${asset.provider}:${asset.id}`;
    setBusy(key);
    try {
      const res = resolution[asset.type];
      const result = asset.type === 'model'
        ? await importLibraryModel({ provider: asset.provider, id: asset.id, resolution: res }, deps())
        : asset.type === 'hdri'
          ? await setLibraryHdri({ provider: asset.provider, id: asset.id, resolution: res, background: hdriBackground }, deps())
          : await applyLibraryTexture({ provider: asset.provider, id: asset.id, objects: selection, resolution: res }, deps());
      const warnings = (result as { warnings?: string[] }).warnings || [];
      const where = result.storage === 'project' ? 'im Projektordner' : result.storage === 'cache' ? 'im App-Cache' : 'online verknüpft';
      const text = `${asset.name} (${asset.license.label}) ${asset.type === 'model' ? 'importiert' : asset.type === 'hdri' ? 'als HDRI gesetzt' : `auf ${selection.length} Objekt(e) gelegt`}, ${where}.${warnings.length ? ` ${warnings.join(' ')}` : ''}`;
      setStatus(text);
      onToast?.(text);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setStatus(text);
      onToast?.(text);
    } finally {
      setBusy(null);
    }
  };

  const actionLabel = type === 'model' ? 'Importieren' : type === 'hdri' ? 'Als HDRI' : 'Auf Auswahl';

  return (
    <div className="sdx-left__section sdx-lib" data-automation-id="setdesign-library">
      <div className="sdx-left__title" style={{ justifyContent: 'space-between' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ImageIcon size={14} /> 3D-Bibliotheken</span>
        <button type="button" className={`sdx-btn sdx-btn--icon${showKeys ? ' sdx-btn--on' : ''}`} title="API-Keys der Bibliotheken" onClick={() => setShowKeys((v) => !v)} data-automation-id="setdesign-library-keys"><KeyRound size={13} /></button>
      </div>

      <div className="sdx-seg sdx-lib__tabs" data-automation-id="setdesign-library-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={type === t.id ? 'is-on' : ''} onClick={() => setType(t.id)} data-automation-id={`setdesign-library-tab-${t.id}`}>{t.icon}<span>{t.label}</span></button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4 }}>
        <input className="sdx-input" style={{ flex: 1 }} placeholder={type === 'model' ? 'z. B. wooden chair' : type === 'hdri' ? 'z. B. studio, sunset' : 'z. B. concrete floor'} value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') void runSearch(); }}
          data-automation-id="setdesign-library-query" />
        <button type="button" className="sdx-btn sdx-btn--primary" disabled={searching} onClick={() => void runSearch()} title="Suchen (englische Begriffe finden am meisten)" data-automation-id="setdesign-library-search"><Search size={13} /></button>
      </div>

      <div className="sdx-chips">
        {providers.map((p) => (
          <button key={p.id} type="button" className={`sdx-chip${disabled.has(p.id) ? '' : ' is-on'}`} title={`${p.description}\nLizenz: ${p.licenseSummary}`}
            onClick={() => setDisabled((prev) => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; })}>
            {p.label}{!canSearch(p) ? ' 🔑' : ''}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span className="sdx-note">Auflösung</span>
        <select className="sdx-select" value={resolution[type]} onChange={(event) => setResolution((prev) => ({ ...prev, [type]: event.target.value }))}>
          {RESOLUTIONS[type].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {type === 'hdri' && <label className="sdx-check"><input type="checkbox" checked={hdriBackground} onChange={(event) => setHdriBackground(event.target.checked)} /> Hintergrund</label>}
      </div>

      {notReady.length > 0 && !showKeys && (
        <div className="sdx-lib__notice">
          {notReady.map((p) => (
            <div key={p.id}>
              <b>{p.label}</b>: {canSearch(p) ? 'Suche ohne Key, Download braucht einen.' : 'Key fehlt.'}{' '}
              <button type="button" className="sdx-lib__link" onClick={() => setShowKeys(true)}>Key eintragen</button>{' · '}
              <button type="button" className="sdx-lib__link" onClick={openLibrarySettings}>Einstellungen</button>
            </div>
          ))}
        </div>
      )}
      {showKeys && <Library3dSettingsSection variant="compact" />}

      {type === 'texture' && (
        <div className="sdx-note">{!hasMaterialSet ? 'Texturen auflegen braucht den Befehl material.set (kommt mit dem Builder-Kern).' : selection.length ? `${selection.length} Objekt(e) ausgewählt.` : 'Erst Objekte im Viewport oder Outliner auswählen.'}</div>
      )}
      {!projectPath && <div className="sdx-note">Kein Projektordner: Dateien werden im App-Cache oder online verknüpft. ZIP-Downloads (ambientCG) brauchen einen Projektordner.</div>}

      {(outcomes || []).filter((o) => o.error).map((o) => <div key={o.provider} className="sdx-lib__error">{o.label}: {o.error}</div>)}
      {status && <div className="sdx-lib__status" data-automation-id="setdesign-library-status">{status}</div>}
      {searching && <div className="sdx-note">Suche …</div>}
      {outcomes && !searching && results.length === 0 && <div className="sdx-empty">Keine Treffer.</div>}

      <div className="sdx-lib__grid" data-automation-id="setdesign-library-results">
        {results.map((asset) => {
          const key = `${asset.provider}:${asset.id}`;
          const blocked = !asset.downloadable || (asset.type === 'texture' && (!hasMaterialSet || !selection.length));
          const providerLabel = listLibraryProviders().find((p) => p.id === asset.provider)?.label || asset.provider;
          return (
            <div key={key} className="sdx-lib__card" title={`${asset.name}\n${providerLabel} · ${asset.author || ''}\n${asset.license.label}${asset.license.note ? ` – ${asset.license.note}` : ''}${asset.polycount ? `\n${asset.polycount.toLocaleString('de-DE')} Polygone` : ''}${asset.dimensionsM ? `\n${asset.dimensionsM.map((v) => v.toFixed(2)).join(' × ')} m` : ''}`}>
              <div className="sdx-lib__thumb">
                {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Box size={20} />}
                <span className={`sdx-lib__badge sdx-lib__badge--${licenseTone(asset)}`}>{asset.license.label}</span>
              </div>
              <div className="sdx-lib__name">{asset.name}</div>
              <div className="sdx-lib__meta">{providerLabel}{asset.author ? ` · ${asset.author}` : ''}</div>
              <div className="sdx-lib__actions">
                <button type="button" className="sdx-btn sdx-btn--primary" disabled={blocked || busy !== null} onClick={() => void act(asset)} data-automation-id={`setdesign-library-use-${asset.provider}-${asset.id}`}
                  title={!asset.downloadable ? 'Download braucht einen Key (🔑 oben)' : undefined}>
                  <Download size={12} /> {busy === key ? '…' : actionLabel}
                </button>
                <a className="sdx-btn sdx-btn--icon" href={asset.url} target="_blank" rel="noreferrer" title="Seite der Bibliothek"><ExternalLink size={12} /></a>
              </div>
            </div>
          );
        })}
      </div>
      <div className="sdx-note sdx-lib__credit">Inhalte von Poly Haven, ambientCG, Sketchfab und Smithsonian Open Access. Lizenz je Asset; sie wird beim Import am Objekt gespeichert.</div>
    </div>
  );
};

export default LibraryBrowserPanel;
