/**
 * World generation history (Create › World): turning a generated World Labs
 * world into a history entry, keeping the last 50, and the hand-offs to the
 * media bin and Set Design. Pure; used by WorldGenerationWorkspace and the
 * MCP world_ tools.
 */
import type { MediaItem, SetDesignAsset, WorldGenerationEntry, WorldGenerationState } from '../types';
import { getWorldModelGeneratedBy, normalizeWorldModelId } from './worldModelProviderRegistry.ts';

export const WORLD_HISTORY_LIMIT = 50;

export type WorldSourceInput = {
  mode: 'text' | 'image' | 'video';
  name: string;
  prompt?: string;
  imageUrl?: string;
  videoUrl?: string;
  isPano?: boolean;
  model: string;
};

export type WorldAssetUrls = {
  viewUrl?: string | null;
  thumbnail?: string | null;
  panorama?: string | null;
  colliderMesh?: string | null;
  splat100k?: string | null;
  splat500k?: string | null;
  splatFullRes?: string | null;
};

const buildId = () => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `world_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export function buildWorldEntry(
  world: { id: string; display_name?: string; model?: string; created_at?: string },
  assets: WorldAssetUrls,
  input: WorldSourceInput,
): WorldGenerationEntry {
  const prompt = input.prompt?.trim() || undefined;
  return {
    id: world.id,
    name: world.display_name || input.name,
    provider: 'worldlabs',
    model: normalizeWorldModelId(world.model || input.model),
    createdAt: world.created_at || new Date().toISOString(),
    source: {
      type: input.mode,
      prompt,
      imageUrl: input.mode === 'image' ? (input.imageUrl?.trim() || undefined) : undefined,
      videoUrl: input.mode === 'video' ? input.videoUrl?.trim() : undefined,
      isPano: input.mode === 'image' ? Boolean(input.isPano) : undefined,
    },
    assets: {
      viewUrl: assets.viewUrl ?? undefined,
      thumbnailUrl: assets.thumbnail ?? undefined,
      panoramaUrl: assets.panorama ?? undefined,
      meshUrl: assets.colliderMesh ?? undefined,
      splat100kUrl: assets.splat100k ?? undefined,
      splat500kUrl: assets.splat500k ?? undefined,
      splatFullResUrl: assets.splatFullRes ?? undefined,
    },
  } as WorldGenerationEntry;
}

/** Newest first; only the last 50 worlds are kept (as on the page). */
export const addWorldEntry = (state: WorldGenerationState | null, entry: WorldGenerationEntry): WorldGenerationState => ({
  history: [entry, ...(state?.history ?? []).filter((item) => item.id !== entry.id)].slice(0, WORLD_HISTORY_LIMIT),
});

export type WorldAssetKind = 'mesh' | 'panorama' | 'thumbnail' | 'splat_full' | 'splat_500k' | 'splat_100k';

const ASSET_FILES: Record<WorldAssetKind, { key: keyof WorldGenerationEntry['assets']; suffix: string }> = {
  mesh: { key: 'meshUrl', suffix: 'mesh.glb' },
  panorama: { key: 'panoramaUrl', suffix: 'panorama.jpg' },
  thumbnail: { key: 'thumbnailUrl', suffix: 'thumbnail.jpg' },
  splat_full: { key: 'splatFullResUrl', suffix: 'splat_full.spz' },
  splat_500k: { key: 'splat500kUrl', suffix: 'splat_500k.spz' },
  splat_100k: { key: 'splat100kUrl', suffix: 'splat_100k.spz' },
};

/** "Save All Assets" saves these four. */
export const WORLD_SAVE_ALL: WorldAssetKind[] = ['mesh', 'panorama', 'thumbnail', 'splat_full'];
export const WORLD_ASSET_KINDS = Object.keys(ASSET_FILES) as WorldAssetKind[];

/** Media bin item for one world asset, or null if the world has no such file. */
export function worldAssetMediaItem(entry: WorldGenerationEntry, kind: WorldAssetKind, id = buildId()): MediaItem | null {
  const file = ASSET_FILES[kind];
  const url = entry.assets[file.key];
  if (!url || typeof url !== 'string') return null;
  return {
    id,
    name: `${entry.name}_${file.suffix}`,
    // The media bin knows image/video/audio only; meshes and splats are kept as file entries of type image, as on the page.
    type: 'image',
    url,
    source: 'generated',
    generatedBy: getWorldModelGeneratedBy(entry.model),
  };
}

const inferModelFormat = (value?: string | null) => {
  if (!value) return undefined;
  const ext = value.split('?')[0].split('.').pop()?.toLowerCase() || '';
  return ext === 'glb' || ext === 'gltf' || ext === 'obj' || ext === 'fbx' ? ext : undefined;
};

/** Set Design model asset for the world's collider mesh ("Add Mesh to Set Design"). */
export function worldMeshToSetDesignAsset(entry: WorldGenerationEntry): SetDesignAsset | null {
  if (!entry.assets.meshUrl) return null;
  return {
    id: buildId(),
    name: `${entry.name} Mesh`,
    kind: 'model',
    format: inferModelFormat(entry.assets.meshUrl) || 'glb',
    url: entry.assets.meshUrl,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  } as SetDesignAsset;
}
