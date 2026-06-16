import { MediaItem } from '../types';
import { getVideoDuration } from '../utils/helpers';
import { recordUsage } from '../utils/usageTracker';
import { byokProxyJson, shouldUseByokProxy } from './byokProxyClient';

const XAI_BASE_URL = 'https://api.x.ai/v1';
export const GROK_IMAGE_MODEL = 'grok-2-image';
export const GROK_VIDEO_MODEL = 'grok-imagine-video';

const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes(' electron/');

const proxyUrl = (url: string) => (isElectron ? url : `https://corsproxy.io/?${encodeURIComponent(url)}`);

const getXaiKeyOptional = () => localStorage.getItem('xai_api_key');

const inferXaiKind = (path: string) => {
  if (path.includes('/videos')) return 'video';
  if (path.includes('/images')) return 'image';
  return 'other';
};

const parseMaybeJsonBody = (value: BodyInit | null | undefined) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const xaiFetch = async (
  path: string,
  options: RequestInit = {},
  usage?: { kind?: string; model?: string; units?: number; billable?: boolean; note?: string },
) => {
  const key = getXaiKeyOptional();
  if (!key && shouldUseByokProxy('xai')) {
    const method = (options.method || 'GET').toUpperCase();
    const body = parseMaybeJsonBody(options.body);
    return byokProxyJson<any>({
      provider: 'xai',
      url: `${XAI_BASE_URL}${path}`,
      method,
      body,
      usage: {
        kind: usage?.kind || inferXaiKind(path),
        model: usage?.model || (path.includes('/images') ? GROK_IMAGE_MODEL : path.includes('/videos') ? GROK_VIDEO_MODEL : 'xai'),
        units: usage?.units || 1,
      },
      meta: {
        billable: usage?.billable ?? !['GET', 'HEAD'].includes(method),
        note: usage?.note || `xAI proxy ${path}`,
      },
    });
  }
  if (!key) {
    throw new Error('xAI API key is missing. Please add it in Settings.');
  }

  const url = proxyUrl(`${XAI_BASE_URL}${path}`);
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${key}`);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Accept', 'application/json');

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const message = body || response.statusText;
    throw new Error(`xAI API error (${response.status}): ${message}`);
  }
  const json = await response.json().catch(() => null);
  return json;
};

const extractImageUrl = (payload: any): string => {
  const data = payload?.data || payload;
  const first = Array.isArray(data) ? data[0] : Array.isArray(data?.data) ? data.data[0] : data;
  const url = first?.url || data?.url || data?.image_url;
  if (url) return url;
  const b64 = first?.b64_json || data?.b64_json;
  if (b64) return `data:image/png;base64,${b64}`;
  return '';
};

export const generateImageWithGrok = async (prompt: string): Promise<MediaItem> => {
  const payload = {
    model: GROK_IMAGE_MODEL,
    prompt,
    n: 1,
  };
  const response = await xaiFetch('/images/generations', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, {
    kind: 'image',
    model: GROK_IMAGE_MODEL,
    units: 1,
    billable: true,
    note: 'xAI image generation',
  });
  const imageUrl = extractImageUrl(response);
  if (!imageUrl) {
    throw new Error('xAI did not return an image URL.');
  }

  recordUsage({
    provider: 'xai',
    model: GROK_IMAGE_MODEL,
    kind: 'image',
    units: 1,
    unitLabel: 'image',
    note: 'Grok image generation',
  });

  return {
    id: `grok-image-${Date.now()}`,
    name: `grok_image_${prompt.slice(0, 16) || 'output'}.png`,
    type: 'image',
    url: imageUrl,
    source: 'generated',
  };
};

const extractVideoStatus = (payload: any) => {
  const data = payload?.data || payload;
  const status = data?.status || data?.state || data?.phase;
  const url =
    data?.url ||
    data?.video_url ||
    data?.result?.url ||
    data?.data?.url ||
    (Array.isArray(data?.data) ? data.data?.[0]?.url : undefined);
  const error = data?.error || data?.error_message;
  return { status, url, error };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const generateVideoWithGrok = async (options: {
  prompt: string;
  duration?: number;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  resolution?: '480p' | '720p';
  imageUrl?: string;
  onProgress?: (message: string) => void;
}): Promise<MediaItem> => {
  const {
    prompt,
    duration = 5,
    aspectRatio = '16:9',
    resolution = '720p',
    imageUrl,
    onProgress,
  } = options;

  onProgress?.('Starting Grok video generation...');
  const payload: Record<string, any> = {
    model: GROK_VIDEO_MODEL,
    prompt,
    duration,
    aspect_ratio: aspectRatio,
    resolution,
  };
  if (imageUrl) {
    payload.image_url = imageUrl;
  }

  const startResponse = await xaiFetch('/videos/generations', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, {
    kind: 'video',
    model: GROK_VIDEO_MODEL,
    units: 1,
    billable: true,
    note: 'xAI video generation start',
  });
  const requestId = startResponse?.request_id || startResponse?.id || startResponse?.data?.request_id;
  if (!requestId) {
    throw new Error('xAI did not return a request_id for video generation.');
  }

  let checks = 0;
  while (checks < 60) {
    checks += 1;
    onProgress?.(`Rendering video... (${checks})`);
    await sleep(5000);
    const pollResponse = await xaiFetch(`/videos/${requestId}`, { method: 'GET' }, {
      kind: 'other',
      model: `${GROK_VIDEO_MODEL}/status`,
      units: 1,
      billable: false,
      note: 'xAI video status poll',
    });
    const { status, url, error } = extractVideoStatus(pollResponse);
    if (error) {
      throw new Error(`xAI video failed: ${error}`);
    }
    if (url || status === 'completed' || status === 'succeeded' || status === 'done') {
      const videoUrl = url || extractVideoStatus(pollResponse).url;
      if (!videoUrl) {
        throw new Error('xAI video completed but did not return a URL.');
      }
      let clipDuration = duration;
      try {
        clipDuration = await getVideoDuration(videoUrl);
      } catch {
        clipDuration = duration;
      }

      recordUsage({
        provider: 'xai',
        model: GROK_VIDEO_MODEL,
        kind: 'video',
        units: clipDuration,
        unitLabel: 'second',
        note: 'Grok video generation',
      });

      return {
        id: `grok-video-${Date.now()}`,
        name: `grok_video_${prompt.slice(0, 16) || 'clip'}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration: clipDuration,
      };
    }
  }

  throw new Error('xAI video generation timed out.');
};
