/**
 * Poly Haven (https://polyhaven.com): CC0 models (glTF), HDRIs (.hdr/.exr) and PBR textures.
 * No key. API checked 2026-11: https://api.polyhaven.com/api-docs/swagger.json
 *   GET /search?q=&t=models|hdris|textures&limit=   ranked slugs (semantic + keyword)
 *   GET /assets?type=…                              metadata of all assets of a type
 *   GET /info/{id}                                  one asset
 *   GET /files/{id}                                 download tree (resolution → format → url)
 * Terms (https://github.com/Poly-Haven/Public-API/blob/master/ToS.md): requests must carry a
 * User-Agent/Referer naming the software (see http.ts) and the UI must credit Poly Haven.
 */
import { CC0 } from '../licenses.ts';
import { cachedJson } from '../http.ts';
import { pickResolution, resolutionsUpTo, sortResolutions } from '../resolution.ts';
import type { LibraryAsset, LibraryAssetType, LibraryFile, LibraryProvider, ResolvedDownload, TextureMapRole } from '../types.ts';

const API = 'https://api.polyhaven.com';

type PhAsset = {
  name: string;
  type: 0 | 1 | 2;
  categories?: string[];
  tags?: string[];
  authors?: Record<string, string>;
  max_resolution?: [number, number];
  polycount?: number;
  dimensions?: number[];
  description?: string;
  thumbnail_url?: string;
  download_count?: number;
};

type PhFile = { url: string; size?: number; md5?: string; include?: Record<string, PhFile> };
type PhFiles = Record<string, Record<string, Record<string, PhFile>>>;

const TYPE_PARAM: Record<LibraryAssetType, string> = { model: 'models', hdri: 'hdris', texture: 'textures' };
const TYPE_FROM_CODE: LibraryAssetType[] = ['hdri', 'texture', 'model'];

const FORMATS: Record<LibraryAssetType, string[]> = { model: ['gltf'], hdri: ['hdr', 'exr'], texture: ['jpg', 'png', 'exr'] };

const toAsset = (id: string, info: PhAsset, resolutions?: string[]): LibraryAsset => {
  const type = TYPE_FROM_CODE[info.type] || 'model';
  const dims = Array.isArray(info.dimensions) && info.dimensions.length ? info.dimensions.map((mm) => Number((mm / 1000).toFixed(3))) : undefined;
  return {
    provider: 'polyhaven',
    id,
    name: info.name || id,
    type,
    thumbnailUrl: info.thumbnail_url || `https://cdn.polyhaven.com/asset_img/thumbs/${encodeURIComponent(id)}.png?width=256&height=256`,
    author: info.authors ? Object.keys(info.authors).join(', ') : undefined,
    license: CC0,
    url: `https://polyhaven.com/a/${encodeURIComponent(id)}`,
    formats: FORMATS[type],
    downloadable: true,
    ...(typeof info.polycount === 'number' ? { polycount: info.polycount } : {}),
    resolutions: resolutions || resolutionsUpTo(info.max_resolution?.[0]),
    ...(dims ? { dimensionsM: dims } : {}),
    tags: info.tags,
    description: info.description,
  };
};

const basename = (url: string) => decodeURIComponent(url.split('?')[0].split('/').pop() || 'file');

/** Poly Haven map names → material.set roles. "arm" packs AO (R), roughness (G), metalness (B) like three.js expects. */
const MAP_KEYS: Array<[RegExp, TextureMapRole]> = [
  [/^(diffuse|diff|color|col)$/i, 'baseColor'],
  [/^nor_gl$/i, 'normal'],
  [/^(rough|roughness)$/i, 'roughness'],
  [/^(metal|metalness)$/i, 'metalness'],
  [/^ao$/i, 'ao'],
  [/^(displacement|disp|height)$/i, 'displacement'],
  [/^(emission|emissive)$/i, 'emissive'],
];

const assetsOfType = (type: LibraryAssetType) => cachedJson<Record<string, PhAsset>>(`${API}/assets?type=${TYPE_PARAM[type]}`);

