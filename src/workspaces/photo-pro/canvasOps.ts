/**
 * Canvas helpers for the photo editor: selection masks, brush tips,
 * gradients, transforms and image loading. Masks are white-on-transparent
 * canvases of document size (alpha = selection strength).
 */
import { hardnessStops } from './brush.ts';
import { compositeForMode } from './selection.ts';
import type { Point, Rect, SelectionMode } from './selection.ts';

export const makeCanvas = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

export const ctx2d = (canvas: HTMLCanvasElement, readback = false) =>
  canvas.getContext('2d', readback ? { willReadFrequently: true } : undefined) as CanvasRenderingContext2D;

export const cloneCanvas = (source: CanvasImageSource & { width: number; height: number }) => {
  const canvas = makeCanvas(source.width, source.height);
  ctx2d(canvas).drawImage(source, 0, 0);
  return canvas;
};

export type MaskShape =
  | { kind: 'rect'; rect: Rect }
  | { kind: 'ellipse'; rect: Rect }
  | { kind: 'poly'; points: Point[] };

export function traceShape(ctx: CanvasRenderingContext2D, shape: MaskShape) {
  ctx.beginPath();
  if (shape.kind === 'rect') {
    ctx.rect(shape.rect.x, shape.rect.y, shape.rect.width, shape.rect.height);
  } else if (shape.kind === 'ellipse') {
    const { x, y, width, height } = shape.rect;
    ctx.ellipse(x + width / 2, y + height / 2, Math.max(0.5, width / 2), Math.max(0.5, height / 2), 0, 0, Math.PI * 2);
  } else if (shape.points.length) {
    ctx.moveTo(shape.points[0].x, shape.points[0].y);
    for (const p of shape.points) ctx.lineTo(p.x, p.y);
    ctx.closePath();
  }
}

/** New mask = `previous` combined with `shape` by `mode` (previous may be null). */
export function combineMask(previous: HTMLCanvasElement | null | undefined, width: number, height: number, shape: MaskShape, mode: SelectionMode, feather = 0) {
  const mask = makeCanvas(width, height);
  const ctx = ctx2d(mask);
  if (previous && mode !== 'new') ctx.drawImage(previous, 0, 0);
  ctx.globalCompositeOperation = mode === 'new' ? 'source-over' : compositeForMode(mode);
  if (feather > 0) ctx.filter = `blur(${feather}px)`;
  ctx.fillStyle = '#fff';
  traceShape(ctx, shape);
  ctx.fill();
  return mask;
}

export function fullMask(width: number, height: number) {
  const mask = makeCanvas(width, height);
  const ctx = ctx2d(mask);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  return mask;
}

export function invertMask(mask: HTMLCanvasElement) {
  const out = fullMask(mask.width, mask.height);
  const ctx = ctx2d(out);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(mask, 0, 0);
  return out;
}

export function featherMask(mask: HTMLCanvasElement, radius: number) {
  const out = makeCanvas(mask.width, mask.height);
  const ctx = ctx2d(out);
  ctx.filter = `blur(${Math.max(0, radius)}px)`;
  ctx.drawImage(mask, 0, 0);
  return out;
}

/** Mask from an image's alpha channel (subject selection results). */
export function maskFromAlpha(image: CanvasImageSource, width: number, height: number) {
  const out = makeCanvas(width, height);
  const ctx = ctx2d(out);
  ctx.drawImage(image, 0, 0, width, height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  return out;
}

/** Approximate bounds of a mask (alpha ≥ 8) scanned at reduced resolution; null when empty. */
export function scanMaskBounds(mask: HTMLCanvasElement, maxSide = 1024): Rect | null {
  const scale = Math.min(1, maxSide / Math.max(mask.width, mask.height));
  const w = Math.max(1, Math.round(mask.width * scale));
  const h = Math.max(1, Math.round(mask.height * scale));
  const small = makeCanvas(w, h);
  const ctx = ctx2d(small, true);
  ctx.drawImage(mask, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  let minX = w; let minY = h; let maxX = -1; let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[(y * w + x) * 4 + 3] >= 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const inv = 1 / scale;
  const x0 = Math.max(0, Math.floor((minX - 1) * inv));
  const y0 = Math.max(0, Math.floor((minY - 1) * inv));
  const x1 = Math.min(mask.width, Math.ceil((maxX + 2) * inv));
  const y1 = Math.min(mask.height, Math.ceil((maxY + 2) * inv));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Screen-space outline of a mask for marching ants: `target` receives opaque
 * pixels on the boundary of the (≥50 %) selection, drawn through the view
 * transform. Also fills `tint` (if given) with the mask in screen space.
 */
export function renderMaskOutline(
  mask: HTMLCanvasElement,
  target: HTMLCanvasElement,
  view: { zoom: number; panX: number; panY: number },
  tint?: HTMLCanvasElement,
) {
  const w = target.width;
  const h = target.height;
  const scratch = makeCanvas(w, h);
  const sctx = ctx2d(scratch, true);
  sctx.imageSmoothingEnabled = view.zoom < 1;
  sctx.drawImage(mask, view.panX, view.panY, mask.width * view.zoom, mask.height * view.zoom);
  if (tint) {
    tint.width = w;
    tint.height = h;
    ctx2d(tint).drawImage(scratch, 0, 0);
  }
  const src = sctx.getImageData(0, 0, w, h).data;
  const out = new ImageData(w, h);
  const o = out.data;
  const inside = (x: number, y: number) => src[(y * w + x) * 4 + 3] >= 128;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!inside(x, y)) continue;
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
        || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (edge) o[(y * w + x) * 4 + 3] = 255;
    }
  }
  target.getContext('2d')!.putImageData(out, 0, 0);
}

