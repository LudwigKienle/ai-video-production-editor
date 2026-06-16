import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MediaItem,
  SetDesignAsset,
  WorldGenerationEntry,
  WorldGenerationState,
} from '../types';
import {
  generateWorldFromImageFile,
  generateWorldFromImageUrl,
  generateWorldFromText,
  generateWorldFromVideoUrl,
  getWorldAssetUrls,
  hasWorldLabsApiKey,
  MARBLE_MODELS,
  MarbleModel,
} from '../services/worldLabsService';
import {
  getWorldModelGeneratedBy,
  getWorldModelLabel,
  getWorldModelOptionsForProvider,
  normalizeWorldModelId,
} from '../services/worldModelProviderRegistry';
import { MagicWandIcon, MapIcon, UploadIcon } from '../components/icons';

type WorldMode = 'text' | 'image' | 'video';

type WorldGenerationWorkspaceProps = {
  worldGen: WorldGenerationState | null;
  onChange: (next: WorldGenerationState) => void;
  onAddGeneratedMedia?: (item: MediaItem) => void;
  onSendToSetDesign?: (asset: SetDesignAsset) => void;
};

const DEFAULT_WORLD_STATE: WorldGenerationState = { history: [] };

const buildId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `world_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const toDisplayDate = (value?: string) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const inferModelFormat = (value?: string | null) => {
  if (!value) return undefined;
  const clean = value.split('?')[0];
  const ext = clean.split('.').pop()?.toLowerCase() || '';
  if (ext === 'glb' || ext === 'gltf' || ext === 'obj' || ext === 'fbx') {
    return ext;
  }
  return undefined;
};

const WorldGenerationWorkspace: React.FC<WorldGenerationWorkspaceProps> = ({
  worldGen,
  onChange,
  onAddGeneratedMedia,
  onSendToSetDesign,
}) => {
  const [worldState, setWorldState] = useState<WorldGenerationState>(worldGen || DEFAULT_WORLD_STATE);
  const [mode, setMode] = useState<WorldMode>('text');
  const [worldName, setWorldName] = useState('New World');
  const [prompt, setPrompt] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [isPano, setIsPano] = useState(false);
  const [model, setModel] = useState<MarbleModel>(MARBLE_MODELS.PLUS);
  const [status, setStatus] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(() => hasWorldLabsApiKey());
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState<string>('Splat Viewer');
  const worldModelOptions = useMemo(() => getWorldModelOptionsForProvider('worldlabs'), []);

  const emitChange = useCallback((next: WorldGenerationState) => {
    setWorldState(next);
    onChange(next);
  }, [onChange]);

  useEffect(() => {
    setWorldState(worldGen || DEFAULT_WORLD_STATE);
  }, [worldGen]);

  useEffect(() => {
    if (!selectedId && worldState.history.length > 0) {
      setSelectedId(worldState.history[0].id);
    }
  }, [selectedId, worldState.history]);

  const imagePreviewUrl = useMemo(() => {
    if (imageFile) return URL.createObjectURL(imageFile);
    return imageUrl.trim() || null;
  }, [imageFile, imageUrl]);

  useEffect(() => {
    return () => {
      if (imageFile && imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imageFile, imagePreviewUrl]);

  const selectedWorld = worldState.history.find((entry) => entry.id === selectedId) || null;

  const handleGenerate = async () => {
    const keyAvailable = hasWorldLabsApiKey();
    setHasKey(keyAvailable);
    if (!keyAvailable) {
      setStatus('Add your World Labs API key in Settings.');
      return;
    }

    const trimmedPrompt = prompt.trim();
    const trimmedName = worldName.trim() || 'New World';
    const trimmedImageUrl = imageUrl.trim();
    const trimmedVideoUrl = videoUrl.trim();

    if (mode === 'text' && !trimmedPrompt) {
      setStatus('Add a prompt to generate a world.');
      return;
    }
    if (mode === 'image' && !imageFile && !trimmedImageUrl) {
      setStatus('Upload or paste an image URL.');
      return;
    }
    if (mode === 'video' && !trimmedVideoUrl) {
      setStatus('Paste a video URL.');
      return;
    }

    setIsGenerating(true);
    setStatus('Starting world generation...');
    try {
      let world;
      if (mode === 'image') {
        if (imageFile) {
          world = await generateWorldFromImageFile(
            trimmedName,
            imageFile,
            trimmedPrompt || undefined,
            isPano,
            model,
            (msg) => setStatus(msg),
          );
        } else {
          world = await generateWorldFromImageUrl(
            trimmedName,
            trimmedImageUrl,
            trimmedPrompt || undefined,
            isPano,
            model,
            (msg) => setStatus(msg),
          );
        }
      } else if (mode === 'video') {
        world = await generateWorldFromVideoUrl(
          trimmedName,
          trimmedVideoUrl,
          trimmedPrompt || undefined,
          model,
          (msg) => setStatus(msg),
        );
      } else {
        world = await generateWorldFromText(
          trimmedName,
          trimmedPrompt,
          model,
          (msg) => setStatus(msg),
        );
      }

      const assets = getWorldAssetUrls(world);
      const normalizedModel = normalizeWorldModelId(world.model || model);
      const entry: WorldGenerationEntry = {
        id: world.id,
        name: world.display_name || trimmedName,
        provider: 'worldlabs',
        model: normalizedModel,
        createdAt: world.created_at || new Date().toISOString(),
        source: {
          type: mode,
          prompt: trimmedPrompt || undefined,
          imageUrl: mode === 'image' ? (trimmedImageUrl || undefined) : undefined,
          videoUrl: mode === 'video' ? trimmedVideoUrl : undefined,
          isPano: mode === 'image' ? isPano : undefined,
        },
        assets: {
          viewUrl: assets.viewUrl,
          thumbnailUrl: assets.thumbnail,
          panoramaUrl: assets.panorama,
          meshUrl: assets.colliderMesh,
          splat100kUrl: assets.splat100k,
          splat500kUrl: assets.splat500k,
          splatFullResUrl: assets.splatFullRes,
        },
      };

      const nextHistory = [entry, ...worldState.history].slice(0, 50);
      emitChange({ history: nextHistory });
      setSelectedId(entry.id);
      setStatus('World ready.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'World generation failed.';
      setStatus(message);
      if (message.toLowerCase().includes('api key')) {
        setHasKey(false);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const addAssetToLibrary = useCallback((label: string, url?: string | null, type: MediaItem['type'] = 'image') => {
    if (!url || !onAddGeneratedMedia) return false;
    const item: MediaItem = {
      id: buildId(),
      name: label,
      type,
      url,
      source: 'generated',
      generatedBy: getWorldModelGeneratedBy(selectedWorld?.model || model),
    };
    onAddGeneratedMedia(item);
    return true;
  }, [model, onAddGeneratedMedia, selectedWorld?.model]);

  const handleSaveAllAssets = () => {
    if (!selectedWorld) return;
    const saved = [
      addAssetToLibrary(`${selectedWorld.name}_mesh.glb`, selectedWorld.assets.meshUrl || null),
      addAssetToLibrary(`${selectedWorld.name}_panorama.jpg`, selectedWorld.assets.panoramaUrl || null),
      addAssetToLibrary(`${selectedWorld.name}_thumbnail.jpg`, selectedWorld.assets.thumbnailUrl || null),
      addAssetToLibrary(`${selectedWorld.name}_splat_full.spz`, selectedWorld.assets.splatFullResUrl || null),
    ].some(Boolean);
    if (!saved) {
      setStatus('No downloadable assets found for this world.');
      return;
    }
    setStatus('Assets saved to Library.');
  };

  const handleSendToSetDesign = () => {
    if (!selectedWorld?.assets.meshUrl || !onSendToSetDesign) {
      setStatus('No mesh available to send to Set Design.');
      return;
    }
    onSendToSetDesign({
      id: buildId(),
      name: `${selectedWorld.name} Mesh`,
      kind: 'model',
      format: inferModelFormat(selectedWorld.assets.meshUrl) || 'glb',
      url: selectedWorld.assets.meshUrl,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    setStatus('Mesh sent to Set Design.');
  };

  const handleOpenViewer = (url?: string | null, title?: string) => {
    if (!url) {
      setStatus('Viewer URL not available for this world.');
      return;
    }
    setViewerTitle(title || 'Splat Viewer');
    setViewerUrl(url);
  };

  return (
    <div className="studio-workspace p-6 h-full overflow-auto">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">World Generation</h2>
            <p className="text-gray-400">Generate explorable environments with World Model providers, manage results, and save assets.</p>
          </div>
          <MapIcon className="w-8 h-8 text-indigo-300" />
        </div>

        {!hasKey && (
          <div className="app-panel p-3 text-sm text-amber-200 border border-amber-400/40 bg-amber-400/10">
            Add your World Labs API key in Settings to generate worlds.
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="app-panel p-6 space-y-5">
            <div className="flex flex-wrap gap-2">
              {(['text', 'image', 'video'] as WorldMode[]).map((value) => (
                <button
                  key={value}
                  className={`app-button text-xs ${mode === value ? 'app-primary' : 'app-secondary'}`}
                  onClick={() => setMode(value)}
                >
                  {value}
                </button>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-gray-400">World Name</label>
                <input
                  className="app-input mt-2"
                  value={worldName}
                  onChange={(event) => setWorldName(event.target.value)}
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-gray-400">World Model</label>
                <select
                  className="app-select mt-2"
                  value={model}
                  onChange={(event) => setModel(event.target.value as MarbleModel)}
                >
                  {worldModelOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Prompt</label>
              <textarea
                className="app-textarea mt-2 h-28"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe the world, atmosphere, and key landmarks..."
              />
            </div>

            {mode === 'image' && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="app-panel p-4 border border-dashed border-gray-600 space-y-3">
                  <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Image Input</label>
                  {imagePreviewUrl ? (
                    <img src={imagePreviewUrl} alt="World input" className="w-full rounded-lg object-cover" />
                  ) : (
                    <p className="text-xs text-gray-500">Upload an image or paste a URL.</p>
                  )}
                  <label className="app-button app-secondary text-xs cursor-pointer inline-flex items-center gap-2">
                    <UploadIcon className="w-4 h-4" />
                    Upload Image
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0] || null;
                        setImageFile(file);
                        if (file) setImageUrl('');
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                  <input
                    className="app-input text-xs"
                    value={imageUrl}
                    onChange={(event) => {
                      setImageUrl(event.target.value);
                      if (event.target.value) setImageFile(null);
                    }}
                    placeholder="https://..."
                  />
                  <label className="flex items-center gap-2 text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={isPano}
                      onChange={(event) => setIsPano(event.target.checked)}
                    />
                    Image is 360° panorama
                  </label>
                </div>
              </div>
            )}

            {mode === 'video' && (
              <div className="app-panel p-4 border border-dashed border-gray-600 space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Video URL</label>
                <input
                  className="app-input"
                  value={videoUrl}
                  onChange={(event) => setVideoUrl(event.target.value)}
                  placeholder="https://..."
                />
                <p className="text-[10px] text-gray-500">Video uploads are not supported yet, use a URL.</p>
              </div>
            )}

            <button
              className="app-button app-primary text-sm w-full"
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              <MagicWandIcon className="w-4 h-4" />
              {isGenerating ? 'Generating World...' : 'Generate World'}
            </button>

            {status && <p className="text-xs text-gray-400">{status}</p>}
          </section>

          <aside className="space-y-4">
            <section className="app-panel p-4 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">World History</div>
              {worldState.history.length === 0 && (
                <p className="text-xs text-gray-500">No worlds generated yet.</p>
              )}
              <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
                {worldState.history.map((entry) => (
                  <button
                    key={entry.id}
                    className={`w-full flex items-center gap-3 text-left p-3 rounded-lg border ${entry.id === selectedId ? 'border-indigo-400 bg-indigo-900/30' : 'border-gray-700 bg-gray-800/60'}`}
                    onClick={() => setSelectedId(entry.id)}
                  >
                    {entry.assets.thumbnailUrl ? (
                      <img
                        src={entry.assets.thumbnailUrl}
                        alt={entry.name}
                        className="w-12 h-12 rounded-md object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-md bg-gray-700" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs text-gray-100 truncate">{entry.name}</p>
                      <p className="text-[10px] text-gray-500">{getWorldModelLabel(entry.model)}</p>
                      <p className="text-[10px] text-gray-500">{toDisplayDate(entry.createdAt)}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="app-panel p-4 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Selected World</div>
              {!selectedWorld && <p className="text-xs text-gray-500">Select a world to manage assets.</p>}
              {selectedWorld && (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-gray-100">{selectedWorld.name}</p>
                    <p className="text-[10px] text-gray-500">{getWorldModelLabel(selectedWorld.model)}</p>
                  </div>
                  {selectedWorld.assets.thumbnailUrl && (
                    <img
                      src={selectedWorld.assets.thumbnailUrl}
                      alt={selectedWorld.name}
                      className="w-full rounded-lg object-cover"
                    />
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className="app-button app-secondary text-xs"
                      onClick={() => {
                        handleOpenViewer(selectedWorld.assets.viewUrl, selectedWorld.name);
                      }}
                    >
                      Open Viewer (In-App)
                    </button>
                    <button
                      className="app-button app-tertiary text-xs"
                      onClick={handleSaveAllAssets}
                    >
                      Save All Assets
                    </button>
                  </div>
                  <button
                    className="app-button app-secondary text-xs w-full"
                    onClick={() => {
                      if (selectedWorld.assets.viewUrl) {
                        window.open(selectedWorld.assets.viewUrl, '_blank');
                      }
                    }}
                    disabled={!selectedWorld.assets.viewUrl}
                  >
                    Open Viewer (New Tab)
                  </button>
                  <div className="space-y-2">
                    <button
                      className="app-button app-primary text-xs w-full"
                      onClick={handleSendToSetDesign}
                      disabled={!selectedWorld.assets.meshUrl || !onSendToSetDesign}
                    >
                      Add Mesh to Set Design
                    </button>
                    <button
                      className="app-button app-secondary text-xs w-full"
                      onClick={() => addAssetToLibrary(`${selectedWorld.name}_mesh.glb`, selectedWorld.assets.meshUrl || null)}
                    >
                      Save Mesh (GLB)
                    </button>
                    <button
                      className="app-button app-tertiary text-xs w-full"
                      onClick={() => {
                        if (selectedWorld.assets.meshUrl) {
                          window.open(selectedWorld.assets.meshUrl, '_blank');
                        }
                      }}
                      disabled={!selectedWorld.assets.meshUrl}
                    >
                      Download Mesh (GLB)
                    </button>
                    <button
                      className="app-button app-secondary text-xs w-full"
                      onClick={() => addAssetToLibrary(`${selectedWorld.name}_splat_full.spz`, selectedWorld.assets.splatFullResUrl || null)}
                      disabled={!selectedWorld.assets.splatFullResUrl}
                    >
                      Save Splat (Full)
                    </button>
                    <button
                      className="app-button app-tertiary text-xs w-full"
                      onClick={() => {
                        if (selectedWorld.assets.splatFullResUrl) {
                          window.open(selectedWorld.assets.splatFullResUrl, '_blank');
                        }
                      }}
                      disabled={!selectedWorld.assets.splatFullResUrl}
                    >
                      Download Splat (Full)
                    </button>
                    <button
                      className="app-button app-secondary text-xs w-full"
                      onClick={() => addAssetToLibrary(`${selectedWorld.name}_panorama.jpg`, selectedWorld.assets.panoramaUrl || null)}
                    >
                      Save Panorama
                    </button>
                    <button
                      className="app-button app-secondary text-xs w-full"
                      onClick={() => addAssetToLibrary(`${selectedWorld.name}_thumbnail.jpg`, selectedWorld.assets.thumbnailUrl || null)}
                    >
                      Save Thumbnail
                    </button>
                  </div>
                  {!selectedWorld.assets.meshUrl && selectedWorld.assets.splatFullResUrl && (
                    <div className="app-panel p-3 border border-gray-700/60 text-[10px] text-gray-400 space-y-2">
                      <p>Mesh conversion is not available in the World Labs API yet.</p>
                      <button className="app-button app-tertiary text-[10px] w-full" disabled>
                        Convert Splat → Mesh (Coming soon)
                      </button>
                    </div>
                  )}
                  <div className="text-[10px] text-gray-500 space-y-1">
                    {selectedWorld.assets.splatFullResUrl && (
                      <p className="truncate">Splat full: {selectedWorld.assets.splatFullResUrl}</p>
                    )}
                    {selectedWorld.assets.splat500kUrl && (
                      <p className="truncate">Splat 500k: {selectedWorld.assets.splat500kUrl}</p>
                    )}
                    {selectedWorld.assets.splat100kUrl && (
                      <p className="truncate">Splat 100k: {selectedWorld.assets.splat100kUrl}</p>
                    )}
                  </div>
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>

      {viewerUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-800 flex items-center justify-between">
              <div className="text-sm font-semibold text-white">{viewerTitle}</div>
              <button onClick={() => setViewerUrl(null)} className="text-gray-400 hover:text-white text-xl font-bold">&times;</button>
            </div>
            <div className="p-4 flex-1 overflow-auto bg-black/70">
              <iframe
                title={viewerTitle}
                src={viewerUrl}
                className="w-full h-[70vh] rounded-lg border border-gray-800"
              />
              <p className="text-[10px] text-gray-500 mt-3">
                If the viewer blocks embedding, use "Open Viewer (New Tab)".
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorldGenerationWorkspace;
