import { MediaItem } from '../types';
import { getVideoDuration } from '../utils/helpers';
import { recordUsage } from '../utils/usageTracker';
import { startTask } from './taskCenter';

/**
 * BytePlus ModelArk (https://docs.byteplus.com/en/docs/modelark) — ByteDance's own
 * API for Seedream (images) and Seedance (video). A second host next to fal for the
 * same models, and the only one with Seedance 2.5 in 4K.
 *
 * Auth is `Bearer <API key>`; every model must be activated once in the ModelArk
 * console. The API sends no CORS header for Authorization, which is fine in the
 * Electron window (webSecurity is off) but not in a plain browser tab.
 */

export const BYTEPLUS_API_KEY_STORAGE_KEY = 'byteplus_api_key';
export const BYTEPLUS_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';
export const BYTEDANCE_PROVIDER_PREFERENCE_KEY = 'bytedance_provider_preference_v1';

export type ByteDanceProviderPreference = 'auto' | 'fal' | 'byteplus';

export const BYTEPLUS_MODELS = {
  SEEDREAM_55: 'dola-seedream-5-5-261028',
  SEEDREAM_50_PRO: 'dola-seedream-5-0-pro-260628',
  SEEDANCE_25: 'dreamina-seedance-2-5-260628',
} as const;

export const getBytePlusApiKey = (): string | null => {
  try { return localStorage.getItem(BYTEPLUS_API_KEY_STORAGE_KEY); } catch { return null; }
};
export const hasBytePlusApiKey = () => Boolean((getBytePlusApiKey() || '').trim());

export const getByteDanceProviderPreference = (): ByteDanceProviderPreference => {
  try {
    const raw = localStorage.getItem(BYTEDANCE_PROVIDER_PREFERENCE_KEY);
    return raw === 'fal' || raw === 'byteplus' ? raw : 'auto';
  } catch { return 'auto'; }
};
export const setByteDanceProviderPreference = (value: ByteDanceProviderPreference) => {
  try { localStorage.setItem(BYTEDANCE_PROVIDER_PREFERENCE_KEY, value); } catch { /* ignore */ }
};

const hasFalKey = () => { try { return Boolean(localStorage.getItem('fal_api_key')); } catch { return false; } };

/**
 * Seedream and Seedance exist on fal and on BytePlus. "auto" keeps fal when a fal key
 * is set and falls back to BytePlus otherwise; 4K Seedance always needs BytePlus.
 */
export const shouldUseBytePlus = (opts?: { needs4k?: boolean }): boolean => {
  if (!hasBytePlusApiKey()) return false;
  if (opts?.needs4k) return true;
  const preference = getByteDanceProviderPreference();
  if (preference === 'byteplus') return true;
  if (preference === 'fal') return false;
  return !hasFalKey();
};

const authHeaders = () => {
  const key = (getBytePlusApiKey() || '').trim();
  if (!key) throw new Error('BytePlus API key is missing. Add it in Settings → API keys.');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
};

const toDataUri = (image: { base64: string; mimeType: string }) =>
  image.base64.startsWith('data:') ? image.base64 : `data:${(image.mimeType || 'image/png').toLowerCase()};base64,${image.base64}`;

const readError = async (response: Response) => {
  const text = await response.text().catch(() => response.statusText);
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string; code?: string } };
    if (parsed?.error?.message) return `${parsed.error.code ? `${parsed.error.code}: ` : ''}${parsed.error.message}`;
  } catch { /* plain text */ }
  return text;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ─── Seedream (images) ─── */

export type BytePlusSeedreamVersion = '5.5' | '5.0-pro';

// Seedream 5.x accepts 0.92–4.62 MP; these sit at the 2K tier for each ratio.
const SEEDREAM_2K_SIZES: Record<string, string> = {
  '16:9': '2560x1440',
  '9:16': '1440x2560',
  '1:1': '2048x2048',
  '4:3': '2304x1728',
  '3:4': '1728x2304',
  '21:9': '2940x1260',
  '3:2': '2496x1664',
  '2:3': '1664x2496',
  '4:5': '1824x2280',
};

