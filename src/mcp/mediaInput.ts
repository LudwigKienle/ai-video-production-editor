/**
 * Media inputs for MCP tools. Agents pass an https URL, a data URL, a local
 * path (the MCP server turns `imagePath`/`videoPath`/`audioPath` into file://
 * URLs) or the id of a media bin item; services want base64 payloads.
 */
import type { StudioToolContext } from './toolModules.ts';

export type Base64Payload = { base64: string; mimeType: string };

const toBase64 = (bytes: Uint8Array): string => {
  const B = (globalThis as { Buffer?: { from: (b: Uint8Array) => { toString: (enc: string) => string } } }).Buffer;
  if (B) return B.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const guessMime = (url: string, fallback: string) => {
  const ext = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac',
  };
  return map[ext] ?? fallback;
};

export function parseDataUrl(url: string): Base64Payload | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!match) return null;
  const mimeType = match[1] || 'application/octet-stream';
  if (match[2]) return { base64: match[3], mimeType };
  return { base64: toBase64(new TextEncoder().encode(decodeURIComponent(match[3]))), mimeType };
}

/** Loads any URL (data:, file:, blob:, http[s]:) into a base64 payload. */
export async function urlToPayload(url: string, fallbackMime = 'application/octet-stream'): Promise<Base64Payload> {
  const parsed = parseDataUrl(url);
  if (parsed) return parsed;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
  const mimeType = response.headers.get('content-type')?.split(';')[0] || guessMime(url, fallbackMime);
  return { base64: toBase64(new Uint8Array(await response.arrayBuffer())), mimeType };
}

export const payloadToDataUrl = (payload: Base64Payload) => `data:${payload.mimeType};base64,${payload.base64}`;

/**
 * Resolves the first given source among `<prefix>Url`, `<prefix>Path` and
 * `<prefix>MediaId` (a media bin item) to a URL. Returns null if none is set.
 */
export function pickMediaUrl(ctx: StudioToolContext, args: Record<string, unknown>, prefix: string): string | null {
  const url = args[`${prefix}Url`];
  if (typeof url === 'string' && url.trim()) return url.trim();
  const path = args[`${prefix}Path`];
  if (typeof path === 'string' && path.trim()) {
    const value = path.trim();
    return /^[a-z]+:/i.test(value) ? value : `file://${value}`;
  }
  const mediaId = args[`${prefix}MediaId`];
  if (typeof mediaId === 'string' && mediaId.trim()) {
    const item = ctx.getState().mediaItems.find((entry) => entry.id === mediaId.trim());
    if (!item) throw new Error(`Media item ${mediaId} not found.`);
    return item.url;
  }
  return null;
}

/** JSON-schema properties for a media input named `prefix` (url, path, media bin id). */
export const mediaInputSchema = (prefix: string, what: string) => ({
  [`${prefix}Url`]: { type: 'string' as const, description: `${what}: https URL or data URL.` },
  [`${prefix}Path`]: { type: 'string' as const, description: `${what}: local file path.` },
  [`${prefix}MediaId`]: { type: 'string' as const, description: `${what}: id of a media bin item.` },
});
