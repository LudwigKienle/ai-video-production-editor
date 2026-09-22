/**
 * Catalog-driven fal.ai video models.
 *
 * Instead of one hand-written function per endpoint, each entry declares the
 * endpoint paths and the input fields the endpoint accepts; a single generator in
 * falAiService builds the request from that. Field names follow fal's published
 * schemas for each vendor namespace (only known fields are sent — fal rejects
 * unknown ones).
 */

export type FalVideoCatalogEntry = {
  id: string;
  label: string;
  goodFor: string;
  badge?: string;
  /** Vendor namespace paths. `image` is used when a start frame is present, `text` otherwise. */
  paths: { text?: string; image?: string };
  imageField: 'image_url' | 'start_image_url' | 'first_frame_url';
  endField?: 'last_image_url' | 'end_image_url' | 'last_frame_url';
  aspectRatios: string[];
  /** When set, `aspect_ratio` is only sent for text-to-video (image-to-video infers it from the frame). */
  aspectOnlyForText?: boolean;
  resolutions?: string[];
  defaultResolution?: string;
  durations: number[];
  defaultDuration: number;
  /** Some vendors want "6" instead of 6. */
  durationAsString?: boolean;
  /** Endpoint has no duration input at all. */
  noDuration?: boolean;
  audioField?: { name: string; kind: 'boolean' | 'onoff' };
  supportsNegativePrompt?: boolean;
  extra?: Record<string, unknown>;
  /** USD per second of output, before margin. */
  costPerSecond: number;
  /** Rough render time used for progress estimates. */
  estimatedMs?: number;
};

