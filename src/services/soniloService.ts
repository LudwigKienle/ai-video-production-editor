import type { MediaItem, UsageEntry } from '../types';

export const SONILO_API_BASE_URL = 'https://api.sonilo.com';
export const SONILO_VIDEO_TO_MUSIC_PATH = '/v1/video-to-music';
export const SONILO_VIDEO_TO_MUSIC_MODEL = 'video-to-music';
export const SONILO_API_KEY_STORAGE_KEY = 'sonilo_api_key';
export const SONILO_API_KEYS_URL = 'https://platform.sonilo.com/dashboard/api-keys';

// The backend rejects videos longer than 6 minutes; surfaced here so UI copy
// can reference the same limit.
export const SONILO_MAX_VIDEO_DURATION_SECONDS = 360;

type SoniloStreamEvent = {
  type?: string;
  data?: string;
  stream_index?: number;
  num_streams?: number;
  title?: string;
  message?: string;
  code?: string;
};

type UsageInput = Omit<UsageEntry, 'id' | 'createdAt'> & Partial<Pick<UsageEntry, 'id' | 'createdAt'>>;

type SoniloClientDeps = {
  apiKey?: string | null;
  baseUrl?: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  recordUsage?: (entry: UsageInput) => unknown;
  createObjectUrl?: (blob: Blob) => string;
};

export type SoniloVideoToMusicInput = {
  /** HTTPS URL, blob: URL, or data: URI of the rendered video. */
  videoUrl: string;
  /** Original video name, used to label the generated track. */
  videoName?: string;
  /** Optional single style hint for the whole track. */
  prompt?: string;
  onStatus?: (message: string) => void;
};

const getDefaultFetch = () => {
  if (typeof fetch === 'undefined') {
    throw new Error('Fetch API is not available in this runtime.');
  }
  return fetch.bind(globalThis);
};

export const getSoniloApiKeyOptional = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(SONILO_API_KEY_STORAGE_KEY);
};

export const hasSoniloApiKey = () => Boolean(getSoniloApiKeyOptional());

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

const sanitizeNameSegment = (value?: string) => {
  const raw = (value || '').replace(/\.[a-z0-9]+$/i, '');
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
};

const readErrorDetail = async (response: Response) => {
  const text = await response.text().catch(() => '');
  if (!text) return response.statusText;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const detail = parsed.detail || parsed.error || parsed.message;
      if (typeof detail === 'string' && detail.trim()) return detail.trim();
    }
    return text;
  } catch {
    return text;
  }
};

const buildHttpError = (status: number, detail: string) => {
  if (status === 401) {
    return new Error(`Sonilo API key was rejected. Verify the key in Settings (${SONILO_API_KEYS_URL}).`);
  }
  if (status === 402) {
    return new Error(detail || 'Sonilo account has no remaining credits.');
  }
  if (status === 413) {
    return new Error(`Sonilo upload is too large: ${detail}`);
  }
  if (status === 429) {
    return new Error(`Sonilo rate limit exceeded: ${detail}`);
  }
  return new Error(`Sonilo API Error (${status}): ${detail}`);
};

const decodeBase64Chunk = (data: string): Uint8Array | null => {
  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
};

const concatChunks = (chunks: Uint8Array[]) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
};

type ConsumedStream = {
  audioBytes: Uint8Array;
  title: string | null;
};

/**
 * Consume the NDJSON event stream returned by Sonilo generation endpoints.
 *
 * Event types: `audio_chunk` (base64 audio bytes per stream_index), `title`,
 * `complete` (terminal success), `error` (terminal failure). Progress events
 * such as `stage_start`/`stage_complete` and malformed lines are ignored.
 */
const consumeNdjsonStream = async (response: Response): Promise<ConsumedStream> => {
  const body = response.body;
  if (!body) {
    throw new Error('Sonilo returned an empty response stream.');
  }

  const streams = new Map<number, Uint8Array[]>();
  let title: string | null = null;
  let completed = false;
  let errorMessage: string | null = null;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let event: SoniloStreamEvent;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (!event || typeof event !== 'object') return;
    if (event.type === 'audio_chunk') {
      const index = Number.isInteger(event.stream_index) ? Number(event.stream_index) : 0;
      if (index < 0 || typeof event.data !== 'string') return;
      const decoded = decodeBase64Chunk(event.data);
      if (!decoded) return;
      const chunks = streams.get(index) || [];
      chunks.push(decoded);
      streams.set(index, chunks);
    } else if (event.type === 'title') {
      if (typeof event.title === 'string' && event.title.trim()) {
        title = event.title.trim();
      }
    } else if (event.type === 'complete') {
      completed = true;
    } else if (event.type === 'error') {
      errorMessage = event.message || event.code || 'Sonilo stream error.';
    }
  };

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!errorMessage) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      handleLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf('\n');
    }
  }
  if (!errorMessage && buffer.trim()) {
    handleLine(buffer);
  }

  if (errorMessage) {
    throw new Error(errorMessage);
  }
  if (!completed) {
    throw new Error('Sonilo stream ended before completing. Please try again.');
  }

  const firstIndex = [...streams.keys()].sort((a, b) => a - b)[0];
  const chunks = firstIndex === undefined ? [] : streams.get(firstIndex) || [];
  if (chunks.length === 0) {
    throw new Error('Sonilo finished without returning audio data.');
  }
  return { audioBytes: concatChunks(chunks), title };
};

