/**
 * Node catalogue for the Fusion and Nuke views: each entry builds a compModel
 * node. Effect stacks come from an injected factory so this module stays pure
 * (the registry lives in src/fx).
 */
import type { CompNode, CompNodeType, Composition } from './compModel.ts';
import { createNode } from './compModel.ts';
import { uniqueNodeName } from './compModelExt.ts';
import type { FxStack } from '../../fx/types.ts';
import { CLASS_PARAM, type CompNodeClass } from './nodeClass.ts';

export type FxKind = 'grade' | 'blur' | 'any';

export type ToolBuildContext = {
  /** Effect stack for fx-based tools (null → leave empty). */
  fxStack(kind: FxKind): FxStack | null;
  /** Media for MediaIn / Read when nothing else is chosen. */
  defaultMediaId?: string | null;
};

export type ToolDef = {
  id: string;
  /** Name shown in menus and the toolbar. */
  label: string;
  /** Abbreviation (Fusion toolbar tile / Nuke hotkey hint). */
  short: string;
  /** Base for the node name (Merge → Merge1). */
  nameBase: string;
  type: CompNodeType;
  cls: CompNodeClass;
  keywords: string[];
  description: string;
  params?: CompNode['params'];
  fx?: FxKind;
  /** Mask tools attach to a merge's mask input instead of the main pipe. */
  mask?: boolean;
};

const tool = (def: ToolDef) => def;

/** Fusion-page tool set (names follow the Fusion vocabulary, descriptions German). */
export const FUSION_TOOLS: ToolDef[] = [
  tool({ id: 'Background', label: 'Background', short: 'Bg', nameBase: 'Background', type: 'solid', cls: 'solid', keywords: ['farbe', 'fläche', 'solid', 'hintergrund', 'color'], description: 'Farbfläche' }),
  tool({ id: 'TextPlus', label: 'Text+', short: 'Txt+', nameBase: 'Text', type: 'text', cls: 'text', keywords: ['text', 'titel', 'title', 'schrift'], description: 'Text-Generator' }),
  tool({ id: 'Merge', label: 'Merge', short: 'Mrg', nameBase: 'Merge', type: 'merge', cls: 'merge', keywords: ['composite', 'over', 'mischen', 'blend', 'zusammenfügen'], description: 'Vordergrund über Hintergrund' }),
  tool({ id: 'Transform', label: 'Transform', short: 'Xf', nameBase: 'Transform', type: 'transform', cls: 'transform', keywords: ['position', 'move', 'scale', 'rotate', 'größe', 'drehen'], description: 'Position, Größe, Drehung' }),
  tool({ id: 'EllipseMask', label: 'Ellipse', short: 'Elp', nameBase: 'Ellipse', type: 'mask', cls: 'mask', keywords: ['mask', 'maske', 'kreis', 'circle', 'oval'], description: 'Elliptische Maske', params: { shape: 'ellipse' }, mask: true }),
  tool({ id: 'RectangleMask', label: 'Rectangle', short: 'Rct', nameBase: 'Rectangle', type: 'mask', cls: 'mask', keywords: ['mask', 'maske', 'rechteck', 'box', 'polygon'], description: 'Rechteckige Maske', params: { shape: 'rectangle', w: 0.6, h: 0.4 }, mask: true }),
  tool({ id: 'ColorCorrector', label: 'Color Corrector', short: 'CC', nameBase: 'ColorCorrector', type: 'fx', cls: 'grade', keywords: ['grade', 'farbe', 'korrektur', 'color', 'primary'], description: 'Farbkorrektur (GPU)', fx: 'grade', params: { [CLASS_PARAM]: 'grade' } }),
  tool({ id: 'Blur', label: 'Blur', short: 'Blur', nameBase: 'Blur', type: 'fx', cls: 'blur', keywords: ['weichzeichner', 'unschärfe', 'gaussian', 'soft'], description: 'Weichzeichner (GPU)', fx: 'blur', params: { [CLASS_PARAM]: 'blur' } }),
  tool({ id: 'FX', label: 'GPU-Effekt', short: 'FX', nameBase: 'FX', type: 'fx', cls: 'fx', keywords: ['effekt', 'effect', 'plugin', 'ofx', 'Buckswood Post Plugins', 'lens', 'film'], description: 'Beliebiger GPU-Effekt', fx: 'any' }),
  tool({ id: 'MediaIn', label: 'MediaIn', short: 'MI', nameBase: 'MediaIn', type: 'media', cls: 'media', keywords: ['loader', 'read', 'clip', 'medien', 'bild', 'video'], description: 'Medien aus dem Projekt' }),
  tool({ id: 'MediaOut', label: 'MediaOut', short: 'MO', nameBase: 'MediaOut', type: 'output', cls: 'output', keywords: ['saver', 'output', 'ausgabe', 'write'], description: 'Ausgabe der Komposition' }),
];

