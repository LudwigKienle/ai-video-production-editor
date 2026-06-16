import { MediaItem } from '../types';
import { getVideoDuration } from '../utils/helpers';
import { recordUsage } from '../utils/usageTracker';

const SONAUTO_API_BASE = 'https://api.sonauto.ai/v1';
const DEFAULT_MODEL_VERSION = 'v3-preview';
const DEFAULT_OUTPUT_FORMAT = 'mp3';
const DEFAULT_POLL_INTERVAL_MS = 4000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

type SonautoGenerationResponse = {
  task_id?: string;
};

type SonautoGenerationStatus = {
  id?: string;
  status?: string;
  model_version?: string;
  song_paths?: string[];
  error_message?: string | null;
};

export type SonautoGenerateMusicOptions = {
  instrumental?: boolean;
  promptStrength?: number;
  alignLyrics?: boolean;
  outputFormat?: 'mp3' | 'flac' | 'wav' | 'ogg' | 'm4a';
  lyrics?: string;
  tags?: string[];
  onStatus?: (message: string) => void;
};

const getSonautoKeyOptional = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('sonauto_api_key');
};

export const hasSonautoApiKey = () => Boolean(getSonautoKeyOptional());

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const prettifyStatus = (status?: string | null) => {
  if (!status) return 'Preparing Sonauto request...';
  return `Sonauto: ${status.toLowerCase().replace(/_/g, ' ')}`;
};

const sanitizePromptSlug = (prompt: string) => {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return slug || 'track';
};

const readErrorMessage = async (response: Response) => {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null);
    if (payload && typeof payload === 'object') {
      const detail = payload.error || payload.message || payload.detail || payload.error_message;
      if (typeof detail === 'string' && detail.trim()) return detail.trim();
      try {
        return JSON.stringify(payload);
      } catch {
        return response.statusText;
      }
    }
  }
  const text = await response.text().catch(() => '');
  return text || response.statusText;
};

const startGeneration = async (
  prompt: string,
  opts: SonautoGenerateMusicOptions,
): Promise<string> => {
  const key = getSonautoKeyOptional();
  if (!key) {
    throw new Error('Sonauto API Key is missing. Please add it in settings.');
  }

  const tags = (opts.tags || []).map((tag) => tag.trim()).filter(Boolean);
  const lyrics = opts.lyrics?.trim();
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt && tags.length === 0 && !lyrics) {
    throw new Error('Sonauto needs at least a prompt, tags, or lyrics.');
  }

  const response = await fetch(`${SONAUTO_API_BASE}/generations/v3`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: trimmedPrompt || '',
      tags: tags.length ? tags : undefined,
      lyrics: lyrics || undefined,
      instrumental: opts.instrumental ?? true,
      prompt_strength: opts.promptStrength ?? 2.0,
      output_format: opts.outputFormat || DEFAULT_OUTPUT_FORMAT,
      align_lyrics: opts.alignLyrics ?? false,
    }),
  });

  if (!response.ok) {
    const detail = await readErrorMessage(response);
    throw new Error(`Sonauto API Error (${response.status}): ${detail}`);
  }

  const payload = (await response.json().catch(() => ({}))) as SonautoGenerationResponse;
  if (!payload.task_id) {
    throw new Error('Sonauto did not return a task id.');
  }

  return payload.task_id;
};

const fetchGenerationStatus = async (taskId: string): Promise<SonautoGenerationStatus> => {
  const key = getSonautoKeyOptional();
  if (!key) {
    throw new Error('Sonauto API Key is missing. Please add it in settings.');
  }

  const response = await fetch(`${SONAUTO_API_BASE}/generations/${taskId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });

  if (!response.ok) {
    const detail = await readErrorMessage(response);
    throw new Error(`Sonauto Status Error (${response.status}): ${detail}`);
  }

  return (await response.json().catch(() => ({}))) as SonautoGenerationStatus;
};

const downloadSongUrl = async (songUrl: string) => {
  const response = await fetch(songUrl);
  if (!response.ok) {
    throw new Error(`Sonauto download failed (${response.status}).`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};

export const generateMusicWithSonauto = async (
  prompt: string,
  opts: SonautoGenerateMusicOptions = {},
): Promise<MediaItem> => {
  const taskId = await startGeneration(prompt, opts);
  const startedAt = Date.now();
  let lastStatus = '';
  let finalStatus: SonautoGenerationStatus | null = null;

  while (Date.now() - startedAt < DEFAULT_TIMEOUT_MS) {
    const statusPayload = await fetchGenerationStatus(taskId);
    const status = statusPayload.status || '';

    if (status && status !== lastStatus) {
      lastStatus = status;
      opts.onStatus?.(prettifyStatus(status));
    }

    if (status === 'SUCCESS') {
      finalStatus = statusPayload;
      break;
    }

    if (status === 'FAILURE') {
      throw new Error(statusPayload.error_message || 'Sonauto generation failed.');
    }

    await wait(DEFAULT_POLL_INTERVAL_MS);
  }

  if (!finalStatus) {
    throw new Error('Sonauto generation timed out. Please try again.');
  }

  const rawSongUrl = finalStatus.song_paths?.[0];
  if (!rawSongUrl) {
    throw new Error('Sonauto finished without returning an audio URL.');
  }

  const outputFormat = opts.outputFormat || DEFAULT_OUTPUT_FORMAT;
  let audioUrl = rawSongUrl;
  try {
    audioUrl = await downloadSongUrl(rawSongUrl);
  } catch {
    audioUrl = rawSongUrl;
  }

  let duration: number | undefined;
  try {
    duration = await getVideoDuration(audioUrl);
  } catch {
    duration = undefined;
  }

  const model = finalStatus.model_version || DEFAULT_MODEL_VERSION;
  recordUsage({
    provider: 'sonauto',
    model,
    kind: 'audio',
    units: 1,
    unitLabel: 'clip',
    note: (opts.instrumental ?? true) ? 'Sonauto instrumental track' : 'Sonauto song',
  });

  return {
    id: `sonauto-${taskId}`,
    name: `sonauto_${sanitizePromptSlug(prompt)}.${outputFormat}`,
    type: 'audio',
    url: audioUrl,
    sourceUrl: rawSongUrl,
    originUrl: rawSongUrl,
    source: 'generated',
    generatedBy: 'Sonauto v3',
    prompt,
    duration,
  };
};
