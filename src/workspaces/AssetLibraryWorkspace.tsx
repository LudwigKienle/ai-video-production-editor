import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MediaItem, RecentProject, ReferenceItem, ShotPrompt } from '../types';
import { loadProjectFromFolder } from '../services/projectService';
import {
  BUILTIN_ASSET_PACKS,
  buildAssetPackManifest,
  getAssetPackTypeCounts,
  loadImportedAssetPacks,
  normalizeAssetPackManifest,
  saveImportedAssetPacks,
  upsertImportedAssetPack,
  type AssetPack,
  type AssetPackItem,
  type AssetPackItemType,
} from '../data/assetPacks';
import {
  buildUnsplashMediaItem,
  hasUnsplashAccessKey,
  searchUnsplashPhotos,
  trackUnsplashDownload,
  type UnsplashOrientation,
  type UnsplashStockAsset,
} from '../services/unsplashService';
import { BoxIcon, ImageIcon, VideoIcon, MusicNoteIcon, TagIcon, SearchIcon, DownloadIcon, EditIcon, UploadIcon, XIcon, GridIcon, ListIcon } from '../components/icons';

/**
 * Library — browse everything the studio has made or collected. Modelled on
 * Apple Photos / Magnific: a quiet sidebar of collections, a dense adaptive
 * grid with hover actions, an inspector for the selected asset, and quick
 * look on double-click or space.
 */

type LibraryAssetKind = 'image' | 'video' | 'audio' | 'reference';

const ASSET_PACK_TYPE_LABELS: Record<AssetPackItemType, string> = {
  hdri: 'HDRI',
  model: 'Model',
  material: 'Material',
  'render-preset': 'Render preset',
  'stock-preset': 'Stock preset',
};

type LibraryAsset = {
  id: string;
  name: string;
  kind: LibraryAssetKind;
  url?: string | null;
  category?: 'shot';
  projectName: string;
  projectPath?: string | null;
  origin: 'current' | 'recent';
  source?: string;
  detail?: string;
  generatedBy?: string;
  createdAt?: string;
};

interface AssetLibraryWorkspaceProps {
  currentProjectName?: string | null;
  currentProjectPath?: string | null;
  mediaItems: MediaItem[];
  references: ReferenceItem[];
  shotPrompts: ShotPrompt[];
  recentProjects: RecentProject[];
  onEditImage?: (asset: LibraryAsset) => void;
  onEditVideo?: (asset: LibraryAsset) => void;
  onAddStockImage?: (item: MediaItem) => void;
}

type Collection = 'all' | 'image' | 'video' | 'audio' | 'reference' | 'shots' | 'generated' | 'stock' | 'packs';
type Density = 'small' | 'medium' | 'large';
type Sort = 'recent' | 'name' | 'project';

const toAssetIdSegment = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'project';

const buildAssetIdPrefix = (origin: LibraryAsset['origin'], projectName: string, projectPath: string | null) =>
  `${origin}-${toAssetIdSegment(projectPath || projectName)}`;

const mapMediaAssets = (items: MediaItem[], projectName: string, projectPath: string | null, origin: LibraryAsset['origin']): LibraryAsset[] => {
  const idPrefix = buildAssetIdPrefix(origin, projectName, projectPath);
  return items.map((item, index) => ({
    id: `${idPrefix}-media-${item.id || index}`,
    name: item.name || `media_${index + 1}`,
    kind: item.type,
    url: item.url,
    projectName,
    projectPath,
    origin,
    source: item.source,
    generatedBy: item.generatedBy,
  }));
};

const mapReferenceAssets = (references: ReferenceItem[], projectName: string, projectPath: string | null, origin: LibraryAsset['origin']): LibraryAsset[] => {
  const idPrefix = buildAssetIdPrefix(origin, projectName, projectPath);
  return references.map((ref, index) => ({
    id: `${idPrefix}-ref-${ref.id || index}`,
    name: ref.name || `reference_${index + 1}`,
    kind: 'reference',
    url: ref.imageUrl,
    projectName,
    projectPath,
    origin,
    detail: ref.type,
    generatedBy: ref.generatedBy,
  }));
};

