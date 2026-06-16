import React, { useEffect, useMemo, useState } from 'react';
import { MediaItem, RecentProject, ReferenceItem, ShotPrompt } from '../types';
import { UploadIcon, SparklesIcon, DownloadIcon } from '../components/icons';
import {
  upscaleImage,
  upscaleImageWithCrystal,
  upscaleImageWithClarity,
  upscaleImageWithTopaz,
  upscaleVideoWithCrystal,
  upscaleVideoWithTopaz,
} from '../services/replicateService';
import { toLtxVideoUri, upscaleVideoToAcesHdrWithLtx } from '../services/ltxService';
import { fileToBase64, getBase64FromUrl } from '../utils/helpers';
import { useLibraryAssets } from '../hooks/useLibraryAssets';

type UpscaleModelId = 'real-esrgan' | 'crystal' | 'clarity' | 'topaz' | 'crystal-video' | 'topaz-video';
type UpscaleKind = 'image' | 'video';
type UpscaleMode = 'resolution' | 'color-science';

const MODEL_OPTIONS: Array<{ id: UpscaleModelId; label: string; kind: UpscaleKind; provider: string }> = [
  { id: 'crystal', label: 'Crystal Upscaler', kind: 'image', provider: 'Replicate' },
  { id: 'clarity', label: 'Clarity Upscaler', kind: 'image', provider: 'Replicate' },
  { id: 'topaz', label: 'Topaz Upscale', kind: 'image', provider: 'Replicate' },
  { id: 'real-esrgan', label: 'Real-ESRGAN 4x', kind: 'image', provider: 'Replicate' },
  { id: 'crystal-video', label: 'Crystal Video Upscaler', kind: 'video', provider: 'Replicate' },
  { id: 'topaz-video', label: 'Topaz Video Upscale', kind: 'video', provider: 'Replicate' },
];

