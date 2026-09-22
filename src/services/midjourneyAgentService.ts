import { MediaItem } from '../types';
import { getBase64FromUrl } from '../utils/helpers';

/**
 * Renderer-side face of "Jeff", the Midjourney browser agent that lives in the
 * Electron main process (electron/midjourney-agent.js). Midjourney has no API, so
 * Jeff drives midjourney.com in a persistent hidden window with the user's own
 * sign-in. Everything here is a thin wrapper plus the mapping from project
 * references to Midjourney's reference parameters.
 */

export type MidjourneyRefRole = 'character' | 'style' | 'image';

export type MidjourneyReference = {
  url: string;
  name?: string;
  role: MidjourneyRefRole;
};

export type MidjourneyStatus = {
  available: boolean;
  connected: boolean;
  busy?: boolean;
  visible?: boolean;
  error?: string | null;
};

export type MidjourneyJobEvent = {
  type: 'job' | 'status' | 'window';
  id?: string;
  phase?: 'starting' | 'uploading' | 'submitting' | 'queued' | 'rendering' | 'downloading' | 'done';
  jobId?: string;
  percent?: number | null;
  count?: number;
  name?: string;
  prompt?: string;
  fullPrompt?: string;
  connected?: boolean;
  visible?: boolean;
};

type MidjourneyBridge = {
  status: (payload?: { refresh?: boolean }) => Promise<{ connected: boolean; error?: string | null; visible?: boolean; busy?: boolean }>;
  connect: () => Promise<{ connected: boolean; error?: string | null }>;
  disconnect: () => Promise<{ connected: boolean }>;
  toggleWindow: (payload: { show: boolean }) => Promise<{ visible: boolean }>;
  generate: (payload: {
    prompt: string;
    aspectRatio?: string;
    refs?: Array<{ base64: string; mimeType: string; name?: string; role: MidjourneyRefRole }>;
    folderPath?: string | null;
    extraParams?: string;
  }) => Promise<{ ok: true; jobId: string; prompt: string; images: Array<{ index: number; url: string; cdnUrl: string; relativePath: string | null }> }>;
  onEvent: (callback: (event: MidjourneyJobEvent) => void) => () => void;
};

// The Window.electron typing is declared twice in this codebase (electron.d.ts vs. an older shape); read through any like the other runtime services do.
const api = (): MidjourneyBridge | undefined => (typeof window !== 'undefined' ? (window as any).electron?.midjourney : undefined);

export const isMidjourneyAgentAvailable = () => Boolean(api());

export const getMidjourneyStatus = async (refresh = false): Promise<MidjourneyStatus> => {
  const bridge = api();
  if (!bridge) return { available: false, connected: false, error: 'Jeff runs only in the desktop app.' };
  try {
    const result = await bridge.status({ refresh });
    return { available: true, connected: result.connected, busy: result.busy, visible: result.visible, error: result.error || null };
  } catch (error) {
    return { available: true, connected: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export const connectMidjourney = async (): Promise<MidjourneyStatus> => {
  const bridge = api();
  if (!bridge) return { available: false, connected: false, error: 'Jeff runs only in the desktop app.' };
  const result = await bridge.connect();
  return { available: true, connected: result.connected, error: result.error || null };
};

export const disconnectMidjourney = async (): Promise<MidjourneyStatus> => {
  const bridge = api();
  if (!bridge) return { available: false, connected: false };
  const result = await bridge.disconnect();
  return { available: true, connected: result.connected };
};

export const toggleMidjourneyWindow = async (show: boolean) => {
  const bridge = api();
  if (!bridge) return { visible: false };
  return bridge.toggleWindow({ show });
};

export const onMidjourneyEvent = (callback: (event: MidjourneyJobEvent) => void): (() => void) => {
  const bridge = api();
  if (!bridge) return () => undefined;
  return bridge.onEvent(callback);
};

/** Midjourney accepts these aspect ratios; anything wider becomes 21:9. */
const toMidjourneyAspect = (aspectRatio?: string): string | undefined => {
  if (!aspectRatio) return undefined;
  const normalized = aspectRatio.replace(/\s/g, '');
  if (['16:9', '9:16', '4:3', '3:4', '1:1', '3:2', '2:3', '21:9'].includes(normalized)) return normalized;
  if (/^2\.39:1$|^2\.35:1$|^235:100$|^239:100$/.test(normalized)) return '21:9';
  return '16:9';
};

/**
 * Run one Midjourney job and return its four images as MediaItems.
 * The first item carries all four urls in `imageVersions` so callers that only
 * take a single image still keep the whole grid.
 */
export const generateImagesWithMidjourney = async (
  prompt: string,
  options: {
    aspectRatio?: string;
    references?: MidjourneyReference[];
    folderPath?: string | null;
    extraParams?: string;
  } = {},
): Promise<MediaItem[]> => {
  const bridge = api();
  if (!bridge) throw new Error('Midjourney (Jeff) is only available in the desktop app.');
  const refs = await Promise.all(
    (options.references || []).slice(0, 6).map(async (ref) => {
      const data = await getBase64FromUrl(ref.url);
      return { base64: data.base64, mimeType: data.mimeType, name: ref.name || 'reference.png', role: ref.role };
    }),
  );
  const result = await bridge.generate({
    prompt,
    aspectRatio: toMidjourneyAspect(options.aspectRatio),
    refs,
    folderPath: options.folderPath ?? null,
    extraParams: options.extraParams,
  });
  const stamp = Date.now();
  const versions = result.images.map((image) => image.url);
  return result.images.map((image, index) => ({
    id: `midjourney-${result.jobId}-${index}-${stamp}`,
    name: `midjourney_${result.jobId.slice(0, 8)}_${index}.png`,
    type: 'image' as const,
    url: image.url,
    sourceUrl: image.cdnUrl,
    source: 'generated' as const,
    generatedBy: 'Midjourney · Jeff',
    prompt: result.prompt,
    imageVersions: index === 0 ? versions : undefined,
    selectedVersionIndex: index === 0 ? 0 : undefined,
  }));
};
