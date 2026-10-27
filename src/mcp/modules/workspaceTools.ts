/**
 * MCP tools: navigation between pages (sidebar groups Project, Create, Edit,
 * Review, Deliver) and an index of every MCP tool module, so an agent can see
 * which page a tool belongs to and which tools spend credits or delete data.
 */
import type { Workspace } from '../../types';
import { getExtra } from '../projectExtras.ts';
import { createServiceLoader } from '../serviceLoader.ts';
import { listStudioToolModules, registerStudioToolModule, str, type StudioToolModule } from '../toolModules.ts';

type NavGroup = { id: string; name: string; description: string; items: Array<{ id: Workspace; name: string; description: string }> };

export const navigation = createServiceLoader<{ groups: NavGroup[] }>(async () => {
  const nav = await import('../../config/workspaceNav.ts');
  return { groups: nav.WORKSPACE_NAV_GROUPS as unknown as NavGroup[] };
});

/** Tool prefixes per page, so agents find the tools for what they see. */
export const WORKSPACE_TOOL_PREFIXES: Partial<Record<Workspace, string[]>> = {
  PROJECT: ['project_'],
  IMPORT: ['media_'],
  DESIGN: ['design_'],
  IMAGE_GEN: ['image_gen_'],
  VIDEO_GEN: ['video_gen_', 'burst_frame_'],
  NODES: ['nodes_'],
  SET_DESIGN: ['setdesign_'],
  SCENE_MAP: ['scene_map_'],
  WORLD_GEN: ['world_'],
  AVATAR: ['avatar_'],
  SOUND: ['sound_'],
  EDIT: ['timeline_', 'effect_controls_', 'keyframe_', 'fx_', 'ofx_'],
  PHOTO: ['photo_'],
  UPSCALE: ['upscale_'],
  COMPOSITING: ['fusion_', 'ae_', 'nuke_'],
  TRIM: ['cut_'],
  POST: ['color_'],
  ANALYSIS: ['analysis_'],
  REVIEW: ['review_'],
  REQUESTS: ['requests_'],
  EXPORT: ['export_'],
};

const allTools = () => listStudioToolModules().flatMap((module) => module.tools.map((tool) => ({ module, tool })));

export const WORKSPACE_TOOL_MODULE: StudioToolModule = {
  id: 'workspace',
  label: 'Navigation & tool index',
  tools: [
    {
      name: 'workspace_list',
      description: 'List the pages of the editor by sidebar group (Project, Create, Edit, Review, Deliver), which one is open, which ones the current UI mode and role allow, and the MCP tool prefixes that operate each page.',
      parameters: { type: 'object', properties: {} },
      handler: async (_args, ctx) => {
        const { groups } = await navigation.get();
        const allowed = getExtra(ctx, 'allowedWorkspaces');
        const tools = allTools();
        return {
          activeWorkspace: ctx.getState().activeWorkspace,
          uiMode: getExtra(ctx, 'uiMode') ?? null,
          isDirector: getExtra(ctx, 'isDirector') ?? null,
          groups: groups.map((group) => ({
            id: group.id,
            name: group.name,
            pages: group.items.map((item) => {
              const prefixes = WORKSPACE_TOOL_PREFIXES[item.id] ?? [];
              return {
                id: item.id,
                name: item.name,
                description: item.description,
                available: allowed ? allowed.includes(item.id) : true,
                toolPrefixes: prefixes,
                toolCount: tools.filter(({ tool }) => prefixes.some((prefix) => tool.name.startsWith(prefix))).length,
              };
            }),
          })),
        };
      },
    },
    {
      name: 'workspace_open',
      description: 'Open a page (workspace id from workspace_list, e.g. IMAGE_GEN, REVIEW, EXPORT). Pages hidden in the current UI mode or role are refused with the reason.',
      writes: true,
      parameters: { type: 'object', properties: { workspace: { type: 'string' } }, required: ['workspace'] },
      handler: async (args, ctx) => {
        const id = str(args, 'workspace').toUpperCase() as Workspace;
        const { groups } = await navigation.get();
        const known = groups.flatMap((group) => group.items).find((item) => item.id === id);
        if (!known) throw new Error(`Unknown page ${id}. Use workspace_list.`);
        const allowed = getExtra(ctx, 'allowedWorkspaces');
        if (allowed && !allowed.includes(id)) {
          const role = id === 'REVIEW' ? ' The Director page needs the director role.' : id === 'REQUESTS' ? ' The Requests page is for the artist role.' : '';
          throw new Error(`${known.name} is not available in the current UI mode (${getExtra(ctx, 'uiMode') ?? 'unknown'}).${role} Its tools still work without opening it.`);
        }
        ctx.actions.setActiveWorkspace(id);
        return { activeWorkspace: id, name: known.name };
      },
    },
    {
      name: 'workspace_set_ui_mode',
      description: 'Switch the interface mode (Simple = beginner, Standard = advanced, Pro = pro), as the mode switch in the header. Pages like Nodes, World, Avatar, Set Design or Analysis need advanced or pro.',
      writes: true,
      parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['beginner', 'advanced', 'pro'] } }, required: ['mode'] },
      handler: (args, ctx) => {
        const mode = str(args, 'mode');
        if (!['beginner', 'advanced', 'pro'].includes(mode)) throw new Error('mode must be beginner, advanced or pro.');
        ctx.actions.setExtra('uiMode', mode);
        return { uiMode: mode };
      },
    },
    {
      name: 'workspace_list_tools',
      description: 'Index of the MCP tool modules: per module every tool with whether it changes the project, spends provider credits or deletes data. Filter by prefix (e.g. "review_") or show only paid/destructive tools.',
      parameters: {
        type: 'object',
        properties: { prefix: { type: 'string' }, only: { type: 'string', enum: ['paid', 'destructive', 'read'] } },
      },
      handler: (args) => {
        const prefix = typeof args.prefix === 'string' ? args.prefix : '';
        const only = typeof args.only === 'string' ? args.only : '';
        return {
          modules: listStudioToolModules()
            .map((module) => ({
              id: module.id,
              label: module.label,
              tools: module.tools
                .filter((tool) => !prefix || tool.name.startsWith(prefix))
                .filter((tool) => (only === 'paid' ? tool.cost === 'paid' : only === 'destructive' ? Boolean(tool.destructive) : only === 'read' ? !tool.writes && tool.cost !== 'paid' : true))
                .map((tool) => ({ name: tool.name, writes: Boolean(tool.writes), paid: tool.cost === 'paid', destructive: Boolean(tool.destructive) })),
            }))
            .filter((module) => module.tools.length > 0),
        };
      },
    },
  ],
};

registerStudioToolModule(WORKSPACE_TOOL_MODULE);
