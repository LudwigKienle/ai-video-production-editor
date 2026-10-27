/**
 * Upscale page: pure logic (no DOM, no React). Target-size math, preset
 * mapping, pipeline planning, size/cost units, comparison geometry, timeline
 * helpers, the job-queue reducer and settings (de)serialisation.
 * Covered by `upscaleOps.test.ts`.
 */
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  getEnhanceModel,
  getHdrEngine,
  INTERPOLATION_MODEL,
  type EnhanceModelId,
  type EnhanceModelSpec,
  type HdrEngineId,
  type ModelLimits,
  type UpscaleMediaKind,
} from './upscaleModels.ts';

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

const finite = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Nearest even integer ≥ 2 (video encoders need even dimensions). */
export const toEven = (value: number): number => {
  const n = Math.max(2, Math.round(finite(value, 2)));
  return n % 2 === 0 ? n : n - 1;
};

/** Even value that never exceeds `value` (used when shrinking to a limit). */
export const floorEven = (value: number): number => {
  const n = Math.max(2, Math.floor(finite(value, 2)));
  return n % 2 === 0 ? n : n - 1;
};

// ---------------------------------------------------------------------------
// Output size
// ---------------------------------------------------------------------------

export type OutputPresetId = '720p' | '1080p' | '1440p' | '4k' | '8k';
export const OUTPUT_PRESETS: ReadonlyArray<{ id: OutputPresetId; label: string; width: number; height: number }> = [
  { id: '720p', label: '720p HD', width: 1280, height: 720 },
  { id: '1080p', label: '1080p Full HD', width: 1920, height: 1080 },
  { id: '1440p', label: '1440p QHD', width: 2560, height: 1440 },
  { id: '4k', label: '4K UHD', width: 3840, height: 2160 },
  { id: '8k', label: '8K UHD', width: 7680, height: 4320 },
];

export type OutputSizeMode = 'scale' | 'preset' | 'custom';

export type OutputSettings = {
  mode: OutputSizeMode;
  /** Scale factor for `scale` mode (1–8, quarter steps). */
  scale: number;
  preset: OutputPresetId;
  customWidth: number;
  customHeight: number;
  /** Fill the target box exactly and crop the overhang (else fit inside). */
  cropToFill: boolean;
};

export type TargetSize = Size & {
  /** Effective scale relative to the (cropped) source. */
  scale: number;
  /** Source region used, in source pixels (full frame unless cropping). */
  crop: Rect;
  /** True when a model limit made the output smaller than requested. */
  limited: boolean;
  notes: string[];
};

/** Preset box in the orientation of the source (portrait swaps the box). */
export const presetBox = (preset: OutputPresetId, source: Size): Size => {
  const entry = OUTPUT_PRESETS.find((p) => p.id === preset) ?? OUTPUT_PRESETS[1];
  const portrait = source.height > source.width;
  return portrait ? { width: entry.height, height: entry.width } : { width: entry.width, height: entry.height };
};

const fullCrop = (source: Size): Rect => ({ x: 0, y: 0, width: source.width, height: source.height });

/** Centered crop of the source with the aspect ratio of `box`. */
export const fillCrop = (source: Size, box: Size): Rect => {
  const sourceAspect = source.width / source.height;
  const boxAspect = box.width / box.height;
  if (Math.abs(sourceAspect - boxAspect) < 1e-6) return fullCrop(source);
  if (sourceAspect > boxAspect) {
    const width = source.height * boxAspect;
    return { x: (source.width - width) / 2, y: 0, width, height: source.height };
  }
  const height = source.width / boxAspect;
  return { x: 0, y: (source.height - height) / 2, width: source.width, height };
};

/**
 * Requested output size for a source, honouring the per-model limits
 * (max scale, max long edge) and even dimensions.
 */
