/**
 * MachGen model specs and request building, kept free of browser imports so it can be
 * unit-tested. The network side lives in machgenService.ts.
 */

// ---------------------------------------------------------------------------
// Models (the self-hosted ones listed in https://www.machgen.ai/docs/models)
// ---------------------------------------------------------------------------

export type MachgenVideoModelId = 'MiniMax-H3-Turbo' | 'MiniMax-H3' | 'LTX-2.3-Pro' | 'Vidu-Q3-Turbo' | 'Wan2.2-A14B';
export type MachgenImageModelId = 'FLUX.2-dev' | 'HiDream-O1-Image';

export type MachgenVideoSpec = {
  /** Short-edge heights, best first. */
  heights: number[];
  aspectRatios: string[];
  durations: number[];
  fps: number;
  audio: boolean;
  /** Second image = end frame. */
  endFrame: boolean;
  /** USD per second at the default height (https://www.machgen.ai/pricing, October 2026). */
  usdPerSecond: number;
};

export const MACHGEN_VIDEO_MODELS: Record<MachgenVideoModelId, MachgenVideoSpec> = {
  'MiniMax-H3-Turbo': { heights: [768, 480], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], durations: [5, 6, 8, 10, 12, 15], fps: 24, audio: true, endFrame: true, usdPerSecond: 0.02 },
  'MiniMax-H3': { heights: [768, 480, 1080, 1440], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], durations: [5, 6, 8, 10, 12, 15], fps: 24, audio: true, endFrame: true, usdPerSecond: 0.04 },
  'LTX-2.3-Pro': { heights: [1080], aspectRatios: ['16:9'], durations: [6, 8, 10], fps: 24, audio: true, endFrame: true, usdPerSecond: 0.03 },
  'Vidu-Q3-Turbo': { heights: [720, 540], aspectRatios: ['16:9', '9:16', '1:1', '4:3'], durations: [4, 5, 6, 8, 10, 12, 16], fps: 24, audio: true, endFrame: true, usdPerSecond: 0.04 },
  'Wan2.2-A14B': { heights: [720, 480], aspectRatios: ['16:9'], durations: [5], fps: 16, audio: false, endFrame: false, usdPerSecond: 0.036 },
};

export const nearestOption = (value: number, options: number[]) =>
  options.reduce((best, option) => (Math.abs(option - value) < Math.abs(best - value) ? option : best), options[0]);

export type MachgenVideoRequestOptions = {
  duration?: number;
  aspectRatio?: string;
  height?: number;
  audio?: boolean;
  seed?: number;
  enhancePrompt?: boolean;
};

/**
 * The TaskInput for POST /api/v0/generate. `startUrls` are uploaded "@input/…" frames
 * (start, then end) for image-to-video; `referenceUrls` are subjects for reference-to-video.
 */
export const buildMachgenVideoInput = (
  model: MachgenVideoModelId,
  prompt: string,
  opts: MachgenVideoRequestOptions = {},
  uploads: { startUrls?: string[]; referenceUrls?: string[] } = {}
) => {
  const spec = MACHGEN_VIDEO_MODELS[model];
  const aspectRatio = opts.aspectRatio && spec.aspectRatios.includes(opts.aspectRatio) ? opts.aspectRatio : spec.aspectRatios[0];
  const duration = nearestOption(opts.duration || spec.durations[0], spec.durations);
  const height = opts.height && spec.heights.includes(opts.height) ? opts.height : spec.heights[0];
  const input: Record<string, unknown> = {
    model,
    prompt,
    task_type: 'T2V',
    video_config: {
      duration_secs: duration,
      height,
      aspect_ratio: aspectRatio,
      fps: spec.fps,
      ...(spec.audio ? { audio: opts.audio !== false } : {}),
    },
  };
  if (typeof opts.seed === 'number') input.seed = opts.seed;
  if (typeof opts.enhancePrompt === 'boolean') input.enhance_prompt = opts.enhancePrompt;
  if (uploads.startUrls?.length) {
    input.task_type = 'I2V';
    input.src_image_urls = spec.endFrame ? uploads.startUrls.slice(0, 2) : uploads.startUrls.slice(0, 1);
  } else if (uploads.referenceUrls?.length) {
    const urls = uploads.referenceUrls;
    input.task_type = 'R2V';
    input.src_image_urls = urls;
    input.subject_to_image_ids = Object.fromEntries(urls.map((_, index) => [`ref${index + 1}`, [index]]));
    // Every unquoted @handle must name a subject; mention the references if the prompt does not.
    if (!/@ref\d/.test(prompt)) input.prompt = `${prompt}\nReferences: ${urls.map((_, index) => `@ref${index + 1}`).join(', ')}.`;
  }
  return { input, duration };
};

/** Maximum reference images for reference-to-video. */
export const machgenReferenceLimit = (model: MachgenVideoModelId) => (model === 'Vidu-Q3-Turbo' ? 7 : 9);
