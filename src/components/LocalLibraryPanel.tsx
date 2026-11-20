import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MediaItem } from '../types';
import {
  getLocalLibraryRoot,
  loadLocalLibrary,
  localAssetFileUrl,
  localAssetThumbUrl,
  localAssetToMediaItem,
  pingLocalLibraryVision,
  searchLocalLibraryVision,
  setLocalLibraryRoot,
  similarLocalLibraryAssets,
  type LocalLibrary,
} from '../services/localAssetLibrary';
import { LOCAL_ASSET_GROUPS, VISUAL_KINDS, localAssetMediaType, searchLocalAssets, type LocalAsset, type LocalAssetGroup, type LocalAssetHit } from '../utils/localAssetSearch';

/**
 * Local library (Ludwigs Library format): word search with German synonyms plus the
 * library's AI image search when its service runs — "rain on a window at night",
 * "whip pan", "black and white". Add drops the file into the project's media.
 */

const formatDuration = (seconds?: number) => {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

export const LocalLibraryPanel: React.FC<{ density: string; onAdd?: (item: MediaItem) => void }> = ({ density, onAdd }) => {
  const [root, setRoot] = useState<string | null>(() => getLocalLibraryRoot());
  const [library, setLibrary] = useState<LocalLibrary | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<LocalAssetGroup>('all');
  const [aiOnline, setAiOnline] = useState(false);
  const [aiHits, setAiHits] = useState<Array<{ id: string; score: number }> | null>(null);
  const [similarTo, setSimilarTo] = useState<LocalAsset | null>(null);
  const [preview, setPreview] = useState<LocalAsset | null>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    setIsLoading(true);
    setStatus(null);
    loadLocalLibrary(root)
      .then((loaded) => { if (!cancelled) setLibrary(loaded); })
      .catch((error) => { if (!cancelled) { setLibrary(null); setStatus(error instanceof Error ? error.message : String(error)); } })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    void pingLocalLibraryVision().then((ok) => { if (!cancelled) setAiOnline(ok); });
    return () => { cancelled = true; };
  }, [root]);

  // AI hits for the current words (debounced); visual groups only.
  useEffect(() => {
    if (!library || !aiOnline || similarTo) return;
    const q = query.trim();
    const groupKinds = LOCAL_ASSET_GROUPS.find((g) => g.id === group)?.kinds || [];
    const visual = group === 'all' || groupKinds.some((kind) => VISUAL_KINDS.has(kind));
    if (!q || !visual) { setAiHits(null); return; }
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      void searchLocalLibraryVision(library, q).then((hits) => { if (seq === searchSeq.current) setAiHits(hits); });
    }, 350);
    return () => clearTimeout(timer);
  }, [library, aiOnline, query, group, similarTo]);

  const results: LocalAssetHit[] = useMemo(() => {
    if (!library) return [];
    if (similarTo && aiHits) {
      const byId = new Map(library.assets.map((asset) => [asset.id, asset]));
      return aiHits.map((hit) => ({ asset: byId.get(hit.id)!, score: hit.score, ai: hit.score })).filter((hit) => hit.asset && hit.asset.id !== similarTo.id);
    }
    return searchLocalAssets(library.assets, query, { group, ai: aiHits || undefined, limit: 240 });
  }, [library, query, group, aiHits, similarTo]);

  const chooseFolder = async () => {
    const folder = await window.electron?.project?.selectFolder?.();
    if (!folder) return;
    setLocalLibraryRoot(folder);
    setRoot(folder);
  };

  const showSimilar = async (asset: LocalAsset) => {
    if (!library) return;
    setSimilarTo(asset);
    setStatus('Looking for similar shots…');
    const hits = await similarLocalLibraryAssets(library, asset.id);
    setAiHits(hits);
    setStatus(hits ? null : 'Similar needs the library\'s AI service (assetlib vision serve).');
  };

  const add = (asset: LocalAsset) => {
    if (!library || !onAdd) return;
    const item = localAssetToMediaItem(library, asset);
    if (!item) { setStatus(`${asset.title}: ${asset.kind} files can't be placed in the timeline — open it from the library folder.`); return; }
    onAdd(item);
    setStatus(`Added “${asset.title}” to the project.`);
  };

  if (!root || (!library && !isLoading)) {
    return (
      <div className="lib-stock">
        <p className="lib-note">
          Connect a local asset library (Ludwigs Library format: a folder with <code>_Index/assets.jsonl</code>). Search runs on words with German synonyms,
          plus AI image search when the library&apos;s service is running.
        </p>
        <div className="flex gap-2">
          <button type="button" className="app-button app-primary text-xs" onClick={() => void chooseFolder()}>Choose library folder</button>
          {root && <button type="button" className="app-button app-secondary text-xs" onClick={() => { setLocalLibraryRoot(null); setRoot(null); }}>Disconnect</button>}
        </div>
        {status && <p className="lib-note lib-note--warn">{status}</p>}
      </div>
    );
  }

  return (
    <div className="lib-stock">
      <form className="lib-stock__form" onSubmit={(event) => event.preventDefault()}>
        <input
          value={query}
          onChange={(event) => { setQuery(event.target.value); setSimilarTo(null); }}
          placeholder={aiOnline ? 'Describe it: “rain on a window at night”, “Tür knallt”, “whip pan”' : 'Search titles and tags (Deutsch or English)'}
          className="app-input app-input--compact flex-1"
          autoFocus
        />
        <select value={group} onChange={(event) => { setGroup(event.target.value as LocalAssetGroup); setSimilarTo(null); }} className="app-select app-select--compact">
          {LOCAL_ASSET_GROUPS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${aiOnline ? 'bg-emerald-500/15 text-emerald-600' : 'bg-gray-500/15 text-gray-500'}`} title={aiOnline ? 'The library\'s AI search is on' : 'AI search is off: start the library\'s vision service'}>
          {aiOnline ? 'KI-Suche' : 'Words only'}
        </span>
        <button type="button" className="app-button app-secondary text-xs" onClick={() => void chooseFolder()} title={root}>Folder…</button>
      </form>
      {similarTo && (
        <p className="lib-note">
          Similar to “{similarTo.title}” · <button type="button" className="underline" onClick={() => { setSimilarTo(null); setAiHits(null); }}>back to search</button>
        </p>
      )}
      {isLoading && <p className="lib-note">Loading library…</p>}
      {status && <p className="lib-note">{status}</p>}
      {library && !isLoading && <p className="lib-note">{results.length} of {library.assets.length} assets{aiHits && !similarTo ? ' · AI-ranked' : ''}</p>}
      <div className={`lib-grid lib-grid--${density}`}>
        {results.map(({ asset, ai }) => {
          const type = localAssetMediaType(asset);
          const visual = VISUAL_KINDS.has(asset.kind);
          return (
            <div key={asset.id} className="lib-card">
              <button type="button" className="lib-card__frame" onClick={() => setPreview(asset)} title={asset.path}>
                {visual && library ? (
                  <img src={localAssetThumbUrl(library, asset)} alt="" className="lib-card__media" loading="lazy" onError={(event) => { (event.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                ) : (
                  <span className="lib-card__media flex items-center justify-center text-[11px] text-gray-400 px-2 text-center">{asset.category || asset.kind}</span>
                )}
                <span className="lib-card__badge">{asset.kind}{ai ? ' · KI' : ''}</span>
              </button>
              <div className="lib-card__meta">
                <span className="lib-card__name" title={asset.title}>{asset.title}</span>
                <span className="lib-card__sub">{[formatDuration(asset.duration), asset.source].filter(Boolean).join(' · ')}</span>
              </div>
              <div className="lib-card__actions">
                <button type="button" className="lib-card__action lib-card__action--primary" onClick={() => add(asset)} disabled={!onAdd || !type}>Add</button>
                {visual && aiOnline && <button type="button" className="lib-card__action" onClick={() => void showSimilar(asset)}>Similar</button>}
              </div>
            </div>
          );
        })}
      </div>
      {preview && library && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8" onClick={() => setPreview(null)}>
          <div className="max-w-4xl w-full space-y-3" onClick={(event) => event.stopPropagation()}>
            {localAssetMediaType(preview) === 'video' && <video src={localAssetFileUrl(library, preview)} controls autoPlay className="w-full rounded-lg" />}
            {localAssetMediaType(preview) === 'image' && <img src={localAssetFileUrl(library, preview)} alt={preview.title} className="w-full rounded-lg" />}
            {localAssetMediaType(preview) === 'audio' && <audio src={localAssetFileUrl(library, preview)} controls autoPlay className="w-full" />}
            <div className="flex items-center justify-between text-sm text-gray-200">
              <span>{preview.title} <span className="text-gray-500">· {preview.license || 'license unknown'}</span></span>
              <button type="button" className="app-button app-primary text-xs" onClick={() => { add(preview); setPreview(null); }} disabled={!onAdd || !localAssetMediaType(preview)}>Add to project</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