export const computeTargetSize = (source: Size, output: OutputSettings, limits?: ModelLimits): TargetSize => {
  const src: Size = { width: Math.max(1, finite(source.width, 1)), height: Math.max(1, finite(source.height, 1)) };
  const notes: string[] = [];
  let crop = fullCrop(src);
  let width: number;
  let height: number;

  if (output.mode === 'scale') {
    const scale = clamp(finite(output.scale, 2), 1, 16);
    width = src.width * scale;
    height = src.height * scale;
  } else {
    const box = output.mode === 'preset'
      ? presetBox(output.preset, src)
      : { width: clamp(finite(output.customWidth, src.width), 2, 16384), height: clamp(finite(output.customHeight, src.height), 2, 16384) };
    if (output.cropToFill) {
      crop = fillCrop(src, box);
      width = box.width;
      height = box.height;
    } else {
      const fit = Math.min(box.width / src.width, box.height / src.height);
      width = src.width * fit;
      height = src.height * fit;
    }
  }

  let limited = false;
  if (limits) {
    const maxByScale = limits.maxScale;
    const currentScale = width / crop.width;
    if (currentScale > maxByScale + 1e-9) {
      const f = maxByScale / currentScale;
      width *= f;
      height *= f;
      limited = true;
      notes.push(`Modell erlaubt höchstens ${maxByScale}× – Ausgabe verkleinert.`);
    }
    const longEdge = Math.max(width, height);
    if (longEdge > limits.maxLongEdge + 1e-9) {
      const f = limits.maxLongEdge / longEdge;
      width *= f;
      height *= f;
      limited = true;
      notes.push(`Modell-Grenze ${limits.maxLongEdge} px Kantenlänge – Ausgabe verkleinert.`);
    }
  }

  const outWidth = limited ? floorEven(width) : toEven(width);
  const outHeight = limited ? floorEven(height) : toEven(height);
  const scale = Math.round((outWidth / crop.width) * 1000) / 1000;
  if (scale < 1) notes.push('Ziel ist kleiner als die Quelle (Verkleinerung).');
  return { width: outWidth, height: outHeight, scale, crop, limited, notes };
};

/** Standard label for a target size (by its short edge), e.g. "1080p" / "4k". */
export const resolutionLabel = (size: Size): string => {
  const shortEdge = Math.min(size.width, size.height);
  if (shortEdge <= 720) return '720p';
  if (shortEdge <= 1080) return '1080p';
  if (shortEdge <= 1440) return '1440p';
  if (shortEdge <= 2160) return '4k';
  return '8k';
};

/** Options the existing upscale services accept (`scale`, `resolution`). */
export const toServiceOptions = (target: TargetSize, kind: UpscaleMediaKind): { scale: number; resolution?: string } => {
  const scale = Math.max(1, Math.round(target.scale * 2) / 2);
  if (kind === 'video') return { scale, resolution: resolutionLabel(target) };
  return { scale, resolution: `${target.width}x${target.height}` };
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type VideoCodec = 'h264' | 'h265' | 'prores';
export type ExportQuality = 'low' | 'medium' | 'high';
export type ImageFormat = 'png' | 'jpeg' | 'webp';

export type UpscaleSettings = {
  output: OutputSettings;
  enhance: { enabled: boolean; imageModel: EnhanceModelId; videoModel: EnhanceModelId };
  interpolation: { enabled: boolean };
  hdr: { enabled: boolean; engine: HdrEngineId; rubyFormat: string; rubyProres: '422' | '422 HQ' | '4444' };
  post: { sharpen: number; grain: number; grainSize: number };
  export: {
    videoCodec: VideoCodec;
    quality: ExportQuality;
    audio: boolean;
    imageFormat: ImageFormat;
    outputFolder: string | null;
  };
};

export const DEFAULT_SETTINGS: UpscaleSettings = {
  output: { mode: 'scale', scale: 2, preset: '4k', customWidth: 3840, customHeight: 2160, cropToFill: false },
  enhance: { enabled: true, imageModel: DEFAULT_IMAGE_MODEL, videoModel: DEFAULT_VIDEO_MODEL },
  interpolation: { enabled: false },
  hdr: { enabled: false, engine: 'ltx', rubyFormat: 'hdr10', rubyProres: '422 HQ' },
  post: { sharpen: 0, grain: 0, grainSize: 1 },
  export: { videoCodec: 'h264', quality: 'high', audio: true, imageFormat: 'png', outputFolder: null },
};

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback);

