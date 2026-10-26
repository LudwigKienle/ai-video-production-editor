/**
 * Brush stroke geometry (pure): dab spacing along a pointer path and the
 * radial falloff for a hardness value. Rendering lives in canvasOps.ts.
 */
import type { Point, Rect } from './selection.ts';

export type BrushSettings = {
  /** Diameter in document pixels. */
  size: number;
  /** 0..1 — 1 is a hard edge. */
  hardness: number;
  /** 0..1 — caps the stroke's alpha. */
  opacity: number;
  /** 0..1 — alpha per dab, accumulates up to `opacity`. */
  flow: number;
};

export const DEFAULT_BRUSH: BrushSettings = { size: 60, hardness: 0.8, opacity: 1, flow: 1 };

/** Spacing between dabs (Photoshop default ~25 % of the diameter). */
export const dabSpacing = (size: number) => Math.max(1, size * 0.25);

/**
 * Points between `from` and `to` at a fixed spacing. `carry` is the distance
 * already travelled since the last dab, so spacing stays even across events.
 */
export function interpolateDabs(from: Point, to: Point, spacing: number, carry: number): { points: Point[]; carry: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const points: Point[] = [];
  if (dist === 0) return { points, carry };
  let d = spacing - carry;
  while (d <= dist) {
    const t = d / dist;
    points.push({ x: from.x + dx * t, y: from.y + dy * t });
    d += spacing;
  }
  return { points, carry: dist - (d - spacing) };
}

/** Gradient stops (offset, alpha) for a soft round tip. */
export function hardnessStops(hardness: number): Array<[number, number]> {
  const h = Math.max(0, Math.min(1, hardness));
  if (h >= 0.999) return [[0, 1], [0.98, 1], [1, 0]];
  return [[0, 1], [h, 1], [Math.min(1, h + (1 - h) * 0.5), 0.45], [1, 0]];
}

/** Bounding box of dabs of diameter `size` (dirty rect for redraws). */
export function dabsBounds(points: Point[], size: number): Rect | null {
  if (!points.length) return null;
  const r = size / 2 + 2;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x - r); minY = Math.min(minY, p.y - r);
    maxX = Math.max(maxX, p.x + r); maxY = Math.max(maxY, p.y + r);
  }
  return { x: Math.floor(minX), y: Math.floor(minY), width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY) };
}

/** `[` / `]` brush size steps (Photoshop-like progression). */
export function stepBrushSize(size: number, dir: 1 | -1): number {
  const step = size < 10 ? 1 : size < 50 ? 5 : size < 100 ? 10 : size < 300 ? 25 : 50;
  return Math.max(1, Math.min(2500, size + dir * step));
}

export const hexToRgb = (hex: string): [number, number, number] => {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
};

export const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