export const generateImageWithBytePlusSeedream = async (
  prompt: string,
  opts?: {
    version?: BytePlusSeedreamVersion;
    images?: Array<{ base64: string; mimeType: string }>;
    aspectRatio?: string;
    resolution?: '1K' | '2K';
    background?: 'auto' | 'transparent' | 'opaque';
  },
): Promise<MediaItem[]> => {
  const version = opts?.version || '5.5';
  const model = version === '5.5' ? BYTEPLUS_MODELS.SEEDREAM_55 : BYTEPLUS_MODELS.SEEDREAM_50_PRO;
  const label = version === '5.5' ? 'Seedream 5.5' : 'Seedream 5.0 Pro';
  const refs = (opts?.images || []).filter((image) => image?.base64).slice(0, 10);
  const ratio = (opts?.aspectRatio || '').replace(/\s/g, '');
  const body: Record<string, unknown> = {
    model,
    prompt,
    size: opts?.resolution !== '1K' && SEEDREAM_2K_SIZES[ratio] ? SEEDREAM_2K_SIZES[ratio] : opts?.resolution === '1K' ? '1K' : '2K',
    response_format: 'url',
    output_format: 'png',
    watermark: false,
  };
  if (refs.length > 0) body.image = refs.length === 1 ? toDataUri(refs[0]) : refs.map(toDataUri);
  if (opts?.background) body.background = opts.background;

  const task = startTask({ label: `${label} · BytePlus`, kind: 'image', provider: 'byteplus', estimatedMs: 45_000, message: 'Rendering…' });
  try {
    const response = await fetch(`${BYTEPLUS_BASE_URL}/images/generations`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`BytePlus ${label} error (${response.status}): ${await readError(response)}`);
    const payload = (await response.json()) as { data?: Array<{ url?: string; error?: { message?: string } }> };
    const urls = (payload.data || []).map((item) => item.url).filter((url): url is string => Boolean(url));
    if (urls.length === 0) {
      const reason = payload.data?.find((item) => item.error)?.error?.message;
      throw new Error(`BytePlus ${label} returned no image${reason ? `: ${reason}` : '.'}`);
    }
    task.complete();
    recordUsage({ provider: 'byteplus', model, kind: refs.length > 0 ? 'edit' : 'image', units: urls.length, unitLabel: 'image', note: `${label} via BytePlus` });
    const stamp = Date.now();
    return urls.map((url, index) => ({
      id: `byteplus-seedream-${version.replace('.', '')}-${stamp}-${index}`,
      name: `byteplus_seedream_${version.replace(/\W/g, '')}_${prompt.slice(0, 16) || 'image'}${index > 0 ? `_${index + 1}` : ''}.png`,
      type: 'image' as const,
      url,
      source: 'generated' as const,
      generatedBy: `${label} · BytePlus`,
      prompt,
    }));
  } catch (error) {
    task.fail(error instanceof Error ? error.message : String(error));
    throw error;
  }
};

/* ─── Seedance 2.5 (video) ─── */

export type BytePlusSeedanceResolution = '480p' | '720p' | '1080p' | '4k';

type SeedanceTask = {
  id?: string;
  status?: 'queued' | 'running' | 'succeeded' | 'failed' | 'expired' | 'cancelled' | string;
  content?: { video_url?: string; last_frame_url?: string };
  error?: { message?: string; code?: string } | null;
  duration?: number;
};

