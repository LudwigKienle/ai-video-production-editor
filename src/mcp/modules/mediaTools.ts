/**
 * MCP tools: Media page (import browser). Browse folders, library and project
 * bins, select items, set import options (copy to project folder, new bin,
 * new sequence) and import. UI-local state lives in the Media page and is
 * reached through live commands; the page opens automatically.
 */
import { invokeLiveCommand } from '../liveCommands.ts';
import { registerStudioToolModule, str, type JsonSchema, type StudioToolContext, type StudioToolModule, type StudioToolResult } from '../toolModules.ts';

const live = async (ctx: StudioToolContext, command: string, args: Record<string, unknown> = {}): Promise<StudioToolResult> => {
  const result = await invokeLiveCommand(`media.${command}`, args, {
    openWorkspace: () => ctx.actions.setActiveWorkspace('IMPORT'),
    workspace: 'IMPORT',
  });
  return (result && typeof result === 'object' ? result : { result }) as StudioToolResult;
};

const stringList: JsonSchema = { type: 'array', items: { type: 'string' } };

const importOptionProps: Record<string, JsonSchema> = {
  copyToProject: { type: 'boolean', description: 'Copy files into the project media folder (desktop app with saved project). Default: page setting.' },
  bin: { type: 'string', description: 'Put the imported items into this bin (created if missing). Empty string = no bin.' },
  sequence: { type: 'string', description: 'Create a sequence from the selection: clips are appended to the end of the timeline in order and grouped in bin "Sequenz – <name>". Empty string = off.' },
  sequenceOrder: { type: 'string', enum: ['selection', 'name', 'date'], description: 'Order of the new sequence (default: selection order).' },
  transcribe: { type: 'boolean', description: 'Transcribe video/audio after import (only if the app provides a transcription service).' },
};

