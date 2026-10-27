/**
 * Media access for the composition viewers and the render-to-media export.
 *
 * Interactive: `useMediaResolver` keeps one <img>/<video> per media item and
 * seeks videos to the requested time; whenever a frame arrives (load,
 * seeked) the resolver function changes identity so viewers re-render.
 *
 * Export: `createExportMedia` loads every element once and seeks frame
 * accurately (awaiting `seeked`) before each frame is rendered.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MediaItem } from '../../types';
import type { Composition } from '../fusion-shared/compModel';
import type { MediaResolver } from '../fusion-shared/renderComp';

type Entry = { url: string; el: HTMLImageElement | HTMLVideoElement; kind: 'image' | 'video'; failed?: boolean };

const mediaUrl = (item: MediaItem) => item.url || item.sourceUrl || '';

const createElement = (item: MediaItem, onFrame: () => void, onFail: () => void): Entry | null => {
  const url = mediaUrl(item);
  if (!url || item.type === 'audio') return null;
  if (item.type === 'image') {
    const img = new Image();
    if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = onFrame;
    img.onerror = onFail;
    img.src = url;
    return { url, el: img, kind: 'image' };
  }
  const video = document.createElement('video');
  if (/^https?:/i.test(url)) video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.addEventListener('loadeddata', onFrame);
  video.addEventListener('seeked', onFrame);
  video.addEventListener('error', onFail);
  video.src = url;
  return { url, el: video, kind: 'video' };
};

const isReady = (entry: Entry) =>
  !entry.failed && (entry.kind === 'image' ? (entry.el as HTMLImageElement).complete && (entry.el as HTMLImageElement).naturalWidth > 0 : (entry.el as HTMLVideoElement).readyState >= 2);

export function useMediaResolver(mediaItems: MediaItem[], fps = 24): { resolveMedia: MediaResolver; version: number } {
  const cache = useRef(new Map<string, Entry>());
  const [version, setVersion] = useState(0);
  const pending = useRef(0);
  const bump = useCallback(() => {
    if (pending.current) return;
    pending.current = window.requestAnimationFrame(() => {
      pending.current = 0;
      setVersion((value) => value + 1);
    });
  }, []);

  useEffect(
    () => () => {
      if (pending.current) window.cancelAnimationFrame(pending.current);
      for (const entry of cache.current.values()) entry.el.removeAttribute('src');
      cache.current.clear();
    },
    [],
  );

  const byId = useMemo(() => new Map(mediaItems.map((item) => [item.id, item])), [mediaItems]);

  const resolveMedia = useCallback<MediaResolver>(
    (mediaId, timeSeconds) => {
      const item = byId.get(mediaId);
      if (!item) return null;
      let entry = cache.current.get(mediaId);
      if (entry && entry.url !== mediaUrl(item)) {
        entry.el.removeAttribute('src');
        entry = undefined;
      }
      if (!entry) {
        const created = createElement(item, bump, () => {
          const current = cache.current.get(mediaId);
          if (current) current.failed = true;
          bump();
        });
        if (!created) return null;
        cache.current.set(mediaId, created);
        entry = created;
      }
      if (entry.kind === 'video') {
        const video = entry.el as HTMLVideoElement;
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
        const target = Math.max(0, duration ? Math.min(duration - 0.001, timeSeconds) : timeSeconds);
        if (!video.seeking && Math.abs(video.currentTime - target) > 0.5 / Math.max(1, fps)) {
          try {
            video.currentTime = target;
          } catch {
            /* not seekable yet */
          }
        }
      }
      return isReady(entry) ? entry.el : null;
    },
    // version: a new function identity whenever a frame arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byId, bump, fps, version],
  );

  return { resolveMedia, version };
}

// ---------------------------------------------------------------- export

const waitFor = (target: EventTarget, events: string[], timeoutMs: number) =>
  new Promise<void>((resolve, reject) => {
    const done = (ok: boolean) => () => {
      clearTimeout(timer);
      events.forEach((name) => target.removeEventListener(name, onOk));
      target.removeEventListener('error', onErr);
      if (ok) resolve();
      else reject(new Error('Medium konnte nicht geladen werden'));
    };
    const onOk = done(true);
    const onErr = done(false);
    const timer = setTimeout(onOk, timeoutMs);
    events.forEach((name) => target.addEventListener(name, onOk, { once: true }));
    target.addEventListener('error', onErr, { once: true });
  });

export type ExportMedia = {
  /** Seeks all videos used by the comp for comp time `t`; resolves when frames are ready. */
  prepare(t: number): Promise<void>;
  resolve: MediaResolver;
  dispose(): void;
};

export async function createExportMedia(comp: Composition, mediaItems: MediaItem[]): Promise<ExportMedia> {
  const byId = new Map(mediaItems.map((item) => [item.id, item]));
  const entries = new Map<string, Entry>();
  const mediaNodes = comp.nodes.filter((node) => node.type === 'media' && node.mediaId);
  for (const node of mediaNodes) {
    const id = node.mediaId!;
    if (entries.has(id)) continue;
    const item = byId.get(id);
    if (!item) continue;
    const entry = createElement(item, () => undefined, () => undefined);
    if (!entry) continue;
    entries.set(id, entry);
    try {
      if (entry.kind === 'image') {
        if (!(entry.el as HTMLImageElement).complete) await waitFor(entry.el, ['load'], 15000);
      } else if ((entry.el as HTMLVideoElement).readyState < 2) await waitFor(entry.el, ['loadeddata'], 15000);
    } catch {
      entry.failed = true;
    }
  }
  return {
    async prepare(t) {
      for (const node of mediaNodes) {
        const entry = entries.get(node.mediaId!);
        if (!entry || entry.kind !== 'video' || entry.failed) continue;
        const video = entry.el as HTMLVideoElement;
        const local = Math.max(0, t - (node.inPoint ?? 0));
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
        const target = duration ? Math.min(duration - 0.001, local) : local;
        if (Math.abs(video.currentTime - target) < 1e-3 && video.readyState >= 2) continue;
        const seeked = waitFor(video, ['seeked'], 4000);
        video.currentTime = target;
        await seeked.catch(() => undefined);
      }
    },
    resolve: (mediaId) => {
      const entry = entries.get(mediaId);
      return entry && isReady(entry) ? entry.el : null;
    },
    dispose() {
      for (const entry of entries.values()) entry.el.removeAttribute('src');
      entries.clear();
    },
  };
}
