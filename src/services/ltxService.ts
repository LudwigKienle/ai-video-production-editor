import type { MediaItem, UsageEntry } from '../types';

export const LTX_API_BASE_URL = 'https://api.ltx.video/v2';
export const LTX_VIDEO_TO_VIDEO_HDR_ENDPOINT = 'video-to-video-hdr';
export const LTX_VIDEO_TO_VIDEO_HDR_MODEL = 'video-to-video-hdr';
export const LTX_API_KEY_STORAGE_KEY = 'ltx_api_key';

type LtxJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

type LtxSubmitResponse = {
  id: string;
  created_at: string;
};

type LtxJobResponse = {
  id: string;
  status: LtxJobStatus;
  created_at?: string;
  updated_at?: string;
  result?: {
    exr_frames_url?: string;
    exrFramesUrl?: string;
    [key: string]: unknown;
  };
  error?: string;
  message?: string;
};

type LtxRequestOptions = {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  billable?: boolean;
  note?: string;
};

type UsageInput = Omit<UsageEntry, 'id' | 'createdAt'> & Partial<Pick<UsageEntry, 'id' | 'createdAt'>>;

type LtxClientDeps = {
  apiKey?: string | null;
  baseUrl?: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  recordUsage?: (entry: UsageInput) => unknown;
};

type LtxUpscaleInput = {
  videoUri: string;
  sourceName?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const getDefaultFetch = () => {
  if (typeof fetch === 'undefined') {
    throw new Error('Fetch API is not available in this runtime.');
  }
  return fetch.bind(globalThis);
};

export const getLtxApiKeyOptional = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(LTX_API_KEY_STORAGE_KEY);
};

export const hasLtxApiKey = () => Boolean(getLtxApiKeyOptional());

export const toLtxVideoUri = (video: { base64: string; mimeType: string }) => {
  if (video.base64.startsWith('data:')) return video.base64;
  const mimeType = video.mimeType || 'video/mp4';
  return `data:${mimeType};base64,${video.base64}`;
};

