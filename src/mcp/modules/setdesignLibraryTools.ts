/**
 * MCP tool module "setdesign-library": search free 3D libraries (Poly Haven, ambientCG,
 * Sketchfab, Smithsonian 3D) and bring models, HDRIs and PBR textures into the set design.
 *
 * Providers live in src/setdesign/libraries (one file each, registry.ts). Imports download
 * into the project folder (assets/3d/<provider>/<id>/<resolution>/) and then run the same
 * set design commands as the UI: object.add_model, scene.hdri, material.set.
 */
import { registerStudioToolModule, type StudioTool, type StudioToolContext } from '../toolModules.ts';
import { setDesignBus } from '../../setdesign/bus.ts';
import { getCommand } from '../../setdesign/commands.ts';
import {
  describeProvider,
  getLibraryProvider,
  isProviderConfigured,
  listLibraryProviders,
  providerContext,
  searchLibraries,
  typesOf,
} from '../../setdesign/libraries/registry.ts';
import { applyLibraryTexture, importLibraryModel, setLibraryHdri, type ImportDeps } from '../../setdesign/libraries/importer.ts';
import type { LibraryAsset } from '../../setdesign/libraries/types.ts';

const PREFIX = 'Set Design 3D libraries (free asset libraries for the 3D set; coordinates Blender convention, Z up, metres): ';

const LIBRARIES = 'polyhaven (CC0 models glTF/HDRIs/textures, no key), ambientcg (CC0 PBR materials + HDRIs as ZIP, no key), sketchfab (models, licence per model e.g. CC BY = credit required, CC BY-NC = no commercial use; search without key, download needs the user\'s Sketchfab token), smithsonian (CC0 museum scans GLB, needs an api.data.gov key)';

type DepsOverride = Partial<Omit<ImportDeps, 'projectPath'>> & { projectPath?: string | null };
let override: DepsOverride | null = null;

/** Tests only: replace the bus/file access of the import tools (null restores). */
export const overrideLibraryToolDeps = (next: DepsOverride | null) => { override = next; };

const depsFor = (ctx: StudioToolContext): ImportDeps => {
  if (!override && !setDesignBus.hasHost()) throw new Error('The set design is not connected to the open project yet. Open the project in the editor first.');
  return {
    run: (id, args) => setDesignBus.run(id, args),
    hasCommand: (id) => !!getCommand(id),
    projectPath: ctx.getState().projectPath,
    ...(override || {}),
  };
};

const asString = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const asNumber = (value: unknown) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const asStringList = (value: unknown) => (Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : typeof value === 'string' && value.trim() ? value.split(',').map((v) => v.trim()).filter(Boolean) : undefined);

const requireProviderArgs = (args: Record<string, unknown>) => {
  const provider = asString(args.provider);
  const id = asString(args.id);
  if (!provider || !id) throw new Error('Pass provider and id (from library_search).');
  const p = getLibraryProvider(provider);
  if (p.cost === 'paid' && args.confirm !== true) throw new Error(`${p.label} downloads cost money. Tell the user, then call again with confirm: true.`);
  return { provider: p.id, id };
};

const compactAsset = (asset: LibraryAsset) => ({
  provider: asset.provider,
  id: asset.id,
  name: asset.name,
  type: asset.type,
  license: asset.license.label,
  ...(asset.license.attributionRequired ? { creditRequired: true } : {}),
  ...(!asset.license.commercial ? { commercialUse: false } : {}),
  author: asset.author,
  downloadable: asset.downloadable,
  formats: asset.formats,
  ...(asset.resolutions?.length ? { resolutions: asset.resolutions } : {}),
  ...(asset.polycount ? { polycount: asset.polycount } : {}),
  ...(asset.dimensionsM ? { dimensionsM: asset.dimensionsM } : {}),
  thumbnailUrl: asset.thumbnailUrl,
  url: asset.url,
});

const PROVIDER_PARAM = { type: 'string' as const, description: `Library id: ${listLibraryProviders().map((p) => p.id).join(', ')}.`, enum: listLibraryProviders().map((p) => p.id) };
const ID_PARAM = { type: 'string' as const, description: 'Asset id exactly as returned by library_search (Poly Haven slug, ambientCG asset id, Sketchfab uid, Smithsonian record id).' };
const RESOLUTION_PARAM = (fallback: string) => ({ type: 'string' as const, description: `Texture resolution like "1k", "2k", "4k", "8k" (default ${fallback}; the closest lower offered one is used). Higher = larger downloads: 2k HDR ≈ 6 MB, 4k ≈ 25 MB, 8k ≈ 100 MB.` });

