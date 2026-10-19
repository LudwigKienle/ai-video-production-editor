import type { MediaItem } from '../types';
import { localHttp } from './localLlmService';

/**
 * Draw Things (macOS/iOS) runs open-weights image models on Apple silicon and can
 * serve them over HTTP (Settings → API Server, default port 7860). Its API follows the
 * Automatic1111 shape: POST /sdapi/v1/txt2img and /sdapi/v1/img2img return base64 PNGs.
 * The model is whichever one is selected in Draw Things.
 *
 * The HTTP server takes exactly one start image, and it must match width × height to the
 * pixel. Moodboard (several reference images) is only reachable through its gRPC server.
 */

const STORAGE_KEY = 'draw_things_url_v1';
export const DRAW_THINGS_DEFAULT_URL = 'http://127.0.0.1:7860';

export const getDrawThingsUrl = () => {
  try {
    return (localStorage.getItem(STORAGE_KEY) || DRAW_THINGS_DEFAULT_URL).replace(/\/+$/, '');
  } catch {
    return DRAW_THINGS_DEFAULT_URL;
  }
};

export const setDrawThingsUrl = (url: string) => {
  try {
    localStorage.setItem(STORAGE_KEY, url.trim() || DRAW_THINGS_DEFAULT_URL);
  } catch {
    /* storage unavailable */
  }
};

/** Draw Things answers GET / with its current settings (model, sampler, size). */
export const probeDrawThings = async (baseUrl = getDrawThingsUrl()) => {
  try {
    const result = await localHttp(`${baseUrl}/`, { timeoutMs: 4000 });
    if (!result.ok) return { online: false, error: `HTTP ${result.status}` };
    let model: string | undefined;
    try {
      model = JSON.parse(result.text)?.model;
    } catch {
      model = undefined;
    }
    return { online: true, model };
  } catch (error: any) {
    return { online: false, error: error?.message || String(error) };
  }
};

/**
 * Models Draw Things runs as reference editors (FLUX.1 Kontext, FLUX.2 Klein, Qwen Image Edit…):
 * the start image is read as a reference at full strength instead of being re-noised.
 */
export const isDrawThingsEditModel = (model?: string) => /kontext|klein|[_-]edit/i.test(model || '');

/** Center-crops and scales an image to exactly width × height (Draw Things rejects any other size). */
const fitImageToSize = async (image: { base64: string; mimeType: string }, width: number, height: number) => {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return image.base64;
  const blob = await (await fetch(`data:${image.mimeType || 'image/png'};base64,${image.base64}`)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width === width && bitmap.height === height) return image.base64;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return image.base64;
    const scale = Math.max(width / bitmap.width, height / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    return canvas.toDataURL('image/png').split(',')[1];
  } finally {
    bitmap.close();
  }
};

export type DrawThingsOptions = {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps?: number;
  seed?: number;
  guidance?: number;
  /** img2img start image; strength 0–1 (how much to change it). */
  image?: { base64: string; mimeType: string };
  strength?: number;
};

export const generateImageWithDrawThings = async (options: DrawThingsOptions): Promise<MediaItem> => {
  const baseUrl = getDrawThingsUrl();
  const width = Math.max(64, Math.round(options.width / 64) * 64);
  const height = Math.max(64, Math.round(options.height / 64) * 64);
  const body: Record<string, unknown> = {
    prompt: options.prompt,
    negative_prompt: options.negativePrompt || '',
    width,
    height,
    seed: typeof options.seed === 'number' ? options.seed : -1,
    batch_size: 1,
  };
  if (options.steps) body.steps = options.steps;
  if (options.guidance) body.guidance_scale = options.guidance;
  const endpoint = options.image ? '/sdapi/v1/img2img' : '/sdapi/v1/txt2img';
  if (options.image) {
    body.init_images = [await fitImageToSize(options.image, width, height)];
    body.strength = typeof options.strength === 'number' ? options.strength : 0.6;
  }
  let result;
  try {
    result = await localHttp(`${baseUrl}${endpoint}`, { body, timeoutMs: 30 * 60 * 1000 });
  } catch (error: any) {
    throw new Error(`Draw Things is not reachable at ${baseUrl}. In Draw Things, open Settings → API Server and turn on the HTTP server. (${error?.message || error})`);
  }
  if (!result.ok) throw new Error(`Draw Things: ${result.text || `HTTP ${result.status}`}`);
  const image = (() => {
    try {
      return JSON.parse(result.text)?.images?.[0];
    } catch {
      return undefined;
    }
  })();
  if (!image) throw new Error('Draw Things returned no image.');
  const dataUrl = String(image).startsWith('data:') ? String(image) : `data:image/png;base64,${image}`;
  return {
    id: `draw-things-${Date.now()}`,
    name: `draw_things_${options.prompt.slice(0, 16) || 'image'}.png`,
    type: 'image',
    url: dataUrl,
    source: 'generated',
    generatedBy: 'Draw Things (local)',
    prompt: options.prompt,
  } as MediaItem;
};
