/**
 * Upscale page: browser side effects. Media probing, frame grabs, range
 * capture, local post-processing (resize/crop, sharpen, Optics Lab grain on
 * the GPU FX engine), the cloud pipeline runner and saving to a folder.
 *
 * Cloud steps call the existing service functions only. A test mode
 * (`window.__AVPE_UPSCALE_MOCK__ = true` or localStorage
 * `avpe.upscalePro.mock = "1"`) replaces every paid call with a local
 * stand-in, so the page can be exercised without spending credits.
 */
import type { MediaItem } from '../../types';
import {
  interpolateVideoWithRife,
  upscaleImage,
  upscaleImageWithClarity,
  upscaleImageWithCrystal,
  upscaleImageWithTopaz,
  upscaleVideoWithCrystal,
  upscaleVideoWithTopaz,
} from '../../services/replicateService';
import { toLtxVideoUri, upscaleVideoToAcesHdrWithLtx } from '../../services/ltxService';
import { convertVideoToHdrWithRunwayRuby, type RunwayRubyOutputFormat } from '../../services/runwayService';
import { fileToBase64, getBase64FromUrl } from '../../utils/helpers';
import { FxRenderer } from '../../fx/renderer';
import { createFxInstance } from '../../fx/registry';
import { OPTICS_LAB } from '../../fx/effects/opticsLab/index';
import type { FxStack } from '../../fx/types';
import {
  computeTargetSize,
  easedProgress,
  enhanceModelFor,
  pipelineProgress,
  SHARPEN_MAX_PIXELS,
  toServiceOptions,
  unsharpMask,
  type PipelinePlan,
  type PipelineStep,
  type Range,
  type Rect,
  type Size,
  type UpscaleJob,
  type UpscaleSettings,
} from './upscaleOps.ts';
import { getEnhanceModel, type EnhanceModelId, type ModelLimits, type UpscaleMediaKind } from './upscaleModels.ts';

export type QueueInput = {
  id: string;
  name: string;
  kind: UpscaleMediaKind;
  url: string;
  mediaId?: string;
  width: number;
  height: number;
  fps: number;
  fpsEstimated: boolean;
  duration: number;
  thumbnail?: string;
  status: 'probing' | 'ready' | 'error';
  error?: string;
};

type Payload = { base64: string; mimeType: string };

// ---------------------------------------------------------------------------
// Test mode
// ---------------------------------------------------------------------------

export const isUpscaleMockMode = (): boolean => {
  try {
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__AVPE_UPSCALE_MOCK__ === true) return true;
    return typeof localStorage !== 'undefined' && localStorage.getItem('avpe.upscalePro.mock') === '1';
  } catch {
    return false;
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

const loadImage = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const img = new Image();
  if (!url.startsWith('data:') && !url.startsWith('blob:')) img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'));
  img.src = url;
});

const loadVideo = (url: string): Promise<HTMLVideoElement> => new Promise((resolve, reject) => {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  if (!url.startsWith('data:') && !url.startsWith('blob:')) video.crossOrigin = 'anonymous';
  const timer = setTimeout(() => reject(new Error('Video-Metadaten: Zeitüberschreitung.')), 15_000);
  video.onloadeddata = () => { clearTimeout(timer); resolve(video); };
  video.onerror = () => { clearTimeout(timer); reject(new Error('Video konnte nicht geladen werden.')); };
  video.src = url;
});

const seek = (video: HTMLVideoElement, time: number): Promise<void> => new Promise((resolve) => {
  const target = Math.max(0, Math.min(time, Math.max(0, (video.duration || 0) - 0.01)));
  if (Math.abs(video.currentTime - target) < 0.001) { resolve(); return; }
  const done = () => { video.removeEventListener('seeked', done); resolve(); };
  video.addEventListener('seeked', done);
  video.currentTime = target;
  setTimeout(done, 3000);
});

