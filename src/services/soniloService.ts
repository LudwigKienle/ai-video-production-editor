import type { MediaItem, UsageEntry } from '../types';

export const SONILO_API_BASE_URL = 'https://api.sonilo.com';
export const SONILO_VIDEO_TO_MUSIC_PATH = '/v1/video-to-music';
export const SONILO_VIDEO_TO_MUSIC_MODEL = 'video-to-music';
export const SONILO_VIDEO_TO_SFX_PATH = '/v1/video-to-sfx';
export const SONILO_TASKS_PATH = '/v1/tasks';
export const SONILO_VIDEO_TO_SFX_MODEL = 'video-to-sfx';
export const SONILO_API_KEY_STORAGE_KEY = 'sonilo_api_key';
export const SONILO_API_KEYS_URL = 'https://platform.sonilo.com/dashboard/api-keys';

// The backend rejects videos longer than 6 minutes; surfaced here so UI copy
// can reference the same limit.
export const SONILO_MAX_VIDEO_DURATION_SECONDS = 360;

// The SFX endpoint accepts shorter videos than the music endpoint.
export const SONILO_SFX_MAX_VIDEO_DURATION_SECONDS = 180;

// Task polling cadence for the async SFX pipeline. The backend keeps working
// after a local timeout, so the timeout message carries the task id.
export const SONILO_TASK_POLL_INTERVAL_MS = 5_000;
export const SONILO_TASK_POLL_TIMEOUT_MS = 10 * 60 * 1_000;

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

export type SoniloVideoToSfxInput = {
  /** HTTPS URL, blob: URL, or data: URI of the rendered video. */
  videoUrl: string;
  /** Original video name, used to label the generated audio. */
  videoName?: string;
  /** Optional description of the desired sound effects. */
  prompt?: string;
  onStatus?: (message: string) => void;
};

type SoniloSfxClientDeps = SoniloClientDeps & {
  /** Milliseconds between task status polls. */
  pollIntervalMs?: number;
  /** Overall budget for waiting on the task before giving up locally. */
  pollTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Best-effort probe of the input video's duration in seconds, used to
   * fail fast before uploading a video the backend will reject. Errors from
   * the probe are ignored and the backend makes the final call.
   */
  getDurationSeconds?: (videoUrl: string) => Promise<number>;
};

type SoniloTaskArtifact = {
  url?: string;
  content_type?: string;
  file_size?: number;
};

