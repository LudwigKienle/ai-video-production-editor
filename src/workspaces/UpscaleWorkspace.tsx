/**
 * UPSCALE workspace: enhancement-app layout (input list · A/B comparison
 * with zoom, wipe and timeline · model stack and export settings · job
 * queue). Cloud upscalers are the only engines; local work is limited to
 * resize/crop, sharpen and grain add-back on the GPU FX engine.
 *
 * Pure logic: upscale-pro/upscaleOps.ts (tests next to it). Side effects:
 * upscale-pro/upscaleRuntime.ts. MCP tools: src/mcp/modules/upscaleTools.ts
 * reach this page through the live commands registered below.
 */
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Columns2, FlaskConical, Square, SquareSplitHorizontal } from 'lucide-react';
import type { CostRate, MediaItem, RecentProject, ReferenceItem, ShotPrompt, UsageProvider } from '../types';
import { useLibraryAssets, type LibraryAsset } from '../hooks/useLibraryAssets';
import { estimateGenerationCost, formatUsd } from '../utils/generationPricing';
import { RUNWAY_RUBY_OUTPUT_FORMATS, hasRunwayApiKey } from '../services/runwayService';
import { useUpscaleAiLiveCommands } from './upscale-pro/useUpscaleAiLiveCommands';
import { startTask, type TaskHandle } from '../services/taskCenter';
import { registerLiveCommands } from '../mcp/liveCommands';
import { applySettingsArgs } from '../mcp/modules/upscaleTools';
import ComparePreview, { type PreviewResult, type ViewState } from './upscale-pro/ComparePreview';
import InputQueue from './upscale-pro/InputQueue';
import SettingsPanel from './upscale-pro/SettingsPanel';
import Transport from './upscale-pro/Transport';
import JobQueue from './upscale-pro/JobQueue';
import {
  clampRange,
  computeTargetSize,
  enhanceModelFor,
  estimateOutputBytes,
  formatBytes,
  formatTimecode,
  jobsReducer,
  nextRunnableJob,
  parseSettings,
  planPipeline,
  previewRange,
  sanitizeSettings,
  sumPipelineCost,
  type PipelinePlan,
  type PipelineStep,
  type Range,
  type UpscaleJob,
  type UpscaleSettings,
} from './upscale-pro/upscaleOps';
import { UPSCALE_FALLBACK_RATES } from './upscale-pro/upscaleModels';
import {
  chooseOutputFolder,
  electronBridge,
  isCancelledError,
  isUpscaleMockMode,
  openFolder,
  probeMedia,
  runUpscaleJob,
  type QueueInput,
} from './upscale-pro/upscaleRuntime';
import './upscale-pro/upscalePro.css';

interface UpscaleWorkspaceProps {
  onAddGeneratedMedia: (item: MediaItem) => void;
  apiKeyReady?: boolean;
  mediaItems?: MediaItem[];
  references?: ReferenceItem[];
  shotPrompts?: ShotPrompt[];
  recentProjects?: RecentProject[];
  currentProjectName?: string | null;
  currentProjectPath?: string | null;
  costRates?: CostRate[];
}

const SETTINGS_KEY = 'avpe.upscalePro.settings';
const VIEW_KEY = 'avpe.upscalePro.view';
const DEFAULT_VIEW: ViewState = { mode: 'wipe', singleShows: 'after', zoom: 'fit', pan: { x: 0, y: 0 }, wipe: 0.5 };

