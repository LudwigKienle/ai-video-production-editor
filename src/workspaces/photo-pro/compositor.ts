/**
 * Layer compositor: renders a PhotoDoc bottom → top with blend modes and
 * opacity into a canvas at a given scale (display proxy or 1 for export).
 * Adjustment layers act on everything composited below them.
 *
 * Performance: layer canvases are GPU-backed and only drawn; adjustments read
 * back once per adjustment layer at the proxy resolution. While a layer is
 * being painted (`volatileId`) the composite of the layers below is cached.
 */
import { applyAdjustment, isIdentityAdjustment, lookFilter } from './adjustments.ts';
import { ctx2d, makeCanvas } from './canvasOps.ts';
import { blendToComposite } from './layers.ts';
import type { Layer, PhotoDoc, RasterLayer, TextLayer } from './layers.ts';

export type CompositeEnv = {
  /** Pixels of a raster layer, after smart filters when they are ready. */
  layerSource: (layer: RasterLayer) => CanvasImageSource | undefined;
  /** Changes whenever a smart-filter result arrives (part of the cache signature). */
  fxVersion?: number;
  /** Layers not drawn (e.g. the text layer being edited in place). */
  hiddenIds?: Set<string>;
};

export type PrefixCache = { sig: string; canvas: HTMLCanvasElement | null };

export const createPrefixCache = (): PrefixCache => ({ sig: '', canvas: null });

const scratch: { canvas: HTMLCanvasElement | null } = { canvas: null };
const scratchCanvas = (w: number, h: number) => {
  if (!scratch.canvas) scratch.canvas = makeCanvas(w, h);
  if (scratch.canvas.width !== w) scratch.canvas.width = w;
  if (scratch.canvas.height !== h) scratch.canvas.height = h;
  return scratch.canvas;
};

export const textFont = (layer: TextLayer, scale = 1) =>
  `${layer.italic ? 'italic ' : ''}${layer.bold ? '700 ' : '400 '}${Math.max(1, layer.fontSize * scale)}px ${layer.fontFamily}`;

export const TEXT_LINE_HEIGHT = 1.2;

let measureCtx: CanvasRenderingContext2D | null = null;
/** Document-space bounds of a text layer (hit testing, move tool outline). */
export function measureTextLayer(layer: TextLayer) {
  measureCtx ??= ctx2d(makeCanvas(1, 1));
  measureCtx.font = textFont(layer);
  const lines = layer.text.split('\n');
  const width = Math.max(1, ...lines.map((line) => measureCtx!.measureText(line || ' ').width));
  const height = lines.length * layer.fontSize * TEXT_LINE_HEIGHT;
  const x = layer.align === 'center' ? layer.x - width / 2 : layer.align === 'right' ? layer.x - width : layer.x;
  return { x, y: layer.y, width, height };
}

export function drawTextLayer(ctx: CanvasRenderingContext2D, layer: TextLayer, scale: number) {
  ctx.font = textFont(layer, scale);
  ctx.fillStyle = layer.color;
  ctx.textBaseline = 'top';
  ctx.textAlign = layer.align;
  const lh = layer.fontSize * TEXT_LINE_HEIGHT * scale;
  // Centre glyphs inside the line box like the in-place editor does.
  const pad = (lh - layer.fontSize * scale) / 2;
  layer.text.split('\n').forEach((line, i) => {
    ctx.fillText(line, layer.x * scale, layer.y * scale + pad + i * lh);
  });
}

function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, env: CompositeEnv, scale: number, w: number, h: number) {
  if (!layer.visible || layer.opacity <= 0 || env.hiddenIds?.has(layer.id)) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
  ctx.globalCompositeOperation = blendToComposite(layer.blendMode);
  if (layer.kind === 'raster') {
    const source = env.layerSource(layer);
    if (source) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = scale < 1 ? 'medium' : 'high';
      ctx.drawImage(source, layer.x * scale, layer.y * scale, layer.width * scale, layer.height * scale);
    }
  } else if (layer.kind === 'text') {
    drawTextLayer(ctx, layer, scale);
  } else if (!isIdentityAdjustment(layer.adjustment)) {
    const adj = layer.adjustment;
    const tmp = scratchCanvas(w, h);
    const tctx = ctx2d(tmp);
    tctx.save();
    tctx.globalCompositeOperation = 'copy';
    if (adj.type === 'look') {
      tctx.filter = lookFilter({ ...adj, blur: adj.blur * scale });
      tctx.drawImage(ctx.canvas, 0, 0);
      tctx.filter = 'none';
    } else {
      const img = ctx.getImageData(0, 0, w, h);
      applyAdjustment(img.data, adj);
      tctx.putImageData(img, 0, 0);
    }
    tctx.restore();
    if (adj.type !== 'look' && layer.opacity >= 1 && layer.blendMode === 'normal') {
      // Fast path: replace in place.
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(tmp, 0, 0);
    } else {
      ctx.drawImage(tmp, 0, 0);
    }
  }
  ctx.restore();
}

const layerSignature = (layer: Layer) => JSON.stringify(layer);

/**
 * Composite `doc` into `target` at `scale`. Returns the target. With
 * `volatileId` + `cache`, layers below the volatile one are reused.
 */
export function compositeDoc(
  target: HTMLCanvasElement,
  doc: PhotoDoc,
  env: CompositeEnv,
  scale: number,
  opts: { cache?: PrefixCache; volatileId?: string | null; background?: string | null; layers?: Layer[] } = {},
) {
  const w = Math.max(1, Math.round(doc.width * scale));
  const h = Math.max(1, Math.round(doc.height * scale));
  if (target.width !== w) target.width = w;
  if (target.height !== h) target.height = h;
  const ctx = ctx2d(target);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, w, h);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, w, h);
  }
  const layers = opts.layers ?? doc.layers;
  let start = 0;
  const vi = opts.volatileId ? layers.findIndex((layer) => layer.id === opts.volatileId) : -1;
  if (opts.cache && vi > 0 && !opts.background) {
    const prefix = layers.slice(0, vi);
    const sig = `${w}x${h}|${env.fxVersion ?? 0}|${[...(env.hiddenIds ?? [])].join(',')}|${prefix.map(layerSignature).join('|')}`;
    if (opts.cache.sig !== sig || !opts.cache.canvas) {
      const canvas = opts.cache.canvas ?? makeCanvas(w, h);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const pctx = ctx2d(canvas);
      pctx.clearRect(0, 0, w, h);
      for (const layer of prefix) drawLayer(pctx, layer, env, scale, w, h);
      opts.cache.canvas = canvas;
      opts.cache.sig = sig;
    }
    ctx.drawImage(opts.cache.canvas!, 0, 0);
    start = vi;
  }
  for (let i = start; i < layers.length; i += 1) drawLayer(ctx, layers[i], env, scale, w, h);
  ctx.restore();
  return target;
}

/** Full-resolution flattened copy of the document (export, generative fill input). */
export function flattenDoc(doc: PhotoDoc, env: CompositeEnv, layers?: Layer[]) {
  return compositeDoc(makeCanvas(doc.width, doc.height), doc, env, 1, { layers });
}