/** Validates untrusted (stored) settings; unknown fields fall back to defaults. */
export const sanitizeSettings = (raw: unknown): UpscaleSettings => {
  const d = DEFAULT_SETTINGS;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const o = (r.output && typeof r.output === 'object' ? r.output : {}) as Record<string, unknown>;
  const e = (r.enhance && typeof r.enhance === 'object' ? r.enhance : {}) as Record<string, unknown>;
  const h = (r.hdr && typeof r.hdr === 'object' ? r.hdr : {}) as Record<string, unknown>;
  const p = (r.post && typeof r.post === 'object' ? r.post : {}) as Record<string, unknown>;
  const x = (r.export && typeof r.export === 'object' ? r.export : {}) as Record<string, unknown>;
  const imageModel = getEnhanceModel(e.imageModel as string)?.kind === 'image' ? (e.imageModel as EnhanceModelId) : d.enhance.imageModel;
  const videoModel = getEnhanceModel(e.videoModel as string)?.kind === 'video' ? (e.videoModel as EnhanceModelId) : d.enhance.videoModel;
  return {
    output: {
      mode: pick(o.mode, ['scale', 'preset', 'custom'] as const, d.output.mode),
      scale: clamp(Math.round(finite(o.scale, d.output.scale) * 4) / 4, 1, 8),
      preset: pick(o.preset, OUTPUT_PRESETS.map((x2) => x2.id), d.output.preset),
      customWidth: Math.round(clamp(finite(o.customWidth, d.output.customWidth), 2, 16384)),
      customHeight: Math.round(clamp(finite(o.customHeight, d.output.customHeight), 2, 16384)),
      cropToFill: typeof o.cropToFill === 'boolean' ? o.cropToFill : d.output.cropToFill,
    },
    enhance: { enabled: typeof e.enabled === 'boolean' ? e.enabled : true, imageModel, videoModel },
    interpolation: { enabled: Boolean((r.interpolation as Record<string, unknown> | undefined)?.enabled) },
    hdr: {
      enabled: typeof h.enabled === 'boolean' ? h.enabled : false,
      engine: getHdrEngine(h.engine as string) ? (h.engine as HdrEngineId) : d.hdr.engine,
      rubyFormat: typeof h.rubyFormat === 'string' && h.rubyFormat ? h.rubyFormat : d.hdr.rubyFormat,
      rubyProres: pick(h.rubyProres, ['422', '422 HQ', '4444'] as const, d.hdr.rubyProres),
    },
    post: {
      sharpen: clamp(finite(p.sharpen, 0), 0, 1),
      grain: clamp(finite(p.grain, 0), 0, 1),
      grainSize: clamp(finite(p.grainSize, 1), 0.5, 4),
    },
    export: {
      videoCodec: pick(x.videoCodec, ['h264', 'h265', 'prores'] as const, d.export.videoCodec),
      quality: pick(x.quality, ['low', 'medium', 'high'] as const, d.export.quality),
      audio: typeof x.audio === 'boolean' ? x.audio : true,
      imageFormat: pick(x.imageFormat, ['png', 'jpeg', 'webp'] as const, d.export.imageFormat),
      outputFolder: typeof x.outputFolder === 'string' && x.outputFolder ? x.outputFolder : null,
    },
  };
};

export const parseSettings = (json: string | null | undefined): UpscaleSettings => {
  if (!json) return sanitizeSettings(null);
  try {
    return sanitizeSettings(JSON.parse(json));
  } catch {
    return sanitizeSettings(null);
  }
};

