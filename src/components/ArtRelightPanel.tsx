import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  getSurfaceMapStatus,
  runSurfaceMap,
  setupSurfaceMapEnvironment,
  type SurfaceMapPayload,
  type SurfaceMapResult,
  type SurfaceMapStatus,
} from '../services/surfaceMapService';
import type { MediaItem } from '../types';
import { fileToBase64, getBase64FromUrl } from '../utils/helpers';
import {
  DEFAULT_ART_RELIGHT_SETTINGS,
  normalizeArtRelightSettings,
  relightPixelBuffer,
  type ArtRelightBlendMode,
  type ArtRelightSettings,
  type ArtRelightPixelBuffer,
  type ArtRelightSurfaceMode,
} from '../utils/artRelight';
import {
  DownloadIcon,
  FolderIcon,
  ImageIcon,
  MagicWandIcon,
  SettingsIcon,
  SparklesIcon,
  UploadIcon,
} from './icons';

type ArtRelightPanelProps = {
  mediaItems: MediaItem[];
  onAddGeneratedMedia: (item: MediaItem) => void;
  currentProjectPath?: string | null;
};

type SourceMode = 'none' | 'file' | 'media';
type SurfaceSourceMode = SourceMode | 'generated';

type ArtRelightPreset = {
  id: string;
  label: string;
  settings: Partial<ArtRelightSettings>;
};

const PREVIEW_MAX_SIZE = 1600;
const SURFACE_MAP_REPO_STORAGE_KEY = 'ai-video-studio:surface-map-repo-path';

const artRelightPresets: ArtRelightPreset[] = [
  {
    id: 'key-left',
    label: 'Key Left',
    settings: { lightX: 0.18, lightY: 0.34, radius: 0.72, intensity: 1.45, warmth: 18, blendMode: 'screen' },
  },
  {
    id: 'rim',
    label: 'Rim',
    settings: { lightX: 0.86, lightY: 0.28, radius: 0.45, intensity: 2.1, ambient: 0.06, warmth: -18, blendMode: 'add' },
  },
  {
    id: 'top-soft',
    label: 'Top Soft',
    settings: { lightX: 0.5, lightY: 0.08, height: 0.72, radius: 1.08, intensity: 1.05, ambient: 0.18, warmth: 8 },
  },
  {
    id: 'neon',
    label: 'Neon',
    settings: { lightX: 0.2, lightY: 0.62, radius: 0.42, intensity: 2.65, ambient: 0.02, warmth: -72, blendMode: 'screen' },
  },
];

const loadCanvasImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image could not be loaded for relighting.'));
    image.src = url;
  });

const resolveCanvasSize = (image: HTMLImageElement, maxSize: number) => {
  const sourceWidth = image.naturalWidth || image.width || 1;
  const sourceHeight = image.naturalHeight || image.height || 1;
  const scale = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
};

const drawImageToPixelBuffer = (
  image: HTMLImageElement,
  width: number,
  height: number,
): ArtRelightPixelBuffer => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available.');
  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return {
    width,
    height,
    data: new Uint8ClampedArray(imageData.data),
  };
};

const renderRelightCanvas = (
  image: HTMLImageElement,
  settings: ArtRelightSettings,
  surfaceMode: ArtRelightSurfaceMode,
  surfaceImage: HTMLImageElement | null,
  maxSize = PREVIEW_MAX_SIZE,
) => {
  const { width, height } = resolveCanvasSize(image, maxSize);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available.');

  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const surface = surfaceImage && surfaceMode !== 'source'
    ? drawImageToPixelBuffer(surfaceImage, width, height)
    : null;
  const relit = relightPixelBuffer({
    width,
    height,
    data: imageData.data,
  }, settings, {
    surface,
    surfaceMode,
  });
  imageData.data.set(relit.data);
  ctx.putImageData(imageData, 0, 0);

  return canvas;
};

const formatNumber = (value: number, decimals = 2) => value.toFixed(decimals);

