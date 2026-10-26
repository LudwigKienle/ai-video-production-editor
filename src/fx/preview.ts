/**
 * Timeline/photo preview helper: runs a clip's FX stack on the shared WebGL2
 * renderer and returns something `drawImage` can use. Falls back to the
 * untouched source when WebGL2 is missing or a shader fails, so playback
 * never breaks because of an effect.
 */
import { OfxPreviewCache } from './ofx.ts';
import { hasActiveFx, needsNativeHost } from './registry.ts';
import { getSharedFxRenderer } from './renderer.ts';
import type { FxStack } from './types.ts';

export const FX_DEFAULT_FPS = 24;
/** Preview cap; export renders at full source resolution (up to 4096). */
const PREVIEW_MAX_DIMENSION = 2560;

const warned = new Set<string>();

/** Fired when an asynchronous (OFX) preview frame is ready; previews redraw on it. */
export const FX_PREVIEW_UPDATED_EVENT = 'avpe:fx-preview-updated';

const notifyPreview = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(FX_PREVIEW_UPDATED_EVENT));
};

// One async preview cache per stack (keyed by its instance ids) for OFX effects.
const ofxCaches = new Map<string, OfxPreviewCache>();

export function fxFrameIndex(timeSeconds: number, fps = FX_DEFAULT_FPS): number {
  return Math.max(0, Math.floor(timeSeconds * fps + 1e-6));
}

const naturalSize = (source: CanvasImageSource): { width: number; height: number } => {
  const s = source as unknown as Record<string, number>;
  return {
    width: s.videoWidth || s.naturalWidth || s.displayWidth || s.width || 0,
    height: s.videoHeight || s.naturalHeight || s.displayHeight || s.height || 0,
  };
};

export function applyFxStack(
  source: CanvasImageSource,
  stack: FxStack | undefined | null,
  timeSeconds: number,
  options: { fps?: number; maxDimension?: number } = {},
): CanvasImageSource {
  if (!hasActiveFx(stack)) return source;
  const { width, height } = naturalSize(source);
  if (!width || !height) return source;
  if (needsNativeHost(stack)) {
    const key = stack.map((entry) => entry.id).join('|');
    let cache = ofxCaches.get(key);
    if (!cache) {
      if (ofxCaches.size > 32) ofxCaches.clear();
      cache = new OfxPreviewCache(notifyPreview);
      ofxCaches.set(key, cache);
    }
    // Until the host answers the untouched frame is shown.
    return cache.get(source, stack, fxFrameIndex(timeSeconds, options.fps), width, height) ?? source;
  }
  const renderer = getSharedFxRenderer();
  if (!renderer) return source;
  const max = options.maxDimension ?? PREVIEW_MAX_DIMENSION;
  const scale = Math.min(1, max / Math.max(width, height));
  try {
    return renderer.render(source as TexImageSource, stack, {
      frameIndex: fxFrameIndex(timeSeconds, options.fps),
      time: timeSeconds,
      quality: 'preview',
      width: Math.round(width * scale),
      height: Math.round(height * scale),
    }) as CanvasImageSource;
  } catch (error) {
    const key = error instanceof Error ? error.message : String(error);
    if (!warned.has(key)) {
      warned.add(key);
      console.warn('[fx] effect stack skipped in preview', error);
    }
    return source;
  }
}