const readStorage = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const writeStorage = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
};
const loadView = (): ViewState => {
  try {
    const raw = JSON.parse(readStorage(VIEW_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return DEFAULT_VIEW;
    return {
      ...DEFAULT_VIEW,
      mode: ['single', 'side', 'wipe'].includes(raw.mode) ? raw.mode : DEFAULT_VIEW.mode,
      singleShows: raw.singleShows === 'before' ? 'before' : 'after',
      wipe: typeof raw.wipe === 'number' ? Math.min(1, Math.max(0, raw.wipe)) : 0.5,
    };
  } catch {
    return DEFAULT_VIEW;
  }
};

let inputCounter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(inputCounter += 1).toString(36)}`;

const kindFromFile = (file: File): 'image' | 'video' | null => {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  if (/\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)) return 'video';
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name)) return 'image';
  return null;
};

const isFullRange = (range: Range, duration: number, fps: number) =>
  range.start <= 0.5 / fps && range.end >= duration - 0.5 / fps;

type JobContext = { input: QueueInput; settings: UpscaleSettings; plan: PipelinePlan; frameTime?: number };

const UpscaleWorkspace: React.FC<UpscaleWorkspaceProps> = ({
  onAddGeneratedMedia,
  apiKeyReady,
  mediaItems = [],
  references = [],
  shotPrompts = [],
  recentProjects = [],
  currentProjectName,
  currentProjectPath,
  costRates,
}) => {
  const [inputs, setInputs] = useState<QueueInput[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState<UpscaleSettings>(() => parseSettings(readStorage(SETTINGS_KEY)));
  const [view, setViewState] = useState<ViewState>(loadView);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ioByInput, setIoByInputState] = useState<Record<string, Range>>({});
  // Mirrored in a ref so back-to-back MCP commands see In/Out changes immediately.
  const ioRef = useRef<Record<string, Range>>({});
  const setIoByInput = useCallback((fn: (prev: Record<string, Range>) => Record<string, Range>) => {
    ioRef.current = fn(ioRef.current);
    setIoByInputState(ioRef.current);
  }, []);
  const [previewLength, setPreviewLength] = useState(0);
  const [jobs, dispatch] = useReducer(jobsReducer, []);
  const [previews, setPreviews] = useState<Record<string, PreviewResult>>({});
  const [inBin, setInBin] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [mock, setMock] = useState(isUpscaleMockMode);

  const filesRef = useRef(new Map<string, File>());
  const objectUrlsRef = useRef<string[]>([]);
  const jobContextRef = useRef(new Map<string, JobContext>());
  const jobResultsRef = useRef(new Map<string, MediaItem>());
  const jobSizesRef = useRef(new Map<string, { width: number; height: number } | null>());
  const cancelledRef = useRef(new Set<string>());
  const tasksRef = useRef(new Map<string, TaskHandle>());
  const probesRef = useRef(new Map<string, Promise<QueueInput>>());

  const { assets: libraryAssets, isLoading: libraryLoading } = useLibraryAssets({
    currentProjectName, currentProjectPath, mediaItems, references, shotPrompts, recentProjects,
  });

  useEffect(() => { writeStorage(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);
  useEffect(() => { writeStorage(VIEW_KEY, JSON.stringify({ mode: view.mode, singleShows: view.singleShows, wipe: view.wipe })); }, [view.mode, view.singleShows, view.wipe]);
  useEffect(() => {
    const onFocus = () => setMock(isUpscaleMockMode());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } });
  }, []);

  const activeInput = inputs.find((input) => input.id === activeId) ?? null;
  const rates = useMemo<CostRate[]>(() => (costRates && costRates.length ? costRates : (UPSCALE_FALLBACK_RATES as unknown as CostRate[])), [costRates]);

  // ---------------------------------------------------------------- derived
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ioFor = useCallback((input: QueueInput): Range => clampRange(ioRef.current[input.id] ?? { start: 0, end: input.duration }, input.duration, input.fps || 24), [ioByInput]);

  const planFor = useCallback((input: QueueInput, s: UpscaleSettings, range?: Range | null): PipelinePlan => {
    const io = range ?? (input.kind === 'video' ? ioFor(input) : null);
    return planPipeline(s, {
      kind: input.kind,
      source: { width: input.width || 1, height: input.height || 1 },
      fps: input.fps || 24,
      rangeSeconds: io ? io.end - io.start : 0,
      partialRange: Boolean(io && input.kind === 'video' && !isFullRange(io, input.duration, input.fps || 24)),
    });
  }, [ioFor]);

  const stepCost = useCallback((step: PipelineStep): number | null => {
    if (!step.provider || !step.costKind) return null;
    const estimate = estimateGenerationCost({ rates, provider: step.provider as UsageProvider, kind: step.costKind, model: step.providerModel, units: step.units });
    return estimate ? estimate.hostedUsd : null;
  }, [rates]);

  const estimateInput = useCallback((input: QueueInput, s: UpscaleSettings, range?: Range | null) => {
    const plan = planFor(input, s, range);
    const io = range ?? (input.kind === 'video' ? ioFor(input) : null);
    const seconds = io ? io.end - io.start : 0;
    const size = plan.target ?? computeTargetSize({ width: input.width, height: input.height }, s.output);
    const bytes = estimateOutputBytes({
      kind: input.kind, width: size.width, height: size.height, fps: plan.outputFps, seconds,
      codec: s.export.videoCodec, quality: s.export.quality, audio: s.export.audio, imageFormat: s.export.imageFormat,
    });
    const cost = sumPipelineCost(plan.steps, stepCost);
    return { plan, size, bytes, cost, seconds };
  }, [planFor, ioFor, stepCost]);

  const activeEstimate = useMemo(() => (activeInput && activeInput.status === 'ready' ? estimateInput(activeInput, settings) : null), [activeInput, settings, estimateInput]);
  const displayTarget = useMemo(() => {
    if (!activeInput || activeInput.status !== 'ready') return null;
    const limits = settings.enhance.enabled ? enhanceModelFor(settings, activeInput.kind).limits : undefined;
    return computeTargetSize({ width: activeInput.width, height: activeInput.height }, settings.output, limits);
  }, [activeInput, settings]);

  const activeIo = activeInput && activeInput.kind === 'video' ? ioFor(activeInput) : null;
  const previewSpan = activeInput && activeInput.kind === 'video' && activeIo ? previewRange(time, previewLength, activeIo, activeInput.fps || 24) : null;

  const previewEstimate = useMemo(() => {
    if (!activeInput || activeInput.status !== 'ready') return null;
    if (activeInput.kind === 'image') return estimateInput(activeInput, settings);
    if (!previewSpan) return null;
    if (previewLength === 0) {
      // Single frame: the matching image model, one image.
      const imageModel = enhanceModelFor(settings, 'video').id === 'crystal-video' ? 'crystal' : 'topaz';
      const s = sanitizeSettings({ ...settings, enhance: { ...settings.enhance, imageModel }, interpolation: { enabled: false }, hdr: { ...settings.hdr, enabled: false } });
      return estimateInput({ ...activeInput, kind: 'image' }, s);
    }
    return estimateInput(activeInput, { ...settings, hdr: { ...settings.hdr, enabled: false } }, previewSpan);
  }, [activeInput, settings, previewSpan, previewLength, estimateInput]);

  const keysMissing = apiKeyReady === false && !mock;
  const exportBlocked = !activeInput
    ? 'Eingang wählen.'
    : activeInput.status !== 'ready'
      ? 'Eingang wird noch gelesen.'
      : keysMissing
        ? 'API-Keys verbinden, um zu rendern (oder Testmodus aktivieren).'
        : null;
  const canExport = !exportBlocked && Boolean(activeEstimate && activeEstimate.plan.errors.length === 0);
  const canPreview = !exportBlocked && Boolean(previewEstimate && previewEstimate.plan.errors.length === 0);

  const costLabel = (cost: { usd: number; unknown: string[] } | undefined) => {
    if (!cost) return null;
    if (mock) return 'Testmodus · 0 Credits';
    return `${formatUsd(cost.usd)}${cost.unknown.length ? ' + ?' : ''}`;
  };

  // ---------------------------------------------------------------- inputs
  const probeInput = useCallback((input: QueueInput): Promise<QueueInput> => {
    const promise = probeMedia(input.url, input.kind)
      .then((meta) => {
        const ready: QueueInput = { ...input, ...meta, duration: meta.duration || input.duration, status: 'ready' };
        setInputs((prev) => prev.map((entry) => (entry.id === input.id ? { ...entry, ...ready, fps: entry.fps, fpsEstimated: entry.fpsEstimated } : entry)));
        return ready;
      })
      .catch((error) => {
        const failed: QueueInput = { ...input, status: 'error', error: error instanceof Error ? error.message : String(error) };
        setInputs((prev) => prev.map((entry) => (entry.id === input.id ? failed : entry)));
        return failed;
      });
    probesRef.current.set(input.id, promise);
    return promise;
  }, []);

  const addInput = useCallback((entry: Omit<QueueInput, 'id' | 'width' | 'height' | 'fps' | 'fpsEstimated' | 'status' | 'duration'> & { duration?: number }, file?: File) => {
    const input: QueueInput = { id: nextId('in'), width: 0, height: 0, fps: 24, fpsEstimated: true, duration: entry.duration ?? 0, status: 'probing', ...entry };
    if (file) filesRef.current.set(input.id, file);
    setInputs((prev) => [...prev, input]);
    setActiveId(input.id);
    setTime(0);
    setPlaying(false);
    return probeInput(input);
  }, [probeInput]);

  const addFiles = useCallback((files: File[]) => {
    let skipped = 0;
    files.forEach((file) => {
      const kind = kindFromFile(file);
      if (!kind) { skipped += 1; return; }
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.push(url);
      void addInput({ name: file.name, kind, url }, file);
    });
    setNotice(skipped ? `${skipped} Datei(en) übersprungen (nur Bilder und Videos).` : null);
  }, [addInput]);

  const addMediaItem = useCallback((item: MediaItem): Promise<QueueInput> => {
    const existing = inputs.find((input) => input.mediaId === item.id);
    if (existing) {
      setActiveId(existing.id);
      return probesRef.current.get(existing.id) ?? Promise.resolve(existing);
    }
    if (item.type !== 'image' && item.type !== 'video') return Promise.reject(new Error('Nur Bilder und Videos.'));
    return addInput({ name: item.name, kind: item.type, url: item.url, mediaId: item.id, duration: item.duration });
  }, [inputs, addInput]);

  const addLibraryAsset = useCallback((asset: LibraryAsset) => {
    if (!asset.url) return;
    void addInput({ name: asset.name, kind: asset.kind === 'video' ? 'video' : 'image', url: asset.url, duration: asset.duration });
  }, [addInput]);

  const handleDrop = useCallback((event: React.DragEvent) => {
    const mediaId = event.dataTransfer.getData('application/x-media-id');
    if (mediaId) {
      const item = mediaItems.find((entry) => entry.id === mediaId);
      if (item) void addMediaItem(item).catch((error) => setNotice(String(error?.message || error)));
      return;
    }
    const assetJson = event.dataTransfer.getData('application/x-library-asset');
    if (assetJson) {
      try { addLibraryAsset(JSON.parse(assetJson) as LibraryAsset); } catch { setNotice('Bibliotheks-Asset nicht lesbar.'); }
      return;
    }
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) addFiles(files);
  }, [mediaItems, addMediaItem, addLibraryAsset, addFiles]);

  const selectInput = useCallback((id: string) => {
    setActiveId(id);
    setTime(ioByInput[id]?.start ?? 0);
    setPlaying(false);
  }, [ioByInput]);

  const removeInput = useCallback((id: string) => {
    setInputs((prev) => {
      const next = prev.filter((input) => input.id !== id);
      setActiveId((current) => (current === id ? next[next.length - 1]?.id ?? null : current));
      return next;
    });
    filesRef.current.delete(id);
    setPreviews((prev) => { const next = { ...prev }; delete next[id]; return next; });
  }, []);

  const onFps = useCallback((inputId: string, fps: number) => {
    setInputs((prev) => prev.map((input) => (input.id === inputId ? { ...input, fps, fpsEstimated: false } : input)));
  }, []);

  // ---------------------------------------------------------------- settings / view
  // Kept in a ref as well so MCP commands issued back-to-back see the latest value.
  const settingsRef = useRef(settings);
  const updateSettings = useCallback((fn: (draft: UpscaleSettings) => void) => {
    const draft: UpscaleSettings = JSON.parse(JSON.stringify(settingsRef.current));
    fn(draft);
    const next = sanitizeSettings(draft);
    settingsRef.current = next;
    setSettings(next);
  }, []);
  const setView = useCallback((patch: Partial<ViewState>) => setViewState((prev) => ({ ...prev, ...patch })), []);
  const setIo = useCallback((range: Range) => {
    if (!activeId) return;
    setIoByInput((prev) => ({ ...prev, [activeId]: range }));
  }, [activeId]);
  const chooseFolder = useCallback(async () => {
    const folder = await chooseOutputFolder();
    if (folder) updateSettings((d) => { d.export.outputFolder = folder; });
  }, [updateSettings]);

  // ---------------------------------------------------------------- jobs
  const enqueue = useCallback((input: QueueInput, purpose: 'preview' | 'export', range: Range | null, s: UpscaleSettings, frameTime?: number) => {
    const plan = purpose === 'preview' && input.kind === 'video' && frameTime === undefined
      ? planFor(input, { ...s, hdr: { ...s.hdr, enabled: false } }, range)
      : planFor(input, s, range ?? undefined);
    const relevantErrors = frameTime !== undefined ? plan.errors.filter((e) => !e.includes('HDR')) : plan.errors;
    if (relevantErrors.length) throw new Error(relevantErrors.join(' '));
    const id = nextId('job');
    const estimate = frameTime !== undefined ? previewEstimate?.cost.usd : sumPipelineCost(plan.steps, stepCost).usd;
    const label = purpose === 'export'
      ? 'Export'
      : input.kind === 'image' ? 'Vorschau' : frameTime !== undefined ? `Einzelbild @ ${formatTimecode(frameTime, input.fps)}` : `${previewLength} s Vorschau`;
    const job: UpscaleJob = {
      id, inputId: input.id, name: `${input.name} · ${label}`, kind: input.kind, purpose,
      range: frameTime !== undefined ? { start: frameTime, end: frameTime + 1 / (input.fps || 24) } : range,
      status: 'queued', progress: 0, stepLabel: 'Wartet', createdAt: Date.now(), estimatedUsd: estimate, mock,
    };
    jobContextRef.current.set(id, { input, settings: s, plan, frameTime });
    dispatch({ type: 'add', job });
    return job;
  }, [planFor, stepCost, previewEstimate, previewLength, mock]);

  const exportInput = useCallback((input: QueueInput, s: UpscaleSettings = settingsRef.current) => {
    if (input.status !== 'ready') throw new Error('Eingang ist noch nicht bereit.');
    if (apiKeyReady === false && !mock) throw new Error('API-Keys fehlen.');
    const io = input.kind === 'video' ? ioFor(input) : null;
    const partial = io && !isFullRange(io, input.duration, input.fps || 24);
    return enqueue(input, 'export', partial ? io : null, s);
  }, [settings, apiKeyReady, mock, ioFor, enqueue]);

  const exportActive = useCallback(() => {
    if (!activeInput) return;
    try { exportInput(activeInput); setNotice(null); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }, [activeInput, exportInput]);

  const renderPreviewFor = useCallback((input: QueueInput, length: number, at: number) => {
    if (input.status !== 'ready') throw new Error('Eingang ist noch nicht bereit.');
    if (apiKeyReady === false && !mock) throw new Error('API-Keys fehlen.');
    const s = settingsRef.current;
    if (input.kind === 'image') return enqueue(input, 'preview', null, s);
    const io = ioFor(input);
    const span = previewRange(at, length, io, input.fps || 24);
    return length <= 0 ? enqueue(input, 'preview', null, s, span.start) : enqueue(input, 'preview', span, s);
  }, [apiKeyReady, mock, enqueue, ioFor, settings]);

  const renderPreview = useCallback(() => {
    if (!activeInput) return;
    try { renderPreviewFor(activeInput, previewLength, time); setNotice(null); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }, [activeInput, previewLength, time, renderPreviewFor]);

  const cancelJob = useCallback((id: string) => {
    cancelledRef.current.add(id);
    tasksRef.current.get(id)?.cancel();
    tasksRef.current.delete(id);
    dispatch({ type: 'cancel', id, at: Date.now() });
  }, []);

  const showResult = useCallback((job: UpscaleJob, item: MediaItem, outputSize?: { width: number; height: number } | null) => {
    if (/\.zip$/i.test(item.name)) { setNotice('EXR-Archiv: liegt im Media-Bin, keine Vorschau im Browser.'); return; }
    const ctx = jobContextRef.current.get(job.id);
    setPreviews((prev) => ({
      ...prev,
      [job.inputId]: {
        jobId: job.id,
        inputId: job.inputId,
        kind: item.type === 'video' ? 'video' : 'image',
        url: item.url,
        range: job.range,
        frame: ctx?.frameTime !== undefined,
        label: `${job.purpose === 'preview' ? 'Vorschau' : 'Ergebnis'}${job.mock ? ' (Testmodus)' : ''}`,
        sizeLabel: outputSize ? `${outputSize.width}×${outputSize.height}` : undefined,
      },
    }));
    setActiveId(job.inputId);
    if (ctx?.frameTime !== undefined) { setPlaying(false); setTime(ctx.frameTime); }
    if (job.range && ctx?.frameTime === undefined) setTime(job.range.start);
    setViewState((prev) => (prev.mode === 'single' ? { ...prev, singleShows: 'after' } : prev));
  }, []);

  const openJob = useCallback((id: string) => {
    const job = jobs.find((entry) => entry.id === id);
    const item = jobResultsRef.current.get(id);
    if (job && item) showResult(job, item, jobSizesRef.current.get(id));
  }, [jobs, showResult]);

  const addJobToBin = useCallback((id: string) => {
    const item = jobResultsRef.current.get(id);
    if (!item) return;
    onAddGeneratedMedia(item);
    setInBin((prev) => new Set(prev).add(id));
  }, [onAddGeneratedMedia]);

  const openJobFolder = useCallback((id: string) => {
    const folder = settings.export.outputFolder;
    const job = jobs.find((entry) => entry.id === id);
    const path = job?.savedPath ? job.savedPath.replace(/[\\/][^\\/]+$/, '') : folder;
    if (path) void openFolder(path);
  }, [jobs, settings.export.outputFolder]);

  // Runner: one job at a time.
  useEffect(() => {
    const job = nextRunnableJob(jobs);
    if (!job) return;
    const context = jobContextRef.current.get(job.id);
    if (!context) { dispatch({ type: 'fail', id: job.id, error: 'Auftragsdaten fehlen.', at: Date.now() }); return; }
    dispatch({ type: 'start', id: job.id });
    const task = startTask({ label: `Upscale · ${job.name}`, kind: job.kind, provider: job.mock ? 'test' : 'replicate', message: 'Startet…', progress: 0, cancel: () => { cancelledRef.current.add(job.id); dispatch({ type: 'cancel', id: job.id, at: Date.now() }); } });
    tasksRef.current.set(job.id, task);
    const isCancelled = () => cancelledRef.current.has(job.id);
    runUpscaleJob({
      job,
      input: context.input,
      file: filesRef.current.get(context.input.id) ?? null,
      settings: context.settings,
      plan: context.plan,
      frameTime: context.frameTime,
      mock: job.mock === true,
      isCancelled,
      onProgress: (progress, stepLabel) => {
        if (isCancelled()) return;
        dispatch({ type: 'progress', id: job.id, progress, stepLabel });
        task.update({ progress, message: stepLabel });
      },
    })
      .then(({ item, savedPath, notes, outputSize }) => {
        if (isCancelled()) return;
        jobResultsRef.current.set(job.id, item);
        jobSizesRef.current.set(job.id, outputSize);
        dispatch({ type: 'done', id: job.id, resultUrl: item.url, resultMediaId: job.purpose === 'export' ? item.id : undefined, savedPath, at: Date.now() });
        task.complete(notes.join(' ') || 'Fertig');
        if (job.purpose === 'export') {
          onAddGeneratedMedia(item);
          setInBin((prev) => new Set(prev).add(job.id));
        }
        showResult(job, item, outputSize);
        if (notes.length) setNotice(notes.join(' '));
      })
      .catch((error) => {
        if (isCancelled() || isCancelledError(error)) return;
        const message = error instanceof Error ? error.message : String(error);
        dispatch({ type: 'fail', id: job.id, error: message, at: Date.now() });
        task.fail(error);
      })
      .finally(() => { tasksRef.current.delete(job.id); });
  }, [jobs, onAddGeneratedMedia, showResult]);

  // ---------------------------------------------------------------- keyboard
  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable) return;
    if (!activeInput) return;
    const fps = activeInput.fps || 24;
    if (event.key === ' ' && activeInput.kind === 'video') { event.preventDefault(); setPlaying((p) => !p); }
    else if (event.key === 'ArrowLeft' && activeInput.kind === 'video') { event.preventDefault(); setPlaying(false); setTime((t) => Math.max(0, t - 1 / fps)); }
    else if (event.key === 'ArrowRight' && activeInput.kind === 'video') { event.preventDefault(); setPlaying(false); setTime((t) => Math.min(activeInput.duration, t + 1 / fps)); }
    else if (event.key === 'i' && activeIo) setIo(clampRange({ start: time, end: activeIo.end }, activeInput.duration, fps));
    else if (event.key === 'o' && activeIo) setIo(clampRange({ start: activeIo.start, end: time }, activeInput.duration, fps));
    else if (event.key === '1') setView({ mode: 'single' });
    else if (event.key === '2') setView({ mode: 'side' });
    else if (event.key === '3') setView({ mode: 'wipe' });
    else if (event.key === 'z') setView(view.zoom === 'fit' ? { zoom: 1 } : { zoom: 'fit', pan: { x: 0, y: 0 } });
  };

  // ---------------------------------------------------------------- MCP live commands
  const liveRef = useRef<Record<string, unknown>>({});
  liveRef.current = {
    inputs, activeInput, settings: settingsRef.current, view, time, ioFor, previews, jobs, estimateInput, mediaItems,
    addMediaItem, updateSettings, setView, setTime, setIoByInput, selectInput, exportInput, renderPreviewFor, cancelJob, mock,
  };
  useEffect(() => {
    const L = () => liveRef.current as {
      inputs: QueueInput[]; activeInput: QueueInput | null; settings: UpscaleSettings; view: ViewState; time: number;
      ioFor: (i: QueueInput) => Range; previews: Record<string, PreviewResult>; jobs: UpscaleJob[];
      estimateInput: typeof estimateInput; mediaItems: MediaItem[]; addMediaItem: typeof addMediaItem;
      updateSettings: typeof updateSettings; setView: typeof setView; setTime: typeof setTime;
      setIoByInput: typeof setIoByInput; selectInput: typeof selectInput; exportInput: typeof exportInput;
      renderPreviewFor: typeof renderPreviewFor; cancelJob: typeof cancelJob; mock: boolean;
    };
    const inputFor = async (args: Record<string, unknown>): Promise<QueueInput> => {
      const l = L();
      if (typeof args.mediaId === 'string') {
        const item = l.mediaItems.find((entry) => entry.id === args.mediaId);
        if (!item) throw new Error(`Media ${args.mediaId} not found.`);
        const input = await l.addMediaItem(item);
        if (input.status !== 'ready') throw new Error(input.error || 'Media could not be read.');
        return input;
      }
      const byId = typeof args.inputId === 'string' ? l.inputs.find((entry) => entry.id === args.inputId) : l.activeInput;
      if (!byId) throw new Error('No Upscale input; pass mediaId.');
      return byId;
    };
    const describeJob = (job: UpscaleJob) => ({ ...job });
    const summaryOf = (input: QueueInput, s: UpscaleSettings, range?: Range | null) => {
      const est = L().estimateInput(input, s, range);
      return {
        inputId: input.id,
        source: { width: input.width, height: input.height, fps: input.fps, duration: input.duration },
        output: { width: est.size.width, height: est.size.height, fps: input.kind === 'video' ? est.plan.outputFps : null },
        steps: est.plan.steps.map((step) => ({ id: step.id, label: step.label, paid: step.paid })),
        seconds: est.seconds,
        estimatedBytes: est.bytes,
        estimatedSize: formatBytes(est.bytes),
        estimatedUsd: L().mock ? 0 : est.cost.usd,
        unknownCostSteps: est.cost.unknown,
        errors: est.plan.errors,
        warnings: est.plan.warnings,
        mock: L().mock,
      };
    };
    return registerLiveCommands({
      'upscale.state.get': () => {
        const l = L();
        return {
          inputs: l.inputs.map(({ thumbnail: _thumb, ...rest }) => ({ ...rest, io: rest.kind === 'video' ? l.ioFor(rest) : null })),
          activeInputId: l.activeInput?.id ?? null,
          settings: settingsRef.current,
          view: l.view,
          time: l.time,
          previews: Object.values(l.previews),
          jobs: l.jobs.map(describeJob),
          mock: l.mock,
        };
      },
      'upscale.estimate': async (args) => {
        const input = await inputFor(args);
        return summaryOf(input, applySettingsArgs(settingsRef.current, args));
      },
      'upscale.input.add': async (args) => {
        const input = await inputFor(args);
        return { inputId: input.id, kind: input.kind, width: input.width, height: input.height, duration: input.duration, status: input.status };
      },
      'upscale.settings.set': (args) => {
        const next = applySettingsArgs(settingsRef.current, args);
        L().updateSettings((draft) => { Object.assign(draft, next); });
        return { settings: next };
      },
      'upscale.view.set': (args) => {
        const l = L();
        if (typeof args.inputId === 'string') l.selectInput(args.inputId);
        const patch: Partial<ViewState> = {};
        if (args.mode === 'single' || args.mode === 'side' || args.mode === 'wipe') patch.mode = args.mode;
        if (args.show === 'before' || args.show === 'after') patch.singleShows = args.show;
        if (args.zoom !== undefined) {
          const z = String(args.zoom);
          patch.zoom = z === 'fit' ? 'fit' : Math.min(16, Math.max(0.05, Number(z) || 1));
          if (patch.zoom === 'fit') patch.pan = { x: 0, y: 0 };
        }
        if (typeof args.wipe === 'number') patch.wipe = Math.min(1, Math.max(0, args.wipe));
        l.setView(patch);
        const input = typeof args.inputId === 'string' ? l.inputs.find((e) => e.id === args.inputId) : l.activeInput;
        if (typeof args.time === 'number') l.setTime(Math.max(0, args.time));
        if (input && input.kind === 'video' && (typeof args.in === 'number' || typeof args.out === 'number')) {
          const current = l.ioFor(input);
          const next = clampRange({ start: typeof args.in === 'number' ? args.in : current.start, end: typeof args.out === 'number' ? args.out : current.end }, input.duration, input.fps || 24);
          l.setIoByInput((prev) => ({ ...prev, [input.id]: next }));
        }
        return { view: { ...l.view, ...patch } };
      },
      'upscale.preview.render': async (args) => {
        const input = await inputFor(args);
        const length = Math.min(3, Math.max(0, Number(args.lengthSeconds ?? 0) || 0));
        const at = typeof args.atSeconds === 'number' ? args.atSeconds : L().time;
        const job = L().renderPreviewFor(input, length, at);
        return { jobId: job.id, mock: job.mock === true, estimatedUsd: job.mock ? 0 : job.estimatedUsd ?? null };
      },
      'upscale.queue.add': async (args) => {
        const input = await inputFor(args);
        const l = L();
        const s = applySettingsArgs(settingsRef.current, args);
        if (Object.keys(args).some((key) => !['mediaId', 'inputId', 'in', 'out', 'confirm'].includes(key))) {
          l.updateSettings((draft) => { Object.assign(draft, s); });
        }
        if (input.kind === 'video' && (typeof args.in === 'number' || typeof args.out === 'number')) {
          const current = l.ioFor(input);
          const next = clampRange({ start: typeof args.in === 'number' ? args.in : current.start, end: typeof args.out === 'number' ? args.out : current.end }, input.duration, input.fps || 24);
          l.setIoByInput((prev) => ({ ...prev, [input.id]: next }));
          const job = l.exportInput(input, s);
          return { jobId: job.id, mock: job.mock === true, estimatedUsd: job.mock ? 0 : job.estimatedUsd ?? null, note: 'In/Out applied.' };
        }
        const job = l.exportInput(input, s);
        return { jobId: job.id, mock: job.mock === true, estimatedUsd: job.mock ? 0 : job.estimatedUsd ?? null };
      },
      'upscale.queue.list': () => ({ jobs: L().jobs.map(describeJob) }),
      'upscale.queue.cancel': (args) => {
        const l = L();
        const ids = args.all === true
          ? l.jobs.filter((job) => job.status === 'queued' || job.status === 'running').map((job) => job.id)
          : [String(args.jobId)];
        if (!args.all && !l.jobs.some((job) => job.id === args.jobId)) throw new Error(`Job ${args.jobId} not found.`);
        ids.forEach((id) => l.cancelJob(id));
        return { cancelled: ids };
      },
    });
  }, []);

  useUpscaleAiLiveCommands({
    settingsRef, updateSettings, inputs, jobs, mock, runwayKey: hasRunwayApiKey(), rubyFormats: RUNWAY_RUBY_OUTPUT_FORMATS, libraryAssets,
    addInput, addLibraryAsset, removeInput, onFps, jobResultsRef, addJobToBin, openJob, openJobFolder,
    removeJob: (id) => dispatch({ type: 'remove', id }),
    clearFinished: () => dispatch({ type: 'clearFinished' }),
  });

  // ---------------------------------------------------------------- render
  const jobStatusByInput = useMemo(() => {
    const map: Record<string, 'running' | 'queued' | 'done' | 'failed' | undefined> = {};
    jobs.forEach((job) => {
      if (job.purpose !== 'export') return;
      if (job.status === 'running' || job.status === 'queued' || job.status === 'done' || job.status === 'failed') map[job.inputId] = job.status;
    });
    return map;
  }, [jobs]);

  const sourceLabel = activeInput && activeInput.status === 'ready' ? `${activeInput.width}×${activeInput.height}` : null;
  const rangeLabel = activeInput && activeIo
    ? `${formatTimecode(activeIo.start, activeInput.fps)} – ${formatTimecode(activeIo.end, activeInput.fps)} (${(activeIo.end - activeIo.start).toFixed(2)} s)`
    : null;
  const previewHint = previewEstimate ? (mock ? 'Testmodus' : `ca. ${formatUsd(previewEstimate.cost.usd)}`) : null;

  return (
    <div className="ups-root" tabIndex={-1} onKeyDown={onKeyDown} data-automation-id="upscale-workspace">
      <header className="ups-top">
        <span className="ups-title">Upscale</span>
        <span className="ups-crumb" data-automation-id="upscale-active-name">{activeInput ? `› ${activeInput.name}` : ''}</span>
        <div className="ups-top-center">
          <button type="button" className="ups-icon-btn" aria-pressed={view.mode === 'single'} title="Einzelansicht (1)" onClick={() => setView({ mode: 'single' })} data-automation-id="upscale-view-single"><Square /></button>
          <button type="button" className="ups-icon-btn" aria-pressed={view.mode === 'side'} title="Nebeneinander (2)" onClick={() => setView({ mode: 'side' })} data-automation-id="upscale-view-side"><Columns2 /></button>
          <button type="button" className="ups-icon-btn" aria-pressed={view.mode === 'wipe'} title="Geteilte Ansicht mit Teiler (3)" onClick={() => setView({ mode: 'wipe' })} data-automation-id="upscale-view-wipe"><SquareSplitHorizontal /></button>
          {view.mode === 'single' && (
            <div className="ups-seg" style={{ marginLeft: 8 }} data-automation-id="upscale-single-toggle">
              <button type="button" aria-pressed={view.singleShows === 'before'} onClick={() => setView({ singleShows: 'before' })} data-automation-id="upscale-single-before">Original</button>
              <button type="button" aria-pressed={view.singleShows === 'after'} onClick={() => setView({ singleShows: 'after' })} data-automation-id="upscale-single-after">Ergebnis</button>
            </div>
          )}
        </div>
        <div className="ups-top-right">
          {notice && <span className="ups-badge is-warn" title={notice} style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} data-automation-id="upscale-notice">{notice}</span>}
          {mock && <span className="ups-badge is-warn" data-automation-id="upscale-mock-badge"><FlaskConical size={10} /> Testmodus – keine Credits</span>}
          {keysMissing && <span className="ups-badge is-err">API-Keys fehlen</span>}
        </div>
      </header>

      <InputQueue
        inputs={inputs}
        activeId={activeId}
        jobStatusByInput={jobStatusByInput}
        mediaItems={mediaItems}
        libraryAssets={libraryAssets}
        libraryLoading={libraryLoading}
        onSelect={selectInput}
        onRemove={removeInput}
        onAddFiles={addFiles}
        onAddMedia={(item) => { void addMediaItem(item).catch((error) => setNotice(String(error?.message || error))); }}
        onAddLibraryAsset={addLibraryAsset}
        onDropData={handleDrop}
      />

      <main
        className="ups-stage"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); handleDrop(event); }}
      >
        <ComparePreview
          input={activeInput && activeInput.status === 'ready' ? activeInput : null}
          view={view}
          target={displayTarget}
          post={settings.post}
          time={time}
          playing={playing}
          preview={activeInput ? previews[activeInput.id] ?? null : null}
          onViewChange={setView}
          onTime={setTime}
          onPlayingChange={setPlaying}
          onFps={onFps}
        />
        <Transport
          input={activeInput && activeInput.status === 'ready' ? activeInput : null}
          time={time}
          playing={playing}
          io={activeIo}
          previewLength={previewLength}
          previewSpan={previewSpan}
          canPreview={canPreview}
          previewHint={previewHint}
          onTime={setTime}
          onPlaying={setPlaying}
          onIo={setIo}
          onPreviewLength={setPreviewLength}
          onRenderPreview={renderPreview}
        />
      </main>

      <SettingsPanel
        settings={settings}
        update={updateSettings}
        kind={activeInput?.kind ?? null}
        sourceLabel={sourceLabel}
        plan={activeEstimate?.plan ?? null}
        sizeLabel={activeEstimate ? formatBytes(activeEstimate.bytes) : null}
        costLabel={costLabel(activeEstimate?.cost)}
        rangeLabel={rangeLabel}
        canExport={canExport}
        blockedReason={exportBlocked}
        mock={mock}
        electron={Boolean(electronBridge()?.selectFolder)}
        rubyFormats={RUNWAY_RUBY_OUTPUT_FORMATS}
        runwayKey={hasRunwayApiKey()}
        onExport={exportActive}
        onChooseFolder={() => { void chooseFolder(); }}
      />

      <JobQueue
        jobs={jobs}
        inBin={inBin}
        onCancel={cancelJob}
        onOpen={openJob}
        onRemove={(id) => dispatch({ type: 'remove', id })}
        onAddToBin={addJobToBin}
        onOpenFolder={openJobFolder}
        onClearFinished={() => dispatch({ type: 'clearFinished' })}
      />
    </div>
  );
};

export default UpscaleWorkspace;