const thumbnailOf = (source: CanvasImageSource, width: number, height: number): string | undefined => {
  try {
    const scale = Math.min(1, 160 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return undefined; // tainted canvas: no thumbnail, the item still works
  }
};

export const probeMedia = async (url: string, kind: UpscaleMediaKind): Promise<Pick<QueueInput, 'width' | 'height' | 'duration' | 'thumbnail'>> => {
  if (kind === 'image') {
    const img = await loadImage(url);
    return { width: img.naturalWidth, height: img.naturalHeight, duration: 0, thumbnail: thumbnailOf(img, img.naturalWidth, img.naturalHeight) };
  }
  const video = await loadVideo(url);
  if (!Number.isFinite(video.duration)) {
    // Recorded WebM files often report Infinity until the end is seeked once.
    await new Promise<void>((resolve) => {
      const done = () => { video.removeEventListener('durationchange', done); resolve(); };
      video.addEventListener('durationchange', done);
      video.currentTime = 1e7;
      setTimeout(done, 3000);
    });
  }
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  await seek(video, Math.min(0.5, duration / 3));
  const result = { width: video.videoWidth, height: video.videoHeight, duration, thumbnail: thumbnailOf(video, video.videoWidth, video.videoHeight) };
  video.removeAttribute('src');
  video.load();
  return result;
};

// ---------------------------------------------------------------------------
// Frames, ranges, payloads
// ---------------------------------------------------------------------------

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> =>
  new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Kodieren fehlgeschlagen.'))), type, quality));

const blobToPayload = async (blob: Blob, fallbackType: string): Promise<Payload> => ({
  base64: await fileToBase64(new File([blob], 'input', { type: blob.type || fallbackType })),
  mimeType: blob.type || fallbackType,
});

/** One video frame as PNG. */
export const grabFrame = async (url: string, time: number): Promise<{ payload: Payload; dataUrl: string; size: Size }> => {
  const video = await loadVideo(url);
  await seek(video, time);
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');
  return { payload: { base64: dataUrl.split(',')[1] || '', mimeType: 'image/png' }, dataUrl, size: { width: canvas.width, height: canvas.height } };
};

/**
 * Records [start, end) of a video in real time with MediaRecorder (WebM).
 * Used for previews and partial In/Out exports; cross-origin sources fail.
 */
export const captureRange = async (url: string, range: Range, onProgress: (p: number) => void, isCancelled: () => boolean): Promise<Blob> => {
  const video = await loadVideo(url);
  const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
  if (typeof capture !== 'function' || typeof MediaRecorder === 'undefined') {
    throw new Error('Dieser Browser kann keinen Ausschnitt aufnehmen.');
  }
  await seek(video, range.start);
  const stream = capture.call(video);
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 40_000_000 } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  recorder.start(250);
  await video.play();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const p = (video.currentTime - range.start) / Math.max(0.001, range.end - range.start);
      onProgress(Math.min(1, Math.max(0, p)));
      if (isCancelled() || video.currentTime >= range.end || video.ended) { resolve(); return; }
      requestAnimationFrame(tick);
    };
    tick();
  });
  video.pause();
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());
  return new Blob(chunks, { type: mimeType || 'video/webm' });
};

const payloadFromUrl = (url: string): Promise<Payload> => getBase64FromUrl(url);

// ---------------------------------------------------------------------------
// Local post-processing (images)
// ---------------------------------------------------------------------------

/** Optics Lab with every stage off except sensor grain: a neutral grain pass. */
export const grainStack = (amount: number, size: number): FxStack => {
  if (!(amount > 0)) return [];
  return [createFxInstance(OPTICS_LAB.id, {
    preset: 0,
    effectStrength: 1,
    geometryEnabled: false,
    aberrationsEnabled: false,
    defocusEnabled: false,
    lightEnabled: false,
    vignetteEnabled: false,
    surfaceEnabled: false,
    sensorEnabled: true,
    debayer: 0,
    chromaSmear: 0,
    grain: amount,
    grainSize: size,
    outputMix: 1,
    quality: 1,
  })];
};

const FX_MAX = 4096;
let postRenderer: FxRenderer | null = null;

/** Applies grain on the GPU; returns null when WebGL2 is unavailable or the frame is too large. */
export const applyGrain = (canvas: HTMLCanvasElement, amount: number, size: number, frameIndex = 0): HTMLCanvasElement | null => {
  const stack = grainStack(amount, size);
  if (!stack.length || Math.max(canvas.width, canvas.height) > FX_MAX) return null;
  try {
    if (!postRenderer || postRenderer.isLost) postRenderer = new FxRenderer();
    const rendered = postRenderer.render(canvas, stack, { frameIndex, quality: 'full' });
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    out.getContext('2d')!.drawImage(rendered as CanvasImageSource, 0, 0);
    return out;
  } catch (error) {
    console.warn('[upscale] grain pass failed', error);
    return null;
  }
};

