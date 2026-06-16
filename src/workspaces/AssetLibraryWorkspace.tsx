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
import { BoxIcon, ImageIcon, VideoIcon, MusicNoteIcon, TagIcon, SearchIcon, DownloadIcon, EditIcon, UploadIcon } from '../components/icons';

type LibraryAssetKind = 'image' | 'video' | 'audio' | 'reference';

const ASSET_PACK_TYPE_LABELS: Record<AssetPackItemType, string> = {
  hdri: 'HDRI',
  model: 'Model',
  material: 'Material',
  'render-preset': 'Render Preset',
  'stock-preset': 'Stock Preset',
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

const toAssetIdSegment = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'project';

const buildAssetIdPrefix = (
  origin: LibraryAsset['origin'],
  projectName: string,
  projectPath: string | null
) => `${origin}-${toAssetIdSegment(projectPath || projectName)}`;

const mapMediaAssets = (
  items: MediaItem[],
  projectName: string,
  projectPath: string | null,
  origin: LibraryAsset['origin']
): LibraryAsset[] => {
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

const mapReferenceAssets = (
  references: ReferenceItem[],
  projectName: string,
  projectPath: string | null,
  origin: LibraryAsset['origin']
): LibraryAsset[] => {
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

const mapShotAssets = (
  shots: ShotPrompt[],
  projectName: string,
  projectPath: string | null,
  origin: LibraryAsset['origin']
): LibraryAsset[] => {
  const assets: LibraryAsset[] = [];
  const idPrefix = buildAssetIdPrefix(origin, projectName, projectPath);
  shots.forEach((shot, index) => {
    const shotLabel = shot.shot || index + 1;
    const baseId = `${idPrefix}-shot-${shotLabel}-${index}`;
    const description = shot.description ? ` - ${shot.description.slice(0, 24)}` : '';

    if (shot.imageUrl) {
      assets.push({
        id: `${baseId}-storyboard`,
        name: `Shot ${shotLabel} Storyboard${description}`,
        kind: 'image',
        url: shot.imageUrl,
        projectName,
        projectPath,
        origin,
        category: 'shot',
        detail: 'storyboard',
        generatedBy: shot.generatedBy,
      });
    }
    if (shot.sketchUrl) {
      assets.push({
        id: `${baseId}-sketch`,
        name: `Shot ${shotLabel} Sketch${description}`,
        kind: 'image',
        url: shot.sketchUrl,
        projectName,
        projectPath,
        origin,
        category: 'shot',
        detail: 'sketch',
      });
    }
    if (shot.startFrameUrl) {
      assets.push({
        id: `${baseId}-start-frame`,
        name: `Shot ${shotLabel} Start Frame${description}`,
        kind: 'image',
        url: shot.startFrameUrl,
        projectName,
        projectPath,
        origin,
        category: 'shot',
        detail: 'start frame',
      });
    }
    if (shot.endFrameUrl) {
      assets.push({
        id: `${baseId}-end-frame`,
        name: `Shot ${shotLabel} End Frame${description}`,
        kind: 'image',
        url: shot.endFrameUrl,
        projectName,
        projectPath,
        origin,
        category: 'shot',
        detail: 'end frame',
      });
    }
    if (shot.motionReferenceUrl) {
      assets.push({
        id: `${baseId}-motion-ref`,
        name: `Shot ${shotLabel} Motion Ref${description}`,
        kind: 'video',
        url: shot.motionReferenceUrl,
        projectName,
        projectPath,
        origin,
        category: 'shot',
        detail: 'motion ref',
      });
    }
    if (shot.videoUrl) {
      assets.push({
        id: `${baseId}-video`,
        name: `Shot ${shotLabel} Video${description}`,
        kind: 'video',
        url: shot.videoUrl,
        projectName,
        projectPath,
        origin,
        category: 'shot',
        detail: 'storyboard video',
      });
    }
  });
  return assets;
};

const isLikelyImageUrl = (url: string) => {
  if (!url) return false;
  if (url.startsWith('data:image')) return true;
  if (url.startsWith('blob:')) return true;
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(url.split('?')[0]);
};

const isArchiveAsset = (asset: Pick<LibraryAsset, 'url' | 'name' | 'generatedBy'>) =>
  Boolean(asset.url && /\.(zip|exr)(?:$|[?#])/i.test(asset.url)) ||
  Boolean(asset.name && /\.zip$/i.test(asset.name)) ||
  /EXR|ACES HDR/i.test(asset.generatedBy || '');

const formatBytes = (value?: number) => {
  if (!value) return null;
  if (value < 1_000_000) return `${Math.round(value / 1_000)} KB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
};

const formatPackCounts = (pack: AssetPack) => {
  const counts = getAssetPackTypeCounts(pack);
  return Object.entries(counts)
    .map(([type, count]) => `${count} ${ASSET_PACK_TYPE_LABELS[type as AssetPackItemType] || type}`)
    .join(' / ');
};

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
  const [filter, setFilter] = useState<'all' | LibraryAssetKind | 'shots'>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fullView, setFullView] = useState<{ url: string; name: string; kind: LibraryAssetKind } | null>(null);
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

  const currentAssets = useMemo(() => {
    const projectLabel = currentProjectName || 'Current Project';
    const media = mapMediaAssets(mediaItems, projectLabel, currentProjectPath || null, 'current');
    const refs = mapReferenceAssets(references, projectLabel, currentProjectPath || null, 'current');
    const shots = mapShotAssets(shotPrompts, projectLabel, currentProjectPath || null, 'current');
    return [...media, ...refs, ...shots];
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
        setLoadError('Asset library is available in the desktop app.');
        setRemoteAssets([]);
        return;
      }
      setIsLoading(true);
      setLoadError(null);

      const candidates = recentProjects.filter((project) => project.path && project.path !== currentProjectPath);
      const results = await Promise.allSettled(
        candidates.map(async (project) => {
          const loaded = await loadProjectFromFolder(project.path);
          const projectName = loaded.name || project.name || 'Untitled Project';
          return [
            ...mapMediaAssets(loaded.mediaItems || [], projectName, project.path, 'recent'),
            ...mapReferenceAssets(loaded.references || [], projectName, project.path, 'recent'),
            ...mapShotAssets(loaded.projectHub?.shotPrompts || [], projectName, project.path, 'recent'),
          ];
        })
      );

      if (!isActive) return;
      const nextAssets: LibraryAsset[] = [];
      const failed = results.filter((result) => result.status === 'rejected');
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          nextAssets.push(...result.value);
        }
      });

      if (failed.length > 0 && nextAssets.length === 0) {
        setLoadError('Could not load assets from recent projects.');
      }
      setRemoteAssets(nextAssets);
      setIsLoading(false);
    };

    loadAssets().catch((error) => {
      if (!isActive) return;
      setLoadError(error instanceof Error ? error.message : 'Failed to load assets.');
      setIsLoading(false);
    });

    return () => {
      isActive = false;
    };
  }, [recentProjects, currentProjectPath]);

  useEffect(() => {
    const updateUnsplashState = () => setUnsplashReady(hasUnsplashAccessKey());
    window.addEventListener('storage', updateUnsplashState);
    window.addEventListener('focus', updateUnsplashState);
    return () => {
      window.removeEventListener('storage', updateUnsplashState);
      window.removeEventListener('focus', updateUnsplashState);
    };
  }, []);

  const allAssets = useMemo(() => {
    return [...currentAssets, ...remoteAssets];
  }, [currentAssets, remoteAssets]);

  const filteredAssets = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allAssets.filter((asset) => {
      if (filter === 'shots') {
        if (asset.category !== 'shot') return false;
      } else if (filter !== 'all' && asset.kind !== filter) {
        return false;
      }
      if (!term) return true;
      return (
        asset.name.toLowerCase().includes(term) ||
        asset.projectName.toLowerCase().includes(term) ||
        (asset.detail || '').toLowerCase().includes(term)
      );
    });
  }, [allAssets, filter, search]);

  const counts = useMemo(() => {
    return allAssets.reduce(
      (acc, asset) => {
        acc.total += 1;
        acc[asset.kind] += 1;
        if (asset.category === 'shot') acc.shots += 1;
        return acc;
      },
      { total: 0, image: 0, video: 0, audio: 0, reference: 0, shots: 0 }
    );
  }, [allAssets]);

  const assetPacks = useMemo(() => (
    [...BUILTIN_ASSET_PACKS, ...importedPacks]
  ), [importedPacks]);

  const selectedPack = useMemo(() => (
    assetPacks.find((pack) => pack.id === selectedPackId) || assetPacks[0]
  ), [assetPacks, selectedPackId]);

  const selectedPackIsImported = Boolean(selectedPack && importedPacks.some((pack) => pack.id === selectedPack.id));

  useEffect(() => {
    if (assetPacks.length > 0 && !assetPacks.some((pack) => pack.id === selectedPackId)) {
      setSelectedPackId(assetPacks[0].id);
    }
  }, [assetPacks, selectedPackId]);

  const renderPreview = (asset: LibraryAsset) => {
    if ((asset.kind === 'image' || asset.kind === 'reference') && asset.url && isLikelyImageUrl(asset.url)) {
      return <img src={asset.url} className="w-full h-full object-cover" alt={asset.name} />;
    }
    if (asset.kind === 'video' && asset.url && !isArchiveAsset(asset)) {
      return <video src={asset.url} className="w-full h-full object-cover" muted playsInline />;
    }
    if (isArchiveAsset(asset)) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-500">
          <BoxIcon className="w-10 h-10" />
          <span className="text-[10px] uppercase tracking-[0.18em]">EXR ZIP</span>
        </div>
      );
    }
    if (asset.kind === 'audio') {
      return (
        <div className="w-full h-full flex items-center justify-center text-gray-400">
          <MusicNoteIcon className="w-10 h-10" />
        </div>
      );
    }
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-500">
        <BoxIcon className="w-10 h-10" />
      </div>
    );
  };

  const typeIcon = (kind: LibraryAssetKind) => {
    if (kind === 'image') return ImageIcon;
    if (kind === 'video') return VideoIcon;
    if (kind === 'reference') return TagIcon;
    return MusicNoteIcon;
  };

  const runStockSearch = async (query: string, orientation: UnsplashOrientation) => {
    const hasKey = hasUnsplashAccessKey();
    setUnsplashReady(hasKey);
    if (!hasKey) {
      setStockStatus('Add an Unsplash Access Key in Settings to search stock photos.');
      return;
    }
    setIsStockLoading(true);
    setStockStatus('Searching Unsplash...');
    try {
      const results = await searchUnsplashPhotos(query, {
        orientation,
        perPage: 12,
      });
      setStockResults(results);
      setStockStatus(results.length > 0 ? `${results.length} Unsplash photos loaded.` : 'No Unsplash photos found.');
    } catch (error) {
      setStockStatus(error instanceof Error ? error.message : 'Unsplash search failed.');
    } finally {
      setIsStockLoading(false);
    }
  };

  const handleSearchStock = async () => {
    await runStockSearch(stockQuery, stockOrientation);
  };

  const handleAddStockImage = async (asset: UnsplashStockAsset) => {
    if (!onAddStockImage) return;
    setStockStatus(`Adding "${asset.name}" to Library...`);
    try {
      await trackUnsplashDownload(asset.downloadLocation);
      onAddStockImage(buildUnsplashMediaItem(asset));
      setStockStatus(`Added "${asset.name}" to Library.`);
    } catch (error) {
      setStockStatus(error instanceof Error ? error.message : 'Could not add Unsplash photo.');
    }
  };

  const handleDownloadStockImage = async (asset: UnsplashStockAsset) => {
    setStockStatus(`Preparing "${asset.name}"...`);
    try {
      const trackedUrl = await trackUnsplashDownload(asset.downloadLocation);
      window.open(trackedUrl || asset.fullUrl || asset.url, '_blank', 'noopener,noreferrer');
      setStockStatus(`Opened Unsplash download for "${asset.name}".`);
    } catch (error) {
      setStockStatus(error instanceof Error ? error.message : 'Could not track Unsplash download.');
    }
  };

  const handleDownloadPackManifest = (pack: AssetPack) => {
    const manifest = buildAssetPackManifest(pack);
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
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
      const parsed = JSON.parse(await file.text());
      const pack = normalizeAssetPackManifest(parsed);
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
    const removed = importedPacks.find((pack) => pack.id === packId);
    const next = importedPacks.filter((pack) => pack.id !== packId);
    setImportedPacks(next);
    saveImportedAssetPacks(next);
    if (selectedPackId === packId) {
      setSelectedPackId(BUILTIN_ASSET_PACKS[0]?.id || next[0]?.id || '');
    }
    setPackStatus(removed ? `Removed imported pack: ${removed.label}` : 'Imported pack removed.');
  };

  const handleUsePackItem = (item: AssetPackItem) => {
    if (item.stockPreset) {
      const orientation = item.stockPreset.orientation || stockOrientation;
      setStockQuery(item.stockPreset.query);
      setStockOrientation(orientation);
      void runStockSearch(item.stockPreset.query, orientation);
      return;
    }
    const url = item.downloadUrl || item.sourcePageUrl || item.url;
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="studio-workspace p-6 h-full overflow-auto">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">Asset Library</h2>
            <p className="text-gray-400">Browse assets from every saved project and uploaded media.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="app-pill">{counts.total} assets</span>
            {isLoading && <span className="app-pill app-pill--warning">Loading</span>}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.4fr_0.6fr]">
          <div className="app-panel p-4 space-y-3">
            <label className="text-xs uppercase tracking-[0.2em] text-gray-400 flex items-center gap-2">
              <SearchIcon className="w-4 h-4" />
              Search
            </label>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search assets, projects, or tags..."
              className="app-input"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Filter</label>
                <select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as 'all' | LibraryAssetKind | 'shots')}
                  className="app-select mt-1"
                >
                  <option value="all">All assets</option>
                  <option value="image">Images</option>
                  <option value="video">Videos</option>
                  <option value="audio">Audio</option>
                  <option value="reference">References</option>
                  <option value="shots">Shots</option>
                </select>
              </div>
              <div className="text-xs text-gray-400 flex items-center justify-between border border-gray-700/60 rounded-lg px-3 py-2">
                <span>Images: {counts.image}</span>
                <span>Video: {counts.video}</span>
                <span>Audio: {counts.audio}</span>
                <span>Refs: {counts.reference}</span>
                <span>Shots: {counts.shots}</span>
              </div>
            </div>
          </div>

          <div className="app-panel p-4 space-y-3 text-sm text-gray-300">
            <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Library scope</div>
            <p>Includes media from the current project plus recent saved projects.</p>
            {loadError && <p className="text-amber-300">{loadError}</p>}
            {recentProjects.length === 0 && <p className="text-gray-500">Save a project to build your library.</p>}
          </div>
        </div>

        <div className="app-panel p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Asset Packs</div>
              <h3 className="text-lg font-semibold text-white">Packs & Presets</h3>
              <p className="text-xs text-gray-400">Browse bundled HDRIs, stock searches, render presets, material presets and model-pack slots.</p>
            </div>
            {selectedPack && (
              <div className="flex items-center gap-2">
                <input
                  ref={packImportInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleImportPackManifest}
                />
                <button
                  className="app-button app-secondary text-xs flex items-center gap-2"
                  onClick={() => packImportInputRef.current?.click()}
                >
                  <UploadIcon className="w-3 h-3" />
                  Import Pack
                </button>
                {selectedPack.downloadUrl && (
                  <button
                    className="app-button app-secondary text-xs flex items-center gap-2"
                    onClick={() => window.open(selectedPack.downloadUrl, '_blank', 'noopener,noreferrer')}
                  >
                    <DownloadIcon className="w-3 h-3" />
                    Pack Source
                  </button>
                )}
                <button
                  className="app-button app-tertiary text-xs flex items-center gap-2"
                  onClick={() => handleDownloadPackManifest(selectedPack)}
                >
                  <BoxIcon className="w-3 h-3" />
                  Manifest
                </button>
                {selectedPackIsImported && (
                  <button
                    className="app-button app-tertiary text-xs"
                    onClick={() => handleRemoveImportedPack(selectedPack.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
          {packStatus && <p className="text-xs text-gray-400">{packStatus}</p>}

          <div className="grid gap-3 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="space-y-2">
              {assetPacks.map((pack) => (
                <button
                  key={pack.id}
                  className={`w-full text-left border p-3 transition-colors ${
                    selectedPack?.id === pack.id
                      ? 'border-indigo-400 bg-indigo-500/10'
                      : 'border-gray-800 bg-black/20 hover:border-gray-600'
                  }`}
                  onClick={() => setSelectedPackId(pack.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">{pack.label}</p>
                      <p className="text-[10px] text-gray-400 mt-1 line-clamp-2">{pack.description}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="app-pill">{pack.provider}</span>
                      {importedPacks.some((imported) => imported.id === pack.id) && (
                        <span className="text-[10px] text-indigo-300">imported</span>
                      )}
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-2">{formatPackCounts(pack)}</p>
                </button>
              ))}
            </div>

            {selectedPack && (
              <div className="border border-gray-800 bg-black/20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{selectedPack.label}</p>
                    <p className="text-[10px] text-gray-500">{selectedPack.license}</p>
                  </div>
                  <a
                    className="app-button app-tertiary text-[10px]"
                    href={selectedPack.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Source
                  </a>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {selectedPack.items.map((item) => {
                    const sizeLabel = formatBytes(item.fileSizeBytes);
                    const canUse = Boolean(item.stockPreset || item.downloadUrl || item.sourcePageUrl || item.url);
                    return (
                      <div key={item.id} className="border border-gray-800 bg-gray-950/60 overflow-hidden">
                        {item.previewUrl ? (
                          <img src={item.previewUrl} alt={item.label} className="h-28 w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="h-28 w-full bg-black/60 flex items-center justify-center text-gray-500">
                            <BoxIcon className="w-8 h-8" />
                          </div>
                        )}
                        <div className="p-3 space-y-3">
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-semibold text-white line-clamp-2">{item.label}</p>
                              <span className="app-pill">{ASSET_PACK_TYPE_LABELS[item.type]}</span>
                            </div>
                            <p className="text-[10px] text-gray-400 mt-1 line-clamp-2">{item.description}</p>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {item.tags.slice(0, 4).map((tag) => (
                                <span key={tag} className="text-[10px] px-2 py-0.5 bg-gray-800 text-gray-300">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[10px] text-gray-500">
                            <span>{item.provider}</span>
                            <span>{sizeLabel || item.license}</span>
                          </div>
                          <button
                            className="app-button app-secondary text-[10px] w-full flex items-center justify-center gap-2"
                            onClick={() => handleUsePackItem(item)}
                            disabled={!canUse}
                          >
                            {item.stockPreset ? <SearchIcon className="w-3 h-3" /> : <DownloadIcon className="w-3 h-3" />}
                            {item.stockPreset ? 'Use Search' : item.downloadUrl ? 'Download' : 'Open'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="app-panel p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Stock Library</div>
              <h3 className="text-lg font-semibold text-white">Unsplash</h3>
              <p className="text-xs text-gray-400">Search hotlinked Unsplash photos and add selected images to this project.</p>
            </div>
            <span className={`app-pill ${unsplashReady ? 'app-pill--success' : 'app-pill--warning'}`}>
              {unsplashReady ? 'API connected' : 'API key needed'}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_150px_120px]">
            <input
              value={stockQuery}
              onChange={(event) => setStockQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleSearchStock();
              }}
              placeholder="Search Unsplash stock photos..."
              className="app-input"
            />
            <select
              value={stockOrientation}
              onChange={(event) => setStockOrientation(event.target.value as UnsplashOrientation)}
              className="app-select"
            >
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
              <option value="squarish">Square</option>
            </select>
            <button
              className="app-button app-primary text-xs"
              onClick={handleSearchStock}
              disabled={isStockLoading || !stockQuery.trim()}
            >
              {isStockLoading ? 'Searching' : 'Search'}
            </button>
          </div>
          {!unsplashReady && (
            <p className="text-xs text-amber-300">
              Add your Unsplash Access Key in Settings. Use the Access Key only, not the Secret Key.
            </p>
          )}
          {stockStatus && <p className="text-xs text-gray-300">{stockStatus}</p>}
          {stockResults.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {stockResults.map((asset) => (
                <div key={asset.id} className="border border-gray-800 bg-black/20 overflow-hidden flex flex-col">
                  <button
                    className="relative aspect-video bg-black text-left"
                    onClick={() => setFullView({ url: asset.url, name: asset.name, kind: 'image' })}
                  >
                    <img src={asset.previewUrl} alt={asset.name} className="w-full h-full object-cover" loading="lazy" />
                    <span className="absolute top-2 left-2 bg-black/70 text-[10px] text-white px-2 py-1">
                      Unsplash
                    </span>
                  </button>
                  <div className="p-3 space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-white line-clamp-2">{asset.name}</p>
                      <p className="text-[10px] text-gray-400 mt-1">
                        Photo by{' '}
                        <a className="text-indigo-300 hover:text-indigo-200" href={asset.photographerUrl} target="_blank" rel="noreferrer">
                          {asset.photographerName}
                        </a>{' '}
                        on{' '}
                        <a className="text-indigo-300 hover:text-indigo-200" href={asset.unsplashUrl} target="_blank" rel="noreferrer">
                          Unsplash
                        </a>
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        className="app-button app-secondary text-[10px]"
                        onClick={() => void handleAddStockImage(asset)}
                        disabled={!onAddStockImage}
                      >
                        Add to Library
                      </button>
                      <button
                        className="app-button app-tertiary text-[10px]"
                        onClick={() => void handleDownloadStockImage(asset)}
                      >
                        Download
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredAssets.map((asset) => {
            const Icon = typeIcon(asset.kind);
            return (
              <div
                key={asset.id}
                className="app-card p-3 flex flex-col gap-3"
                onDoubleClick={() => {
                  if (asset.url) {
                    setFullView({ url: asset.url, name: asset.name, kind: asset.kind });
                  }
                }}
              >
                <div className="relative aspect-video bg-black/60 rounded-lg overflow-hidden">
                  {renderPreview(asset)}
                  <div className="absolute top-2 left-2 bg-black/60 text-xs px-2 py-1 rounded-full flex items-center gap-1 text-gray-200">
                    <Icon className="w-3 h-3" />
                    {asset.kind}
                  </div>
                  {asset.generatedBy && (
                    <div className="absolute bottom-2 left-2 bg-black/60 text-[10px] text-gray-200 px-2 py-1 rounded">
                      {asset.generatedBy}
                    </div>
                  )}
                  {asset.url && (
                    <a
                      href={asset.url}
                      download
                      className="absolute top-2 right-2 bg-black/60 text-xs px-2 py-1 rounded-full flex items-center gap-1 text-gray-200"
                    >
                      <DownloadIcon className="w-3 h-3" />
                      Download
                    </a>
                  )}
                </div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold truncate">{asset.name}</p>
                    <p className="text-xs text-gray-400 truncate">{asset.projectName}</p>
                  </div>
                  <span className="app-pill">{asset.origin === 'current' ? 'Current' : 'Recent'}</span>
                </div>
                {(asset.detail || asset.source) && (
                  <div className="text-xs text-gray-500 flex items-center justify-between gap-2">
                    <span>{asset.detail || 'media'}</span>
                    <span>{asset.source || 'local'}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {(asset.kind === 'image' || asset.kind === 'reference') && asset.url && onEditImage && (
                    <button
                      onClick={() => onEditImage(asset)}
                      className="flex-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 py-1.5 rounded flex items-center justify-center gap-1"
                    >
                      <EditIcon className="w-3 h-3" />
                      Edit Image
                    </button>
                  )}
                  {asset.kind === 'video' && asset.url && !isArchiveAsset(asset) && onEditVideo && (
                    <button
                      onClick={() => onEditVideo(asset)}
                      className="flex-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 py-1.5 rounded flex items-center justify-center gap-1"
                    >
                      <EditIcon className="w-3 h-3" />
                      Edit Video
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {!isLoading && filteredAssets.length === 0 && (
          <div className="app-panel p-6 text-center text-gray-400">
            No assets match your search.
          </div>
        )}
      </div>

      {fullView && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-800 flex items-center justify-between">
              <div className="text-sm font-semibold text-white">{fullView.name}</div>
              <button onClick={() => setFullView(null)} className="text-gray-400 hover:text-white text-xl font-bold">&times;</button>
            </div>
            <div className="p-4 flex-1 overflow-auto bg-black/70">
              {fullView.kind === 'video' ? (
                <video src={fullView.url} controls className="w-full max-h-[70vh] object-contain" />
              ) : fullView.kind === 'audio' ? (
                <audio src={fullView.url} controls className="w-full" />
              ) : (
                <img src={fullView.url} alt={fullView.name} className="w-full max-h-[70vh] object-contain" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssetLibraryWorkspace;
