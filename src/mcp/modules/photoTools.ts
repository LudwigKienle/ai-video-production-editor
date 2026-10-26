/**
 * MCP tools: Photo editor (PHOTO page). Documents, the layer stack, history
 * and selection live inside the PhotoWorkspace component, so every tool goes
 * through a live command the page registers while it is mounted; the tool
 * opens the PHOTO page first when needed.
 *
 * Layer addressing: `layerId` (from photo_layers_list); omitted = active layer.
 * Stack `index` 0 = bottom layer.
 */
import { createFxInstance, getFxDefinition } from '../../fx/registry.ts';
import { loadOfxDefinitions } from '../../fx/ofx.ts';
import type { FxParamValues } from '../../fx/types.ts';
import { ADJUSTMENT_TYPES, BLEND_MODE_IDS, PHOTO_LIVE, adjustmentFromArgs, parseBlendMode, parseOpacity } from '../../workspaces/photo-pro/mcpModel.ts';
import { invokeLiveCommand } from '../liveCommands.ts';
import { numArg, registerStudioToolModule, str, type JsonSchema, type StudioToolContext, type StudioToolModule } from '../toolModules.ts';

const live = (ctx: StudioToolContext, name: string, args: Record<string, unknown> = {}, timeoutMs = 5000) =>
  invokeLiveCommand(name, args, { openWorkspace: () => ctx.actions.setActiveWorkspace('PHOTO'), workspace: 'PHOTO', timeoutMs }) as Promise<Record<string, unknown>>;

const layerId: JsonSchema = { type: 'string', description: 'Layer id from photo_layers_list (active layer when omitted).' };
const rect: JsonSchema = {
  type: 'object',
  description: 'Rectangle in document pixels.',
  properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
  required: ['x', 'y', 'width', 'height'],
};
const layerFields: Record<string, JsonSchema> = {
  opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Layer opacity 0…1 (values above 1 are read as percent).' },
  blendMode: { type: 'string', enum: BLEND_MODE_IDS, description: 'Blend mode (canvas composite operation).' },
  visible: { type: 'boolean' },
  locked: { type: 'boolean' },
  name: { type: 'string' },
  x: { type: 'number', description: 'Raster/text layer position (document px).' },
  y: { type: 'number' },
};

const fxValues = (raw: unknown): FxParamValues => {
  if (!raw || typeof raw !== 'object') return {};
  const out: FxParamValues = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') out[key] = value;
  }
  return out;
};

const pass = (name: string) => (args: Record<string, unknown>, ctx: StudioToolContext) => live(ctx, name, args);