export const enhanceModelFor = (settings: UpscaleSettings, kind: UpscaleMediaKind): EnhanceModelSpec =>
  getEnhanceModel(kind === 'image' ? settings.enhance.imageModel : settings.enhance.videoModel)
  ?? getEnhanceModel(kind === 'image' ? DEFAULT_IMAGE_MODEL : DEFAULT_VIDEO_MODEL)!;

// ---------------------------------------------------------------------------
// Pipeline planning
// ---------------------------------------------------------------------------

export type PipelineStepId = 'capture' | 'enhance' | 'interpolate' | 'hdr' | 'post' | 'save';

export type PipelineStep = {
  id: PipelineStepId;
  label: string;
  /** Cloud step that spends provider credits. */
  paid: boolean;
  provider?: string;
  providerModel?: string;
  /** Cost units for the rate lookup and their unit. */
  units?: number;
  unitLabel?: 'image' | 'second' | 'clip';
  costKind?: 'edit' | 'video';
  estimatedMs: number;
};

export type PipelineInput = {
  kind: UpscaleMediaKind;
  source: Size;
  fps: number;
  /** Seconds of the export range (videos). */
  rangeSeconds: number;
  /** True when the range is shorter than the whole clip (needs a capture). */
  partialRange: boolean;
};

export type PipelinePlan = {
  steps: PipelineStep[];
  target: TargetSize | null;
  outputFps: number;
  errors: string[];
  warnings: string[];
};