/** Draws `crop` of the source into an exact `size` canvas, then sharpens and adds grain. */
export const renderPost = (
  source: CanvasImageSource,
  crop: Rect,
  size: Size,
  post: UpscaleSettings['post'],
  notes: string[],
): HTMLCanvasElement => {
  let canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: post.sharpen > 0 })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
  if (post.sharpen > 0) {
    if (size.width * size.height <= SHARPEN_MAX_PIXELS) {
      const data = ctx.getImageData(0, 0, size.width, size.height);
      unsharpMask(data.data, size.width, size.height, post.sharpen);
      ctx.putImageData(data, 0, 0);
    } else {
      notes.push('Schärfen übersprungen (Bild über 40 MP).');
    }
  }
  if (post.grain > 0) {
    const grained = applyGrain(canvas, post.grain, post.grainSize);
    if (grained) canvas = grained;
    else notes.push(`Körnung übersprungen (GPU nicht verfügbar oder über ${FX_MAX} px).`);
  }
  return canvas;
};

const MIME: Record<UpscaleSettings['export']['imageFormat'], string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const QUALITY: Record<UpscaleSettings['export']['quality'], number> = { low: 0.72, medium: 0.86, high: 0.95 };

const finalizeImage = async (
  url: string,
  sourceSize: Size,
  settings: UpscaleSettings,
  limits: ModelLimits | undefined,
  notes: string[],
): Promise<{ url: string; size: Size; ext: string }> => {
  const img = await loadImage(url);
  // The cloud result may differ from the requested size; map our crop (in
  // source pixels) onto the result and resample to the exact target.
  const target = computeTargetSize(sourceSize, settings.output);
  const sx = img.naturalWidth / sourceSize.width;
  const sy = img.naturalHeight / sourceSize.height;
  const crop: Rect = { x: target.crop.x * sx, y: target.crop.y * sy, width: target.crop.width * sx, height: target.crop.height * sy };
  const enhance = limits ? computeTargetSize(sourceSize, settings.output, limits) : target;
  const canvas = renderPost(img, crop, { width: enhance.width, height: enhance.height }, settings.post, notes);
  const mime = MIME[settings.export.imageFormat];
  const blob = await canvasToBlob(canvas, mime, mime === 'image/png' ? undefined : QUALITY[settings.export.quality]);
  return { url: URL.createObjectURL(blob), size: { width: canvas.width, height: canvas.height }, ext: settings.export.imageFormat === 'jpeg' ? 'jpg' : settings.export.imageFormat };
};

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

type ElectronBridge = {
  selectFolder?: () => Promise<string | null>;
  writeProjectFile?: (payload: { folderPath: string; relativePath: string; data: string; encoding?: string }) => Promise<{ ok: boolean }>;
  openFolder?: (payload: { folderPath: string }) => Promise<{ ok: boolean; error?: string | null }>;
};

export const electronBridge = (): ElectronBridge | null => {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { electron?: ElectronBridge }).electron;
  return bridge && typeof bridge === 'object' ? bridge : null;
};

export const chooseOutputFolder = async (): Promise<string | null> => {
  const bridge = electronBridge();
  if (!bridge?.selectFolder) return null;
  try {
    return await bridge.selectFolder();
  } catch {
    return null;
  }
};

export const openFolder = async (folderPath: string): Promise<boolean> => {
  const bridge = electronBridge();
  if (!bridge?.openFolder) return false;
  try {
    return (await bridge.openFolder({ folderPath })).ok;
  } catch {
    return false;
  }
};

const safeName = (name: string) => name.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 120) || 'upscale';

const saveToFolder = async (folder: string, fileName: string, url: string): Promise<string | undefined> => {
  const bridge = electronBridge();
  if (!bridge?.writeProjectFile) return undefined;
  const response = await fetch(url);
  const blob = await response.blob();
  const base64 = await fileToBase64(new File([blob], fileName, { type: blob.type }));
  await bridge.writeProjectFile({ folderPath: folder, relativePath: fileName, data: base64, encoding: 'base64' });
  return `${folder.replace(/[\\/]+$/, '')}/${fileName}`;
};

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

const IMAGE_FALLBACK_FOR_VIDEO: Record<string, EnhanceModelId> = { 'topaz-video': 'topaz', 'crystal-video': 'crystal' };