/** Nuke-view node classes (Nuke vocabulary; Grade = colour page primary grade). */
export const NUKE_TOOLS: ToolDef[] = [
  tool({ id: 'Read', label: 'Read', short: 'R', nameBase: 'Read', type: 'media', cls: 'media', keywords: ['loader', 'mediain', 'clip', 'footage', 'medien'], description: 'Medien lesen' }),
  tool({ id: 'Constant', label: 'Constant', short: 'Const', nameBase: 'Constant', type: 'solid', cls: 'solid', keywords: ['solid', 'background', 'farbe', 'color'], description: 'Konstante Farbe' }),
  tool({ id: 'Text', label: 'Text', short: 'Txt', nameBase: 'Text', type: 'text', cls: 'text', keywords: ['titel', 'title', 'schrift'], description: 'Text' }),
  tool({ id: 'Merge', label: 'Merge', short: 'M', nameBase: 'Merge', type: 'merge', cls: 'merge', keywords: ['over', 'composite', 'plus', 'screen', 'mischen'], description: 'A über B' }),
  tool({ id: 'Transform', label: 'Transform', short: 'T', nameBase: 'Transform', type: 'transform', cls: 'transform', keywords: ['translate', 'scale', 'rotate', 'position'], description: 'Transformieren' }),
  tool({ id: 'Grade', label: 'Grade', short: 'G', nameBase: 'Grade', type: 'fx', cls: 'grade', keywords: ['color', 'farbe', 'lift', 'gamma', 'gain', 'primary'], description: 'Farbkorrektur (GPU)', fx: 'grade', params: { [CLASS_PARAM]: 'grade' } }),
  tool({ id: 'Blur', label: 'Blur', short: 'B', nameBase: 'Blur', type: 'fx', cls: 'blur', keywords: ['weichzeichner', 'defocus', 'gaussian', 'soft'], description: 'Weichzeichner (GPU)', fx: 'blur', params: { [CLASS_PARAM]: 'blur' } }),
  tool({ id: 'Radial', label: 'Radial', short: 'Rad', nameBase: 'Radial', type: 'mask', cls: 'mask', keywords: ['roto', 'mask', 'ellipse', 'maske', 'kreis'], description: 'Elliptische Maske', params: { shape: 'ellipse' }, mask: true }),
  tool({ id: 'Rectangle', label: 'Rectangle', short: 'Rect', nameBase: 'Rectangle', type: 'mask', cls: 'mask', keywords: ['roto', 'mask', 'maske', 'box'], description: 'Rechteckige Maske', params: { shape: 'rectangle', w: 0.6, h: 0.4 }, mask: true }),
  tool({ id: 'OFX', label: 'GPU-Effekt', short: 'FX', nameBase: 'Effect', type: 'fx', cls: 'fx', keywords: ['ofx', 'plugin', 'effect', 'effekt', 'Buckswood Post Plugins', 'lens', 'film'], description: 'Beliebiger GPU-Effekt', fx: 'any' }),
  tool({ id: 'Dot', label: 'Dot', short: '.', nameBase: 'Dot', type: 'fx', cls: 'dot', keywords: ['route', 'elbow', 'punkt', 'umleiten'], description: 'Leitungspunkt', params: { [CLASS_PARAM]: 'dot' } }),
  tool({ id: 'Write', label: 'Write', short: 'W', nameBase: 'Write', type: 'output', cls: 'output', keywords: ['output', 'saver', 'mediaout', 'render', 'ausgabe'], description: 'Ausgabe der Komposition' }),
];

/** Builds the node for a tool. Output tools return null (one output per comp). */
export function buildToolNode(def: ToolDef, comp: Composition, ctx: ToolBuildContext, pos: { x: number; y: number }): CompNode | null {
  if (def.type === 'output') return null;
  const stack = def.fx ? ctx.fxStack(def.fx) : null;
  return createNode(def.type, {
    name: uniqueNodeName(comp, def.nameBase),
    x: pos.x,
    y: pos.y,
    params: { ...(def.params ?? {}) },
    mediaId: def.type === 'media' ? ctx.defaultMediaId ?? undefined : undefined,
    fxStack: def.type === 'fx' ? stack ?? [] : undefined,
  });
}
