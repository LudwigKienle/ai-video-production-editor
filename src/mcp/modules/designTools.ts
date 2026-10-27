/**
 * MCP tools: Design (Create › Design), the layer canvas for title cards,
 * thumbnails, lower thirds and social covers. Layer edits use the same pure
 * functions as the page (utils/designCanvas.ts) on the project's
 * `designCanvas`; templates, PNG export and AI layers run through the page.
 */
import { guardPaidTools } from '../paidGuard.ts';
import type { DesignCanvasElement, DesignCanvasPreset, DesignCanvasState } from '../../types';
import {
  DESIGN_CANVAS_PRESETS,
  addDesignElement,
  duplicateDesignElement,
  moveDesignElementLayer,
  normalizeDesignState,
  removeDesignElement,
  resizeDesignCanvas,
  updateDesignElement,
} from '../../utils/designCanvas.ts';
import { invokeLiveCommand } from '../liveCommands.ts';
import { findMediaItem, getExtra, setExtra } from '../projectExtras.ts';
import { registerStudioToolModule, str, type StudioToolContext, type StudioToolModule } from '../toolModules.ts';

const PRESETS = Object.keys(DESIGN_CANVAS_PRESETS) as DesignCanvasPreset[];
const TEMPLATES = ['title', 'thumbnail', 'lower-third'];

const designOf = (ctx: StudioToolContext): DesignCanvasState => normalizeDesignState(getExtra(ctx, 'designCanvas'));
const save = (ctx: StudioToolContext, next: DesignCanvasState) => setExtra(ctx, 'designCanvas', next);

const requireElement = (design: DesignCanvasState, elementId: unknown) => {
  const id = typeof elementId === 'string' && elementId ? elementId : design.selectedElementId;
  const element = design.elements.find((entry) => entry.id === id);
  if (!element) throw new Error(id ? `Layer ${id} not found.` : 'No layer selected; pass elementId.');
  return element;
};

/** Layer properties an agent may set (same fields as the Inspector). */
const LAYER_PROPS = {
  name: { type: 'string' as const },
  x: { type: 'number' as const, description: 'Canvas pixels from the left (canvas is e.g. 1920×1080).' },
  y: { type: 'number' as const },
  width: { type: 'number' as const },
  height: { type: 'number' as const },
  rotation: { type: 'number' as const, description: 'Degrees.' },
  opacity: { type: 'number' as const, minimum: 0, maximum: 1 },
  visible: { type: 'boolean' as const },
  locked: { type: 'boolean' as const },
  text: { type: 'string' as const, description: 'Text layers.' },
  fontSize: { type: 'number' as const },
  fontFamily: { type: 'string' as const },
  fontWeight: { type: 'string' as const },
  color: { type: 'string' as const, description: 'Text colour (CSS).' },
  textAlign: { type: 'string' as const, enum: ['left', 'center', 'right'] },
  fill: { type: 'string' as const, description: 'Shape fill (CSS).' },
  stroke: { type: 'string' as const },
  strokeWidth: { type: 'number' as const },
  borderRadius: { type: 'number' as const },
};

const pickLayerProps = (args: Record<string, unknown>): Partial<DesignCanvasElement> => {
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(LAYER_PROPS)) {
    const value = args[key];
    if (value === undefined) continue;
    if (schema.type === 'number') {
      const num = typeof value === 'string' ? Number(value) : value;
      if (typeof num !== 'number' || !Number.isFinite(num)) throw new Error(`${key} must be a number.`);
      out[key] = key === 'opacity' ? Math.min(1, Math.max(0, num)) : num;
    } else if (schema.type === 'boolean') out[key] = value === true;
    else out[key] = String(value);
  }
  return out as Partial<DesignCanvasElement>;
};

const summary = (design: DesignCanvasState) => ({
  name: design.name,
  preset: design.preset,
  width: design.width,
  height: design.height,
  background: design.background,
  selectedElementId: design.selectedElementId,
  layers: [...design.elements].sort((a, b) => b.zIndex - a.zIndex),
});

const openPage = (ctx: StudioToolContext) => ({ openWorkspace: () => ctx.actions.setActiveWorkspace('DESIGN'), workspace: 'DESIGN' as const, timeoutMs: 10000 });