export const createSoniloVideoToMusicClient = (deps: SoniloClientDeps = {}) => {
  const baseUrl = normalizeBaseUrl(deps.baseUrl || SONILO_API_BASE_URL);
  const fetchImpl = deps.fetchImpl || getDefaultFetch();
  const now = deps.now || (() => Date.now());
  const createObjectUrl = deps.createObjectUrl || ((blob: Blob) => URL.createObjectURL(blob));

  const resolveApiKey = () => {
    if (deps.apiKey !== undefined) return deps.apiKey?.trim() || null;
    return getSoniloApiKeyOptional()?.trim() || null;
  };

  const buildRequestBody = async (input: SoniloVideoToMusicInput) => {
    const videoUrl = input.videoUrl.trim();
    if (!videoUrl) {
      throw new Error('Sonilo needs a video input.');
    }
    const form = new FormData();
    if (/^https?:\/\//i.test(videoUrl)) {
      // Remote videos are passed by URL so the backend fetches them directly.
      form.append('video_url', videoUrl);
    } else {
      // blob:/data: sources only exist locally, so upload the bytes.
      const response = await fetchImpl(videoUrl);
      if (!response.ok) {
        throw new Error(`Could not read the input video (${response.status}).`);
      }
      const blob = await response.blob();
      const fileName = input.videoName?.trim() || 'video.mp4';
      form.append('video', new File([blob], fileName, { type: blob.type || 'video/mp4' }));
    }
    const prompt = input.prompt?.trim();
    if (prompt) {
      form.append('prompt', prompt);
    }
    return form;
  };

  const generateMusicFromVideo = async (input: SoniloVideoToMusicInput): Promise<MediaItem> => {
    const key = resolveApiKey();
    if (!key) {
      throw new Error('Sonilo API key is missing. Add it in Settings.');
    }

    const form = await buildRequestBody(input);
    input.onStatus?.('Sonilo: composing a track from the video...');

    const response = await fetchImpl(`${baseUrl}${SONILO_VIDEO_TO_MUSIC_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
      },
      body: form,
    });

    if (!response.ok) {
      throw buildHttpError(response.status, await readErrorDetail(response));
    }

    input.onStatus?.('Sonilo: receiving audio...');
    const { audioBytes, title } = await consumeNdjsonStream(response);

    // The backend streams AAC audio in an MP4 container (.m4a). The merged
    // buffer is exactly sized in concatChunks, so it is safe to hand over.
    const audioBlob = new Blob([audioBytes.buffer as ArrayBuffer], { type: 'audio/mp4' });
    const audioUrl = createObjectUrl(audioBlob);

    let duration: number | undefined;
    try {
      const { getVideoDuration } = await import('../utils/helpers');
      duration = await getVideoDuration(audioUrl);
    } catch {
      duration = undefined;
    }

    const usage: UsageInput = {
      provider: 'sonilo',
      model: SONILO_VIDEO_TO_MUSIC_MODEL,
      kind: 'audio',
      units: 1,
      unitLabel: 'clip',
      note: 'Sonilo video-to-music track',
    };
    if (deps.recordUsage) {
      deps.recordUsage(usage);
    } else {
      const mod = await import('../utils/usageTracker');
      mod.recordUsage(usage);
    }

    const nameBase = sanitizeNameSegment(title || input.videoName) || `track_${now()}`;
    return {
      id: `sonilo-${now()}`,
      name: `sonilo_${nameBase}.m4a`,
      type: 'audio',
      url: audioUrl,
      source: 'generated',
      generatedBy: 'Sonilo Video-to-Music',
      prompt: input.prompt?.trim() || undefined,
      duration,
    };
  };

  return { generateMusicFromVideo };
};

export const generateMusicFromVideoWithSonilo = (input: SoniloVideoToMusicInput) =>
  createSoniloVideoToMusicClient().generateMusicFromVideo(input);
