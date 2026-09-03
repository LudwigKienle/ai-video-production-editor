import { MediaItem } from '../types';
import { recordUsage } from '../utils/usageTracker';
import { trackTask } from './taskCenter';

/**
 * Runway Dev API client for the "Ruby" colour-science model (SDR -> HDR).
 * Ruby is only offered through Runway's own API, not through fal.ai.
 *
 * Docs: https://docs.dev.runwayml.com (video_to_hdr + tasks endpoints)
 */

export const RUNWAY_API_BASE_URL = 'https://api.dev.runwayml.com/v1';
export const RUNWAY_API_VERSION = '2024-11-06';
export const RUNWAY_API_KEY_STORAGE_KEY = 'runway_api_key';
export const RUNWAY_RUBY_MODEL = 'ruby';

export type RunwayRubyOutputFormat =
  | 'hdr10'
  | 'hlg'
  | 'hdr_prores'
  | 'hdr_exr_sequence'
  | 'hdr_exr_acescg_sequence_1_3';

export type RunwayRubyProresProfile = '422' | '422 HQ' | '4444';

export const RUNWAY_RUBY_OUTPUT_FORMATS: Array<{ id: RunwayRubyOutputFormat; label: string; hint: string; extension: string }> = [
  { id: 'hdr10', label: 'HDR10 (HEVC 10-bit)', hint: 'Ready for delivery and review players.', extension: 'mp4' },
  { id: 'hlg', label: 'HLG (HEVC 10-bit)', hint: 'Broadcast-style hybrid log-gamma.', extension: 'mp4' },
  { id: 'hdr_prores', label: 'ProRes HDR (BT.2020 PQ)', hint: 'Editorial mezzanine .mov.', extension: 'mov' },
  { id: 'hdr_exr_sequence', label: 'EXR sequence (linear BT.2020)', hint: 'Half-float frames for compositing.', extension: 'zip' },
  { id: 'hdr_exr_acescg_sequence_1_3', label: 'EXR sequence (ACEScg 1.3)', hint: 'ACES-ready frames for grading.', extension: 'zip' },
];

export const getRunwayApiKeyOptional = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(RUNWAY_API_KEY_STORAGE_KEY);
};

export const hasRunwayApiKey = () => Boolean(getRunwayApiKeyOptional());

const isElectronRuntime = () =>
  typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes(' electron/');

const proxyUrl = (url: string) => (isElectronRuntime() ? url : `https://corsproxy.io/?${encodeURIComponent(url)}`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RunwayTask = {
  id: string;
  status: 'PENDING' | 'THROTTLED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  output?: string[];
  failure?: string;
  failureCode?: string;
  progress?: number;
};

const readError = async (response: Response) => {
  const text = await response.text().catch(() => '');
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const parsed = JSON.parse(text);
    return parsed?.error || parsed?.message || text;
  } catch {
    return text;
  }
};

