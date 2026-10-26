/**
 * Nuke-view vocabulary on top of the shared composition model.
 *
 * Merge: A = foreground (`fg`), B = background (`bg`, the main pipe), mask =
 * `mask`. "A over B" is the default operation. Classes map onto compModel
 * node types (Read = media, Write = output, Grade/Blur/Dot = fx nodes).
 */
import type { CompBlendMode, CompNode } from '../fusion-shared/compModel.ts';
import { nodeClassOf, type CompNodeClass } from '../fusion-shared/nodeClass.ts';

export type NukeInputLabel = 'A' | 'B' | 'mask' | '';

export const NUKE_MERGE_PORTS: Record<'A' | 'B' | 'mask', string> = { A: 'fg', B: 'bg', mask: 'mask' };

export const nukePortFor = (label: 'A' | 'B' | 'mask') => NUKE_MERGE_PORTS[label];

export function nukeLabelForPort(node: CompNode, port: string): NukeInputLabel {
  if (node.type !== 'merge') return port === 'input' ? '' : (port as NukeInputLabel);
  if (port === 'fg') return 'A';
  if (port === 'bg') return 'B';
  if (port === 'mask') return 'mask';
  return '';
}

/** Input pipes in Nuke order (B first = main input). */
export function nukeInputs(node: CompNode): { port: string; label: NukeInputLabel }[] {
  if (node.type === 'merge') return [{ port: 'bg', label: 'B' }, { port: 'fg', label: 'A' }, { port: 'mask', label: 'mask' }];
  if (node.type === 'media' || node.type === 'solid' || node.type === 'text') return [];
  return [{ port: 'input', label: '' }];
}

export const NUKE_CLASS_NAME: Record<CompNodeClass, string> = {
  media: 'Read',
  solid: 'Constant',
  text: 'Text',
  transform: 'Transform',
  merge: 'Merge',
  mask: 'Roto',
  output: 'Write',
  grade: 'Grade',
  blur: 'Blur',
  dot: 'Dot',
  fx: 'OFX',
};

export function nukeClassName(node: CompNode): string {
  const cls = nodeClassOf(node);
  if (cls === 'mask') return node.params.shape === 'rectangle' ? 'Rectangle' : 'Radial';
  return NUKE_CLASS_NAME[cls];
}

/** Tile colours per class (own palette, grouped like a compositor's menus: image, merge, transform, colour, filter, output). */
export const NUKE_CLASS_COLOR: Record<CompNodeClass, string> = {
  media: '#b9b9b9',
  solid: '#9e9e9e',
  text: '#9e9e9e',
  transform: '#a27ab0',
  merge: '#4d63c4',
  mask: '#6f9e6f',
  output: '#d98d3b',
  grade: '#6fa86a',
  blur: '#c97c4f',
  dot: '#8a8a8a',
  fx: '#b8a24c',
};

export const nukeColor = (node: CompNode) => NUKE_CLASS_COLOR[nodeClassOf(node)];

/** Merge operations (Nuke names) ↔ compModel blend modes. */
export const NUKE_OPERATIONS: { op: string; blend: CompBlendMode }[] = [
  { op: 'over', blend: 'normal' },
  { op: 'screen', blend: 'screen' },
  { op: 'multiply', blend: 'multiply' },
  { op: 'overlay', blend: 'overlay' },
  { op: 'soft-light', blend: 'soft-light' },
  { op: 'plus', blend: 'add' },
  { op: 'max', blend: 'lighten' },
  { op: 'min', blend: 'darken' },
  { op: 'difference', blend: 'difference' },
];

export const blendToNukeOp = (blend: unknown) => NUKE_OPERATIONS.find((entry) => entry.blend === blend)?.op ?? 'over';
export const nukeOpToBlend = (op: string): CompBlendMode => NUKE_OPERATIONS.find((entry) => entry.op === op)?.blend ?? 'normal';

/** Hotkeys that create nodes directly (Nuke muscle memory). */
export const NUKE_HOTKEYS: Record<string, string> = { m: 'Merge', t: 'Transform', g: 'Grade', b: 'Blur', r: 'Read', '.': 'Dot', o: 'Radial' };

export type ViewerChannel = 'rgb' | 'r' | 'g' | 'b' | 'a';
export const VIEWER_CHANNELS: { id: ViewerChannel; label: string }[] = [
  { id: 'rgb', label: 'RGB' },
  { id: 'r', label: 'R' },
  { id: 'g', label: 'G' },
  { id: 'b', label: 'B' },
  { id: 'a', label: 'A' },
];
