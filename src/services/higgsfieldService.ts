import { MediaItem } from '../types';
import { getVideoDuration } from '../utils/helpers';
import { recordUsage } from '../utils/usageTracker';
import { startTask } from './taskCenter';
import { getFalVideoCatalogEntry, pickCatalogAspect, pickCatalogDuration, type FalVideoCatalogEntry } from './falVideoCatalog';

/**
 * Higgsfield API (https://docs.higgsfield.ai) — an alternative host for the same
 * vendor models fal serves (Kling, MiniMax, Seedance, Wan, LTX…) plus Higgsfield's
 * own Soul / DoP models. Same queue shape as fal: POST /{model} → request_id +
 * status_url; poll until completed; the status payload carries images[] / video.
 *
 * Two differences matter: auth is `Key <id>:<secret>`, and inputs must be uploaded
 * first (no data: URIs) — /files/generate-upload-url → PUT → public_url.
 */

export const HIGGSFIELD_API_KEY_STORAGE_KEY = 'higgsfield_api_key';
export const HIGGSFIELD_BASE_URL = 'https://api.higgsfield.ai';
export const VIDEO_PROVIDER_PREFERENCE_KEY = 'video_provider_preference_v1';

export type VideoProviderPreference = 'auto' | 'fal' | 'higgsfield';

export const getHiggsfieldApiKey = (): string | null => {
  try { return localStorage.getItem(HIGGSFIELD_API_KEY_STORAGE_KEY); } catch { return null; }
};
export const hasHiggsfieldApiKey = () => Boolean((getHiggsfieldApiKey() || '').includes(':'));

export const getVideoProviderPreference = (): VideoProviderPreference => {
  try {
    const raw = localStorage.getItem(VIDEO_PROVIDER_PREFERENCE_KEY);
    return raw === 'fal' || raw === 'higgsfield' ? raw : 'auto';
  } catch { return 'auto'; }
};
export const setVideoProviderPreference = (value: VideoProviderPreference) => {
  try { localStorage.setItem(VIDEO_PROVIDER_PREFERENCE_KEY, value); } catch { /* ignore */ }
};

const authHeader = () => {
  const key = (getHiggsfieldApiKey() || '').trim();
  if (!key.includes(':')) throw new Error('Higgsfield API key is missing. Add it in Settings as KEY_ID:KEY_SECRET.');
  return `Key ${key}`;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type HiggsfieldStatus = {
  status?: 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled' | string;
  request_id?: string;
  status_url?: string;
  cancel_url?: string;
  error?: string | null;
  images?: Array<{ url: string }>;
  video?: { url: string };
  audio?: { url: string };
  audios?: Array<{ url: string }>;
};

/** Upload one file and return the public URL to pass into image_url / video_url / audio_url. */
export const uploadToHiggsfield = async (file: { base64: string; mimeType: string }): Promise<string> => {
  const contentType = file.mimeType || 'image/png';
  const ticket = await fetch(`${HIGGSFIELD_BASE_URL}/files/generate-upload-url`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: contentType }),
  });
  if (!ticket.ok) throw new Error(`Higgsfield upload ticket failed (${ticket.status}): ${await ticket.text().catch(() => '')}`);
  const { public_url, upload_url, upload_headers } = (await ticket.json()) as { public_url: string; upload_url: string; upload_headers?: Record<string, string> };
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  // The presigned URL belongs to the storage provider — never send the Higgsfield key there.
  const put = await fetch(upload_url, { method: 'PUT', headers: { ...(upload_headers || {}), 'Content-Type': contentType }, body: bytes });
  if (!put.ok) throw new Error(`Higgsfield upload failed (${put.status}).`);
  return public_url;
};

