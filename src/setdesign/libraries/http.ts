/**
 * Network access of the 3D library providers.
 *
 * In the desktop app the main process can do the requests (electron/library-download.js:
 * own User-Agent, streaming to disk). Without it the renderer's fetch is used; Electron's
 * default User-Agent already names the app ("ai-video-production-editor/x.y"), which is what
 * Poly Haven's API terms ask for. Tests replace everything with overrideLibraryHttp().
 */
import type { LibraryFetchInit, LibraryHttp } from './types.ts';

/** User-Agent the main process sends (Poly Haven ToS 2.4: name the software). */
export const LIBRARY_USER_AGENT = 'AI-Video-Production-Editor (Set Design 3D libraries)';

type Library3dBridge = {
  fetchJson?: (payload: { url: string; headers?: Record<string, string> }) => Promise<{ ok: boolean; status?: number; data?: unknown; error?: string }>;
  fetchBytes?: (payload: { url: string; headers?: Record<string, string> }) => Promise<{ ok: boolean; status?: number; data?: Uint8Array; error?: string }>;
  download?: (payload: { url: string; folderPath: string; relativePath: string; headers?: Record<string, string>; maxBytes?: number }) => Promise<{ ok: boolean; path?: string; size?: number; error?: string }>;
  cacheDir?: () => Promise<{ ok: boolean; path?: string }>;
};

export const getLibraryBridge = (): Library3dBridge | null => {
  const w = (globalThis as { window?: { electron?: { library3d?: Library3dBridge } } }).window;
  return w?.electron?.library3d || null;
};

const describe = (url: string) => {
  try { return new URL(url).host; } catch { return url; }
};

const fetchOk = async (url: string, init?: LibraryFetchInit) => {
  const response = await fetch(url, { method: init?.method || 'GET', headers: init?.headers });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).slice(0, 200); } catch { /* ignore */ }
    throw new Error(`${describe(url)} answered ${response.status}${response.statusText ? ` ${response.statusText}` : ''}${detail ? `: ${detail}` : ''}`);
  }
  return response;
};

const defaultHttp: LibraryHttp = {
  async json<T>(url: string, init?: LibraryFetchInit) {
    const bridge = getLibraryBridge();
    if (bridge?.fetchJson && (!init?.method || init.method === 'GET')) {
      const reply = await bridge.fetchJson({ url, headers: init?.headers });
      if (!reply.ok) throw new Error(reply.error || `${describe(url)} answered ${reply.status}`);
      return reply.data as T;
    }
    return (await (await fetchOk(url, init)).json()) as T;
  },
  async bytes(url: string, init?: LibraryFetchInit) {
    const bridge = getLibraryBridge();
    if (bridge?.fetchBytes) {
      const reply = await bridge.fetchBytes({ url, headers: init?.headers });
      if (!reply.ok || !reply.data) throw new Error(reply.error || `${describe(url)} answered ${reply.status}`);
      return reply.data instanceof Uint8Array ? reply.data : new Uint8Array(reply.data as ArrayBufferLike);
    }
    return new Uint8Array(await (await fetchOk(url, init)).arrayBuffer());
  },
};

let current: LibraryHttp = defaultHttp;

export const libraryHttp = (): LibraryHttp => current;

/** Tests only: replace network access (null restores the default). */
export const overrideLibraryHttp = (next: LibraryHttp | null) => {
  current = next || defaultHttp;
  cache.clear();
};

/** Small in-memory cache for list endpoints that rarely change (Poly Haven /assets). */
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
export const cachedJson = <T>(url: string, ttlMs = 30 * 60 * 1000, init?: LibraryFetchInit): Promise<T> => {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = current.json<T>(url, init).catch((error) => { cache.delete(url); throw error; });
  cache.set(url, { at: Date.now(), value });
  return value;
};
export const clearLibraryCache = () => cache.clear();
