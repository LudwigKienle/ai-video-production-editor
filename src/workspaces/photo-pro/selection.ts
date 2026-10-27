/**
 * Selection and crop geometry (pure). The selection itself is a document-sized
 * alpha mask in the pixel store; this module covers the rectangle maths, the
 * add/subtract/intersect modes and conservative bounds tracking.
 */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type SelectionMode = 'new' | 'add' | 'subtract' | 'intersect';

export const SELECTION_MODES: Array<{ id: SelectionMode; label: string }> = [
  { id: 'new', label: 'Neue Auswahl' },
  { id: 'add', label: 'Der Auswahl hinzufügen' },
  { id: 'subtract', label: 'Von Auswahl subtrahieren' },
  { id: 'intersect', label: 'Schnittmenge mit Auswahl bilden' },
];

export const rectIsEmpty = (r: Rect | null | undefined) => !r || r.width <= 0 || r.height <= 0;

export const normalizeRect = (r: Rect): Rect => ({
  x: r.width < 0 ? r.x + r.width : r.x,
  y: r.height < 0 ? r.y + r.height : r.y,
  width: Math.abs(r.width),
  height: Math.abs(r.height),
});

/**
 * Rectangle spanned by a drag. `square` (Shift) constrains to 1:1,
 * `fromCenter` (Alt) treats the start point as the centre — like the marquee.
 */
export function rectFromDrag(start: Point, end: Point, opts: { square?: boolean; fromCenter?: boolean; ratio?: number | null } = {}): Rect {
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  const ratio = opts.square ? 1 : opts.ratio ?? null;
  if (ratio && ratio > 0) {
    const w = Math.abs(dx);
    const h = Math.abs(dy);
    // Follow the dominant axis, keep the drag direction.
    if (w / ratio >= h) dy = Math.sign(dy || 1) * (w / ratio);
    else dx = Math.sign(dx || 1) * (h * ratio);
  }
  if (opts.fromCenter) {
    return normalizeRect({ x: start.x - dx, y: start.y - dy, width: dx * 2, height: dy * 2 });
  }
  return normalizeRect({ x: start.x, y: start.y, width: dx, height: dy });
}

export const intersectRect = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const btm = Math.min(a.y + a.height, b.y + b.height);
  if (r <= x || btm <= y) return null;
  return { x, y, width: r - x, height: btm - y };
};

export const unionRect = (a: Rect | null, b: Rect | null): Rect | null => {
  if (rectIsEmpty(a)) return rectIsEmpty(b) ? null : b;
  if (rectIsEmpty(b)) return a;
  const x = Math.min(a!.x, b!.x);
  const y = Math.min(a!.y, b!.y);
  return {
    x,
    y,
    width: Math.max(a!.x + a!.width, b!.x + b!.width) - x,
    height: Math.max(a!.y + a!.height, b!.y + b!.height) - y,
  };
};

export const clampRect = (r: Rect, width: number, height: number): Rect | null =>
  intersectRect(normalizeRect(r), { x: 0, y: 0, width, height });

/** Integer pixel rectangle covering `r` (floor/ceil). */
export const roundOutRect = (r: Rect): Rect => {
  const x = Math.floor(r.x);
  const y = Math.floor(r.y);
  return { x, y, width: Math.ceil(r.x + r.width) - x, height: Math.ceil(r.y + r.height) - y };
};

export const pointsBounds = (points: Point[]): Rect | null => {
  if (!points.length) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/** Photoshop modifiers: Shift adds, Alt subtracts, Shift+Alt intersects. */
export function selectionModeFromModifiers(base: SelectionMode, shift: boolean, alt: boolean, hasSelection: boolean): SelectionMode {
  if (!hasSelection) return 'new';
  if (shift && alt) return 'intersect';
  if (shift) return 'add';
  if (alt) return 'subtract';
  return base;
}

/** How a new shape is combined into the existing mask canvas. */
export const compositeForMode = (mode: SelectionMode): GlobalCompositeOperation => {
  if (mode === 'subtract') return 'destination-out';
  if (mode === 'intersect') return 'destination-in';
  return 'source-over';
};

/** Conservative bounds of the combined selection (never smaller than the truth). */
export function combineBounds(prev: Rect | null, shape: Rect | null, mode: SelectionMode): Rect | null {
  if (mode === 'new') return rectIsEmpty(shape) ? null : shape;
  if (mode === 'add') return unionRect(prev, shape);
  if (mode === 'subtract') return prev;
  if (!prev || !shape) return null;
  return intersectRect(prev, shape);
}

export type CropRatio = { id: string; label: string; ratio: number | null };

export const CROP_RATIOS: CropRatio[] = [
  { id: 'free', label: 'Verhältnis', ratio: null },
  { id: 'original', label: 'Original', ratio: -1 },
  { id: '1:1', label: '1 : 1 (Quadrat)', ratio: 1 },
  { id: '4:5', label: '4 : 5 (8 : 10)', ratio: 4 / 5 },
  { id: '3:2', label: '3 : 2', ratio: 3 / 2 },
  { id: '16:9', label: '16 : 9', ratio: 16 / 9 },
  { id: '9:16', label: '9 : 16', ratio: 9 / 16 },
  { id: '2.39:1', label: '2,39 : 1 (Scope)', ratio: 2.39 },
];

export const resolveCropRatio = (ratio: number | null, docW: number, docH: number) =>
  ratio === -1 ? (docH ? docW / docH : null) : ratio;

/** Largest centred rectangle of `ratio` inside the document (initial crop box). */
export function fitRatioRect(docW: number, docH: number, ratio: number | null): Rect {
  if (!ratio || ratio <= 0) return { x: 0, y: 0, width: docW, height: docH };
  let w = docW;
  let h = w / ratio;
  if (h > docH) { h = docH; w = h * ratio; }
  return { x: Math.round((docW - w) / 2), y: Math.round((docH - h) / 2), width: Math.round(w), height: Math.round(h) };
}

export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';

/** Resize a crop rect by dragging one of its handles by (dx, dy) document pixels. */
export function dragCropHandle(start: Rect, handle: CropHandle, dx: number, dy: number, ratio: number | null, minSize = 1): Rect {
  if (handle === 'move') return { ...start, x: start.x + dx, y: start.y + dy };
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left += dx;
  if (handle.includes('e')) right += dx;
  if (handle.includes('n')) top += dy;
  if (handle.includes('s')) bottom += dy;
  if (right - left < minSize) { if (handle.includes('w')) left = right - minSize; else right = left + minSize; }
  if (bottom - top < minSize) { if (handle.includes('n')) top = bottom - minSize; else bottom = top + minSize; }
  if (ratio && ratio > 0) {
    let w = right - left;
    let h = bottom - top;
    const horizontal = handle === 'e' || handle === 'w';
    const vertical = handle === 'n' || handle === 's';
    if (horizontal) h = w / ratio;
    else if (vertical) w = h * ratio;
    else if (w / ratio > h) h = w / ratio;
    else w = h * ratio;
    if (handle.includes('w')) left = right - w; else right = left + w;
    if (handle.includes('n')) top = bottom - h;
    else if (handle.includes('s') || horizontal) bottom = top + h;
    if (vertical) {
      const cx = (start.x + start.width / 2);
      left = cx - w / 2;
      right = cx + w / 2;
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
