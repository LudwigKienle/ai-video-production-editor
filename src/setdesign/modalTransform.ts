/**
 * Blender-style modal transforms (G/R/S): axis constraints, numeric input and the header text.
 * The pointer → world maths lives in the viewport; this module holds the parts that do not
 * need a renderer, so they can be tested.
 */
import type { SetDesignTransform } from '../types';

export type ModalKind = 'grab' | 'rotate' | 'scale';
export type BlenderAxis = 'x' | 'y' | 'z';
/** axis null = free; plane true = the two axes other than `axis`. */
export type Constraint = { axis: BlenderAxis | null; plane: boolean };

export const FREE: Constraint = { axis: null, plane: false };

/** Pressing X/Y/Z sets that axis; the same key again releases it. Shift picks the plane. */
export const nextConstraint = (current: Constraint, axis: BlenderAxis, shift: boolean): Constraint => {
  if (current.axis === axis && current.plane === shift) return FREE;
  return { axis, plane: shift };
};

/** Blender axis → three.js world direction. */
export const threeAxis = (axis: BlenderAxis): SetDesignTransform =>
  axis === 'x' ? { x: 1, y: 0, z: 0 } : axis === 'y' ? { x: 0, y: 0, z: -1 } : { x: 0, y: 1, z: 0 };

/** Which three.js components a constraint lets change (for grab and scale). */
export const threeMask = (constraint: Constraint): SetDesignTransform => {
  if (!constraint.axis) return { x: 1, y: 1, z: 1 };
  const on = { x: constraint.axis === 'x', y: constraint.axis === 'z', z: constraint.axis === 'y' };
  const pick = (v: boolean) => (constraint.plane ? (v ? 0 : 1) : v ? 1 : 0);
  return { x: pick(on.x), y: pick(on.y), z: pick(on.z) };
};

/** Typed numeric input: digits, one dot (comma accepted), leading minus; Backspace edits. */
export const editNumeric = (text: string, key: string): string | null => {
  if (key === 'Backspace') return text.slice(0, -1);
  if (key === '-') return text.startsWith('-') ? text.slice(1) : `-${text}`;
  if (key === '.' || key === ',') return text.includes('.') ? text : `${text || '0'}.`;
  if (/^[0-9]$/.test(key)) return text + key;
  return null;
};

export const parseNumeric = (text: string): number | null => {
  if (!text || text === '-' || text === '.' || text === '-.') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

const fmt = (value: number, digits: number) => value.toFixed(digits).replace('.', ',');

/** Header line like Blender's: "D: 1,250 m (1,250 m) entlang X" / "Drehung: 45° um Z" / "Skalierung: 2,000". */
export const describeModal = (kind: ModalKind, value: number, constraint: Constraint, typed: string) => {
  const axisLabel = constraint.axis ? (constraint.plane ? ` (Ebene ohne ${constraint.axis.toUpperCase()})` : ` entlang ${constraint.axis.toUpperCase()}`) : '';
  const typedLabel = typed ? ` [${typed.replace('.', ',')}]` : '';
  if (kind === 'grab') return `Verschieben: ${fmt(value, 3)} m${axisLabel}${typedLabel}`;
  if (kind === 'rotate') return `Drehen: ${fmt(value, 1)}°${constraint.axis ? ` um ${constraint.axis.toUpperCase()}` : ''}${typedLabel}`;
  return `Skalieren: ${fmt(value, 3)}${axisLabel}${typedLabel}`;
};

/** Ctrl while moving snaps: 0.1 m, 5°, 0.1 scale steps (Blender increments). */
export const snapValue = (kind: ModalKind, value: number) => {
  const step = kind === 'grab' ? 0.1 : kind === 'rotate' ? 5 : 0.1;
  return Math.round(value / step) * step;
};
