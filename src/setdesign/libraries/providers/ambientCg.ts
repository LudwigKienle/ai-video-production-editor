/**
 * ambientCG (https://ambientcg.com): CC0 PBR materials and HDRIs. No key.
 * API v2 checked 2026-11: https://docs.ambientcg.com/api/v2/full_json/
 *   GET https://ambientcg.com/api/v2/full_json?q=&type=Material|HDRI&sort=Popular&limit=&offset=&id=&include=…
 * Downloads are ZIPs (https://ambientcg.com/get?file=<Asset>_<RES>[-JPG|-PNG].zip, redirects to a CDN).
 * Material ZIPs hold <Asset>_<RES>-JPG_Color.jpg, _NormalGL, _NormalDX, _Roughness, _Metalness,
 * _AmbientOcclusion, _Displacement (+ .blend/.usdc/.mtlx that we skip). HDRI ZIPs hold <Asset>_<RES>_HDR.exr.
 * Licence: CC0 (https://docs.ambientcg.com/license/).
 */
import { CC0 } from '../licenses.ts';
import { pickResolution, sortResolutions } from '../resolution.ts';
import type { LibraryAsset, LibraryAssetType, LibraryProvider } from '../types.ts';

const API = 'https://ambientcg.com/api/v2/full_json';
const INCLUDE = 'displayData,previewData,downloadData,dimensionsData,tagData,mapData';

type AcgDownload = { fullDownloadPath?: string; downloadLink: string; fileName: string; size?: number; filetype?: string; attribute: string };
type AcgAsset = {
  assetId: string;
  dataType: string;
  displayName?: string;
  tags?: string[];
  shortLink?: string;
  dimensionX?: number;
  dimensionY?: number;
  previewImage?: Record<string, string>;
  maps?: string[];
  description?: string;
  downloadFolders?: Record<string, { downloadFiletypeCategories?: Record<string, { downloads?: AcgDownload[] }> }>;
};
type AcgResponse = { numberOfResults?: number; foundAssets?: AcgAsset[] };

const TYPE_PARAM: Partial<Record<LibraryAssetType, string>> = { texture: 'Material', hdri: 'HDRI' };

const downloadsOf = (asset: AcgAsset) =>
  Object.values(asset.downloadFolders || {}).flatMap((folder) => Object.values(folder.downloadFiletypeCategories || {}).flatMap((cat) => cat.downloads || []));

const toAsset = (asset: AcgAsset): LibraryAsset => {
  const type: LibraryAssetType = asset.dataType === 'HDRI' ? 'hdri' : 'texture';
  const downloads = downloadsOf(asset);
  const formats = type === 'hdri' ? ['exr'] : [...new Set(downloads.map((d) => (d.attribute.split('-')[1] || '').toLowerCase()).filter(Boolean))];
  const dims = asset.dimensionX && asset.dimensionY ? [asset.dimensionX / 100, asset.dimensionY / 100] : undefined;
  return {
    provider: 'ambientcg',
    id: asset.assetId,
    name: asset.displayName || asset.assetId,
    type,
    thumbnailUrl: asset.previewImage?.['256-PNG'] || asset.previewImage?.['512-PNG'] || Object.values(asset.previewImage || {})[0],
    author: 'ambientCG',
    license: CC0,
    url: asset.shortLink || `https://ambientcg.com/view?id=${encodeURIComponent(asset.assetId)}`,
    formats: formats.length ? formats : ['jpg'],
    downloadable: downloads.length > 0,
    resolutions: sortResolutions(downloads.map((d) => d.attribute)),
    ...(dims ? { dimensionsM: dims } : {}),
    tags: asset.tags,
    description: asset.description || undefined,
  };
};

const fetchOne = async (id: string, http: { json: <T>(url: string) => Promise<T> }) => {
  const data = await http.json<AcgResponse>(`${API}?id=${encodeURIComponent(id)}&include=${INCLUDE}`);
  const asset = data.foundAssets?.find((entry) => entry.assetId === id) || data.foundAssets?.[0];
  if (!asset) throw new Error(`ambientCG has no asset "${id}".`);
  return asset;
};

export const ambientCgProvider: LibraryProvider = {
  id: 'ambientcg',
  label: 'ambientCG',
  types: ['texture', 'hdri'],
  description: 'CC0 PBR materials (colour, normal, roughness, metalness, AO, displacement) and HDRIs. No key needed. Downloads are ZIPs that are unpacked into the project.',
  homepage: 'https://ambientcg.com',
  licenseSummary: 'CC0 (public domain), free for commercial use, no credit required.',
  requiresKey: false,
  cost: 'free',
  credit: 'ambientCG (CC0)',
  configured: () => true,

  async search(query, ctx) {
    const type = TYPE_PARAM[query.type];
    if (!type) return { assets: [], total: 0, hasMore: false };
    const limit = Math.min(100, Math.max(1, query.limit || 24));
    const page = Math.max(1, query.page || 1);
    const params = new URLSearchParams({ type, sort: 'Popular', limit: String(limit), offset: String((page - 1) * limit), include: INCLUDE });
    if (query.query.trim()) params.set('q', query.query.trim());
    const data = await ctx.http.json<AcgResponse>(`${API}?${params}`);
    const assets = (data.foundAssets || []).map(toAsset);
    const total = data.numberOfResults ?? assets.length;
    return { assets, total, hasMore: page * limit < total };
  },

  async details(id, ctx) {
    return toAsset(await fetchOne(id, ctx.http));
  },

  async resolveDownload(id, options, ctx) {
    const asset = await fetchOne(id, ctx.http);
    const downloads = downloadsOf(asset).filter((d) => /zip/i.test(d.filetype || d.fileName));
    if (!downloads.length) throw new Error(`ambientCG offers no download for "${id}".`);
    const isHdri = asset.dataType === 'HDRI';
    const wantFormat = isHdri ? '' : options.format === 'png' ? 'PNG' : 'JPG';
    const candidates = isHdri ? downloads : downloads.filter((d) => d.attribute.toUpperCase().endsWith(`-${wantFormat}`));
    const pool = candidates.length ? candidates : downloads;
    const resolution = pickResolution(pool.map((d) => d.attribute), options.resolution, isHdri ? '2k' : '2k');
    const chosen = pool.find((d) => sortResolutions([d.attribute])[0] === resolution) || pool[0];
    const notes = asset.dimensionX && asset.dimensionY && !isHdri ? [`One tile covers ${(asset.dimensionX / 100).toFixed(2)} × ${(asset.dimensionY / 100).toFixed(2)} m.`] : [];
    return {
      kind: 'zip',
      files: [{ path: chosen.fileName, url: chosen.fullDownloadPath || chosen.downloadLink, size: chosen.size }],
      format: isHdri ? 'exr' : wantFormat.toLowerCase(),
      resolution,
      notes,
    };
  },
};
