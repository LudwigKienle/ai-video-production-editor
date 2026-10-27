/**
 * MCP bridge for the photo editor (pure part): live-command names, JSON
 * descriptions of documents/layers and validated argument → patch mapping.
 * The PhotoWorkspace registers the live commands; src/mcp/modules/photoTools.ts
 * exposes them as `photo_*` tools.
 */
import { ADJUSTMENT_LABELS, defaultAdjustment } from './adjustments.ts';
import type { Adjustment, AdjustmentType } from './adjustments.ts';
import { BLEND_MODES } from './layers.ts';
import type { BlendMode, Layer, PhotoDoc } from './layers.ts';

export const PHOTO_LIVE = {
  state: 'photo.state',
  open: 'photo.open',
  newDocument: 'photo.document.new',
  layersList: 'photo.layers.list',
  layerAdd: 'photo.layer.add',
  layerRemove: 'photo.layer.remove',
  layerReorder: 'photo.layer.reorder',
  layerSet: 'photo.layer.set',
  adjustmentAdd: 'photo.adjustment.add',
  smartFilterAdd: 'photo.smartFilter.add',
  smartFilterRemove: 'photo.smartFilter.remove',
  smartFilterApply: 'photo.smartFilter.apply',
  selectionSet: 'photo.selection.set',
  generativeFill: 'photo.generative.fill',
  crop: 'photo.crop',
  mergeDown: 'photo.merge.down',
  flatten: 'photo.flatten',
  historyUndo: 'photo.history.undo',
  historyRedo: 'photo.history.redo',
  historyJump: 'photo.history.jump',
  exportToMedia: 'photo.export.media',
} as const;

export const ADJUSTMENT_TYPES = Object.keys(ADJUSTMENT_LABELS) as AdjustmentType[];
export const BLEND_MODE_IDS = BLEND_MODES.map((mode) => mode.id);

export function describeLayer(layer: Layer, index: number) {
  const base = {
    id: layer.id,
    index,
    name: layer.name,
    kind: layer.kind,
    visible: layer.visible,
    locked: layer.locked,
    opacity: Math.round(layer.opacity * 1000) / 1000,
    blendMode: layer.blendMode,
  };
  if (layer.kind === 'raster') {
    return {
      ...base,
      x: layer.x, y: layer.y, width: layer.width, height: layer.height,
      smartFilters: layer.fx.map((fx) => ({ id: fx.id, effectId: fx.effectId, enabled: fx.enabled, mix: fx.mix ?? 1 })),
      smartFiltersEnabled: layer.fxEnabled,
    };
  }
  if (layer.kind === 'text') {
    return { ...base, text: layer.text, x: layer.x, y: layer.y, fontSize: layer.fontSize, fontFamily: layer.fontFamily, color: layer.color, bold: layer.bold, italic: layer.italic, align: layer.align };
  }
  return { ...base, adjustment: layer.adjustment, adjustmentLabel: ADJUSTMENT_LABELS[layer.adjustment.type] };
}

/** Layers top → bottom (like the Layers panel); `index` is the stack index (0 = bottom). */
export const describeLayers = (doc: PhotoDoc) => doc.layers.map(describeLayer).reverse();

export function describeDoc(doc: PhotoDoc) {
  return {
    name: doc.name,
    width: doc.width,
    height: doc.height,
    activeLayerId: doc.activeLayerId,
    layerCount: doc.layers.length,
    selection: doc.selection ? { bounds: doc.selection.bounds } : null,
  };
}

