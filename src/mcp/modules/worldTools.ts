/**
 * MCP tools: World (Create › World), World Labs Marble worlds from text, an
 * image or a video. History is the project's `worldGen`; entries and hand-offs
 * use the same functions as the page (services/worldHistory.ts).
 */
import { guardPaidTools } from '../paidGuard.ts';
import type { MediaItem, SetDesignState, WorldGenerationEntry } from '../../types';
import { WORLD_MODEL_OPTIONS, normalizeWorldModelId } from '../../services/worldModelProviderRegistry.ts';
import {
  WORLD_ASSET_KINDS,
  WORLD_SAVE_ALL,
  addWorldEntry,
  buildWorldEntry,
  worldAssetMediaItem,
  worldMeshToSetDesignAsset,
  type WorldAssetKind,
  type WorldAssetUrls,
} from '../../services/worldHistory.ts';
import { getExtra, setExtra } from '../projectExtras.ts';
import { mediaInputSchema, pickMediaUrl } from '../mediaInput.ts';
import { createServiceLoader } from '../serviceLoader.ts';
import { registerStudioToolModule, str, type StudioToolContext, type StudioToolModule } from '../toolModules.ts';

type GeneratedWorld = { id: string; display_name?: string; model?: string; created_at?: string };
type Progress = (message: string) => void;
type WorldServices = {
  hasWorldLabsApiKey: () => boolean;
  generateWorldFromText: (name: string, prompt: string, model: string, onProgress?: Progress) => Promise<GeneratedWorld>;
  generateWorldFromImageUrl: (name: string, url: string, prompt: string | undefined, isPano: boolean, model: string, onProgress?: Progress) => Promise<GeneratedWorld>;
  generateWorldFromImageFile: (name: string, file: File, prompt: string | undefined, isPano: boolean, model: string, onProgress?: Progress) => Promise<GeneratedWorld>;
  generateWorldFromVideoUrl: (name: string, url: string, prompt: string | undefined, model: string, onProgress?: Progress) => Promise<GeneratedWorld>;
  getWorldAssetUrls: (world: GeneratedWorld) => WorldAssetUrls;
};

export const worldServices = createServiceLoader<WorldServices>(async () => {
  const service = await import('../../services/worldLabsService.ts');
  return service as unknown as WorldServices;
});

const MODELS = WORLD_MODEL_OPTIONS.filter((option) => option.providerId === 'worldlabs');
const historyOf = (ctx: StudioToolContext) => getExtra(ctx, 'worldGen')?.history ?? [];
const findWorld = (ctx: StudioToolContext, id: unknown): WorldGenerationEntry => {
  const list = historyOf(ctx);
  const world = typeof id === 'string' && id ? list.find((entry) => entry.id === id || entry.name === id) : list[0];
  if (!world) throw new Error(typeof id === 'string' && id ? `World ${id} not found (see world_list).` : 'No world generated yet.');
  return world;
};