export const runHiggsfieldQueue = async (
  model: string,
  input: Record<string, unknown>,
  opts?: { pollIntervalMs?: number; maxChecks?: number; label?: string; estimatedMs?: number },
): Promise<HiggsfieldStatus> => {
  const task = startTask({ label: opts?.label || `Higgsfield · ${model}`, kind: /image|soul/.test(model) && !/video/.test(model) ? 'image' : 'video', provider: 'higgsfield', estimatedMs: opts?.estimatedMs || 3 * 60 * 1000, message: 'Queued…' });
  try {
    const submit = await fetch(`${HIGGSFIELD_BASE_URL}/${model}`, {
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!submit.ok) throw new Error(`Higgsfield error (${submit.status}): ${await submit.text().catch(() => submit.statusText)}`);
    let state = (await submit.json()) as HiggsfieldStatus;
    const statusUrl = state.status_url || `${HIGGSFIELD_BASE_URL}/requests/${state.request_id}/status`;
    const pollIntervalMs = opts?.pollIntervalMs ?? 5000;
    const maxChecks = opts?.maxChecks ?? 240;
    let checks = 0;
    while (checks < maxChecks && (state.status === 'queued' || state.status === 'in_progress' || !state.status)) {
      checks += 1;
      task.update({ message: state.status === 'in_progress' ? 'Rendering…' : 'Waiting in queue…' });
      await sleep(pollIntervalMs);
      const poll = await fetch(statusUrl, { headers: { Authorization: authHeader() } });
      if (!poll.ok) throw new Error(`Higgsfield status error (${poll.status}).`);
      state = (await poll.json()) as HiggsfieldStatus;
    }
    if (state.status !== 'completed') {
      throw new Error(state.status === 'nsfw' ? 'Higgsfield blocked the request (nsfw).' : state.error ? `Higgsfield failed: ${state.error}` : `Higgsfield ended with status ${state.status || 'unknown'}.`);
    }
    task.complete();
    return state;
  } catch (error) {
    task.fail(error instanceof Error ? error.message : String(error));
    throw error;
  }
};

/** Higgsfield ids for the catalog entries that Higgsfield also hosts (console catalog; only some are in the public OpenAPI). */
export const HIGGSFIELD_VIDEO_PATHS: Record<string, { text?: string; image?: string; verified?: boolean }> = {
  'hailuo-2.3-fal': { text: 'minimax/hailuo-2.3/standard/text-to-video', image: 'minimax/hailuo-2.3/standard/image-to-video', verified: true },
  'kling-v3-std-fal': { text: 'kling-video/v3.0/std/text-to-video', image: 'kling-video/v3.0/std/image-to-video' },
  'kling-v3-4k-fal': { text: 'kling-video/v3.0/4k/text-to-video', image: 'kling-video/v3.0/4k/image-to-video' },
  'minimax-h3-fal': { text: 'minimax/h3/text-to-video', image: 'minimax/h3/image-to-video' },
  'ltx-2.5-pro-fal': { text: 'lightricks/ltx-2.5/text-to-video/pro', image: 'lightricks/ltx-2.5/image-to-video/pro' },
  'wan-3.0-fal': { text: 'alibaba/wan-3.0/text-to-video', image: 'alibaba/wan-3.0/image-to-video' },
  'wan-3.0-prime-fal': { text: 'alibaba/wan-3.0-prime/text-to-video', image: 'alibaba/wan-3.0-prime/image-to-video' },
  'pixverse-v6-fal': { text: 'pixverse/v6/text-to-video', image: 'pixverse/v6/image-to-video' },
  // Higgsfield-only
  'higgsfield-dop-lite': { image: 'higgsfield-ai/dop/lite' },
};

export const HIGGSFIELD_IMAGE_MODELS: Array<{ id: string; label: string; path: string; goodFor: string; verified?: boolean; badge?: string }> = [
  { id: 'soul-standard-hf', label: 'Higgsfield Soul (Higgsfield)', path: 'higgsfield-ai/soul/standard', goodFor: 'Fashion / editorial realism, strong aesthetic presets', verified: true },
  { id: 'soul-2-hf', label: 'Higgsfield Soul 2 (Higgsfield)', path: 'higgsfield-ai/soul/v2/standard', goodFor: 'Soul 2 — newer, sharper realism' },
  { id: 'soul-cinema-hf', label: 'Higgsfield Soul Cinema (Higgsfield)', path: 'higgsfield-ai/soul/cinema', goodFor: 'Film-still look for storyboard frames', badge: '🎬 Cinematic' },
];

export const isHiggsfieldImageModel = (id: string | null | undefined) => HIGGSFIELD_IMAGE_MODELS.some((m) => m.id === id);
export const higgsfieldHostsVideoModel = (id: string | null | undefined) => Boolean(id && HIGGSFIELD_VIDEO_PATHS[id]);

const buildVideoInput = (entry: FalVideoCatalogEntry, prompt: string, opts: { imageUrl?: string; endImageUrl?: string; duration?: number; aspectRatio?: string; resolution?: string; audio?: boolean; negativePrompt?: string }) => {
  const duration = pickCatalogDuration(entry, opts.duration);
  const input: Record<string, unknown> = { prompt, ...(entry.extra || {}) };
  if (opts.imageUrl) input[entry.imageField] = opts.imageUrl;
  if (opts.imageUrl && entry.endField && opts.endImageUrl) input[entry.endField] = opts.endImageUrl;
  if (!entry.aspectOnlyForText || !opts.imageUrl) input.aspect_ratio = pickCatalogAspect(entry, opts.aspectRatio);
  if (entry.resolutions) input.resolution = opts.resolution && entry.resolutions.includes(opts.resolution) ? opts.resolution : entry.defaultResolution || entry.resolutions[0];
  if (!entry.noDuration) input.duration = entry.durationAsString ? String(duration) : duration;
  if (entry.audioField) input[entry.audioField.name] = entry.audioField.kind === 'onoff' ? (opts.audio === false ? 'off' : 'on') : opts.audio !== false;
  if (entry.supportsNegativePrompt && opts.negativePrompt) input.negative_prompt = opts.negativePrompt;
  return { input, duration };
};

export const generateVideoWithHiggsfield = async (
  modelId: string,
  prompt: string,
  opts?: { image?: { base64: string; mimeType: string }; endImage?: { base64: string; mimeType: string }; duration?: number; aspectRatio?: string; resolution?: string; audio?: boolean; negativePrompt?: string },
): Promise<MediaItem> => {
  const entry = getFalVideoCatalogEntry(modelId) || DOP_ENTRY;
  const paths = HIGGSFIELD_VIDEO_PATHS[modelId];
  if (!paths) throw new Error(`Higgsfield does not host ${modelId}.`);
  const hasImage = Boolean(opts?.image?.base64);
  const path = hasImage ? paths.image : paths.text;
  if (!path) throw new Error(`${entry.label} on Higgsfield needs ${hasImage ? 'a text-to-video' : 'an image-to-video'} endpoint.`);
  const imageUrl = hasImage ? await uploadToHiggsfield(opts!.image!) : undefined;
  const endImageUrl = hasImage && opts?.endImage?.base64 ? await uploadToHiggsfield(opts.endImage) : undefined;
  const { input, duration } = buildVideoInput(entry, prompt, { ...opts, imageUrl, endImageUrl });
  const state = await runHiggsfieldQueue(path, input, { label: `${entry.label.replace(/ \(FAL\)$/, '')} · Higgsfield`, estimatedMs: entry.estimatedMs });
  const videoUrl = state.video?.url;
  if (!videoUrl) throw new Error(`${entry.label} (Higgsfield) returned no video.`);
  let resolvedDuration = duration;
  try { resolvedDuration = await getVideoDuration(videoUrl); } catch { /* keep requested */ }
  recordUsage({ provider: 'higgsfield', model: path, kind: 'video', units: resolvedDuration, unitLabel: 'second', note: `${entry.label} via Higgsfield` });
  return {
    id: `hf-${modelId}-${Date.now()}`,
    name: `${modelId.replace(/[^a-z0-9]+/gi, '_')}_${prompt.slice(0, 15) || 'clip'}.mp4`,
    type: 'video',
    url: videoUrl,
    source: 'generated',
    generatedBy: `${entry.label.replace(/ \(FAL\)$/, '')} · Higgsfield`,
    prompt,
    duration: resolvedDuration,
  };
};

/** Higgsfield's own camera-move model; not on fal, so it lives here rather than in the fal catalog. */
export const DOP_ENTRY: FalVideoCatalogEntry = {
  id: 'higgsfield-dop-lite', label: 'Higgsfield DoP Lite', goodFor: 'Cinematic camera moves from a single frame (Higgsfield\'s own model)',
  paths: {}, imageField: 'image_url', aspectRatios: ['16:9', '9:16', '1:1'], aspectOnlyForText: true, durations: [5], defaultDuration: 5, noDuration: true, costPerSecond: 0.1,
};

export const generateImageWithHiggsfield = async (modelId: string, prompt: string, opts?: { aspectRatio?: string; resolution?: '720p' | '1080p' }): Promise<MediaItem> => {
  const model = HIGGSFIELD_IMAGE_MODELS.find((m) => m.id === modelId);
  if (!model) throw new Error(`Unknown Higgsfield image model: ${modelId}`);
  const requested = (opts?.aspectRatio || '16:9').replace(/\s/g, '');
  const aspect = ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2'].includes(requested) ? requested : /^(9:16|3:4|2:3|4:5)$/.test(requested) ? '3:4' : '16:9';
  const state = await runHiggsfieldQueue(model.path, { prompt, aspect_ratio: aspect, resolution: opts?.resolution || '1080p', batch_size: 1, enhance_prompt: false }, { label: model.label, pollIntervalMs: 2500, maxChecks: 120 });
  const url = state.images?.[0]?.url;
  if (!url) throw new Error(`${model.label} returned no image.`);
  recordUsage({ provider: 'higgsfield', model: model.path, kind: 'image', units: 1, unitLabel: 'image', note: model.label });
  return { id: `${modelId}-${Date.now()}`, name: `${modelId}_${prompt.slice(0, 15) || 'image'}.png`, type: 'image', url, source: 'generated', generatedBy: model.label, prompt };
};