export const SETDESIGN_LIBRARY_TOOLS: StudioTool[] = [
  {
    name: 'library_providers',
    description: `${PREFIX}list the 3D libraries: id, asset types (model, hdri, texture), whether they are configured (key present), whether search works without a key, licence summary, cost (all free) and where to get a key. Libraries: ${LIBRARIES}.`,
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ providers: listLibraryProviders().map(describeProvider) }),
  },
  {
    name: 'library_search',
    description: `${PREFIX}search models, HDRIs or textures in several libraries in parallel. Each result has provider, id, name, licence (CC0 / CC BY …; creditRequired and commercialUse:false are flagged), author, formats, resolutions, polycount and real-world dimensionsM when known, thumbnailUrl and the asset page url. Errors and unconfigured libraries are reported per provider and do not fail the search. Then call library_import_model, library_set_hdri or library_apply_texture with provider + id. Libraries: ${LIBRARIES}. Show the user the licence of what you pick.`,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search words in English, e.g. "wooden chair", "studio softbox", "concrete floor". Empty = popular assets.' },
        type: { type: 'string', description: 'model (3D objects), hdri (360° environment lighting) or texture (tileable PBR material).', enum: ['model', 'hdri', 'texture'] },
        providers: { type: 'array', description: 'Only these libraries (default: all that offer the type).', items: { type: 'string' } },
        limit: { type: 'number', description: 'Results per library (default 12, max 50).' },
        page: { type: 'number', description: '1-based page (default 1).' },
        license: { type: 'string', description: 'Sketchfab only: licence slug filter, e.g. "cc0" or "by" (commercial use with credit).' },
        maxFaceCount: { type: 'number', description: 'Sketchfab only: maximum triangle count.' },
      },
      required: ['type'],
    },
    handler: async (args) => {
      const type = typesOf(args.type);
      const limit = Math.min(50, Math.max(1, asNumber(args.limit) ?? 12));
      const outcomes = await searchLibraries({
        query: asString(args.query) || '',
        type,
        limit,
        page: Math.max(1, asNumber(args.page) ?? 1),
        providers: asStringList(args.providers),
        filters: { ...(asString(args.license) ? { license: asString(args.license) } : {}), ...(asNumber(args.maxFaceCount) ? { maxFaceCount: asNumber(args.maxFaceCount) } : {}) },
      });
      return {
        type,
        results: outcomes.flatMap((o) => o.assets.map(compactAsset)),
        providers: outcomes.map((o) => ({ provider: o.provider, ok: o.ok, count: o.assets.length, ...(o.total !== undefined ? { total: o.total } : {}), ...(o.hasMore ? { hasMore: true } : {}), ...(o.error ? { error: o.error } : {}), ...(o.skipped ? { skipped: o.skipped } : {}) })),
        credit: 'Content from Poly Haven, ambientCG, Sketchfab and Smithsonian Open Access; name the library and licence when you show results.',
      };
    },
  },
  {
    name: 'library_asset_details',
    description: `${PREFIX}full details of one asset: licence with url and whether credit/commercial use is required/allowed, author, offered formats and resolutions, polycount, real-world dimensions (metres), tags, description, asset page.`,
    parameters: { type: 'object', properties: { provider: PROVIDER_PARAM, id: ID_PARAM }, required: ['provider', 'id'] },
    handler: async (args) => {
      const { provider, id } = requireProviderArgs(args);
      const p = getLibraryProvider(provider);
      const asset = await p.details(id, providerContext(p));
      return { asset: { ...compactAsset(asset), license: asset.license, tags: asset.tags, description: asset.description }, configured: isProviderConfigured(p) };
    },
  },
  {
    name: 'library_import_model',
    description: `${PREFIX}download a model from a library into the project folder (assets/3d/<provider>/<id>/<resolution>/, multi-part glTF with bin and textures kept together) and place it in the set with author/licence attribution. Poly Haven glTF and Smithsonian scans have real-world scale; files in mm/cm are converted. The model is put on the floor (lowest point at z of position). The reply has sizeM [x, y, z-up] in metres and warnings, e.g. an unrealistic size: then pass targetSize (largest dimension in metres, e.g. 0.9 for a chair) or scale it afterwards. Formats: Poly Haven glTF (1k/2k/4k textures, default 1k), Sketchfab GLB (needs the user's token; check licence), Smithsonian GLB (no Draco). Without a project folder the app cache or remote files are used (reported as storage).`,
    writes: true,
    parameters: {
      type: 'object',
      properties: {
        provider: PROVIDER_PARAM,
        id: ID_PARAM,
        position: { type: 'array', description: 'Location [x, y, z] in metres (Blender: Z up). Default [0, 0, 0].', items: { type: 'number' } },
        rotationZ: { type: 'number', description: 'Rotation about the vertical axis in degrees.' },
        targetSize: { type: 'number', description: 'Scale uniformly so the largest dimension is this many metres.' },
        name: { type: 'string', description: 'Object name (default: asset name).' },
        resolution: RESOLUTION_PARAM('1k'),
        snapToFloor: { type: 'boolean', description: 'Move the model so its lowest point sits at position z (default true).' },
      },
      required: ['provider', 'id'],
    },
    handler: async (args, ctx) => {
      const { provider, id } = requireProviderArgs(args);
      const position = Array.isArray(args.position) ? (args.position as unknown[]).map(Number) : undefined;
      return importLibraryModel({
        provider,
        id,
        position: position && position.length === 3 && position.every(Number.isFinite) ? position : undefined,
        rotationZ: asNumber(args.rotationZ),
        targetSize: asNumber(args.targetSize),
        name: asString(args.name),
        resolution: asString(args.resolution),
        snapToFloor: typeof args.snapToFloor === 'boolean' ? args.snapToFloor : undefined,
      }, depsFor(ctx));
    },
  },
  {
    name: 'library_set_hdri',
    description: `${PREFIX}download an HDRI (360° environment) and use it as the set's environment lighting, optionally visible as background. Poly Haven: .hdr (default) or .exr, 1k–16k; ambientCG: .exr from a ZIP (needs a project folder). Default 2k (≈ 6 MB, enough for lighting; use 4k+ only when the background is visible in shot). Licence and attribution are returned.`,
    writes: true,
    parameters: {
      type: 'object',
      properties: {
        provider: PROVIDER_PARAM,
        id: ID_PARAM,
        resolution: RESOLUTION_PARAM('2k'),
        format: { type: 'string', description: 'Poly Haven only: hdr (default) or exr.', enum: ['hdr', 'exr'] },
        strength: { type: 'number', description: 'Lighting strength 0–10 (default 1).' },
        background: { type: 'boolean', description: 'Show the HDRI as visible background.' },
      },
      required: ['provider', 'id'],
    },
    handler: async (args, ctx) => {
      const { provider, id } = requireProviderArgs(args);
      return setLibraryHdri({
        provider,
        id,
        resolution: asString(args.resolution),
        format: asString(args.format),
        strength: asNumber(args.strength),
        background: typeof args.background === 'boolean' ? args.background : undefined,
      }, depsFor(ctx));
    },
  },
  {
    name: 'library_apply_texture',
    description: `${PREFIX}download a PBR texture/material (colour, normal (OpenGL), roughness, metalness, ambient occlusion; displacement only with displacementScale) and put it on set objects via material.set, with attribution. Poly Haven: JPG maps 1k–8k (default 2k); ambientCG: JPG ZIP, unpacked into the project folder (needs one). repeat [u, v] tiles the texture: use object size in metres divided by tileSizeM (returned; e.g. a 4 m floor with a 2 m tile → [2, 2]).`,
    writes: true,
    parameters: {
      type: 'object',
      properties: {
        provider: PROVIDER_PARAM,
        id: ID_PARAM,
        objects: { type: 'array', description: 'Object ids or names (default: the current selection).', items: { type: 'string' } },
        repeat: { type: 'array', description: 'Texture repeat [u, v] (default [1, 1]).', items: { type: 'number' } },
        resolution: RESOLUTION_PARAM('2k'),
        displacementScale: { type: 'number', description: 'Use the displacement map with this height in metres (e.g. 0.02); only for finely subdivided meshes.' },
      },
      required: ['provider', 'id'],
    },
    handler: async (args, ctx) => {
      const { provider, id } = requireProviderArgs(args);
      const deps = depsFor(ctx);
      const objects = asStringList(args.objects) || (override ? [] : setDesignBus.getUi().selectedIds);
      const repeat = Array.isArray(args.repeat) && args.repeat.length === 2 ? (args.repeat as unknown[]).map(Number) as [number, number] : undefined;
      return applyLibraryTexture({ provider, id, objects, repeat, resolution: asString(args.resolution), displacementScale: asNumber(args.displacementScale) }, deps);
    },
  },
];

registerStudioToolModule({ id: 'setdesign-library', label: 'Set Design · 3D libraries', tools: SETDESIGN_LIBRARY_TOOLS });
