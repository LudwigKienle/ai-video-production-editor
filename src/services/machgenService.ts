import type { MediaItem } from '../types';
import { recordUsage } from '../utils/usageTracker';
import { startTask } from './taskCenter';
import { MACHGEN_VIDEO_MODELS, buildMachgenVideoInput, machgenReferenceLimit, type MachgenImageModelId, type MachgenVideoModelId } from './machgenModels';

export { MACHGEN_VIDEO_MODELS, type MachgenImageModelId, type MachgenVideoModelId, type MachgenVideoSpec } from './machgenModels';

/**
 * MachGen (machgen.ai): fast inference for open image and video models, including
 * MiniMax H3 Turbo. REST API at https://api.machgen.ai:
 *   POST /api/v0/upload            multipart "file" → { artifact_path } (use as "@input/<path>")
 *   POST /api/v0/generate          TaskInput → { task_id }
 *   GET  /api/v0/tasks/{id}        status PENDING | RUNNING | COMPLETED | FAILED
 *   GET  /api/v0/assets/{id}       the result (needs the key, so it is fetched into a blob URL)
 * The key looks like MGA_<key_id>:<secret> and is sent as a bearer token.
 * Docs: https://www.machgen.ai/docs/rest_api (upload path from the official machgen-client 0.2.0).
 */

export const MACHGEN_API_KEY_STORAGE_KEY = 'machgen_api_key';
const BASE_URL = 'https://api.machgen.ai';

export const getMachgenApiKey = () => {
  try {
    return (localStorage.getItem(MACHGEN_API_KEY_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
};

const authHeaders = () => {
  const key = getMachgenApiKey();
  if (!key) throw new Error('MachGen API key is missing. Add it in Settings → AI providers (MGA_…).');
  return { Authorization: `Bearer ${key}` };
};

const readError = async (response: Response) => {
  const text = await response.text().catch(() => '');
  try {
    const detail = JSON.parse(text)?.detail;
    if (detail) return typeof detail === 'string' ? detail : JSON.stringify(detail);
  } catch {
    /* not JSON */
  }
  return text || response.statusText;
};

// ---------------------------------------------------------------------------
// Upload, submit, wait, download
// ---------------------------------------------------------------------------

/** Upload an image and return the "@input/…" reference MachGen accepts in src_image_urls. */
export const uploadToMachgen = async (image: { base64: string; mimeType: string }, name = 'reference.png') => {
  const bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: image.mimeType || 'image/png' }), name);
  const response = await fetch(`${BASE_URL}/api/v0/upload`, { method: 'POST', headers: authHeaders(), body: form });
  if (!response.ok) throw new Error(`MachGen upload failed (${response.status}): ${await readError(response)}`);
  const { artifact_path } = (await response.json()) as { artifact_path?: string };
  if (!artifact_path) throw new Error('MachGen upload returned no artifact path.');
  return `@input/${artifact_path}`;
};