export const PHOTO_TOOL_MODULE: StudioToolModule = {
  id: 'photo',
  label: 'Photo editor',
  tools: [
    {
      name: 'photo_state',
      description: 'Read the photo editor: open documents, active document (size, selection), active tool, layers and the history list (Protokoll) with the current index.',
      parameters: { type: 'object', properties: {} },
      handler: (_args, ctx) => live(ctx, PHOTO_LIVE.state),
    },
    {
      name: 'photo_open',
      description: 'Open an image as a new document (or place it as a layer with asLayer). Pass mediaId (Media Bin item) or url (https, data or blob URL).',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          mediaId: { type: 'string', description: 'Media Bin item id (image).' },
          url: { type: 'string' },
          name: { type: 'string', description: 'Document/layer name.' },
          asLayer: { type: 'boolean', description: 'Place into the active document as a new layer.' },
        },
      },
      handler: (args, ctx) => {
        let url = typeof args.url === 'string' ? args.url : '';
        let name = typeof args.name === 'string' ? args.name : '';
        if (typeof args.mediaId === 'string' && args.mediaId) {
          const item = ctx.getState().mediaItems.find((entry) => entry.id === args.mediaId);
          if (!item) throw new Error(`Media item ${args.mediaId} not found.`);
          if (item.type !== 'image') throw new Error(`Media item ${item.id} is not an image.`);
          url = item.url;
          name ||= item.name;
        }
        if (!url) throw new Error('Pass mediaId or url.');
        return live(ctx, PHOTO_LIVE.open, { url, name: name || 'Bild.png', asLayer: Boolean(args.asLayer) }, 15000);
      },
    },
    {
      name: 'photo_new_document',
      description: 'Create a new empty document (width × height px, background white, black or transparent).',
      writes: true,
      parameters: {
        type: 'object',
        properties: { width: { type: 'integer', minimum: 1, maximum: 16000 }, height: { type: 'integer', minimum: 1, maximum: 16000 }, background: { type: 'string', description: '"#ffffff", "#000000", any hex colour or "transparent".' }, name: { type: 'string' } },
        required: ['width', 'height'],
      },
      handler: (args, ctx) => live(ctx, PHOTO_LIVE.newDocument, { width: Math.round(numArg(args, 'width')), height: Math.round(numArg(args, 'height')), background: str(args, 'background', '#ffffff'), name: str(args, 'name', 'Unbenannt-1') }),
    },
    {
      name: 'photo_layers_list',
      description: 'List the layers of the active document, top first (id, stack index with 0 = bottom, kind raster/text/adjustment, visibility, lock, opacity, blend mode, smart filters, text or adjustment values).',
      parameters: { type: 'object', properties: {} },
      handler: (_args, ctx) => live(ctx, PHOTO_LIVE.layersList),
    },
    {
      name: 'photo_layer_add',
      description: 'Add a layer above the active one: kind "raster" (empty pixel layer), "text" (text, x, y, fontSize, color, fontFamily, bold, italic, align) or "adjustment" (adjustmentType + values).',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['raster', 'text', 'adjustment'] },
          name: { type: 'string' },
          text: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          fontSize: { type: 'number' },
          fontFamily: { type: 'string' },
          color: { type: 'string', description: 'Hex colour, e.g. #ffffff.' },
          bold: { type: 'boolean' },
          italic: { type: 'boolean' },
          align: { type: 'string', enum: ['left', 'center', 'right'] },
          adjustmentType: { type: 'string', enum: ADJUSTMENT_TYPES },
          values: { type: 'object', description: 'Adjustment values (see photo_adjustment_add).' },
          opacity: layerFields.opacity,
          blendMode: layerFields.blendMode,
        },
        required: ['kind'],
      },
      handler: (args, ctx) => {
        const kind = str(args, 'kind');
        if (!['raster', 'text', 'adjustment'].includes(kind)) throw new Error('kind must be raster, text or adjustment.');
        const payload: Record<string, unknown> = { ...args };
        if (kind === 'adjustment') payload.adjustment = adjustmentFromArgs(args.adjustmentType, args.values);
        if (kind === 'text' && !(typeof args.text === 'string' && args.text.trim())) throw new Error('text is required for a text layer.');
        if (args.opacity !== undefined) payload.opacity = parseOpacity(args.opacity);
        if (args.blendMode !== undefined) payload.blendMode = parseBlendMode(args.blendMode);
        return live(ctx, PHOTO_LIVE.layerAdd, payload);
      },
    },
    {
      name: 'photo_layer_remove',
      description: 'Delete a layer (not when locked).',
      writes: true,
      parameters: { type: 'object', properties: { layerId } },
      handler: pass(PHOTO_LIVE.layerRemove),
    },
    {
      name: 'photo_layer_reorder',
      description: 'Move a layer in the stack: index (0 = bottom) or delta (+1 = one step up).',
      writes: true,
      parameters: { type: 'object', properties: { layerId, index: { type: 'integer', minimum: 0 }, delta: { type: 'integer' } } },
      handler: (args, ctx) => {
        if (args.index === undefined && args.delta === undefined) throw new Error('Pass index or delta.');
        return live(ctx, PHOTO_LIVE.layerReorder, args);
      },
    },
    {
      name: 'photo_layer_set',
      description: 'Change layer properties: opacity, blendMode, visible, locked, name, x/y; text layers also text, fontSize, fontFamily, color, bold, italic, align; adjustment layers `adjustment` values; raster layers smartFiltersEnabled. select: true makes it the active layer.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          layerId,
          ...layerFields,
          select: { type: 'boolean' },
          text: { type: 'string' },
          fontSize: { type: 'number' },
          fontFamily: { type: 'string' },
          color: { type: 'string' },
          bold: { type: 'boolean' },
          italic: { type: 'boolean' },
          align: { type: 'string', enum: ['left', 'center', 'right'] },
          adjustment: { type: 'object', description: 'Adjustment values to merge (see photo_adjustment_add).' },
          smartFiltersEnabled: { type: 'boolean' },
        },
      },
      handler: pass(PHOTO_LIVE.layerSet),
    },
    {
      name: 'photo_adjustment_add',
      description: 'Add a non-destructive adjustment layer above the active layer. Types and values: brightnessContrast {brightness −150…150, contrast −50…100}, hueSaturation {hue −180…180, saturation/lightness −100…100}, exposure {exposure −5…5 stops, offset −0.5…0.5, gamma 0.01…9.99}, curves {points [[x,y],…] 0…255}, colorBalance {shadows/midtones/highlights [cyan-red, magenta-green, yellow-blue] −100…100, preserveLuminosity}, invert {}, look {brightness/contrast/saturate % 50…150, hue °, blur px}.',
      writes: true,
      parameters: {
        type: 'object',
        properties: { type: { type: 'string', enum: ADJUSTMENT_TYPES }, values: { type: 'object' }, opacity: layerFields.opacity, blendMode: layerFields.blendMode, name: { type: 'string' } },
        required: ['type'],
      },
      handler: (args, ctx) => {
        const adjustment = adjustmentFromArgs(args.type, args.values);
        return live(ctx, PHOTO_LIVE.adjustmentAdd, {
          adjustment,
          name: typeof args.name === 'string' ? args.name : undefined,
          opacity: args.opacity !== undefined ? parseOpacity(args.opacity) : undefined,
          blendMode: args.blendMode !== undefined ? parseBlendMode(args.blendMode) : undefined,
        });
      },
    },
    {
      name: 'photo_smart_filter_add',
      description: 'Add a Lens & Film FX effect as a smart filter to a raster layer (e.g. effectId "buckswood-post-plugins.optics-lab", preset id from fx_list_effects, params overrides, mix 0…1). Rendered live on the GPU and in exports.',
      writes: true,
      parameters: {
        type: 'object',
        properties: { layerId, effectId: { type: 'string' }, preset: { type: 'string' }, params: { type: 'object' }, mix: { type: 'number', minimum: 0, maximum: 1 } },
        required: ['effectId'],
      },
      handler: async (args, ctx) => {
        const effectId = str(args, 'effectId');
        if (effectId.startsWith('ofx:')) await loadOfxDefinitions();
        const definition = getFxDefinition(effectId);
        if (!definition) throw new Error(`Unknown effect ${effectId}.`);
        const preset = typeof args.preset === 'string' ? definition.presets?.find((entry) => entry.id === args.preset) : undefined;
        if (typeof args.preset === 'string' && !preset) throw new Error(`Unknown preset ${args.preset}.`);
        const instance = createFxInstance(effectId, { ...(preset?.values ?? {}), ...fxValues(args.params) });
        if (args.mix !== undefined) instance.mix = Math.min(1, Math.max(0, numArg(args, 'mix')));
        return live(ctx, PHOTO_LIVE.smartFilterAdd, { layerId: args.layerId, instance, effectName: definition.name });
      },
    },
    {
      name: 'photo_smart_filter_remove',
      description: 'Remove a smart filter (instanceId from photo_layers_list) from a raster layer.',
      writes: true,
      parameters: { type: 'object', properties: { layerId, instanceId: { type: 'string' } }, required: ['instanceId'] },
      handler: pass(PHOTO_LIVE.smartFilterRemove),
    },
    {
      name: 'photo_smart_filter_apply',
      description: 'Bake the smart filters of a raster layer into its pixels ("Effekte ins Bild übernehmen").',
      writes: true,
      parameters: { type: 'object', properties: { layerId } },
      handler: (args, ctx) => live(ctx, PHOTO_LIVE.smartFilterApply, args, 30000),
    },
    {
      name: 'photo_selection_set',
      description: 'Change the selection: mode "all", "none", "invert", "reselect", "rect" / "ellipse" (rect required, combine new/add/subtract/intersect, feather px) or "subject" (AI subject selection via Replicate, spends credits).',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['all', 'none', 'invert', 'reselect', 'rect', 'ellipse', 'subject'] },
          rect,
          combine: { type: 'string', enum: ['new', 'add', 'subtract', 'intersect'] },
          feather: { type: 'number', minimum: 0 },
        },
        required: ['mode'],
      },
      handler: (args, ctx) => {
        const mode = str(args, 'mode');
        if ((mode === 'rect' || mode === 'ellipse') && !args.rect) throw new Error('rect is required for rect/ellipse selections.');
        return live(ctx, PHOTO_LIVE.selectionSet, args, mode === 'subject' ? 120000 : 5000);
      },
    },
    {
      name: 'photo_generative_fill',
      description: 'Generative fill of the current selection (or heal: true to reconstruct it) with Nano Banana Pro / Nano Banana 2 (FAL) / Flux 2 Pro / Z-Turbo; the result is added as a new layer clipped to the selection. expandPadding > 0 first grows the canvas and fills the new border. Spends provider credits.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          heal: { type: 'boolean' },
          model: { type: 'string', enum: ['nano-banana-pro', 'nano-banana-2-fal', 'flux-2-pro', 'z-turbo-inpaint'] },
          expandPadding: { type: 'integer', minimum: 0 },
        },
      },
      handler: (args, ctx) => live(ctx, PHOTO_LIVE.generativeFill, args, 300000),
    },
    {
      name: 'photo_crop',
      description: 'Crop the document to rect (document px) or to the selection bounds (toSelection: true).',
      writes: true,
      parameters: { type: 'object', properties: { rect, toSelection: { type: 'boolean' } } },
      handler: (args, ctx) => {
        if (!args.rect && !args.toSelection) throw new Error('Pass rect or toSelection: true.');
        return live(ctx, PHOTO_LIVE.crop, args);
      },
    },
    {
      name: 'photo_merge_down',
      description: 'Merge the layer (active when omitted) into the layer below ("Auf eine Ebene reduzieren").',
      writes: true,
      parameters: { type: 'object', properties: { layerId } },
      handler: (args, ctx) => live(ctx, PHOTO_LIVE.mergeDown, args, 30000),
    },
    {
      name: 'photo_flatten',
      description: 'Flatten the image onto a white background layer, or merge only the visible layers (visibleOnly: true).',
      writes: true,
      parameters: { type: 'object', properties: { visibleOnly: { type: 'boolean' } } },
      handler: (args, ctx) => live(ctx, PHOTO_LIVE.flatten, args, 30000),
    },
    {
      name: 'photo_history_undo',
      description: 'Step back in the history (Protokoll) by steps (default 1).',
      writes: true,
      parameters: { type: 'object', properties: { steps: { type: 'integer', minimum: 1 } } },
      handler: pass(PHOTO_LIVE.historyUndo),
    },
    {
      name: 'photo_history_redo',
      description: 'Step forward in the history by steps (default 1).',
      writes: true,
      parameters: { type: 'object', properties: { steps: { type: 'integer', minimum: 1 } } },
      handler: pass(PHOTO_LIVE.historyRedo),
    },
    {
      name: 'photo_history_jump',
      description: 'Jump to a history state by index (0 = opened document), like clicking an entry in the Protokoll panel.',
      writes: true,
      parameters: { type: 'object', properties: { index: { type: 'integer', minimum: 0 } }, required: ['index'] },
      handler: (args, ctx) => live(ctx, PHOTO_LIVE.historyJump, { index: Math.round(numArg(args, 'index')) }),
    },
    {
      name: 'photo_export_to_media',
      description: 'Flatten the active document (layers, adjustments and smart filters at full resolution) and save it as a PNG into the Media Bin. Returns the media item id.',
      writes: true,
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'File name for the Media Bin item.' } } },
      handler: (args, ctx) => live(ctx, PHOTO_LIVE.exportToMedia, args, 60000),
    },
  ],
};

registerStudioToolModule(PHOTO_TOOL_MODULE);
