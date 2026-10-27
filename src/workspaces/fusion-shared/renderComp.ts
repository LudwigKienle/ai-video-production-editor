/**
 * Canvas 2D evaluator for the shared composition graph (all three Fusion-page
 * views use it for their viewers). GPU effects of `fx` nodes run through the
 * shared WebGL FX renderer.
 */
import { getSharedFxRenderer } from '../../fx/renderer';
import { resolveParamsAtTime } from '../../fx/registry';
import type { CompBlendMode, CompNode, Composition } from './compModel';
import { evaluationOrder, getNode, paramsAt } from './compModel';

export type MediaResolver = (mediaId: string, timeSeconds: number) => CanvasImageSource | null;

const BLEND: Record<CompBlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  screen: 'screen',
  multiply: 'multiply',
  overlay: 'overlay',
  'soft-light': 'soft-light',
  add: 'lighter',
  lighten: 'lighten',
  darken: 'darken',
  difference: 'difference',
};

const sourceSize = (source: CanvasImageSource) => {
  const s = source as unknown as Record<string, number>;
  return { width: s.videoWidth || s.naturalWidth || s.width || 0, height: s.videoHeight || s.naturalHeight || s.height || 0 };
};

const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

export type CompRenderOptions = {
  /** Render size (defaults to comp size); views pass smaller sizes for proxy playback. */
  width?: number;
  height?: number;
  /** Render a specific node instead of the output (viewer "view node"). */
  nodeId?: string;
};