const runwayFetch = async (path: string, init: RequestInit) => {
  const apiKey = getRunwayApiKeyOptional();
  if (!apiKey) {
    throw new Error('Runway API key missing. Add it in Settings to use Runway Ruby.');
  }
  const response = await fetch(proxyUrl(`${RUNWAY_API_BASE_URL}${path}`), {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-Runway-Version': RUNWAY_API_VERSION,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Runway API error: ${await readError(response)}`);
  }
  return response.json();
};

export const toRunwayVideoUri = (video: { base64: string; mimeType: string }) => {
  if (video.base64.startsWith('data:')) return video.base64;
  return `data:${video.mimeType || 'video/mp4'};base64,${video.base64}`;
};

export type RunwayRubyInput = {
  videoUri: string;
  outputFormat?: RunwayRubyOutputFormat;
  proresProfile?: RunwayRubyProresProfile;
  sourceName?: string;
  onStatus?: (message: string) => void;
  pollIntervalMs?: number;
  maxChecks?: number;
};

export const submitRunwayRubyJob = async (input: RunwayRubyInput): Promise<string> => {
  const videoUri = input.videoUri.trim();
  if (!videoUri) {
    throw new Error('Runway Ruby requires an input video.');
  }
  if (!videoUri.startsWith('data:') && !/^https:\/\//i.test(videoUri)) {
    throw new Error('Runway Ruby requires an HTTPS video URL or base64 data URI.');
  }
  const body: Record<string, unknown> = {
    model: RUNWAY_RUBY_MODEL,
    videoUri,
    outputFormat: input.outputFormat || 'hdr10',
  };
  if ((input.outputFormat || 'hdr10') === 'hdr_prores') {
    body.proresProfile = input.proresProfile || '422 HQ';
  }
  const task = await runwayFetch('/video_to_hdr', { method: 'POST', body: JSON.stringify(body) });
  if (!task?.id) {
    throw new Error('Runway did not return a task id.');
  }
  return String(task.id);
};

export const getRunwayTask = async (taskId: string): Promise<RunwayTask> =>
  runwayFetch(`/tasks/${encodeURIComponent(taskId)}`, { method: 'GET' });

export const waitForRunwayTask = async (
  taskId: string,
  opts?: { pollIntervalMs?: number; maxChecks?: number; onStatus?: (message: string) => void },
): Promise<RunwayTask> => {
  const interval = opts?.pollIntervalMs ?? 5000;
  const maxChecks = opts?.maxChecks ?? 240;
  for (let attempt = 0; attempt < maxChecks; attempt += 1) {
    const task = await getRunwayTask(taskId);
    if (task.status === 'SUCCEEDED') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELLED') {
      throw new Error(`Runway Ruby ${task.status.toLowerCase()}: ${task.failure || task.failureCode || 'no details'}`);
    }
    const progress = typeof task.progress === 'number' ? ` ${Math.round(task.progress * 100)}%` : '';
    opts?.onStatus?.(`Runway Ruby ${task.status.toLowerCase()}${progress}…`);
    await sleep(interval);
  }
  throw new Error('Runway Ruby timed out while waiting for the HDR conversion.');
};

const convertVideoToHdrWithRunwayRubyInner = async (input: RunwayRubyInput): Promise<MediaItem> => {
  input.onStatus?.('Submitting to Runway Ruby…');
  const taskId = await submitRunwayRubyJob(input);
  const task = await waitForRunwayTask(taskId, {
    pollIntervalMs: input.pollIntervalMs,
    maxChecks: input.maxChecks,
    onStatus: input.onStatus,
  });
  const outputUrl = Array.isArray(task.output) ? task.output.find((value) => typeof value === 'string') : undefined;
  if (!outputUrl) {
    throw new Error('Runway Ruby finished without an output file.');
  }
  const format = RUNWAY_RUBY_OUTPUT_FORMATS.find((entry) => entry.id === (input.outputFormat || 'hdr10'));
  const baseName = (input.sourceName || 'video').replace(/\.[a-z0-9]+$/i, '');
  recordUsage({
    provider: 'runway',
    model: RUNWAY_RUBY_MODEL,
    kind: 'edit',
    units: 1,
    unitLabel: 'clip',
    note: `Runway Ruby ${format?.label || 'HDR'}`,
  });
  return {
    id: `runway-ruby-${Date.now()}`,
    name: `${baseName}_ruby_hdr.${format?.extension || 'mp4'}`,
    type: 'video',
    url: outputUrl,
    source: 'generated',
    generatedBy: `Runway Ruby (${format?.label || 'HDR'})`,
  };
};

export const convertVideoToHdrWithRunwayRuby = (input: RunwayRubyInput): Promise<MediaItem> =>
  trackTask({ label: 'Runway Ruby HDR', kind: 'video', provider: 'runway', estimatedMs: 180_000, message: 'Submitting…' }, (task) =>
    convertVideoToHdrWithRunwayRubyInner({
      ...input,
      onStatus: (message) => {
        task.update({ message });
        input.onStatus?.(message);
      },
    }));