const mapShotAssets = (shots: ShotPrompt[], projectName: string, projectPath: string | null, origin: LibraryAsset['origin']): LibraryAsset[] => {
  const assets: LibraryAsset[] = [];
  const idPrefix = buildAssetIdPrefix(origin, projectName, projectPath);
  shots.forEach((shot, index) => {
    const shotLabel = shot.shot || index + 1;
    const baseId = `${idPrefix}-shot-${shotLabel}-${index}`;
    const description = shot.description ? ` · ${shot.description.slice(0, 32)}` : '';
    const push = (suffix: string, name: string, kind: LibraryAssetKind, url: string | undefined, detail: string) => {
      if (!url) return;
      assets.push({ id: `${baseId}-${suffix}`, name: `Shot ${shotLabel} ${name}${description}`, kind, url, projectName, projectPath, origin, category: 'shot', detail, generatedBy: shot.generatedBy });
    };
    push('storyboard', 'Storyboard', 'image', shot.imageUrl, 'storyboard');
    push('sketch', 'Sketch', 'image', shot.sketchUrl, 'sketch');
    push('start-frame', 'Start frame', 'image', shot.startFrameUrl, 'start frame');
    push('end-frame', 'End frame', 'image', shot.endFrameUrl, 'end frame');
    push('motion-ref', 'Motion ref', 'video', shot.motionReferenceUrl, 'motion ref');
    push('video', 'Video', 'video', shot.videoUrl, 'storyboard video');
  });
  return assets;
};

