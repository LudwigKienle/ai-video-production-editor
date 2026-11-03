/**
 * Sketchfab (https://sketchfab.com): downloadable models under Creative Commons and Sketchfab licences.
 * Search and details work without a token; downloads need the user's API token
 * (https://sketchfab.com/settings/password → "API Token"), stored as localStorage "sketchfab_token".
 * API v3 checked 2026-11 (https://docs.sketchfab.com/data-api/v3/index.html):
 *   GET /v3/search?type=models&downloadable=true&q=&count=&cursor=&license=&sort_by=
 *   GET /v3/models/{uid}            licence {slug,label,url}, archives {glb:{size,faceCount}}
 *   GET /v3/models/{uid}/download   Authorization: Token <token> → { glb: { url, size, expires } } (URL expires!)
 */
import { sketchfabLicense } from '../licenses.ts';
import { SKETCHFAB_TOKEN_STORAGE_KEY } from '../../../services/sketchfabService.ts';
import type { LibraryAsset, LibraryProvider } from '../types.ts';

const API = 'https://api.sketchfab.com/v3';

type SfModel = {
  uid: string;
  name: string;
  description?: string;
  viewerUrl?: string;
  isDownloadable?: boolean;
  faceCount?: number;
  tags?: Array<{ name?: string } | string>;
  thumbnails?: { images?: Array<{ url: string; width: number; height: number }> };
  user?: { username?: string; displayName?: string; profileUrl?: string };
  license?: { slug?: string; label?: string; url?: string } | null;
  archives?: Record<string, { size?: number; faceCount?: number; textureMaxResolution?: number } | null>;
};

const thumb = (model: SfModel) => {
  const images = [...(model.thumbnails?.images || [])].sort((a, b) => a.width - b.width);
  return (images.find((img) => img.width >= 240) || images[images.length - 1])?.url;
};

const toAsset = (model: SfModel, hasToken: boolean): LibraryAsset => {
  const license = sketchfabLicense(model.license?.slug || model.license?.label, model.license?.url);
  const formats = Object.entries(model.archives || {}).filter(([key, value]) => value && key !== 'source').map(([key]) => key);
  return {
    provider: 'sketchfab',
    id: model.uid,
    name: model.name,
    type: 'model',
    thumbnailUrl: thumb(model),
    author: model.user?.displayName || model.user?.username,
    license,
    url: model.viewerUrl || `https://sketchfab.com/3d-models/${model.uid}`,
    formats: formats.length ? formats : ['glb'],
    downloadable: !!model.isDownloadable && hasToken,
    ...(typeof model.faceCount === 'number' ? { polycount: model.faceCount } : {}),
    tags: (model.tags || []).map((tag) => (typeof tag === 'string' ? tag : tag.name || '')).filter(Boolean),
    description: model.description ? model.description.slice(0, 400) : undefined,
  };
};

const authHeaders = (key: string): Record<string, string> => (key ? { Authorization: `Token ${key}` } : {});

export const sketchfabProvider: LibraryProvider = {
  id: 'sketchfab',
  label: 'Sketchfab',
  types: ['model'],
  description: 'Large catalogue of user models (GLB). Only downloadable models are listed; the licence differs per model (CC BY, CC BY-NC, CC0 …) and is shown and stored with every import. Search works without a token, downloads need your Sketchfab API token.',
  homepage: 'https://sketchfab.com',
  licenseSummary: 'Per model: Creative Commons (often CC BY: credit the author; NC = no commercial use) or Sketchfab Standard/Editorial.',
  requiresKey: true,
  keyOnlyForDownload: true,
  keyLabel: 'Sketchfab API token',
  keyPlaceholder: 'API token (Settings › Password & API)',
  keyUrl: 'https://sketchfab.com/settings/password',
  keyStorage: SKETCHFAB_TOKEN_STORAGE_KEY,
  cost: 'free',
  credit: 'Sketchfab',
  configured: (key) => !!key.trim(),

  async search(query, ctx) {
    if (query.type !== 'model') return { assets: [], total: 0, hasMore: false };
    const limit = Math.min(24, Math.max(1, query.limit || 24));
    const page = Math.max(1, query.page || 1);
    const params = new URLSearchParams({ type: 'models', downloadable: 'true', count: String(limit), sort_by: '-likeCount' });
    if (query.query.trim()) params.set('q', query.query.trim());
    if (page > 1) params.set('cursor', String((page - 1) * limit));
    const license = query.filters?.license;
    if (typeof license === 'string' && license) params.set('license', license);
    const maxFaces = Number(query.filters?.maxFaceCount);
    if (Number.isFinite(maxFaces) && maxFaces > 0) params.set('max_face_count', String(Math.round(maxFaces)));
    const data = await ctx.http.json<{ results?: SfModel[]; next?: string | null }>(`${API}/search?${params}`, { headers: authHeaders(ctx.key) });
    const assets = (data.results || []).filter((m) => m.isDownloadable !== false).map((m) => toAsset(m, !!ctx.key));
    return { assets, hasMore: !!data.next };
  },

  async details(id, ctx) {
    const model = await ctx.http.json<SfModel>(`${API}/models/${encodeURIComponent(id)}`, { headers: authHeaders(ctx.key) });
    return toAsset(model, !!ctx.key);
  },

  async resolveDownload(id, _options, ctx) {
    if (!ctx.key) throw new Error('Sketchfab downloads need your API token: Settings › 3D libraries › Sketchfab (get it at https://sketchfab.com/settings/password).');
    const model = await ctx.http.json<SfModel>(`${API}/models/${encodeURIComponent(id)}`, { headers: authHeaders(ctx.key) });
    if (!model.isDownloadable) throw new Error(`Sketchfab model "${model.name || id}" is not downloadable.`);
    const data = await ctx.http.json<{ glb?: { url?: string; size?: number }; gltf?: { url?: string; size?: number } }>(`${API}/models/${encodeURIComponent(id)}/download`, { headers: authHeaders(ctx.key) });
    if (!data.glb?.url) throw new Error('Sketchfab offers no GLB for this model (only zipped glTF/source), import it manually.');
    const license = sketchfabLicense(model.license?.slug || model.license?.label, model.license?.url);
    const notes = [`Licence ${license.label}: ${license.note || ''}`.trim()];
    if (!license.commercial) notes.push('Not for commercial productions.');
    if ((data.glb.size || 0) > 80 * 1024 * 1024) notes.push(`Large file (${Math.round((data.glb.size || 0) / 1024 / 1024)} MB).`);
    const file = `${id}.glb`;
    return { kind: 'files', files: [{ path: file, url: data.glb.url, size: data.glb.size }], entry: file, format: 'glb', expiring: true, notes };
  },
};
