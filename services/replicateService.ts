import { MediaItem } from '../types';
import { getVideoDuration } from '../utils/helpers';

// Models
const MODELS = {
  FLUX_PRO: 'black-forest-labs/flux-1.1-pro',
  FLUX_SCHNELL: 'black-forest-labs/flux-schnell',
  Z_IMAGE_TURBO: 'prunaai/z-image-turbo',
  SEEDREAM_45: 'bytedance/seedream-4.5',
  NANO_BANANA_PRO: 'google/nano-banana-pro',
  FLUX_2_PRO: 'black-forest-labs/flux-2-pro',
  FLUX_FILL: 'black-forest-labs/flux-fill-dev',
  QWEN_IMAGE_EDIT: 'qwen/qwen-image-edit-2511',
  QWEN_IMAGE_2512: 'qwen/qwen-image-2512',
  KLING_V2_5_TURBO_PRO: 'kwaivgi/kling-v2.5-turbo-pro',
  KLING_V2_6_MOTION_CONTROL: 'kwaivgi/kling-v2.6-motion-control',
  OPENPOSE: 'aiunivers/openpose',
  REAL_ESRGAN: 'nightmareai/real-esrgan',
  WAN_2_2_I2V_FAST: 'wan-video/wan-2.2-i2v-fast',
  LTX_2_FAST: 'lightricks/ltx-2-fast',
};

const getReplicateKey = () => {
  const key = localStorage.getItem('replicate_api_key');
  if (!key) throw new Error('Replicate API Token is missing. Please add it in settings.');
  return key;
};

const proxyUrl = (url: string) => {
  const isElectron = navigator.userAgent.toLowerCase().indexOf(' electron/') > -1;
  if (isElectron) return url;
  return `https://corsproxy.io/?${encodeURIComponent(url)}`;
};

const pickBestImageUrl = (output: any): string => {
  if (!output) return '';
  if (typeof output === 'string') return output;

  if (Array.isArray(output)) {
    for (let i = output.length - 1; i >= 0; i--) {
      const item = output[i];
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && typeof item.url === 'string') return item.url;
    }
    return String(output[0] ?? '');
  }

  if (typeof output === 'object') {
    if (typeof output.url === 'string') return output.url;
    if (Array.isArray(output.images)) return pickBestImageUrl(output.images);
    if (Array.isArray(output.output)) return pickBestImageUrl(output.output);
  }

  return String(output);
};

const isProtectedReplicateFileUrl = (url: string) => {
  try {
    const u = new URL(url);
    return u.hostname === 'replicate.com' || u.hostname === 'api.replicate.com';
  } catch {
    return false;
  }
};

const ensureDisplayableFileUrl = async (url: string, opts?: { forceDownload?: boolean }): Promise<string> => {
  if (!url) throw new Error('Replicate returned an empty file URL.');

  const forceDownload = !!opts?.forceDownload;
  const isProtected = isProtectedReplicateFileUrl(url);

  if (!forceDownload && !isProtected) return url;

  const headers: Record<string, string> = {};
  if (isProtected) {
    const token = getReplicateKey();
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(proxyUrl(url), { headers });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Replicate file download failed (${response.status}): ${body || response.statusText}`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};

const ensureDisplayableImageUrl = async (url: string, opts?: { forceDownload?: boolean }): Promise<string> => {
  return ensureDisplayableFileUrl(url, opts);
};

const aspectRatioToSize = (aspectRatio: string, longSide: number) => {
  switch (aspectRatio) {
    case '9:16':
      return { width: Math.round((longSide * 9) / 16), height: longSide };
    case '4:3':
      return { width: longSide, height: Math.round((longSide * 3) / 4) };
    case '3:4':
      return { width: Math.round((longSide * 3) / 4), height: longSide };
    case '1:1':
      return { width: longSide, height: longSide };
    case '16:9':
    default:
      return { width: longSide, height: Math.round((longSide * 9) / 16) };
  }
};

const waitForPrediction = async (url: string, token: string): Promise<any> => {
  let attempts = 0;
  while (attempts < 60) {
    const response = await fetch(proxyUrl(url), {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      throw new Error(`Replicate Polling Error: ${response.statusText}`);
    }

    const prediction = await response.json();

    if (prediction.status === 'succeeded') return prediction.output;
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(`Replicate Prediction Failed: ${prediction.error}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempts++;
  }
  throw new Error('Prediction timed out.');
};

