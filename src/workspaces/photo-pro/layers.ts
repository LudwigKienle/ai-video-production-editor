/**
 * Photo editor document model: a serialisable layer stack plus a pure reducer.
 *
 * Pixels never live in the model. Raster layers and the selection reference
 * immutable canvases in the pixel store by `pixelKey` (copy-on-write: a paint
 * stroke copies the layer canvas into a new key and commits the new key). That
 * keeps every history state a cheap, plain object.
 */
import type { FxStack } from '../../fx/types';
import type { Adjustment } from './adjustments.ts';
import type { Rect } from './selection.ts';

export type BlendMode =
  | 'normal' | 'darken' | 'multiply' | 'color-burn'
  | 'lighten' | 'screen' | 'color-dodge'
  | 'overlay' | 'soft-light' | 'hard-light'
  | 'difference' | 'exclusion'
  | 'hue' | 'saturation' | 'color' | 'luminosity';

/** German labels in Photoshop's menu order; `group` draws the separators. */
export const BLEND_MODES: Array<{ id: BlendMode; label: string; group: number }> = [
  { id: 'normal', label: 'Normal', group: 0 },
  { id: 'darken', label: 'Abdunkeln', group: 1 },
  { id: 'multiply', label: 'Multiplizieren', group: 1 },
  { id: 'color-burn', label: 'Farbig nachbelichten', group: 1 },
  { id: 'lighten', label: 'Aufhellen', group: 2 },
  { id: 'screen', label: 'Negativ multiplizieren', group: 2 },
  { id: 'color-dodge', label: 'Farbig abwedeln', group: 2 },
  { id: 'overlay', label: 'Ineinanderkopieren', group: 3 },
  { id: 'soft-light', label: 'Weiches Licht', group: 3 },
  { id: 'hard-light', label: 'Hartes Licht', group: 3 },
  { id: 'difference', label: 'Differenz', group: 4 },
  { id: 'exclusion', label: 'Ausschluss', group: 4 },
  { id: 'hue', label: 'Farbton', group: 5 },
  { id: 'saturation', label: 'Sättigung', group: 5 },
  { id: 'color', label: 'Farbe', group: 5 },
  { id: 'luminosity', label: 'Luminanz', group: 5 },
];

/** Canvas 2D composite operation for a blend mode. */
export const blendToComposite = (mode: BlendMode): GlobalCompositeOperation =>
  (mode === 'normal' ? 'source-over' : mode) as GlobalCompositeOperation;

type LayerBase = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0..1 */
  opacity: number;
  blendMode: BlendMode;
};

export type RasterLayer = LayerBase & {
  kind: 'raster';
  pixelKey: string;
  /** Position of the layer canvas in document pixels (Move tool, crop). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Smart filters (Lens & Film FX) rendered on top of the layer pixels. */
  fx: FxStack;
  fxEnabled: boolean;
};

export type TextLayer = LayerBase & {
  kind: 'text';
  text: string;
  /** Top-left of the first line in document pixels. */
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
};

export type AdjustmentLayer = LayerBase & {
  kind: 'adjustment';
  adjustment: Adjustment;
};

export type Layer = RasterLayer | TextLayer | AdjustmentLayer;

export type SelectionRef = { pixelKey: string; bounds: Rect };

export type PhotoDoc = {
  name: string;
  width: number;
  height: number;
  /** Bottom → top. */
  layers: Layer[];
  activeLayerId: string | null;
  selection: SelectionRef | null;
  /** For "Erneut auswählen". */
  lastSelection: SelectionRef | null;
};

export const createDoc = (name: string, width: number, height: number, layers: Layer[] = []): PhotoDoc => ({
  name,
  width,
  height,
  layers,
  activeLayerId: layers.length ? layers[layers.length - 1].id : null,
  selection: null,
  lastSelection: null,
});

const base = (id: string, name: string): LayerBase => ({
  id, name, visible: true, locked: false, opacity: 1, blendMode: 'normal',
});

export const makeRasterLayer = (
  id: string, name: string, pixelKey: string, width: number, height: number, x = 0, y = 0,
): RasterLayer => ({ ...base(id, name), kind: 'raster', pixelKey, x, y, width, height, fx: [], fxEnabled: true });