/** Local files and data URLs are uploaded; https URLs are passed to World Labs directly. */
const toFile = async (url: string, name: string): Promise<File> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}.`);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || 'image/jpeg' });
};

export const WORLD_TOOL_MODULE: StudioToolModule = {
  id: 'world',
  label: 'Create: World generation',
  tools: [
    {
      name: 'world_list',
      description: 'List generated worlds (newest first, the page keeps 50) with source, model and which assets exist (viewer, mesh, panorama, splats), plus the available World Labs models.',
      parameters: { type: 'object', properties: {} },
      handler: (_args, ctx) => ({
        worlds: historyOf(ctx).map((entry) => ({
          id: entry.id, name: entry.name, model: entry.model, createdAt: entry.createdAt, source: entry.source,
          assets: Object.fromEntries(Object.entries(entry.assets).map(([key, value]) => [key, Boolean(value)])),
        })),
        models: MODELS.map(({ id, label }) => ({ id, label })),
        assetKinds: WORLD_ASSET_KINDS,
      }),
    },
    {
      name: 'world_get',
      description: 'Read one world with all asset URLs (viewUrl opens the interactive splat viewer; mesh is GLB; splats are SPZ). Defaults to the newest world.',
      parameters: { type: 'object', properties: { worldId: { type: 'string' } } },
      handler: (args, ctx) => ({ world: findWorld(ctx, args.worldId) }),
    },
    {
      name: 'world_generate',
      description: 'Generate a world with World Labs Marble ("Generate World") from a text prompt, an image (optionally a 360° panorama) or a video URL, and add it to the world history. Takes minutes.',
      writes: true,
      cost: 'paid',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['text', 'image', 'video'] },
          name: { type: 'string', description: 'World name (default "New World").' },
          prompt: { type: 'string', description: 'Required for text; optional guidance for image/video.' },
          model: { type: 'string', enum: MODELS.map((option) => option.id), description: 'Default marble-1.1-plus.' },
          isPano: { type: 'boolean', description: 'Image is a 360° panorama.' },
          ...mediaInputSchema('image', 'Source image'),
          videoUrl: { type: 'string', description: 'Source video (https URL).' },
        },
        required: ['mode'],
      },
      handler: async (args, ctx) => {
        const mode = str(args, 'mode') as 'text' | 'image' | 'video';
        if (!['text', 'image', 'video'].includes(mode)) throw new Error('mode must be text, image or video.');
        const name = str(args, 'name', 'New World');
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
        const model = normalizeWorldModelId(typeof args.model === 'string' ? args.model : 'marble-1.1-plus');
        const isPano = args.isPano === true;
        const imageUrl = mode === 'image' ? pickMediaUrl(ctx, args, 'image') : null;
        const videoUrl = typeof args.videoUrl === 'string' ? args.videoUrl.trim() : '';
        if (mode === 'text' && !prompt) throw new Error('Add a prompt to generate a world.');
        if (mode === 'image' && !imageUrl) throw new Error('Pass imageUrl, imagePath or imageMediaId.');
        if (mode === 'video' && !videoUrl) throw new Error('Pass a videoUrl.');
        const service = await worldServices.get();
        if (!service.hasWorldLabsApiKey()) throw new Error('Add your World Labs API key in Settings.');
        let world: GeneratedWorld;
        if (mode === 'image') {
          world = /^https?:/i.test(imageUrl!)
            ? await service.generateWorldFromImageUrl(name, imageUrl!, prompt || undefined, isPano, model)
            : await service.generateWorldFromImageFile(name, await toFile(imageUrl!, `${name}.jpg`), prompt || undefined, isPano, model);
        } else if (mode === 'video') {
          world = await service.generateWorldFromVideoUrl(name, videoUrl, prompt || undefined, model);
        } else {
          world = await service.generateWorldFromText(name, prompt, model);
        }
        const entry = buildWorldEntry(world, service.getWorldAssetUrls(world), {
          mode, name, prompt, model, isPano,
          imageUrl: imageUrl && /^https?:/i.test(imageUrl) ? imageUrl : undefined,
          videoUrl,
        });
        setExtra(ctx, 'worldGen', addWorldEntry(getExtra(ctx, 'worldGen') ?? null, entry));
        return { world: entry };
      },
    },
    {
      name: 'world_save_assets',
      description: 'Add world files to the media bin: mesh (GLB), panorama, thumbnail, splat_full/500k/100k. Without kinds it saves mesh, panorama, thumbnail and full splat ("Save All Assets").',
      writes: true,
      parameters: {
        type: 'object',
        properties: { worldId: { type: 'string' }, kinds: { type: 'array', items: { type: 'string', enum: WORLD_ASSET_KINDS } } },
      },
      handler: (args, ctx) => {
        const world = findWorld(ctx, args.worldId);
        const kinds = (Array.isArray(args.kinds) && args.kinds.length ? args.kinds : WORLD_SAVE_ALL) as WorldAssetKind[];
        const saved: MediaItem[] = [];
        const missing: string[] = [];
        for (const kind of kinds) {
          if (!WORLD_ASSET_KINDS.includes(kind)) throw new Error(`Unknown asset kind ${kind}.`);
          const item = worldAssetMediaItem(world, kind);
          if (item) { ctx.actions.addMediaItem(item); saved.push(item); } else missing.push(kind);
        }
        if (saved.length === 0) throw new Error('No downloadable assets found for this world.');
        return { saved: saved.map(({ id, name, url }) => ({ id, name, url })), missing };
      },
    },
    {
      name: 'world_send_mesh_to_set_design',
      description: "Put the world's collider mesh into the Set Design scene as a model asset and open Set Design (\"Add Mesh to Set Design\").",
      writes: true,
      parameters: { type: 'object', properties: { worldId: { type: 'string' }, openSetDesign: { type: 'boolean', description: 'Default true, as on the page.' } } },
      handler: (args, ctx) => {
        const world = findWorld(ctx, args.worldId);
        const asset = worldMeshToSetDesignAsset(world);
        if (!asset) throw new Error('No mesh available to send to Set Design.');
        const current = getExtra(ctx, 'setDesign');
        const base = (current ?? { assets: [] }) as SetDesignState;
        setExtra(ctx, 'setDesign', { ...base, assets: [...(base.assets ?? []), asset] } as SetDesignState);
        if (args.openSetDesign !== false) ctx.actions.setActiveWorkspace('SET_DESIGN');
        return { asset };
      },
    },
  ],
};

registerStudioToolModule(guardPaidTools(WORLD_TOOL_MODULE));