const runReplicate = async (model: string, input: any): Promise<any> => {
  const token = getReplicateKey();

  const [owner, name] = model.split('/');
  const apiUrl = `https://api.replicate.com/v1/models/${owner}/${name}/predictions`;

  const predictionResponse = await fetch(proxyUrl(apiUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input }),
  });

  if (!predictionResponse.ok) {
    const errorText = await predictionResponse.text();
    throw new Error(`Replicate API Error (${predictionResponse.status}): ${errorText}`);
  }

  const prediction = await predictionResponse.json();
  return await waitForPrediction(prediction.urls.get, token);
};

export const getReplicateKeyPreview = (): string | null => {
  const token = localStorage.getItem('replicate_api_key');
  if (!token) return null;
  const trimmed = token.trim();
  if (trimmed.length <= 8) return '********';
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
};

export const validateReplicateApiKey = async (): Promise<{ ok: true } | { ok: false; message: string }> => {
  try {
    const token = getReplicateKey();
    const response = await fetch(proxyUrl('https://api.replicate.com/v1/models?limit=1'), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { ok: false, message: `Replicate auth failed (${response.status}): ${body || response.statusText}` };
    }

    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, message };
  }
};

export const generateImageWithFlux = async (
  prompt: string,
  aspectRatio: string = '16:9',
): Promise<MediaItem> => {
  const arMap: Record<string, string> = {
    '16:9': '16:9',
    '9:16': '9:16',
    '1:1': '1:1',
    '4:3': '4:3',
    '3:4': '3:4',
  };

  const output = await runReplicate(MODELS.FLUX_PRO, {
    prompt,
    aspect_ratio: arMap[aspectRatio] || '16:9',
    safety_tolerance: 5,
    output_format: 'jpg',
  });

  const rawUrl = pickBestImageUrl(output);
  const imageUrl = await ensureDisplayableImageUrl(rawUrl);

  return {
    id: `flux-${Date.now()}`,
    name: `flux_${prompt.slice(0, 15)}.jpg`,
    type: 'image',
    url: imageUrl,
    source: 'generated',
  };
};

export const generateImageWithZTurbo = async (
  prompt: string,
  aspectRatio: string = '16:9',
): Promise<MediaItem> => {
  const { width, height } = aspectRatioToSize(aspectRatio, 1024);
  const basePayload = {
    prompt,
    num_inference_steps: 8,
    guidance_scale: 0,
    output_format: 'jpg',
    output_quality: 95,
  };

  let output: any;
  try {
    output = await runReplicate(MODELS.Z_IMAGE_TURBO, { ...basePayload, width, height });
  } catch {
    output = await runReplicate(MODELS.Z_IMAGE_TURBO, basePayload);
  }

  const rawUrl = pickBestImageUrl(output);
  const imageUrl = await ensureDisplayableImageUrl(rawUrl, { forceDownload: true });

  return {
    id: `z-turbo-${Date.now()}`,
    name: `turbo_${prompt.slice(0, 15)}.jpg`,
    type: 'image',
    url: imageUrl,
    source: 'generated',
  };
};