export const makeTextLayer = (id: string, x: number, y: number, patch: Partial<TextLayer> = {}): TextLayer => ({
  ...base(id, patch.text || 'Text'),
  kind: 'text',
  text: 'Text',
  x,
  y,
  fontSize: 72,
  fontFamily: 'Inter, Helvetica, Arial, sans-serif',
  color: '#ffffff',
  bold: false,
  italic: false,
  align: 'left',
  ...patch,
});

export const makeAdjustmentLayer = (id: string, name: string, adjustment: Adjustment): AdjustmentLayer => ({
  ...base(id, name), kind: 'adjustment', adjustment,
});

export const layerIndex = (doc: PhotoDoc, id: string | null | undefined) =>
  id ? doc.layers.findIndex((layer) => layer.id === id) : -1;

export const getLayer = (doc: PhotoDoc, id: string | null | undefined): Layer | null =>
  doc.layers.find((layer) => layer.id === id) ?? null;

export const getActiveLayer = (doc: PhotoDoc): Layer | null => getLayer(doc, doc.activeLayerId);

/** "Ebene 1", "Ebene 2", … — the next free number for a base name. */
export const nextLayerName = (doc: PhotoDoc, baseName = 'Ebene') => {
  let max = 0;
  const re = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`);
  for (const layer of doc.layers) {
    const m = layer.name.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${baseName} ${max + 1}`;
};

/** Name for a duplicate: "Ebene 1 Kopie", "Ebene 1 Kopie 2", … */
export const copyName = (doc: PhotoDoc, name: string) => {
  const stem = name.replace(/ Kopie(?: \d+)?$/, '');
  const names = new Set(doc.layers.map((layer) => layer.name));
  if (!names.has(`${stem} Kopie`)) return `${stem} Kopie`;
  let n = 2;
  while (names.has(`${stem} Kopie ${n}`)) n += 1;
  return `${stem} Kopie ${n}`;
};

/** Every pixel-store key a document references (used for garbage collection). */
export const docPixelKeys = (doc: PhotoDoc, into = new Set<string>()) => {
  for (const layer of doc.layers) if (layer.kind === 'raster') into.add(layer.pixelKey);
  if (doc.selection) into.add(doc.selection.pixelKey);
  if (doc.lastSelection) into.add(doc.lastSelection.pixelKey);
  return into;
};

export const canMergeDown = (doc: PhotoDoc, id: string | null) => {
  const index = layerIndex(doc, id);
  if (index <= 0) return false;
  return !doc.layers[index].locked && !doc.layers[index - 1].locked;
};

export type DocAction =
  | { type: 'set'; doc: PhotoDoc }
  | { type: 'add'; layer: Layer; index?: number }
  | { type: 'remove'; id: string }
  | { type: 'update'; id: string; patch: Partial<Layer> }
  | { type: 'select'; id: string | null }
  | { type: 'reorder'; id: string; toIndex: number }
  | { type: 'step'; id: string; delta: number }
  | { type: 'duplicate'; id: string; newId: string }
  /** Replace `ids` (contiguous or not) with one layer at the lowest of their positions. */
  | { type: 'replace'; ids: string[]; layer: Layer }
  | { type: 'crop'; rect: Rect }
  | { type: 'expand'; left: number; top: number; right: number; bottom: number }
  | { type: 'selection'; selection: SelectionRef | null }
  | { type: 'rename'; name: string };

const shiftLayer = (layer: Layer, dx: number, dy: number): Layer => {
  if (layer.kind === 'adjustment') return layer;
  return { ...layer, x: layer.x + dx, y: layer.y + dy };
};

