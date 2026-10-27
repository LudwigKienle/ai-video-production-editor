/**
 * "Rendern → Medien": evaluates the composition frame by frame with the
 * shared Canvas evaluator and writes the result into the project.
 *
 * Desktop app with a saved project: animated comps go through the FX bake
 * pipe (`window.electron.fx.bakeVideoBegin/Frame/End`, ProRes intermediate),
 * stills through `bakeImage` (PNG). Browser mode / unsaved project: a PNG of
 * the current frame as data URL.
 */
import type { MediaItem } from '../../types';
import type { Composition } from '../fusion-shared/compModel';
import { compIsAnimated, frameToTime, timeToFrame, type CompRange } from '../fusion-shared/compModelExt';
import { renderComposition } from '../fusion-shared/renderComp';
import { createExportMedia } from './mediaResolver';

export type RenderProgress = { frame: number; frameCount: number; note: string };

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

const canvasToPngBytes = (canvas: HTMLCanvasElement) =>
  new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('PNG konnte nicht erzeugt werden'));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });

const resultId = (comp: Composition) => `fusion-${comp.id}-${Date.now().toString(36)}`;

export async function renderCompToMedia(
  comp: Composition,
  options: {
    mediaItems: MediaItem[];
    projectPath?: string | null;
    range: CompRange;
    time: number;
    signal?: AbortSignal;
    onProgress?: (progress: RenderProgress) => void;
  },
): Promise<MediaItem> {
  const width = even(comp.width);
  const height = even(comp.height);
  const mediaType = (id: string) => options.mediaItems.find((item) => item.id === id)?.type;
  const bridge = typeof window !== 'undefined' ? window.electron?.fx : undefined;
  const folderPath = options.projectPath?.trim() || '';
  const animated = compIsAnimated(comp, mediaType) && options.range.end > options.range.start;
  const media = await createExportMedia(comp, options.mediaItems);
  const base = { name: `${comp.name} (Fusion)`, source: 'generated' as const, generatedBy: 'Fusion' };

  try {
    // Still (or no desktop bake available): one PNG.
    if (!animated || !bridge || !folderPath) {
      const t = animated ? options.time : options.range.start <= options.time && options.time <= options.range.end ? options.time : options.range.start;
      await media.prepare(t);
      const canvas = renderComposition(comp, t, media.resolve, { width, height });
      options.onProgress?.({ frame: 1, frameCount: 1, note: 'Standbild' });
      if (bridge && folderPath) {
        const saved = await bridge.bakeImage({ folderPath, name: resultId(comp), bytes: await canvasToPngBytes(canvas) });
        if (!saved.ok || !saved.url) throw new Error(saved.error || 'PNG konnte nicht gespeichert werden');
        return { ...base, id: resultId(comp), type: 'image', url: saved.url };
      }
      return { ...base, id: resultId(comp), type: 'image', url: canvas.toDataURL('image/png') };
    }

    const first = timeToFrame(comp, options.range.start);
    const last = timeToFrame(comp, options.range.end);
    const frameCount = Math.max(1, last - first + 1);
    const begin = await bridge.bakeVideoBegin({ folderPath, name: resultId(comp), width, height, fps: comp.fps });
    if (!begin.ok || !begin.sessionId) throw new Error(begin.error || 'Render konnte nicht gestartet werden');
    const sessionId = begin.sessionId;
    try {
      for (let index = 0; index < frameCount; index += 1) {
        if (options.signal?.aborted) throw new DOMException('Render abgebrochen', 'AbortError');
        const t = frameToTime(comp, first + index);
        await media.prepare(t);
        const canvas = renderComposition(comp, t, media.resolve, { width, height });
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
        const sent = await bridge.bakeVideoFrame({ sessionId, pixels: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength) });
        if (!sent.ok) throw new Error(sent.error || 'Frame-Upload fehlgeschlagen');
        if (index % 4 === 0 || index === frameCount - 1) options.onProgress?.({ frame: index + 1, frameCount, note: comp.name });
      }
    } catch (error) {
      await bridge.bakeVideoEnd({ sessionId, cancel: true }).catch(() => undefined);
      throw error;
    }
    const end = await bridge.bakeVideoEnd({ sessionId });
    if (!end.ok || !end.url) throw new Error(end.error || 'Render fehlgeschlagen');
    return { ...base, id: resultId(comp), type: 'video', url: end.url, duration: frameCount / Math.max(1, comp.fps) };
  } finally {
    media.dispose();
  }
}
