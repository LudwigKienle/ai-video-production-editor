/**
 * Smithsonian Open Access 3D (https://www.si.edu/openaccess): museum scans, CC0 only.
 * Needs a free api.data.gov key (https://api.data.gov/signup/), stored as "smithsonian_api_key".
 * API checked 2026-11 (https://edan.si.edu/openaccess/apidocs/):
 *   GET https://api.si.edu/openaccess/api/v1.0/search?q=<words> AND online_media_type:"3D Models"&rows=&start=&api_key=
 *   GET https://api.si.edu/openaccess/api/v1.0/content/{id}?api_key=
 * 3D files are listed in content.descriptiveNonRepeating.online_media.media[type=3d_voyager].resources
 * with attributes UNITS (mm/cm/m), MODEL_FILE_TYPE, DRACO_COMPRESSED and FILE_SIZE; files are served by
 * 3d-api.si.edu. Only packages with usage.access "CC0" are offered.
 */
import { CC0 } from '../licenses.ts';
import type { LibraryAsset, LibraryProvider, ResolvedDownload } from '../types.ts';

const API = 'https://api.si.edu/openaccess/api/v1.0';

type SiResource = { url: string; title?: string; category?: string; filename?: string; attributes?: Array<Record<string, unknown>> };
type SiMedia = { id?: string; type?: string; thumbnail?: string; content?: string; usage?: { access?: string }; resources?: SiResource[] };
type SiRow = {
  id: string;
  title?: string;
  unitCode?: string;
  content?: {
    descriptiveNonRepeating?: { title?: { content?: string }; data_source?: string; record_link?: string; online_media?: { media?: SiMedia[] } };
    freetext?: { name?: Array<{ content?: string }>; creditLine?: Array<{ content?: string }> };
  };
};

const UNIT_SCALE: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };

const attrs = (resource: SiResource) => Object.assign({}, ...(resource.attributes || [])) as Record<string, unknown>;

const cc0Packages = (row: SiRow) =>
  (row.content?.descriptiveNonRepeating?.online_media?.media || []).filter((m) => m.type === '3d_voyager' && String(m.usage?.access || '').toUpperCase() === 'CC0');

/** Files the set design viewport can load: GLB without Draco (the loader has no Draco decoder). */
const usableResources = (row: SiRow) =>
  cc0Packages(row).flatMap((pkg) => (pkg.resources || []).map((resource) => ({ resource, a: attrs(resource) })))
    .filter(({ a, resource }) => String(a.MODEL_FILE_TYPE || a.FILE_TYPE || resource.filename?.split('.').pop() || '').toLowerCase() === 'glb' && a.DRACO_COMPRESSED !== true);

const thumbOf = (row: SiRow) => {
  const media = row.content?.descriptiveNonRepeating?.online_media?.media || [];
  const url = media.find((m) => m.thumbnail)?.thumbnail;
  return url && url.includes('ids.si.edu') && !url.includes('max=') ? `${url}&max=300` : url;
};

const toAsset = (row: SiRow): LibraryAsset => {
  const nrep = row.content?.descriptiveNonRepeating;
  const usable = usableResources(row);
  const formats = [...new Set(cc0Packages(row).flatMap((pkg) => (pkg.resources || []).map((r) => String(attrs(r).MODEL_FILE_TYPE || '').toLowerCase())).filter(Boolean))];
  const author = row.content?.freetext?.name?.map((n) => n.content).filter(Boolean).join('; ');
  const source = nrep?.data_source || row.unitCode || 'Smithsonian Institution';
  return {
    provider: 'smithsonian',
    id: row.id,
    name: nrep?.title?.content || row.title || row.id,
    type: 'model',
    thumbnailUrl: thumbOf(row),
    author: author ? `${author} (${source})` : source,
    license: { ...CC0, note: 'CC0 (Smithsonian Open Access). Credit "Smithsonian Institution" is appreciated.' },
    url: nrep?.record_link || `https://www.si.edu/object/${encodeURIComponent(row.id)}`,
    formats: formats.length ? formats : ['glb'],
    downloadable: usable.length > 0,
    resolutions: [...new Set(usable.map(({ resource }) => resource.category || 'Low resolution'))],
    description: row.content?.freetext?.creditLine?.map((c) => c.content).filter(Boolean).join(' ') || undefined,
  };
};

