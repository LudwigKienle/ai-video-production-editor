/**
 * Draws the start animation on an OffscreenCanvas off the main thread, so the
 * app's first render (which runs in parallel) cannot make it stutter. The
 * clock is shared with the page through `performance.timeOrigin`.
 */
import { renderSplashFrame, type SplashOptions } from './renderSplashFrame.ts';

type InitMessage = {
  type: 'init';
  canvas: OffscreenCanvas;
  /** Epoch ms (timeOrigin + performance.now()) at animation start. */
  startEpoch: number;
  size: { w: number; h: number; dpr: number };
  options: Omit<SplashOptions, 'width' | 'height'>;
};
type ResizeMessage = { type: 'resize'; size: { w: number; h: number; dpr: number } };
type StopMessage = { type: 'stop' };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<InitMessage | ResizeMessage | StopMessage>) => void) | null;
  postMessage: (message: unknown) => void;
  requestAnimationFrame?: (cb: () => void) => number;
};

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let init: InitMessage | null = null;
let size = { w: 0, h: 0, dpr: 1 };
let stopped = false;

const applySize = (next: { w: number; h: number; dpr: number }) => {
  size = next;
  if (!canvas) return;
  canvas.width = Math.max(1, Math.round(next.w * next.dpr));
  canvas.height = Math.max(1, Math.round(next.h * next.dpr));
};

const nextFrame = (cb: () => void) => (scope.requestAnimationFrame ? scope.requestAnimationFrame(cb) : setTimeout(cb, 1000 / 60));

const frame = () => {
  if (stopped || !ctx || !init) return;
  const t = (performance.timeOrigin + performance.now() - init.startEpoch) / 1000;
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  const info = renderSplashFrame(ctx as unknown as CanvasRenderingContext2D, t, { ...init.options, width: size.w, height: size.h });
  if (info.done) { scope.postMessage({ type: 'done' }); return; }
  nextFrame(frame);
};

scope.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    init = msg;
    canvas = msg.canvas;
    ctx = canvas.getContext('2d');
    if (!ctx) { scope.postMessage({ type: 'error', message: 'no 2d context' }); return; }
    applySize(msg.size);
    frame();
  } else if (msg.type === 'resize') {
    applySize(msg.size);
  } else if (msg.type === 'stop') {
    stopped = true;
  }
};