export const planPipeline = (settings: UpscaleSettings, input: PipelineInput): PipelinePlan => {
  const steps: PipelineStep[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const model = enhanceModelFor(settings, input.kind);
  const isVideo = input.kind === 'video';
  const seconds = Math.max(0, finite(input.rangeSeconds, 0));
  let outputFps = isVideo ? Math.max(1, finite(input.fps, 24)) : 0;
  let target: TargetSize | null = null;

  if (isVideo && seconds <= 0) errors.push('Der Exportbereich ist leer (In/Out prüfen).');

  if (isVideo && input.partialRange) {
    steps.push({ id: 'capture', label: 'Bereich ausschneiden (Echtzeit, WebM)', paid: false, estimatedMs: Math.round(seconds * 1000) + 1500 });
  }

  if (settings.enhance.enabled) {
    target = computeTargetSize(input.source, settings.output, model.limits);
    warnings.push(...target.notes);
    steps.push({
      id: 'enhance',
      label: `Upscaling · ${model.label}`,
      paid: true,
      provider: model.provider,
      providerModel: model.providerModel,
      units: isVideo ? Math.max(1, Math.ceil(seconds)) : 1,
      unitLabel: isVideo ? 'second' : 'image',
      costKind: 'edit',
      estimatedMs: isVideo ? Math.round(model.estimatedMs * Math.max(1, seconds / 5)) : model.estimatedMs,
    });
  }

  if (settings.interpolation.enabled) {
    if (!isVideo) {
      warnings.push('Bildinterpolation gilt nur für Videos.');
    } else {
      outputFps *= INTERPOLATION_MODEL.factor;
      const maxFps = model.limits.maxFps ?? 120;
      if (outputFps > maxFps * 2) warnings.push(`Sehr hohe Bildrate (${formatFps(outputFps)} fps).`);
      steps.push({
        id: 'interpolate',
        label: `Bildinterpolation · ${INTERPOLATION_MODEL.label} ${INTERPOLATION_MODEL.factor}×`,
        paid: true,
        provider: 'replicate',
        providerModel: INTERPOLATION_MODEL.providerModel,
        units: 1,
        unitLabel: 'clip',
        costKind: 'video',
        estimatedMs: INTERPOLATION_MODEL.estimatedMs,
      });
    }
  }

  if (settings.hdr.enabled) {
    const engine = getHdrEngine(settings.hdr.engine)!;
    if (!isVideo) {
      errors.push('SDR→HDR ist nur für Videos verfügbar.');
    } else {
      const size = target ?? { ...input.source };
      const longEdge = Math.max(size.width, size.height);
      if (longEdge > engine.maxLongEdge) errors.push(`${engine.label}: höchstens ${engine.maxLongEdge} px Kantenlänge.`);
      const shortEdge = Math.min(size.width, size.height);
      const maxSeconds = engine.id === 'ltx'
        ? (shortEdge > 1440 ? 2 : shortEdge > 1080 ? 4 : engine.maxSeconds)
        : engine.maxSeconds;
      if (seconds > maxSeconds) errors.push(`${engine.label}: höchstens ca. ${maxSeconds} s bei dieser Auflösung (In/Out verkürzen).`);
      steps.push({
        id: 'hdr',
        label: `SDR→HDR · ${engine.label}`,
        paid: true,
        provider: engine.provider,
        providerModel: engine.providerModel,
        units: 1,
        unitLabel: 'clip',
        costKind: 'edit',
        estimatedMs: engine.estimatedMs,
      });
    }
  }

  const hasPost = settings.post.sharpen > 0 || settings.post.grain > 0;
  if (!isVideo) {
    // Images: local resize to the exact target (+ crop), sharpen, grain, encode.
    steps.push({ id: 'post', label: hasPost ? 'Lokal: Zielgröße, Schärfen, Körnung' : 'Lokal: Zielgröße & Format', paid: false, estimatedMs: 1500 });
  } else if (hasPost) {
    warnings.push('Schärfen/Körnung werden bei Videos nur in der Vorschau gezeigt, nicht eingerechnet.');
  }
  if (isVideo && settings.export.videoCodec !== 'h264') {
    warnings.push('H.265/ProRes: Cloud-Ergebnis ist MP4 (H.264); Umkodieren im Export-Arbeitsbereich.');
  }

  if (!steps.some((step) => step.paid)) errors.push('Kein KI-Modell aktiv.');
  if (settings.export.outputFolder) steps.push({ id: 'save', label: 'In Ausgabeordner speichern', paid: false, estimatedMs: 800 });

  return { steps, target, outputFps, errors, warnings };
};

export const formatFps = (fps: number): string => {
  if (!Number.isFinite(fps) || fps <= 0) return '–';
  return Number.isInteger(fps) ? String(fps) : fps.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
};

// ---------------------------------------------------------------------------
// Output size estimate
// ---------------------------------------------------------------------------

/** Bits per pixel per frame for each codec/quality (rough, for estimates). */
const VIDEO_BPP: Record<VideoCodec, Record<ExportQuality, number>> = {
  h264: { low: 0.05, medium: 0.1, high: 0.18 },
  h265: { low: 0.03, medium: 0.06, high: 0.11 },
  // ProRes 422 LT / 422 / 422 HQ equivalents (≈ 102 / 147 / 220 Mbit/s at 1080p29.97).
  prores: { low: 1.64, medium: 2.36, high: 3.54 },
};
const AUDIO_BITS_PER_SECOND = 256_000;

export const estimateOutputBytes = (opts: {
  kind: UpscaleMediaKind;
  width: number;
  height: number;
  fps?: number;
  seconds?: number;
  codec?: VideoCodec;
  quality?: ExportQuality;
  audio?: boolean;
  imageFormat?: ImageFormat;
}): number => {
  const pixels = Math.max(0, finite(opts.width, 0)) * Math.max(0, finite(opts.height, 0));
  if (opts.kind === 'image') {
    const bytesPerPixel = opts.imageFormat === 'jpeg' ? 0.35 : opts.imageFormat === 'webp' ? 0.25 : 1.6;
    return Math.round(pixels * bytesPerPixel);
  }
  const fps = Math.max(0, finite(opts.fps, 24));
  const seconds = Math.max(0, finite(opts.seconds, 0));
  const bpp = VIDEO_BPP[opts.codec ?? 'h264'][opts.quality ?? 'high'];
  const videoBits = pixels * fps * seconds * bpp;
  const audioBits = opts.audio ? AUDIO_BITS_PER_SECOND * seconds : 0;
  return Math.round((videoBits + audioBits) / 8);
};

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

// ---------------------------------------------------------------------------
// Comparison view geometry
// ---------------------------------------------------------------------------

export type ZoomLevel = 'fit' | number;

export type ViewTransform = Rect & { scale: number };

/** Where content of `content` size lands in `viewport` for a zoom and pan. */
export const viewTransform = (viewport: Size, content: Size, zoom: ZoomLevel, pan: { x: number; y: number }): ViewTransform => {
  const cw = Math.max(1, content.width);
  const ch = Math.max(1, content.height);
  const fitScale = Math.min(viewport.width / cw, viewport.height / ch);
  const scale = zoom === 'fit' ? fitScale : clamp(finite(zoom, 1), 0.05, 16);
  const width = cw * scale;
  const height = ch * scale;
  const clamped = clampPan(viewport, { width, height }, zoom === 'fit' ? { x: 0, y: 0 } : pan);
  return {
    x: (viewport.width - width) / 2 + clamped.x,
    y: (viewport.height - height) / 2 + clamped.y,
    width,
    height,
    scale,
  };
};

/** Pan offsets (from centred) that keep the content covering the viewport. */
export const clampPan = (viewport: Size, scaled: Size, pan: { x: number; y: number }): { x: number; y: number } => {
  const maxX = Math.max(0, (scaled.width - viewport.width) / 2);
  const maxY = Math.max(0, (scaled.height - viewport.height) / 2);
  return { x: clamp(finite(pan.x, 0), -maxX, maxX), y: clamp(finite(pan.y, 0), -maxY, maxY) };
};

/** Zoom around a viewport point so the pixel under the cursor stays put. */
export const zoomAt = (
  viewport: Size,
  content: Size,
  current: { zoom: ZoomLevel; pan: { x: number; y: number } },
  nextZoom: number,
  point: { x: number; y: number },
): { zoom: number; pan: { x: number; y: number } } => {
  const before = viewTransform(viewport, content, current.zoom, current.pan);
  const u = (point.x - before.x) / before.width;
  const v = (point.y - before.y) / before.height;
  const scale = clamp(nextZoom, 0.05, 16);
  const width = content.width * scale;
  const height = content.height * scale;
  const pan = {
    x: point.x - u * width - (viewport.width - width) / 2,
    y: point.y - v * height - (viewport.height - height) / 2,
  };
  return { zoom: scale, pan: clampPan(viewport, { width, height }, pan) };
};

export type WipeGeometry = {
  /** Divider x in viewport pixels. */
  dividerX: number;
  /** Visible "before" (source) region, left of the divider. */
  before: Rect;
  /** Visible "after" (result) region, right of the divider. */
  after: Rect;
  /** Wipe position 0..1 relative to the viewport. */
  position: number;
};

export const wipeGeometry = (viewport: Size, position: number): WipeGeometry => {
  const p = clamp(finite(position, 0.5), 0, 1);
  const dividerX = Math.round(viewport.width * p);
  return {
    dividerX,
    position: p,
    before: { x: 0, y: 0, width: dividerX, height: viewport.height },
    after: { x: dividerX, y: 0, width: Math.max(0, viewport.width - dividerX), height: viewport.height },
  };
};

/** Wipe position from a pointer x (viewport-relative), clamped to 0..1. */
export const wipeFromPointer = (pointerX: number, viewportWidth: number): number =>
  (viewportWidth > 0 ? clamp(pointerX / viewportWidth, 0, 1) : 0.5);

/** Side-by-side: two equal panes with a gap. */
export const sideBySidePanes = (viewport: Size, gap = 2): [Rect, Rect] => {
  const width = Math.max(0, (viewport.width - gap) / 2);
  return [
    { x: 0, y: 0, width, height: viewport.height },
    { x: width + gap, y: 0, width, height: viewport.height },
  ];
};

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120] as const;