const isLikelyImageUrl = (url: string) => {
  if (!url) return false;
  if (url.startsWith('data:image') || url.startsWith('blob:')) return true;
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(url.split('?')[0]) || !/\.[a-z0-9]{2,5}(?:$|[?#])/i.test(url);
};

const isArchiveAsset = (asset: Pick<LibraryAsset, 'url' | 'name' | 'generatedBy'>) =>
  Boolean(asset.url && /\.(zip|exr|glb|gltf|fbx|obj)(?:$|[?#])/i.test(asset.url)) ||
  Boolean(asset.name && /\.(zip|glb|gltf|fbx|obj)$/i.test(asset.name)) ||
  /EXR|ACES HDR/i.test(asset.generatedBy || '');

const formatBytes = (value?: number) => {
  if (!value) return null;
  if (value < 1_000_000) return `${Math.round(value / 1_000)} KB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
};

const formatPackCounts = (pack: AssetPack) =>
  Object.entries(getAssetPackTypeCounts(pack)).map(([type, count]) => `${count} ${ASSET_PACK_TYPE_LABELS[type as AssetPackItemType] || type}`).join(' · ');

const AssetLibraryWorkspace: React.FC<AssetLibraryWorkspaceProps> = ({
  currentProjectName,
  currentProjectPath,
  mediaItems,
  references,
  shotPrompts,
  recentProjects,
  onEditImage,
  onEditVideo,
  onAddStockImage,
}) => {
  const [remoteAssets, setRemoteAssets] = useState<LibraryAsset[]>([]);
  const [search, setSearch] = useState('');
  const [collection, setCollection] = useState<Collection>('all');
  const [density, setDensity] = useState<Density>('medium');
  const [sort, setSort] = useState<Sort>('recent');
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quickLook, setQuickLook] = useState<{ url: string; name: string; kind: LibraryAssetKind } | null>(null);
  const [stockQuery, setStockQuery] = useState('cinematic production design');
  const [stockOrientation, setStockOrientation] = useState<UnsplashOrientation>('landscape');
  const [stockResults, setStockResults] = useState<UnsplashStockAsset[]>([]);
  const [stockStatus, setStockStatus] = useState<string | null>(null);
  const [isStockLoading, setIsStockLoading] = useState(false);
  const [unsplashReady, setUnsplashReady] = useState(() => hasUnsplashAccessKey());
  const [importedPacks, setImportedPacks] = useState<AssetPack[]>(() => loadImportedAssetPacks());
  const [packStatus, setPackStatus] = useState<string | null>(null);
  const [selectedPackId, setSelectedPackId] = useState(BUILTIN_ASSET_PACKS[0]?.id || '');
  const packImportInputRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const currentAssets = useMemo(() => {
    const projectLabel = currentProjectName || 'Current project';
    return [
      ...mapMediaAssets(mediaItems, projectLabel, currentProjectPath || null, 'current'),
      ...mapReferenceAssets(references, projectLabel, currentProjectPath || null, 'current'),
      ...mapShotAssets(shotPrompts, projectLabel, currentProjectPath || null, 'current'),
    ];
  }, [currentProjectName, currentProjectPath, mediaItems, references, shotPrompts]);

  useEffect(() => {
    let isActive = true;
    const loadAssets = async () => {
      if (recentProjects.length === 0) {
        setRemoteAssets([]);
        setLoadError(null);
        return;
      }
      if (typeof window !== 'undefined' && !window.electron?.project) {
        setLoadError('Assets from other projects are available in the desktop app.');
        setRemoteAssets([]);
        return;
      }
      setIsLoading(true);
      setLoadError(null);
      const candidates = recentProjects.filter((project) => project.path && project.path !== currentProjectPath);
      const results = await Promise.allSettled(candidates.map(async (project) => {
        const loaded = await loadProjectFromFolder(project.path);
        const projectName = loaded.name || project.name || 'Untitled project';
        return [
          ...mapMediaAssets(loaded.mediaItems || [], projectName, project.path, 'recent'),
          ...mapReferenceAssets(loaded.references || [], projectName, project.path, 'recent'),
          ...mapShotAssets(loaded.projectHub?.shotPrompts || [], projectName, project.path, 'recent'),
        ];
      }));
      if (!isActive) return;
      const next: LibraryAsset[] = [];
      results.forEach((result) => { if (result.status === 'fulfilled') next.push(...result.value); });
      if (results.some((r) => r.status === 'rejected') && next.length === 0) setLoadError('Could not load assets from recent projects.');
      setRemoteAssets(next);
      setIsLoading(false);
    };
    loadAssets().catch((error) => {
      if (!isActive) return;
      setLoadError(error instanceof Error ? error.message : 'Failed to load assets.');
      setIsLoading(false);
    });
    return () => { isActive = false; };
  }, [recentProjects, currentProjectPath]);

  useEffect(() => {
    const update = () => setUnsplashReady(hasUnsplashAccessKey());
    window.addEventListener('storage', update);
    window.addEventListener('focus', update);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener('focus', update);
    };
  }, []);

  const allAssets = useMemo(() => [...currentAssets, ...remoteAssets], [currentAssets, remoteAssets]);

  const counts = useMemo(() => allAssets.reduce((acc, asset) => {
    acc.all += 1;
    acc[asset.kind] += 1;
    if (asset.category === 'shot') acc.shots += 1;
    if (asset.source === 'generated' || asset.generatedBy) acc.generated += 1;
    return acc;
  }, { all: 0, image: 0, video: 0, audio: 0, reference: 0, shots: 0, generated: 0 }), [allAssets]);

  const filteredAssets = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = allAssets.filter((asset) => {
      if (collection === 'shots') { if (asset.category !== 'shot') return false; }
      else if (collection === 'generated') { if (!(asset.source === 'generated' || asset.generatedBy)) return false; }
      else if (collection !== 'all' && collection !== 'stock' && collection !== 'packs' && asset.kind !== collection) return false;
      if (!term) return true;
      return asset.name.toLowerCase().includes(term) || asset.projectName.toLowerCase().includes(term) || (asset.detail || '').toLowerCase().includes(term) || (asset.generatedBy || '').toLowerCase().includes(term);
    });
    if (sort === 'name') return list.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'project') return list.sort((a, b) => a.projectName.localeCompare(b.projectName) || a.name.localeCompare(b.name));
    return list;
  }, [allAssets, collection, search, sort]);

  const selected = useMemo(() => filteredAssets.find((asset) => asset.id === selectedId) || allAssets.find((asset) => asset.id === selectedId) || null, [allAssets, filteredAssets, selectedId]);

  const assetPacks = useMemo(() => [...BUILTIN_ASSET_PACKS, ...importedPacks], [importedPacks]);
  const selectedPack = useMemo(() => assetPacks.find((pack) => pack.id === selectedPackId) || assetPacks[0], [assetPacks, selectedPackId]);
  const selectedPackIsImported = Boolean(selectedPack && importedPacks.some((pack) => pack.id === selectedPack.id));

  useEffect(() => {
    if (assetPacks.length > 0 && !assetPacks.some((pack) => pack.id === selectedPackId)) setSelectedPackId(assetPacks[0].id);
  }, [assetPacks, selectedPackId]);

  // Keyboard: arrows move selection, space quick-looks, escape clears.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (!gridRef.current?.contains(document.activeElement) && document.activeElement !== document.body) return;
      if (event.key === 'Escape') { setQuickLook(null); setSelectedId(null); return; }
      if (event.key === ' ' && selected?.url) { event.preventDefault(); setQuickLook(quickLook ? null : { url: selected.url, name: selected.name, kind: selected.kind }); return; }
      const index = filteredAssets.findIndex((asset) => asset.id === selectedId);
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); setSelectedId(filteredAssets[Math.min(filteredAssets.length - 1, index + 1)]?.id || null); }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); setSelectedId(filteredAssets[Math.max(0, index - 1)]?.id || null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filteredAssets, quickLook, selected, selectedId]);

  const renderPreview = (asset: LibraryAsset) => {
    if ((asset.kind === 'image' || asset.kind === 'reference') && asset.url && !isArchiveAsset(asset) && isLikelyImageUrl(asset.url)) {
      return <img src={asset.url} className="lib-card__media" alt="" loading="lazy" draggable={false} />;
    }
    if (asset.kind === 'video' && asset.url && !isArchiveAsset(asset)) {
      return <video src={asset.url} className="lib-card__media" muted playsInline preload="metadata" onMouseEnter={(e) => { void e.currentTarget.play().catch(() => undefined); }} onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />;
    }
    if (isArchiveAsset(asset)) return <div className="lib-card__placeholder"><BoxIcon className="w-7 h-7" /><span>{/\.(glb|gltf|fbx|obj)/i.test(asset.url || asset.name) ? '3D' : 'Archive'}</span></div>;
    if (asset.kind === 'audio') return <div className="lib-card__placeholder"><MusicNoteIcon className="w-7 h-7" /><span>Audio</span></div>;
    return <div className="lib-card__placeholder"><BoxIcon className="w-7 h-7" /></div>;
  };

  const kindIcon = (kind: LibraryAssetKind) => (kind === 'image' ? ImageIcon : kind === 'video' ? VideoIcon : kind === 'reference' ? TagIcon : MusicNoteIcon);

  const runStockSearch = async (query: string, orientation: UnsplashOrientation) => {
    const hasKey = hasUnsplashAccessKey();
    setUnsplashReady(hasKey);
    if (!hasKey) {
      setStockStatus('Add an Unsplash Access Key in Settings to search stock photos.');
      return;
    }
    setIsStockLoading(true);
    setStockStatus('Searching Unsplash…');
    try {
      const results = await searchUnsplashPhotos(query, { orientation, perPage: 18 });
      setStockResults(results);
      setStockStatus(results.length > 0 ? `${results.length} photos` : 'No photos found.');
    } catch (error) {
      setStockStatus(error instanceof Error ? error.message : 'Unsplash search failed.');
    } finally {
      setIsStockLoading(false);
    }
  };

  const handleAddStockImage = async (asset: UnsplashStockAsset) => {
    if (!onAddStockImage) return;
    setStockStatus(`Adding "${asset.name}"…`);
    try {
      await trackUnsplashDownload(asset.downloadLocation);
      onAddStockImage(buildUnsplashMediaItem(asset));
      setStockStatus(`Added "${asset.name}" to the library.`);
    } catch (error) {
      setStockStatus(error instanceof Error ? error.message : 'Could not add Unsplash photo.');
    }
  };

  const handleDownloadStockImage = async (asset: UnsplashStockAsset) => {
    try {
      const trackedUrl = await trackUnsplashDownload(asset.downloadLocation);
      window.open(trackedUrl || asset.fullUrl || asset.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setStockStatus(error instanceof Error ? error.message : 'Could not open download.');
    }
  };

  const handleDownloadPackManifest = (pack: AssetPack) => {
    const blob = new Blob([JSON.stringify(buildAssetPackManifest(pack), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${pack.id}.asset-pack.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleImportPackManifest = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      const pack = normalizeAssetPackManifest(JSON.parse(await file.text()));
      setImportedPacks((current) => {
        const next = upsertImportedAssetPack(current, pack);
        saveImportedAssetPacks(next);
        return next;
      });
      setSelectedPackId(pack.id);
      setPackStatus(`Imported pack: ${pack.label}`);
    } catch (error) {
      setPackStatus(error instanceof Error ? error.message : 'Could not import asset pack manifest.');
    }
  };

  const handleRemoveImportedPack = (packId: string) => {
    const next = importedPacks.filter((pack) => pack.id !== packId);
    setImportedPacks(next);
    saveImportedAssetPacks(next);
    if (selectedPackId === packId) setSelectedPackId(BUILTIN_ASSET_PACKS[0]?.id || next[0]?.id || '');
    setPackStatus('Pack removed.');
  };

  const handleUsePackItem = (item: AssetPackItem) => {
    if (item.stockPreset) {
      const orientation = item.stockPreset.orientation || stockOrientation;
      setStockQuery(item.stockPreset.query);
      setStockOrientation(orientation);
      setCollection('stock');
      void runStockSearch(item.stockPreset.query, orientation);
      return;
    }
    const url = item.downloadUrl || item.sourcePageUrl || item.url;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const collections: Array<{ id: Collection; label: string; count?: number; icon: React.FC<{ className?: string }> }> = [
    { id: 'all', label: 'All assets', count: counts.all, icon: GridIcon },
    { id: 'image', label: 'Images', count: counts.image, icon: ImageIcon },
    { id: 'video', label: 'Videos', count: counts.video, icon: VideoIcon },
    { id: 'audio', label: 'Audio', count: counts.audio, icon: MusicNoteIcon },
    { id: 'reference', label: 'References', count: counts.reference, icon: TagIcon },
    { id: 'shots', label: 'Shots', count: counts.shots, icon: ListIcon },
    { id: 'generated', label: 'Generated', count: counts.generated, icon: BoxIcon },
  ];

  const renderStock = () => (
    <div className="lib-stock">
      <form className="lib-stock__form" onSubmit={(e) => { e.preventDefault(); void runStockSearch(stockQuery, stockOrientation); }}>
        <input value={stockQuery} onChange={(e) => setStockQuery(e.target.value)} placeholder="Search Unsplash" className="app-input app-input--compact flex-1" />
        <select value={stockOrientation} onChange={(e) => setStockOrientation(e.target.value as UnsplashOrientation)} className="app-select app-select--compact">
          <option value="landscape">Landscape</option>
          <option value="portrait">Portrait</option>
          <option value="squarish">Square</option>
        </select>
        <button type="submit" className="app-button app-primary text-xs" disabled={isStockLoading || !stockQuery.trim()}>{isStockLoading ? 'Searching…' : 'Search'}</button>
      </form>
      {!unsplashReady && <p className="lib-note lib-note--warn">Add your Unsplash Access Key in Settings (Access Key only).</p>}
      {stockStatus && <p className="lib-note">{stockStatus}</p>}
      <div className={`lib-grid lib-grid--${density}`}>
        {stockResults.map((asset) => (
          <div key={asset.id} className="lib-card">
            <button type="button" className="lib-card__frame" onClick={() => setQuickLook({ url: asset.url, name: asset.name, kind: 'image' })}>
              <img src={asset.previewUrl} alt="" className="lib-card__media" loading="lazy" />
              <span className="lib-card__badge">Unsplash</span>
            </button>
            <div className="lib-card__meta">
              <span className="lib-card__name" title={asset.name}>{asset.name}</span>
              <span className="lib-card__sub"><a href={asset.photographerUrl} target="_blank" rel="noreferrer">{asset.photographerName}</a></span>
            </div>
            <div className="lib-card__actions">
              <button type="button" className="lib-card__action lib-card__action--primary" onClick={() => void handleAddStockImage(asset)} disabled={!onAddStockImage}>Add</button>
              <button type="button" className="lib-card__action" onClick={() => void handleDownloadStockImage(asset)}><DownloadIcon className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderPacks = () => (
    <div className="lib-packs">
      <div className="lib-packs__list">
        {assetPacks.map((pack) => (
          <button key={pack.id} type="button" className={`lib-packs__item ${selectedPack?.id === pack.id ? 'lib-packs__item--active' : ''}`} onClick={() => setSelectedPackId(pack.id)}>
            <span className="lib-packs__name">{pack.label}</span>
            <span className="lib-packs__meta">{pack.provider} · {formatPackCounts(pack)}</span>
          </button>
        ))}
        <input ref={packImportInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportPackManifest} />
        <button type="button" className="app-button app-secondary text-xs mt-2" onClick={() => packImportInputRef.current?.click()}><UploadIcon className="w-3.5 h-3.5" /> Import pack</button>
        {packStatus && <p className="lib-note">{packStatus}</p>}
      </div>
      {selectedPack && (
        <div className="lib-packs__detail">
          <div className="lib-packs__head">
            <div>
              <h3>{selectedPack.label}</h3>
              <p>{selectedPack.description}</p>
              <p className="lib-note">{selectedPack.license}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <a className="app-button app-tertiary text-xs" href={selectedPack.sourceUrl} target="_blank" rel="noreferrer">Source</a>
              {selectedPack.downloadUrl && <button type="button" className="app-button app-secondary text-xs" onClick={() => window.open(selectedPack.downloadUrl, '_blank', 'noopener,noreferrer')}><DownloadIcon className="w-3.5 h-3.5" /> Download</button>}
              <button type="button" className="app-button app-tertiary text-xs" onClick={() => handleDownloadPackManifest(selectedPack)}>Manifest</button>
              {selectedPackIsImported && <button type="button" className="app-button app-tertiary text-xs" onClick={() => handleRemoveImportedPack(selectedPack.id)}>Remove</button>}
            </div>
          </div>
          <div className={`lib-grid lib-grid--${density}`}>
            {selectedPack.items.map((item) => (
              <div key={item.id} className="lib-card">
                <div className="lib-card__frame">
                  {item.previewUrl ? <img src={item.previewUrl} alt="" className="lib-card__media" loading="lazy" /> : <div className="lib-card__placeholder"><BoxIcon className="w-7 h-7" /></div>}
                  <span className="lib-card__badge">{ASSET_PACK_TYPE_LABELS[item.type]}</span>
                </div>
                <div className="lib-card__meta">
                  <span className="lib-card__name" title={item.label}>{item.label}</span>
                  <span className="lib-card__sub">{formatBytes(item.fileSizeBytes) || item.license || item.provider}</span>
                </div>
                <div className="lib-card__actions">
                  <button type="button" className="lib-card__action lib-card__action--primary" onClick={() => handleUsePackItem(item)} disabled={!(item.stockPreset || item.downloadUrl || item.sourcePageUrl || item.url)}>
                    {item.stockPreset ? 'Search' : item.downloadUrl ? 'Download' : 'Open'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="lib-workspace">
      <aside className="lib-sidebar">
        <div className="lib-sidebar__search">
          <SearchIcon className="w-4 h-4 app-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="lib-sidebar__input" />
          {search && <button type="button" className="toolbar-button toolbar-button--icon" onClick={() => setSearch('')} aria-label="Clear search"><XIcon className="w-3.5 h-3.5" /></button>}
        </div>
        <div className="lib-sidebar__label">Library</div>
        <ul className="lib-sidebar__list" role="list">
          {collections.map((entry) => (
            <li key={entry.id}>
              <button type="button" className={`lib-sidebar__item ${collection === entry.id ? 'lib-sidebar__item--active' : ''}`} onClick={() => setCollection(entry.id)}>
                <entry.icon className="lib-sidebar__icon" />
                <span className="lib-sidebar__text">{entry.label}</span>
                {typeof entry.count === 'number' && <span className="lib-sidebar__count">{entry.count}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="lib-sidebar__label">Sources</div>
        <ul className="lib-sidebar__list" role="list">
          <li><button type="button" className={`lib-sidebar__item ${collection === 'stock' ? 'lib-sidebar__item--active' : ''}`} onClick={() => setCollection('stock')}><SearchIcon className="lib-sidebar__icon" /><span className="lib-sidebar__text">Unsplash stock</span></button></li>
          <li><button type="button" className={`lib-sidebar__item ${collection === 'packs' ? 'lib-sidebar__item--active' : ''}`} onClick={() => setCollection('packs')}><BoxIcon className="lib-sidebar__icon" /><span className="lib-sidebar__text">Asset packs</span><span className="lib-sidebar__count">{assetPacks.length}</span></button></li>
        </ul>
        <div className="lib-sidebar__foot">
          {isLoading && <span>Loading other projects…</span>}
          {loadError && <span>{loadError}</span>}
          {!isLoading && !loadError && recentProjects.length === 0 && <span>Save a project to grow the library across projects.</span>}
        </div>
      </aside>

      <div className="lib-main">
        <div className="lib-toolbar">
          <div className="lib-toolbar__title">
            {collection === 'stock' ? 'Unsplash stock' : collection === 'packs' ? 'Asset packs' : collections.find((c) => c.id === collection)?.label}
            <span className="lib-toolbar__count">{collection === 'stock' ? stockResults.length : collection === 'packs' ? assetPacks.length : filteredAssets.length}</span>
          </div>
          <div className="lib-toolbar__controls">
            {collection !== 'stock' && collection !== 'packs' && (
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="app-select app-select--compact" aria-label="Sort">
                <option value="recent">Recent first</option>
                <option value="name">Name</option>
                <option value="project">Project</option>
              </select>
            )}
            <div className="toolbar-segmented" role="radiogroup" aria-label="Thumbnail size">
              {(['small', 'medium', 'large'] as Density[]).map((size) => (
                <button key={size} type="button" role="radio" aria-checked={density === size} className={`toolbar-segmented__item ${density === size ? 'toolbar-segmented__item--active' : ''}`} onClick={() => setDensity(size)} title={`${size} thumbnails`}>
                  {size === 'small' ? 'S' : size === 'medium' ? 'M' : 'L'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="lib-content" ref={gridRef} tabIndex={0}>
          {collection === 'stock' ? renderStock() : collection === 'packs' ? renderPacks() : (
            <>
              {filteredAssets.length === 0 ? (
                <div className="lib-empty">
                  <ImageIcon className="w-8 h-8 app-muted" />
                  <p className="font-semibold">Nothing here yet</p>
                  <p className="app-muted text-sm">{search ? 'No assets match your search.' : 'Generate or import media and it shows up here automatically.'}</p>
                </div>
              ) : (
                <div className={`lib-grid lib-grid--${density}`}>
                  {filteredAssets.map((asset) => {
                    const Icon = kindIcon(asset.kind);
                    const isSelected = asset.id === selectedId;
                    return (
                      <div
                        key={asset.id}
                        className={`lib-card ${isSelected ? 'lib-card--selected' : ''}`}
                        onClick={() => setSelectedId(asset.id)}
                        onDoubleClick={() => { if (asset.url) setQuickLook({ url: asset.url, name: asset.name, kind: asset.kind }); }}
                      >
                        <div className="lib-card__frame">
                          {renderPreview(asset)}
                          <span className="lib-card__badge"><Icon className="w-3 h-3" />{asset.detail || asset.kind}</span>
                          {asset.origin === 'recent' && <span className="lib-card__origin">{asset.projectName}</span>}
                          <div className="lib-card__hover">
                            {(asset.kind === 'image' || asset.kind === 'reference') && asset.url && onEditImage && <button type="button" className="lib-card__action" onClick={(e) => { e.stopPropagation(); onEditImage(asset); }} title="Edit in Photo"><EditIcon className="w-3.5 h-3.5" /></button>}
                            {asset.kind === 'video' && asset.url && !isArchiveAsset(asset) && onEditVideo && <button type="button" className="lib-card__action" onClick={(e) => { e.stopPropagation(); onEditVideo(asset); }} title="Open in Edit"><EditIcon className="w-3.5 h-3.5" /></button>}
                            {asset.url && <a href={asset.url} download className="lib-card__action" onClick={(e) => e.stopPropagation()} title="Download"><DownloadIcon className="w-3.5 h-3.5" /></a>}
                          </div>
                        </div>
                        <div className="lib-card__meta">
                          <span className="lib-card__name" title={asset.name}>{asset.name}</span>
                          <span className="lib-card__sub">{asset.generatedBy || asset.source || asset.projectName}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {selected && collection !== 'stock' && collection !== 'packs' && (
        <aside className="lib-inspector">
          <div className="lib-inspector__preview">{renderPreview(selected)}</div>
          <div className="lib-inspector__body">
            <div className="lib-inspector__name">{selected.name}</div>
            <dl className="lib-inspector__facts">
              <dt>Type</dt><dd>{selected.detail || selected.kind}</dd>
              <dt>Project</dt><dd>{selected.projectName}</dd>
              {selected.generatedBy && <><dt>Made with</dt><dd>{selected.generatedBy}</dd></>}
              {selected.source && <><dt>Source</dt><dd>{selected.source}</dd></>}
              {selected.origin === 'recent' && selected.projectPath && <><dt>Path</dt><dd className="truncate" title={selected.projectPath}>{selected.projectPath}</dd></>}
            </dl>
            <div className="lib-inspector__actions">
              {selected.url && <button type="button" className="app-button app-primary text-xs" onClick={() => setQuickLook({ url: selected.url!, name: selected.name, kind: selected.kind })}>Quick look</button>}
              {(selected.kind === 'image' || selected.kind === 'reference') && selected.url && onEditImage && <button type="button" className="app-button app-secondary text-xs" onClick={() => onEditImage(selected)}>Edit in Photo</button>}
              {selected.kind === 'video' && selected.url && !isArchiveAsset(selected) && onEditVideo && <button type="button" className="app-button app-secondary text-xs" onClick={() => onEditVideo(selected)}>Open in Edit</button>}
              {selected.url && <a href={selected.url} download className="app-button app-tertiary text-xs">Download</a>}
            </div>
          </div>
        </aside>
      )}

      {quickLook && (
        <div className="lib-quicklook" onClick={() => setQuickLook(null)}>
          <div className="lib-quicklook__panel" onClick={(e) => e.stopPropagation()}>
            <div className="lib-quicklook__head">
              <span>{quickLook.name}</span>
              <button type="button" className="toolbar-button toolbar-button--icon" onClick={() => setQuickLook(null)} aria-label="Close"><XIcon className="w-4 h-4" /></button>
            </div>
            <div className="lib-quicklook__body">
              {quickLook.kind === 'video' ? <video src={quickLook.url} controls autoPlay /> : quickLook.kind === 'audio' ? <audio src={quickLook.url} controls /> : <img src={quickLook.url} alt="" />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssetLibraryWorkspace;