export function renderComposition(comp: Composition, timeSeconds: number, resolveMedia: MediaResolver, options: CompRenderOptions = {}): HTMLCanvasElement {
  const width = Math.max(2, Math.round(options.width ?? comp.width));
  const height = Math.max(2, Math.round(options.height ?? comp.height));
  const scale = width / comp.width;
  const results = new Map<string, HTMLCanvasElement>();
  const make = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
  const input = (node: CompNode, port: string) => {
    const src = node.inputs[port];
    return src ? results.get(src) ?? null : null;
  };

  for (const id of evaluationOrder(comp, options.nodeId ?? comp.outputNodeId)) {
    const node = getNode(comp, id);
    if (!node) continue;
    const canvas = make();
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    const p = paramsAt(node, timeSeconds);
    const active =
      node.enabled &&
      (node.inPoint === undefined || timeSeconds >= node.inPoint) &&
      (node.outPoint === undefined || timeSeconds < node.outPoint);

    if (!node.enabled && node.type !== 'media' && node.type !== 'solid' && node.type !== 'text') {
      // Disabled processing nodes pass their main input through.
      const pass = input(node, 'input') ?? input(node, 'bg');
      if (pass) ctx.drawImage(pass, 0, 0);
      results.set(id, canvas);
      continue;
    }

    switch (node.type) {
      case 'media': {
        const source = active && node.mediaId ? resolveMedia(node.mediaId, timeSeconds - (node.inPoint ?? 0) + num(p.aeSourceOffset, 0)) : null;
        if (source) {
          const size = sourceSize(source);
          if (size.width && size.height) {
            const fit = Math.min(width / size.width, height / size.height);
            const w = size.width * fit;
            const h = size.height * fit;
            ctx.globalAlpha = num(p.opacity, 1);
            ctx.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
          }
        }
        break;
      }
      case 'solid':
        if (active) {
          ctx.globalAlpha = num(p.opacity, 1);
          ctx.fillStyle = String(p.color ?? '#333');
          ctx.fillRect(0, 0, width, height);
        }
        break;
      case 'text':
        if (active) {
          ctx.globalAlpha = num(p.opacity, 1);
          ctx.fillStyle = String(p.color ?? '#fff');
          ctx.font = `${num(p.size, 96) * scale}px ${String(p.font ?? 'sans-serif')}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(p.text ?? ''), width / 2, height / 2);
        }
        break;
      case 'transform': {
        const src = input(node, 'input');
        if (src) {
          ctx.globalAlpha = num(p.opacity, 1);
          ctx.translate(width / 2 + num(p.x, 0) * scale, height / 2 + num(p.y, 0) * scale);
          ctx.rotate((num(p.rotation, 0) * Math.PI) / 180);
          const s = num(p.scale, 1);
          ctx.scale(s, s);
          ctx.translate(-width / 2 - num(p.anchorX, 0) * scale, -height / 2 - num(p.anchorY, 0) * scale);
          ctx.drawImage(src, 0, 0);
        }
        break;
      }
      case 'merge': {
        const bg = input(node, 'bg');
        const fg = input(node, 'fg');
        const mask = input(node, 'mask');
        if (bg) ctx.drawImage(bg, 0, 0);
        if (fg) {
          let layer: CanvasImageSource = fg;
          if (mask) {
            const masked = make();
            const mctx = masked.getContext('2d')!;
            mctx.drawImage(fg, 0, 0);
            mctx.globalCompositeOperation = 'destination-in';
            mctx.drawImage(mask, 0, 0);
            layer = masked;
          }
          ctx.globalAlpha = num(p.opacity, 1);
          ctx.globalCompositeOperation = BLEND[(p.blend as CompBlendMode) ?? 'normal'] ?? 'source-over';
          ctx.drawImage(layer, 0, 0);
        }
        break;
      }
      case 'fx': {
        const src = input(node, 'input');
        if (!src) break;
        const stack = (node.fxStack ?? []).map((entry) => ({ ...entry, params: resolveParamsAtTime(entry, timeSeconds) }));
        const renderer = stack.length ? getSharedFxRenderer() : null;
        if (renderer) {
          try {
            ctx.drawImage(renderer.render(src, stack, { frameIndex: Math.floor(timeSeconds * comp.fps), time: timeSeconds, width, height }) as CanvasImageSource, 0, 0, width, height);
            break;
          } catch (error) {
            console.warn('[fusion] fx node skipped', error);
          }
        }
        ctx.drawImage(src, 0, 0);
        break;
      }
      case 'mask': {
        const src = input(node, 'input');
        const cx = num(p.cx, 0.5) * width;
        const cy = num(p.cy, 0.5) * height;
        const w = (num(p.w, 0.5) * width) / 2;
        const h = (num(p.h, 0.5) * height) / 2;
        const feather = Math.max(0.001, num(p.feather, 0.05)) * Math.max(width, height);
        const shape = make();
        const sctx = shape.getContext('2d')!;
        sctx.filter = `blur(${feather.toFixed(1)}px)`;
        sctx.fillStyle = '#fff';
        sctx.beginPath();
        if (p.shape === 'rectangle') sctx.rect(cx - w, cy - h, w * 2, h * 2);
        else sctx.ellipse(cx, cy, w, h, 0, 0, Math.PI * 2);
        sctx.fill();
        if (p.invert) {
          const inverted = make();
          const ictx = inverted.getContext('2d')!;
          ictx.fillStyle = '#fff';
          ictx.fillRect(0, 0, width, height);
          ictx.globalCompositeOperation = 'destination-out';
          ictx.drawImage(shape, 0, 0);
          sctx.filter = 'none';
          sctx.clearRect(0, 0, width, height);
          sctx.drawImage(inverted, 0, 0);
        }
        if (src) {
          ctx.drawImage(src, 0, 0);
          ctx.globalCompositeOperation = 'destination-in';
        }
        ctx.drawImage(shape, 0, 0);
        break;
      }
      case 'output': {
        ctx.fillStyle = comp.background;
        ctx.fillRect(0, 0, width, height);
        const src = input(node, 'input');
        if (src) ctx.drawImage(src, 0, 0);
        break;
      }
    }
    results.set(id, canvas);
  }
  return results.get(options.nodeId ?? comp.outputNodeId) ?? make();
}
