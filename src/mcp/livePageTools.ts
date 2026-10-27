/**
 * Builds MCP tools for a live page (see livePage.ts): `<prefix>get_state`,
 * `<prefix>set` and one tool per button/action. Tools open the page when it
 * is not mounted, so the user sees what the agent does.
 */
import type { MediaItem, Workspace } from '../types';
import { invokeLiveCommand } from './liveCommands.ts';
import { CONFIRM_PROP, requireConfirm } from './paidGuard.ts';
import type { JsonSchema, StudioTool, StudioToolContext, StudioToolModule } from './toolModules.ts';

export type LivePageActionDoc = {
  /** Tool name without prefix, e.g. "generate". */
  name: string;
  /** Action key on the page (defaults to name). */
  action?: string;
  description: string;
  parameters?: Record<string, JsonSchema>;
  required?: string[];
  writes?: boolean;
  cost?: 'paid';
  destructive?: boolean;
  /** Returns the media items the action added; fails with the page status if none. */
  producesMedia?: boolean;
};

export type LivePageModuleDoc = {
  id: string;
  label: string;
  prefix: string;
  ns: string;
  workspace: Workspace;
  pageName: string;
  /** Short description of the settings an agent can pass (keys and meaning). */
  settingsHelp: string;
  /** How to bring the page part up when it is not mounted (default: open `workspace`). */
  open?: (ctx: StudioToolContext) => void;
  actions: LivePageActionDoc[];
};

const MOUNT_TIMEOUT_MS = 10000;

type LiveState = { settings?: Record<string, unknown>; info?: Record<string, unknown>; result?: unknown };

export function createLivePageModule(doc: LivePageModuleDoc): StudioToolModule {
  const open = (ctx: StudioToolContext) => ({
    openWorkspace: () => {
      const allowed = ctx.getState().extras.allowedWorkspaces as Workspace[] | undefined;
      if (allowed && !allowed.includes(doc.workspace)) {
        throw new Error(`The ${doc.pageName} page is not available in the current UI mode (${String(ctx.getState().extras.uiMode ?? 'unknown')}). Switch with workspace_set_ui_mode (e.g. "pro") first.`);
      }
      if (doc.open) doc.open(ctx);
      else ctx.actions.setActiveWorkspace(doc.workspace);
    },
    workspace: doc.workspace,
    timeoutMs: MOUNT_TIMEOUT_MS,
  });
  const settingsSchema: JsonSchema = { type: 'object', description: `Page settings to apply first. ${doc.settingsHelp}` };

  const tools: StudioTool[] = [
    {
      name: `${doc.prefix}get_state`,
      description: `Read the ${doc.pageName} page: all settings (${doc.settingsHelp}) plus status, jobs, results and the option catalogs (models, presets …). Opens the page.`,
      parameters: { type: 'object', properties: {} },
      handler: async (_args, ctx) => (await invokeLiveCommand(`${doc.ns}.get`, {}, open(ctx))) as Record<string, unknown>,
    },
    {
      name: `${doc.prefix}set`,
      description: `Change settings on the ${doc.pageName} page without running anything. ${doc.settingsHelp}`,
      writes: true,
      parameters: { type: 'object', properties: { settings: settingsSchema }, required: ['settings'] },
      handler: async (args, ctx) => (await invokeLiveCommand(`${doc.ns}.set`, { settings: args.settings }, open(ctx))) as Record<string, unknown>,
    },
  ];

  for (const action of doc.actions) {
    tools.push({
      name: `${doc.prefix}${action.name}`,
      description: `${action.description} Runs the same handler as the ${doc.pageName} page button (opens the page).${action.cost === 'paid' ? ' Spends credits: requires confirm: true.' : ''}`,
      writes: action.writes ?? true,
      cost: action.cost,
      destructive: action.destructive,
      parameters: {
        type: 'object',
        properties: { ...(action.parameters ?? {}), settings: settingsSchema, ...(action.cost === 'paid' ? CONFIRM_PROP : {}) },
        ...(action.required?.length ? { required: action.required } : {}),
      },
      handler: async (args, ctx) => {
        if (action.cost === 'paid') requireConfirm(args, `${doc.prefix}${action.name}`);
        const { settings, confirm: _confirm, ...rest } = args;
        const before = new Set(ctx.getState().mediaItems.map((item) => item.id));
        const state = (await invokeLiveCommand(`${doc.ns}.action`, { action: action.action ?? action.name, args: rest, settings }, open(ctx))) as LiveState;
        if (!action.producesMedia) return state as Record<string, unknown>;
        const added = ctx.getState().mediaItems.filter((item: MediaItem) => !before.has(item.id));
        if (added.length === 0) {
          const status = state.info?.status;
          throw new Error(typeof status === 'string' && status ? status : 'Nothing was generated.');
        }
        return {
          mediaItems: added.map(({ id, name, type, url, duration, generatedBy, prompt }) => ({ id, name, type, url, duration, generatedBy, prompt })),
          info: state.info,
        };
      },
    });
  }

  return { id: doc.id, label: doc.label, tools };
}