type MachgenTaskStatus = {
  task_id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  error_msg?: string | null;
  task_output?: Record<string, string> | null;
  metadata?: { duration_secs?: number; width?: number; height?: number } & Record<string, unknown>;
  progress?: { percent?: number; fraction?: number } & Record<string, unknown>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Submit a task and wait for it; reports progress in the Activity center. */
export const runMachgenTask = async (input: Record<string, unknown>, label: string, kind: 'image' | 'video'): Promise<MachgenTaskStatus> => {
  const task = startTask({ label: `MachGen · ${label}`, kind, provider: 'machgen', estimatedMs: kind === 'video' ? 90 * 1000 : 15 * 1000, message: 'Queued…' });
  try {
    const submit = await fetch(`${BASE_URL}/api/v0/generate`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!submit.ok) throw new Error(`MachGen (${submit.status}): ${await readError(submit)}`);
    const { task_id: taskId } = (await submit.json()) as { task_id?: string };
    if (!taskId) throw new Error('MachGen returned no task id.');
    const started = Date.now();
    const timeoutMs = kind === 'video' ? 30 * 60 * 1000 : 5 * 60 * 1000;
    for (;;) {
      await sleep(kind === 'video' ? 2500 : 1200);
      const poll = await fetch(`${BASE_URL}/api/v0/tasks/${encodeURIComponent(taskId)}`, { headers: authHeaders() });
      if (!poll.ok) throw new Error(`MachGen status (${poll.status}): ${await readError(poll)}`);
      const state = (await poll.json()) as MachgenTaskStatus;
      if (state.status === 'COMPLETED') {
        task.complete();
        return state;
      }
      if (state.status === 'FAILED') throw new Error(`MachGen failed: ${state.error_msg || 'unknown error'}`);
      task.update({ message: state.status === 'RUNNING' ? 'Rendering…' : 'Waiting in queue…' });
      if (Date.now() - started > timeoutMs) throw new Error('MachGen took too long; the task keeps running on their side.');
    }
  } catch (error) {
    task.fail(error instanceof Error ? error.message : String(error));
    throw error;
  }
};

/** Results need the key, so download them into a blob URL. */
const downloadAsset = async (state: MachgenTaskStatus, kind: 'image' | 'video') => {
  const assetUrl = state.task_output?.[kind] || Object.values(state.task_output || {})[0] || `${BASE_URL}/api/v0/assets/${state.task_id}`;
  const url = assetUrl.startsWith('http') ? assetUrl : `${BASE_URL}${assetUrl.startsWith('/') ? '' : '/'}${assetUrl}`;
  const response = await fetch(url, { headers: url.startsWith(BASE_URL) ? authHeaders() : {} });
  if (!response.ok) throw new Error(`MachGen download failed (${response.status}).`);
  return URL.createObjectURL(await response.blob());
};

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export type MachgenVideoOptions = {
  duration?: number;
  aspectRatio?: string;
  height?: number;
  audio?: boolean;
  seed?: number;
  enhancePrompt?: boolean;
  startImage?: { base64: string; mimeType: string };
  endImage?: { base64: string; mimeType: string };
  /** Reference-to-video subjects (MiniMax H3 / Turbo, Vidu); address them as @ref1, @ref2… */
  references?: Array<{ base64: string; mimeType: string }>;
};

export const generateVideoWithMachgen = async (model: MachgenVideoModelId, prompt: string, opts: MachgenVideoOptions = {}): Promise<MediaItem> => {
  const spec = MACHGEN_VIDEO_MODELS[model];
  const uploads: { startUrls?: string[]; referenceUrls?: string[] } = {};
  if (opts.startImage) {
    uploads.startUrls = [await uploadToMachgen(opts.startImage, 'start.png')];
    if (opts.endImage && spec.endFrame) uploads.startUrls.push(await uploadToMachgen(opts.endImage, 'end.png'));
  } else if (opts.references?.length) {
    uploads.referenceUrls = [];
    for (const [index, ref] of opts.references.slice(0, machgenReferenceLimit(model)).entries()) {
      uploads.referenceUrls.push(await uploadToMachgen(ref, `ref${index + 1}.png`));
    }
  }
  const { input, duration } = buildMachgenVideoInput(model, prompt, opts, uploads);

  const state = await runMachgenTask(input, `${model} ${input.task_type}`, 'video');
  const url = await downloadAsset(state, 'video');
  const seconds = typeof state.metadata?.duration_secs === 'number' ? state.metadata.duration_secs : duration;
  recordUsage({ provider: 'machgen', model, kind: 'video', units: seconds, unitLabel: 'second', note: `MachGen ${model} ${input.task_type}` });
  return {
    id: `machgen-${model.toLowerCase()}-${Date.now()}`,
    name: `machgen_${model.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${prompt.slice(0, 15) || 'clip'}.mp4`,
    type: 'video',
    url,
    source: 'generated',
    duration: seconds,
    generatedBy: `${model} (MachGen)`,
    prompt,
  } as MediaItem;
};

const IMAGE_SIZES: Record<string, [number, number]> = {
  '16:9': [1344, 768],
  '9:16': [768, 1344],
  '1:1': [1024, 1024],
  '4:3': [1152, 864],
  '3:4': [864, 1152],
};

export const generateImageWithMachgen = async (
  model: MachgenImageModelId,
  prompt: string,
  opts: { aspectRatio?: string; imageSize?: '1K' | '2K' | '4K'; seed?: number; references?: Array<{ base64: string; mimeType: string }> } = {}
): Promise<MediaItem> => {
  const [baseW, baseH] = IMAGE_SIZES[opts.aspectRatio || '16:9'] || IMAGE_SIZES['16:9'];
  const scale = opts.imageSize === '2K' ? 1.5 : opts.imageSize === '4K' ? 2 : 1;
  const round = (value: number) => Math.round((value * scale) / 16) * 16;
  const input: Record<string, unknown> = {
    model,
    prompt,
    task_type: 'T2I',
    image_config: { width: round(baseW), height: round(baseH) },
  };
  if (typeof opts.seed === 'number') input.seed = opts.seed;
  if (opts.references?.length && model === 'FLUX.2-dev') {
    const urls: string[] = [];
    for (const [index, ref] of opts.references.slice(0, 4).entries()) urls.push(await uploadToMachgen(ref, `ref${index + 1}.png`));
    input.task_type = 'I2I';
    input.src_image_urls = urls;
  }
  const state = await runMachgenTask(input, `${model} ${input.task_type}`, 'image');
  const url = await downloadAsset(state, 'image');
  recordUsage({ provider: 'machgen', model, kind: input.task_type === 'I2I' ? 'edit' : 'image', units: 1, unitLabel: 'image', note: `MachGen ${model} ${input.task_type}` });
  return {
    id: `machgen-${model.toLowerCase()}-${Date.now()}`,
    name: `machgen_${model.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${prompt.slice(0, 16) || 'image'}.jpg`,
    type: 'image',
    url,
    source: 'generated',
    generatedBy: `${model} (MachGen)`,
    prompt,
  } as MediaItem;
};