let stripeCache: HTMLCanvasElement | null = null;
/** 8×8 diagonal black/white stripes for marching ants. */
export function antsPattern() {
  if (stripeCache) return stripeCache;
  const c = makeCanvas(8, 8);
  const ctx = ctx2d(c, true);
  const img = ctx.createImageData(8, 8);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const on = ((x + y) % 8) < 4;
      const i = (y * 8 + x) * 4;
      const v = on ? 255 : 0;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  stripeCache = c;
  return c;
}

/** Round brush tip of `size` px with hardness falloff in `color`. */
export function makeDab(size: number, hardness: number, color: string) {
  const d = Math.max(1, Math.ceil(size));
  const c = makeCanvas(d, d);
  const ctx = ctx2d(c);
  const r = d / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  for (const [offset, alpha] of hardnessStops(hardness)) {
    g.addColorStop(offset, alpha >= 1 ? color : withAlpha(color, alpha));
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

export function withAlpha(hex: string, alpha: number) {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return `rgba(0,0,0,${alpha})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

export function drawLinearGradient(ctx: CanvasRenderingContext2D, from: Point, to: Point, fg: string, bg: string, width: number, height: number) {
  const g = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
  g.addColorStop(0, fg);
  g.addColorStop(1, bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}

export function flipCanvas(source: HTMLCanvasElement, horizontal: boolean) {
  const out = makeCanvas(source.width, source.height);
  const ctx = ctx2d(out);
  if (horizontal) { ctx.translate(out.width, 0); ctx.scale(-1, 1); } else { ctx.translate(0, out.height); ctx.scale(1, -1); }
  ctx.drawImage(source, 0, 0);
  return out;
}

export function blurCanvas(source: HTMLCanvasElement, radius: number, mask?: HTMLCanvasElement | null, maskOffset: Point = { x: 0, y: 0 }) {
  const out = makeCanvas(source.width, source.height);
  const ctx = ctx2d(out);
  ctx.filter = `blur(${Math.max(0, radius)}px)`;
  ctx.drawImage(source, 0, 0);
  ctx.filter = 'none';
  if (!mask) return out;
  // Only inside the selection: blurred ∩ mask over the original.
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, maskOffset.x, maskOffset.y);
  const result = cloneCanvas(source);
  const rctx = ctx2d(result);
  rctx.globalCompositeOperation = 'destination-out';
  rctx.drawImage(mask, maskOffset.x, maskOffset.y);
  rctx.globalCompositeOperation = 'source-over';
  rctx.drawImage(out, 0, 0);
  return result;
}

export function scaleCanvas(source: HTMLCanvasElement, width: number, height: number) {
  const out = makeCanvas(width, height);
  const ctx = ctx2d(out);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  const attempt = (cors: boolean) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    if (cors && /^https?:/i.test(url)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'));
    img.src = url;
  });
  return attempt(true).catch(() => attempt(false));
}

export function canvasPayload(canvas: HTMLCanvasElement, mimeType = 'image/png') {
  const dataUrl = canvas.toDataURL(mimeType);
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2], dataUrl };
}

/** Checkerboard pattern tile for transparency (light greys like an image editor). */
export function checkerTile(cell = 8) {
  const c = makeCanvas(cell * 2, cell * 2);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cell * 2, cell * 2);
  ctx.fillStyle = '#cccccc';
  ctx.fillRect(0, 0, cell, cell);
  ctx.fillRect(cell, cell, cell, cell);
  return c;
}
