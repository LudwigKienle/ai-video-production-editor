import { getSupabase } from '../lib/supabase';

export type ByokProvider = 'gemini' | 'replicate' | 'xai' | 'fal' | 'ltx' | 'elevenlabs' | 'worldlabs';

type ProxyUsage = {
  kind: string;
  model?: string;
  units?: number;
};

type ProxyMeta = {
  billable?: boolean;
  note?: string;
};

type ByokProxyRequest = {
  provider: ByokProvider;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  usage?: ProxyUsage;
  meta?: ProxyMeta;
  timeoutMs?: number;
};

type ByokProxyPayload<T = unknown> = {
  ok?: boolean;
  status?: number;
  data?: T;
  text?: string;
  bodyBase64?: string;
  contentType?: string;
  error?: string;
  body?: string;
};

const TEAM_STORAGE_KEYS = ['bw_active_team_id', 'bw_portal_team_id'];
const PROVIDER_KEY_STORAGE: Record<ByokProvider, string> = {
  gemini: 'gemini_api_key',
  replicate: 'replicate_api_key',
  xai: 'xai_api_key',
  fal: 'fal_api_key',
  ltx: 'ltx_api_key',
  elevenlabs: 'elevenlabs_api_key',
  worldlabs: 'worldlabs_api_key',
};

const isElectronRuntime = () => {
  if (typeof navigator === 'undefined') return false;
  return navigator.userAgent.toLowerCase().includes(' electron/');
};

const readStoredTeamId = () => {
  if (typeof window === 'undefined') return null;
  for (const key of TEAM_STORAGE_KEYS) {
    const value = window.localStorage.getItem(key);
    if (value) return value;
  }
  return null;
};

const readStoredProviderKey = (provider: ByokProvider) => {
  if (typeof window === 'undefined') return null;
  const storageKey = PROVIDER_KEY_STORAGE[provider];
  return window.localStorage.getItem(storageKey);
};

const resolveSessionToken = async () => {
  const client = getSupabase();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token || null;
};

const ensureTeamId = (teamId?: string | null) => {
  const resolved = teamId || readStoredTeamId();
  if (!resolved) {
    throw new Error('No active team found for BYOK proxy');
  }
  return resolved;
};

const parseProxyError = (payload: ByokProxyPayload, fallback: string) => {
  return payload?.error || payload?.body || fallback;
};

const base64ToBlobUrl = (value: string, contentType: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: contentType || 'application/octet-stream' });
  return URL.createObjectURL(blob);
};

export const hasLocalProviderKey = (provider: ByokProvider) => Boolean(readStoredProviderKey(provider));

export const shouldUseByokProxy = (provider: ByokProvider) => {
  if (typeof window === 'undefined') return false;
  if (isElectronRuntime()) return false;
  if (hasLocalProviderKey(provider)) return false;
  return Boolean(readStoredTeamId());
};

export const byokProxyRequest = async <T = unknown>(
  request: ByokProxyRequest & { teamId?: string | null },
): Promise<ByokProxyPayload<T>> => {
  const teamId = ensureTeamId(request.teamId);
  const token = await resolveSessionToken();
  if (!token) {
    throw new Error('No active session token for BYOK proxy');
  }

  const response = await fetch('/api/byok/proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      teamId,
      provider: request.provider,
      request: {
        url: request.url,
        method: request.method || 'POST',
        headers: request.headers || {},
        body: request.body,
        timeoutMs: request.timeoutMs,
      },
      usage: request.usage,
      meta: request.meta,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as ByokProxyPayload<T>;
  if (!response.ok) {
    throw new Error(parseProxyError(payload, `BYOK proxy failed with status ${response.status}`));
  }
  return payload;
};

export const byokProxyJson = async <T = unknown>(
  request: ByokProxyRequest & { teamId?: string | null },
): Promise<T> => {
  const payload = await byokProxyRequest<T>(request);
  return (payload.data ?? null) as T;
};

export const byokProxyText = async (
  request: ByokProxyRequest & { teamId?: string | null },
): Promise<string> => {
  const payload = await byokProxyRequest(request);
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.data === 'string') return payload.data;
  return '';
};

export const byokProxyBinaryUrl = async (
  request: ByokProxyRequest & { teamId?: string | null },
): Promise<string> => {
  const payload = await byokProxyRequest(request);
  if (payload.bodyBase64) {
    return base64ToBlobUrl(payload.bodyBase64, payload.contentType || 'application/octet-stream');
  }
  throw new Error('BYOK proxy did not return binary data');
};