const assertSupportedVideoUri = (value: string) => {
  const videoUri = value.trim();
  if (!videoUri) {
    throw new Error('LTX HDR requires an input video.');
  }
  if (videoUri.startsWith('data:')) return videoUri;
  if (/^https:\/\//i.test(videoUri)) return videoUri;
  throw new Error('LTX HDR requires an HTTPS video URL or base64 data URI.');
};

const stringifyErrorValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (!value) return '';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts = [
      typeof record.code === 'string' ? record.code : '',
      typeof record.message === 'string' ? record.message : '',
      typeof record.detail === 'string' ? record.detail : '',
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(': ');
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const parseErrorBody = async (response: Response) => {
  const text = await response.text().catch(() => '');
  if (!text) return response.statusText;
  try {
    const parsed = JSON.parse(text);
    return stringifyErrorValue(parsed?.error || parsed?.message || parsed) || text;
  } catch {
    return text;
  }
};

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

const buildJobStatusPath = (id: string) =>
  `/${LTX_VIDEO_TO_VIDEO_HDR_ENDPOINT}/${encodeURIComponent(id)}`;

const sanitizeNameSegment = (value?: string) => {
  const raw = (value || 'ltx_video').replace(/\.[a-z0-9]+$/i, '');
  return raw
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'ltx_video';
};

const extractExrFramesUrl = (job: LtxJobResponse) => {
  const url = job.result?.exr_frames_url || job.result?.exrFramesUrl;
  if (!url || typeof url !== 'string') {
    throw new Error('LTX HDR job completed without result.exr_frames_url.');
  }
  return url;
};

const buildMediaItem = (opts: {
  url: string;
  sourceName?: string;
  jobId: string;
  createdAt?: string;
  now: () => number;
}): MediaItem => {
  const nameBase = sanitizeNameSegment(opts.sourceName);
  return {
    id: `ltx-aces-hdr-${opts.now()}`,
    name: `${nameBase}_aces_hdr_exr_frames.zip`,
    type: 'video',
    url: opts.url,
    source: 'generated',
    generatedBy: 'LTX Color Science Upscale - ACES HDR EXR',
    prompt: 'SDR to ACES HDR EXR frame sequence via LTX video-to-video HDR',
    analysisNotes: [
      `ACES HDR EXR frame archive from LTX job ${opts.jobId}.`,
      'Output is a ZIP of per-frame EXR images for HDR grading or ACES rendering pipelines.',
      opts.createdAt ? `LTX job created at ${opts.createdAt}.` : '',
    ].filter(Boolean),
  };
};

const defaultRecordUsage = async (entry: UsageInput) => {
  if (typeof window === 'undefined') return null;
  const mod = await import('../utils/usageTracker');
  return mod.recordUsage(entry);
};

export const createLtxVideoToVideoHdrClient = (deps: LtxClientDeps = {}) => {
  const baseUrl = normalizeBaseUrl(deps.baseUrl || LTX_API_BASE_URL);
  const fetchImpl = deps.fetchImpl || getDefaultFetch();
  const sleep = deps.sleep || defaultSleep;
  const now = deps.now || (() => Date.now());

  const resolveApiKey = () => {
    if (deps.apiKey !== undefined) return deps.apiKey?.trim() || null;
    return getLtxApiKeyOptional()?.trim() || null;
  };

  const requestJson = async <T,>({ method, path, body, billable = false, note }: LtxRequestOptions): Promise<T> => {
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const localKey = resolveApiKey();

    if (!localKey) {
      const { byokProxyJson, shouldUseByokProxy } = await import('./byokProxyClient');
      if (shouldUseByokProxy('ltx')) {
        return byokProxyJson<T>({
          provider: 'ltx',
          url,
          method,
          headers: body ? { 'Content-Type': 'application/json' } : {},
          body,
          usage: {
            kind: 'edit',
            model: LTX_VIDEO_TO_VIDEO_HDR_MODEL,
            units: 1,
          },
          meta: {
            billable,
            note: note || 'LTX video-to-video HDR',
          },
          timeoutMs: method === 'POST' ? 120000 : 30000,
        });
      }
      throw new Error('LTX API key is missing. Add it in Settings.');
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${localKey}`,
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await fetchImpl(url, init);
    if (!response.ok) {
      const message = await parseErrorBody(response);
      throw new Error(`LTX request failed (${response.status}): ${message}`);
    }
    return response.json() as Promise<T>;
  };

  const submitVideoToHdr = async (videoUri: string) => {
    const payload = { video_uri: assertSupportedVideoUri(videoUri) };
    const response = await requestJson<LtxSubmitResponse>({
      method: 'POST',
      path: `/${LTX_VIDEO_TO_VIDEO_HDR_ENDPOINT}`,
      body: payload,
      billable: true,
      note: 'LTX ACES HDR video-to-video upscale',
    });
    if (!response.id) {
      throw new Error('LTX HDR submit response did not include a job id.');
    }
    return response;
  };

  const getJobStatus = (id: string) => requestJson<LtxJobResponse>({
    method: 'GET',
    path: buildJobStatusPath(id),
    billable: false,
    note: 'LTX HDR job status',
  });

  const waitForCompletedJob = async (
    id: string,
    opts?: { pollIntervalMs?: number; timeoutMs?: number },
  ) => {
    const pollIntervalMs = Math.max(250, opts?.pollIntervalMs ?? 5000);
    const timeoutMs = Math.max(pollIntervalMs, opts?.timeoutMs ?? 10 * 60 * 1000);
    const startedAt = now();

    while (true) {
      const job = await getJobStatus(id);
      if (job.status === 'completed') return job;
      if (job.status === 'failed') {
        throw new Error(stringifyErrorValue(job.error || job.message) || 'LTX HDR job failed.');
      }
      if (now() - startedAt >= timeoutMs) {
        throw new Error(`LTX HDR job timed out after ${Math.round(timeoutMs / 1000)}s.`);
      }
      await sleep(pollIntervalMs);
    }
  };

  const upscaleVideoToAcesHdr = async (input: LtxUpscaleInput): Promise<MediaItem> => {
    const submit = await submitVideoToHdr(input.videoUri);
    const job = await waitForCompletedJob(submit.id, {
      pollIntervalMs: input.pollIntervalMs,
      timeoutMs: input.timeoutMs,
    });
    const exrFramesUrl = extractExrFramesUrl(job);
    const item = buildMediaItem({
      url: exrFramesUrl,
      sourceName: input.sourceName,
      jobId: submit.id,
      createdAt: submit.created_at,
      now,
    });

    const usage: UsageInput = {
      provider: 'ltx',
      model: LTX_VIDEO_TO_VIDEO_HDR_MODEL,
      kind: 'edit',
      units: 1,
      unitLabel: 'clip',
      note: 'LTX ACES HDR video-to-video upscale',
    };
    if (deps.recordUsage) {
      deps.recordUsage(usage);
    } else {
      await defaultRecordUsage(usage);
    }

    return item;
  };

  return {
    submitVideoToHdr,
    getJobStatus,
    waitForCompletedJob,
    upscaleVideoToAcesHdr,
  };
};

export const upscaleVideoToAcesHdrWithLtx = (input: LtxUpscaleInput) =>
  createLtxVideoToVideoHdrClient().upscaleVideoToAcesHdr(input);
