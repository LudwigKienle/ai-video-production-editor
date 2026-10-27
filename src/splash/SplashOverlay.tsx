/**
 * Full-window start animation on a canvas. Renders immediately, does not block
 * the app (it mounts above it while the app loads underneath), DPR-sharp,
 * skippable with click, Esc, Space or Enter. With prefers-reduced-motion it
 * shows a short static logo fade instead of the flight.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { renderSplashFrame, splashDuration, type SplashVariant } from './renderSplashFrame.ts';
import { playStartSound, type StartSoundHandle } from './startSoundPlayer.ts';
import type { WordmarkMode } from '../brand/brandTokens.ts';

export type SplashOverlayProps = {
  variant: SplashVariant;
  sound: boolean;
  volume: number;
  wordmark?: WordmarkMode;
  /** Force reduced motion (otherwise read from the media query). */
  reducedMotion?: boolean;
  /** Resolved background: 'dark' (near-black) or 'light' (cream). */
  background?: 'dark' | 'light';
  onDone: () => void;
};

const SKIP_KEYS = new Set(['Escape', ' ', 'Spacebar', 'Enter']);
const LEAVE_MS = 240;

const prefersReducedMotion = (): boolean => {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export default function SplashOverlay({ variant, sound, volume, wordmark, reducedMotion, background, onDone }: SplashOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(onDone);
  const skipRef = useRef<() => void>(() => undefined);
  doneRef.current = onDone;
  const reduced = reducedMotion ?? prefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) { doneRef.current(); return undefined; }
    // Preferred: draw in a worker on an OffscreenCanvas, so the app's first render cannot stall it.
    let worker: Worker | null = null;
    if (typeof canvas.transferControlToOffscreen === 'function' && typeof Worker !== 'undefined') {
      try {
        worker = new Worker(new URL('./splashFrame.worker.ts', import.meta.url), { type: 'module' });
      } catch {
        worker = null;
      }
    }
    const ctx = worker ? null : canvas.getContext('2d');
    if (!worker && !ctx) { doneRef.current(); return undefined; }
    let raf = 0;
    let finished = false;
    let soundHandle: StartSoundHandle | null = null;
    // Start the clock with the first frame the user can see (set again when the overlay has painted).
    let start = performance.now();
    let size = { w: 0, h: 0, dpr: 1 };

    const resize = () => {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = window.innerWidth, h = window.innerHeight;
      if (w === size.w && h === size.h && dpr === size.dpr) return;
      size = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };

    const finish = (skipped: boolean) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      worker?.postMessage({ type: 'stop' });
      if (!skipped) worker?.terminate();
      if (skipped) {
        soundHandle?.stop();
        setLeaving(true);
        window.setTimeout(() => doneRef.current(), LEAVE_MS);
      } else {
        doneRef.current();
      }
    };

    const frame = () => {
      if (!ctx) return;
      resize();
      const t = (performance.now() - start) / 1000;
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      const info = renderSplashFrame(ctx, t, { width: size.w, height: size.h, variant, wordmark, reducedMotion: reduced, background });
      if (info.done) { finish(false); return; }
      raf = requestAnimationFrame(frame);
    };
    skipRef.current = () => finish(true);
    const onResize = () => {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      worker?.postMessage({ type: 'resize', size: { w: window.innerWidth, h: window.innerHeight, dpr } });
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };
    const begin = () => {
      if (finished) return;
      start = performance.now();
      if (worker) startWorker(); else frame();
      if (sound && !reduced) {
        void playStartSound({ volume, startedAt: start }).then((handle) => {
          if (finished && handle.played) handle.stop();
          soundHandle = handle;
        });
      }
    };
    const startWorker = () => {
      if (!worker) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const offscreen = canvas.transferControlToOffscreen();
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      worker.onmessage = (event: MessageEvent<{ type: string }>) => { if (event.data?.type === 'done') finish(false); };
      worker.onerror = () => finish(false);
      worker.postMessage({
        type: 'init',
        canvas: offscreen,
        startEpoch: performance.timeOrigin + start,
        size: { w: window.innerWidth, h: window.innerHeight, dpr },
        options: { variant, wordmark, reducedMotion: reduced, background },
      }, [offscreen]);
      window.addEventListener('resize', onResize);
    };
    // Two frames: the overlay (cream/black background) is on screen before the animation clock runs.
    raf = requestAnimationFrame(() => { raf = requestAnimationFrame(begin); });

    const onKey = (event: KeyboardEvent) => {
      if (!SKIP_KEYS.has(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    };
    window.addEventListener('keydown', onKey, true);
    const safety = window.setTimeout(() => finish(false), (splashDuration({ reducedMotion: reduced }) + 2) * 1000);
    return () => {
      finished = true;
      cancelAnimationFrame(raf);
      worker?.terminate();
      window.removeEventListener('resize', onResize);
      window.clearTimeout(safety);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [variant, sound, volume, wordmark, reduced, background]);

  const skip = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    skipRef.current();
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      role="presentation"
      aria-hidden="true"
      onMouseDown={skip}
      style={{
        position: 'fixed', inset: 0, zIndex: 2147483000, cursor: 'default',
        opacity: leaving ? 0 : 1, transition: `opacity ${LEAVE_MS}ms ease-out`,
        pointerEvents: leaving ? 'none' : 'auto',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>,
    document.body,
  );
}
