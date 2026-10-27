/**
 * MCP tool modules for the "ai-video-studio" server.
 *
 * Every page/feature contributes a module with JSON-schema tools. App.tsx
 * merges all modules into the tool list it publishes to the local MCP server
 * (see `registerStudioTools` in services/localAgentsService.ts), so new
 * features become agent-drivable without touching the App tool table.
 *
 * Handlers get a `StudioToolContext`: read access to the current project
 * state plus a small set of write actions provided by App.tsx. UI-only state
 * (e.g. an export queue that lives in a page component) is reached through
 * live commands (see liveCommands.ts).
 */
import type { MediaItem, TimelineClip, TimelineTrack, Workspace } from '../types';

export type JsonSchema = {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: Array<string | number>;
  minimum?: number;
  maximum?: number;
};

export type StudioState = {
  activeWorkspace: Workspace;
  timelineClips: TimelineClip[];
  timelineTracks: TimelineTrack[];
  mediaItems: MediaItem[];
  playheadPosition: number;
  selectedClipId: string | null;
  projectPath: string | null;
  /** Optional project extensions (markers, soundMix, compositions …). */
  extras: Record<string, unknown>;
};

export type StudioActions = {
  setActiveWorkspace: (workspace: Workspace) => void;
  updateClip: (clip: TimelineClip) => void;
  setTimelineClips: (clips: TimelineClip[]) => void;
  setTimelineTracks: (tracks: TimelineTrack[]) => void;
  addMediaItem: (item: MediaItem) => void;
  setPlayhead: (seconds: number) => void;
  selectClip: (clipId: string | null) => void;
  setExtra: (key: string, value: unknown) => void;
};

export type StudioToolContext = {
  getState: () => StudioState;
  actions: StudioActions;
};

export type StudioToolResult = Record<string, unknown> & { ok?: boolean; message?: string };

export type StudioTool = {
  /** snake_case, prefixed by area: fx_, timeline_, export_, color_, … */
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Marks tools that change project data (shown to users as "write"). */
  writes?: boolean;
  /** Spends provider credits (prefixed "[KOSTET CREDITS]" in the description). */
  cost?: 'paid';
  /** Deletes or irreversibly overwrites data (prefixed "[LÖSCHT]"). */
  destructive?: boolean;
  handler: (args: Record<string, unknown>, ctx: StudioToolContext) => Promise<StudioToolResult> | StudioToolResult;
};

export type StudioToolModule = {
  id: string;
  label: string;
  tools: StudioTool[];
};

const modules = new Map<string, StudioToolModule>();
const listeners = new Set<() => void>();

export function registerStudioToolModule(module: StudioToolModule): void {
  for (const tool of module.tools) {
    if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) throw new Error(`Invalid MCP tool name "${tool.name}" (use snake_case).`);
  }
  modules.set(module.id, module);
  listeners.forEach((listener) => listener());
}

export function listStudioToolModules(): StudioToolModule[] {
  return [...modules.values()];
}

export function subscribeStudioToolModules(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Declarations + executor in the shape `registerStudioTools` expects. */
export function collectStudioTools(getContext: () => StudioToolContext) {
  const declarations: Array<{ name: string; description: string; parameters: JsonSchema }> = [];
  const executor: Record<string, (args: Record<string, unknown>) => Promise<StudioToolResult>> = {};
  const seen = new Set<string>();
  for (const module of modules.values()) {
    for (const tool of module.tools) {
      if (seen.has(tool.name)) throw new Error(`Duplicate MCP tool name "${tool.name}" (module ${module.id}).`);
      seen.add(tool.name);
      const prefix = `${tool.cost === 'paid' ? '[KOSTET CREDITS] ' : ''}${tool.destructive ? '[LÖSCHT] ' : ''}`;
      declarations.push({ name: tool.name, description: `${prefix}${tool.description}${tool.writes ? ' (changes the project)' : ''}`, parameters: tool.parameters });
      executor[tool.name] = async (args) => {
        try {
          const result = await tool.handler(args ?? {}, getContext());
          return { ok: true, ...result };
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
      };
    }
  }
  return { declarations, executor };
}

// ------------------------------------------------------------ helpers for handlers

export const str = (args: Record<string, unknown>, key: string, fallback?: string): string => {
  const value = args[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`Parameter "${key}" is required.`);
};

export const numArg = (args: Record<string, unknown>, key: string, fallback?: number): number => {
  const value = typeof args[key] === 'string' ? Number(args[key]) : args[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Parameter "${key}" must be a number.`);
};

export const findClip = (ctx: StudioToolContext, clipId?: unknown): TimelineClip => {
  const state = ctx.getState();
  const id = typeof clipId === 'string' && clipId ? clipId : state.selectedClipId;
  const clip = state.timelineClips.find((entry) => entry.id === id);
  if (!clip) throw new Error(id ? `Clip ${id} not found.` : 'No clip selected; pass clipId.');
  return clip;
};