/** Frame rate from frame-to-frame media-time deltas (seconds), snapped to common rates. */
export const estimateFps = (deltas: number[]): number | null => {
  const valid = deltas.filter((d) => Number.isFinite(d) && d > 0.002 && d < 0.5).sort((a, b) => a - b);
  if (valid.length < 3) return null;
  const median = valid[Math.floor(valid.length / 2)];
  const raw = 1 / median;
  let best: number = COMMON_FPS[0];
  for (const fps of COMMON_FPS) if (Math.abs(fps - raw) < Math.abs(best - raw)) best = fps;
  return Math.abs(best - raw) / best < 0.04 ? best : Math.round(raw * 100) / 100;
};

export const frameAt = (seconds: number, fps: number): number => Math.max(0, Math.floor(finite(seconds, 0) * Math.max(1, fps) + 1e-6));

export const formatTimecode = (seconds: number, fps: number): string => {
  const rate = Math.max(1, Math.round(finite(fps, 24)));
  const total = Math.max(0, frameAt(seconds, fps));
  const ff = total % rate;
  const totalSeconds = Math.floor(total / rate);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(hh)}:${two(mm)}:${two(ss)}:${two(ff)}`;
};

export type Range = { start: number; end: number };

/** In/Out clamped into the clip with a minimum length of one frame. */
export const clampRange = (range: Range, duration: number, fps: number): Range => {
  const dur = Math.max(0, finite(duration, 0));
  const minLen = Math.min(dur, 1 / Math.max(1, fps));
  const start = clamp(finite(range.start, 0), 0, Math.max(0, dur - minLen));
  const end = clamp(finite(range.end, dur), start + minLen, dur);
  return { start, end };
};

/**
 * Preview range of `length` seconds starting at the playhead, kept inside
 * In/Out (shifted back when it would run past Out). `length` 0 = one frame.
 */
export const previewRange = (playhead: number, length: number, io: Range, fps: number): Range => {
  const frame = 1 / Math.max(1, fps);
  const len = length <= 0 ? frame : length;
  const span = Math.max(frame, io.end - io.start);
  const effective = Math.min(len, span);
  const start = clamp(finite(playhead, io.start), io.start, Math.max(io.start, io.end - effective));
  return { start, end: start + effective };
};

// ---------------------------------------------------------------------------
// Job queue (serialisable reducer)
// ---------------------------------------------------------------------------

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type UpscaleJob = {
  id: string;
  inputId: string;
  name: string;
  kind: UpscaleMediaKind;
  /** 'preview' renders a short range or a single frame; 'export' the full range. */
  purpose: 'preview' | 'export';
  range: Range | null;
  status: JobStatus;
  progress: number;
  stepLabel: string;
  createdAt: number;
  finishedAt?: number;
  resultUrl?: string;
  resultMediaId?: string;
  savedPath?: string;
  error?: string;
  estimatedUsd?: number;
  mock?: boolean;
};

export type JobAction =
  | { type: 'add'; job: UpscaleJob }
  | { type: 'start'; id: string }
  | { type: 'progress'; id: string; progress: number; stepLabel?: string }
  | { type: 'done'; id: string; resultUrl: string; resultMediaId?: string; savedPath?: string; at: number }
  | { type: 'fail'; id: string; error: string; at: number }
  | { type: 'cancel'; id: string; at: number }
  | { type: 'remove'; id: string }
  | { type: 'clearFinished' };

const isActive = (status: JobStatus) => status === 'queued' || status === 'running';

export const jobsReducer = (jobs: UpscaleJob[], action: JobAction): UpscaleJob[] => {
  const patch = (id: string, fn: (job: UpscaleJob) => UpscaleJob | null) =>
    jobs.map((job) => (job.id === id ? fn(job) ?? job : job));
  switch (action.type) {
    case 'add':
      return jobs.some((job) => job.id === action.job.id) ? jobs : [...jobs, action.job];
    case 'start':
      return patch(action.id, (job) => (job.status === 'queued' ? { ...job, status: 'running', progress: 0 } : null));
    case 'progress':
      return patch(action.id, (job) => (job.status === 'running'
        ? { ...job, progress: clamp(Math.max(job.progress, finite(action.progress, 0)), 0, 0.99), stepLabel: action.stepLabel ?? job.stepLabel }
        : null));
    case 'done':
      return patch(action.id, (job) => (job.status === 'running'
        ? { ...job, status: 'done', progress: 1, resultUrl: action.resultUrl, resultMediaId: action.resultMediaId, savedPath: action.savedPath, finishedAt: action.at, stepLabel: 'Fertig' }
        : null));
    case 'fail':
      return patch(action.id, (job) => (isActive(job.status)
        ? { ...job, status: 'failed', error: action.error, finishedAt: action.at, stepLabel: 'Fehler' }
        : null));
    case 'cancel':
      return patch(action.id, (job) => (isActive(job.status)
        ? { ...job, status: 'cancelled', finishedAt: action.at, stepLabel: 'Abgebrochen' }
        : null));
    case 'remove':
      return jobs.filter((job) => job.id !== action.id || isActive(job.status));
    case 'clearFinished':
      return jobs.filter((job) => isActive(job.status));
    default:
      return jobs;
  }
};

/** Next queued job when nothing is running (jobs run one at a time). */
export const nextRunnableJob = (jobs: UpscaleJob[]): UpscaleJob | null => {
  if (jobs.some((job) => job.status === 'running')) return null;
  return jobs.find((job) => job.status === 'queued') ?? null;
};

/** Progress for an indeterminate step from elapsed vs. expected time (eases to 95 %). */
export const easedProgress = (elapsedMs: number, expectedMs: number): number => {
  if (!(expectedMs > 0)) return 0;
  const t = Math.max(0, elapsedMs) / expectedMs;
  return Math.min(0.95, 1 - Math.exp(-2.2 * t));
};

/** Overall job progress from step index/count and progress inside the step. */
export const pipelineProgress = (stepIndex: number, stepCount: number, inner: number): number => {
  if (stepCount <= 0) return 0;
  return clamp((stepIndex + clamp(inner, 0, 1)) / stepCount, 0, 0.99);
};

// ---------------------------------------------------------------------------
// Local post: unsharp mask on RGBA pixels (images)
// ---------------------------------------------------------------------------

/**
 * In-place unsharp mask (3×3 box blur as the low-pass) on RGBA8 data.
 * `amount` 0..1 maps to 0..1.5× high-pass gain; alpha is untouched.
 */
export const unsharpMask = (data: Uint8ClampedArray, width: number, height: number, amount: number): void => {
  const gain = clamp(finite(amount, 0), 0, 1) * 1.5;
  if (gain <= 0 || width < 3 || height < 3) return;
  const src = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          const yy = clamp(y + dy, 0, height - 1);
          for (let dx = -1; dx <= 1; dx += 1) {
            const xx = clamp(x + dx, 0, width - 1);
            sum += src[(yy * width + xx) * 4 + c];
          }
        }
        const blur = sum / 9;
        data[i + c] = src[i + c] + (src[i + c] - blur) * gain;
      }
    }
  }
};

export const SHARPEN_MAX_PIXELS = 40_000_000;

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export type StepCostLookup = (step: PipelineStep) => number | null;

/**
 * Sums paid step costs via an injected lookup (the UI passes the app's
 * `estimateGenerationCost`). Steps without a rate are reported as unknown.
 */
export const sumPipelineCost = (steps: PipelineStep[], lookup: StepCostLookup): { usd: number; unknown: string[] } => {
  let usd = 0;
  const unknown: string[] = [];
  for (const step of steps) {
    if (!step.paid) continue;
    const cost = lookup(step);
    if (cost === null || !Number.isFinite(cost)) unknown.push(step.label);
    else usd += cost;
  }
  return { usd: Math.round(usd * 100000) / 100000, unknown };
};
