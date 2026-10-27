/**
 * Functional node classes on top of the compModel node types. The model has
 * one generic `fx` type (GPU effect stack); views show Grade, Blur and Dot as
 * their own tools. The class is derived from the node (effect id), with an
 * explicit `_class` param as override (underscore params are internal and
 * hidden in inspectors).
 */
import type { CompNode } from './compModel.ts';

export type CompNodeClass = 'media' | 'solid' | 'text' | 'transform' | 'merge' | 'mask' | 'output' | 'grade' | 'blur' | 'dot' | 'fx';

/** Colour page primary grade (registered by the Color package). */
export const GRADE_FX_ID = 'avpe.primary-grade';
/** Small separable Gaussian blur registered by the Fusion page (compFx.ts). */
export const BLUR_FX_ID = 'avpe.comp-blur';

export const CLASS_PARAM = '_class';

export const isInternalParam = (key: string) => key.startsWith('_');

export function nodeClassOf(node: CompNode): CompNodeClass {
  if (node.type !== 'fx') return node.type;
  const explicit = node.params[CLASS_PARAM];
  if (explicit === 'dot' || explicit === 'grade' || explicit === 'blur') return explicit;
  const first = node.fxStack?.[0]?.effectId;
  if (first === GRADE_FX_ID) return 'grade';
  if (first === BLUR_FX_ID) return 'blur';
  return 'fx';
}