/** Pure reducer. Returns the same object when nothing changes. */
export function docReducer(doc: PhotoDoc, action: DocAction): PhotoDoc {
  switch (action.type) {
    case 'set':
      return action.doc;
    case 'rename':
      return action.name === doc.name ? doc : { ...doc, name: action.name };
    case 'add': {
      const activeIndex = layerIndex(doc, doc.activeLayerId);
      const index = action.index ?? (activeIndex >= 0 ? activeIndex + 1 : doc.layers.length);
      const layers = doc.layers.slice();
      layers.splice(Math.max(0, Math.min(layers.length, index)), 0, action.layer);
      return { ...doc, layers, activeLayerId: action.layer.id };
    }
    case 'remove': {
      const index = layerIndex(doc, action.id);
      if (index < 0 || doc.layers[index].locked) return doc;
      const layers = doc.layers.filter((layer) => layer.id !== action.id);
      let activeLayerId = doc.activeLayerId;
      if (activeLayerId === action.id) {
        activeLayerId = layers.length ? layers[Math.max(0, index - 1)].id : null;
      }
      return { ...doc, layers, activeLayerId };
    }
    case 'update': {
      const index = layerIndex(doc, action.id);
      if (index < 0) return doc;
      const current = doc.layers[index];
      const keys = Object.keys(action.patch) as Array<keyof Layer>;
      if (keys.every((key) => (current as any)[key] === (action.patch as any)[key])) return doc;
      const layers = doc.layers.slice();
      layers[index] = { ...current, ...action.patch, kind: current.kind, id: current.id } as Layer;
      return { ...doc, layers };
    }
    case 'select':
      if (action.id !== null && layerIndex(doc, action.id) < 0) return doc;
      return action.id === doc.activeLayerId ? doc : { ...doc, activeLayerId: action.id };
    case 'reorder': {
      const from = layerIndex(doc, action.id);
      if (from < 0) return doc;
      const to = Math.max(0, Math.min(doc.layers.length - 1, action.toIndex));
      if (to === from) return doc;
      const layers = doc.layers.slice();
      const [moved] = layers.splice(from, 1);
      layers.splice(to, 0, moved);
      return { ...doc, layers };
    }
    case 'step': {
      const from = layerIndex(doc, action.id);
      if (from < 0) return doc;
      return docReducer(doc, { type: 'reorder', id: action.id, toIndex: from + action.delta });
    }
    case 'duplicate': {
      const index = layerIndex(doc, action.id);
      if (index < 0) return doc;
      const source = doc.layers[index];
      // Pixel canvases are immutable, so the copy can share the pixel key.
      const copy = { ...source, id: action.newId, name: copyName(doc, source.name), locked: false } as Layer;
      const layers = doc.layers.slice();
      layers.splice(index + 1, 0, copy);
      return { ...doc, layers, activeLayerId: copy.id };
    }
    case 'replace': {
      const ids = new Set(action.ids);
      const indices = doc.layers.map((layer, i) => (ids.has(layer.id) ? i : -1)).filter((i) => i >= 0);
      if (!indices.length) return doc;
      const at = Math.min(...indices);
      const layers: Layer[] = [];
      doc.layers.forEach((layer, i) => {
        if (i === at) layers.push(action.layer);
        else if (!ids.has(layer.id)) layers.push(layer);
      });
      return { ...doc, layers, activeLayerId: action.layer.id };
    }
    case 'crop': {
      const { x, y, width, height } = action.rect;
      const w = Math.round(width);
      const h = Math.round(height);
      if (w <= 0 || h <= 0) return doc;
      const dx = -Math.round(x);
      const dy = -Math.round(y);
      return {
        ...doc,
        width: w,
        height: h,
        layers: doc.layers.map((layer) => shiftLayer(layer, dx, dy)),
        selection: null,
        lastSelection: null,
      };
    }
    case 'expand': {
      const { left, top, right, bottom } = action;
      if (!left && !top && !right && !bottom) return doc;
      return {
        ...doc,
        width: doc.width + left + right,
        height: doc.height + top + bottom,
        layers: doc.layers.map((layer) => shiftLayer(layer, left, top)),
        selection: null,
        lastSelection: doc.selection ?? doc.lastSelection,
      };
    }
    case 'selection': {
      if (action.selection === doc.selection) return doc;
      return {
        ...doc,
        selection: action.selection,
        lastSelection: action.selection ? doc.lastSelection : (doc.selection ?? doc.lastSelection),
      };
    }
    default:
      return doc;
  }
}

/** Short German label of a layer's kind for the Layers panel / Properties header. */
export const layerKindLabel = (layer: Layer) => {
  if (layer.kind === 'raster') return layer.fx.length ? 'Pixelebene mit Smartfiltern' : 'Pixelebene';
  if (layer.kind === 'text') return 'Textebene';
  return 'Einstellungsebene';
};