export const generateImageWithQwenImage = async (
  prompt: string,
  aspectRatio: string = '16:9',
  image?: { base64: string; mimeType: string },
): Promise<MediaItem> => {
  const dataUri = image
    ? (image.base64.startsWith('data:')
        ? image.base64
        : `data:${image.mimeType};base64,${image.base64}`)
    : undefined;

  const inputPayload: Record<string, any> = {
    prompt,
    aspect_ratio: aspectRatio,
    go_fast: true,
    output_format: 'webp',
    output_quality: 95,
  };

  if (dataUri) {
    inputPayload.image = dataUri;
  }

  const output = await runReplicate(MODELS.QWEN_IMAGE_2512, inputPayload);
  const rawUrl = pickBestImageUrl(output);
  const imageUrl = await ensureDisplayableImageUrl(rawUrl, { forceDownload: true });

  return {
    id: `qwen-2512-${Date.now()}`,
    name: `qwen_2512_${prompt.slice(0, 15)}.webp`,
    type: 'image',
    url: imageUrl,
    source: 'generated',
  };
};

export const generateImageWithSeedream = async (
  prompt: string,
  aspectRatio: string = '16:9',
  size: '2K' | '4K' = '2K',
): Promise<MediaItem> => {
  const normalizedSize = size === '4K' ? '4K' : '2K';
  const output = await runReplicate(MODELS.SEEDREAM_45, {
    prompt,
    size: normalizedSize,
    aspect_ratio: aspectRatio,
    max_images: 1,
    sequential_image_generation: 'disabled',
  });

  const rawUrl = pickBestImageUrl(output);
  const imageUrl = await ensureDisplayableImageUrl(rawUrl);

  return {
    id: `seedream-${Date.now()}`,
    name: `seedream_${prompt.slice(0, 15)}.jpg`,
    type: 'image',
    url: imageUrl,
    source: 'generated',
  };
};

export const generateImageWithSeedreamReferences = async (
  prompt: string,
  referenceImages: { base64: string; mimeType: string }[],
  aspectRatio: string = '16:9',
  size: '2K' | '4K' = '2K',
): Promise<MediaItem> => {
  const normalizedSize = size === '4K' ? '4K' : '2K';
  const imageInput = referenceImages.map((img) => `data:${img.mimeType};base64,${img.base64}`);
  const output = await runReplicate(MODELS.SEEDREAM_45, {
    prompt,
    size: normalizedSize,
    aspect_ratio: aspectRatio,
    max_images: 1,
    sequential_image_generation: 'disabled',
    image_input: imageInput,
  });

  const rawUrl = pickBestImageUrl(output);
  const imageUrl = await ensureDisplayableImageUrl(rawUrl);

  return {
    id: `seedream-ref-${Date.now()}`,
    name: `seedream_ref_${prompt.slice(0, 15)}.jpg`,
    type: 'image',
    url: imageUrl,
    source: 'generated',
  };
};

export const inpaintWithNanoBanana = async (
  prompt: string,
  maskedImageDataUrl: string,
  resolution: '1K' | '2K' | '4K' = '2K',
): Promise<MediaItem> => {
  const output = await runReplicate(MODELS.NANO_BANANA_PRO, {
    prompt,
    image_input: [maskedImageDataUrl],
    aspect_ratio: 'match_input_image',
    resolution,
    output_format: 'png',
    safety_filter_level: 'block_only_high',
  });

  const imageUrl = await ensureDisplayableImageUrl(pickBestImageUrl(output));
  return {
    id: `nano-banana-${Date.now()}`,
    name: `nano_banana_${prompt.slice(0, 15)}.png`,
    type: 'image',
    url: imageUrl,
    source: 'generated',
  };
};

export const inpaintWithFlux2Pro = async (
  prompt: string,
  maskedImageDataUrl: string,
  resolution: 'match_input_image' | '0.5 MP' | '1 MP' | '2 MP' | '4 MP' = 'match_input_image',
): Promise<MediaItem> => {
  const output = await runReplicate(MODELS.FLUX_2_PRO, {
    prompt,
    input_images: [maskedImageDataUrl],
    aspect_ratio: 'match_input_image',
    resolution,
    output_format: 'png',
    safety_tolerance: 2,
  });

  const imageUrl = await ensureDisplayableImageUrl(pickBestImageUrl(output));
  return {
    id: `flux2-pro-${Date.now()}`,
    name: `flux2_inpaint_${prompt.slice(0, 15)}.png`,
    type: 'image',
    url: imageUrl,
    source: 'generated',
  };
};