type SoniloTaskBody = {
  status?: string;
  audio?: SoniloTaskArtifact;
  video?: SoniloTaskArtifact;
  error?: { code?: string; message?: string } | string;
  refunded?: boolean;
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

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Build the multipart body shared by the Sonilo video endpoints: remote
 * HTTPS videos are passed by URL so the backend fetches them directly,
 * while blob:/data: sources only exist locally and are uploaded as bytes.
 */
const buildVideoFormData = async (
  fetchImpl: FetchLike,
  input: { videoUrl: string; videoName?: string; prompt?: string },
): Promise<FormData> => {
  const videoUrl = input.videoUrl.trim();
  if (!videoUrl) {
    throw new Error('Sonilo needs a video input.');
  }
  const form = new FormData();
  if (/^https?:\/\//i.test(videoUrl)) {
    form.append('video_url', videoUrl);
  } else {
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

  const generateMusicFromVideo = async (input: SoniloVideoToMusicInput): Promise<MediaItem> => {
    const key = resolveApiKey();
    if (!key) {
      throw new Error('Sonilo API key is missing. Add it in Settings.');
    }

    const form = await buildVideoFormData(fetchImpl, input);
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

// content_type -> file extension for SFX audio artifacts. The backend sets
// content_type from the requested audio format; the default is AAC (.m4a).
const SFX_AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/wav': '.wav',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/flac': '.flac',
};

const sfxExtensionFromContentType = (contentType?: string) => {
  if (typeof contentType !== 'string') return '.m4a';
  return SFX_AUDIO_EXTENSIONS[contentType.toLowerCase().split(';')[0].trim()] || '.m4a';
};

const defaultGetDurationSeconds = async (videoUrl: string) => {
  const { getVideoDuration } = await import('../utils/helpers');
  return getVideoDuration(videoUrl);
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Client for the Sonilo SFX task pipeline. Unlike the streaming music
 * endpoint, `/v1/video-to-sfx` is asynchronous: the POST returns a task id,
 * `/v1/tasks/{task_id}` is polled until the task is terminal, and the audio
 * artifact is then downloaded from a presigned URL. Presigned result URLs
 * carry their own auth, so the API key is only ever sent to the Sonilo API
 * host, never to the storage domain.
 */
export const createSoniloVideoToSfxClient = (deps: SoniloSfxClientDeps = {}) => {
  const baseUrl = normalizeBaseUrl(deps.baseUrl || SONILO_API_BASE_URL);
  const fetchImpl = deps.fetchImpl || getDefaultFetch();
  const now = deps.now || (() => Date.now());
  const createObjectUrl = deps.createObjectUrl || ((blob: Blob) => URL.createObjectURL(blob));
  const pollIntervalMs = deps.pollIntervalMs ?? SONILO_TASK_POLL_INTERVAL_MS;
  const pollTimeoutMs = deps.pollTimeoutMs ?? SONILO_TASK_POLL_TIMEOUT_MS;
  const sleep = deps.sleep || defaultSleep;
  const getDurationSeconds = deps.getDurationSeconds || defaultGetDurationSeconds;

  const resolveApiKey = () => {
    if (deps.apiKey !== undefined) return deps.apiKey?.trim() || null;
    return getSoniloApiKeyOptional()?.trim() || null;
  };

  // Best-effort pre-check so an over-length video fails before the upload.
  // If the duration cannot be read locally, the backend makes the final call.
  const checkVideoDuration = async (videoUrl: string) => {
    let duration: number;
    try {
      duration = await getDurationSeconds(videoUrl);
    } catch {
      return;
    }
    if (Number.isFinite(duration) && duration > SONILO_SFX_MAX_VIDEO_DURATION_SECONDS) {
      throw new Error(
        `Sonilo SFX supports videos up to ${SONILO_SFX_MAX_VIDEO_DURATION_SECONDS} seconds (3 minutes); this video is ${Math.round(duration)}s.`,
      );
    }
  };

  const submitTask = async (form: FormData, key: string): Promise<string> => {
    const response = await fetchImpl(`${baseUrl}${SONILO_VIDEO_TO_SFX_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
      },
      body: form,
    });
    if (!response.ok) {
      throw buildHttpError(response.status, await readErrorDetail(response));
    }
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const taskId = payload && typeof payload === 'object' ? (payload as { task_id?: unknown }).task_id : undefined;
    if (!taskId || (typeof taskId !== 'string' && typeof taskId !== 'number')) {
      throw new Error('Sonilo accepted the request but returned no task id.');
    }
    return String(taskId);
  };

  const pollTask = async (taskId: string, key: string): Promise<SoniloTaskBody> => {
    const deadline = now() + pollTimeoutMs;
    for (;;) {
      const response = await fetchImpl(`${baseUrl}${SONILO_TASKS_PATH}/${encodeURIComponent(taskId)}`, {
        headers: {
          Authorization: `Bearer ${key}`,
        },
      });
      if (response.status === 404) {
        // Task status is available for SFX tasks only; a 404 means the id
        // is wrong (or belongs to a music generation) and retrying the same
        // id can never help.
        throw new Error(`Sonilo task ${taskId} was not found. Check that the id belongs to an SFX generation.`);
      }
      if (!response.ok) {
        // The task was already accepted; the id stays valid, so surface it
        // for recovery once the underlying issue is resolved.
        const base = buildHttpError(response.status, await readErrorDetail(response));
        throw new Error(`${base.message} Sonilo task ${taskId} was already submitted and may still finish on the backend.`);
      }
      let body: SoniloTaskBody | null = null;
      try {
        body = (await response.json()) as SoniloTaskBody;
      } catch {
        body = null;
      }
      if (!body || typeof body !== 'object') {
        throw new Error(`Sonilo returned an unexpected task status response for task ${taskId}.`);
      }
      if (body.status === 'succeeded' || body.status === 'failed') {
        return body;
      }
      if (now() >= deadline) {
        throw new Error(
          `Sonilo timed out waiting for SFX task ${taskId}. The generation may still complete on the backend; run the node again in a little while.`,
        );
      }
      await sleep(pollIntervalMs);
    }
  };

  const downloadAudioArtifact = async (taskId: string, audio: SoniloTaskArtifact) => {
    // Presigned URL: intentionally no Authorization header — the API key
    // must never be sent to the storage domain.
    const response = await fetchImpl(audio.url as string);
    if (!response.ok) {
      throw new Error(
        `Could not download the generated audio (${response.status}). The result for Sonilo task ${taskId} is still stored on the backend.`,
      );
    }
    const blob = await response.blob();
    const contentType = typeof audio.content_type === 'string' && audio.content_type
      ? audio.content_type
      : blob.type || 'audio/mp4';
    return { blob: new Blob([blob], { type: contentType }), extension: sfxExtensionFromContentType(contentType) };
  };

  const generateSfxFromVideo = async (input: SoniloVideoToSfxInput): Promise<MediaItem> => {
    const key = resolveApiKey();
    if (!key) {
      throw new Error('Sonilo API key is missing. Add it in Settings.');
    }

    await checkVideoDuration(input.videoUrl.trim());

    const form = await buildVideoFormData(fetchImpl, input);
    input.onStatus?.('Sonilo: creating sound effects from the video...');
    const taskId = await submitTask(form, key);

    input.onStatus?.('Sonilo: sound effects in progress...');
    const body = await pollTask(taskId, key);

    if (body.status === 'failed') {
      const err = body.error;
      const code = (typeof err === 'object' && err?.code) || 'GENERATION_FAILED';
      const message = (typeof err === 'object' ? err?.message : typeof err === 'string' ? err : undefined) || 'Generation failed';
      const refundNote = body.refunded === true ? ' The charge was reversed.' : '';
      throw new Error(`Sonilo SFX generation failed (${code}): ${message}.${refundNote}`);
    }

    const audio = body.audio;
    if (!audio || typeof audio !== 'object' || !audio.url) {
      throw new Error(`Sonilo task ${taskId} succeeded but returned no audio artifact.`);
    }

    input.onStatus?.('Sonilo: downloading audio...');
    const { blob: audioBlob, extension } = await downloadAudioArtifact(taskId, audio);
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
      model: SONILO_VIDEO_TO_SFX_MODEL,
      kind: 'audio',
      units: 1,
      unitLabel: 'clip',
      note: 'Sonilo video-to-sfx audio',
    };
    if (deps.recordUsage) {
      deps.recordUsage(usage);
    } else {
      const mod = await import('../utils/usageTracker');
      mod.recordUsage(usage);
    }

    const nameBase = sanitizeNameSegment(input.videoName) || `task_${taskId.slice(0, 8)}`;
    return {
      id: `sonilo-sfx-${now()}`,
      name: `sonilo_sfx_${nameBase}${extension}`,
      type: 'audio',
      url: audioUrl,
      source: 'generated',
      generatedBy: 'Sonilo Video-to-SFX',
      prompt: input.prompt?.trim() || undefined,
      duration,
    };
  };

  return { generateSfxFromVideo };
};

export const generateSfxFromVideoWithSonilo = (input: SoniloVideoToSfxInput) =>
  createSoniloVideoToSfxClient().generateSfxFromVideo(input);