export const FAL_VIDEO_CATALOG: FalVideoCatalogEntry[] = [
  {
    id: 'kling-v3-std-fal', label: 'Kling 3.0 Standard (FAL)', goodFor: 'Kling 3 with start + end frame and native audio at a lower price than Pro',
    paths: { text: 'fal-ai/kling-video/v3/standard/text-to-video', image: 'fal-ai/kling-video/v3/standard/image-to-video' },
    imageField: 'start_image_url', endField: 'end_image_url', aspectRatios: ['16:9', '9:16', '1:1'], aspectOnlyForText: true,
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], defaultDuration: 5, durationAsString: true,
    audioField: { name: 'generate_audio', kind: 'boolean' }, supportsNegativePrompt: true, extra: { cfg_scale: 0.5 }, costPerSecond: 0.1,
  },
  {
    id: 'kling-v3-4k-fal', label: 'Kling 3.0 4K (FAL)', goodFor: 'Kling 3 straight to 4K for hero shots', badge: '4K',
    paths: { text: 'fal-ai/kling-video/v3/4k/text-to-video', image: 'fal-ai/kling-video/v3/4k/image-to-video' },
    imageField: 'start_image_url', endField: 'end_image_url', aspectRatios: ['16:9', '9:16', '1:1'], aspectOnlyForText: true,
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], defaultDuration: 5, durationAsString: true,
    audioField: { name: 'generate_audio', kind: 'boolean' }, supportsNegativePrompt: true, extra: { cfg_scale: 0.5 }, costPerSecond: 0.2, estimatedMs: 6 * 60 * 1000,
  },
  {
    id: 'minimax-h3-fal', label: 'MiniMax H3 (FAL)', goodFor: 'Hailuo 3: 2K/4K frontier model with start + end frame; understands [Push in]-style camera commands',
    paths: { text: 'minimax/h3/text-to-video', image: 'minimax/h3/image-to-video' },
    imageField: 'image_url', endField: 'end_image_url', aspectRatios: ['16:9', '9:16', '1:1'], aspectOnlyForText: true,
    resolutions: ['768P', '2K', '4K'], defaultResolution: '2K', durations: [4, 5, 6, 8, 10], defaultDuration: 5,
    extra: { prompt_expansion_mode: 'disabled' }, costPerSecond: 0.08,
  },
  {
    id: 'hailuo-2.3-fal', label: 'MiniMax Hailuo 2.3 (FAL)', goodFor: 'Reliable 768p image-to-video with the Hailuo camera vocabulary', badge: '💸 Cheap',
    paths: { text: 'fal-ai/minimax/hailuo-2.3/standard/text-to-video', image: 'fal-ai/minimax/hailuo-2.3/standard/image-to-video' },
    imageField: 'image_url', aspectRatios: ['16:9'], aspectOnlyForText: true,
    durations: [6, 10], defaultDuration: 6, durationAsString: true, extra: { prompt_optimizer: false }, costPerSecond: 0.045,
  },
  {
    id: 'pixverse-v6-fal', label: 'PixVerse 6 (FAL)', goodFor: 'Stylised and anime motion, negative prompt, optional audio',
    paths: { text: 'fal-ai/pixverse/v6/text-to-video', image: 'fal-ai/pixverse/v6/image-to-video' },
    imageField: 'image_url', aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'], aspectOnlyForText: true,
    resolutions: ['540p', '720p', '1080p'], defaultResolution: '1080p', durations: [3, 4, 5, 6, 8, 10, 12, 15], defaultDuration: 5,
    audioField: { name: 'generate_audio_switch', kind: 'boolean' }, supportsNegativePrompt: true, costPerSecond: 0.06,
  },
  {
    id: 'ltx-2.5-pro-fal', label: 'LTX 2.5 Pro (FAL)', goodFor: 'High-fidelity takes with synchronized audio and an end frame; likes 4–8 detailed sentences',
    paths: { text: 'lightricks/ltx-2.5/text-to-video/pro', image: 'lightricks/ltx-2.5/image-to-video/pro' },
    imageField: 'image_url', endField: 'end_image_url', aspectRatios: ['16:9', '9:16'], aspectOnlyForText: true,
    resolutions: ['720p', '1080p'], defaultResolution: '1080p', durations: [6, 8, 10], defaultDuration: 8, durationAsString: true,
    audioField: { name: 'generate_audio', kind: 'boolean' }, costPerSecond: 0.06,
  },
  {
    id: 'wan-3.0-fal', label: 'Wan 3.0 (FAL)', goodFor: 'Up to 30 s in one take, native audio, start + end frame',
    paths: { text: 'alibaba/wan-3.0/text-to-video', image: 'alibaba/wan-3.0/image-to-video' },
    imageField: 'start_image_url', endField: 'end_image_url', aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'], aspectOnlyForText: true,
    resolutions: ['480p', '720p', '1080p'], defaultResolution: '1080p', durations: [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30], defaultDuration: 5,
    audioField: { name: 'audio', kind: 'boolean' }, extra: { enable_prompt_expansion: false }, costPerSecond: 0.2,
  },
  {
    id: 'wan-3.0-prime-fal', label: 'Wan 3.0 Prime (FAL)', goodFor: 'Wan 3.0 top tier for final shots', badge: '⭐ Quality',
    paths: { text: 'alibaba/wan-3.0-prime/text-to-video', image: 'alibaba/wan-3.0-prime/image-to-video' },
    imageField: 'start_image_url', endField: 'end_image_url', aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'], aspectOnlyForText: true,
    resolutions: ['480p', '720p', '1080p'], defaultResolution: '1080p', durations: [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30], defaultDuration: 5,
    audioField: { name: 'audio', kind: 'boolean' }, extra: { enable_prompt_expansion: false }, costPerSecond: 0.3, estimatedMs: 6 * 60 * 1000,
  },
];

export const FAL_VIDEO_CATALOG_IDS = FAL_VIDEO_CATALOG.map((entry) => entry.id);

export const getFalVideoCatalogEntry = (id: string | null | undefined): FalVideoCatalogEntry | null =>
  FAL_VIDEO_CATALOG.find((entry) => entry.id === id) || null;

export const isFalCatalogVideoModel = (id: string | null | undefined): boolean => Boolean(getFalVideoCatalogEntry(id));

/** Map any project aspect ratio onto what the endpoint accepts. */
export const pickCatalogAspect = (entry: FalVideoCatalogEntry, requested: string | undefined): string => {
  const normalized = (requested || '16:9').replace(/\s/g, '');
  if (entry.aspectRatios.includes(normalized)) return normalized;
  if (/^(9:16|3:4|2:3|4:5)$/.test(normalized)) return entry.aspectRatios.find((r) => r === '9:16') || entry.aspectRatios.find((r) => r === '3:4') || entry.aspectRatios[0];
  if (normalized === '1:1') return entry.aspectRatios.find((r) => r === '1:1') || entry.aspectRatios[0];
  return entry.aspectRatios.find((r) => r === '16:9') || entry.aspectRatios[0];
};

export const pickCatalogDuration = (entry: FalVideoCatalogEntry, requested: number | undefined): number => {
  if (!requested || !Number.isFinite(requested)) return entry.defaultDuration;
  return entry.durations.reduce((best, option) => (Math.abs(option - requested) < Math.abs(best - requested) ? option : best), entry.durations[0]);
};