export const smithsonianProvider: LibraryProvider = {
  id: 'smithsonian',
  label: 'Smithsonian 3D',
  types: ['model'],
  description: 'CC0 3D scans from Smithsonian museums (objects, furniture, specimens), GLB with real units. Needs a free api.data.gov key.',
  homepage: 'https://www.si.edu/openaccess',
  licenseSummary: 'CC0 (only CC0 packages are offered).',
  requiresKey: true,
  keyLabel: 'api.data.gov key',
  keyPlaceholder: 'api.data.gov API key',
  keyUrl: 'https://api.data.gov/signup/',
  keyStorage: 'smithsonian_api_key',
  cost: 'free',
  credit: 'Smithsonian Open Access',
  configured: (key) => !!key.trim(),

  async search(query, ctx) {
    if (query.type !== 'model') return { assets: [], total: 0, hasMore: false };
    if (!ctx.key) throw new Error('Smithsonian 3D needs a free api.data.gov key (Settings › 3D libraries).');
    const limit = Math.min(50, Math.max(1, query.limit || 24));
    const page = Math.max(1, query.page || 1);
    const words = query.query.trim().replace(/"/g, '');
    const q = `${words ? `(${words}) AND ` : ''}online_media_type:"3D Models"`;
    const params = new URLSearchParams({ q, rows: String(limit), start: String((page - 1) * limit), api_key: ctx.key });
    const data = await ctx.http.json<{ response?: { rows?: SiRow[]; rowCount?: number } }>(`${API}/search?${params}`);
    const rows = data.response?.rows || [];
    const assets = rows.filter((row) => cc0Packages(row).length).map(toAsset);
    const total = data.response?.rowCount ?? assets.length;
    return { assets, total, hasMore: page * limit < total };
  },

  async details(id, ctx) {
    if (!ctx.key) throw new Error('Smithsonian 3D needs a free api.data.gov key (Settings › 3D libraries).');
    const data = await ctx.http.json<{ response?: SiRow }>(`${API}/content/${encodeURIComponent(id)}?api_key=${encodeURIComponent(ctx.key)}`);
    if (!data.response?.id) throw new Error(`Smithsonian has no record "${id}".`);
    return toAsset(data.response);
  },

  async resolveDownload(id, options, ctx) {
    if (!ctx.key) throw new Error('Smithsonian 3D needs a free api.data.gov key (Settings › 3D libraries).');
    const data = await ctx.http.json<{ response?: SiRow }>(`${API}/content/${encodeURIComponent(id)}?api_key=${encodeURIComponent(ctx.key)}`);
    const row = data.response;
    if (!row?.id) throw new Error(`Smithsonian has no record "${id}".`);
    const usable = usableResources(row)
      .map((entry) => ({ ...entry, size: Number(entry.a.FILE_SIZE) || Number.MAX_SAFE_INTEGER }))
      .sort((x, y) => x.size - y.size);
    if (!usable.length) throw new Error('This Smithsonian record has no CC0 GLB without Draco compression (the set viewport cannot decode Draco). Use the Voyager page to download other formats.');
    const wantFull = /full/i.test(options.resolution || '');
    const pick = (wantFull ? usable.filter((u) => /full/i.test(u.resource.category || '')) : usable.filter((u) => !/full/i.test(u.resource.category || '')))[0] || usable[0];
    const units = String(pick.a.UNITS || 'm').toLowerCase();
    const notes = [`Scan units: ${units}.`];
    if (pick.size > 80 * 1024 * 1024 && pick.size !== Number.MAX_SAFE_INTEGER) notes.push(`Large file (${Math.round(pick.size / 1024 / 1024)} MB).`);
    const fileName = (pick.resource.filename || `${id}.glb`).replace(/[^\w.\-() ]+/g, '_');
    return {
      kind: 'files',
      files: [{ path: fileName, url: pick.resource.url, size: pick.size === Number.MAX_SAFE_INTEGER ? undefined : pick.size }],
      entry: fileName,
      format: 'glb',
      resolution: pick.resource.category,
      unitScale: UNIT_SCALE[units] ?? 1,
      notes,
    } satisfies ResolvedDownload;
  },
};
