/**
 * Sound runtime: decodes media for the mix engine and stores rendered files.
 *
 * The browser/Electron runtime decodes with Web Audio (`decodeAudioData`
 * resamples to the engine rate) and writes files through the project API.
 * Tests (Node) install a fake runtime with `setSoundRuntime`.
 */

import type { EngineSource } from './mixEngine.ts';

export const ENGINE_SAMPLE_RATE = 48000;

export type RuntimeMedia = { id: string; type: string; url: string; name?: string };

export type SoundRuntime = {
  /** Decoded audio of a media item at ENGINE_SAMPLE_RATE, or null (no audio / not decodable). */
  decode: (media: RuntimeMedia) => Promise<EngineSource | null>;
  /** Writes bytes into the project folder; returns an absolute path and a URL the editor can load. */
  writeProjectFile?: (projectPath: string, relativePath: string, bytes: Uint8Array) => Promise<{ path: string; url: string }>;
  /** URL for in-memory media when there is no project folder. */
  createObjectUrl?: (bytes: Uint8Array, mimeType: string) => string;
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
};

const toFileUrl = (absolutePath: string): string =>
  `file://${absolutePath.split('/').map((part) => encodeURIComponent(part)).join('/')}`;

export const createBrowserRuntime = (): SoundRuntime => ({
  decode: async (media) => {
    if (media.type !== 'audio' && media.type !== 'video') return null;
    const Ctx = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (!Ctx || typeof fetch !== 'function') return null;
    const response = await fetch(media.url);
    if (!response.ok) throw new Error(`Audio konnte nicht geladen werden (${response.status}).`);
    const data = await response.arrayBuffer();
    const ctx = new Ctx(2, 1, ENGINE_SAMPLE_RATE);
    try {
      const buffer = await ctx.decodeAudioData(data);
      const channels: Float32Array[] = [];
      for (let ch = 0; ch < Math.min(2, buffer.numberOfChannels); ch++) channels.push(buffer.getChannelData(ch).slice());
      return { channels, sampleRate: buffer.sampleRate };
    } catch {
      // video files without an audio stream end up here
      return null;
    }
  },
  writeProjectFile: async (projectPath, relativePath, bytes) => {
    const api = (globalThis as { window?: { electron?: { project?: { writeProjectFile?: (p: unknown) => Promise<unknown> } } } }).window?.electron?.project;
    if (!api?.writeProjectFile) throw new Error('Dateien speichern geht nur in der Desktop-App.');
    await api.writeProjectFile({ folderPath: projectPath, relativePath, data: toBase64(bytes), encoding: 'base64' });
    const absolute = `${projectPath.replace(/\/+$/, '')}/${relativePath}`;
    return { path: absolute, url: toFileUrl(absolute) };
  },
  createObjectUrl: (bytes, mimeType) => {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return URL.createObjectURL(new Blob([copy.buffer], { type: mimeType }));
  },
});

let runtime: SoundRuntime = createBrowserRuntime();

export const getSoundRuntime = (): SoundRuntime => runtime;
export const setSoundRuntime = (next: SoundRuntime): void => {
  runtime = next;
  sourceCache.clear();
};

/**
 * Decoded sources by media id + url. `get` is synchronous for the engine
 * (null while decoding), `ensure` decodes what is missing.
 */
class SourceCache {
  private entries = new Map<string, { url: string; source: EngineSource | null; pending?: Promise<EngineSource | null> }>();

  get(mediaId: string): EngineSource | null {
    return this.entries.get(mediaId)?.source ?? null;
  }

  async ensure(media: RuntimeMedia[]): Promise<{ missing: string[] }> {
    const missing: string[] = [];
    await Promise.all(
      media.map(async (item) => {
        if (item.type !== 'audio' && item.type !== 'video') return;
        let entry = this.entries.get(item.id);
        if (!entry || entry.url !== item.url) {
          entry = { url: item.url, source: null };
          entry.pending = runtime.decode(item).catch(() => null);
          this.entries.set(item.id, entry);
        }
        if (entry.pending) {
          entry.source = await entry.pending;
          entry.pending = undefined;
        }
        if (!entry.source && item.type === 'audio') missing.push(item.name || item.id);
      }),
    );
    return { missing };
  }

  clear(): void {
    this.entries.clear();
  }
}

export const sourceCache = new SourceCache();