const isArchiveUrl = (url?: string | null) => Boolean(url && /\.(zip|exr)(?:$|[?#])/i.test(url));
const isArchiveItem = (item: { url?: string | null; name?: string; generatedBy?: string }) =>
  isArchiveUrl(item.url) || /\.zip$/i.test(item.name) || /EXR|ACES HDR/i.test(item.generatedBy || '');

const getSourceNameFromUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const tail = parsed.pathname.split('/').filter(Boolean).pop();
    return tail || 'ltx_video.mp4';
  } catch {
    return 'ltx_video.mp4';
  }
};

interface UpscaleWorkspaceProps {
  onAddGeneratedMedia: (item: MediaItem) => void;
  apiKeyReady?: boolean;
  mediaItems?: MediaItem[];
  references?: ReferenceItem[];
  shotPrompts?: ShotPrompt[];
  recentProjects?: RecentProject[];
  currentProjectName?: string | null;
  currentProjectPath?: string | null;
}

const UpscaleWorkspace: React.FC<UpscaleWorkspaceProps> = ({
  onAddGeneratedMedia,
  apiKeyReady,
  mediaItems = [],
  references = [],
  shotPrompts = [],
  recentProjects = [],
  currentProjectName,
  currentProjectPath,
}) => {
  const [mode, setMode] = useState<UpscaleMode>('resolution');
  const [modelId, setModelId] = useState<UpscaleModelId>('crystal');
  const [scaleValue, setScaleValue] = useState<number>(4);
  const [resolutionPreset, setResolutionPreset] = useState<string>('auto');
  const [customResolution, setCustomResolution] = useState<string>('');
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [inputUrl, setInputUrl] = useState<string>('');
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [generated, setGenerated] = useState<MediaItem[]>([]);
  const [librarySearch, setLibrarySearch] = useState('');

  const { assets: libraryAssets, isLoading: libraryLoading, error: libraryError } = useLibraryAssets({
    currentProjectName,
    currentProjectPath,
    mediaItems,
    references,
    shotPrompts,
    recentProjects,
  });

  const activeModel = useMemo(
    () => MODEL_OPTIONS.find((option) => option.id === modelId) || MODEL_OPTIONS[0],
    [modelId]
  );
  const inputKind: UpscaleKind = mode === 'color-science' ? 'video' : activeModel.kind;
  const isVideoInput = inputKind === 'video';
  const effectiveResolution = useMemo(() => {
    if (resolutionPreset === 'custom') return customResolution.trim();
    if (resolutionPreset === 'auto') return '';
    return resolutionPreset.trim();
  }, [customResolution, resolutionPreset]);

  const previewUrl = useMemo(() => {
    if (inputFile) return URL.createObjectURL(inputFile);
    return inputUrl.trim() || null;
  }, [inputFile, inputUrl]);

  useEffect(() => {
    return () => {
      if (inputFile && previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [inputFile, previewUrl]);

  const latestResults = useMemo(() => {
    const type = isVideoInput ? 'video' : 'image';
    const projectMatches = mediaItems.filter((item) => item.type === type);
    const combined = [...generated, ...projectMatches];
    const seen = new Set<string>();
    const unique: MediaItem[] = [];
    for (const item of combined) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      unique.push(item);
    }
    return unique.slice(0, 12);
  }, [generated, isVideoInput, mediaItems]);

  const filteredLibraryAssets = useMemo(() => {
    const term = librarySearch.trim().toLowerCase();
    return libraryAssets.filter((asset) => {
      if (isVideoInput && asset.kind !== 'video') return false;
      if (isVideoInput && isArchiveItem({ url: asset.url, name: asset.name, generatedBy: asset.generatedBy })) return false;
      if (!isVideoInput && asset.kind !== 'image' && asset.kind !== 'reference') return false;
      if (!term) return true;
      return asset.name.toLowerCase().includes(term) || asset.projectName.toLowerCase().includes(term);
    });
  }, [libraryAssets, librarySearch, isVideoInput]);

  const resolveInputPayload = async () => {
    if (inputFile) {
      const base64 = await fileToBase64(inputFile);
      return { base64, mimeType: inputFile.type || (isVideoInput ? 'video/mp4' : 'image/png') };
    }
    const url = inputUrl.trim();
    if (!url) return null;
    return getBase64FromUrl(url);
  };

  const resolveLtxVideoInput = async () => {
    if (inputFile) {
      const base64 = await fileToBase64(inputFile);
      return {
        videoUri: toLtxVideoUri({ base64, mimeType: inputFile.type || 'video/mp4' }),
        sourceName: inputFile.name || 'ltx_video.mp4',
      };
    }

    const url = inputUrl.trim();
    if (!url) return null;
    if (url.startsWith('data:') || /^https:\/\//i.test(url)) {
      return { videoUri: url, sourceName: getSourceNameFromUrl(url) };
    }

    const payload = await getBase64FromUrl(url);
    return {
      videoUri: toLtxVideoUri(payload),
      sourceName: getSourceNameFromUrl(url),
    };
  };

  const handleRun = async () => {
    if (apiKeyReady === false) {
      setStatus('Connect your API keys to upscale.');
      return;
    }
    if (mode === 'color-science') {
      const ltxInput = await resolveLtxVideoInput();
      if (!ltxInput) {
        setStatus('Upload or select an SDR video for Color Science Upscale.');
        return;
      }
      setIsRunning(true);
      setStatus('Submitting LTX ACES HDR job...');

      try {
        const item = await upscaleVideoToAcesHdrWithLtx(ltxInput);
        onAddGeneratedMedia(item);
        setGenerated((prev) => [item, ...prev].slice(0, 12));
        setStatus('Color Science Upscale completed. EXR frame archive is ready.');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Color Science Upscale failed.');
      } finally {
        setIsRunning(false);
      }
      return;
    }

    const payload = await resolveInputPayload();
    if (!payload) {
      setStatus('Upload or select an asset to upscale.');
      return;
    }
    setIsRunning(true);
    setStatus('Upscaling...');

    try {
      let item: MediaItem;
      const upscaleOptions = {
        scale: Number.isFinite(scaleValue) ? Math.max(1, Number(scaleValue)) : 4,
        resolution: effectiveResolution || undefined,
      };
      switch (modelId) {
        case 'real-esrgan':
          item = await upscaleImage(payload, upscaleOptions);
          break;
        case 'crystal':
          item = await upscaleImageWithCrystal(payload, upscaleOptions);
          break;
        case 'clarity':
          item = await upscaleImageWithClarity(payload, upscaleOptions);
          break;
        case 'topaz':
          item = await upscaleImageWithTopaz(payload, upscaleOptions);
          break;
        case 'crystal-video':
          item = await upscaleVideoWithCrystal(payload, upscaleOptions);
          break;
        case 'topaz-video':
          item = await upscaleVideoWithTopaz(payload, upscaleOptions);
          break;
        default:
          throw new Error('Unsupported upscale model.');
      }

      const itemWithMeta = {
        ...item,
        generatedBy: `${activeModel.label}${upscaleOptions.scale ? ` • ${upscaleOptions.scale}x` : ''}${upscaleOptions.resolution ? ` • ${upscaleOptions.resolution}` : ''}`,
      };
      onAddGeneratedMedia(itemWithMeta);
      setGenerated((prev) => [itemWithMeta, ...prev].slice(0, 12));
      setStatus('Upscale completed.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upscale failed.');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="studio-workspace p-6 h-full overflow-auto">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="app-panel p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold">Upscale</h2>
                <p className="text-gray-400">Enhance resolution or convert SDR video into HDR color-science assets.</p>
              </div>
              <SparklesIcon className="w-8 h-8 text-indigo-300" />
            </div>

            <div className="inline-flex w-full rounded-lg border border-gray-700 bg-gray-950/70 p-1 text-sm">
              <button
                type="button"
                onClick={() => setMode('resolution')}
                className={`flex-1 rounded-md px-3 py-2 font-medium transition-colors ${mode === 'resolution' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                Resolution Upscale
              </button>
              <button
                type="button"
                onClick={() => setMode('color-science')}
                className={`flex-1 rounded-md px-3 py-2 font-medium transition-colors ${mode === 'color-science' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                Color Science Upscale
              </button>
            </div>

            {mode === 'resolution' ? (
              <>
                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Model</label>
                  <select
                    value={modelId}
                    onChange={(event) => {
                      const next = event.target.value as UpscaleModelId;
                      setModelId(next);
                      const nextKind = MODEL_OPTIONS.find((option) => option.id === next)?.kind || 'image';
                      if (nextKind === 'video' && resolutionPreset === 'auto') {
                        setResolutionPreset('1080p');
                      }
                    }}
                    className="app-select mt-2"
                  >
                    <optgroup label="Image Upscalers">
                      {MODEL_OPTIONS.filter(o => o.kind === 'image').map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Video Upscalers">
                      {MODEL_OPTIONS.filter(o => o.kind === 'video').map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Scale Factor</label>
                    <div className="mt-2 flex items-center gap-3">
                      <input
                        type="range"
                        min={1}
                        max={8}
                        step={0.5}
                        value={scaleValue}
                        onChange={(event) => setScaleValue(Number(event.target.value))}
                        className="flex-1"
                      />
                      <input
                        type="number"
                        min={1}
                        max={8}
                        step={0.5}
                        value={scaleValue}
                        onChange={(event) => setScaleValue(Number(event.target.value) || 4)}
                        className="app-input w-20"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Target Resolution</label>
                    <select
                      value={resolutionPreset}
                      onChange={(event) => setResolutionPreset(event.target.value)}
                      className="app-select mt-2"
                    >
                      <option value="auto">Auto</option>
                      <option value="720p">720p</option>
                      <option value="1080p">1080p</option>
                      <option value="1440p">1440p</option>
                      <option value="2160p">2160p (4K)</option>
                      <option value="custom">Custom...</option>
                    </select>
                    {resolutionPreset === 'custom' && (
                      <input
                        value={customResolution}
                        onChange={(event) => setCustomResolution(event.target.value)}
                        placeholder={isVideoInput ? 'e.g. 1920x1080 or 1080p' : 'e.g. 4096x4096'}
                        className="app-input mt-2"
                      />
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-cyan-700/50 bg-cyan-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">LTX ACES HDR</div>
                    <div className="text-sm font-semibold text-white">EXR frame archive output</div>
                  </div>
                  <span className="text-[10px] uppercase tracking-[0.18em] text-cyan-200 border border-cyan-700 rounded px-2 py-1">Beta</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-3 text-[11px] text-gray-300">
                  <div className="rounded border border-gray-700/70 bg-black/20 p-2">
                    <div className="text-gray-500 uppercase tracking-[0.14em]">Pipeline</div>
                    <div className="mt-1 text-white">SDR to ACES HDR</div>
                  </div>
                  <div className="rounded border border-gray-700/70 bg-black/20 p-2">
                    <div className="text-gray-500 uppercase tracking-[0.14em]">Format</div>
                    <div className="mt-1 text-white">ZIP of EXR frames</div>
                  </div>
                  <div className="rounded border border-gray-700/70 bg-black/20 p-2">
                    <div className="text-gray-500 uppercase tracking-[0.14em]">Max Input</div>
                    <div className="mt-1 text-white">~7s at 1080p</div>
                  </div>
                </div>
                <p className="text-xs text-gray-400">Output preserves the input resolution. 1440p inputs are limited to about 4 seconds, 4K inputs to about 2 seconds.</p>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-gray-400">
                  Input {isVideoInput ? 'Video' : 'Image'}
                </label>
                <div className="mt-2 app-panel p-4 border border-dashed border-gray-600 space-y-3">
                  {previewUrl ? (
                    <>
                      {isVideoInput ? (
                        <video src={previewUrl} controls className="w-full rounded-lg object-cover" />
                      ) : (
                        <img src={previewUrl} alt="Upscale input" className="w-full rounded-lg object-cover" />
                      )}
                      <button
                        type="button"
                        className="app-button app-secondary text-xs"
                        onClick={() => {
                          setInputFile(null);
                          setInputUrl('');
                        }}
                      >
                        Clear input
                      </button>
                    </>
                  ) : (
                    <label className="app-button app-secondary text-xs cursor-pointer inline-flex items-center gap-2">
                      <UploadIcon className="w-4 h-4" />
                      Upload {isVideoInput ? 'video' : 'image'}
                      <input
                        type="file"
                        accept={isVideoInput ? 'video/*' : 'image/*'}
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          setInputFile(file);
                          setInputUrl('');
                          event.currentTarget.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Direct URL</label>
                <input
                  value={inputUrl}
                  onChange={(event) => {
                    setInputUrl(event.target.value);
                    if (event.target.value.trim()) {
                      setInputFile(null);
                    }
                  }}
                  placeholder={isVideoInput ? 'Paste a video URL...' : 'Paste an image URL...'}
                  className="app-input mt-2"
                />
                <p className="text-xs text-gray-500 mt-2">
                  {isVideoInput
                    ? mode === 'color-science'
                      ? 'Use HTTPS video URLs or upload a short SDR source.'
                      : 'Use MP4/WebM URLs for best results.'
                    : 'Use direct image URLs.'}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={handleRun}
                disabled={isRunning || apiKeyReady === false}
                className="app-button app-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRunning
                  ? mode === 'color-science' ? 'Processing HDR...' : 'Upscaling...'
                  : mode === 'color-science' ? 'Run Color Science Upscale' : 'Run Upscaler'}
              </button>
              {status && <p className="text-sm text-gray-300">{status}</p>}
            </div>
          </section>

          <aside className="space-y-4">
            <section className="app-panel p-5 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Latest results</div>
              {latestResults.length === 0 && (
                <div className="text-sm text-gray-500">Upscaled assets will appear here.</div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {latestResults.map((item) => {
                  const archive = isArchiveItem(item);
                  return (
                    <div key={item.id} className="app-card p-2 space-y-2">
                      <div className="aspect-video bg-black/60 rounded-lg overflow-hidden">
                        {item.type === 'video' && !archive ? (
                          <video src={item.url} controls className="w-full h-full object-cover" />
                        ) : item.type === 'image' ? (
                          <img src={item.url} alt={item.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-400">
                            <DownloadIcon className="h-8 w-8" />
                            <span className="text-[10px] uppercase tracking-[0.18em]">EXR ZIP</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-gray-400 truncate">{item.name}</p>
                          {item.generatedBy && <p className="text-[10px] text-indigo-300">{item.generatedBy}</p>}
                        </div>
                        <a href={item.url} download className="app-button app-secondary text-xs">
                          <DownloadIcon className="w-4 h-4" />
                          Download
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="app-panel p-5 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Library assets</div>
              <input
                value={librarySearch}
                onChange={(event) => setLibrarySearch(event.target.value)}
                placeholder="Search library assets..."
                className="app-input"
              />
              {libraryLoading && <p className="text-xs text-gray-500">Loading library assets...</p>}
              {libraryError && <p className="text-xs text-amber-300">{libraryError}</p>}
              <div className="grid gap-3 max-h-[360px] overflow-auto pr-1">
                {filteredLibraryAssets.map((asset) => {
                  const archive = isArchiveItem({ url: asset.url, name: asset.name, generatedBy: asset.generatedBy });
                  return (
                  <div key={asset.id} className="app-card p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-gray-200 truncate">{asset.name}</p>
                        <p className="text-[10px] text-gray-500 truncate">{asset.projectName}</p>
                      </div>
                      {asset.generatedBy && <span className="text-[10px] text-indigo-300">{asset.generatedBy}</span>}
                    </div>
                    {asset.url && asset.kind === 'video' && !archive ? (
                      <div className="aspect-video bg-black/60 rounded-lg overflow-hidden">
                        <video src={asset.url} className="w-full h-full object-cover" />
                      </div>
                    ) : archive ? (
                      <div className="aspect-video bg-gray-900/50 rounded-lg flex flex-col items-center justify-center gap-2 text-[10px] text-gray-500">
                        <DownloadIcon className="w-6 h-6" />
                        EXR ZIP archive
                      </div>
                    ) : asset.url ? (
                      <div className="aspect-video bg-black/60 rounded-lg overflow-hidden">
                        <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="aspect-video bg-gray-900/50 rounded-lg flex items-center justify-center text-[10px] text-gray-500">
                        {asset.kind} asset
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      {asset.url ? (
                        <button
                          className="app-button app-secondary text-xs"
                          onClick={() => {
                            setInputUrl(asset.url || '');
                            setInputFile(null);
                          }}
                        >
                          Use as input
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-500">No URL</span>
                      )}
                      {asset.url && (
                        <a href={asset.url} download className="app-button app-tertiary text-xs">
                          <DownloadIcon className="w-4 h-4" />
                          Download
                        </a>
                      )}
                    </div>
                  </div>
                  );
                })}
                {filteredLibraryAssets.length === 0 && !libraryLoading && (
                  <div className="text-xs text-gray-500 text-center">No compatible assets found.</div>
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default UpscaleWorkspace;
