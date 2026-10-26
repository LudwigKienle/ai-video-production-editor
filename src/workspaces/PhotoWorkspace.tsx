/**
 * PHOTO workspace — a layer-based image editor with an image-editor style
 * frame (menu bar, options bar, tools panel, document tabs, docked panels,
 * status bar). Pure model/maths live in ./photo-pro (layers, history,
 * selection, adjustments, viewport, tools); this file wires state, pointer
 * input, rendering and the AI services together.
 *
 * Kept from the previous editor: Lens & Film FX (now per-layer Smart Filters
 * rendered live on the GPU, "Effekte ins Bild übernehmen" bakes them, export
 * renders them via renderFx), AI inpaint/expand (Replicate/FAL/Nano Banana),
 * neural looks, crop, text layers, mask painting (quick mask) and Save to
 * Media Bin.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FilePlus, FolderOpen, History as HistoryIcon, Palette, SlidersHorizontal, Sparkles, WandSparkles, X } from 'lucide-react';
import { MediaItem } from '../types';
import { inpaintWithNanoBanana, inpaintWithFlux2Pro, inpaintWithZTurboInpaint, removeBackgroundWithRembg } from '../services/replicateService';
import { editImageWithFalNanoBanana2 } from '../services/falAiService';
import { gradeImageFromPrompt, matchReferenceGrade } from '../services/geminiService';
import { fileToBase64 } from '../utils/helpers';
import FxStackPanel from '../fx/ui/FxStackPanel';
import { FxRenderer } from '../fx/renderer';
import { hasActiveFx, needsNativeHost } from '../fx/registry';
import { renderStackAsync } from '../fx/ofx';
import type { FxStack } from '../fx/types';

import '../workspaces/photo-pro/photoPro.css';
import MenuBar from './photo-pro/MenuBar.tsx';
import type { MenuDef, MenuItem } from './photo-pro/MenuBar.tsx';
import ToolsPanel from './photo-pro/ToolsPanel.tsx';
import OptionsBar from './photo-pro/OptionsBar.tsx';
import type { TextStyle } from './photo-pro/OptionsBar.tsx';
import LayersPanel from './photo-pro/LayersPanel.tsx';
import { AdjustmentsPanel, PropertiesPanel } from './photo-pro/PropertiesPanel.tsx';
import { ColorPanel, Dialog, HistoryPanel, SwatchesPanel } from './photo-pro/panels.tsx';
import type { DialogSpec } from './photo-pro/panels.tsx';
import { PixelStore } from './photo-pro/pixelStore.ts';
import {
  canMergeDown, createDoc, docPixelKeys, docReducer, getActiveLayer, makeAdjustmentLayer, makeRasterLayer,
  makeTextLayer, nextLayerName,
} from './photo-pro/layers.ts';
import type { DocAction, Layer, PhotoDoc, RasterLayer, TextLayer } from './photo-pro/layers.ts';
import { canRedo, canUndo, commit, createHistory, currentState, dropOldest, jumpTo, redo, undo } from './photo-pro/history.ts';
import type { History } from './photo-pro/history.ts';
import { TOOL_INFO, groupOfTool, isPaintTool, isSelectionTool, toolForShortcut } from './photo-pro/tools.ts';
import type { ToolId } from './photo-pro/tools.ts';
import {
  centerView, clampZoom, docToScreen, fitView, formatDocSize, formatZoom, parseZoom, proxyScale, screenToDoc,
  stepZoom, wheelZoomFactor, zoomAt,
} from './photo-pro/viewport.ts';
import type { View } from './photo-pro/viewport.ts';
import {
  CROP_RATIOS, clampRect, dragCropHandle, fitRatioRect, pointsBounds, rectFromDrag, rectIsEmpty, resolveCropRatio,
  roundOutRect, selectionModeFromModifiers, unionRect,
} from './photo-pro/selection.ts';
import type { CropHandle, Point, Rect, SelectionMode } from './photo-pro/selection.ts';
import { ADJUSTMENT_LABELS, defaultAdjustment, lookFromAiFilters } from './photo-pro/adjustments.ts';
import type { AdjustmentType } from './photo-pro/adjustments.ts';
import { DEFAULT_BRUSH, dabSpacing, dabsBounds, interpolateDabs, rgbToHex, stepBrushSize } from './photo-pro/brush.ts';
import type { BrushSettings } from './photo-pro/brush.ts';
import {
  antsPattern, blurCanvas, canvasPayload, checkerTile, cloneCanvas, combineMask, ctx2d, drawLinearGradient,
  featherMask, flipCanvas, fullMask, invertMask, loadImage, makeCanvas, makeDab, maskFromAlpha, renderMaskOutline,
  scaleCanvas, scanMaskBounds, traceShape,
} from './photo-pro/canvasOps.ts';
import type { MaskShape } from './photo-pro/canvasOps.ts';
import { compositeDoc, createPrefixCache, flattenDoc, measureTextLayer, TEXT_LINE_HEIGHT } from './photo-pro/compositor.ts';
import type { CompositeEnv } from './photo-pro/compositor.ts';
import { PHOTO_LIVE, describeDoc, describeLayer, describeLayers, layerPatchFromArgs, resolveLayer } from './photo-pro/mcpModel.ts';
import { registerLiveCommands } from '../mcp/liveCommands';

interface PhotoWorkspaceProps {
  onAddGeneratedMedia?: (item: MediaItem) => void;
  seedImageUrl?: string | null;
  onConsumeSeed?: () => void;
}

type NeuralPreset = {
  id: 'harmonize' | 'portrait_balance' | 'cinematic_pop' | 'dehaze' | 'soft_skin' | 'custom_prompt';
  label: string;
  description: string;
  requiresReference?: boolean;
  aiPrompt?: string;
  fallback?: Record<string, number>;
};

const NEURAL_PRESETS: NeuralPreset[] = [
  { id: 'harmonize', label: 'Harmonisieren', description: 'Farbe und Stimmung an ein Referenzbild angleichen.', requiresReference: true },
  {
    id: 'portrait_balance',
    label: 'Porträt-Balance',
    description: 'Natürliche Hauttöne, weicher Kontrast, saubere Mitteltöne.',
    aiPrompt: 'Create a portrait-balanced grade: natural skin tones, gentle contrast, subtle warmth, clean highlights, avoid oversaturation.',
  },
  {
    id: 'cinematic_pop',
    label: 'Cinematic Pop',
    description: 'Moderner Kinokontrast mit kontrollierter Sättigung.',
    aiPrompt: 'Create a cinematic blockbuster grade with punchy contrast, slightly cool shadows, warm skin highlights, and controlled saturation.',
  },
  { id: 'dehaze', label: 'Dunst entfernen', description: 'Mehr lokaler Kontrast und Klarheit.', fallback: { brightness: 103, contrast: 122, saturate: 108, hue: 0, blur: 0 } },
  { id: 'soft_skin', label: 'Weiche Haut', description: 'Dezente Glättung für Porträts ohne starke Unschärfe.', fallback: { brightness: 102, contrast: 95, saturate: 96, hue: 2, blur: 2 } },
  { id: 'custom_prompt', label: 'Eigener KI-Look', description: 'Eigenen Grading-Prompt schreiben.', aiPrompt: '' },
];

type InpaintModel = 'nano-banana-pro' | 'nano-banana-2-fal' | 'flux-2-pro' | 'z-turbo-inpaint';
type Resolution = '1K' | '2K' | '4K' | 'match_input_image' | '0.5 MP' | '1 MP' | '2 MP' | '4 MP';

type Session = { id: string; history: History<PhotoDoc> };
type FlyPanel = 'history' | 'fx' | 'generative' | 'neural' | null;
type DockState = {
  showColor: boolean;
  colorTab: 'color' | 'swatches';
  showProps: boolean;
  propsTab: 'properties' | 'adjustments';
  showLayers: boolean;
  fly: FlyPanel;
};

const DEFAULT_DOCK: DockState = { showColor: true, colorTab: 'color', showProps: true, propsTab: 'properties', showLayers: true, fly: null };
const DOCK_STORAGE_KEY = 'avpe.photo.dock.v1';
const HISTORY_BYTE_BUDGET = 1.6 * 1024 * 1024 * 1024;

let idCounter = 0;
const uid = (prefix: string) => {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
};

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
};

const readDock = (): DockState => {
  try {
    const raw = window.localStorage.getItem(DOCK_STORAGE_KEY);
    return raw ? { ...DEFAULT_DOCK, ...JSON.parse(raw), fly: null } : DEFAULT_DOCK;
  } catch {
    return DEFAULT_DOCK;
  }
};

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Strg+';
const sc = (keys: string) => keys.replace('Mod+', MOD).replace('Shift+', '⇧').replace('Alt+', '⌥');

type PaintStroke = {
  tool: ToolId;
  target: 'layer' | 'mask';
  mode: 'add' | 'erase' | 'dodge';
  layerId: string | null;
  key: string;
  base: HTMLCanvasElement | undefined;
  working: HTMLCanvasElement;
  buffer: HTMLCanvasElement;
  offset: Point;
  dab: HTMLCanvasElement;
  size: number;
  flow: number;
  opacity: number;
  clip: HTMLCanvasElement | undefined;
  last: Point;
  carry: number;
  cloneOffset: Point | null;
  bounds: Rect | null;
};

type Interaction =
  | { kind: 'pan'; start: Point; view: View }
  | { kind: 'marquee'; start: Point; end: Point; startScreen: Point; mode: SelectionMode; alt: boolean; shift: boolean }
  | { kind: 'lasso'; points: Point[]; mode: SelectionMode }
  | { kind: 'move'; start: Point; layerId: string; origin: Point; base: PhotoDoc }
  | { kind: 'crop'; handle: CropHandle | 'new'; start: Point; rect: Rect }
  | { kind: 'gradient'; start: Point; end: Point }
  | { kind: 'paint' };

const PhotoWorkspace: React.FC<PhotoWorkspaceProps> = ({ onAddGeneratedMedia, seedImageUrl, onConsumeSeed }) => {
  const storeRef = useRef<PixelStore | null>(null);
  storeRef.current ??= new PixelStore();
  const store = storeRef.current;

  // ---------- Documents & history ----------
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [views, setViews] = useState<Record<string, View>>({});
  const session = sessions.find((s) => s.id === activeId) ?? null;
  const doc = session ? currentState(session.history) : null;
  const [liveDoc, setLiveDoc] = useState<PhotoDoc | null>(null);
  const shownDoc = liveDoc ?? doc;
  const view = activeId ? views[activeId] ?? null : null;
  const activeLayer = shownDoc ? getActiveLayer(shownDoc) : null;

  const docRef = useRef<PhotoDoc | null>(doc);
  docRef.current = doc;
  const shownDocRef = useRef<PhotoDoc | null>(shownDoc);
  shownDocRef.current = shownDoc;
  const viewRef = useRef<View | null>(view);
  viewRef.current = view;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // ---------- Tool & UI state ----------
  const [tool, setToolState] = useState<ToolId>('move');
  const [lastUsed, setLastUsed] = useState<Partial<Record<string, ToolId>>>({});
  const [fg, setFg] = useState('#000000');
  const [bg, setBg] = useState('#ffffff');
  const [brush, setBrushState] = useState<BrushSettings>(DEFAULT_BRUSH);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('new');
  const [featherState, setFeather] = useState(0);
  const feather = featherState;
  const [cropRatioId, setCropRatioId] = useState('free');
  const [crop, setCrop] = useState<Rect | null>(null);
  const [autoSelect, setAutoSelect] = useState(false);
  const [quickMask, setQuickMask] = useState(false);
  const [textStyle, setTextStyle] = useState<TextStyle>({ fontFamily: 'Inter, Helvetica, Arial, sans-serif', fontSize: 72, color: '#ffffff', bold: false, italic: false, align: 'left' });
  const [textEdit, setTextEdit] = useState<{ layerId: string; isNew: boolean; draft: string; x: number; y: number; style: TextStyle } | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [dock, setDock] = useState<DockState>(readDock);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [adjMenu, setAdjMenu] = useState<{ x: number; y: number } | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 });
  const [fxVersion, setFxVersion] = useState(0);
  const [fxError, setFxError] = useState<string | null>(null);
  const [taskPrompt, setTaskPrompt] = useState('');

  // Generative / neural (unchanged behaviour of the previous editor)
  const [inpaintPrompt, setInpaintPrompt] = useState('');
  const [inpaintModel, setInpaintModel] = useState<InpaintModel>('nano-banana-pro');
  const [resolution, setResolution] = useState<Resolution>('2K');
  const [expandPadding, setExpandPadding] = useState(128);
  const [expandPrompt, setExpandPrompt] = useState('Extend the scene naturally, matching lighting and style.');
  const [neuralIntensity, setNeuralIntensity] = useState(75);
  const [neuralPrompt, setNeuralPrompt] = useState('Balance skin tones and harmonize palette while preserving detail.');
  const [neuralReference, setNeuralReference] = useState<{ file: File; url: string; base64: string; mimeType: string } | null>(null);

  useEffect(() => {
    if (inpaintModel === 'flux-2-pro') setResolution('match_input_image');
    else setResolution('2K');
  }, [inpaintModel]);

  useEffect(() => {
    try { window.localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify({ ...dock, fly: null })); } catch { /* storage unavailable */ }
  }, [dock]);

  // ---------- Refs for rendering ----------
  const viewportRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileModeRef = useRef<'open' | 'place'>('open');
  const neuralRefInputRef = useRef<HTMLInputElement>(null);
  const compRef = useRef<HTMLCanvasElement | null>(null);
  const compScaleRef = useRef(1);
  const prefixCacheRef = useRef(createPrefixCache());
  const strokeRef = useRef<PaintStroke | null>(null);
  const interRef = useRef<Interaction | null>(null);
  const polyRef = useRef<Point[] | null>(null);
  const pointerRef = useRef<Point | null>(null);
  const pinnedRef = useRef(new Set<string>());
  const cloneSourceRef = useRef<Point | null>(null);
  const lastPaintRef = useRef<Point | null>(null);
  const edgesRef = useRef<{ canvas: HTMLCanvasElement; key: string } | null>(null);
  const antsPhaseRef = useRef(0);
  const clipboardRef = useRef<{ canvas: HTMLCanvasElement; x: number; y: number } | null>(null);
  const fxRendererRef = useRef<FxRenderer | null>(null);
  const fxCacheRef = useRef(new Map<string, { key: string; canvas: HTMLCanvasElement | null }>());
  const fxJobsRef = useRef(new Map<string, { running: boolean; want: RasterLayer | null }>());
  const checkerRef = useRef<CanvasPattern | null>(null);
  const rafRef = useRef<number | null>(null);
  const needRef = useRef({ composite: false, display: false, overlay: false });
  const dpr = typeof window !== 'undefined' ? Math.max(1, window.devicePixelRatio || 1) : 1;

  const statusRef = useRef('');
  const say = useCallback((message: string) => { statusRef.current = message; setStatus(message); }, []);

  // ---------- History commit helpers ----------
  const applyDoc = useCallback((fn: (d: PhotoDoc) => PhotoDoc, label: string, opts: { coalesceKey?: string } = {}) => {
    const id = activeIdRef.current;
    if (!id) return;
    setLiveDoc(null);
    setSessions((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      const cur = currentState(s.history);
      const next = fn(cur);
      if (next === cur) return s;
      return { ...s, history: commit(s.history, next, label, { coalesceKey: opts.coalesceKey }) };
    }));
  }, []);

  const dispatch = useCallback((action: DocAction, label: string, opts?: { coalesceKey?: string }) => {
    applyDoc((d) => docReducer(d, action), label, opts);
  }, [applyDoc]);

  const setHistory = useCallback((fn: (h: History<PhotoDoc>) => History<PhotoDoc>) => {
    const id = activeIdRef.current;
    if (!id) return;
    setLiveDoc(null);
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, history: fn(s.history) } : s)));
  }, []);

  const handleUndo = useCallback(() => setHistory(undo), [setHistory]);
  const handleRedo = useCallback(() => setHistory(redo), [setHistory]);

  // Garbage-collect pixels no history state references; trim history over budget.
  useEffect(() => {
    const live = new Set<string>(pinnedRef.current);
    for (const s of sessions) for (const entry of s.history.entries) docPixelKeys(entry.state, live);
    if (clipboardRef.current) { /* clipboard canvas lives outside the store */ }
    store.gc(live);
    const layerIds = new Set(sessions.flatMap((s) => s.history.entries.flatMap((e) => e.state.layers.map((l) => l.id))));
    for (const id of [...fxCacheRef.current.keys()]) if (!layerIds.has(id)) fxCacheRef.current.delete(id);
    if (store.bytes() > HISTORY_BYTE_BUDGET) {
      const trimmable = sessions.some((s) => s.history.index > 1);
      if (trimmable) {
        setSessions((prev) => prev.map((s) => (s.history.index > 1 ? { ...s, history: dropOldest(s.history, Math.ceil(s.history.index / 4)) } : s)));
        setStatus('Protokoll gekürzt (Speicherbudget).');
      }
    }
  }, [sessions, store]);

  // ---------- View ----------
  const setView = useCallback((next: View | ((v: View) => View)) => {
    const id = activeIdRef.current;
    if (!id) return;
    setViews((prev) => {
      const cur = prev[id] ?? { zoom: 1, panX: 0, panY: 0 };
      const value = typeof next === 'function' ? next(cur) : next;
      return { ...prev, [id]: value };
    });
  }, []);

  const fitToScreen = useCallback(() => {
    const d = docRef.current;
    if (!d || !vpSize.w) return;
    setView(fitView(d.width, d.height, vpSize.w, vpSize.h, 24, true));
  }, [setView, vpSize.w, vpSize.h]);

  const zoomTo = useCallback((zoom: number, anchor?: Point) => {
    const v = viewRef.current;
    if (!v) return;
    const a = anchor ?? { x: vpSize.w / 2, y: vpSize.h / 2 };
    setView(zoomAt(v, clampZoom(zoom), a));
  }, [setView, vpSize.w, vpSize.h]);

  const zoomStep = useCallback((dir: 1 | -1, anchor?: Point) => {
    const v = viewRef.current;
    if (v) zoomTo(stepZoom(v.zoom, dir), anchor);
  }, [zoomTo]);

  const zoomActual = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    setView(centerView(d.width, d.height, vpSize.w, vpSize.h, 1));
  }, [setView, vpSize.w, vpSize.h]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVpSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setVpSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Fit new documents once the viewport is measured.
  useEffect(() => {
    if (!activeId || !doc || views[activeId] || !vpSize.w) return;
    setViews((prev) => ({ ...prev, [activeId]: fitView(doc.width, doc.height, vpSize.w, vpSize.h, 24) }));
  }, [activeId, doc, views, vpSize.w, vpSize.h]);

  // ---------- Smart filters (Lens & Film FX) ----------
  /** Renders an FX stack over a source canvas at full resolution (GPU, plus native OFX via the host). */
  const renderFx = useCallback(async (source: HTMLCanvasElement, stack: FxStack): Promise<HTMLCanvasElement | null> => {
    if (!hasActiveFx(stack) || !source.width || !source.height) return null;
    try {
      if (needsNativeHost(stack)) {
        const result = await renderStackAsync(source, stack, { width: source.width, height: source.height, frameIndex: 0 });
        setFxError(null);
        return result;
      }
      fxRendererRef.current ??= new FxRenderer();
      const result = fxRendererRef.current.render(source, stack, { frameIndex: 0, quality: 'full' });
      setFxError(null);
      // The renderer reuses its canvas; keep a copy at the layer size.
      const out = makeCanvas(source.width, source.height);
      ctx2d(out).drawImage(result as CanvasImageSource, 0, 0, out.width, out.height);
      return out;
    } catch (error) {
      setFxError(error instanceof Error ? error.message : String(error));
      return null;
    }
  }, []);

  useEffect(() => () => {
    fxRendererRef.current?.dispose();
    fxRendererRef.current = null;
  }, []);

  const fxKey = (layer: RasterLayer) => `${layer.pixelKey}|${JSON.stringify(layer.fx)}`;

  const requestFx = useCallback((layer: RasterLayer) => {
    let job = fxJobsRef.current.get(layer.id);
    if (!job) { job = { running: false, want: null }; fxJobsRef.current.set(layer.id, job); }
    job.want = layer;
    if (job.running) return;
    job.running = true;
    const run = async () => {
      while (job!.want) {
        const target = job!.want;
        job!.want = null;
        const source = store.get(target.pixelKey);
        const canvas = source ? await renderFx(source, target.fx) : null;
        fxCacheRef.current.set(target.id, { key: fxKey(target), canvas });
        setFxVersion((v) => v + 1);
      }
      job!.running = false;
    };
    void run();
  }, [renderFx, store]);

  const layerSourceFor = useCallback((layer: RasterLayer, allowStale: boolean) => {
    const stroke = strokeRef.current;
    if (stroke && stroke.target === 'layer' && stroke.layerId === layer.id) return stroke.working;
    const raw = store.get(layer.pixelKey);
    if (!raw || !layer.fxEnabled || !hasActiveFx(layer.fx)) return raw;
    const entry = fxCacheRef.current.get(layer.id);
    const key = fxKey(layer);
    if (entry && entry.key === key) return entry.canvas ?? raw;
    requestFx(layer);
    return allowStale ? (entry?.canvas ?? raw) : raw;
  }, [requestFx, store]);

  /** Wait until every smart filter of `d` is rendered for its current pixels (export, merge). */
  const ensureSmartFilters = useCallback(async (d: PhotoDoc) => {
    for (const layer of d.layers) {
      if (layer.kind !== 'raster' || !layer.fxEnabled || !hasActiveFx(layer.fx)) continue;
      const entry = fxCacheRef.current.get(layer.id);
      if (entry && entry.key === fxKey(layer)) continue;
      const source = store.get(layer.pixelKey);
      const canvas = source ? await renderFx(source, layer.fx) : null;
      fxCacheRef.current.set(layer.id, { key: fxKey(layer), canvas });
    }
  }, [renderFx, store]);

  const exportEnv = useMemo<CompositeEnv>(() => ({ layerSource: (layer) => layerSourceFor(layer, false) }), [layerSourceFor]);

  // ---------- Rendering ----------
  const hiddenIds = useMemo(() => new Set(textEdit && !textEdit.isNew ? [textEdit.layerId] : []), [textEdit]);
  const hiddenRef = useRef(hiddenIds);
  hiddenRef.current = hiddenIds;
  const fxVersionRef = useRef(fxVersion);
  fxVersionRef.current = fxVersion;

  const renderComposite = useCallback(() => {
    const d = shownDocRef.current;
    const v = viewRef.current;
    if (!d || !v) return;
    compRef.current ??= makeCanvas(1, 1);
    const scale = proxyScale(v.zoom, dpr);
    compScaleRef.current = scale;
    const inter = interRef.current;
    const volatileId = strokeRef.current?.target === 'layer' ? strokeRef.current.layerId : inter?.kind === 'move' ? inter.layerId : null;
    compositeDoc(compRef.current, d, { layerSource: (layer) => layerSourceFor(layer, true), fxVersion: fxVersionRef.current, hiddenIds: hiddenRef.current }, scale, {
      cache: prefixCacheRef.current,
      volatileId,
    });
  }, [dpr, layerSourceFor]);

  const drawDisplay = useCallback(() => {
    const canvas = displayRef.current;
    if (!canvas) return;
    const w = vpSize.w;
    const h = vpSize.h;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = ctx2d(canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const d = shownDocRef.current;
    const v = viewRef.current;
    const comp = compRef.current;
    if (!d || !v || !comp) return;
    const x = v.panX;
    const y = v.panY;
    const dw = d.width * v.zoom;
    const dh = d.height * v.zoom;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x + 3, y + 3, dw, dh);
    checkerRef.current ??= ctx.createPattern(checkerTile(8), 'repeat');
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, dw, dh);
    ctx.clip();
    if (checkerRef.current) { ctx.fillStyle = checkerRef.current; ctx.fillRect(x, y, dw, dh); }
    ctx.imageSmoothingEnabled = v.zoom < 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(comp, x, y, dw, dh);
    if (showGrid && v.zoom >= 8) {
      ctx.strokeStyle = 'rgba(128,128,128,0.35)';
      ctx.lineWidth = 1 / dpr;
      ctx.beginPath();
      const x0 = Math.max(0, Math.floor(-x / v.zoom));
      const x1 = Math.min(d.width, Math.ceil((w - x) / v.zoom));
      const y0 = Math.max(0, Math.floor(-y / v.zoom));
      const y1 = Math.min(d.height, Math.ceil((h - y) / v.zoom));
      for (let i = x0; i <= x1; i += 1) { const sx = Math.round(x + i * v.zoom) + 0.5 / dpr; ctx.moveTo(sx, Math.max(0, y)); ctx.lineTo(sx, Math.min(h, y + dh)); }
      for (let j = y0; j <= y1; j += 1) { const sy = Math.round(y + j * v.zoom) + 0.5 / dpr; ctx.moveTo(Math.max(0, x), sy); ctx.lineTo(Math.min(w, x + dw), sy); }
      ctx.stroke();
    }
    ctx.restore();
  }, [dpr, showGrid, vpSize.w, vpSize.h]);

  const toolRef = useRef(tool);
  toolRef.current = tool;
  const brushRef = useRef(brush);
  brushRef.current = brush;
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const quickMaskRef = useRef(quickMask);
  quickMaskRef.current = quickMask;

  const tintMode = quickMask || tool === 'spot-heal';

  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const w = vpSize.w;
    const h = vpSize.h;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = ctx2d(canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const d = shownDocRef.current;
    const v = viewRef.current;
    if (!d || !v) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const toS = (p: Point) => docToScreen(v, p);
    const stroke = strokeRef.current;
    const tint = quickMaskRef.current || toolRef.current === 'spot-heal';
    const maskCanvas = stroke?.target === 'mask' ? stroke.working : store.get(d.selection?.pixelKey);

    // Selection: red tint in mask mode, marching ants otherwise.
    if (maskCanvas && tint) {
      const tmp = makeCanvas(w, h);
      const t = ctx2d(tmp);
      t.imageSmoothingEnabled = v.zoom < 1;
      t.drawImage(maskCanvas, v.panX, v.panY, d.width * v.zoom, d.height * v.zoom);
      t.globalCompositeOperation = 'source-in';
      t.fillStyle = 'rgba(255, 40, 40, 0.5)';
      t.fillRect(0, 0, w, h);
      ctx.drawImage(tmp, 0, 0, w, h);
    } else if (edgesRef.current && d.selection && edgesRef.current.key === d.selection.pixelKey) {
      const edges = edgesRef.current.canvas;
      const tmp = makeCanvas(edges.width, edges.height);
      const t = ctx2d(tmp);
      t.drawImage(edges, 0, 0);
      t.globalCompositeOperation = 'source-in';
      const pattern = t.createPattern(antsPattern(), 'repeat');
      if (pattern) {
        pattern.setTransform(new DOMMatrix().translate(antsPhaseRef.current % 8, 0));
        t.fillStyle = pattern;
        t.fillRect(0, 0, tmp.width, tmp.height);
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, w, h);
    }

    const dashed = (trace: () => void) => {
      ctx.save();
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#000';
      trace(); ctx.stroke();
      ctx.lineDashOffset = 4;
      ctx.strokeStyle = '#fff';
      trace(); ctx.stroke();
      ctx.restore();
    };

    const inter = interRef.current;
    if (inter?.kind === 'marquee') {
      const r = rectFromDrag(inter.start, inter.end, { square: inter.shift && toolRef.current !== 'lasso', fromCenter: inter.alt });
      const a = toS({ x: r.x, y: r.y });
      dashed(() => {
        ctx.beginPath();
        if (toolRef.current === 'marquee-ellipse') ctx.ellipse(a.x + (r.width * v.zoom) / 2, a.y + (r.height * v.zoom) / 2, (r.width * v.zoom) / 2, (r.height * v.zoom) / 2, 0, 0, Math.PI * 2);
        else ctx.rect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, r.width * v.zoom, r.height * v.zoom);
      });
    }
    if (inter?.kind === 'lasso' && inter.points.length > 1) {
      dashed(() => {
        ctx.beginPath();
        inter.points.forEach((p, i) => { const s = toS(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      });
    }
    if (polyRef.current?.length) {
      const pts = polyRef.current;
      const cursor = pointerRef.current;
      dashed(() => {
        ctx.beginPath();
        pts.forEach((p, i) => { const s = toS(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
        if (cursor) ctx.lineTo(cursor.x, cursor.y);
      });
      const first = toS(pts[0]);
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(first.x - 3, first.y - 3, 6, 6);
    }
    if (inter?.kind === 'gradient') {
      const a = toS(inter.start);
      const b = toS(inter.end);
      ctx.save();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
    }
    const c = cropRef.current;
    if (c && toolRef.current === 'crop') {
      const a = toS({ x: c.x, y: c.y });
      const cw = c.width * v.zoom;
      const ch = c.height * v.zoom;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.rect(a.x, a.y, cw, ch);
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 3; i += 1) {
        ctx.moveTo(a.x + (cw * i) / 3, a.y); ctx.lineTo(a.x + (cw * i) / 3, a.y + ch);
        ctx.moveTo(a.x, a.y + (ch * i) / 3); ctx.lineTo(a.x + cw, a.y + (ch * i) / 3);
      }
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, cw, ch);
      ctx.fillStyle = '#fff';
      for (const [hx, hy] of [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]]) {
        ctx.fillRect(a.x + cw * hx - 4, a.y + ch * hy - 4, 8, 8);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.font = '11px sans-serif';
      const label = `B: ${Math.round(c.width)} px  H: ${Math.round(c.height)} px`;
      const tw = ctx.measureText(label).width + 12;
      ctx.fillRect(a.x + cw + 8, a.y + ch + 8, tw, 20);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, a.x + cw + 14, a.y + ch + 22);
      ctx.restore();
    }
    // Active text layer bounds (move/text tools)
    const al = getActiveLayer(d);
    if (al?.kind === 'text' && (toolRef.current === 'move' || toolRef.current === 'text') && !textEditRef.current) {
      const b = measureTextLayer(al);
      const a = toS({ x: b.x, y: b.y });
      ctx.save();
      ctx.strokeStyle = 'rgba(var(--psx-accent-rgb), 1)';
      ctx.strokeStyle = '#4b8df8';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, b.width * v.zoom, b.height * v.zoom);
      ctx.restore();
    }
    // Clone source marker
    if (toolRef.current === 'clone-stamp' && cloneSourceRef.current) {
      const s = toS(cloneSourceRef.current);
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(s.x - 6, s.y); ctx.lineTo(s.x + 6, s.y); ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x, s.y + 6); ctx.stroke();
      ctx.restore();
    }
    // Brush cursor
    const p = pointerRef.current;
    if (p && isPaintTool(toolRef.current) && !spaceRef.current) {
      const r = Math.max(1, (brushRef.current.size * v.zoom) / 2);
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, r - 0.5), 0, Math.PI * 2); ctx.stroke();
      if (r < 4) { ctx.beginPath(); ctx.moveTo(p.x - 5, p.y); ctx.lineTo(p.x + 5, p.y); ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x, p.y + 5); ctx.stroke(); }
      ctx.restore();
    }
  }, [dpr, store, vpSize.w, vpSize.h]);

  const spaceRef = useRef(false);
  const textEditRef = useRef(textEdit);
  textEditRef.current = textEdit;

  const schedule = useCallback((what: { composite?: boolean; display?: boolean; overlay?: boolean }) => {
    const need = needRef.current;
    if (what.composite) need.composite = true;
    if (what.display) need.display = true;
    if (what.overlay) need.overlay = true;
    if (rafRef.current !== null) return;
    // rAF, with a timer fallback for throttled/background windows.
    let timer = 0;
    const run = () => {
      if (rafRef.current === null) return;
      window.cancelAnimationFrame(rafRef.current);
      window.clearTimeout(timer);
      rafRef.current = null;
      const n = { ...needRef.current };
      needRef.current = { composite: false, display: false, overlay: false };
      if (n.composite) renderComposite();
      if (n.composite || n.display) drawDisplay();
      if (n.composite || n.display || n.overlay) drawOverlay();
    };
    rafRef.current = window.requestAnimationFrame(run);
    timer = window.setTimeout(run, 60);
  }, [renderComposite, drawDisplay, drawOverlay]);

  useEffect(() => () => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    needRef.current = { composite: true, display: true, overlay: true };
  }, []);

  const proxy = view ? proxyScale(view.zoom, dpr) : 1;
  useEffect(() => { schedule({ composite: true }); }, [shownDoc, fxVersion, proxy, hiddenIds, schedule]);
  useEffect(() => { schedule({ display: true }); }, [view, vpSize.w, vpSize.h, showGrid, schedule]);
  useEffect(() => { schedule({ overlay: true }); }, [tool, crop, quickMask, textEdit, brush.size, schedule]);

  // Marching ants: outline in screen space, recomputed when selection or view changes.
  const selectionKey = shownDoc?.selection?.pixelKey ?? null;
  useEffect(() => {
    if (!selectionKey || !view || !vpSize.w || tintMode) { edgesRef.current = null; schedule({ overlay: true }); return; }
    const mask = store.get(selectionKey);
    if (!mask) return;
    const id = window.setTimeout(() => {
      const edges = edgesRef.current?.canvas ?? makeCanvas(vpSize.w, vpSize.h);
      edges.width = vpSize.w;
      edges.height = vpSize.h;
      renderMaskOutline(mask, edges, view);
      edgesRef.current = { canvas: edges, key: selectionKey };
      schedule({ overlay: true });
    }, 16);
    return () => window.clearTimeout(id);
  }, [selectionKey, view, vpSize.w, vpSize.h, tintMode, store, schedule]);

  useEffect(() => {
    if (!selectionKey || tintMode) return;
    const timer = window.setInterval(() => { antsPhaseRef.current += 1; schedule({ overlay: true }); }, 140);
    return () => window.clearInterval(timer);
  }, [selectionKey, tintMode, schedule]);

  // ---------- Tool switching ----------
  const setTool = useCallback((next: ToolId) => {
    setToolState(next);
    const group = groupOfTool(next);
    setLastUsed((prev) => (prev[group.id] === next ? prev : { ...prev, [group.id]: next }));
    polyRef.current = null;
  }, []);

  // Crop box appears with the crop tool.
  useEffect(() => {
    if (tool !== 'crop' || !doc) { setCrop(null); return; }
    setCrop((cur) => cur ?? fitRatioRect(doc.width, doc.height, resolveCropRatio(CROP_RATIOS.find((r) => r.id === cropRatioId)?.ratio ?? null, doc.width, doc.height)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, doc?.width, doc?.height]);

  useEffect(() => {
    if (tool !== 'crop' || !doc) return;
    const ratio = resolveCropRatio(CROP_RATIOS.find((r) => r.id === cropRatioId)?.ratio ?? null, doc.width, doc.height);
    if (ratio) setCrop(fitRatioRect(doc.width, doc.height, ratio));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropRatioId]);

  const setBrush = useCallback((patch: Partial<BrushSettings>) => setBrushState((b) => ({ ...b, ...patch })), []);

  // ---------- Documents ----------
  const openSession = useCallback((d: PhotoDoc) => {
    const id = uid('doc');
    setSessions((prev) => [...prev, { id, history: createHistory(d, 'Öffnen') }]);
    setActiveId(id);
    setLiveDoc(null);
    setCrop(null);
  }, []);

  const openImage = useCallback(async (url: string, name: string): Promise<boolean> => {
    try {
      setBusy('Bild wird geöffnet …');
      const img = await loadImage(url);
      const { key, canvas } = store.create(img.naturalWidth || img.width, img.naturalHeight || img.height);
      ctx2d(canvas).drawImage(img, 0, 0);
      const layer = makeRasterLayer(uid('L'), 'Hintergrund', key, canvas.width, canvas.height);
      openSession(createDoc(name, canvas.width, canvas.height, [layer]));
      say(`${name} geöffnet (${canvas.width} × ${canvas.height} px).`);
      return true;
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(null);
    }
  }, [openSession, say, store]);

  const placeImage = useCallback(async (url: string, name: string): Promise<boolean> => {
    const d = docRef.current;
    if (!d) return openImage(url, name);
    try {
      const img = await loadImage(url);
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const scale = Math.min(1, d.width / iw, d.height / ih);
      const w = Math.max(1, Math.round(iw * scale));
      const h = Math.max(1, Math.round(ih * scale));
      const { key, canvas } = store.create(w, h);
      const c = ctx2d(canvas);
      c.imageSmoothingQuality = 'high';
      c.drawImage(img, 0, 0, w, h);
      const layer = makeRasterLayer(uid('L'), name.replace(/\.[a-z0-9]+$/i, ''), key, w, h, Math.round((d.width - w) / 2), Math.round((d.height - h) / 2));
      dispatch({ type: 'add', layer }, 'Platzieren');
      say(`${name} als Ebene platziert.`);
      return true;
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [dispatch, openImage, say, store]);

  const newDocument = useCallback((width: number, height: number, background: string, name = 'Unbenannt-1') => {
    const w = Math.max(1, Math.min(16000, Math.round(width)));
    const h = Math.max(1, Math.min(16000, Math.round(height)));
    const { key, canvas } = store.create(w, h);
    if (background !== 'transparent') {
      const c = ctx2d(canvas);
      c.fillStyle = background;
      c.fillRect(0, 0, w, h);
    }
    openSession(createDoc(name, w, h, [makeRasterLayer(uid('L'), background === 'transparent' ? 'Ebene 1' : 'Hintergrund', key, w, h)]));
  }, [openSession, store]);

  const closeSession = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (activeIdRef.current === id) setActiveId(next.length ? next[next.length - 1].id : null);
      return next;
    });
    setViews((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setTextEdit(null);
  }, []);

  useEffect(() => {
    if (!seedImageUrl) return;
    void openImage(seedImageUrl, 'Seed-Bild.png');
    onConsumeSeed?.();
  }, [seedImageUrl, openImage, onConsumeSeed]);

  const handleFiles = (files: FileList | null | undefined, mode: 'open' | 'place') => {
    const file = files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    if (mode === 'place' && docRef.current) void placeImage(url, file.name);
    else void openImage(url, file.name);
  };

  const pickFile = (mode: 'open' | 'place') => {
    fileModeRef.current = mode;
    fileInputRef.current?.click();
  };

  // ---------- Layer operations ----------
  const requireRaster = (verb: string): RasterLayer | null => {
    const d = docRef.current;
    const layer = d ? getActiveLayer(d) : null;
    if (!layer) { say('Keine Ebene ausgewählt.'); return null; }
    if (layer.kind !== 'raster') { say(`${verb}: Die aktive Ebene ist keine Pixelebene${layer.kind === 'text' ? ' – zuerst rastern' : ''}.`); return null; }
    if (layer.locked) { say(`${verb}: Die Ebene ist fixiert.`); return null; }
    return layer;
  };

  const newLayer = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    const { key } = store.create(d.width, d.height);
    dispatch({ type: 'add', layer: makeRasterLayer(uid('L'), nextLayerName(d), key, d.width, d.height) }, 'Neue Ebene');
  }, [dispatch, store]);

  const duplicateLayer = useCallback(() => {
    const d = docRef.current;
    if (!d?.activeLayerId) return;
    dispatch({ type: 'duplicate', id: d.activeLayerId, newId: uid('L') }, 'Ebene duplizieren');
  }, [dispatch]);

  const deleteLayer = useCallback(() => {
    const d = docRef.current;
    if (!d?.activeLayerId) return;
    dispatch({ type: 'remove', id: d.activeLayerId }, 'Ebene löschen');
  }, [dispatch]);

  const patchLayer = useCallback((id: string, patch: Partial<Layer>, label: string, coalesceKey?: string) => {
    dispatch({ type: 'update', id, patch }, label, { coalesceKey });
  }, [dispatch]);

  /** Composite `layers` alone into a new document-sized raster layer. */
  const rasterizeLayers = useCallback(async (d: PhotoDoc, layers: Layer[], name: string, background?: string) => {
    await ensureSmartFilters(d);
    const canvas = compositeDoc(makeCanvas(d.width, d.height), d, exportEnv, 1, { layers, background: background ?? null });
    const key = store.put(canvas);
    return makeRasterLayer(uid('L'), name, key, d.width, d.height);
  }, [ensureSmartFilters, exportEnv, store]);

  const mergeDown = useCallback(async () => {
    const d = docRef.current;
    if (!d || !canMergeDown(d, d.activeLayerId)) { say('Auf eine Ebene reduzieren ist hier nicht möglich.'); return; }
    const index = d.layers.findIndex((l) => l.id === d.activeLayerId);
    const below = d.layers[index - 1];
    const top = d.layers[index];
    const merged = await rasterizeLayers(d, [below, top], below.name);
    dispatch({ type: 'replace', ids: [below.id, top.id], layer: merged }, 'Auf eine Ebene reduzieren');
  }, [dispatch, rasterizeLayers, say]);

  const mergeVisible = useCallback(async () => {
    const d = docRef.current;
    if (!d) return;
    const visible = d.layers.filter((l) => l.visible);
    if (visible.length < 2) { say('Mindestens zwei sichtbare Ebenen nötig.'); return; }
    const merged = await rasterizeLayers(d, visible, visible[0].name);
    dispatch({ type: 'replace', ids: visible.map((l) => l.id), layer: merged }, 'Sichtbare auf eine Ebene reduzieren');
  }, [dispatch, rasterizeLayers, say]);

  const flattenImage = useCallback(async () => {
    const d = docRef.current;
    if (!d || !d.layers.length) return;
    const merged = await rasterizeLayers(d, d.layers, 'Hintergrund', '#ffffff');
    dispatch({ type: 'replace', ids: d.layers.map((l) => l.id), layer: merged }, 'Auf Hintergrundebene reduzieren');
  }, [dispatch, rasterizeLayers]);

  const rasterizeActive = useCallback(async () => {
    const d = docRef.current;
    const layer = d ? getActiveLayer(d) : null;
    if (!d || !layer || layer.kind === 'raster') return;
    if (layer.kind === 'adjustment') { say('Einstellungsebenen können mit „Auf eine Ebene reduzieren“ angewendet werden.'); return; }
    const flat = await rasterizeLayers(d, [{ ...layer, opacity: 1, blendMode: 'normal' }], layer.name);
    dispatch({ type: 'replace', ids: [layer.id], layer: { ...flat, opacity: layer.opacity, blendMode: layer.blendMode } }, 'Ebene rastern');
  }, [dispatch, rasterizeLayers, say]);

  const addAdjustment = useCallback((type: AdjustmentType) => {
    const d = docRef.current;
    if (!d) return;
    dispatch({ type: 'add', layer: makeAdjustmentLayer(uid('A'), nextLayerName(d, ADJUSTMENT_LABELS[type]), defaultAdjustment(type)) }, `Neue Einstellungsebene: ${ADJUSTMENT_LABELS[type]}`);
    setDock((cur) => ({ ...cur, showProps: true, propsTab: 'properties' }));
    setAdjMenu(null);
  }, [dispatch]);

  /** Replace the active raster layer's pixels by `fn(source)`; the result must be layer-sized. */
  const editPixels = useCallback((verb: string, fn: (source: HTMLCanvasElement, layer: RasterLayer, mask: HTMLCanvasElement | undefined) => HTMLCanvasElement | null) => {
    const layer = requireRaster(verb);
    const d = docRef.current;
    if (!layer || !d) return;
    const source = store.get(layer.pixelKey);
    if (!source) return;
    const result = fn(source, layer, store.get(d.selection?.pixelKey));
    if (!result) return;
    const key = store.put(result);
    dispatch({ type: 'update', id: layer.id, patch: { pixelKey: key, width: result.width, height: result.height } }, verb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, store]);

  const fillSelection = useCallback((color: string) => editPixels('Fläche füllen', (src, layer, mask) => {
    const out = cloneCanvas(src);
    const c = ctx2d(out);
    if (mask) {
      const tmp = makeCanvas(src.width, src.height);
      const t = ctx2d(tmp);
      t.drawImage(mask, -layer.x, -layer.y);
      t.globalCompositeOperation = 'source-in';
      t.fillStyle = color;
      t.fillRect(0, 0, tmp.width, tmp.height);
      c.drawImage(tmp, 0, 0);
    } else {
      c.fillStyle = color;
      c.fillRect(0, 0, out.width, out.height);
    }
    return out;
  }), [editPixels]);

  const clearSelection = useCallback(() => editPixels('Löschen', (src, layer, mask) => {
    if (!mask) return null;
    const out = cloneCanvas(src);
    const c = ctx2d(out);
    c.globalCompositeOperation = 'destination-out';
    c.drawImage(mask, -layer.x, -layer.y);
    return out;
  }), [editPixels]);

  const copySelection = useCallback((cut: boolean) => {
    const layer = requireRaster(cut ? 'Ausschneiden' : 'Kopieren');
    const d = docRef.current;
    if (!layer || !d) return;
    const source = store.get(layer.pixelKey);
    if (!source) return;
    const mask = store.get(d.selection?.pixelKey);
    const bounds = d.selection ? clampRect(roundOutRect(d.selection.bounds), d.width, d.height) : { x: 0, y: 0, width: d.width, height: d.height };
    if (!bounds) return;
    const clip = makeCanvas(bounds.width, bounds.height);
    const c = ctx2d(clip);
    c.drawImage(source, layer.x - bounds.x, layer.y - bounds.y);
    if (mask) {
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(mask, -bounds.x, -bounds.y);
    }
    clipboardRef.current = { canvas: clip, x: bounds.x, y: bounds.y };
    if (cut) clearSelection();
    say(cut ? 'Ausgeschnitten.' : 'Kopiert.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearSelection, say, store]);

  const paste = useCallback((label = 'Einfügen') => {
    const clip = clipboardRef.current;
    const d = docRef.current;
    if (!clip || !d) { say('Die Zwischenablage ist leer.'); return; }
    const key = store.put(cloneCanvas(clip.canvas));
    dispatch({ type: 'add', layer: makeRasterLayer(uid('L'), nextLayerName(d), key, clip.canvas.width, clip.canvas.height, clip.x, clip.y) }, label);
  }, [dispatch, say, store]);

  const layerViaCopy = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    if (!d.selection) { duplicateLayer(); return; }
    copySelection(false);
    paste('Ebene durch Kopie');
  }, [copySelection, duplicateLayer, paste]);

  const flipLayer = useCallback((horizontal: boolean) => editPixels(horizontal ? 'Horizontal spiegeln' : 'Vertikal spiegeln', (src) => flipCanvas(src, horizontal)), [editPixels]);

  const gaussianBlur = useCallback((radius: number) => editPixels('Gaußscher Weichzeichner', (src, layer, mask) => blurCanvas(src, radius, mask, { x: -layer.x, y: -layer.y })), [editPixels]);

  // ---------- Selection ----------
  const commitSelection = useCallback((mask: HTMLCanvasElement | null, bounds: Rect | null, label: string) => {
    if (!mask || rectIsEmpty(bounds)) {
      dispatch({ type: 'selection', selection: null }, label);
      return;
    }
    const key = store.put(mask, 'sel');
    dispatch({ type: 'selection', selection: { pixelKey: key, bounds: bounds! } }, label);
  }, [dispatch, store]);

  const applyShape = useCallback((shape: MaskShape, mode: SelectionMode, label: string, featherOverride?: number) => {
    const d = docRef.current;
    if (!d) return;
    const feather = featherOverride ?? featherState;
    const prev = store.get(d.selection?.pixelKey);
    const effective = prev ? mode : 'new';
    const mask = combineMask(prev, d.width, d.height, shape, effective, feather);
    const shapeBounds = shape.kind === 'poly' ? pointsBounds(shape.points) : shape.rect;
    const bounds = effective === 'new'
      ? clampRect({ x: shapeBounds!.x - feather, y: shapeBounds!.y - feather, width: shapeBounds!.width + feather * 2, height: shapeBounds!.height + feather * 2 }, d.width, d.height)
      : scanMaskBounds(mask);
    commitSelection(mask, bounds, label);
  }, [commitSelection, featherState, store]);

  const selectAll = useCallback(() => {
    const d = docRef.current;
    if (d) commitSelection(fullMask(d.width, d.height), { x: 0, y: 0, width: d.width, height: d.height }, 'Alles auswählen');
  }, [commitSelection]);

  const deselect = useCallback(() => {
    if (docRef.current?.selection) dispatch({ type: 'selection', selection: null }, 'Auswahl aufheben');
  }, [dispatch]);

  const reselect = useCallback(() => {
    const d = docRef.current;
    if (d?.lastSelection && !d.selection) dispatch({ type: 'selection', selection: d.lastSelection }, 'Erneut auswählen');
  }, [dispatch]);

  const inverseSelection = useCallback(() => {
    const d = docRef.current;
    const mask = store.get(d?.selection?.pixelKey);
    if (!d || !mask) return;
    const inv = invertMask(mask);
    commitSelection(inv, scanMaskBounds(inv), 'Auswahl umkehren');
  }, [commitSelection, store]);

  const featherSelection = useCallback((radius: number) => {
    const d = docRef.current;
    const mask = store.get(d?.selection?.pixelKey);
    if (!d || !mask) return;
    const out = featherMask(mask, radius);
    commitSelection(out, clampRect({ x: d.selection!.bounds.x - radius * 2, y: d.selection!.bounds.y - radius * 2, width: d.selection!.bounds.width + radius * 4, height: d.selection!.bounds.height + radius * 4 }, d.width, d.height), 'Weiche Auswahlkante');
  }, [commitSelection, store]);

  const flattenedPayload = useCallback(async (d: PhotoDoc, maxSide?: number) => {
    await ensureSmartFilters(d);
    let flat = flattenDoc(d, exportEnv);
    if (maxSide && Math.max(flat.width, flat.height) > maxSide) {
      const s = maxSide / Math.max(flat.width, flat.height);
      flat = scaleCanvas(flat, flat.width * s, flat.height * s);
    }
    return { canvas: flat, payload: canvasPayload(flat) };
  }, [ensureSmartFilters, exportEnv]);

  /** AI subject selection via background removal (Replicate rembg). */
  const selectSubject = useCallback(async (modeOverride?: SelectionMode): Promise<boolean> => {
    const d = docRef.current;
    if (!d) return false;
    const combine = modeOverride ?? selectionMode;
    setBusy('Motiv wird ausgewählt …');
    try {
      const { payload } = await flattenedPayload(d, 2048);
      if (!payload) throw new Error('Bild konnte nicht gelesen werden.');
      const item = await removeBackgroundWithRembg({ base64: payload.base64, mimeType: payload.mimeType });
      const img = await loadImage(item.url);
      const subject = maskFromAlpha(img, d.width, d.height);
      const prev = store.get(docRef.current?.selection?.pixelKey);
      let mask = subject;
      if (prev && combine !== 'new') {
        mask = cloneCanvas(prev);
        const c = ctx2d(mask);
        c.globalCompositeOperation = combine === 'subtract' ? 'destination-out' : combine === 'intersect' ? 'destination-in' : 'source-over';
        c.drawImage(subject, 0, 0);
      }
      const bounds = scanMaskBounds(mask);
      if (!bounds) { say('Kein Motiv erkannt.'); return false; }
      commitSelection(mask, bounds, 'Motiv auswählen');
      say('Motiv ausgewählt.');
      return true;
    } catch (error) {
      say(`Motiv auswählen fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      setBusy(null);
    }
  }, [commitSelection, flattenedPayload, say, selectionMode, store]);

  // ---------- Generative fill / heal / expand ----------
  const runInpaint = useCallback(async (promptOverride: string | undefined, opts: { label: string; layerName: string; docOverride?: PhotoDoc; model?: InpaintModel } = { label: 'Generative Füllung', layerName: 'Generative Füllung' }): Promise<boolean> => {
    const d = opts.docOverride ?? docRef.current;
    if (!d) return false;
    const mask = store.get(d.selection?.pixelKey);
    if (!d.selection || !mask) { say('Zuerst eine Auswahl erstellen (oder im Maskierungsmodus malen).'); return false; }
    const model = opts.model ?? inpaintModel;
    const res: Resolution = opts.model ? (opts.model === 'flux-2-pro' ? 'match_input_image' : '2K') : resolution;
    setBusy(`${opts.label} …`);
    try {
      await ensureSmartFilters(d);
      const flat = flattenDoc(d, exportEnv);
      const fctx = ctx2d(flat);
      fctx.globalCompositeOperation = 'destination-out';
      fctx.drawImage(mask, 0, 0);
      const maskedDataUrl = flat.toDataURL('image/png');
      const prompt = promptOverride || inpaintPrompt || 'Reconstruct the masked area seamlessly.';
      const item = model === 'nano-banana-pro'
        ? await inpaintWithNanoBanana(prompt, maskedDataUrl, res as '1K' | '2K' | '4K')
        : model === 'nano-banana-2-fal'
          ? await (async () => {
            const match = maskedDataUrl.match(/^data:(.*?);base64,(.*)$/);
            const payload = match && match[1] && match[2]
              ? { mimeType: match[1], base64: match[2] }
              : { mimeType: 'image/png', base64: (maskedDataUrl.split(',')[1] || '') };
            const images = await editImageWithFalNanoBanana2(prompt, payload, { resolution: res as '1K' | '2K' | '4K' });
            if (!images.length) throw new Error('FAL Nano Banana 2 Edit returned no images.');
            return images[0];
          })()
          : model === 'flux-2-pro'
            ? await inpaintWithFlux2Pro(prompt, maskedDataUrl, res as 'match_input_image' | '0.5 MP' | '1 MP' | '2 MP' | '4 MP')
            : await inpaintWithZTurboInpaint(prompt, maskedDataUrl);
      const img = await loadImage(item.url);
      const { key, canvas } = store.create(d.width, d.height);
      const c = ctx2d(canvas);
      c.imageSmoothingQuality = 'high';
      c.drawImage(img, 0, 0, d.width, d.height);
      // Keep only the selected area (slightly feathered) so the rest stays untouched.
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(featherMask(mask, 1.5), 0, 0);
      dispatch({ type: 'add', layer: makeRasterLayer(uid('L'), opts.layerName, key, d.width, d.height) }, opts.label);
      say(`${opts.label} fertig – als neue Ebene eingefügt.`);
      return true;
    } catch (e) {
      say(`${opts.label} fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy(null);
    }
  }, [dispatch, ensureSmartFilters, exportEnv, inpaintModel, inpaintPrompt, resolution, say, store]);

  const handleHeal = useCallback(() => runInpaint('Reconstruct the masked area seamlessly.', { label: 'Bereichsreparatur', layerName: 'Reparatur' }), [runInpaint]);

  /** Grows the canvas by `pad` on every side and selects the new border (ready for generative fill). */
  const expandCanvas = useCallback((pad: number): PhotoDoc | null => {
    const d = docRef.current;
    if (!d) { say('Zuerst ein Bild öffnen.'); return null; }
    const p = Math.max(0, Math.round(pad));
    if (p <= 0) { say('Der Rand muss größer als 0 sein.'); return null; }
    const expanded = docReducer(d, { type: 'expand', left: p, top: p, right: p, bottom: p });
    const mask = fullMask(expanded.width, expanded.height);
    ctx2d(mask).clearRect(p, p, d.width, d.height);
    const key = store.put(mask, 'sel');
    const next = docReducer(expanded, { type: 'selection', selection: { pixelKey: key, bounds: { x: 0, y: 0, width: expanded.width, height: expanded.height } } });
    applyDoc(() => next, 'Arbeitsfläche erweitern');
    setViews((prev) => { const copy = { ...prev }; if (activeIdRef.current) delete copy[activeIdRef.current]; return copy; });
    say('Arbeitsfläche erweitert – der neue Rand ist ausgewählt.');
    return next;
  }, [applyDoc, say, store]);

  const expandAndFill = useCallback(async () => {
    if (busy) return;
    const next = expandCanvas(expandPadding);
    if (next) await runInpaint(expandPrompt || 'Extend the scene naturally.', { label: 'Generatives Erweitern', layerName: 'Erweiterung', docOverride: next });
  }, [busy, expandCanvas, expandPadding, expandPrompt, runInpaint]);

  // ---------- Neural looks ----------
  const handleNeuralReferenceSelect = async (file: File) => {
    const base64 = await fileToBase64(file);
    const url = URL.createObjectURL(file);
    setNeuralReference({ file, url, base64, mimeType: file.type || 'image/png' });
    say('Referenz für „Harmonisieren“ geladen.');
  };

  const applyNeuralPreset = async (preset: NeuralPreset) => {
    const d = docRef.current;
    if (!d) { say('Zuerst ein Bild öffnen.'); return; }
    if (preset.requiresReference && !neuralReference) { say('Für „Harmonisieren“ ein Referenzbild laden.'); return; }
    setBusy(`${preset.label} …`);
    try {
      let look = null as ReturnType<typeof lookFromAiFilters> | null;
      if (preset.fallback) {
        look = lookFromAiFilters(preset.fallback);
      } else {
        const { payload } = await flattenedPayload(d, 2048);
        if (!payload) throw new Error('Bild konnte nicht gelesen werden.');
        if (preset.id === 'harmonize' && neuralReference) {
          const result = await matchReferenceGrade(payload.base64, payload.mimeType, neuralReference.base64, neuralReference.mimeType);
          look = lookFromAiFilters(result.filters);
        } else {
          const prompt = preset.id === 'custom_prompt' ? (neuralPrompt.trim() || preset.description) : preset.aiPrompt!;
          const result = await gradeImageFromPrompt(payload.base64, payload.mimeType, prompt);
          look = lookFromAiFilters(result.filters);
        }
      }
      if (!look) { say('Es wurden keine Korrekturen erzeugt.'); return; }
      const layer = { ...makeAdjustmentLayer(uid('A'), `Neural: ${preset.label}`, look), opacity: Math.max(0, Math.min(100, neuralIntensity)) / 100 };
      dispatch({ type: 'add', layer }, `Neural-Filter: ${preset.label}`);
      say(`${preset.label} als Einstellungsebene angelegt (Deckkraft = Intensität).`);
    } catch (error) {
      say(`Neural-Filter fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  // ---------- Smart filter bake ----------
  /** Bakes the active layer's FX stack into its pixels (like "Apply" for adjustments). */
  const applyFx = async (layerOverride?: RasterLayer): Promise<boolean> => {
    const layer = layerOverride ?? requireRaster('Effekte übernehmen');
    if (!layer || !hasActiveFx(layer.fx)) return false;
    const source = store.get(layer.pixelKey);
    if (!source) return false;
    const result = await renderFx(source, layer.fx);
    if (!result) return false;
    const sized = result.width === source.width && result.height === source.height ? result : scaleCanvas(result, source.width, source.height);
    const key = store.put(sized);
    dispatch({ type: 'update', id: layer.id, patch: { pixelKey: key, fx: [] } }, 'Smartfilter anwenden');
    say('Effekte ins Bild übernommen.');
    return true;
  };

  // ---------- Crop & image size ----------
  const commitCrop = useCallback(() => {
    const c = cropRef.current;
    const d = docRef.current;
    if (!c || !d) return;
    const r = { x: Math.round(c.x), y: Math.round(c.y), width: Math.max(1, Math.round(c.width)), height: Math.max(1, Math.round(c.height)) };
    if (r.x === 0 && r.y === 0 && r.width === d.width && r.height === d.height) { setCrop(null); setTool('move'); return; }
    dispatch({ type: 'crop', rect: r }, 'Freistellen');
    setCrop(null);
    setViews((prev) => { const copy = { ...prev }; if (activeIdRef.current) delete copy[activeIdRef.current]; return copy; });
    setTool('move');
  }, [dispatch, setTool]);

  const cancelCrop = useCallback(() => {
    const d = docRef.current;
    if (d) setCrop(fitRatioRect(d.width, d.height, null));
  }, []);

  const cropToSelection = useCallback(() => {
    const d = docRef.current;
    if (!d?.selection) return;
    const r = clampRect(roundOutRect(d.selection.bounds), d.width, d.height);
    if (!r) return;
    dispatch({ type: 'crop', rect: r }, 'Freistellen');
    setViews((prev) => { const copy = { ...prev }; if (activeIdRef.current) delete copy[activeIdRef.current]; return copy; });
  }, [dispatch]);

  const resizeImage = useCallback((width: number, height: number) => {
    const d = docRef.current;
    if (!d) return;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const sx = w / d.width;
    const sy = h / d.height;
    const layers = d.layers.map((layer): Layer => {
      if (layer.kind === 'raster') {
        const src = store.get(layer.pixelKey);
        const nw = Math.max(1, Math.round(layer.width * sx));
        const nh = Math.max(1, Math.round(layer.height * sy));
        const key = src ? store.put(scaleCanvas(src, nw, nh)) : layer.pixelKey;
        return { ...layer, pixelKey: key, width: nw, height: nh, x: Math.round(layer.x * sx), y: Math.round(layer.y * sy) };
      }
      if (layer.kind === 'text') return { ...layer, x: layer.x * sx, y: layer.y * sy, fontSize: Math.max(1, layer.fontSize * Math.min(sx, sy)) };
      return layer;
    });
    applyDoc((cur) => ({ ...cur, width: w, height: h, layers, selection: null, lastSelection: null }), 'Bildgröße');
    setViews((prev) => { const copy = { ...prev }; if (activeIdRef.current) delete copy[activeIdRef.current]; return copy; });
  }, [applyDoc, store]);

  // ---------- Export ----------
  const exportFlattened = useCallback(async () => {
    const d = docRef.current;
    if (!d) return null;
    await ensureSmartFilters(d);
    return flattenDoc(d, exportEnv);
  }, [ensureSmartFilters, exportEnv]);

  const exportToMedia = async (fileName?: string): Promise<MediaItem | null> => {
    const output = await exportFlattened();
    if (!output) return null;
    let url: string;
    try {
      url = output.toDataURL('image/png');
    } catch {
      say('Export fehlgeschlagen: Das Bild enthält Pixel einer fremden Quelle (CORS).');
      return null;
    }
    const item: MediaItem = {
      id: `photo-${Date.now()}`,
      name: fileName ? (/\.png$/i.test(fileName) ? fileName : `${fileName}.png`) : `photo_edit_${Date.now()}.png`,
      type: 'image',
      url,
      source: 'generated',
      generatedBy: 'Photo Editor',
    };
    if (onAddGeneratedMedia) onAddGeneratedMedia(item);
    say('In Media Bin gespeichert.');
    return item;
  };

  const downloadPng = async () => {
    const output = await exportFlattened();
    const d = docRef.current;
    if (!output || !d) return;
    output.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${d.name.replace(/\.[a-z0-9]+$/i, '')}.png`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
  };

  // ---------- Text editing ----------
  const startTextEdit = useCallback((layer: TextLayer | null, at?: Point) => {
    if (layer) {
      setTextEdit({ layerId: layer.id, isNew: false, draft: layer.text, x: layer.x, y: layer.y, style: { fontFamily: layer.fontFamily, fontSize: layer.fontSize, color: layer.color, bold: layer.bold, italic: layer.italic, align: layer.align } });
      dispatch({ type: 'select', id: layer.id }, 'Ebene auswählen');
      return;
    }
    if (!at) return;
    setTextEdit({ layerId: uid('T'), isNew: true, draft: '', x: Math.round(at.x), y: Math.round(at.y - textStyle.fontSize * 0.6), style: { ...textStyle } });
  }, [dispatch, textStyle]);

  const finishTextEdit = useCallback(() => {
    const edit = textEditRef.current;
    if (!edit) return;
    setTextEdit(null);
    const text = edit.draft.replace(/\s+$/, '');
    const name = text.split('\n')[0].slice(0, 40) || 'Text';
    if (edit.isNew) {
      if (!text.trim()) return;
      dispatch({ type: 'add', layer: makeTextLayer(edit.layerId, edit.x, edit.y, { ...edit.style, text, name }) }, 'Textebene erstellen');
      return;
    }
    if (!text.trim()) { dispatch({ type: 'remove', id: edit.layerId }, 'Ebene löschen'); return; }
    dispatch({ type: 'update', id: edit.layerId, patch: { text, name, ...edit.style } }, 'Text bearbeiten');
  }, [dispatch]);

  const onTextStyle = useCallback((patch: Partial<TextStyle>, field: string) => {
    setTextStyle((s) => ({ ...s, ...patch }));
    if (textEditRef.current) { setTextEdit((e) => (e ? { ...e, style: { ...e.style, ...patch } } : e)); return; }
    const d = docRef.current;
    const layer = d ? getActiveLayer(d) : null;
    if (layer?.kind === 'text' && !layer.locked) dispatch({ type: 'update', id: layer.id, patch }, 'Zeichen ändern', { coalesceKey: `char:${layer.id}:${field}` });
  }, [dispatch]);

  useEffect(() => { if (tool !== 'text' && textEditRef.current) finishTextEdit(); }, [tool, finishTextEdit]);

  // ---------- Painting ----------
  const recompose = (st: PaintStroke, rect: Rect) => {
    const r = clampRect(rect, st.working.width, st.working.height);
    if (!r) return;
    const w = ctx2d(st.working);
    w.save();
    w.beginPath();
    w.rect(r.x, r.y, r.width, r.height);
    w.clip();
    w.globalAlpha = 1;
    if (st.base) {
      w.globalCompositeOperation = 'copy';
      w.drawImage(st.base, 0, 0);
    } else {
      w.clearRect(r.x, r.y, r.width, r.height);
    }
    let src: CanvasImageSource = st.buffer;
    let sx = 0;
    let sy = 0;
    if (st.clip) {
      const tmp = makeCanvas(r.width, r.height);
      const t = ctx2d(tmp);
      t.drawImage(st.buffer, -r.x, -r.y);
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(st.clip, -r.x - st.offset.x, -r.y - st.offset.y);
      src = tmp;
      sx = r.x;
      sy = r.y;
    }
    w.globalAlpha = st.opacity;
    if (st.mode === 'erase') w.globalCompositeOperation = 'destination-out';
    else if (st.mode === 'dodge') w.globalCompositeOperation = 'soft-light';
    else w.globalCompositeOperation = 'source-over';
    w.drawImage(src, sx, sy);
    if (st.mode === 'dodge' && st.base) {
      w.globalAlpha = 1;
      w.globalCompositeOperation = 'destination-in';
      w.drawImage(st.base, 0, 0);
    }
    w.restore();
  };

  const stampDabs = (st: PaintStroke, points: Point[]) => {
    if (!points.length) return;
    const local = points.map((p) => ({ x: p.x - st.offset.x, y: p.y - st.offset.y }));
    const b = ctx2d(st.buffer);
    const d = st.dab.width;
    const r = d / 2;
    b.save();
    b.globalAlpha = st.flow;
    for (const q of local) {
      if (st.cloneOffset && st.base) {
        const tmp = makeCanvas(d, d);
        const t = ctx2d(tmp);
        t.drawImage(st.base, q.x - st.cloneOffset.x - r, q.y - st.cloneOffset.y - r, d, d, 0, 0, d, d);
        t.globalCompositeOperation = 'destination-in';
        t.drawImage(st.dab, 0, 0);
        b.drawImage(tmp, q.x - r, q.y - r);
      } else {
        b.drawImage(st.dab, q.x - r, q.y - r);
      }
    }
    b.restore();
    const dirty = dabsBounds(local, st.size);
    if (dirty) recompose(st, dirty);
    const docDirty = dabsBounds(points, st.size);
    st.bounds = unionRect(st.bounds, docDirty);
    schedule(st.target === 'layer' ? { composite: true } : { overlay: true });
  };

  const beginPaint = (p: Point, e: React.PointerEvent): boolean => {
    const d = docRef.current;
    if (!d) return false;
    const t = toolRef.current;
    const b = brushRef.current;
    const maskTarget = quickMaskRef.current || t === 'spot-heal';
    let st: PaintStroke;
    if (maskTarget) {
      if (!['brush', 'eraser', 'spot-heal'].includes(t)) { say('Im Maskierungsmodus malen Pinsel und Radiergummi die Auswahl.'); return false; }
      const prevKey = d.selection?.pixelKey;
      const base = store.get(prevKey);
      const { key, canvas } = base ? store.copy(prevKey!, 'sel') : store.create(d.width, d.height, 'sel');
      st = {
        tool: t, target: 'mask', mode: t === 'eraser' ? 'erase' : 'add', layerId: null, key, base, working: canvas,
        buffer: makeCanvas(canvas.width, canvas.height), offset: { x: 0, y: 0 }, dab: makeDab(b.size, b.hardness, '#ffffff'),
        size: b.size, flow: t === 'spot-heal' ? 1 : b.flow, opacity: t === 'spot-heal' ? 1 : b.opacity, clip: undefined, last: p, carry: 0, cloneOffset: null, bounds: d.selection?.bounds ?? null,
      };
    } else {
      const layer = requireRaster(TOOL_INFO[t].label);
      if (!layer) return false;
      let cloneOffset: Point | null = null;
      if (t === 'clone-stamp') {
        if (e.altKey) { cloneSourceRef.current = p; say('Kopierquelle festgelegt.'); schedule({ overlay: true }); return false; }
        if (!cloneSourceRef.current) { say('Alt+Klick legt die Kopierquelle fest.'); return false; }
        cloneOffset = { x: p.x - cloneSourceRef.current.x, y: p.y - cloneSourceRef.current.y };
      }
      const base = store.get(layer.pixelKey);
      const { key, canvas } = store.copy(layer.pixelKey);
      const color = t === 'brush' ? fg : t === 'burn' ? '#000000' : '#ffffff';
      st = {
        tool: t, target: 'layer', mode: t === 'eraser' ? 'erase' : t === 'dodge' || t === 'burn' ? 'dodge' : 'add', layerId: layer.id, key, base, working: canvas,
        buffer: makeCanvas(canvas.width, canvas.height), offset: { x: layer.x, y: layer.y }, dab: makeDab(b.size, b.hardness, color),
        size: b.size, flow: t === 'dodge' || t === 'burn' ? 1 : b.flow, opacity: t === 'dodge' || t === 'burn' ? b.opacity * 0.6 : b.opacity,
        clip: store.get(d.selection?.pixelKey), last: p, carry: 0, cloneOffset, bounds: null,
      };
    }
    pinnedRef.current.add(st.key);
    strokeRef.current = st;
    const from = e.shiftKey && lastPaintRef.current ? lastPaintRef.current : null;
    if (from) {
      st.last = from;
      paintTo(p);
    } else {
      stampDabs(st, [p]);
    }
    return true;
  };

  const paintTo = (p: Point) => {
    const st = strokeRef.current;
    if (!st) return;
    const { points, carry } = interpolateDabs(st.last, p, dabSpacing(st.size), st.carry);
    st.last = p;
    st.carry = carry;
    stampDabs(st, points);
  };

  const endPaint = () => {
    const st = strokeRef.current;
    if (!st) return;
    strokeRef.current = null;
    lastPaintRef.current = st.last;
    if (st.target === 'layer' && st.layerId) {
      dispatch({ type: 'update', id: st.layerId, patch: { pixelKey: st.key } }, TOOL_INFO[st.tool].label.replace(/-Werkzeug$|-Pinsel \(KI\)$/, ''));
    } else {
      const bounds = st.mode === 'erase' ? scanMaskBounds(st.working) : clampRect(st.bounds ?? { x: 0, y: 0, width: 0, height: 0 }, st.working.width, st.working.height);
      if (!bounds) dispatch({ type: 'selection', selection: null }, 'Maskierungsmodus');
      else dispatch({ type: 'selection', selection: { pixelKey: st.key, bounds } }, st.tool === 'spot-heal' ? 'Bereichsreparatur-Pinsel' : 'Maskierungsmodus');
    }
    window.setTimeout(() => pinnedRef.current.delete(st.key), 0);
  };

  const applyGradient = (from: Point, to: Point) => {
    editPixels('Verlauf', (src, layer, mask) => {
      const tmp = makeCanvas(src.width, src.height);
      const t = ctx2d(tmp);
      drawLinearGradient(t, { x: from.x - layer.x, y: from.y - layer.y }, { x: to.x - layer.x, y: to.y - layer.y }, fg, bg, tmp.width, tmp.height);
      if (mask) { t.globalCompositeOperation = 'destination-in'; t.drawImage(mask, -layer.x, -layer.y); }
      const out = cloneCanvas(src);
      const o = ctx2d(out);
      o.globalAlpha = brushRef.current.opacity;
      o.drawImage(tmp, 0, 0);
      return out;
    });
  };

  // ---------- Pointer input ----------
  const localPoint = (e: { clientX: number; clientY: number }): Point => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const hitLayer = (d: PhotoDoc, p: Point): Layer | null => {
    for (let i = d.layers.length - 1; i >= 0; i -= 1) {
      const layer = d.layers[i];
      if (!layer.visible) continue;
      if (layer.kind === 'text') {
        const b = measureTextLayer(layer);
        if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) return layer;
      } else if (layer.kind === 'raster') {
        const lx = Math.floor(p.x - layer.x);
        const ly = Math.floor(p.y - layer.y);
        if (lx < 0 || ly < 0 || lx >= layer.width || ly >= layer.height) continue;
        const src = store.get(layer.pixelKey);
        if (!src) continue;
        const probe = makeCanvas(1, 1);
        const c = ctx2d(probe, true);
        c.drawImage(src, lx, ly, 1, 1, 0, 0, 1, 1);
        if (c.getImageData(0, 0, 1, 1).data[3] > 10) return layer;
      }
    }
    return null;
  };

  const cropHandleAt = (s: Point): CropHandle | null => {
    const c = cropRef.current;
    const v = viewRef.current;
    if (!c || !v) return null;
    const a = docToScreen(v, { x: c.x, y: c.y });
    const b = docToScreen(v, { x: c.x + c.width, y: c.y + c.height });
    const tol = 8;
    const nearX = (x: number) => Math.abs(s.x - x) <= tol;
    const nearY = (y: number) => Math.abs(s.y - y) <= tol;
    const inX = s.x > a.x - tol && s.x < b.x + tol;
    const inY = s.y > a.y - tol && s.y < b.y + tol;
    const n = nearY(a.y) && inX; const so = nearY(b.y) && inX; const w = nearX(a.x) && inY; const e = nearX(b.x) && inY;
    if (n && w) return 'nw'; if (n && e) return 'ne'; if (so && w) return 'sw'; if (so && e) return 'se';
    if (n) return 'n'; if (so) return 's'; if (w) return 'w'; if (e) return 'e';
    if (s.x > a.x && s.x < b.x && s.y > a.y && s.y < b.y) return 'move';
    return null;
  };

  const closePolygon = () => {
    const pts = polyRef.current;
    polyRef.current = null;
    if (pts && pts.length >= 3) applyShape({ kind: 'poly', points: pts }, polyModeRef.current, 'Polygon-Lasso');
    schedule({ overlay: true });
  };
  const polyModeRef = useRef<SelectionMode>('new');

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = docRef.current;
    const v = viewRef.current;
    if (!d || !v) return;
    if (e.button === 2) return;
    viewportRef.current?.focus({ preventScroll: true });
    const s = localPoint(e);
    const p = screenToDoc(v, s);
    const t = tool;
    if (e.button === 1 || spaceRef.current || t === 'hand') {
      interRef.current = { kind: 'pan', start: s, view: v };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (textEditRef.current) { finishTextEdit(); return; }
    const hasSel = Boolean(d.selection);
    const mode = selectionModeFromModifiers(selectionMode, e.shiftKey, e.altKey, hasSel);
    switch (t) {
      case 'zoom':
        zoomStep(e.altKey ? -1 : 1, s);
        return;
      case 'eyedropper': {
        const comp = compRef.current;
        if (!comp) return;
        const scale = compScaleRef.current;
        const px = ctx2d(comp).getImageData(Math.floor(p.x * scale), Math.floor(p.y * scale), 1, 1).data;
        const hex = rgbToHex(px[0], px[1], px[2]);
        if (e.altKey) setBg(hex); else setFg(hex);
        say(`Farbe aufgenommen: ${hex}`);
        return;
      }
      case 'marquee-rect':
      case 'marquee-ellipse':
        interRef.current = { kind: 'marquee', start: p, end: p, startScreen: s, mode, alt: false, shift: false };
        break;
      case 'lasso':
        interRef.current = { kind: 'lasso', points: [p], mode };
        break;
      case 'lasso-poly': {
        if (!polyRef.current) { polyRef.current = [p]; polyModeRef.current = mode; schedule({ overlay: true }); return; }
        const first = docToScreen(v, polyRef.current[0]);
        if (polyRef.current.length >= 3 && Math.hypot(first.x - s.x, first.y - s.y) < 8) { closePolygon(); return; }
        polyRef.current.push(p);
        schedule({ overlay: true });
        return;
      }
      case 'object-select':
        void selectSubject();
        return;
      case 'move': {
        let layer = getActiveLayer(d);
        if (autoSelect || e.metaKey || e.ctrlKey) {
          const hit = hitLayer(d, p);
          if (hit) { layer = hit; if (hit.id !== d.activeLayerId) dispatch({ type: 'select', id: hit.id }, 'Ebene auswählen'); }
        }
        if (!layer || layer.kind === 'adjustment') return;
        if (layer.locked) { say('Die Ebene ist fixiert.'); return; }
        const base = docReducer(d, { type: 'select', id: layer.id });
        interRef.current = { kind: 'move', start: p, layerId: layer.id, origin: { x: layer.x, y: layer.y }, base };
        break;
      }
      case 'crop': {
        const handle = cropHandleAt(s);
        const c = cropRef.current ?? { x: 0, y: 0, width: d.width, height: d.height };
        interRef.current = handle ? { kind: 'crop', handle, start: p, rect: c } : { kind: 'crop', handle: 'new', start: p, rect: c };
        break;
      }
      case 'gradient':
        if (!requireRaster('Verlauf')) return;
        interRef.current = { kind: 'gradient', start: p, end: p };
        break;
      case 'text': {
        const hit = hitLayer(d, p);
        if (hit?.kind === 'text') {
          if (hit.locked) { say('Die Ebene ist fixiert.'); return; }
          startTextEdit(hit);
        } else {
          startTextEdit(null, p);
        }
        return;
      }
      default:
        if (isPaintTool(t)) {
          if (!beginPaint(p, e)) return;
          interRef.current = { kind: 'paint' };
        }
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    schedule({ overlay: true });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = viewRef.current;
    if (!v) return;
    const s = localPoint(e);
    pointerRef.current = s;
    const inter = interRef.current;
    if (!inter) { if (isPaintTool(tool) || polyRef.current) schedule({ overlay: true }); return; }
    const p = screenToDoc(v, s);
    switch (inter.kind) {
      case 'pan':
        setView({ ...inter.view, panX: inter.view.panX + (s.x - inter.start.x), panY: inter.view.panY + (s.y - inter.start.y) });
        return;
      case 'marquee':
        inter.end = p; inter.alt = e.altKey; inter.shift = e.shiftKey;
        break;
      case 'lasso':
        inter.points.push(p);
        break;
      case 'move': {
        let dx = p.x - inter.start.x;
        let dy = p.y - inter.start.y;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        setLiveDoc(docReducer(inter.base, { type: 'update', id: inter.layerId, patch: { x: Math.round(inter.origin.x + dx), y: Math.round(inter.origin.y + dy) } }));
        return;
      }
      case 'crop': {
        const d = docRef.current;
        if (!d) return;
        const ratio = resolveCropRatio(CROP_RATIOS.find((r) => r.id === cropRatioId)?.ratio ?? null, d.width, d.height);
        const next = inter.handle === 'new'
          ? rectFromDrag(inter.start, p, { ratio: ratio ?? (e.shiftKey ? 1 : null) })
          : dragCropHandle(inter.rect, inter.handle, p.x - inter.start.x, p.y - inter.start.y, ratio ?? (e.shiftKey && inter.handle.length === 2 ? inter.rect.width / Math.max(1, inter.rect.height) : null));
        if (next.width >= 1 && next.height >= 1) setCrop(next);
        return;
      }
      case 'gradient':
        inter.end = e.shiftKey ? (Math.abs(p.x - inter.start.x) > Math.abs(p.y - inter.start.y) ? { x: p.x, y: inter.start.y } : { x: inter.start.x, y: p.y }) : p;
        break;
      case 'paint':
        paintTo(p);
        break;
      default:
        break;
    }
    schedule({ overlay: true });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const inter = interRef.current;
    interRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!inter) return;
    const d = docRef.current;
    switch (inter.kind) {
      case 'marquee': {
        const v = viewRef.current!;
        const end = docToScreen(v, inter.end);
        if (Math.hypot(end.x - inter.startScreen.x, end.y - inter.startScreen.y) < 3) {
          if (inter.mode === 'new') deselect();
          break;
        }
        const rect = rectFromDrag(inter.start, inter.end, { square: inter.shift && !(inter.mode === 'add'), fromCenter: inter.alt && inter.mode !== 'subtract' });
        const shape: MaskShape = { kind: tool === 'marquee-ellipse' ? 'ellipse' : 'rect', rect };
        applyShape(shape, inter.mode, tool === 'marquee-ellipse' ? 'Elliptische Auswahl' : 'Rechteckige Auswahl');
        break;
      }
      case 'lasso':
        if (inter.points.length >= 3) applyShape({ kind: 'poly', points: inter.points }, inter.mode, 'Lasso');
        else if (inter.mode === 'new') deselect();
        break;
      case 'move': {
        const live = shownDocRef.current;
        if (live && d && live !== d) {
          const layer = live.layers.find((l) => l.id === inter.layerId);
          if (layer && layer.kind !== 'adjustment' && (layer.x !== inter.origin.x || layer.y !== inter.origin.y)) {
            applyDoc(() => live, 'Verschieben');
          } else setLiveDoc(null);
        }
        break;
      }
      case 'gradient':
        if (Math.hypot(inter.end.x - inter.start.x, inter.end.y - inter.start.y) > 1) applyGradient(inter.start, inter.end);
        break;
      case 'paint':
        endPaint();
        break;
      default:
        break;
    }
    schedule({ overlay: true, composite: inter.kind === 'move' || inter.kind === 'paint' });
  };

  // Wheel: Alt/pinch zooms around the cursor, otherwise scrolls.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const v = viewRef.current;
      if (!v) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (e.altKey || e.ctrlKey || e.metaKey) {
        setView(zoomAt(v, v.zoom * wheelZoomFactor(e.deltaY * (e.ctrlKey ? 4 : 1)), anchor));
      } else {
        const dx = e.shiftKey ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        setView({ ...v, panX: v.panX - dx, panY: v.panY - dy });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setView]);

  // ---------- Dialog launchers ----------
  const openNewDialog = () => setDialog({
    id: 'new',
    title: 'Neues Dokument',
    fields: [
      { kind: 'text', id: 'name', label: 'Name', value: 'Unbenannt-1' },
      { kind: 'number', id: 'width', label: 'Breite', value: 1920, min: 1, max: 16000, unit: 'px' },
      { kind: 'number', id: 'height', label: 'Höhe', value: 1080, min: 1, max: 16000, unit: 'px' },
      { kind: 'select', id: 'background', label: 'Hintergrundinhalt', value: '#ffffff', options: [{ value: '#ffffff', label: 'Weiß' }, { value: '#000000', label: 'Schwarz' }, { value: 'transparent', label: 'Transparent' }] },
    ],
    presets: [
      { label: 'HD 1920 × 1080', values: { width: 1920, height: 1080 } },
      { label: 'UHD 3840 × 2160', values: { width: 3840, height: 2160 } },
      { label: 'Hochformat 1080 × 1920', values: { width: 1080, height: 1920 } },
      { label: 'Quadrat 2048', values: { width: 2048, height: 2048 } },
    ],
    okLabel: 'Erstellen',
    onOk: (vals) => newDocument(Number(vals.width), Number(vals.height), String(vals.background), String(vals.name || 'Unbenannt-1')),
  });

  const openImageSizeDialog = () => {
    const d = docRef.current;
    if (!d) return;
    setDialog({
      id: 'image-size',
      title: 'Bildgröße',
      fields: [
        { kind: 'number', id: 'width', label: 'Breite', value: d.width, min: 1, max: 16000, unit: 'px' },
        { kind: 'number', id: 'height', label: 'Höhe', value: d.height, min: 1, max: 16000, unit: 'px' },
      ],
      linked: ['width', 'height'],
      onOk: (vals) => resizeImage(Number(vals.width), Number(vals.height)),
    });
  };

  const openCanvasSizeDialog = () => setDialog({
    id: 'canvas-size',
    title: 'Arbeitsfläche erweitern',
    fields: [{ kind: 'number', id: 'pad', label: 'Rand je Seite', value: expandPadding, min: 1, max: 4000, unit: 'px' }],
    onOk: (vals) => { setExpandPadding(Number(vals.pad)); expandCanvas(Number(vals.pad)); },
  });

  const openBlurDialog = () => {
    if (!requireRaster('Gaußscher Weichzeichner')) return;
    setDialog({ id: 'gaussian-blur', title: 'Gaußscher Weichzeichner', fields: [{ kind: 'number', id: 'radius', label: 'Radius', value: 4, min: 0.1, max: 250, step: 0.1, unit: 'Pixel' }], onOk: (vals) => gaussianBlur(Number(vals.radius)) });
  };

  const openFeatherDialog = () => {
    if (!docRef.current?.selection) return;
    setDialog({ id: 'feather', title: 'Auswahlkante verbessern: Weiche Kante', fields: [{ kind: 'number', id: 'radius', label: 'Radius', value: 8, min: 0.5, max: 250, step: 0.5, unit: 'Pixel' }], onOk: (vals) => featherSelection(Number(vals.radius)) });
  };

  const openFly = (fly: FlyPanel) => setDock((cur) => ({ ...cur, fly: cur.fly === fly ? null : fly }));

  const openFxPanel = (layerId?: string) => {
    const d = docRef.current;
    const layer = d ? (layerId ? d.layers.find((l) => l.id === layerId) : getActiveLayer(d)) : null;
    if (layerId && layerId !== d?.activeLayerId) dispatch({ type: 'select', id: layerId }, 'Ebene auswählen');
    if (layer && layer.kind !== 'raster') say('Lens & Film FX wirken als Smartfilter auf Pixelebenen.');
    setDock((cur) => ({ ...cur, fly: 'fx' }));
  };

  // ---------- Keyboard ----------
  const keyHandlerRef = useRef<(e: KeyboardEvent) => boolean>(() => false);
  keyHandlerRef.current = (e: KeyboardEvent): boolean => {
    if (dialog) return false;
    const typing = isTypingTarget(e.target);
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;
    const lower = key.toLowerCase();
    const d = docRef.current;
    if (typing) return false;
    if (mod) {
      if (lower === 'z' && (e.shiftKey)) { handleRedo(); return true; }
      if (lower === 'z') { handleUndo(); return true; }
      if (lower === 'y' && !e.shiftKey) { handleRedo(); return true; }
      if (key === '0') { fitToScreen(); return true; }
      if (key === '1') { zoomActual(); return true; }
      if (key === '+' || key === '=') { zoomStep(1); return true; }
      if (key === '-') { zoomStep(-1); return true; }
      if (lower === 'o') { pickFile('open'); return true; }
      if (lower === 'n' && e.shiftKey) { newLayer(); return true; }
      if (lower === 'n') { openNewDialog(); return true; }
      if (!d) return false;
      if (lower === 's') { void exportToMedia(); return true; }
      if (lower === 'a') { selectAll(); return true; }
      if (lower === 'd' && e.shiftKey) { reselect(); return true; }
      if (lower === 'd') { deselect(); return true; }
      if (lower === 'i' && e.shiftKey) { inverseSelection(); return true; }
      if (lower === 'j') { layerViaCopy(); return true; }
      if (lower === 'e' && e.shiftKey) { void mergeVisible(); return true; }
      if (lower === 'e') { void mergeDown(); return true; }
      if (lower === 'c') { copySelection(false); return true; }
      if (lower === 'x') { copySelection(true); return true; }
      if (lower === 'v') { paste(); return true; }
      if (key === ']' && d.activeLayerId) { dispatch({ type: 'step', id: d.activeLayerId, delta: 1 }, 'Anordnen'); return true; }
      if (key === '[' && d.activeLayerId) { dispatch({ type: 'step', id: d.activeLayerId, delta: -1 }, 'Anordnen'); return true; }
      if (lower === "'" ) { setShowGrid((g) => !g); return true; }
      return false;
    }
    if (key === ' ') {
      if (!spaceRef.current) { spaceRef.current = true; setSpaceHeld(true); }
      return true;
    }
    if (key === 'Escape') {
      if (polyRef.current) { polyRef.current = null; schedule({ overlay: true }); return true; }
      if (tool === 'crop' && crop) { cancelCrop(); return true; }
      return false;
    }
    if (key === 'Enter') {
      if (polyRef.current) { closePolygon(); return true; }
      if (tool === 'crop' && crop) { commitCrop(); return true; }
      return true;
    }
    if (key === 'Backspace' || key === 'Delete') {
      if (!d) return true;
      if (d.selection) clearSelection(); else deleteLayer();
      return true;
    }
    if (key === '[' || key === ']') {
      if (e.shiftKey) setBrush({ hardness: Math.max(0, Math.min(1, brush.hardness + (key === ']' ? 0.25 : -0.25))) });
      else setBrush({ size: stepBrushSize(brush.size, key === ']' ? 1 : -1) });
      schedule({ overlay: true });
      return true;
    }
    if (key === '{' || key === '}') { setBrush({ hardness: Math.max(0, Math.min(1, brush.hardness + (key === '}' ? 0.25 : -0.25))) }); return true; }
    if (/^[0-9]$/.test(key)) {
      const value = key === '0' ? 1 : Number(key) / 10;
      if (isPaintTool(tool) || tool === 'gradient') setBrush({ opacity: value });
      else if (d?.activeLayerId) patchLayer(d.activeLayerId, { opacity: value }, 'Deckkraft ändern');
      return true;
    }
    if (key.startsWith('Arrow') && d && tool === 'move') {
      const layer = getActiveLayer(d);
      if (layer && layer.kind !== 'adjustment' && !layer.locked) {
        const step = e.shiftKey ? 10 : 1;
        const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
        const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
        dispatch({ type: 'update', id: layer.id, patch: { x: layer.x + dx, y: layer.y + dy } }, 'Verschieben', { coalesceKey: `nudge:${layer.id}` });
      }
      return true;
    }
    if (lower === 'd') { setFg('#000000'); setBg('#ffffff'); return true; }
    if (lower === 'x') { setFg(bg); setBg(fg); return true; }
    if (lower === 'q') { setQuickMask((q) => !q); return true; }
    if (key === 'F5' && e.shiftKey) { fillSelection(fg); return true; }
    if (key.length === 1 && /[a-z]/i.test(key)) {
      const next = toolForShortcut(key, e.shiftKey, tool, lastUsed);
      if (next) setTool(next);
      return true; // swallow other letters so global editor shortcuts don't fire here
    }
    return false;
  };

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (keyHandlerRef.current(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && spaceRef.current) {
        spaceRef.current = false;
        setSpaceHeld(false);
        if (!isTypingTarget(e.target)) { e.preventDefault(); e.stopPropagation(); }
      }
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => { window.removeEventListener('keydown', onDown, true); window.removeEventListener('keyup', onUp, true); };
  }, []);

  // ---------- MCP live commands (src/mcp/modules/photoTools.ts) ----------
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const settleWaitersRef = useRef<Array<() => void>>([]);
  useEffect(() => {
    const waiters = settleWaitersRef.current;
    settleWaitersRef.current = [];
    waiters.forEach((resolve) => resolve());
  }, [sessions, activeId]);
  /** Resolves after React committed the pending document change. */
  const settle = () => new Promise<void>((resolve) => {
    settleWaitersRef.current.push(resolve);
    window.setTimeout(resolve, 200);
  });
  const requireDoc = () => {
    const d = docRef.current;
    if (!d) throw new Error('Kein Dokument geöffnet (photo_open oder photo_new_document).');
    return d;
  };
  const fail = (fallback: string): never => { throw new Error(statusRef.current || fallback); };
  const layersResult = () => {
    const d = requireDoc();
    return { document: describeDoc(d), layers: describeLayers(d) };
  };
  const selectFor = async (layerId: unknown) => {
    const d = requireDoc();
    const layer = resolveLayer(d, layerId);
    if (layer.id !== d.activeLayerId) { dispatch({ type: 'select', id: layer.id }, 'Ebene auswählen'); await settle(); }
    return layer;
  };

  const liveRef = useRef<Record<string, (args: Record<string, any>) => unknown>>({});
  liveRef.current = {
    [PHOTO_LIVE.state]: () => {
      const d = docRef.current;
      const h = session?.history;
      return {
        documents: sessionsRef.current.map((s) => { const sd = currentState(s.history); return { id: s.id, name: sd.name, width: sd.width, height: sd.height, active: s.id === activeIdRef.current }; }),
        active: d ? { ...describeDoc(d), layers: describeLayers(d) } : null,
        history: h ? { index: h.index, entries: h.entries.map((e, i) => ({ index: i, label: e.label })) } : null,
        tool,
        toolLabel: TOOL_INFO[tool].label,
        quickMask,
        busy,
        status: statusRef.current,
      };
    },
    [PHOTO_LIVE.open]: async (args) => {
      const ok = args.asLayer && docRef.current ? await placeImage(String(args.url), String(args.name)) : await openImage(String(args.url), String(args.name));
      if (!ok) fail('Bild konnte nicht geöffnet werden.');
      await settle();
      return layersResult();
    },
    [PHOTO_LIVE.newDocument]: async (args) => {
      newDocument(Number(args.width), Number(args.height), String(args.background || '#ffffff'), String(args.name || 'Unbenannt-1'));
      await settle();
      return layersResult();
    },
    [PHOTO_LIVE.layersList]: () => layersResult(),
    [PHOTO_LIVE.layerAdd]: async (args) => {
      const d = requireDoc();
      let layer: Layer;
      if (args.kind === 'text') {
        layer = makeTextLayer(uid('T'), Number(args.x ?? Math.round(d.width * 0.1)), Number(args.y ?? Math.round(d.height * 0.1)), {
          ...textStyle,
          text: String(args.text),
          name: String(args.name || String(args.text).split('\n')[0].slice(0, 40)),
          ...(args.fontSize !== undefined ? { fontSize: Math.max(1, Number(args.fontSize)) } : {}),
          ...(typeof args.fontFamily === 'string' ? { fontFamily: args.fontFamily } : {}),
          ...(typeof args.color === 'string' ? { color: args.color } : {}),
          ...(typeof args.bold === 'boolean' ? { bold: args.bold } : {}),
          ...(typeof args.italic === 'boolean' ? { italic: args.italic } : {}),
          ...(['left', 'center', 'right'].includes(args.align) ? { align: args.align } : {}),
        });
      } else if (args.kind === 'adjustment') {
        layer = makeAdjustmentLayer(uid('A'), String(args.name || nextLayerName(d, ADJUSTMENT_LABELS[args.adjustment.type as AdjustmentType])), args.adjustment);
      } else {
        const { key } = store.create(d.width, d.height);
        layer = makeRasterLayer(uid('L'), String(args.name || nextLayerName(d)), key, d.width, d.height);
      }
      if (args.opacity !== undefined) layer = { ...layer, opacity: Number(args.opacity) };
      if (args.blendMode) layer = { ...layer, blendMode: args.blendMode };
      dispatch({ type: 'add', layer }, args.kind === 'text' ? 'Textebene erstellen' : args.kind === 'adjustment' ? 'Neue Einstellungsebene' : 'Neue Ebene');
      await settle();
      return { layerId: layer.id, ...layersResult() };
    },
    [PHOTO_LIVE.layerRemove]: async (args) => {
      const layer = resolveLayer(requireDoc(), args.layerId);
      if (layer.locked) throw new Error(`Ebene ${layer.id} ist fixiert.`);
      dispatch({ type: 'remove', id: layer.id }, 'Ebene löschen');
      await settle();
      return { removed: layer.id, ...layersResult() };
    },
    [PHOTO_LIVE.layerReorder]: async (args) => {
      const layer = resolveLayer(requireDoc(), args.layerId);
      if (args.index !== undefined) dispatch({ type: 'reorder', id: layer.id, toIndex: Math.round(Number(args.index)) }, 'Ebene verschieben');
      else dispatch({ type: 'step', id: layer.id, delta: Math.round(Number(args.delta)) }, 'Anordnen');
      await settle();
      return layersResult();
    },
    [PHOTO_LIVE.layerSet]: async (args) => {
      const d = requireDoc();
      const layer = resolveLayer(d, args.layerId);
      const patch = layerPatchFromArgs(layer, args);
      if (Object.keys(patch).length) dispatch({ type: 'update', id: layer.id, patch }, 'Ebeneneigenschaften');
      if (args.select) dispatch({ type: 'select', id: layer.id }, 'Ebene auswählen');
      await settle();
      const next = resolveLayer(requireDoc(), layer.id);
      return { layer: describeLayer(next, requireDoc().layers.indexOf(next)) };
    },
    [PHOTO_LIVE.adjustmentAdd]: async (args) => {
      const d = requireDoc();
      const type = args.adjustment.type as AdjustmentType;
      let layer: Layer = makeAdjustmentLayer(uid('A'), String(args.name || nextLayerName(d, ADJUSTMENT_LABELS[type])), args.adjustment);
      if (args.opacity !== undefined) layer = { ...layer, opacity: Number(args.opacity) };
      if (args.blendMode) layer = { ...layer, blendMode: args.blendMode };
      dispatch({ type: 'add', layer }, `Neue Einstellungsebene: ${ADJUSTMENT_LABELS[type]}`);
      await settle();
      return { layerId: layer.id, ...layersResult() };
    },
    [PHOTO_LIVE.smartFilterAdd]: async (args) => {
      const layer = resolveLayer(requireDoc(), args.layerId);
      if (layer.kind !== 'raster') throw new Error(`Ebene ${layer.id} ist keine Pixelebene (Smartfilter nur auf Pixelebenen).`);
      if (layer.locked) throw new Error(`Ebene ${layer.id} ist fixiert.`);
      dispatch({ type: 'update', id: layer.id, patch: { fx: [...layer.fx, args.instance] } }, `Smartfilter: ${String(args.effectName ?? args.instance.effectId)}`);
      await settle();
      return { layerId: layer.id, instanceId: args.instance.id };
    },
    [PHOTO_LIVE.smartFilterRemove]: async (args) => {
      const layer = resolveLayer(requireDoc(), args.layerId);
      if (layer.kind !== 'raster' || !layer.fx.some((fx) => fx.id === args.instanceId)) throw new Error(`Smartfilter ${String(args.instanceId)} nicht auf Ebene ${layer.id}.`);
      dispatch({ type: 'update', id: layer.id, patch: { fx: layer.fx.filter((fx) => fx.id !== args.instanceId) } }, 'Smartfilter entfernen');
      await settle();
      return { layerId: layer.id, removed: args.instanceId };
    },
    [PHOTO_LIVE.smartFilterApply]: async (args) => {
      const layer = resolveLayer(requireDoc(), args.layerId);
      if (layer.kind !== 'raster' || !hasActiveFx(layer.fx)) throw new Error('Die Ebene hat keine aktiven Smartfilter.');
      if (!(await applyFx(layer))) fail('Smartfilter konnten nicht angewendet werden.');
      await settle();
      return { layerId: layer.id, ...layersResult() };
    },
    [PHOTO_LIVE.selectionSet]: async (args) => {
      const d = requireDoc();
      const combine = (['new', 'add', 'subtract', 'intersect'].includes(args.combine) ? args.combine : 'new') as SelectionMode;
      switch (args.mode) {
        case 'all': selectAll(); break;
        case 'none': dispatch({ type: 'selection', selection: null }, 'Auswahl aufheben'); break;
        case 'invert': if (!d.selection) throw new Error('Keine Auswahl zum Umkehren.'); inverseSelection(); break;
        case 'reselect': if (!d.lastSelection) throw new Error('Keine vorherige Auswahl.'); reselect(); break;
        case 'rect':
        case 'ellipse': {
          const r = { x: Number(args.rect.x), y: Number(args.rect.y), width: Number(args.rect.width), height: Number(args.rect.height) };
          if (![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) throw new Error('rect braucht x, y, width > 0, height > 0.');
          applyShape({ kind: args.mode, rect: r }, combine, args.mode === 'rect' ? 'Rechteckige Auswahl' : 'Elliptische Auswahl', Math.max(0, Number(args.feather ?? 0)));
          break;
        }
        case 'subject':
          if (!(await selectSubject(combine))) fail('Motiv auswählen fehlgeschlagen.');
          break;
        default:
          throw new Error(`Unbekannter Auswahlmodus ${String(args.mode)}.`);
      }
      await settle();
      return { selection: describeDoc(requireDoc()).selection };
    },
    [PHOTO_LIVE.generativeFill]: async (args) => {
      requireDoc();
      const model = ['nano-banana-pro', 'nano-banana-2-fal', 'flux-2-pro', 'z-turbo-inpaint'].includes(args.model) ? args.model as InpaintModel : undefined;
      let ok: boolean;
      if (Number(args.expandPadding) > 0) {
        const next = expandCanvas(Number(args.expandPadding));
        if (!next) fail('Arbeitsfläche konnte nicht erweitert werden.');
        ok = await runInpaint(args.prompt || 'Extend the scene naturally.', { label: 'Generatives Erweitern', layerName: 'Erweiterung', docOverride: next!, model });
      } else if (args.heal) {
        ok = await runInpaint('Reconstruct the masked area seamlessly.', { label: 'Bereichsreparatur', layerName: 'Reparatur', model });
      } else {
        ok = await runInpaint(typeof args.prompt === 'string' && args.prompt ? args.prompt : undefined, { label: 'Generative Füllung', layerName: 'Generative Füllung', model });
      }
      if (!ok) fail('Generative Füllung fehlgeschlagen.');
      await settle();
      return layersResult();
    },
    [PHOTO_LIVE.crop]: async (args) => {
      const d = requireDoc();
      if (args.toSelection) {
        if (!d.selection) throw new Error('Keine Auswahl.');
        cropToSelection();
      } else {
        const r = { x: Math.round(Number(args.rect.x)), y: Math.round(Number(args.rect.y)), width: Math.round(Number(args.rect.width)), height: Math.round(Number(args.rect.height)) };
        if (!(r.width > 0 && r.height > 0)) throw new Error('rect braucht width > 0 und height > 0.');
        dispatch({ type: 'crop', rect: r }, 'Freistellen');
        setViews((prev) => { const copy = { ...prev }; if (activeIdRef.current) delete copy[activeIdRef.current]; return copy; });
      }
      await settle();
      return { document: describeDoc(requireDoc()) };
    },
    [PHOTO_LIVE.mergeDown]: async (args) => {
      await selectFor(args.layerId);
      const d = requireDoc();
      if (!canMergeDown(d, d.activeLayerId)) throw new Error('Auf eine Ebene reduzieren ist hier nicht möglich (unterste oder fixierte Ebene).');
      await mergeDown();
      await settle();
      return layersResult();
    },
    [PHOTO_LIVE.flatten]: async (args) => {
      requireDoc();
      if (args.visibleOnly) await mergeVisible(); else await flattenImage();
      await settle();
      return layersResult();
    },
    [PHOTO_LIVE.historyUndo]: async (args) => {
      requireDoc();
      const steps = Math.max(1, Math.round(Number(args.steps ?? 1)));
      setHistory((h) => { let next = h; for (let i = 0; i < steps; i += 1) next = undo(next); return next; });
      await settle();
      return liveRef.current[PHOTO_LIVE.state]({});
    },
    [PHOTO_LIVE.historyRedo]: async (args) => {
      requireDoc();
      const steps = Math.max(1, Math.round(Number(args.steps ?? 1)));
      setHistory((h) => { let next = h; for (let i = 0; i < steps; i += 1) next = redo(next); return next; });
      await settle();
      return liveRef.current[PHOTO_LIVE.state]({});
    },
    [PHOTO_LIVE.historyJump]: async (args) => {
      requireDoc();
      setHistory((h) => jumpTo(h, Number(args.index)));
      await settle();
      return liveRef.current[PHOTO_LIVE.state]({});
    },
    [PHOTO_LIVE.exportToMedia]: async (args) => {
      requireDoc();
      const item = await exportToMedia(typeof args.name === 'string' && args.name ? args.name : undefined);
      if (!item) fail('Export fehlgeschlagen.');
      return { mediaId: item!.id, name: item!.name };
    },
  };

  useEffect(() => registerLiveCommands(Object.fromEntries(
    Object.values(PHOTO_LIVE).map((name) => [name, (args: Record<string, unknown>) => liveRef.current[name](args)]),
  )), []);

  // ---------- Menus ----------
  const hasDoc = Boolean(doc);
  const hasSel = Boolean(doc?.selection);
  const isRaster = activeLayer?.kind === 'raster' && !activeLayer.locked;
  const history = session?.history ?? null;
  const item = (id: string, label: string, action: (() => void) | undefined, opts: { shortcut?: string; disabled?: boolean; checked?: boolean; submenu?: MenuItem[] } = {}): MenuItem => ({
    id, label, action, shortcut: opts.shortcut ? sc(opts.shortcut) : undefined, disabled: opts.disabled, checked: opts.checked, submenu: opts.submenu,
  });
  const sep: MenuItem = { kind: 'sep' };
  const adjustmentSubmenu: MenuItem[] = (Object.keys(ADJUSTMENT_LABELS) as AdjustmentType[])
    .filter((type) => type !== 'look')
    .map((type) => item(type, `${ADJUSTMENT_LABELS[type]} …`, () => addAdjustment(type), { disabled: !hasDoc }));

  const menus: MenuDef[] = [
    {
      id: 'file',
      label: 'Datei',
      items: [
        item('new', 'Neu …', openNewDialog, { shortcut: 'Mod+N' }),
        item('open', 'Öffnen …', () => pickFile('open'), { shortcut: 'Mod+O' }),
        item('place', 'Eingebettet platzieren …', () => pickFile('place'), { disabled: !hasDoc }),
        sep,
        item('close', 'Schließen', () => activeId && closeSession(activeId), { shortcut: 'Mod+W', disabled: !hasDoc }),
        sep,
        item('save-media', 'In Media Bin speichern', () => void exportToMedia(), { shortcut: 'Mod+S', disabled: !hasDoc }),
        item('export', 'Exportieren', undefined, { disabled: !hasDoc, submenu: [item('png', 'Schnell-Export als PNG', () => void downloadPng(), { disabled: !hasDoc })] }),
        sep,
        item('print', 'Drucken …', undefined, { disabled: true }),
      ],
    },
    {
      id: 'edit',
      label: 'Bearbeiten',
      items: [
        item('undo', history && canUndo(history) ? `Rückgängig: ${history.entries[history.index].label}` : 'Rückgängig', handleUndo, { shortcut: 'Mod+Z', disabled: !history || !canUndo(history) }),
        item('redo', history && canRedo(history) ? `Wiederholen: ${history.entries[history.index + 1].label}` : 'Wiederholen', handleRedo, { shortcut: 'Shift+Mod+Z', disabled: !history || !canRedo(history) }),
        sep,
        item('cut', 'Ausschneiden', () => copySelection(true), { shortcut: 'Mod+X', disabled: !isRaster }),
        item('copy', 'Kopieren', () => copySelection(false), { shortcut: 'Mod+C', disabled: !isRaster }),
        item('paste', 'Einfügen', () => paste(), { shortcut: 'Mod+V', disabled: !hasDoc }),
        item('clear', 'Löschen', clearSelection, { shortcut: '⌫', disabled: !isRaster || !hasSel }),
        sep,
        item('generative-fill', 'Generative Füllung …', () => openFly('generative'), { disabled: !hasDoc }),
        item('fill', 'Fläche füllen (Vordergrundfarbe)', () => fillSelection(fg), { shortcut: 'Shift+F5', disabled: !isRaster }),
        sep,
        item('transform', 'Transformieren', undefined, {
          disabled: !isRaster,
          submenu: [
            item('flip-h', 'Horizontal spiegeln', () => flipLayer(true), { disabled: !isRaster }),
            item('flip-v', 'Vertikal spiegeln', () => flipLayer(false), { disabled: !isRaster }),
            item('free', 'Frei transformieren', undefined, { disabled: true }),
          ],
        }),
        sep,
        item('prefs', 'Voreinstellungen …', undefined, { disabled: true }),
      ],
    },
    {
      id: 'image',
      label: 'Bild',
      items: [
        item('adjustments', 'Korrekturen', undefined, { disabled: !hasDoc, submenu: adjustmentSubmenu }),
        sep,
        item('image-size', 'Bildgröße …', openImageSizeDialog, { disabled: !hasDoc }),
        item('canvas-size', 'Arbeitsfläche erweitern …', openCanvasSizeDialog, { disabled: !hasDoc }),
        item('rotate', 'Bilddrehung', undefined, { disabled: true }),
        item('crop', 'Freistellen', cropToSelection, { disabled: !hasSel }),
        sep,
        item('crop-tool', 'Freistellungswerkzeug', () => setTool('crop'), { shortcut: 'C', disabled: !hasDoc }),
      ],
    },
    {
      id: 'layer',
      label: 'Ebene',
      items: [
        item('new', 'Neu', undefined, {
          disabled: !hasDoc,
          submenu: [
            item('layer', 'Ebene …', newLayer, { shortcut: 'Shift+Mod+N', disabled: !hasDoc }),
            item('via-copy', 'Ebene durch Kopie', layerViaCopy, { shortcut: 'Mod+J', disabled: !activeLayer }),
          ],
        }),
        item('duplicate', 'Ebene duplizieren …', duplicateLayer, { disabled: !activeLayer }),
        item('delete', 'Löschen', deleteLayer, { disabled: !activeLayer || activeLayer.locked }),
        sep,
        item('adjustment', 'Neue Einstellungsebene', undefined, { disabled: !hasDoc, submenu: adjustmentSubmenu }),
        sep,
        item('smart-filter', 'Smartfilter (Lens & Film FX) …', () => openFxPanel(), { disabled: activeLayer?.kind !== 'raster' }),
        item('rasterize', 'Rastern', () => void rasterizeActive(), { disabled: activeLayer?.kind !== 'text' }),
        sep,
        item('arrange', 'Anordnen', undefined, {
          disabled: !activeLayer,
          submenu: [
            item('front', 'In den Vordergrund', () => doc && activeLayer && dispatch({ type: 'reorder', id: activeLayer.id, toIndex: doc.layers.length - 1 }, 'Anordnen'), { shortcut: 'Shift+Mod+]' }),
            item('forward', 'Schrittweise vorwärts', () => activeLayer && dispatch({ type: 'step', id: activeLayer.id, delta: 1 }, 'Anordnen'), { shortcut: 'Mod+]' }),
            item('backward', 'Schrittweise rückwärts', () => activeLayer && dispatch({ type: 'step', id: activeLayer.id, delta: -1 }, 'Anordnen'), { shortcut: 'Mod+[' }),
            item('back', 'In den Hintergrund', () => activeLayer && dispatch({ type: 'reorder', id: activeLayer.id, toIndex: 0 }, 'Anordnen'), { shortcut: 'Shift+Mod+[' }),
          ],
        }),
        sep,
        item('merge-down', 'Auf eine Ebene reduzieren', () => void mergeDown(), { shortcut: 'Mod+E', disabled: !doc || !canMergeDown(doc, doc.activeLayerId) }),
        item('merge-visible', 'Sichtbare auf eine Ebene reduzieren', () => void mergeVisible(), { shortcut: 'Shift+Mod+E', disabled: !doc || doc.layers.filter((l) => l.visible).length < 2 }),
        item('flatten', 'Auf Hintergrundebene reduzieren', () => void flattenImage(), { disabled: !hasDoc }),
      ],
    },
    {
      id: 'select',
      label: 'Auswahl',
      items: [
        item('all', 'Alles auswählen', selectAll, { shortcut: 'Mod+A', disabled: !hasDoc }),
        item('deselect', 'Auswahl aufheben', deselect, { shortcut: 'Mod+D', disabled: !hasSel }),
        item('reselect', 'Erneut wählen', reselect, { shortcut: 'Shift+Mod+D', disabled: !doc?.lastSelection || hasSel }),
        item('inverse', 'Auswahl umkehren', inverseSelection, { shortcut: 'Shift+Mod+I', disabled: !hasSel }),
        sep,
        item('subject', 'Motiv (KI)', () => void selectSubject(), { disabled: !hasDoc || Boolean(busy) }),
        sep,
        item('feather', 'Weiche Kante …', openFeatherDialog, { disabled: !hasSel }),
        item('modify', 'Auswahl verändern', undefined, { disabled: true }),
        sep,
        item('quick-mask', 'Im Maskierungsmodus bearbeiten', () => setQuickMask((q) => !q), { shortcut: 'Q', checked: quickMask, disabled: !hasDoc }),
      ],
    },
    {
      id: 'filter',
      label: 'Filter',
      items: [
        item('lens-fx', 'Lens & Film FX (Smartfilter) …', () => openFxPanel(), { disabled: activeLayer?.kind !== 'raster' }),
        item('neural', 'Neural Filters …', () => openFly('neural'), { disabled: !hasDoc }),
        sep,
        item('blur', 'Weichzeichnungsfilter', undefined, { disabled: !isRaster, submenu: [item('gaussian', 'Gaußscher Weichzeichner …', openBlurDialog, { disabled: !isRaster })] }),
        item('sharpen', 'Scharfzeichnungsfilter', undefined, { disabled: true }),
        item('apply-fx', 'Smartfilter anwenden (ins Bild übernehmen)', () => void applyFx(), { disabled: !(activeLayer?.kind === 'raster' && hasActiveFx(activeLayer.fx)) }),
      ],
    },
    {
      id: 'view',
      label: 'Ansicht',
      items: [
        item('zoom-in', 'Einzoomen', () => zoomStep(1), { shortcut: 'Mod++', disabled: !hasDoc }),
        item('zoom-out', 'Auszoomen', () => zoomStep(-1), { shortcut: 'Mod+-', disabled: !hasDoc }),
        item('fit', 'Ganzes Bild', fitToScreen, { shortcut: 'Mod+0', disabled: !hasDoc }),
        item('actual', '100 %', zoomActual, { shortcut: 'Mod+1', disabled: !hasDoc }),
        sep,
        item('pixel-grid', 'Pixelraster', () => setShowGrid((g) => !g), { checked: showGrid }),
        item('rulers', 'Lineale', undefined, { disabled: true }),
        item('guides', 'Hilfslinien', undefined, { disabled: true }),
      ],
    },
    {
      id: 'window',
      label: 'Fenster',
      items: [
        item('color', 'Farbe', () => setDock((c) => ({ ...c, showColor: !(c.showColor && c.colorTab === 'color') || c.colorTab !== 'color', colorTab: 'color' })), { checked: dock.showColor && dock.colorTab === 'color' }),
        item('swatches', 'Farbfelder', () => setDock((c) => ({ ...c, showColor: !(c.showColor && c.colorTab === 'swatches') || c.colorTab !== 'swatches', colorTab: 'swatches' })), { checked: dock.showColor && dock.colorTab === 'swatches' }),
        item('properties', 'Eigenschaften', () => setDock((c) => ({ ...c, showProps: !(c.showProps && c.propsTab === 'properties') || c.propsTab !== 'properties', propsTab: 'properties' })), { checked: dock.showProps && dock.propsTab === 'properties' }),
        item('adjustments', 'Korrekturen', () => setDock((c) => ({ ...c, showProps: !(c.showProps && c.propsTab === 'adjustments') || c.propsTab !== 'adjustments', propsTab: 'adjustments' })), { checked: dock.showProps && dock.propsTab === 'adjustments' }),
        item('layers', 'Ebenen', () => setDock((c) => ({ ...c, showLayers: !c.showLayers })), { checked: dock.showLayers }),
        sep,
        item('history', 'Protokoll', () => openFly('history'), { checked: dock.fly === 'history' }),
        item('fx', 'Lens & Film FX', () => openFly('fx'), { checked: dock.fly === 'fx' }),
        item('generative', 'Generativ (KI)', () => openFly('generative'), { checked: dock.fly === 'generative' }),
        item('neural', 'Neural Filters', () => openFly('neural'), { checked: dock.fly === 'neural' }),
        sep,
        item('reset', 'Arbeitsbereich zurücksetzen', () => setDock(DEFAULT_DOCK)),
      ],
    },
  ];

  // ---------- Derived UI ----------
  const cursor = (() => {
    if (spaceHeld || tool === 'hand') return interRef.current?.kind === 'pan' ? 'grabbing' : 'grab';
    if (tool === 'zoom') return 'zoom-in';
    return TOOL_INFO[tool].cursor;
  })();

  const rasterActive = activeLayer?.kind === 'raster' ? activeLayer : null;
  const docTitle = doc && view ? `${doc.name} bei ${formatZoom(view.zoom)} (${activeLayer?.name ?? '–'}, RGB/8)${history && history.index > 0 ? '*' : ''}` : '';
  const rasterCount = doc ? doc.layers.filter((l) => l.kind === 'raster').length : 0;
  const [zoomText, setZoomText] = useState('');
  useEffect(() => { setZoomText(view ? formatZoom(view.zoom) : ''); }, [view?.zoom]);

  const textEditorStyle = (() => {
    if (!textEdit || !view) return null;
    const probe = makeTextLayer(textEdit.layerId, textEdit.x, textEdit.y, { ...textEdit.style, text: textEdit.draft || ' ' });
    const b = measureTextLayer(probe);
    const a = docToScreen(view, { x: b.x, y: b.y });
    return {
      left: a.x,
      top: a.y,
      width: Math.max(40, b.width * view.zoom + textEdit.style.fontSize * view.zoom * 0.6),
      height: Math.max(20, b.height * view.zoom + 4),
      font: `${textEdit.style.italic ? 'italic ' : ''}${textEdit.style.bold ? '700 ' : '400 '}${textEdit.style.fontSize * view.zoom}px ${textEdit.style.fontFamily}`,
      lineHeight: `${textEdit.style.fontSize * TEXT_LINE_HEIGHT * view.zoom}px`,
      color: textEdit.style.color,
      textAlign: textEdit.style.align,
    } as React.CSSProperties;
  })();

  const showTaskbar = hasDoc && !busy && !textEdit && tool !== 'crop';

  const flyTitle: Record<Exclude<FlyPanel, null>, string> = { history: 'Protokoll', fx: 'Lens & Film FX', generative: 'Generativ (KI)', neural: 'Neural Filters' };

  // ---------- Render ----------
  return (
    <div className="psx-root photo-workspace" data-automation-id="photo.workspace">
      <MenuBar menus={menus} />
      <OptionsBar
        tool={tool}
        hasDoc={hasDoc}
        brush={brush}
        onBrush={setBrush}
        selectionMode={selectionMode}
        onSelectionMode={setSelectionMode}
        feather={feather}
        onFeather={setFeather}
        cropRatioId={cropRatioId}
        onCropRatio={setCropRatioId}
        cropActive={Boolean(crop)}
        onCropCommit={commitCrop}
        onCropCancel={cancelCrop}
        textStyle={textEdit?.style ?? (activeLayer?.kind === 'text' ? activeLayer : textStyle)}
        onTextStyle={onTextStyle}
        autoSelect={autoSelect}
        onAutoSelect={setAutoSelect}
        onZoomStep={(dir) => zoomStep(dir)}
        onZoomFit={fitToScreen}
        onZoomActual={zoomActual}
        onSelectSubject={() => void selectSubject()}
        onHeal={() => void handleHeal()}
        canHeal={hasSel}
        busy={Boolean(busy)}
        fg={fg}
        bg={bg}
        onOpen={() => pickFile('open')}
        onSave={() => void exportToMedia()}
      />
      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        style={{ display: 'none' }}
        data-automation-id="photo.file-input"
        onChange={(e) => { handleFiles(e.target.files, fileModeRef.current); e.currentTarget.value = ''; }}
      />
      <div className="psx-body">
        <ToolsPanel
          tool={tool}
          lastUsed={lastUsed}
          onSelect={setTool}
          fg={fg}
          bg={bg}
          onFg={setFg}
          onBg={setBg}
          onSwap={() => { setFg(bg); setBg(fg); }}
          onReset={() => { setFg('#000000'); setBg('#ffffff'); }}
          quickMask={quickMask}
          onToggleQuickMask={() => setQuickMask((q) => !q)}
        />
        <div className="psx-docarea">
          <div className="psx-tabs" role="tablist" aria-label="Dokumente">
            {sessions.map((s) => {
              const d = currentState(s.history);
              const v = views[s.id];
              const selected = s.id === activeId;
              return (
                <div key={s.id} className="psx-tab" role="tab" aria-selected={selected} data-automation-id={`photo.doc-tab.${s.id}`} onMouseDown={() => { if (!selected) { finishTextEdit(); setActiveId(s.id); setLiveDoc(null); } }}>
                  <span className="psx-tab__name" title={selected ? docTitle : d.name}>{selected ? docTitle : `${d.name}${v ? ` bei ${formatZoom(v.zoom)}` : ''}`}</span>
                  <button type="button" className="psx-tab__close" title="Schließen" onMouseDown={(e) => e.stopPropagation()} onClick={() => closeSession(s.id)} data-automation-id={`photo.doc-tab.${s.id}.close`}><X size={11} /></button>
                </div>
              );
            })}
          </div>
          <div
            ref={viewportRef}
            className="psx-viewport"
            tabIndex={0}
            style={{ cursor }}
            data-automation-id="photo.canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => { pointerRef.current = null; schedule({ overlay: true }); }}
            onDoubleClick={() => { if (polyRef.current) closePolygon(); }}
            onContextMenu={(e) => e.preventDefault()}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files, docRef.current ? 'place' : 'open'); }}
          >
            <canvas ref={displayRef} data-automation-id="photo.fx-preview" />
            <canvas ref={overlayRef} className="psx-viewport__overlay" />
            {textEdit && textEditorStyle && (
              <textarea
                className="psx-text-editor"
                autoFocus
                spellCheck={false}
                value={textEdit.draft}
                style={textEditorStyle}
                data-automation-id="photo.text-editor"
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => setTextEdit((cur) => (cur ? { ...cur, draft: e.target.value } : cur))}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finishTextEdit(); }
                  e.stopPropagation();
                }}
                onBlur={finishTextEdit}
              />
            )}
            {!hasDoc && (
              <div className="psx-start" data-automation-id="photo.start">
                <div className="psx-start__title">Foto bearbeiten</div>
                <div className="psx-start__row">
                  <button type="button" className="psx-start__card" onClick={() => pickFile('open')} data-automation-id="photo.start.open"><FolderOpen size={22} /> Öffnen …</button>
                  <button type="button" className="psx-start__card" onClick={openNewDialog} data-automation-id="photo.start.new"><FilePlus size={22} /> Neue Datei …</button>
                </div>
                <p className="psx-hint">Bild hierher ziehen oder aus der Media Bin an „Photo“ senden.</p>
              </div>
            )}
            {busy && <div className="psx-busy" data-automation-id="photo.busy"><span className="psx-spinner" /> {busy}</div>}
            {showTaskbar && (
              <div className="psx-taskbar" onPointerDown={(e) => e.stopPropagation()} data-automation-id="photo.taskbar">
                {hasSel ? (
                  <>
                    {tool === 'spot-heal' ? (
                      <button type="button" className="psx-btn psx-btn--primary" onClick={() => void handleHeal()} data-automation-id="photo.taskbar.heal">Reparieren (KI)</button>
                    ) : (
                      <>
                        <input
                          className="psx-input"
                          placeholder="Generative Füllung: beschreiben (optional) …"
                          value={taskPrompt}
                          onChange={(e) => setTaskPrompt(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') void runInpaint(taskPrompt || undefined); }}
                          data-automation-id="photo.taskbar.prompt"
                        />
                        <button type="button" className="psx-btn psx-btn--primary" onClick={() => void runInpaint(taskPrompt || undefined)} data-automation-id="photo.taskbar.generate"><Sparkles size={12} /> Generieren</button>
                      </>
                    )}
                    <button type="button" className="psx-btn" onClick={inverseSelection} data-automation-id="photo.taskbar.inverse">Umkehren</button>
                    <button type="button" className="psx-btn" onClick={deselect} data-automation-id="photo.taskbar.deselect">Auswahl aufheben</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="psx-btn" onClick={() => void selectSubject()} data-automation-id="photo.taskbar.subject"><WandSparkles size={12} /> Motiv auswählen</button>
                    <button type="button" className="psx-btn" onClick={() => setDock((c) => ({ ...c, showProps: true, propsTab: 'adjustments' }))} data-automation-id="photo.taskbar.adjust"><SlidersHorizontal size={12} /> Korrektur</button>
                    <button type="button" className="psx-btn" onClick={() => openFxPanel()} disabled={activeLayer?.kind !== 'raster'} data-automation-id="photo.taskbar.fx"><Sparkles size={12} /> Lens FX</button>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="psx-status" data-automation-id="photo.status">
            {doc && view ? (
              <>
                <input
                  className="psx-input"
                  value={zoomText}
                  onChange={(e) => setZoomText(e.target.value)}
                  onBlur={() => { const z = parseZoom(zoomText); if (z) zoomTo(z); else setZoomText(formatZoom(view.zoom)); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  data-automation-id="photo.status.zoom"
                />
                <span>Dok: {formatDocSize(doc.width, doc.height)}/{formatDocSize(doc.width, doc.height, rasterCount)}</span>
                <span>{doc.width} × {doc.height} px</span>
                <span>{TOOL_INFO[tool].label}</span>
              </>
            ) : <span>Kein Dokument</span>}
            <span className="psx-status__msg" title={status}>{fxError ? `FX-Fehler: ${fxError}` : status || TOOL_INFO[tool].hint}</span>
          </div>
        </div>
        <div className="psx-dock">
          {dock.fly && (
            <div className="psx-flypanel" data-automation-id={`photo.fly.${dock.fly}`}>
              <div className="psx-panel__tabs">
                <span className="psx-panel__tab" aria-selected="true" style={{ display: 'flex', alignItems: 'center' }}>{flyTitle[dock.fly]}</span>
                <span className="psx-panel__tabs-spacer" />
                <button type="button" className="psx-icon-btn" title="Schließen" onClick={() => setDock((c) => ({ ...c, fly: null }))}><X size={12} /></button>
              </div>
              {dock.fly === 'history' && (
                <HistoryPanel history={history as History<unknown> | null} docName={doc?.name ?? ''} onJump={(i) => setHistory((h) => jumpTo(h, i))} onUndo={handleUndo} onRedo={handleRedo} />
              )}
              {dock.fly === 'fx' && (
                <div className="psx-panel__body" data-automation-id="photo.fx-panel">
                  {rasterActive ? (
                    <>
                      <p className="psx-hint" style={{ marginBottom: 6 }}>Smartfilter für „{rasterActive.name}“ – nicht-destruktiv, live auf der GPU.</p>
                      <FxStackPanel
                        stack={rasterActive.fx}
                        onChange={(fx) => patchLayer(rasterActive.id, { fx }, 'Smartfilter ändern', `fx:${rasterActive.id}`)}
                        emptyHint="Objektiv- und Film-Charakter (Buckswood Post Plugins Optics Lab u. a.). Wird beim Speichern in die Media Bin mitgerendert."
                      />
                      {fxError && <p className="psx-error" style={{ marginTop: 6 }}>FX-Fehler: {fxError}</p>}
                      {hasActiveFx(rasterActive.fx) && (
                        <button type="button" onClick={() => void applyFx()} className="psx-btn psx-btn--block" style={{ marginTop: 10 }} data-automation-id="photo.fx-apply">
                          Effekte ins Bild übernehmen
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="psx-hint">Wählen Sie eine Pixelebene. Textebenen zuerst rastern; Einstellungsebenen haben keine Smartfilter.</p>
                  )}
                </div>
              )}
              {dock.fly === 'generative' && (
                <div className="psx-panel__body" data-automation-id="photo.generative-panel">
                  <div className="psx-section-title" id="photo-inpaint">Generative Füllung (Auswahl)</div>
                  <textarea className="psx-textarea" rows={3} value={inpaintPrompt} onChange={(e) => setInpaintPrompt(e.target.value)} placeholder="Beschreiben, was entstehen soll …" data-automation-id="photo.gen.prompt" />
                  <div className="psx-row" style={{ marginTop: 6 }}>
                    <label>Modell</label>
                    <select className="psx-select" style={{ flex: 1 }} value={inpaintModel} onChange={(e) => setInpaintModel(e.target.value as InpaintModel)} data-automation-id="photo.gen.model">
                      <option value="nano-banana-pro">Nano Banana Pro</option>
                      <option value="nano-banana-2-fal">Nano Banana 2 Edit (FAL)</option>
                      <option value="flux-2-pro">Flux 2 Pro</option>
                      <option value="z-turbo-inpaint">Z-Turbo Inpaint</option>
                    </select>
                  </div>
                  <div className="psx-row">
                    <label>Auflösung</label>
                    {inpaintModel === 'z-turbo-inpaint' ? <span>Automatisch</span> : (
                      <select className="psx-select" style={{ flex: 1 }} value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)} data-automation-id="photo.gen.resolution">
                        {inpaintModel === 'nano-banana-pro' || inpaintModel === 'nano-banana-2-fal'
                          ? ['1K', '2K', '4K'].map((r) => <option key={r} value={r}>{r}</option>)
                          : [['match_input_image', 'Wie Eingabe'], ['0.5 MP', '0,5 MP'], ['1 MP', '1 MP'], ['2 MP', '2 MP'], ['4 MP', '4 MP']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <button type="button" className="psx-btn psx-btn--primary psx-btn--block" disabled={Boolean(busy) || !hasSel} onClick={() => void runInpaint(undefined)} data-automation-id="photo.gen.inpaint">Generative Füllung</button>
                    <button type="button" className="psx-btn psx-btn--block" disabled={Boolean(busy) || !hasSel} onClick={() => void handleHeal()} data-automation-id="photo.gen.heal">Auswahl reparieren</button>
                  </div>
                  <p className="psx-hint" style={{ marginTop: 6 }}>Auswahl mit Auswahlwerkzeugen, „Motiv auswählen“ oder im Maskierungsmodus (Q) malen. Das Ergebnis landet als neue Ebene, auf die Auswahl beschnitten.</p>
                  <div className="psx-section-title" id="photo-expand" style={{ marginTop: 14 }}>Generatives Erweitern</div>
                  <div className="psx-row">
                    <label>Rand (px)</label>
                    <input className="psx-input" type="number" min={1} value={expandPadding} onChange={(e) => setExpandPadding(Number(e.target.value))} data-automation-id="photo.gen.padding" />
                  </div>
                  <textarea className="psx-textarea" rows={2} value={expandPrompt} onChange={(e) => setExpandPrompt(e.target.value)} placeholder="Wie soll die Szene weitergehen …" data-automation-id="photo.gen.expand-prompt" />
                  <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                    <button type="button" className="psx-btn psx-btn--block" disabled={Boolean(busy) || !hasDoc} onClick={() => expandCanvas(expandPadding)} data-automation-id="photo.gen.expand">Arbeitsfläche erweitern</button>
                    <button type="button" className="psx-btn psx-btn--primary psx-btn--block" disabled={Boolean(busy) || !hasDoc} onClick={() => void expandAndFill()} data-automation-id="photo.gen.expand-fill">Erweitern + Füllen</button>
                  </div>
                </div>
              )}
              {dock.fly === 'neural' && (
                <div className="psx-panel__body" data-automation-id="photo.neural-panel">
                  <div className="psx-field">
                    <span className="psx-field__label">Intensität (Deckkraft)</span>
                    <span>{neuralIntensity} %</span>
                    <input className="psx-range" type="range" min={0} max={100} value={neuralIntensity} onChange={(e) => setNeuralIntensity(Number(e.target.value))} data-automation-id="photo.neural.intensity" />
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    ref={neuralRefInputRef}
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      void handleNeuralReferenceSelect(file);
                      e.currentTarget.value = '';
                    }}
                  />
                  <div style={{ display: 'grid', gap: 4 }}>
                    {NEURAL_PRESETS.filter((preset) => preset.id !== 'custom_prompt').map((preset) => (
                      <button key={preset.id} type="button" className="psx-btn psx-btn--block" style={{ height: 'auto', padding: '5px 8px', justifyContent: 'flex-start', flexDirection: 'column', alignItems: 'flex-start' }} disabled={Boolean(busy)} onClick={() => void applyNeuralPreset(preset)} data-automation-id={`photo.neural.${preset.id}`}>
                        <span style={{ fontWeight: 600 }}>{preset.label}{preset.requiresReference ? ' · Referenz' : ''}</span>
                        <span className="psx-hint">{preset.description}</span>
                      </button>
                    ))}
                  </div>
                  <div className="psx-section-title" style={{ marginTop: 10 }}>Referenz für „Harmonisieren“</div>
                  <div className="psx-row">
                    <button type="button" className="psx-btn" onClick={() => neuralRefInputRef.current?.click()} data-automation-id="photo.neural.reference">{neuralReference ? 'Ändern' : 'Laden'}</button>
                    {neuralReference && (
                      <>
                        <img src={neuralReference.url} alt="Referenz" style={{ width: 36, height: 36, objectFit: 'cover', border: '1px solid #444' }} />
                        <span className="psx-hint" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{neuralReference.file.name}</span>
                        <button type="button" className="psx-icon-btn" title="Entfernen" onClick={() => setNeuralReference(null)}><X size={12} /></button>
                      </>
                    )}
                  </div>
                  <div className="psx-section-title" style={{ marginTop: 10 }}>Eigener KI-Look</div>
                  <textarea className="psx-textarea" rows={2} value={neuralPrompt} onChange={(e) => setNeuralPrompt(e.target.value)} placeholder="z. B. Tageslicht angleichen, Grünstich entfernen, Hautdetails erhalten." data-automation-id="photo.neural.prompt" />
                  <button type="button" className="psx-btn psx-btn--primary psx-btn--block" style={{ marginTop: 6 }} disabled={Boolean(busy) || !neuralPrompt.trim()} onClick={() => void applyNeuralPreset(NEURAL_PRESETS.find((p) => p.id === 'custom_prompt')!)} data-automation-id="photo.neural.custom">Eigenen Look anwenden</button>
                  <p className="psx-hint" style={{ marginTop: 6 }}>Looks werden als Einstellungsebene „Neural“ angelegt und bleiben editierbar.</p>
                </div>
              )}
            </div>
          )}
          <div className="psx-dock__strip" role="toolbar" aria-label="Bedienfelder">
            <button type="button" aria-pressed={dock.fly === 'history'} title="Protokoll" onClick={() => openFly('history')} data-automation-id="photo.dock.history"><HistoryIcon size={16} /></button>
            <button type="button" aria-pressed={dock.fly === 'fx'} title="Lens & Film FX (Smartfilter)" onClick={() => openFly('fx')} data-automation-id="photo.dock.fx"><Sparkles size={16} /></button>
            <button type="button" aria-pressed={dock.fly === 'generative'} title="Generativ (KI)" onClick={() => openFly('generative')} data-automation-id="photo.dock.generative"><WandSparkles size={16} /></button>
            <button type="button" aria-pressed={dock.fly === 'neural'} title="Neural Filters" onClick={() => openFly('neural')} data-automation-id="photo.dock.neural"><Palette size={16} /></button>
          </div>
          <div className="psx-dock__col">
            {dock.showColor && (
              <div className="psx-panel">
                <div className="psx-panel__tabs" role="tablist">
                  {([['color', 'Farbe'], ['swatches', 'Farbfelder']] as const).map(([id, label]) => (
                    <button key={id} type="button" role="tab" className="psx-panel__tab" aria-selected={dock.colorTab === id} onClick={() => setDock((c) => ({ ...c, colorTab: id }))} data-automation-id={`photo.panel-tab.${id}`}>{label}</button>
                  ))}
                </div>
                <div className="psx-panel__body" style={{ flex: 'none' }}>
                  {dock.colorTab === 'color'
                    ? <ColorPanel fg={fg} bg={bg} onFg={setFg} onBg={setBg} />
                    : <SwatchesPanel onPick={(c, background) => (background ? setBg(c) : setFg(c))} />}
                </div>
              </div>
            )}
            {dock.showProps && (
              <div className="psx-panel" style={{ maxHeight: '45%' }}>
                <div className="psx-panel__tabs" role="tablist">
                  {([['properties', 'Eigenschaften'], ['adjustments', 'Korrekturen']] as const).map(([id, label]) => (
                    <button key={id} type="button" role="tab" className="psx-panel__tab" aria-selected={dock.propsTab === id} onClick={() => setDock((c) => ({ ...c, propsTab: id }))} data-automation-id={`photo.panel-tab.${id}`}>{label}</button>
                  ))}
                </div>
                <div className="psx-panel__body">
                  {dock.propsTab === 'properties' ? (
                    <PropertiesPanel
                      doc={shownDoc}
                      layer={activeLayer}
                      busy={Boolean(busy)}
                      onPatch={(patch, label, coalesceKey) => activeLayer && patchLayer(activeLayer.id, patch, label, coalesceKey)}
                      onOpenFx={() => openFxPanel()}
                      onSelectSubject={() => void selectSubject()}
                      onRasterize={() => void rasterizeActive()}
                    />
                  ) : (
                    <AdjustmentsPanel disabled={!hasDoc} onAdd={addAdjustment} />
                  )}
                </div>
              </div>
            )}
            {dock.showLayers && (
              <div className="psx-panel psx-panel--grow">
                <div className="psx-panel__tabs" role="tablist">
                  <button type="button" role="tab" className="psx-panel__tab" aria-selected="true">Ebenen</button>
                </div>
                {shownDoc ? (
                  <LayersPanel
                    doc={shownDoc}
                    store={store}
                    onSelect={(id) => dispatch({ type: 'select', id }, 'Ebene auswählen')}
                    onPatch={patchLayer}
                    onReorder={(id, toIndex) => dispatch({ type: 'reorder', id, toIndex }, 'Ebene verschieben')}
                    onNewLayer={newLayer}
                    onDuplicate={duplicateLayer}
                    onDelete={deleteLayer}
                    onMergeDown={() => void mergeDown()}
                    onAdjustmentMenu={(anchor) => { const r = anchor.getBoundingClientRect(); setAdjMenu({ x: r.left - 180, y: r.top - 150 }); }}
                    onOpenFx={(id) => openFxPanel(id)}
                  />
                ) : <p className="psx-hint" style={{ padding: 10 }}>Kein Dokument geöffnet.</p>}
              </div>
            )}
          </div>
        </div>
      </div>
      {adjMenu && (
        <div className="psx-dialog-backdrop" style={{ background: 'transparent' }} onMouseDown={() => setAdjMenu(null)}>
          <div className="psx-menu" style={{ left: Math.max(8, adjMenu.x), top: Math.max(8, adjMenu.y), position: 'fixed' }} onMouseDown={(e) => e.stopPropagation()} role="menu">
            {(Object.keys(ADJUSTMENT_LABELS) as AdjustmentType[]).filter((t) => t !== 'look').map((type) => (
              <button key={type} type="button" className="psx-menu__item" role="menuitem" onClick={() => addAdjustment(type)} data-automation-id={`photo.adjmenu.${type}`}>
                <span className="psx-menu__label">{ADJUSTMENT_LABELS[type]} …</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {dialog && <Dialog spec={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
};

export default PhotoWorkspace;
