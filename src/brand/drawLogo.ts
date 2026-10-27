/**
 * Canvas 2D drawing of the logo geometry (browser canvas and @napi-rs/canvas
 * in the preview scripts). Uses the global Path2D; Node scripts install the
 * @napi-rs/canvas Path2D on globalThis first.
 */
import { BRAND_COLORS, DEFAULT_WORDMARK, type BrandColor, type BrandPalette, type WordmarkMode } from './brandTokens.ts';
import { MARK_ELEMENTS, MARK_ORDER, layoutTextLine, lockupLayout, partToD, rule, subPathLength, subPathToD, type LogoPart, type TextLine } from './logoGeometry.ts';

type Ctx = CanvasRenderingContext2D;

const pathCache = new Map<string, Path2D>();

/** Path2D for an SVG path string. Static strings are cached. */
export function path2d(d: string, cache = true): Path2D {
  if (!cache) return new Path2D(d);
  let p = pathCache.get(d);
  if (!p) {
    p = new Path2D(d);
    if (pathCache.size > 4000) pathCache.clear();
    pathCache.set(d, p);
  }
  return p;
}

const lengthCache = new WeakMap<LogoPart, number[]>();
const lengthsOf = (part: LogoPart): number[] => {
  let lengths = lengthCache.get(part);
  if (!lengths) {
    lengths = part.subpaths.map(subPathLength);
    lengthCache.set(part, lengths);
  }
  return lengths;
};

let activePalette: BrandPalette = BRAND_COLORS;
/** Palette used by colorOf (and so drawPart/drawTextLine); null restores the reference colours. */
export const setLogoPalette = (palette: BrandPalette | null) => { activePalette = palette ?? BRAND_COLORS; };
export const colorOf = (color: BrandColor | string): string => (color in activePalette ? activePalette[color as BrandColor] : color);

export type DrawPartOptions = {
  /** 0..1 draw-on progress for strokes (dash from the path start). Default 1. */
  progress?: number;
  color?: string | CanvasGradient;
  alpha?: number;
  widthScale?: number;
};

/** Draws one logo part; strokes can be partially drawn (stroke-dashoffset style). */
export function drawPart(ctx: Ctx, part: LogoPart, options: DrawPartOptions = {}): void {
  const progress = options.progress ?? 1;
  const alpha = options.alpha ?? 1;
  if (progress <= 0.0005 || alpha <= 0.002) return;
  ctx.save();
  // Strokes fade in over the first bit of their draw-on, so the round cap does not pop in as a dot.
  ctx.globalAlpha *= alpha * (part.mode === 'stroke' ? Math.min(1, progress * 7) : 1);
  const color = options.color ?? colorOf(part.color);
  if (part.mode === 'fill') {
    ctx.fillStyle = color;
    ctx.fill(path2d(partToD(part)));
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = (part.width ?? 1) * (options.widthScale ?? 1);
    ctx.lineCap = part.cap ?? 'round';
    ctx.lineJoin = 'round';
    if (progress >= 0.9995) {
      ctx.stroke(path2d(partToD(part)));
    } else {
      const lengths = lengthsOf(part);
      part.subpaths.forEach((sp, i) => {
        const len = lengths[i];
        ctx.setLineDash([Math.max(0.01, len * progress), len + 100]);
        ctx.lineDashOffset = 0;
        ctx.stroke(path2d(subPathToD(sp)));
      });
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

export type DrawTextOptions = { alpha?: number; trackingScale?: number; dy?: number; color?: string };

/** Draws a type line from glyph outlines (no font needed). */
export function drawTextLine(ctx: Ctx, line: TextLine, options: DrawTextOptions = {}): void {
  const alpha = options.alpha ?? 1;
  if (alpha <= 0.002) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = options.color ?? colorOf(line.color);
  for (const g of layoutTextLine(line, options.trackingScale ?? 1)) {
    ctx.save();
    ctx.translate(g.x, line.baseline + (options.dy ?? 0));
    ctx.scale(g.scale, g.scale);
    ctx.fill(path2d(g.d));
    ctx.restore();
  }
  ctx.restore();
}

/** Complete mark (static), in logo units. */
export function drawMark(ctx: Ctx, options: { color?: (part: LogoPart) => string | CanvasGradient | undefined } = {}): void {
  for (const id of MARK_ORDER) for (const part of MARK_ELEMENTS[id]()) drawPart(ctx, part, { color: options.color?.(part) });
}

/** Complete lockup (static), in logo units. */
export function drawLockup(ctx: Ctx, mode: WordmarkMode = DEFAULT_WORDMARK, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha *= alpha;
  drawMark(ctx);
  const lock = lockupLayout(mode);
  for (const line of lock.lines) drawTextLine(ctx, line);
  for (const part of rule(mode)) drawPart(ctx, part);
  ctx.restore();
}