const num = (value: unknown, label: string) => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number.`);
  return n;
};

/** Opacity accepts 0…1, or 0…100 (percent) when the value is above 1. */
export const parseOpacity = (value: unknown) => {
  const n = num(value, 'opacity');
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
};

export function parseBlendMode(value: unknown): BlendMode {
  const mode = String(value).toLowerCase().replace(/[_\s]/g, '-');
  const hit = BLEND_MODES.find((entry) => entry.id === mode || entry.label.toLowerCase() === String(value).toLowerCase());
  if (!hit) throw new Error(`Unknown blend mode "${String(value)}". Use one of: ${BLEND_MODE_IDS.join(', ')}.`);
  return hit.id;
}

/** Merge user values into an adjustment of `type` (unknown keys are ignored). */
export function adjustmentFromArgs(type: unknown, values: unknown, base?: Adjustment): Adjustment {
  const t = String(type) as AdjustmentType;
  if (!ADJUSTMENT_TYPES.includes(t)) throw new Error(`Unknown adjustment type "${String(type)}". Use one of: ${ADJUSTMENT_TYPES.join(', ')}.`);
  const out = { ...(base && base.type === t ? base : defaultAdjustment(t)) } as Record<string, unknown>;
  if (values && typeof values === 'object') {
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      if (key === 'type' || !(key in out)) continue;
      const current = out[key];
      if (typeof current === 'number') out[key] = num(value, key);
      else if (typeof current === 'boolean') out[key] = Boolean(value);
      else if (Array.isArray(current) && Array.isArray(value)) {
        if (key === 'points') {
          out[key] = (value as unknown[]).map((p) => {
            if (!Array.isArray(p) || p.length < 2) throw new Error('curves points must be [[x, y], …] (0…255).');
            return [num(p[0], 'x'), num(p[1], 'y')];
          });
        } else {
          if (value.length !== 3) throw new Error(`${key} must be [r, g, b].`);
          out[key] = (value as unknown[]).map((v) => num(v, key));
        }
      }
    }
  }
  return out as Adjustment;
}

const TEXT_KEYS = ['text', 'fontSize', 'fontFamily', 'color', 'bold', 'italic', 'align'] as const;

/** Validated layer patch from MCP args (opacity, blendMode, visible, locked, name, x, y, text props, adjustment). */
export function layerPatchFromArgs(layer: Layer, args: Record<string, unknown>): Partial<Layer> {
  const patch: Record<string, unknown> = {};
  if (args.opacity !== undefined) patch.opacity = parseOpacity(args.opacity);
  if (args.blendMode !== undefined) patch.blendMode = parseBlendMode(args.blendMode);
  if (typeof args.visible === 'boolean') patch.visible = args.visible;
  if (typeof args.locked === 'boolean') patch.locked = args.locked;
  if (typeof args.name === 'string' && args.name.trim()) patch.name = args.name.trim();
  if (layer.kind !== 'adjustment') {
    if (args.x !== undefined) patch.x = Math.round(num(args.x, 'x'));
    if (args.y !== undefined) patch.y = Math.round(num(args.y, 'y'));
  }
  if (layer.kind === 'text') {
    for (const key of TEXT_KEYS) {
      if (args[key] === undefined) continue;
      if (key === 'fontSize') patch.fontSize = Math.max(1, num(args.fontSize, 'fontSize'));
      else if (key === 'bold' || key === 'italic') patch[key] = Boolean(args[key]);
      else if (key === 'align') {
        if (!['left', 'center', 'right'].includes(String(args.align))) throw new Error('align must be left, center or right.');
        patch.align = args.align;
      } else patch[key] = String(args[key]);
    }
  } else if (TEXT_KEYS.some((key) => args[key] !== undefined && key !== 'color')) {
    throw new Error(`Layer ${layer.id} is not a text layer.`);
  }
  if (layer.kind === 'raster' && typeof args.smartFiltersEnabled === 'boolean') patch.fxEnabled = args.smartFiltersEnabled;
  if (args.adjustment !== undefined) {
    if (layer.kind !== 'adjustment') throw new Error(`Layer ${layer.id} is not an adjustment layer.`);
    patch.adjustment = adjustmentFromArgs(layer.adjustment.type, args.adjustment, layer.adjustment);
  }
  if (layer.locked && Object.keys(patch).some((key) => key !== 'locked' && key !== 'visible')) {
    throw new Error(`Layer ${layer.id} is locked (set locked: false first).`);
  }
  return patch as Partial<Layer>;
}

/** Resolve a layer by id, or the active layer when omitted. */
export function resolveLayer(doc: PhotoDoc, layerId: unknown): Layer {
  const id = typeof layerId === 'string' && layerId ? layerId : doc.activeLayerId;
  const layer = doc.layers.find((entry) => entry.id === id);
  if (!layer) throw new Error(id ? `Layer ${id} not found.` : 'No active layer.');
  return layer;
}
