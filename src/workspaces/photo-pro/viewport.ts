/**
 * Canvas view maths: zoom steps, zoom-around-a-point, fit, screen↔document
 * mapping and the proxy resolution used for compositing at low zoom.
 * screen = doc * zoom + pan  (CSS pixels inside the viewport element).
 */
import type { Point } from './selection.ts';

export type View = { zoom: number; panX: number; panY: number };

/** Photoshop-like preset steps (as factors). */
export const ZOOM_STEPS = [
  0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667,
  1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 32,
];
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

export const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

/** Next preset step in direction `dir` (+1 in, −1 out) from an arbitrary zoom. */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  const eps = 1e-4;
  if (dir > 0) return ZOOM_STEPS.find((s) => s > zoom + eps) ?? MAX_ZOOM;
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i -= 1) if (ZOOM_STEPS[i] < zoom - eps) return ZOOM_STEPS[i];
  return MIN_ZOOM;
}

export const screenToDoc = (view: View, p: Point): Point => ({ x: (p.x - view.panX) / view.zoom, y: (p.y - view.panY) / view.zoom });
export const docToScreen = (view: View, p: Point): Point => ({ x: p.x * view.zoom + view.panX, y: p.y * view.zoom + view.panY });

/** New view at `zoom` that keeps the document point under `anchor` (screen) fixed. */
export function zoomAt(view: View, zoom: number, anchor: Point): View {
  const z = clampZoom(zoom);
  const docPoint = screenToDoc(view, anchor);
  return { zoom: z, panX: anchor.x - docPoint.x * z, panY: anchor.y - docPoint.y * z };
}

/** Centre the document in the viewport at a zoom. */
export const centerView = (docW: number, docH: number, viewW: number, viewH: number, zoom: number): View => ({
  zoom,
  panX: Math.round((viewW - docW * zoom) / 2),
  panY: Math.round((viewH - docH * zoom) / 2),
});

/** "Ganzes Bild" — fit with a margin, never above 100 % unless `allowUpscale`. */
export function fitView(docW: number, docH: number, viewW: number, viewH: number, margin = 24, allowUpscale = false): View {
  if (!docW || !docH || viewW <= 0 || viewH <= 0) return { zoom: 1, panX: 0, panY: 0 };
  let zoom = Math.min((viewW - margin * 2) / docW, (viewH - margin * 2) / docH);
  if (!allowUpscale) zoom = Math.min(1, zoom);
  zoom = clampZoom(Math.max(zoom, MIN_ZOOM));
  return centerView(docW, docH, viewW, viewH, zoom);
}

/** Continuous zoom factor for wheel/pinch deltas. */
export const wheelZoomFactor = (deltaY: number) => Math.exp(-deltaY * 0.0025);

/**
 * Resolution at which the compositor renders for display: the smallest power
 * of two ≥ zoom·dpr, capped at 1 (full resolution) and floored at 1/32. Using
 * steps avoids recompositing on every zoom tick.
 */
export function proxyScale(zoom: number, dpr = 1): number {
  const target = Math.min(1, zoom * dpr);
  let s = 1;
  while (s / 2 >= target && s > 1 / 32) s /= 2;
  return s;
}

/** German percentage like Photoshop's tab title: "33,3 %", "100 %". */
export function formatZoom(zoom: number): string {
  const pct = zoom * 100;
  const rounded = pct >= 100 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${String(rounded).replace('.', ',')} %`;
}

/** Parses "50", "50%", "33,3 %" → factor. */
export function parseZoom(text: string): number | null {
  const n = Number(text.replace('%', '').replace(',', '.').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return clampZoom(n / 100);
}

/** Human file size of an uncompressed RGBA document ("24,9 MB"). */
export function formatDocSize(width: number, height: number, layers = 1): string {
  const bytes = width * height * 4 * Math.max(1, layers);
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2).replace('.', ',')} GB` : `${mb.toFixed(1).replace('.', ',')} MB`;
}