const runEnhance = async (modelId: EnhanceModelId, payload: Payload, opts: { scale: number; resolution?: string }): Promise<MediaItem> => {
  switch (modelId) {
    case 'real-esrgan': return upscaleImage(payload, opts);
    case 'crystal': return upscaleImageWithCrystal(payload, opts);
    case 'clarity': return upscaleImageWithClarity(payload, opts);
    case 'topaz': return upscaleImageWithTopaz(payload, opts);
    case 'crystal-video': return upscaleVideoWithCrystal(payload, opts);
    case 'topaz-video': return upscaleVideoWithTopaz(payload, opts);
    default: throw new Error('Unbekanntes Upscale-Modell.');
  }
};

export type RunRequest = {
  job: UpscaleJob;
  input: QueueInput;
  /** Local file for uploads (not serialisable, kept outside the queue state). */
  file?: File | null;
  settings: UpscaleSettings;
  plan: PipelinePlan;
  /** Single-frame preview time (videos), when `job.range` is one frame. */
  frameTime?: number;
  mock: boolean;
  onProgress: (progress: number, stepLabel: string) => void;
  isCancelled: () => boolean;
};

export type RunResult = { item: MediaItem; savedPath?: string; notes: string[] };

class CancelledError extends Error {
  constructor() { super('Abgebrochen'); }
}