export const MEDIA_TOOL_MODULE: StudioToolModule = {
  id: 'media',
  label: 'Media page (import browser)',
  tools: [
    {
      name: 'media_browse_places',
      description: 'Media page places: local folders (home, desktop, downloads, movies …), recent folders, favourites, project bins and counts, plus capabilities (desktopBrowsing, canCopyToProject, canTranscribe).',
      parameters: { type: 'object', properties: {} },
      handler: (_args, ctx) => live(ctx, 'places'),
    },
    {
      name: 'media_browse_list',
      description: 'List a source in the Media page and show it: source "fs" (a folder path, desktop app), "picked" (files chosen in the page), "library" (media of recent projects) or "project" (project media, optionally one bin). Entries carry id (use with media_select / media_import), kind, size, duration, resolution and inProject.',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['fs', 'picked', 'library', 'project'] },
          path: { type: 'string', description: 'Folder path for source "fs" (default: current/last folder).' },
          bin: { type: 'string', description: 'Bin name for source "project".' },
          query: { type: 'string', description: 'Search text (all words must match).' },
          kind: { type: 'string', enum: ['all', 'video', 'image', 'audio'] },
          includeOther: { type: 'boolean', description: 'Also list non-media files.' },
          showHidden: { type: 'boolean' },
          limit: { type: 'integer', minimum: 1, maximum: 2000 },
        },
      },
      handler: (args, ctx) => live(ctx, 'browse', args),
    },
    {
      name: 'media_select',
      description: 'Change the Media page selection (the tray). ids are entry ids from media_browse_list, project media ids, local file paths or URLs. mode: replace (default), add, remove, clear. Selection order is the default sequence order.',
      parameters: { type: 'object', properties: { ids: { ...stringList }, mode: { type: 'string', enum: ['replace', 'add', 'remove', 'clear'] } } },
      handler: (args, ctx) => live(ctx, 'select', args),
    },
    {
      name: 'media_get_state',
      description: 'Read the Media page: current source, selection (in order), focused item with metadata, import options, view settings and the last status message.',
      parameters: { type: 'object', properties: {} },
      handler: (_args, ctx) => live(ctx, 'state'),
    },
    {
      name: 'media_set_import_options',
      description: 'Set the import settings shown on the Media page (copy to project folder, new bin name, new sequence name/order, auto-transcribe).',
      writes: true,
      parameters: { type: 'object', properties: { ...importOptionProps } },
      handler: (args, ctx) => live(ctx, 'setOptions', args),
    },
    {
      name: 'media_import',
      description: 'Import media into the project. Uses ids/paths/urls if given, otherwise the current selection. Options override the page settings for this import. Returns the new media ids, the bin and how many clips were placed on the timeline.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          ids: { ...stringList, description: 'Entry ids from media_browse_list or project media ids.' },
          paths: { ...stringList, description: 'Local file paths (desktop app).' },
          urls: { ...stringList, description: 'https, data or file URLs.' },
          ...importOptionProps,
        },
      },
      handler: (args, ctx) => live(ctx, 'import', args),
    },
    {
      name: 'media_list_project',
      description: 'List the media items of the open project (id, name, type, duration, source, clips on the timeline). Works without opening the Media page.',
      parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['all', 'video', 'image', 'audio'] } } },
      handler: (args, ctx) => {
        const state = ctx.getState();
        const kind = typeof args.kind === 'string' ? args.kind : 'all';
        const usage = new Map<string, number>();
        state.timelineClips.forEach((clip) => usage.set(clip.mediaId, (usage.get(clip.mediaId) ?? 0) + 1));
        const items = state.mediaItems
          .filter((item) => kind === 'all' || item.type === kind)
          .map((item) => ({ mediaId: item.id, name: item.name, type: item.type, duration: item.duration ?? null, source: item.source, generatedBy: item.generatedBy ?? null, clipsOnTimeline: usage.get(item.id) ?? 0 }));
        return { count: items.length, items };
      },
    },
    {
      name: 'media_list_bin',
      description: 'List the bins of the Media page, or the items of one bin (pass bin).',
      parameters: { type: 'object', properties: { bin: { type: 'string' } } },
      handler: (args, ctx) => live(ctx, 'bins', args),
    },
    {
      name: 'media_bin_update',
      description: 'Add or remove project media ids to/from a bin (creates it), rename it, or delete the bin (media stay in the project).',
      writes: true,
      parameters: {
        type: 'object',
        properties: { bin: { type: 'string' }, add: { ...stringList }, remove: { ...stringList }, rename: { type: 'string' }, delete: { type: 'boolean' } },
        required: ['bin'],
      },
      handler: (args, ctx) => { str(args, 'bin'); return live(ctx, 'binUpdate', args); },
    },
    {
      name: 'media_favorites_add',
      description: 'Pin a folder to the Media page favourites (default: the folder currently shown).',
      writes: true,
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
      handler: (args, ctx) => live(ctx, 'favorite', { ...args, action: 'add' }),
    },
    {
      name: 'media_favorites_remove',
      description: 'Remove a folder from the Media page favourites.',
      writes: true,
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      handler: (args, ctx) => live(ctx, 'favorite', { path: str(args, 'path'), action: 'remove' }),
    },
    {
      name: 'media_set_view',
      description: 'Media page view: grid or list, thumbnail size (110–320 px), type filter, sort ("name:asc", "date:desc", "size:desc", "type:asc") and search text.',
      parameters: {
        type: 'object',
        properties: {
          view: { type: 'string', enum: ['grid', 'list'] },
          thumbSize: { type: 'number', minimum: 110, maximum: 320 },
          kind: { type: 'string', enum: ['all', 'video', 'image', 'audio'] },
          sort: { type: 'string' },
          query: { type: 'string' },
        },
      },
      handler: (args, ctx) => live(ctx, 'view', args),
    },
  ],
};

registerStudioToolModule(MEDIA_TOOL_MODULE);