export const polyHavenProvider: LibraryProvider = {
  id: 'polyhaven',
  label: 'Poly Haven',
  types: ['model', 'hdri', 'texture'],
  description: 'CC0 models (glTF, real-world scale), HDRIs (.hdr/.exr up to 16k) and PBR textures. No key needed.',
  homepage: 'https://polyhaven.com',
  licenseSummary: 'CC0 (public domain), free for commercial use, no credit required.',
  requiresKey: false,
  cost: 'free',
  credit: 'Powered by Poly Haven',
  configured: () => true,

  async search(query, ctx) {
    const limit = Math.min(100, Math.max(1, query.limit || 24));
    const page = Math.max(1, query.page || 1);
    const all = await assetsOfType(query.type);
    const q = query.query.trim().toLowerCase();
    let ids: string[];
    let total: number;
    if (q) {
      const params = new URLSearchParams({ q, t: TYPE_PARAM[query.type], limit: String(page * limit) });
      try {
        const ranked = await ctx.http.json<{ total?: number; results?: Array<{ slug: string }> }>(`${API}/search?${params}`);
        ids = (ranked.results || []).map((r) => r.slug);
        total = ranked.total ?? ids.length;
      } catch {
        // /search can answer 503 when the query cannot be embedded: plain keyword match instead.
        const words = q.split(/\s+/).filter(Boolean);
        ids = Object.keys(all).filter((id) => {
          const hay = `${id} ${all[id].name} ${(all[id].tags || []).join(' ')} ${(all[id].categories || []).join(' ')}`.toLowerCase();
          return words.every((word) => hay.includes(word));
        });
        total = ids.length;
      }
    } else {
      ids = Object.keys(all).sort((a, b) => (all[b].download_count || 0) - (all[a].download_count || 0));
      total = ids.length;
    }
    const category = typeof query.filters?.category === 'string' ? query.filters.category.toLowerCase() : '';
    const pageIds = ids
      .filter((id) => all[id])
      .filter((id) => !category || (all[id].categories || []).some((c) => c.toLowerCase() === category))
      .slice((page - 1) * limit, page * limit);
    return { assets: pageIds.map((id) => toAsset(id, all[id])), total, hasMore: page * limit < total };
  },

  async details(id, ctx) {
    const info = await ctx.http.json<PhAsset>(`${API}/info/${encodeURIComponent(id)}`);
    if (!info || typeof info !== 'object' || !('name' in info)) throw new Error(`Poly Haven has no asset "${id}".`);
    const files = await ctx.http.json<PhFiles>(`${API}/files/${encodeURIComponent(id)}`).catch(() => null);
    const type = TYPE_FROM_CODE[info.type] || 'model';
    const tree = files ? (type === 'model' ? files.gltf : type === 'hdri' ? files.hdri : files.Diffuse) : undefined;
    return toAsset(id, info, tree ? sortResolutions(Object.keys(tree)) : undefined);
  },

  async resolveDownload(id, options, ctx) {
    const info = await ctx.http.json<PhAsset>(`${API}/info/${encodeURIComponent(id)}`);
    if (!info || typeof info !== 'object' || !('name' in info)) throw new Error(`Poly Haven has no asset "${id}".`);
    const files = await ctx.http.json<PhFiles>(`${API}/files/${encodeURIComponent(id)}`);
    const type = TYPE_FROM_CODE[info.type] || 'model';

    if (type === 'model') {
      const tree = files.gltf;
      if (!tree) throw new Error(`Poly Haven offers no glTF for "${id}".`);
      const resolution = pickResolution(Object.keys(tree), options.resolution, '1k')!;
      const gltf = tree[resolution]?.gltf;
      if (!gltf?.url) throw new Error(`No glTF ${resolution} for "${id}".`);
      const entry = basename(gltf.url);
      const list: LibraryFile[] = [{ path: entry, url: gltf.url, size: gltf.size }];
      for (const [path, file] of Object.entries(gltf.include || {})) list.push({ path, url: file.url, size: file.size });
      return { kind: 'files', files: list, entry, format: 'gltf', resolution, unitScale: 1 } satisfies ResolvedDownload;
    }

    if (type === 'hdri') {
      const tree = files.hdri;
      if (!tree) throw new Error(`Poly Haven offers no HDRI files for "${id}".`);
      const resolution = pickResolution(Object.keys(tree), options.resolution, '2k')!;
      const format = options.format === 'exr' ? 'exr' : 'hdr';
      const file = tree[resolution]?.[format] || tree[resolution]?.hdr || tree[resolution]?.exr;
      if (!file?.url) throw new Error(`No HDRI ${resolution} for "${id}".`);
      const entry = basename(file.url);
      return { kind: 'files', files: [{ path: entry, url: file.url, size: file.size }], entry, format: entry.split('.').pop(), resolution };
    }

    // texture
    const format = options.format === 'png' ? 'png' : options.format === 'exr' ? 'exr' : 'jpg';
    const anyTree = files.Diffuse || Object.values(files).find((tree) => tree && typeof tree === 'object' && tree['1k']);
    const resolution = pickResolution(Object.keys(anyTree || {}), options.resolution, '2k');
    if (!resolution) throw new Error(`Poly Haven offers no texture maps for "${id}".`);
    const list: LibraryFile[] = [];
    const maps: ResolvedDownload['maps'] = {};
    for (const [key, tree] of Object.entries(files)) {
      const role = MAP_KEYS.find(([pattern]) => pattern.test(key))?.[1];
      if (!role || maps[role]) continue;
      const byFormat = tree?.[resolution];
      const file = byFormat?.[format] || byFormat?.jpg || byFormat?.png;
      if (!file?.url) continue;
      const path = basename(file.url);
      list.push({ path, url: file.url, size: file.size, role });
      maps[role] = path;
    }
    // Packed AO/Rough/Metal when the separate maps are missing.
    const arm = files.arm?.[resolution]?.[format] || files.arm?.[resolution]?.jpg;
    if (arm?.url && (!maps.roughness || !maps.ao)) {
      const path = basename(arm.url);
      list.push({ path, url: arm.url, size: arm.size });
      if (!maps.roughness) maps.roughness = path;
      if (!maps.ao) maps.ao = path;
    }
    if (!maps.baseColor) throw new Error(`"${id}" has no colour map.`);
    const notes = info.dimensions?.length ? [`One tile covers ${info.dimensions.map((mm) => (mm / 1000).toFixed(2)).join(' × ')} m.`] : [];
    return { kind: 'files', files: list, maps, format, resolution, notes };
  },
};