export const upscaleImage = async (image: { base64: string; mimeType: string }): Promise<MediaItem> => {
  const dataUri = `data:${image.mimeType};base64,${image.base64}`;

  const output = await runReplicate(MODELS.REAL_ESRGAN, {
    image: dataUri,
    scale: 4,
    face_enhance: true,
  });

  return {
    id: `upscale-${Date.now()}`,
    name: `upscaled_image.png`,
    type: 'image',
    url: output,
    source: 'generated',
  };
};

export const editImageWithFlux = async (
  prompt: string,
  image: { base64: string; mimeType: string },
  mask?: { base64: string; mimeType: string },
): Promise<MediaItem> => {
  const dataUri = `data:${image.mimeType};base64,${image.base64}`;
  const maskUri = mask ? `data:${mask.mimeType};base64,${mask.base64}` : undefined;

  const inputPayload: any = {
    image: dataUri,
    prompt,
    guidance: 30,
    output_format: 'jpg',
  };
  if (maskUri) inputPayload.mask = maskUri;

  const output = await runReplicate(MODELS.FLUX_FILL, inputPayload);

  let imageUrl = output;
  if (Array.isArray(output)) imageUrl = output[0];

  return {
    id: `flux-edit-${Date.now()}`,
    name: `edit_${prompt.slice(0, 10)}.jpg`,
    type: 'image',
    url: imageUrl,
    source: 'generated',
  };
};

export const editImageWithQwen = async (
  prompt: string,
  image: { base64: string; mimeType: string },
  opts?: {
    aspectRatio?: string;
    goFast?: boolean;
    outputFormat?: 'webp' | 'jpg' | 'png';
    outputQuality?: number;
    extraImages?: { base64: string; mimeType: string }[];
  },
): Promise<MediaItem> => {
  const allImages = [image, ...(opts?.extraImages || [])];
  const dataUris = allImages.map((img) =>
    img.base64.startsWith('data:')
      ? img.base64
      : `data:${img.mimeType};base64,${img.base64}`,
  );

  const output = await runReplicate(MODELS.QWEN_IMAGE_EDIT, {
    prompt,
    image: dataUris,
    aspect_ratio: opts?.aspectRatio || 'match_input_image',
    go_fast: opts?.goFast ?? true,
    output_format: opts?.outputFormat || 'webp',
    output_quality: opts?.outputQuality ?? 95,
  });

  const rawUrl = pickBestImageUrl(output);
  const imageUrl = await ensureDisplayableImageUrl(rawUrl, { forceDownload: true });

  return {
    id: `qwen-edit-${Date.now()}`,
    name: `qwen_edit_${prompt.slice(0, 10)}.webp`,
    type: 'image',
    url: imageUrl,
    source: 'generated',
  };
};

export const generateVideoWithWanI2V = async (
  prompt: string,
  image: { base64: string; mimeType: string },
  opts?: { resolution?: '480p' | '720p'; numFrames?: number; fps?: number; interpolate?: boolean },
): Promise<MediaItem> => {
  const dataUri = `data:${image.mimeType};base64,${image.base64}`;
  const output = await runReplicate(MODELS.WAN_2_2_I2V_FAST, {
    prompt,
    image: dataUri,
    resolution: opts?.resolution || '720p',
    num_frames: opts?.numFrames || 81,
    frames_per_second: opts?.fps || 16,
    interpolate_output: opts?.interpolate || false,
  });

  const rawUrl = pickBestImageUrl(output);
  const videoUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });

  let duration: number | undefined;
  try {
    duration = await getVideoDuration(videoUrl);
  } catch (e) {
    duration = 5;
  }

  return {
    id: `wan-${Date.now()}`,
    name: `wan_video_${prompt.slice(0, 15)}.mp4`,
    type: 'video',
    url: videoUrl,
    source: 'generated',
    duration,
  };
};