export const runUpscaleJob = async (req: RunRequest): Promise<RunResult> => {
  const { job, input, settings, mock } = req;
  const notes: string[] = [];
  const isFramePreview = input.kind === 'video' && req.frameTime !== undefined;
  const steps: PipelineStep[] = isFramePreview
    ? req.plan.steps.filter((s) => s.id === 'enhance').concat([{ id: 'post', label: 'Lokal: Zielgröße', paid: false, estimatedMs: 800 }])
    : req.plan.steps.filter((s) => !(job.purpose === 'preview' && (s.id === 'hdr' || s.id === 'save')));
  if (job.purpose === 'preview' && req.plan.steps.some((s) => s.id === 'hdr')) notes.push('SDR→HDR wird in der Vorschau ausgelassen.');

  let currentUrl = input.url;
  let currentPayload: Payload | null = null;
  let currentKind: UpscaleMediaKind = input.kind;
  let sourceSize: Size = { width: input.width, height: input.height };
  let resultItem: MediaItem | null = null;
  let outputSize: Size | null = null;
  let ext = input.kind === 'image' ? 'png' : 'mp4';
  let usedLimits: ModelLimits | undefined;

  const ensurePayload = async (): Promise<Payload> => {
    if (currentPayload) return currentPayload;
    if (req.file && currentUrl === input.url) {
      currentPayload = { base64: await fileToBase64(req.file), mimeType: req.file.type || (input.kind === 'video' ? 'video/mp4' : 'image/png') };
    } else {
      currentPayload = await payloadFromUrl(currentUrl);
    }
    return currentPayload;
  };

  // Frame preview starts from a grabbed frame.
  if (isFramePreview) {
    const frame = await grabFrame(input.url, req.frameTime ?? 0);
    currentPayload = frame.payload;
    currentUrl = frame.dataUrl;
    currentKind = 'image';
    sourceSize = frame.size;
  }

  for (let index = 0; index < steps.length; index += 1) {
    if (req.isCancelled()) throw new CancelledError();
    const step = steps[index];
    const started = Date.now();
    const report = (inner: number) => req.onProgress(pipelineProgress(index, steps.length, inner), step.label);
    report(0);
    const timer = setInterval(() => report(easedProgress(Date.now() - started, step.estimatedMs)), 400);
    try {
      if (step.id === 'capture' && job.range) {
        const blob = await captureRange(input.url, job.range, (p) => report(p), req.isCancelled);
        currentPayload = await blobToPayload(blob, 'video/webm');
        currentUrl = URL.createObjectURL(blob);
      } else if (step.id === 'enhance') {
        const kindModel = enhanceModelFor(settings, input.kind);
        const modelId: EnhanceModelId = currentKind === 'image' && kindModel.kind === 'video'
          ? IMAGE_FALLBACK_FOR_VIDEO[kindModel.id] ?? 'crystal'
          : kindModel.id;
        const model = getEnhanceModel(modelId)!;
        if (isFramePreview) notes.push(`Einzelbild-Vorschau mit dem Bildmodell ${model.label}.`);
        const target = computeTargetSize(sourceSize, settings.output, model.limits);
        const opts = toServiceOptions(target, currentKind);
        if (mock) {
          await sleep(1200);
          resultItem = { id: `mock-upscale-${Date.now()}`, name: `mock_${model.id}`, type: currentKind, url: currentUrl, source: 'generated' };
        } else {
          resultItem = await runEnhance(modelId, await ensurePayload(), opts);
        }
        outputSize = { width: target.width, height: target.height };
        usedLimits = model.limits;
        currentUrl = resultItem.url;
        currentPayload = null;
      } else if (step.id === 'interpolate') {
        if (mock) {
          await sleep(900);
          resultItem = { id: `mock-rife-${Date.now()}`, name: 'mock_rife', type: 'video', url: currentUrl, source: 'generated' };
        } else {
          resultItem = await interpolateVideoWithRife(await ensurePayload());
        }
        currentUrl = resultItem.url;
        currentPayload = null;
      } else if (step.id === 'hdr') {
        if (mock) {
          await sleep(900);
          resultItem = { id: `mock-hdr-${Date.now()}`, name: 'mock_hdr', type: 'video', url: currentUrl, source: 'generated' };
        } else if (settings.hdr.engine === 'runway-ruby') {
          const videoUri = /^https:\/\//i.test(currentUrl) || currentUrl.startsWith('data:') ? currentUrl : toLtxVideoUri(await ensurePayload());
          resultItem = await convertVideoToHdrWithRunwayRuby({
            videoUri,
            sourceName: safeName(input.name),
            outputFormat: settings.hdr.rubyFormat as RunwayRubyOutputFormat,
            proresProfile: settings.hdr.rubyProres,
          });
        } else {
          const videoUri = /^https:\/\//i.test(currentUrl) || currentUrl.startsWith('data:') ? currentUrl : toLtxVideoUri(await ensurePayload());
          resultItem = await upscaleVideoToAcesHdrWithLtx({ videoUri, sourceName: safeName(input.name) });
          ext = 'zip';
        }
        currentUrl = resultItem.url;
        currentPayload = null;
      } else if (step.id === 'post') {
        const finalized = await finalizeImage(currentUrl, sourceSize, settings, usedLimits, notes);
        currentUrl = finalized.url;
        outputSize = finalized.size;
        ext = finalized.ext;
        resultItem = { ...(resultItem ?? { id: `upscale-${Date.now()}`, name: '', type: 'image', source: 'generated' }), type: 'image', url: finalized.url } as MediaItem;
      }
    } finally {
      clearInterval(timer);
    }
  }

  if (!resultItem) throw new Error('Kein Ergebnis erzeugt.');
  if (req.isCancelled()) throw new CancelledError();

  const base = safeName(input.name.replace(/\.[^.]+$/, ''));
  const sizeTag = outputSize ? `_${outputSize.width}x${outputSize.height}` : '';
  const fileName = `${base}${job.purpose === 'preview' ? '_vorschau' : ''}${sizeTag}.${ext}`;
  const label = [
    settings.enhance.enabled ? enhanceModelFor(settings, input.kind).label : null,
    outputSize ? `${outputSize.width}×${outputSize.height}` : null,
    steps.some((s) => s.id === 'interpolate') ? `${req.plan.outputFps} fps` : null,
    steps.some((s) => s.id === 'hdr') ? 'HDR' : null,
    mock ? 'Testmodus' : null,
  ].filter(Boolean).join(' • ');
  const item: MediaItem = {
    ...resultItem,
    id: `${mock ? 'mock-' : ''}upscale-${job.id}`,
    name: fileName,
    url: currentUrl,
    source: 'generated',
    generatedBy: `Upscale${job.purpose === 'preview' ? '-Vorschau' : ''} • ${label}`,
    duration: resultItem.type === 'video' ? (job.range ? job.range.end - job.range.start : input.duration) : undefined,
  };

  let savedPath: string | undefined;
  if (job.purpose === 'export' && settings.export.outputFolder) {
    try {
      savedPath = await saveToFolder(settings.export.outputFolder, fileName, item.url);
      if (!savedPath) notes.push('Ausgabeordner nur in der Desktop-App verfügbar.');
    } catch (error) {
      notes.push(`Speichern fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  req.onProgress(0.99, 'Fertig');
  return { item, savedPath, notes };
};

export const isCancelledError = (error: unknown): boolean => error instanceof CancelledError;