const ArtRelightPanel: React.FC<ArtRelightPanelProps> = ({
  mediaItems,
  onAddGeneratedMedia,
  currentProjectPath,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasDesktopSurfaceMaps = typeof window !== 'undefined' && Boolean(window.electron?.surfaceMaps);
  const [sourceMode, setSourceMode] = useState<SourceMode>('none');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceMediaId, setSourceMediaId] = useState('');
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [surfaceMode, setSurfaceMode] = useState<ArtRelightSurfaceMode>('source');
  const [surfaceSourceMode, setSurfaceSourceMode] = useState<SurfaceSourceMode>('none');
  const [surfaceFile, setSurfaceFile] = useState<File | null>(null);
  const [surfaceMediaId, setSurfaceMediaId] = useState('');
  const [generatedSurfaceGuide, setGeneratedSurfaceGuide] = useState<MediaItem | null>(null);
  const [surfaceImage, setSurfaceImage] = useState<HTMLImageElement | null>(null);
  const [settings, setSettings] = useState<ArtRelightSettings>(() => DEFAULT_ART_RELIGHT_SETTINGS);
  const [status, setStatus] = useState<string | null>(null);
  const [surfaceMapRepoPath, setSurfaceMapRepoPath] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(SURFACE_MAP_REPO_STORAGE_KEY) || '';
  });
  const [surfaceMapStatus, setSurfaceMapStatus] = useState<SurfaceMapStatus | null>(null);
  const [surfaceMapEncoder, setSurfaceMapEncoder] = useState<'vits' | 'vitb' | 'vitl'>('vits');
  const [surfaceMapInputSize, setSurfaceMapInputSize] = useState(518);
  const [surfaceMapNormalStrength, setSurfaceMapNormalStrength] = useState(2);
  const [isSurfaceMapPreparing, setIsSurfaceMapPreparing] = useState(false);
  const [isSurfaceMapRunning, setIsSurfaceMapRunning] = useState(false);
  const [result, setResult] = useState<MediaItem | null>(null);

  const imageMediaItems = useMemo(() => mediaItems.filter((item) => item.type === 'image'), [mediaItems]);
  const selectedMedia = imageMediaItems.find((item) => item.id === sourceMediaId) || null;
  const selectedSurfaceMedia = imageMediaItems.find((item) => item.id === surfaceMediaId) || null;

  const sourceObjectUrl = useMemo(() => {
    if (sourceMode === 'file' && sourceFile) {
      return URL.createObjectURL(sourceFile);
    }
    return null;
  }, [sourceFile, sourceMode]);

  useEffect(() => {
    return () => {
      if (sourceObjectUrl) {
        URL.revokeObjectURL(sourceObjectUrl);
      }
    };
  }, [sourceObjectUrl]);

  const surfaceObjectUrl = useMemo(() => {
    if (surfaceSourceMode === 'file' && surfaceFile) {
      return URL.createObjectURL(surfaceFile);
    }
    return null;
  }, [surfaceFile, surfaceSourceMode]);

  useEffect(() => {
    return () => {
      if (surfaceObjectUrl) {
        URL.revokeObjectURL(surfaceObjectUrl);
      }
    };
  }, [surfaceObjectUrl]);

  const sourceUrl = sourceMode === 'media' ? selectedMedia?.url || null : sourceObjectUrl;
  const surfaceUrl = surfaceSourceMode === 'generated'
    ? generatedSurfaceGuide?.url || null
    : surfaceSourceMode === 'media'
      ? selectedSurfaceMedia?.url || null
      : surfaceObjectUrl;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (surfaceMapRepoPath) {
      window.localStorage.setItem(SURFACE_MAP_REPO_STORAGE_KEY, surfaceMapRepoPath);
    } else {
      window.localStorage.removeItem(SURFACE_MAP_REPO_STORAGE_KEY);
    }
  }, [surfaceMapRepoPath]);

  useEffect(() => {
    if (!hasDesktopSurfaceMaps) return;
    let isActive = true;
    getSurfaceMapStatus(surfaceMapRepoPath || null)
      .then((nextStatus) => {
        if (isActive) {
          setSurfaceMapStatus(nextStatus);
        }
      })
      .catch((error) => {
        if (isActive) {
          setSurfaceMapStatus({
            ready: false,
            available: false,
            error: error instanceof Error ? error.message : 'Surface map status failed.',
          });
        }
      });

    return () => {
      isActive = false;
    };
  }, [hasDesktopSurfaceMaps, surfaceMapRepoPath]);

  useEffect(() => {
    if (!sourceUrl) {
      setSourceImage(null);
      return;
    }

    let isActive = true;
    loadCanvasImage(sourceUrl)
      .then((image) => {
        if (!isActive) return;
        setSourceImage(image);
        setStatus(null);
      })
      .catch((error) => {
        if (!isActive) return;
        setSourceImage(null);
        setStatus(error instanceof Error ? error.message : 'Relight source could not be loaded.');
      });

    return () => {
      isActive = false;
    };
  }, [sourceUrl]);

  useEffect(() => {
    if (!surfaceUrl) {
      setSurfaceImage(null);
      return;
    }

    let isActive = true;
    loadCanvasImage(surfaceUrl)
      .then((image) => {
        if (!isActive) return;
        setSurfaceImage(image);
        setStatus(null);
      })
      .catch((error) => {
        if (!isActive) return;
        setSurfaceImage(null);
        setStatus(error instanceof Error ? error.message : 'Surface guide could not be loaded.');
      });

    return () => {
      isActive = false;
    };
  }, [surfaceUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceImage) {
      return;
    }

    try {
      const rendered = renderRelightCanvas(sourceImage, settings, surfaceMode, surfaceImage);
      canvas.width = rendered.width;
      canvas.height = rendered.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not available.');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(rendered, 0, 0);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Relight preview failed.');
    }
  }, [settings, sourceImage, surfaceImage, surfaceMode]);

  const updateSettings = (patch: Partial<ArtRelightSettings>) => {
    setSettings((prev) => normalizeArtRelightSettings({ ...prev, ...patch }));
  };

  const updateLightPositionFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!sourceImage) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    updateSettings({
      lightX: (event.clientX - rect.left) / rect.width,
      lightY: (event.clientY - rect.top) / rect.height,
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateLightPositionFromPointer(event);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1) return;
    updateLightPositionFromPointer(event);
  };

  const resetSettings = () => {
    setSettings(DEFAULT_ART_RELIGHT_SETTINGS);
    setStatus('Relight reset.');
  };

  const getImagePayloadFromUrl = async (url: string, name: string): Promise<SurfaceMapPayload> => {
    const payload = await getBase64FromUrl(url);
    return {
      base64: payload.base64,
      mimeType: payload.mimeType || 'image/png',
      name,
    };
  };

  const resolveSourcePayload = async (): Promise<SurfaceMapPayload | null> => {
    if (sourceMode === 'file' && sourceFile) {
      return {
        base64: await fileToBase64(sourceFile),
        mimeType: sourceFile.type || 'image/png',
        name: sourceFile.name || 'source.png',
      };
    }
    if (sourceMode === 'media' && selectedMedia?.url) {
      return getImagePayloadFromUrl(selectedMedia.url, selectedMedia.name || 'source.png');
    }
    return null;
  };

  const resolveSurfacePayload = async (): Promise<SurfaceMapPayload | null> => {
    if (surfaceSourceMode === 'file' && surfaceFile) {
      return {
        base64: await fileToBase64(surfaceFile),
        mimeType: surfaceFile.type || 'image/png',
        name: surfaceFile.name || 'surface.png',
      };
    }
    if (surfaceSourceMode === 'media' && selectedSurfaceMedia?.url) {
      return getImagePayloadFromUrl(selectedSurfaceMedia.url, selectedSurfaceMedia.name || 'surface.png');
    }
    if (surfaceSourceMode === 'generated' && generatedSurfaceGuide?.url) {
      return getImagePayloadFromUrl(generatedSurfaceGuide.url, generatedSurfaceGuide.name || 'surface.png');
    }
    return null;
  };

  const addSurfaceMapToProject = (
    surfaceMapResult: SurfaceMapResult,
    nextSurfaceMode: ArtRelightSurfaceMode,
    label: string,
  ) => {
    const item: MediaItem = {
      id: `surface-map-${nextSurfaceMode}-${Date.now()}`,
      name: surfaceMapResult.outputName,
      type: 'image',
      url: surfaceMapResult.url,
      source: 'generated',
      generatedBy: label,
      prompt: `${surfaceMapResult.engine}; ${surfaceMapResult.kind} guide for Local Art Relight`,
      originProjectPath: currentProjectPath || null,
    };

    onAddGeneratedMedia(item);
    setGeneratedSurfaceGuide(item);
    setSurfaceFile(null);
    setSurfaceMediaId('');
    setSurfaceSourceMode('generated');
    setSurfaceMode(nextSurfaceMode);
    setStatus(`${nextSurfaceMode === 'depth' ? 'Depth' : 'Normal'} guide added to your project.`);
  };

  const handleSelectSurfaceMapRepo = async () => {
    const folderPath = await window.electron.project.selectFolder();
    if (!folderPath) return;
    setSurfaceMapRepoPath(folderPath);
    setStatus('Depth Anything V2 folder selected.');
  };

  const handlePrepareSurfaceMapRepo = async () => {
    if (!hasDesktopSurfaceMaps) {
      setStatus('Surface maps are available in the desktop app.');
      return;
    }
    if (!surfaceMapRepoPath.trim()) {
      setStatus('Select a Depth Anything V2 checkout first.');
      return;
    }

    setIsSurfaceMapPreparing(true);
    setStatus('Preparing Depth Anything V2 environment...');
    try {
      const nextStatus = await setupSurfaceMapEnvironment(surfaceMapRepoPath);
      setSurfaceMapStatus(nextStatus);
      setStatus(nextStatus.ready ? 'Depth Anything V2 is ready.' : nextStatus.error || 'Depth Anything V2 is not ready yet.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Depth Anything V2 setup failed.');
    } finally {
      setIsSurfaceMapPreparing(false);
    }
  };

  const handleGenerateDepthGuide = async () => {
    if (!hasDesktopSurfaceMaps) {
      setStatus('Surface maps are available in the desktop app.');
      return;
    }
    if (!surfaceMapRepoPath.trim()) {
      setStatus('Select a Depth Anything V2 checkout first.');
      return;
    }

    const source = await resolveSourcePayload();
    if (!source) {
      setStatus('Select an image first.');
      return;
    }

    setIsSurfaceMapRunning(true);
    setStatus('Generating depth guide...');
    try {
      const depthResult = await runSurfaceMap({
        repoPath: surfaceMapRepoPath,
        projectPath: currentProjectPath || null,
        source,
        options: {
          kind: 'depth',
          engine: 'depth-anything-v2',
          encoder: surfaceMapEncoder,
          inputSize: surfaceMapInputSize,
        },
      });
      addSurfaceMapToProject(depthResult, 'depth', 'Depth Anything V2 Surface Map');
      setSurfaceMapStatus(await getSurfaceMapStatus(surfaceMapRepoPath));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Depth guide generation failed.');
    } finally {
      setIsSurfaceMapRunning(false);
    }
  };

  const handleGenerateNormalGuide = async () => {
    if (!hasDesktopSurfaceMaps) {
      setStatus('Surface maps are available in the desktop app.');
      return;
    }
    if (surfaceMode !== 'depth' || !surfaceUrl) {
      setStatus('Select or generate a depth guide first.');
      return;
    }

    const source = await resolveSurfacePayload();
    if (!source) {
      setStatus('Depth guide could not be read.');
      return;
    }

    setIsSurfaceMapRunning(true);
    setStatus('Generating normal guide...');
    try {
      const normalResult = await runSurfaceMap({
        repoPath: surfaceMapRepoPath || null,
        projectPath: currentProjectPath || null,
        source,
        options: {
          kind: 'normal',
          engine: 'depth-gradient',
          normalStrength: surfaceMapNormalStrength,
        },
      });
      addSurfaceMapToProject(normalResult, 'normal', 'Local Depth Gradient Normal Map');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Normal guide generation failed.');
    } finally {
      setIsSurfaceMapRunning(false);
    }
  };

  const handleExport = () => {
    if (!sourceImage) {
      setStatus('Select an image first.');
      return;
    }

    try {
      const canvas = renderRelightCanvas(sourceImage, settings, surfaceMode, surfaceImage);
      const url = canvas.toDataURL('image/png');
      const item: MediaItem = {
        id: `art-relight-${Date.now()}`,
        name: `art_relight_${Date.now()}.png`,
        type: 'image',
        url,
        source: 'generated',
        generatedBy: 'Local Art Relight',
        prompt: `Light ${formatNumber(settings.lightX)},${formatNumber(settings.lightY)}; intensity ${formatNumber(settings.intensity)}; radius ${formatNumber(settings.radius)}; blend ${settings.blendMode}; surface ${surfaceMode}`,
        originProjectPath: currentProjectPath || null,
      };
      setResult(item);
      onAddGeneratedMedia(item);
      setStatus('Relight added to your project.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Relight export failed.');
    }
  };

  const renderSlider = (
    label: string,
    key: keyof ArtRelightSettings,
    min: number,
    max: number,
    step: number,
    decimals = 2,
  ) => (
    <label className="space-y-2">
      <div className="flex items-center justify-between text-[11px] text-gray-300">
        <span>{label}</span>
        <span>{formatNumber(Number(settings[key]), decimals)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number(settings[key])}
        onChange={(event) => updateSettings({ [key]: Number(event.target.value) } as Partial<ArtRelightSettings>)}
        className="w-full"
      />
    </label>
  );

  return (
    <section className="app-panel p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Local Art Relight</div>
          <h3 className="mt-1 text-lg font-semibold text-[var(--app-text)]">2.5D Light Pass</h3>
        </div>
        <MagicWandIcon className="w-6 h-6 text-indigo-300" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-2">
              <span className="flex items-center gap-2 text-sm text-gray-300">
                <UploadIcon className="w-4 h-4" /> Upload
              </span>
              <input
                type="file"
                accept="image/*"
                className="app-input-file"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] || null;
                  setSourceFile(nextFile);
                  setSourceMediaId('');
                  setSourceMode(nextFile ? 'file' : 'none');
                  setResult(null);
                }}
              />
            </label>
            <label className="space-y-2">
              <span className="flex items-center gap-2 text-sm text-gray-300">
                <ImageIcon className="w-4 h-4" /> Project Image
              </span>
              <select
                value={sourceMediaId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setSourceMediaId(nextId);
                  setSourceFile(null);
                  setSourceMode(nextId ? 'media' : 'none');
                  setResult(null);
                }}
                className="app-select"
              >
                <option value="">Select from project images...</option>
                {imageMediaItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-lg border border-gray-700/60 bg-gray-900/30 p-3 space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Surface Mode</span>
                <select
                  value={surfaceMode}
                  onChange={(event) => setSurfaceMode(event.target.value as ArtRelightSurfaceMode)}
                  className="app-select"
                >
                  <option value="source">Source Luma</option>
                  <option value="depth">Depth Map</option>
                  <option value="normal">Normal Map</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-gray-400">
                  <UploadIcon className="w-3.5 h-3.5" /> Guide
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="app-input-file"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] || null;
                    setSurfaceFile(nextFile);
                    setSurfaceMediaId('');
                    setGeneratedSurfaceGuide(null);
                    setSurfaceSourceMode(nextFile ? 'file' : 'none');
                    if (nextFile && surfaceMode === 'source') {
                      setSurfaceMode('depth');
                    }
                  }}
                />
              </label>
              <label className="space-y-2">
                <span className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-gray-400">
                  <ImageIcon className="w-3.5 h-3.5" /> Project Guide
                </span>
                <select
                  value={surfaceMediaId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setSurfaceMediaId(nextId);
                    setSurfaceFile(null);
                    setGeneratedSurfaceGuide(null);
                    setSurfaceSourceMode(nextId ? 'media' : 'none');
                    if (nextId && surfaceMode === 'source') {
                      setSurfaceMode('depth');
                    }
                  }}
                  className="app-select"
                >
                  <option value="">Select guide...</option>
                  {imageMediaItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {surfaceUrl && (
              <div className="flex items-center gap-3">
                <div className="h-16 w-28 overflow-hidden rounded-md bg-black/70">
                  <img src={surfaceUrl} alt="Surface guide preview" className="h-full w-full object-cover" />
                </div>
                <button
                  type="button"
                  className="app-button app-secondary text-xs"
                  onClick={() => {
                    setSurfaceFile(null);
                    setSurfaceMediaId('');
                    setGeneratedSurfaceGuide(null);
                    setSurfaceSourceMode('none');
                    setSurfaceImage(null);
                    setSurfaceMode('source');
                  }}
                >
                  Clear Guide
                </button>
              </div>
            )}

            <div className="border-t border-gray-700/60 pt-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-gray-400">
                  <SparklesIcon className="h-3.5 w-3.5" /> Surface Maps
                </span>
                <span className="text-[11px] text-gray-400">
                  {surfaceMapStatus?.ready
                    ? 'Depth ready'
                    : surfaceMapStatus?.depthGradientReady
                      ? 'Normals ready'
                      : hasDesktopSurfaceMaps
                        ? 'Desktop'
                        : 'Desktop only'}
                </span>
              </div>

              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                <input
                  value={surfaceMapRepoPath}
                  readOnly
                  placeholder="Depth Anything V2 repo..."
                  className="app-input text-xs"
                />
                <button
                  type="button"
                  className="app-button app-secondary text-xs inline-flex items-center justify-center gap-2"
                  onClick={handleSelectSurfaceMapRepo}
                  disabled={!hasDesktopSurfaceMaps}
                >
                  <FolderIcon className="h-3.5 w-3.5" />
                  Repo
                </button>
                <button
                  type="button"
                  className="app-button app-secondary text-xs inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handlePrepareSurfaceMapRepo}
                  disabled={!hasDesktopSurfaceMaps || !surfaceMapRepoPath.trim() || isSurfaceMapPreparing}
                >
                  <SettingsIcon className="h-3.5 w-3.5" />
                  {isSurfaceMapPreparing ? 'Setup...' : 'Setup'}
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Encoder</span>
                  <select
                    value={surfaceMapEncoder}
                    onChange={(event) => setSurfaceMapEncoder(event.target.value as 'vits' | 'vitb' | 'vitl')}
                    className="app-select text-xs"
                  >
                    <option value="vits">ViT-S</option>
                    <option value="vitb">ViT-B</option>
                    <option value="vitl">ViT-L</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Input</span>
                  <select
                    value={surfaceMapInputSize}
                    onChange={(event) => setSurfaceMapInputSize(Number(event.target.value))}
                    className="app-select text-xs"
                  >
                    <option value={518}>518</option>
                    <option value={756}>756</option>
                    <option value={1024}>1024</option>
                    <option value={1536}>1536</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-gray-400">
                    <span>Normal</span>
                    <span>{formatNumber(surfaceMapNormalStrength, 1)}</span>
                  </span>
                  <input
                    type="range"
                    min={0.5}
                    max={8}
                    step={0.1}
                    value={surfaceMapNormalStrength}
                    onChange={(event) => setSurfaceMapNormalStrength(Number(event.target.value))}
                    className="w-full"
                  />
                </label>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <button
                  type="button"
                  className="app-button app-secondary text-xs inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleGenerateDepthGuide}
                  disabled={!hasDesktopSurfaceMaps || !sourceImage || !surfaceMapRepoPath.trim() || isSurfaceMapRunning}
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  {isSurfaceMapRunning ? 'Working...' : 'Generate Depth'}
                </button>
                <button
                  type="button"
                  className="app-button app-secondary text-xs inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleGenerateNormalGuide}
                  disabled={!hasDesktopSurfaceMaps || surfaceMode !== 'depth' || !surfaceUrl || isSurfaceMapRunning}
                >
                  <SparklesIcon className="h-3.5 w-3.5" />
                  Generate Normal
                </button>
              </div>
            </div>
          </div>

          <div
            className="relative overflow-hidden rounded-lg border border-gray-700/60 bg-black/70"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
          >
            {sourceImage ? (
              <>
                <canvas ref={canvasRef} className="block w-full h-auto cursor-crosshair" />
                <div
                  className="pointer-events-none absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 bg-indigo-300/20 shadow-[0_0_28px_rgba(129,140,248,0.8)]"
                  style={{ left: `${settings.lightX * 100}%`, top: `${settings.lightY * 100}%` }}
                >
                  <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
                </div>
              </>
            ) : (
              <div className="flex aspect-video items-center justify-center text-sm text-gray-500">
                Select an image
              </div>
            )}
          </div>

          {result && (
            <div className="app-card p-2">
              <img src={result.url} alt="Relight result" className="w-full rounded-lg" />
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {artRelightPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="app-button app-secondary text-xs flex items-center justify-center gap-2"
                onClick={() => updateSettings(preset.settings)}
              >
                <SparklesIcon className="h-3.5 w-3.5" />
                {preset.label}
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {renderSlider('Light X', 'lightX', 0, 1, 0.01)}
            {renderSlider('Light Y', 'lightY', 0, 1, 0.01)}
            {renderSlider('Height', 'height', 0.05, 2, 0.01)}
            {renderSlider('Radius', 'radius', 0.05, 2, 0.01)}
            {renderSlider('Intensity', 'intensity', 0, 4, 0.01)}
            {renderSlider('Ambient', 'ambient', 0, 1, 0.01)}
            {renderSlider('Surface', 'surfaceStrength', 0, 6, 0.05)}
            {renderSlider('Warmth', 'warmth', -100, 100, 1, 0)}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Blend</span>
              <select
                value={settings.blendMode}
                onChange={(event) => updateSettings({ blendMode: event.target.value as ArtRelightBlendMode })}
                className="app-select"
              >
                <option value="screen">Screen</option>
                <option value="add">Add</option>
                <option value="normal">Normal</option>
                <option value="soft-light">Soft Light</option>
              </select>
            </label>
            <div className="flex items-end gap-2">
              <button type="button" className="app-button app-secondary flex-1 text-xs" onClick={resetSettings}>
                Reset
              </button>
              <button
                type="button"
                className="app-button app-primary flex-1 text-xs inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleExport}
                disabled={!sourceImage}
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                Add
              </button>
            </div>
          </div>

          {status && <p className="text-sm text-gray-300">{status}</p>}
        </div>
      </div>
    </section>
  );
};

export default ArtRelightPanel;