export const generateVideoWithBytePlusSeedance25 = async (
  prompt: string,
  opts?: {
    image?: { base64: string; mimeType: string };
    endImage?: { base64: string; mimeType: string };
    referenceImages?: Array<{ base64: string; mimeType: string }>;
    duration?: number | 'auto';
    aspectRatio?: string;
    resolution?: BytePlusSeedanceResolution;
    generateAudio?: boolean;
  },
): Promise<MediaItem> => {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
  const firstFrame = opts?.image?.base64 ? opts.image : undefined;
  const references = firstFrame ? [] : (opts?.referenceImages || []).filter((image) => image?.base64).slice(0, 30);
  if (firstFrame) {
    content.push({ type: 'image_url', image_url: { url: toDataUri(firstFrame) }, role: 'first_frame' });
    if (opts?.endImage?.base64) content.push({ type: 'image_url', image_url: { url: toDataUri(opts.endImage) }, role: 'last_frame' });
  }
  references.forEach((image) => content.push({ type: 'image_url', image_url: { url: toDataUri(image) }, role: 'reference_image' }));

  const requested = typeof opts?.duration === 'number' ? Math.round(opts.duration) : undefined;
  const duration = requested === undefined ? -1 : Math.min(30, Math.max(4, requested));
  const ratioCandidates = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];
  // First-frame tasks only accept "adaptive" on 2.5.
  const ratio = firstFrame ? 'adaptive' : ratioCandidates.includes(opts?.aspectRatio || '') ? opts!.aspectRatio! : 'adaptive';
  const body = {
    model: BYTEPLUS_MODELS.SEEDANCE_25,
    content,
    resolution: opts?.resolution || '720p',
    ratio,
    duration,
    generate_audio: opts?.generateAudio ?? true,
    watermark: false,
  };

  const label = `Seedance 2.5 ${firstFrame ? 'image-to-video' : references.length ? 'reference-to-video' : 'text-to-video'}`;
  const task = startTask({ label: `${label} · BytePlus`, kind: 'video', provider: 'byteplus', estimatedMs: opts?.resolution === '4k' ? 8 * 60_000 : 3 * 60_000, message: 'Queued…' });
  try {
    const created = await fetch(`${BYTEPLUS_BASE_URL}/contents/generations/tasks`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    if (!created.ok) throw new Error(`BytePlus Seedance error (${created.status}): ${await readError(created)}`);
    const { id } = (await created.json()) as { id?: string };
    if (!id) throw new Error('BytePlus Seedance returned no task id.');

    let state: SeedanceTask = { status: 'queued' };
    for (let checks = 0; checks < 360 && (state.status === 'queued' || state.status === 'running'); checks += 1) {
      task.update({ message: state.status === 'running' ? 'Rendering…' : 'Waiting in queue…' });
      await sleep(5000);
      const poll = await fetch(`${BYTEPLUS_BASE_URL}/contents/generations/tasks/${id}`, { headers: authHeaders() });
      if (!poll.ok) throw new Error(`BytePlus Seedance status error (${poll.status}): ${await readError(poll)}`);
      state = (await poll.json()) as SeedanceTask;
    }
    const videoUrl = state.content?.video_url;
    if (state.status !== 'succeeded' || !videoUrl) {
      throw new Error(state.error?.message ? `BytePlus Seedance failed: ${state.error.message}` : `BytePlus Seedance ended with status ${state.status || 'unknown'}.`);
    }
    let resolvedDuration = state.duration || (duration > 0 ? duration : 10);
    try { resolvedDuration = await getVideoDuration(videoUrl); } catch { /* keep reported */ }
    task.complete();
    recordUsage({ provider: 'byteplus', model: BYTEPLUS_MODELS.SEEDANCE_25, kind: 'video', units: resolvedDuration, unitLabel: 'second', note: `${label} ${body.resolution} via BytePlus` });
    return {
      id: `byteplus-seedance-25-${Date.now()}`,
      name: `byteplus_seedance_25_${prompt.slice(0, 15) || 'clip'}.mp4`,
      type: 'video',
      url: videoUrl,
      source: 'generated',
      generatedBy: `${label} · BytePlus`,
      prompt,
      duration: resolvedDuration,
    };
  } catch (error) {
    task.fail(error instanceof Error ? error.message : String(error));
    throw error;
  }
};