/** Runs a Design page button (live page protocol, waits until the page has re-rendered). */
const pageAction = async (ctx: StudioToolContext, action: string, args: Record<string, unknown>) => {
  const state = (await invokeLiveCommand('design.action', { action, args }, openPage(ctx))) as { result?: Record<string, unknown>; info?: Record<string, unknown> };
  return { ...(state.result ?? {}), status: state.info?.status ?? null };
};

export const DESIGN_TOOL_MODULE: StudioToolModule = {
  id: 'design',
  label: 'Create: Design canvas',
  tools: [
    {
      name: 'design_get',
      description: 'Read the Design canvas: format preset (16:9, 9:16, 1:1, 4:5) and size, background, selected layer and all layers top to bottom (text, shape, image with position, size, style).',
      parameters: { type: 'object', properties: {} },
      handler: (_args, ctx) => ({ ...summary(designOf(ctx)), presets: DESIGN_CANVAS_PRESETS, templates: TEMPLATES }),
    },
    {
      name: 'design_set_canvas',
      description: 'Change the canvas format (layers are scaled along), background colour or name.',
      writes: true,
      parameters: { type: 'object', properties: { preset: { type: 'string', enum: PRESETS }, background: { type: 'string' }, name: { type: 'string' } } },
      handler: (args, ctx) => {
        let design = designOf(ctx);
        if (typeof args.preset === 'string') {
          if (!PRESETS.includes(args.preset as DesignCanvasPreset)) throw new Error(`preset must be one of ${PRESETS.join(', ')}.`);
          design = resizeDesignCanvas(design, args.preset as DesignCanvasPreset);
        }
        if (typeof args.background === 'string') design = { ...design, background: args.background };
        if (typeof args.name === 'string' && args.name.trim()) design = { ...design, name: args.name.trim() };
        save(ctx, design);
        return summary(design);
      },
    },
    {
      name: 'design_add_layer',
      description: 'Add a layer: "text" (Tools › Text), "shape" with shape rect|ellipse (Tools › Rect/Circle) or "image" from the media bin (mediaId, as clicking a project asset). Optional layer properties override the defaults. The new layer is selected.',
      writes: true,
      parameters: {
        type: 'object',
        properties: { type: { type: 'string', enum: ['text', 'shape', 'image'] }, shape: { type: 'string', enum: ['rect', 'ellipse'] }, mediaId: { type: 'string' }, ...LAYER_PROPS },
        required: ['type'],
      },
      handler: (args, ctx) => {
        const design = designOf(ctx);
        const { width: w, height: h } = design;
        const type = str(args, 'type');
        let base: Partial<DesignCanvasElement> & Pick<DesignCanvasElement, 'type'>;
        if (type === 'text') {
          base = { type: 'text', name: 'Headline', text: 'Your title', x: Math.round(w * 0.18), y: Math.round(h * 0.42), width: Math.round(w * 0.64) };
        } else if (type === 'shape') {
          const shape = args.shape === 'ellipse' ? 'ellipse' : 'rect';
          base = {
            type: 'shape', name: shape === 'ellipse' ? 'Ellipse' : 'Rectangle', shape,
            x: Math.round(w * 0.34), y: Math.round(h * 0.36), width: Math.round(w * 0.32), height: Math.round(h * 0.18),
            fill: shape === 'ellipse' ? '#F97316' : '#2563EB', borderRadius: shape === 'ellipse' ? 999 : 16,
          };
        } else if (type === 'image') {
          const item = findMediaItem(ctx, args.mediaId);
          if (item.type !== 'image') throw new Error(`Media item ${item.id} is not an image.`);
          base = { type: 'image', name: item.name || 'Image', mediaId: item.id, imageUrl: item.url, x: Math.round(w * 0.28), y: Math.round(h * 0.22), width: Math.round(w * 0.44), height: Math.round(h * 0.44) };
        } else {
          throw new Error('type must be text, shape or image.');
        }
        const next = addDesignElement(design, { ...base, ...pickLayerProps(args) });
        save(ctx, next);
        return { layer: next.elements.find((element) => element.id === next.selectedElementId) };
      },
    },
    {
      name: 'design_update_layer',
      description: 'Change a layer (selected layer if elementId is omitted): name, position, size, rotation, opacity, visibility, lock, text and font, colours, radius.',
      writes: true,
      parameters: { type: 'object', properties: { elementId: { type: 'string' }, ...LAYER_PROPS } },
      handler: (args, ctx) => {
        const design = designOf(ctx);
        const element = requireElement(design, args.elementId);
        const next = updateDesignElement(design, element.id, pickLayerProps(args));
        save(ctx, next);
        return { layer: next.elements.find((entry) => entry.id === element.id) };
      },
    },
    {
      name: 'design_select_layer',
      description: 'Select a layer (as clicking it in the Layers list); pass null/empty to clear the selection.',
      writes: true,
      parameters: { type: 'object', properties: { elementId: { type: 'string' } } },
      handler: (args, ctx) => {
        const design = designOf(ctx);
        const id = typeof args.elementId === 'string' && args.elementId ? requireElement(design, args.elementId).id : null;
        save(ctx, { ...design, selectedElementId: id, updatedAt: new Date().toISOString() });
        return { selectedElementId: id };
      },
    },
    {
      name: 'design_duplicate_layer',
      description: 'Duplicate a layer (Tools › Duplicate); the copy is offset by 24 px and selected.',
      writes: true,
      parameters: { type: 'object', properties: { elementId: { type: 'string' } } },
      handler: (args, ctx) => {
        const design = designOf(ctx);
        const next = duplicateDesignElement(design, requireElement(design, args.elementId).id);
        save(ctx, next);
        return { layer: next.elements.find((element) => element.id === next.selectedElementId) };
      },
    },
    {
      name: 'design_arrange_layer',
      description: 'Move a layer to the front/back or one step forward/backward.',
      writes: true,
      parameters: { type: 'object', properties: { elementId: { type: 'string' }, direction: { type: 'string', enum: ['front', 'back', 'forward', 'backward'] } }, required: ['direction'] },
      handler: (args, ctx) => {
        const direction = str(args, 'direction') as 'front' | 'back' | 'forward' | 'backward';
        if (!['front', 'back', 'forward', 'backward'].includes(direction)) throw new Error('direction must be front, back, forward or backward.');
        const design = designOf(ctx);
        const next = moveDesignElementLayer(design, requireElement(design, args.elementId).id, direction);
        save(ctx, next);
        return { layers: summary(next).layers.map((layer) => ({ id: layer.id, name: layer.name, zIndex: layer.zIndex })) };
      },
    },
    {
      name: 'design_delete_layer',
      description: 'Delete a layer ("Delete layer").',
      writes: true,
      destructive: true,
      parameters: { type: 'object', properties: { elementId: { type: 'string' } } },
      handler: (args, ctx) => {
        const design = designOf(ctx);
        const element = requireElement(design, args.elementId);
        save(ctx, removeDesignElement(design, element.id));
        return { removed: element.id };
      },
    },
    {
      name: 'design_apply_template',
      description: 'Replace the whole canvas with a template: title card, thumbnail or lower third. All current layers are discarded. Opens the Design page.',
      writes: true,
      destructive: true,
      parameters: { type: 'object', properties: { kind: { type: 'string', enum: TEMPLATES } }, required: ['kind'] },
      handler: async (args, ctx) => {
        return pageAction(ctx, 'apply_template', { kind: str(args, 'kind') });
      },
    },
    {
      name: 'design_export_png',
      description: 'Render the canvas to a PNG in the media bin (Export); sendToTimeline also appends it to the timeline (Timeline button). Opens the Design page.',
      writes: true,
      parameters: { type: 'object', properties: { sendToTimeline: { type: 'boolean' } } },
      handler: async (args, ctx) => pageAction(ctx, 'export_png', { sendToTimeline: args.sendToTimeline === true }),
    },
    {
      name: 'design_generate_layer',
      description: 'Generate an image with Google Imagen in the canvas aspect ratio ("Generate Layer"), add it to the media bin and as a new image layer. Opens the Design page.',
      writes: true,
      cost: 'paid',
      parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
      handler: async (args, ctx) => pageAction(ctx, 'generate_layer', { prompt: str(args, 'prompt') }),
    },
  ],
};

registerStudioToolModule(guardPaidTools(DESIGN_TOOL_MODULE));