export const generateVideoWithKling = async (
  prompt: string,
  image: { base64: string; mimeType: string },
): Promise<MediaItem> => {
  const dataUri = `data:${image.mimeType};base64,${image.base64}`;
  const output = await runReplicate(MODELS.KLING_V2_5_TURBO_PRO, {
    prompt,
    image: dataUri,
  });

  const rawUrl = pickBestImageUrl(output);
  const videoUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });

  let duration: number | undefined;
  try {
    duration = await getVideoDuration(videoUrl);
  } catch (e) {
    duration = 5;
  }

  return {
    id: `kling-${Date.now()}`,
    name: `kling_video_${prompt.slice(0, 15)}.mp4`,
    type: 'video',
    url: videoUrl,
    source: 'generated',
    duration,
  };
};

export const generateVideoWithKlingMotionControl = async (
  prompt: string,
  image: { base64: string; mimeType: string },
  video: { base64: string; mimeType: string },
  opts?: { mode?: 'std' | 'pro'; keepOriginalSound?: boolean; characterOrientation?: 'image' | 'video' },
): Promise<MediaItem> => {
  const imageUri = `data:${image.mimeType};base64,${image.base64}`;
  const videoUri = `data:${video.mimeType};base64,${video.base64}`;
  const output = await runReplicate(MODELS.KLING_V2_6_MOTION_CONTROL, {
    prompt,
    image: imageUri,
    video: videoUri,
    mode: opts?.mode || 'std',
    keep_original_sound: opts?.keepOriginalSound ?? true,
    character_orientation: opts?.characterOrientation || 'image',
  });

  const rawUrl = pickBestImageUrl(output);
  const videoUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });

  let duration: number | undefined;
  try {
    duration = await getVideoDuration(videoUrl);
  } catch (e) {
    duration = 5;
  }

  return {
    id: `kling-motion-${Date.now()}`,
    name: `kling_motion_${prompt.slice(0, 15)}.mp4`,
    type: 'video',
    url: videoUrl,
    source: 'generated',
    duration,
  };
};

export const generateOpenPose = async (
  image: { base64: string; mimeType: string },
  opts?: { includeFace?: boolean; includeHands?: boolean; useOpenpose?: boolean },
): Promise<MediaItem> => {
  const dataUri = `data:${image.mimeType};base64,${image.base64}`;
  const output = await runReplicate(MODELS.OPENPOSE, {
    image: dataUri,
    use_openpose: opts?.useOpenpose ?? true,
    include_face: opts?.includeFace ?? true,
    include_hands: opts?.includeHands ?? true,
  });

  const rawUrl = pickBestImageUrl(output);
  const imageUrl = await ensureDisplayableFileUrl(rawUrl);

  return {
    id: `openpose-${Date.now()}`,
    name: `openpose_${Date.now()}.png`,
    type: 'image',
    url: imageUrl,
    source: 'generated',
  };
};

export const generateVideoWithLtx = async (
  prompt: string,
  opts?: {
    image?: { base64: string; mimeType: string };
    duration?: 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20;
    resolution?: '1080p' | '2k' | '4k';
    generateAudio?: boolean;
  },
): Promise<MediaItem> => {
  const dataUri = opts?.image ? `data:${opts.image.mimeType};base64,${opts.image.base64}` : undefined;
  const output = await runReplicate(MODELS.LTX_2_FAST, {
    prompt,
    image: dataUri,
    duration: opts?.duration || 6,
    resolution: opts?.resolution || '1080p',
    generate_audio: opts?.generateAudio ?? true,
  });

  const rawUrl = pickBestImageUrl(output);
  const videoUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });

  let duration: number | undefined;
  try {
    duration = await getVideoDuration(videoUrl);
  } catch (e) {
    duration = 6;
  }

  return {
    id: `ltx-${Date.now()}`,
    name: `ltx_video_${prompt.slice(0, 15)}.mp4`,
    type: 'video',
    url: videoUrl,
    source: 'generated',
    duration,
  };
};
