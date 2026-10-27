/**
 * Project fields that MCP tool modules read from `ctx.getState().extras` and
 * write with `ctx.actions.setExtra(key, value)`.
 *
 * App.tsx maps every key below to its React state (see the "MCP tool modules"
 * block there): reads come from the latest state, `setExtra` calls the
 * matching setter. Handlers read once, compute the next value and write once.
 */
import type {
  AvatarProfile,
  DesignCanvasState,
  MediaItem,
  NamingTemplate,
  NeurocinematicsAnalysisResult,
  NodeGraphState,
  ReferenceItem,
  ReviewData,
  SceneMapState,
  SetDesignState,
  ShotPrompt,
  StoryBible,
  Workspace,
  WorldGenerationState,
} from '../types';
import type { StudioToolContext } from './toolModules.ts';

export type AnalysisExtra = {
  videoUrl: string | null;
  scriptText: string;
  result: NeurocinematicsAnalysisResult | null;
};

export type ProjectExtras = {
  storyBible: StoryBible;
  references: ReferenceItem[];
  shotPrompts: ShotPrompt[];
  reviewData: ReviewData;
  namingTemplates: NamingTemplate[];
  sceneMap: SceneMapState | null;
  designCanvas: DesignCanvasState | null;
  nodeGraph: NodeGraphState | null;
  worldGen: WorldGenerationState | null;
  avatars: AvatarProfile[];
  setDesign: SetDesignState | null;
  analysis: AnalysisExtra;
  uiMode: 'beginner' | 'advanced' | 'pro';
  isDirector: boolean;
  allowedWorkspaces: Workspace[];
};

export type ProjectExtraKey = keyof ProjectExtras;

/** Keys App.tsx must route to a React setter when `setExtra` is called. */
export const WRITABLE_PROJECT_EXTRAS: ProjectExtraKey[] = [
  'storyBible',
  'reviewData',
  'namingTemplates',
  'sceneMap',
  'designCanvas',
  'nodeGraph',
  'worldGen',
  'avatars',
  'setDesign',
  'analysis',
  'uiMode',
];

export function getExtra<K extends ProjectExtraKey>(ctx: StudioToolContext, key: K): ProjectExtras[K] | undefined {
  return ctx.getState().extras[key] as ProjectExtras[K] | undefined;
}

export function setExtra<K extends ProjectExtraKey>(ctx: StudioToolContext, key: K, value: ProjectExtras[K]): void {
  ctx.actions.setExtra(key, value);
}

export function requireExtra<K extends ProjectExtraKey>(ctx: StudioToolContext, key: K): ProjectExtras[K] {
  const value = getExtra(ctx, key);
  if (value === undefined) throw new Error(`Project field "${key}" is not available in this editor build.`);
  return value;
}

/** Media item by id, or by exact name as a fallback. */
export function findMediaItem(ctx: StudioToolContext, idOrName: unknown): MediaItem {
  const key = typeof idOrName === 'string' ? idOrName.trim() : '';
  if (!key) throw new Error('Pass a media item id (see media list tools).');
  const items = ctx.getState().mediaItems;
  const item = items.find((entry) => entry.id === key) ?? items.find((entry) => entry.name === key);
  if (!item) throw new Error(`Media item ${key} not found.`);
  return item;
}

export const nowIso = () => new Date().toISOString();

export const buildId = (prefix = 'id') => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};
