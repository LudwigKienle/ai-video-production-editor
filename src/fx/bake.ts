/**
 * Pre-export FX bake. Clips with a GPU effect stack are rendered frame by
 * frame through the same FxRenderer as the preview and written as ProRes /
 * PNG intermediates; the HQ FFmpeg export then reads those instead of the
 * original media. Returns a project copy — the user's project is untouched.
 */
import type { MediaItem, TimelineClip, TimelineTrack } from '../types';
import { hasActiveFx, isGpuRenderable, needsNativeHost, resolveParams } from './registry.ts';
import { nativePluginId, ofxBridge, renderStackAsync } from './ofx.ts';
import { FxRenderer } from './renderer.ts';
import { fxFrameIndex } from './preview.ts';

export type BakeProject = { timelineClips: TimelineClip[]; timelineTracks: TimelineTrack[]; mediaItems: MediaItem[] };

export type BakeProgress = { clipIndex: number; clipCount: number; frame: number; frameCount: number; note: string };

type FxBridge = NonNullable<Window['electron']['fx']>;

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/** Copy of a media item pointing at a baked file (drops project-relative paths). */
const bakedMedia = (media: MediaItem, id: string, url: string, extra: Partial<MediaItem> = {}): MediaItem => {
  const copy = { ...media, ...extra, id, url, sourceUrl: url, name: `${media.name} (FX)` } as MediaItem & { path?: string };
  delete copy.path;
  return copy;
};

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image ${url}`));
    img.src = url;
  });

const loadVideo = (url: string) =>
  new Promise<HTMLVideoElement>((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.onloadeddata = () => resolve(video);
    video.onerror = () => reject(new Error(`Could not load video ${url}`));
    video.src = url;
  });

const seek = (video: HTMLVideoElement, time: number) =>
  new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`Seek to ${time.toFixed(3)}s timed out`)), 15000);
    const done = () => {
      window.clearTimeout(timeout);
      // requestVideoFrameCallback guarantees the decoded frame is presentable.
      const rvfc = (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback;
      if (rvfc) rvfc.call(video, () => resolve());
      else resolve();
    };
    if (Math.abs(video.currentTime - time) < 1e-4 && video.readyState >= 2) {
      done();
      return;
    }
    video.addEventListener('seeked', done, { once: true });
    video.currentTime = time;
  });

const rgbaToPng = async (pixels: Uint8ClampedArray, width: number, height: number): Promise<Uint8Array> => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  return new Uint8Array(await blob.arrayBuffer());
};

export function clipsNeedingBake(project: BakeProject): TimelineClip[] {
  return project.timelineClips.filter((clip) => hasActiveFx(clip.fxStack) && (isGpuRenderable(clip.fxStack) || needsNativeHost(clip.fxStack)));
}

/**
 * OFX chain for a stack rendered entirely on the native host. GPU ports map to
 * their original plugin (same parameter names), so mixed stacks keep one
 * consistent render path in export.
 */
export function nativeChainFor(clip: TimelineClip): Array<{ pluginId: string; params: Record<string, unknown> }> {
  return (clip.fxStack ?? [])
    .filter((entry) => entry.enabled && (entry.mix ?? 1) > 0.0001)
    .map((entry) => {
      const pluginId = nativePluginId(entry.effectId);
      if (!pluginId) throw new Error(`Effekt ${entry.effectId} hat kein OFX-Gegenstück für den Export.`);
      if ((entry.mix ?? 1) < 0.9999) throw new Error(`Mix < 100 % wird im OFX-Export noch nicht unterstützt (${entry.effectId}).`);
      return { pluginId, params: resolveParams(entry) };
    });
}

export async function bakeFxForExport(
  project: BakeProject,
  options: { folderPath: string; fps: number; signal?: AbortSignal; onProgress?: (progress: BakeProgress) => void },
): Promise<BakeProject> {
  const targets = clipsNeedingBake(project);
  if (targets.length === 0) return project;
  const bridge: FxBridge | undefined = window.electron?.fx;
  if (!bridge) throw new Error('FX bake needs the desktop app.');

  const renderer = new FxRenderer();
  const mediaById = new Map(project.mediaItems.map((item) => [item.id, item]));
  const newMedia: MediaItem[] = [];
  const replaced = new Map<string, Partial<TimelineClip>>();
  const fps = Math.max(1, options.fps || 24);

  try {
    for (let clipIndex = 0; clipIndex < targets.length; clipIndex += 1) {
      const clip = targets[clipIndex];
      const media = mediaById.get(clip.mediaId);
      if (!media || media.type === 'audio') continue;
      const stack = clip.fxStack!;
      const name = `${clip.id}-${Date.now().toString(36)}`;
      const report = (frame: number, frameCount: number, note: string) =>
        options.onProgress?.({ clipIndex, clipCount: targets.length, frame, frameCount, note });

      const native = needsNativeHost(stack);

      if (media.type === 'image') {
        report(0, 1, `FX: ${media.name}`);
        const img = await loadImage(media.url);
        let png: Uint8Array;
        if (native) {
          const canvas = await renderStackAsync(img, stack, { width: img.naturalWidth, height: img.naturalHeight, frameIndex: 0 });
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
          if (!blob) throw new Error('PNG encoding failed');
          png = new Uint8Array(await blob.arrayBuffer());
        } else {
          renderer.render(img, stack, { frameIndex: 0, time: 0, quality: 'full' });
          const { width, height } = renderer.canvas;
          png = await rgbaToPng(renderer.readPixels(), width, height);
        }
        const result = await bridge.bakeImage({ folderPath: options.folderPath, name, bytes: png });
        if (!result.ok || !result.url) throw new Error(result.error || 'Image bake failed');
        const id = `${media.id}__fx_${clip.id}`;
        newMedia.push(bakedMedia(media, id, result.url));
        replaced.set(clip.id, { mediaId: id, fxStack: undefined });
        report(1, 1, `FX: ${media.name}`);
        continue;
      }

      if (native) {
        const ofx = ofxBridge();
        if (!ofx) throw new Error('OFX-Export braucht die Desktop-App.');
        const source = await bridge.resolveSource({ folderPath: options.folderPath, media });
        if (!source.ok || !source.path) throw new Error(source.error || `Quelle von ${media.name} fehlt.`);
        const target = await bridge.bakeDir({ folderPath: options.folderPath, name, extension: 'mov' });
        if (!target.ok || !target.path || !target.url) throw new Error(target.error || 'Bake-Ordner nicht verfügbar.');
        const sourceIn = Math.max(0, clip.sourceIn ?? 0);
        const duration = Math.max(1 / fps, (clip.sourceOut ?? sourceIn + clip.duration * (clip.speed || 1)) - sourceIn);
        const jobId = `${clip.id}-${Date.now().toString(36)}`;
        const off = ofx.onBakeProgress?.((progress) => {
          if (progress.jobId === jobId) report(progress.frame ?? 0, progress.totalFrames ?? 1, `OFX: ${media.name}`);
        });
        const abort = () => void ofx.cancelBake?.({ jobId });
        options.signal?.addEventListener('abort', abort);
        try {
          const result = await ofx.bake({
            jobId,
            input: source.path,
            output: target.path,
            chain: nativeChainFor(clip) as Array<{ pluginId: string; params: Record<string, number | boolean | string> }>,
            codec: 'prores_hq',
            startTime: sourceIn,
            duration,
            fps,
            audio: true,
          });
          if (!result.ok) throw new Error(result.error || 'OFX bake failed');
        } finally {
          off?.();
          options.signal?.removeEventListener('abort', abort);
        }
        const id = `${media.id}__fx_${clip.id}`;
        newMedia.push(bakedMedia(media, id, target.url, { duration }));
        replaced.set(clip.id, { mediaId: id, fxStack: undefined, sourceIn: 0, sourceOut: duration });
        continue;
      }

      const video = await loadVideo(media.url);
      const sourceIn = Math.max(0, clip.sourceIn ?? 0);
      const sourceOut = Math.min(video.duration || Infinity, clip.sourceOut ?? sourceIn + clip.duration * (clip.speed || 1));
      const duration = Math.max(1 / fps, sourceOut - sourceIn);
      const frameCount = Math.max(1, Math.round(duration * fps));
      const width = even(Math.min(4096, video.videoWidth));
      const height = even(Math.min(4096, Math.round((video.videoHeight * width) / video.videoWidth)));
      const begin = await bridge.bakeVideoBegin({
        folderPath: options.folderPath,
        name,
        width,
        height,
        fps,
        audioMedia: media,
        audioStart: sourceIn,
        audioDuration: duration,
      });
      if (!begin.ok || !begin.sessionId) throw new Error(begin.error || 'Could not start FX bake');
      const sessionId = begin.sessionId;
      try {
        for (let frame = 0; frame < frameCount; frame += 1) {
          if (options.signal?.aborted) throw new DOMException('Export canceled', 'AbortError');
          const localTime = frame / fps;
          await seek(video, Math.min(sourceOut - 1e-3, sourceIn + localTime + 0.5 / fps));
          renderer.render(video, stack, { frameIndex: fxFrameIndex(sourceIn + localTime, fps), time: localTime, quality: 'full', width, height });
          const pixels = renderer.readPixels();
          const sent = await bridge.bakeVideoFrame({ sessionId, pixels: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength) });
          if (!sent.ok) throw new Error(sent.error || 'Frame upload failed');
          if (frame % 4 === 0) report(frame, frameCount, `FX: ${media.name}`);
        }
      } catch (error) {
        await bridge.bakeVideoEnd({ sessionId, cancel: true });
        throw error;
      }
      const end = await bridge.bakeVideoEnd({ sessionId });
      if (!end.ok || !end.url) throw new Error(end.error || 'FX bake failed');
      const id = `${media.id}__fx_${clip.id}`;
      newMedia.push(bakedMedia(media, id, end.url, { duration }));
      // The baked file starts at the clip's source-in point.
      replaced.set(clip.id, { mediaId: id, fxStack: undefined, sourceIn: 0, sourceOut: duration });
      report(frameCount, frameCount, `FX: ${media.name}`);
      video.removeAttribute('src');
      video.load();
    }
  } finally {
    renderer.dispose();
  }

  return {
    ...project,
    mediaItems: [...project.mediaItems, ...newMedia],
    timelineClips: project.timelineClips.map((clip) => (replaced.has(clip.id) ? { ...clip, ...replaced.get(clip.id) } : clip)),
  };
}
