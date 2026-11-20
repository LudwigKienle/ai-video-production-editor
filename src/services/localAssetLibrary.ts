import type { MediaItem } from '../types';
import { localAssetMediaType, parseLocalAssetLines, type LocalAsset } from '../utils/localAssetSearch';

/**
 * Optional bridge to a local asset library in the "Ludwigs Library" layout:
 *   <root>/_Index/assets.jsonl       one record per asset (path relative to root)
 *   <root>/_Index/thumbs/<id>.jpg    preview frames
 *   <root>/_Index/vision/token       token for the library's AI service
 * The AI service (`assetlib vision serve`, MobileCLIP2) listens on 127.0.0.1:8777
 * and answers /search and /similar with [{ id, score }]. Everything works without
 * it — the search then uses words only.
 */

export const LOCAL_LIBRARY_ROOT_KEY = 'local_asset_library_root_v1';
export const LOCAL_LIBRARY_VISION_URL = 'http://127.0.0.1:8777';

export const getLocalLibraryRoot = (): string | null => {
  try { return localStorage.getItem(LOCAL_LIBRARY_ROOT_KEY); } catch { return null; }
};
export const setLocalLibraryRoot = (root: string | null) => {
  try {
    if (root) localStorage.setItem(LOCAL_LIBRARY_ROOT_KEY, root);
    else localStorage.removeItem(LOCAL_LIBRARY_ROOT_KEY);
  } catch { /* ignore */ }
};

const join = (root: string, ...parts: string[]) => [root.replace(/\/+$/, ''), ...parts.map((p) => p.replace(/^\/+/, ''))].join('/');
const toFileUrl = (absolutePath: string) => `file://${absolutePath.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`;

const readText = async (filePath: string) => {
  const read = window.electron?.project?.readFile;
  if (!read) throw new Error('The local library needs the desktop app (file access).');
  const bytes = await read({ filePath });
  return new TextDecoder('utf-8').decode(bytes);
};

export type LocalLibrary = { root: string; assets: LocalAsset[]; token: string | null; loadedAt: number };

let cache: LocalLibrary | null = null;

export const loadLocalLibrary = async (root: string, opts?: { force?: boolean }): Promise<LocalLibrary> => {
  if (cache && cache.root === root && !opts?.force) return cache;
  const assets = parseLocalAssetLines(await readText(join(root, '_Index', 'assets.jsonl')));
  if (!assets.length) throw new Error(`No assets found in ${join(root, '_Index', 'assets.jsonl')}.`);
  let token: string | null = null;
  try { token = (await readText(join(root, '_Index', 'vision', 'token'))).trim() || null; } catch { token = null; }
  cache = { root, assets, token, loadedAt: Date.now() };
  return cache;
};

export const localAssetFileUrl = (library: LocalLibrary, asset: LocalAsset) => toFileUrl(join(library.root, asset.path));
export const localAssetThumbUrl = (library: LocalLibrary, asset: LocalAsset) => toFileUrl(join(library.root, '_Index', 'thumbs', `${asset.id}.jpg`));

const visionGet = async (library: LocalLibrary, route: string, params: Record<string, string | number>) => {
  if (!library.token) return null;
  const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), t: library.token });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${LOCAL_LIBRARY_VISION_URL}${route}?${query}`, { signal: controller.signal });
    if (!response.ok) return null;
    const payload = (await response.json()) as { results?: Array<{ id: string; score: number }> };
    return Array.isArray(payload.results) ? payload.results : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** True when the library's AI service answers. */
export const pingLocalLibraryVision = async () => {
  try {
    const response = await fetch(`${LOCAL_LIBRARY_VISION_URL}/ping`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
};

/** AI (CLIP) hits for a free-text query; null when the service is off. */
export const searchLocalLibraryVision = (library: LocalLibrary, query: string, n = 60) =>
  visionGet(library, '/search', { scope: 'main', q: query, n });

/** Visually similar assets to one asset; null when the service is off. */
export const similarLocalLibraryAssets = (library: LocalLibrary, assetId: string, n = 40) =>
  visionGet(library, '/similar', { scope: 'main', id: assetId, n });

/** A media item the editor can place, or null for LUTs, fonts, 3D… */
export const localAssetToMediaItem = (library: LocalLibrary, asset: LocalAsset): MediaItem | null => {
  const type = localAssetMediaType(asset);
  if (!type) return null;
  return {
    id: `library-${asset.id}-${Date.now()}`,
    name: asset.path.split('/').pop() || asset.title,
    type,
    url: localAssetFileUrl(library, asset),
    source: 'upload',
    generatedBy: asset.source ? `Library · ${asset.source}` : 'Library',
    prompt: asset.title,
    ...(asset.duration ? { duration: asset.duration } : {}),
  };
};
