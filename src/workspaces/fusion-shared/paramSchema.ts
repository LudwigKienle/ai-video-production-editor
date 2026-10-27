/**
 * Inspector schema for the built-in node params (compModel NODE_DEFAULTS).
 * Fusion inspector and Nuke properties bin render the same controls from it.
 * Labels are German UI text; keys are the stored param ids.
 */
import type { CompNodeType } from './compModel.ts';

export type ParamControl =
  | { key: string; label: string; kind: 'number'; min: number; max: number; step: number; keyframable: boolean; unit?: string }
  | { key: string; label: string; kind: 'color' }
  | { key: string; label: string; kind: 'text'; multiline?: boolean }
  | { key: string; label: string; kind: 'select'; options: { value: string; label: string }[] }
  | { key: string; label: string; kind: 'bool' };

const n = (key: string, label: string, min: number, max: number, step: number, unit?: string): ParamControl => ({ key, label, kind: 'number', min, max, step, keyframable: true, unit });

export const BLEND_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'screen', label: 'Negativ multiplizieren (Screen)' },
  { value: 'multiply', label: 'Multiplizieren' },
  { value: 'overlay', label: 'Ineinanderkopieren (Overlay)' },
  { value: 'soft-light', label: 'Weiches Licht' },
  { value: 'add', label: 'Addieren' },
  { value: 'lighten', label: 'Aufhellen' },
  { value: 'darken', label: 'Abdunkeln' },
  { value: 'difference', label: 'Differenz' },
];

export const FONT_OPTIONS = ['Inter', 'Helvetica', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'IBM Plex Mono'].map((font) => ({ value: font, label: font }));

export const PARAM_SCHEMA: Record<CompNodeType, ParamControl[]> = {
  media: [n('opacity', 'Deckkraft', 0, 1, 0.01)],
  solid: [{ key: 'color', label: 'Farbe', kind: 'color' }, n('opacity', 'Deckkraft', 0, 1, 0.01)],
  text: [
    { key: 'text', label: 'Text', kind: 'text', multiline: true },
    { key: 'font', label: 'Schrift', kind: 'select', options: FONT_OPTIONS },
    n('size', 'Größe', 4, 600, 1, 'px'),
    { key: 'color', label: 'Farbe', kind: 'color' },
    n('opacity', 'Deckkraft', 0, 1, 0.01),
  ],
  transform: [
    n('x', 'Position X', -4000, 4000, 1, 'px'),
    n('y', 'Position Y', -4000, 4000, 1, 'px'),
    n('scale', 'Größe', 0, 10, 0.01),
    n('rotation', 'Drehung', -720, 720, 0.1, '°'),
    n('anchorX', 'Ankerpunkt X', -4000, 4000, 1, 'px'),
    n('anchorY', 'Ankerpunkt Y', -4000, 4000, 1, 'px'),
    n('opacity', 'Deckkraft', 0, 1, 0.01),
  ],
  merge: [{ key: 'blend', label: 'Mischmodus', kind: 'select', options: BLEND_OPTIONS }, n('opacity', 'Deckkraft (Mix)', 0, 1, 0.01)],
  fx: [],
  mask: [
    {
      key: 'shape',
      label: 'Form',
      kind: 'select',
      options: [
        { value: 'ellipse', label: 'Ellipse' },
        { value: 'rectangle', label: 'Rechteck' },
      ],
    },
    n('cx', 'Mitte X', -1, 2, 0.001),
    n('cy', 'Mitte Y', -1, 2, 0.001),
    n('w', 'Breite', 0, 3, 0.001),
    n('h', 'Höhe', 0, 3, 0.001),
    n('feather', 'Weiche Kante', 0, 0.5, 0.001),
    { key: 'invert', label: 'Umkehren', kind: 'bool' },
  ],
  output: [],
};

export const clampNumber = (value: number, min: number, max: number) => (Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min);
