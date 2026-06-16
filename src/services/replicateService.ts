
import { MediaItem } from '../types';
import { getVideoDuration } from '../utils/helpers';
import { recordUsage } from '../utils/usageTracker';
import { byokProxyBinaryUrl, byokProxyJson, shouldUseByokProxy } from './byokProxyClient';

// Models
const MODELS = {
    FLUX_PRO: "black-forest-labs/flux-1.1-pro", // High quality generation
    FLUX_SCHNELL: "black-forest-labs/flux-schnell", // Fast generation
    FLUX_2_KLEIN_9B_BASE: "black-forest-labs/flux-2-klein-9b-base", // Flux 2 Klein 9B Base
    FLUX_2_TURBO: "prunaai/flux-2-turbo", // Flux 2 Turbo
    Z_IMAGE_TURBO: "prunaai/z-image-turbo", // Z-Image Turbo
    Z_IMAGE_TURBO_LORA: "prunaai/z-image-turbo-lora", // Z-Image Turbo LoRA
    Z_IMAGE_TURBO_IMG2IMG: "prunaai/z-image-turbo-img2img", // Z-Image Turbo Img2Img
    Z_IMAGE_TURBO_INPAINT: "prunaai/z-image-turbo-inpaint", // Z-Image Turbo Inpaint
    Z_IMAGE: "prunaai/z-image:eb865cc448032613678cd0e4e99548671cdff1286bc04f0f605b3fc10fffe3aa", // Z-Image (versioned)
    SEEDREAM_45: "bytedance/seedream-4.5", // Seedream 4.5
    WAN_2_7_IMAGE_PRO: "wan-video/wan-2.7-image-pro", // Wan 2.7 Image Pro
    NANO_BANANA_PRO: "google/nano-banana-pro", // Nano Banana Pro
    FLUX_2_PRO: "black-forest-labs/flux-2-pro", // Flux 2 Pro
    FLUX_FILL: "black-forest-labs/flux-fill-dev", // Inpainting/Editing
    QWEN_IMAGE_EDIT: "qwen/qwen-image-edit-2511", // Qwen Image Edit 2511
    QWEN_IMAGE_2512: "qwen/qwen-image-2512", // Qwen Image 2512
    QWEN_EDIT_MULTIANGLE: "qwen/qwen-edit-multiangle", // Qwen Edit Multi-Angle
    FIRERED_IMAGE_EDIT: "prunaai/firered-image-edit:778e5a9b1a1c75e0f8013e19db9a9e6ff456c46d796e31070fe740a2874daa96", // FireRed Image Edit (version-pinned to avoid 404 on model endpoint)
    GEMINI_2_5_FLASH_TEXT: "google/gemini-2.5-flash", // Gemini 2.5 Flash (text, fast)
    GEMINI_2_5_PRO_TEXT: "google/gemini-2.5-pro", // Gemini 2.5 Pro (text)
    GEMINI_3_1_PRO_TEXT: "google/gemini-3.1-pro-preview", // Gemini 3.1 Pro (text)
    GEMINI_3_PRO_IMAGE: "google/gemini-3-pro", // Gemini 3 Pro Image
    SEEDANCE_1_5_PRO: "bytedance/seedance-1.5-pro", // Seedance 1.5 Pro (video)
    VEO_3_1_FAST: "google/veo-3.1-fast", // Veo 3.1 Fast
    VEO_3_1: "google/veo-3.1", // Veo 3.1
    KLING_V2_5_TURBO_PRO: "kwaivgi/kling-v2.5-turbo-pro", // Kling 2.6 Turbo Pro
    KLING_V2_6: "kwaivgi/kling-v2.6", // Kling 2.6 Pro
    KLING_V2_6_MOTION_CONTROL: "kwaivgi/kling-v2.6-motion-control", // Kling 2.6 Motion Control
    OPENPOSE: "aiunivers/openpose", // OpenPose pose estimation
    REAL_ESRGAN: "nightmareai/real-esrgan", // Upscaling
    CRYSTAL_UPSCALER: "philz1337x/crystal-upscaler", // Crystal Upscaler
    CLARITY_UPSCALER: "philz1337x/clarity-upscaler", // Clarity Upscaler
    CRYSTAL_VIDEO_UPSCALER: "philz1337x/crystal-video-upscaler", // Crystal Video Upscaler
    TOPAZ_UPSCALER: "topazlabs/image-upscale", // Topaz Image Upscale
    TOPAZ_VIDEO_UPSCALER: "topazlabs/video-upscale", // Topaz Video Upscale
    WAN_2_2_I2V_FAST: "wan-video/wan-2.2-i2v-fast", // Wan 2.2 Image-to-Video Fast
    WAN_2_2_ANIMATE_REPLACE: "wan-video/wan-2.2-animate-replace", // Wan 2.2 Animate Replace
    OMNI_HUMAN: "bytedance/omni-human", // OmniHuman avatar video
    LTX_2_FAST: "lightricks/ltx-2-fast", // LTX 2 Fast
    LTX_2_3_FAST: "lightricks/ltx-2.3-fast", // LTX 2.3 Fast
    LTX_2_3_PRO: "lightricks/ltx-2.3-pro", // LTX 2.3 Pro
    LTX_AUDIO_TO_VIDEO: "lightricks/audio-to-video", // Lightricks Audio-to-Video
    P_VIDEO: "prunaai/p-video", // P-Video
    GPT_IMAGE_1_5: "openai/gpt-image-1.5", // OpenAI GPT Image 1.5
    GPT_5_NANO: "openai/gpt-5-nano", // OpenAI GPT-5 Nano (text)
    CONTROLNET: "jagilley/controlnet", // ControlNet base
    CONTROLNET_SCRIBBLE: "jagilley/controlnet-scribble", // ControlNet Scribble
    CONTROLNET_NORMAL: "jagilley/controlnet-normal", // ControlNet Normal
    RODIN_3D: "hyper3d/rodin", // Rodin image-to-3D
    MINIMAX_SPEECH_02_HD: "minimax/speech-02-hd", // Minimax Speech 02 HD
    LYRIA_2: "google/lyria-2", // Google Lyria 2
    RUNWAY_GEN4_TURBO: "runwayml/gen4-image-turbo", // Runway Gen-4 Image Turbo
    DPT_DEPTH: "isl-org/dpt", // DPT depth map
    MIDAS_DEPTH: "intel-isl/midas", // MiDaS depth map
    RIFE: "sczhou/rife", // RIFE frame interpolation
    GFPGAN: "tencentarc/gfpgan", // GFPGAN face restoration
    RESTOREFORMER: "sczhou/restoreformer", // RestoreFormer face restoration
    REMBG: "cjwbw/rembg", // Background removal
    DEMUCS: "facebookresearch/demucs", // Demucs stem separation
};

const getReplicateKeyOptional = () => {
    return localStorage.getItem('replicate_api_key');
};

const inferReplicateKind = (model: string): 'image' | 'edit' | 'video' | 'audio' | 'analysis' | 'other' => {
    const normalized = (model || '').toLowerCase();
    if (normalized.includes('wan-2.7-image')) {
        return 'image';
    }
    if (
        normalized.includes('video') ||
        normalized.includes('kling') ||
        normalized.includes('wan-') ||
        normalized.includes('seedance') ||
        normalized.includes('omni-human') ||
        normalized.includes('ltx') ||
        normalized.includes('rife')
    ) {
        return 'video';
    }
    if (
        normalized.includes('speech') ||
        normalized.includes('lyria') ||
        normalized.includes('demucs') ||
        normalized.includes('audio')
    ) {
        return 'audio';
    }
    if (
        normalized.includes('edit') ||
        normalized.includes('inpaint') ||
        normalized.includes('fill') ||
        normalized.includes('upscale') ||
        normalized.includes('restore') ||
        normalized.includes('rembg')
    ) {
        return 'edit';
    }
    if (
        normalized.includes('gpt-5') ||
        normalized.includes('gemini-3-pro') ||
        normalized.includes('gemini-3.1-pro')
    ) {
        return 'analysis';
    }
    if (normalized.includes('flux') || normalized.includes('image') || normalized.includes('seedream')) {
        return 'image';
    }
    return 'other';
};

const normalizeReplicateModelForUsage = (model: string) => {
    if (model.startsWith('prunaai/z-image:')) return 'prunaai/z-image';
    if (model.startsWith('prunaai/firered-image-edit:')) return 'prunaai/firered-image-edit';
    if (model.startsWith('prunaai/z-image-turbo-lora')) return 'prunaai/z-image-turbo';
    return model;
};

const buildReplicateUsage = (model: string, input: Record<string, any> | undefined) => {
    const normalizedModel = (model || '').toLowerCase();
    let kind = inferReplicateKind(model);
    if (normalizedModel.includes('wan-2.7-image')) {
        const hasReferences = Array.isArray(input?.images)
            ? input!.images.filter(Boolean).length > 0
            : false;
        kind = hasReferences ? 'edit' : 'image';
    }
    const baseUnits = Number(input?.num_outputs || input?.num_images || input?.n || 1);
    const units = Number.isFinite(baseUnits) ? Math.max(1, Math.ceil(baseUnits)) : 1;
    return {
        model: normalizeReplicateModelForUsage(model),
        kind,
        units,
    };
};

// Helper to proxy requests if running in browser to avoid CORS.
// If running in Electron, we can skip the proxy if webSecurity is disabled or handled in main process.
const proxyUrl = (url: string) => {
    // Check if running in Electron via user agent or window object check
    const isElectron = navigator.userAgent.toLowerCase().indexOf(' electron/') > -1;

    if (isElectron) {
        return url;
    }

    // In standard browser environment, Replicate API blocks direct calls.
    // We use a CORS proxy for demonstration purposes.
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
        if (Array.isArray((output as any).images)) return pickBestImageUrl((output as any).images);
        if (Array.isArray((output as any).output)) return pickBestImageUrl((output as any).output);
    }

    return String(output);
};

const normalizeImageUrls = (output: any): string[] => {
    if (!output) return [];
    if (typeof output === 'string') return [output];

    if (Array.isArray(output)) {
        const urls: string[] = [];
        output.forEach((item) => {
            if (typeof item === 'string') {
                urls.push(item);
                return;
            }
            if (item && typeof item === 'object' && typeof (item as any).url === 'string') {
                urls.push((item as any).url);
                return;
            }
            if (Array.isArray(item)) {
                urls.push(...normalizeImageUrls(item));
                return;
            }
            if (item && typeof item === 'object') {
                if (Array.isArray((item as any).images)) {
                    urls.push(...normalizeImageUrls((item as any).images));
                    return;
                }
                if (Array.isArray((item as any).output)) {
                    urls.push(...normalizeImageUrls((item as any).output));
                }
            }
        });
        return urls.filter(Boolean);
    }

    if (typeof output === 'object') {
        if (typeof (output as any).url === 'string') return [(output as any).url];
        if (Array.isArray((output as any).images)) return normalizeImageUrls((output as any).images);
        if (Array.isArray((output as any).output)) return normalizeImageUrls((output as any).output);
        if (Array.isArray((output as any).result)) return normalizeImageUrls((output as any).result);
    }

    return [];
};

const collectOutputUrls = (output: any, urls: string[] = []): string[] => {
    if (!output) return urls;
    if (typeof output === 'string') {
        urls.push(output);
        return urls;
    }
    if (Array.isArray(output)) {
        output.forEach((item) => collectOutputUrls(item, urls));
        return urls;
    }
    if (typeof output === 'object') {
        Object.values(output).forEach((value) => collectOutputUrls(value, urls));
    }
    return urls;
};

const pickBestUrlByExtension = (output: any, extensions: string[]): string => {
    const urls = collectOutputUrls(output, []);
    const match = urls.find((url) => extensions.some((ext) => url.toLowerCase().includes(ext)));
    return match || '';
};

const pickBestAudioUrl = (output: any): string => {
    return pickBestUrlByExtension(output, ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']);
};

const collectAudioUrls = (output: any): string[] => {
    return collectOutputUrls(output, [])
        .filter((url) => /\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(url.split('?')[0]));
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
    if (!url) throw new Error("Replicate returned an empty file URL.");
    const forceDownload = !!opts?.forceDownload;
    const isProtected = isProtectedReplicateFileUrl(url);
    const localKey = getReplicateKeyOptional();
    const useByokProxy = !localKey && shouldUseByokProxy('replicate');

    if (!forceDownload && !isProtected) return url;

    if (useByokProxy && isProtected) {
        return byokProxyBinaryUrl({
            provider: 'replicate',
            url,
            method: 'GET',
            usage: {
                kind: 'other',
                model: 'replicate/file-download',
                units: 1,
            },
            meta: {
                billable: false,
                note: 'Replicate protected file download',
            },
        });
    }

    const headers: Record<string, string> = {};
    if (isProtected) {
        if (!localKey) {
            throw new Error("Replicate API Token is missing. Please add it in settings.");
        }
        headers['Authorization'] = `Bearer ${localKey}`;
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

const parseAspectRatio = (aspectRatio: string) => {
    const match = aspectRatio.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return width / height;
};

const normalizeAspectRatio = (aspectRatio: string, fallback: string = '16:9') => {
    return parseAspectRatio(aspectRatio) ? aspectRatio : fallback;
};

const parseLoraValues = (opts?: { loraUrl?: string; loraScale?: number }) => {
    const urls = (opts?.loraUrl || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    if (urls.length === 0) return undefined;
    const scale = Number.isFinite(opts?.loraScale) ? Number(opts?.loraScale) : 0.75;
    return {
        loraWeights: urls,
        loraScales: urls.map(() => scale),
    };
};

const aspectRatioToSize = (aspectRatio: string, longSide: number) => {
    const ratio = parseAspectRatio(aspectRatio);
    if (ratio) {
        if (ratio >= 1) {
            return { width: longSide, height: Math.max(1, Math.round(longSide / ratio)) };
        }
        return { width: Math.max(1, Math.round(longSide * ratio)), height: longSide };
    }
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

const clampToStep = (value: number, step: number, min = step) => {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.round(value / step) * step);
};

const toReplicateDataUri = (image: { base64: string; mimeType: string }) =>
    image.base64.startsWith('data:')
        ? image.base64
        : `data:${image.mimeType};base64,${image.base64}`;

const mapWan27ImageSize = (
    aspectRatio: string,
    size: '1K' | '2K' | '4K',
    opts?: { hasReferences?: boolean }
) => {
    const effectiveSize = size === '4K' && opts?.hasReferences ? '2K' : size;
    const longSide = effectiveSize === '4K' ? 4096 : effectiveSize === '2K' ? 2048 : 1024;
    const { width, height } = aspectRatioToSize(normalizeAspectRatio(aspectRatio), longSide);
    const roundedWidth = Math.min(longSide, clampToStep(width, 32));
    const roundedHeight = Math.min(longSide, clampToStep(height, 32));
    return `${roundedWidth}*${roundedHeight}`;
};

const waitForPredictionDirect = async (url: string, token: string): Promise<any> => {
    let attempts = 0;
    while (attempts < 60) { // Timeout after 60 seconds
        const response = await fetch(proxyUrl(url), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            // Handle rate limits or temporary errors
            if (response.status === 429 || response.status === 500 || response.status === 502 || response.status === 503 || response.status === 504) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
            }
            throw new Error(`Replicate Polling Error: ${response.statusText}`);
        }

        const prediction = await response.json();

        if (prediction.status === 'succeeded') {
            return prediction.output;
        } else if (prediction.status === 'failed' || prediction.status === 'canceled') {
            throw new Error(`Replicate Prediction Failed: ${prediction.error}`);
        }

        // Wait 1s before polling again
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
    }
    throw new Error("Prediction timed out.");
};

const waitForPredictionViaByok = async (url: string): Promise<any> => {
    let attempts = 0;
    while (attempts < 60) {
        const prediction = await byokProxyJson<any>({
            provider: 'replicate',
            url,
            method: 'GET',
            usage: {
                kind: 'other',
                model: 'replicate/poll',
                units: 1,
            },
            meta: {
                billable: false,
                note: 'Replicate prediction polling',
            },
        });

        if (prediction?.status === 'succeeded') {
            return prediction.output;
        }
        if (prediction?.status === 'failed' || prediction?.status === 'canceled') {
            throw new Error(`Replicate Prediction Failed: ${prediction?.error || 'Unknown error'}`);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts += 1;
    }
    throw new Error("Prediction timed out.");
};

const runReplicateViaByok = async (model: string, input: any): Promise<any> => {
    const modelParts = model.split('/');
    const owner = modelParts[0];
    const nameWithVersion = modelParts.slice(1).join('/');
    const versionSeparator = nameWithVersion.includes('@') ? '@' : nameWithVersion.includes(':') ? ':' : null;
    const [name, version] = versionSeparator
        ? nameWithVersion.split(versionSeparator)
        : [nameWithVersion, undefined];
    const apiUrl = version
        ? 'https://api.replicate.com/v1/predictions'
        : `https://api.replicate.com/v1/models/${owner}/${name}/predictions`;
    const payload = version ? { version, input } : { input };

    const prediction = await byokProxyJson<any>({
        provider: 'replicate',
        url: apiUrl,
        method: 'POST',
        body: payload,
        usage: buildReplicateUsage(model, input),
        meta: {
            billable: true,
            note: `Replicate generation ${normalizeReplicateModelForUsage(model)}`,
        },
    });

    if (!prediction?.urls?.get) {
        throw new Error('Replicate did not return a polling URL.');
    }
    return waitForPredictionViaByok(prediction.urls.get);
};

const runReplicate = async (model: string, input: any): Promise<any> => {
    const token = getReplicateKeyOptional();
    if (!token && shouldUseByokProxy('replicate')) {
        return runReplicateViaByok(model, input);
    }
    if (!token) {
        throw new Error("Replicate API Token is missing. Please add it in settings.");
    }

    const modelParts = model.split('/');
    const owner = modelParts[0];
    const nameWithVersion = modelParts.slice(1).join('/');
    const versionSeparator = nameWithVersion.includes('@') ? '@' : nameWithVersion.includes(':') ? ':' : null;
    const [name, version] = versionSeparator
        ? nameWithVersion.split(versionSeparator)
        : [nameWithVersion, undefined];
    const apiUrl = version
        ? 'https://api.replicate.com/v1/predictions'
        : `https://api.replicate.com/v1/models/${owner}/${name}/predictions`;
    const maxRetries = 3;
    let attempt = 0;

    while (true) {
        const body = version
            ? JSON.stringify({ version, input })
            : JSON.stringify({ input });
        const predictionResponse = await fetch(proxyUrl(apiUrl), {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body,
        });

        if (predictionResponse.ok) {
            const prediction = await predictionResponse.json();
            return await waitForPredictionDirect(prediction.urls.get, token);
        }

        const errorText = await predictionResponse.text().catch(() => '');
        const status = predictionResponse.status;
        const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
        if (!retryable || attempt >= maxRetries) {
            throw new Error(`Replicate API Error (${status}): ${errorText}`);
        }

        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 500));
        attempt += 1;
    }
};

const coerceTextOutput = (output: any): string => {
    if (typeof output === 'string') return output.trim();
    if (Array.isArray(output)) {
        const parts = output.map((item) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object') {
                if (typeof (item as any).text === 'string') return (item as any).text;
                if (typeof (item as any).content === 'string') return (item as any).content;
            }
            return '';
        }).filter(Boolean);
        return parts.join('').trim();
    }
    if (output && typeof output === 'object') {
        if (typeof (output as any).text === 'string') return (output as any).text.trim();
        if (typeof (output as any).output === 'string') return (output as any).output.trim();
        if (typeof (output as any).content === 'string') return (output as any).content.trim();
        if (Array.isArray((output as any).output)) {
            return coerceTextOutput((output as any).output);
        }
        if (Array.isArray((output as any).content)) {
            return coerceTextOutput((output as any).content);
        }
    }
    return '';
};

export const generateTextWithGemini3ProReplicate = async (
    prompt: string,
    opts?: { systemPrompt?: string; temperature?: number; maxTokens?: number; priority?: 'speed' | 'quality' }
): Promise<string> => {
    const textModelCandidates = opts?.priority === 'speed'
        ? [MODELS.GEMINI_2_5_FLASH_TEXT, MODELS.GEMINI_3_1_PRO_TEXT, MODELS.GEMINI_2_5_PRO_TEXT, MODELS.GEMINI_3_PRO_IMAGE]
        : [MODELS.GEMINI_3_1_PRO_TEXT, MODELS.GEMINI_2_5_PRO_TEXT, MODELS.GEMINI_3_PRO_IMAGE, MODELS.GEMINI_2_5_FLASH_TEXT];
    const systemPrompt = opts?.systemPrompt?.trim();
    const payloads: Array<Record<string, any>> = [];

    if (systemPrompt) {
        payloads.push({ prompt, system: systemPrompt });
        payloads.push({ prompt, system_prompt: systemPrompt });
        payloads.push({ input: prompt, system_prompt: systemPrompt });
        payloads.push({
            contents: [
                { role: 'system', parts: [{ text: systemPrompt }] },
                { role: 'user', parts: [{ text: prompt }] }
            ],
        });
        payloads.push({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ],
        });
    }

    payloads.push({ prompt });
    payloads.push({ input: prompt });
    payloads.push({ text: prompt });
    payloads.push({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
    payloads.push({ messages: [{ role: 'user', content: prompt }] });
    payloads.push({ prompt, temperature: opts?.temperature, max_tokens: opts?.maxTokens });

    let lastError: any;
    for (const model of textModelCandidates) {
        for (const payload of payloads) {
            try {
                const output = await runReplicate(model, payload);
                const text = coerceTextOutput(output);
                if (text) return text;
            } catch (error) {
                lastError = error;
            }
        }
    }

    throw lastError || new Error('Gemini 3.1 Pro (Replicate) text generation failed.');
};

export const generateTextWithGpt5NanoReplicate = async (
    prompt: string,
    opts?: { systemPrompt?: string; temperature?: number; maxTokens?: number }
): Promise<string> => {
    const systemPrompt = opts?.systemPrompt?.trim();
    const payloads: Array<Record<string, any>> = [];

    if (systemPrompt) {
        payloads.push({ prompt, system: systemPrompt });
        payloads.push({ prompt, system_prompt: systemPrompt });
        payloads.push({ input: prompt, system_prompt: systemPrompt });
        payloads.push({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt },
            ],
        });
    }

    payloads.push({ prompt });
    payloads.push({ input: prompt });
    payloads.push({ text: prompt });
    payloads.push({ messages: [{ role: 'user', content: prompt }] });
    payloads.push({ prompt, temperature: opts?.temperature, max_tokens: opts?.maxTokens });

    let lastError: any;
    for (const payload of payloads) {
        try {
            const output = await runReplicate(MODELS.GPT_5_NANO, payload);
            const text = coerceTextOutput(output);
            if (text) return text;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('GPT-5 Nano (Replicate) text generation failed.');
};

export const generateSpeechWithMinimax = async (
    prompt: string,
    opts?: { voice?: string; speed?: number }
): Promise<MediaItem> => {
    const payloads: Array<Record<string, any>> = [];
    const voice = opts?.voice?.trim();
    const speed = opts?.speed;

    payloads.push({ text: prompt, voice, speed });
    payloads.push({ prompt, voice, speed });
    payloads.push({ input: prompt, voice, speed });
    payloads.push({ input_text: prompt, voice, speed });
    payloads.push({ text: prompt });
    payloads.push({ prompt });

    let lastError: any;
    for (const payload of payloads) {
        try {
            const output = await runReplicate(MODELS.MINIMAX_SPEECH_02_HD, payload);
            const rawUrl = pickBestAudioUrl(output) || pickBestImageUrl(output);
            const audioUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });
            const item: MediaItem = {
                id: `minimax-voice-${Date.now()}`,
                name: `minimax_voice_${prompt.slice(0, 15)}.mp3`,
                type: 'audio',
                url: audioUrl,
                source: 'generated',
            };
            recordUsage({
                provider: 'replicate',
                model: MODELS.MINIMAX_SPEECH_02_HD,
                kind: 'audio',
                units: 1,
                unitLabel: 'clip',
                note: 'Minimax Speech 02 HD',
            });
            return item;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('Minimax Speech 02 HD failed.');
};

export const generateMusicWithLyria2 = async (
    prompt: string,
    opts?: { duration?: number }
): Promise<MediaItem> => {
    const payloads: Array<Record<string, any>> = [];
    const duration = opts?.duration;
    payloads.push({ prompt, duration });
    payloads.push({ text: prompt, duration });
    payloads.push({ input: prompt, duration });
    payloads.push({ prompt });
    payloads.push({ text: prompt });

    let lastError: any;
    for (const payload of payloads) {
        try {
            const output = await runReplicate(MODELS.LYRIA_2, payload);
            const rawUrl = pickBestAudioUrl(output) || pickBestImageUrl(output);
            const audioUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });
            const item: MediaItem = {
                id: `lyria-${Date.now()}`,
                name: `lyria_${prompt.slice(0, 15)}.mp3`,
                type: 'audio',
                url: audioUrl,
                source: 'generated',
            };
            recordUsage({
                provider: 'replicate',
                model: MODELS.LYRIA_2,
                kind: 'audio',
                units: 1,
                unitLabel: 'clip',
                note: 'Lyria 2',
            });
            return item;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('Lyria 2 generation failed.');
};

export const generateImageWithRunwayGen4Turbo = async (
    prompt: string,
    aspectRatio: string = '16:9'
): Promise<MediaItem> => {
    const normalizedRatio = normalizeAspectRatio(aspectRatio);
    const payloads = [
        { prompt, aspect_ratio: normalizedRatio },
        { prompt, aspectRatio: normalizedRatio },
        { text: prompt, aspect_ratio: normalizedRatio },
        { input: prompt, aspect_ratio: normalizedRatio },
        { prompt },
    ];

    let lastError: any;
    for (const payload of payloads) {
        try {
            const output = await runReplicate(MODELS.RUNWAY_GEN4_TURBO, payload);
            const rawUrl = pickBestImageUrl(output);
            const imageUrl = await ensureDisplayableImageUrl(rawUrl, { forceDownload: true });
            const item: MediaItem = {
                id: `gen4-turbo-${Date.now()}`,
                name: `gen4_turbo_${prompt.slice(0, 15)}.png`,
                type: 'image',
                url: imageUrl,
                source: 'generated',
            };
            recordUsage({
                provider: 'replicate',
                model: MODELS.RUNWAY_GEN4_TURBO,
                kind: 'image',
                units: 1,
                unitLabel: 'image',
                note: 'Runway Gen-4 Turbo',
            });
            return item;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('Runway Gen-4 Turbo failed.');
};

export const generateDepthMapWithDpt = async (
    image: { base64: string; mimeType: string },
    opts?: { model?: 'dpt' | 'midas' }
): Promise<MediaItem> => {
    const dataUri = `data:${image.mimeType};base64,${image.base64}`;
    const model = opts?.model === 'midas' ? MODELS.MIDAS_DEPTH : MODELS.DPT_DEPTH;
    const payloads = [
        { image: dataUri },
        { input_image: dataUri },
        { input: dataUri },
    ];

    let lastError: any;
    for (const payload of payloads) {
        try {
            const output = await runReplicate(model, payload);
            const rawUrl = pickBestImageUrl(output);
            const imageUrl = await ensureDisplayableImageUrl(rawUrl);
            const item: MediaItem = {
                id: `depth-${Date.now()}`,
                name: `depth_${Date.now()}.png`,
                type: 'image',
                url: imageUrl,
                source: 'generated',
            };
            recordUsage({
                provider: 'replicate',
                model,
                kind: 'image',
                units: 1,
                unitLabel: 'image',
                note: 'Depth map',
            });
            return item;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('Depth map generation failed.');
};

export const removeBackgroundWithRembg = async (
    image: { base64: string; mimeType: string }
): Promise<MediaItem> => {
    const dataUri = `data:${image.mimeType};base64,${image.base64}`;
    const payloads = [
        { image: dataUri },
        { input_image: dataUri },
        { input: dataUri },
    ];
    let lastError: any;
    for (const payload of payloads) {
        try {
            const output = await runReplicate(MODELS.REMBG, payload);
            const rawUrl = pickBestImageUrl(output);
            const imageUrl = await ensureDisplayableImageUrl(rawUrl);
            const item: MediaItem = {
                id: `rembg-${Date.now()}`,
                name: `rembg_${Date.now()}.png`,
                type: 'image',
                url: imageUrl,
                source: 'generated',
            };
            recordUsage({
                provider: 'replicate',
                model: MODELS.REMBG,
                kind: 'image',
                units: 1,
                unitLabel: 'image',
                note: 'Background removal',
            });
            return item;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('Background removal failed.');
};

export const restoreFaceWithGfpgan = async (
    image: { base64: string; mimeType: string }
): Promise<MediaItem> => {
    const dataUri = `data:${image.mimeType};base64,${image.base64}`;
    const payloads = [
        { image: dataUri },
        { input_image: dataUri },
        { input: dataUri },
    ];
    let lastError: any;
    for (const payload of payloads) {
        try {
            const output = await runReplicate(MODELS.GFPGAN, payload);
            const rawUrl = pickBestImageUrl(output);
            const imageUrl = await ensureDisplayableImageUrl(rawUrl);
            const item: MediaItem = {
                id: `gfpgan-${Date.now()}`,
                name: `gfpgan_${Date.now()}.png`,
                type: 'image',
                url: imageUrl,
                source: 'generated',
            };
            recordUsage({
                provider: 'replicate',
                model: MODELS.GFPGAN,
                kind: 'image',
                units: 1,
                unitLabel: 'image',
                note: 'GFPGAN face restore',
            });
            return item;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('GFPGAN restore failed.');
};

export const restoreFaceWithRestoreFormer = async (
    image: { base64: string; mimeType: string }
): Promise<MediaItem> => {
    const dataUri = `data:${image.mimeType};base64,${image.base64}`;
    const payloads = [
        { image: dataUri },
        { input_image: dataUri },
        { input: dataUri },
    ];
    let lastError: any;
    for (const payload of payloads) {
        try {
            const output = await runReplicate(MODELS.RESTOREFORMER, payload);
            const rawUrl = pickBestImageUrl(output);
            const imageUrl = await ensureDisplayableImageUrl(rawUrl);
            const item: MediaItem = {
                id: `restoreformer-${Date.now()}`,
                name: `restoreformer_${Date.now()}.png`,
                type: 'image',
                url: imageUrl,
                source: 'generated',
            };
            recordUsage({
                provider: 'replicate',
                model: MODELS.RESTOREFORMER,
                kind: 'image',
                units: 1,
                unitLabel: 'image',
                note: 'RestoreFormer face restore',
            });
            return item;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('RestoreFormer failed.');
};

export const interpolateVideoWithRife = async (
    video: { base64: string; mimeType: string }
): Promise<MediaItem> => {
    const dataUri = `data:${video.mimeType};base64,${video.base64}`;
    const payloads = [
        { video: dataUri },
        { input_video: dataUri },
        { input: dataUri },
    ];
    let lastError: any;
    for (const payload of payloads) {
        try {
            const output = await runReplicate(MODELS.RIFE, payload);
            const rawUrl = pickBestImageUrl(output);
            const videoUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });
            const item: MediaItem = {
                id: `rife-${Date.now()}`,
                name: `rife_${Date.now()}.mp4`,
                type: 'video',
                url: videoUrl,
                source: 'generated',
            };
            recordUsage({
                provider: 'replicate',
                model: MODELS.RIFE,
                kind: 'video',
                units: 1,
                unitLabel: 'clip',
                note: 'RIFE interpolation',
            });
            return item;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('RIFE interpolation failed.');
};

export const separateAudioWithDemucs = async (
    audio: { base64: string; mimeType: string }
): Promise<MediaItem[]> => {
    const dataUri = `data:${audio.mimeType};base64,${audio.base64}`;
    const payloads = [
        { audio: dataUri },
        { input_audio: dataUri },
        { input: dataUri },
    ];
    let lastError: any;
    for (const payload of payloads) {
        try {
            const output = await runReplicate(MODELS.DEMUCS, payload);
            const urls = collectAudioUrls(output);
            if (urls.length === 0) {
                const fallbackUrl = pickBestAudioUrl(output) || pickBestImageUrl(output);
                if (fallbackUrl) {
                    urls.push(fallbackUrl);
                }
            }
            const resolved = await Promise.all(
                urls.map((url) => ensureDisplayableFileUrl(url, { forceDownload: true }))
            );
            const items = resolved.map((url, index) => ({
                id: `demucs-${Date.now()}-${index}`,
                name: `demucs_stem_${index + 1}.wav`,
                type: 'audio' as const,
                url,
                source: 'generated' as const,
            }));
            recordUsage({
                provider: 'replicate',
                model: MODELS.DEMUCS,
                kind: 'audio',
                units: items.length || 1,
                unitLabel: 'stem',
                note: 'Demucs stem separation',
            });
            return items;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('Demucs separation failed.');
};

const runControlNet = async (
    model: string,
    prompt: string,
    image: { base64: string; mimeType: string }
): Promise<MediaItem> => {
    const dataUri = `data:${image.mimeType};base64,${image.base64}`;
    const payloads = [
        { prompt, image: dataUri },
        { prompt, control_image: dataUri },
        { prompt, input_image: dataUri },
        { prompt, image: dataUri, control_image: dataUri },
        { prompt, image: dataUri, structure_image: dataUri },
    ];

    let lastError: any;
    for (const payload of payloads) {
        try {
            const output = await runReplicate(model, payload);
            const rawUrl = pickBestImageUrl(output);
            const imageUrl = await ensureDisplayableImageUrl(rawUrl);
            const item: MediaItem = {
                id: `controlnet-${Date.now()}`,
                name: `controlnet_${prompt.slice(0, 15)}.png`,
                type: 'image',
                url: imageUrl,
                source: 'generated',
            };
            recordUsage({
                provider: 'replicate',
                model,
                kind: 'image',
                units: 1,
                unitLabel: 'image',
                note: 'ControlNet generation',
            });
            return item;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('ControlNet generation failed.');
};

export const generateImageWithControlNet = async (
    prompt: string,
    image: { base64: string; mimeType: string }
): Promise<MediaItem> => {
    return runControlNet(MODELS.CONTROLNET, prompt, image);
};

export const generateImageWithControlNetScribble = async (
    prompt: string,
    image: { base64: string; mimeType: string }
): Promise<MediaItem> => {
    return runControlNet(MODELS.CONTROLNET_SCRIBBLE, prompt, image);
};

export const generateImageWithControlNetNormal = async (
    prompt: string,
    image: { base64: string; mimeType: string }
): Promise<MediaItem> => {
    return runControlNet(MODELS.CONTROLNET_NORMAL, prompt, image);
};

export const generateModelWithRodin = async (
    prompt: string,
    image?: { base64: string; mimeType: string }
): Promise<MediaItem> => {
    const payloads: any[] = [];

    if (image) {
        const dataUri = `data:${image.mimeType};base64,${image.base64}`;
        payloads.push({ prompt, image: dataUri });
        payloads.push({ prompt, input_image: dataUri });
        payloads.push({ image: dataUri });
    } else {
        payloads.push({ prompt });
        payloads.push({ text: prompt });
    }

    let lastError: any;
    for (const payload of payloads) {
        try {
            const output = await runReplicate(MODELS.RODIN_3D, payload);
            const modelUrl =
                (output && typeof output === 'object' && (output as any).model) ||
                (output && typeof output === 'object' && (output as any).mesh) ||
                pickBestUrlByExtension(output, ['.glb', '.gltf', '.obj', '.fbx', '.usdz', '.ply']);
            const rawUrl = modelUrl || pickBestImageUrl(output);
            const assetUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });
            const item: MediaItem = {
                id: `rodin-${Date.now()}`,
                name: `rodin_${Date.now()}.glb`,
                type: 'image',
                url: assetUrl,
                source: 'generated',
            };
            recordUsage({
                provider: 'replicate',
                model: MODELS.RODIN_3D,
                kind: 'image',
                units: 1,
                unitLabel: 'asset' as any,
                note: 'Rodin 3D model',
            });
            return item;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('Rodin 3D generation failed.');
};

export const generateImageWithFlux = async (
    prompt: string,
    aspectRatio: string = "16:9",
    opts?: { loraUrl?: string; loraScale?: number }
): Promise<MediaItem> => {
    const normalizedRatio = normalizeAspectRatio(aspectRatio);

    // Flux Pro inputs
    const payload: Record<string, any> = {
        prompt,
        aspect_ratio: normalizedRatio,
        safety_tolerance: 5,
        output_format: "jpg",
    };
    if (opts?.loraUrl) {
        payload.lora = opts.loraUrl;
    }
    if (typeof opts?.loraScale === 'number') {
        payload.lora_scale = opts.loraScale;
    }
    const output = await runReplicate(MODELS.FLUX_PRO, payload);

    const rawUrl = pickBestImageUrl(output);
    const imageUrl = await ensureDisplayableImageUrl(rawUrl);

    const item: MediaItem = {
        id: `flux-${Date.now()}`,
        name: `flux_${prompt.slice(0, 15)}.jpg`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.FLUX_PRO,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'Flux image generation',
    });
    return item;
};

export const generateImageWithFluxKlein = async (
    prompt: string,
    aspectRatio: string = "16:9",
    image?: { base64: string; mimeType: string },
    opts?: { loraUrl?: string; loraScale?: number }
): Promise<MediaItem> => {
    const normalizedRatio = normalizeAspectRatio(aspectRatio);
    const dataUri = image
        ? (image.base64.startsWith('data:')
            ? image.base64
            : `data:${image.mimeType};base64,${image.base64}`)
        : undefined;

    const basePayload: Record<string, any> = {
        prompt,
        aspect_ratio: normalizedRatio,
        output_format: "jpg",
    };
    if (opts?.loraUrl) {
        basePayload.lora = opts.loraUrl;
    }
    if (typeof opts?.loraScale === 'number') {
        basePayload.lora_scale = opts.loraScale;
    }
    const initialPayload = dataUri ? { ...basePayload, image: dataUri } : basePayload;

    let output: any;
    try {
        output = await runReplicate(MODELS.FLUX_2_KLEIN_9B_BASE, initialPayload);
    } catch {
        const { width, height } = aspectRatioToSize(aspectRatio, 1024);
        const fallbackPayload: Record<string, any> = {
            prompt,
            width,
            height,
            output_format: "jpg",
        };
        if (opts?.loraUrl) {
            fallbackPayload.lora = opts.loraUrl;
        }
        if (typeof opts?.loraScale === 'number') {
            fallbackPayload.lora_scale = opts.loraScale;
        }
        if (dataUri) fallbackPayload.image = dataUri;
        output = await runReplicate(MODELS.FLUX_2_KLEIN_9B_BASE, fallbackPayload);
    }

    const rawUrl = pickBestImageUrl(output);
    const imageUrl = await ensureDisplayableImageUrl(rawUrl);

    const item: MediaItem = {
        id: `flux-klein-${Date.now()}`,
        name: `flux_klein_${prompt.slice(0, 15)}.jpg`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.FLUX_2_KLEIN_9B_BASE,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'Flux 2 Klein generation',
    });
    return item;
};

export const generateImageWithFlux2Turbo = async (
    prompt: string,
    aspectRatio: string = "16:9",
    image?: { base64: string; mimeType: string },
    opts?: { loraUrl?: string; loraScale?: number }
): Promise<MediaItem> => {
    const normalizedRatio = normalizeAspectRatio(aspectRatio);
    const dataUri = image
        ? (image.base64.startsWith('data:')
            ? image.base64
            : `data:${image.mimeType};base64,${image.base64}`)
        : undefined;

    const basePayload: Record<string, any> = {
        prompt,
        aspect_ratio: normalizedRatio,
        output_format: "jpg",
    };
    if (opts?.loraUrl) {
        basePayload.lora = opts.loraUrl;
    }
    if (typeof opts?.loraScale === 'number') {
        basePayload.lora_scale = opts.loraScale;
    }
    const initialPayload = dataUri ? { ...basePayload, image: dataUri } : basePayload;

    let output: any;
    try {
        output = await runReplicate(MODELS.FLUX_2_TURBO, initialPayload);
    } catch {
        const { width, height } = aspectRatioToSize(aspectRatio, 1024);
        const fallbackPayload: Record<string, any> = {
            prompt,
            width,
            height,
            output_format: "jpg",
        };
        if (opts?.loraUrl) {
            fallbackPayload.lora = opts.loraUrl;
        }
        if (typeof opts?.loraScale === 'number') {
            fallbackPayload.lora_scale = opts.loraScale;
        }
        if (dataUri) fallbackPayload.image = dataUri;
        output = await runReplicate(MODELS.FLUX_2_TURBO, fallbackPayload);
    }

    const rawUrl = pickBestImageUrl(output);
    const imageUrl = await ensureDisplayableImageUrl(rawUrl);

    const item: MediaItem = {
        id: `flux-2-turbo-${Date.now()}`,
        name: `flux_2_turbo_${prompt.slice(0, 15)}.jpg`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.FLUX_2_TURBO,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'Flux 2 Turbo generation',
    });
    return item;
};

export const generateImageWithZTurbo = async (
    prompt: string,
    aspectRatio: string = "16:9",
    opts?: { loraUrl?: string; loraScale?: number }
): Promise<MediaItem> => {
    // Uses prunaai/z-image-turbo
    // This model is incredibly fast (Lightning/Turbo)
    const { width, height } = aspectRatioToSize(aspectRatio, 1024);
    const loraValues = parseLoraValues(opts);
    const basePayload: Record<string, any> = {
        prompt,
        num_inference_steps: 8,
        guidance_scale: 0,
        output_format: "jpg",
        output_quality: 95,
    };
    if (loraValues) {
        basePayload.lora_weights = loraValues.loraWeights;
        basePayload.lora_scales = loraValues.loraScales;
    }
    const modelId = loraValues ? MODELS.Z_IMAGE_TURBO_LORA : MODELS.Z_IMAGE_TURBO;

    let output: any;
    try {
        output = await runReplicate(modelId, { ...basePayload, width, height });
    } catch {
        output = await runReplicate(modelId, basePayload);
    }

    const rawUrl = pickBestImageUrl(output);
    const imageUrl = await ensureDisplayableImageUrl(rawUrl, { forceDownload: true });

    const item: MediaItem = {
        id: `z-turbo-${Date.now()}`,
        name: `turbo_${prompt.slice(0, 15)}.jpg`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: modelId,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: loraValues ? 'Z-Turbo LoRA image generation' : 'Z-Turbo image generation',
    });
    return item;
};

export const generateImageWithZImage = async (
    prompt: string,
    aspectRatio: string = "16:9",
    opts?: { loraUrl?: string; loraScale?: number }
): Promise<MediaItem> => {
    // Uses prunaai/z-image (base)
    const { width, height } = aspectRatioToSize(aspectRatio, 1024);
    const loraValues = parseLoraValues(opts);
    const modelId = loraValues ? MODELS.Z_IMAGE_TURBO_LORA : MODELS.Z_IMAGE;
    const basePayload: Record<string, any> = {
        prompt,
        output_format: "jpg",
        output_quality: 95,
    };
    if (loraValues) {
        basePayload.lora_weights = loraValues.loraWeights;
        basePayload.lora_scales = loraValues.loraScales;
    }

    let output: any;
    try {
        output = await runReplicate(modelId, { ...basePayload, width, height });
    } catch {
        try {
            output = await runReplicate(modelId, basePayload);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (msg.includes('404')) {
                throw new Error('Z-Image API endpoint not found. Open the Replicate model page and copy the Version ID, then provide it so we can set `prunaai/z-image:<version>`.');
            }
            throw error;
        }
    }

    const rawUrl = pickBestImageUrl(output);
    const imageUrl = await ensureDisplayableImageUrl(rawUrl, { forceDownload: true });

    const item: MediaItem = {
        id: `z-image-${Date.now()}`,
        name: `z_image_${prompt.slice(0, 15)}.jpg`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: modelId,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: loraValues ? 'Z-Image LoRA generation' : 'Z-Image generation',
    });
    return item;
};

export const generateImageWithZTurboImg2Img = async (
    prompt: string,
    aspectRatio: string = "16:9",
    image?: { base64: string; mimeType: string },
    opts?: { loraUrl?: string; loraScale?: number }
): Promise<MediaItem> => {
    if (!image) {
        throw new Error('Z-Image Turbo Img2Img requires a reference image.');
    }
    const dataUri = image.base64.startsWith('data:')
        ? image.base64
        : `data:${image.mimeType};base64,${image.base64}`;
    const { width, height } = aspectRatioToSize(aspectRatio, 1024);
    const loraValues = parseLoraValues(opts);
    const basePayload: Record<string, any> = {
        prompt,
        image: dataUri,
        num_inference_steps: 8,
        guidance_scale: 0,
        output_format: "jpg",
        output_quality: 95,
    };
    if (loraValues) {
        basePayload.lora_weights = loraValues.loraWeights;
        basePayload.lora_scales = loraValues.loraScales;
    }

    let output: any;
    try {
        output = await runReplicate(MODELS.Z_IMAGE_TURBO_IMG2IMG, { ...basePayload, width, height });
    } catch {
        output = await runReplicate(MODELS.Z_IMAGE_TURBO_IMG2IMG, basePayload);
    }

    const rawUrl = pickBestImageUrl(output);
    const imageUrl = await ensureDisplayableImageUrl(rawUrl, { forceDownload: true });

    const item: MediaItem = {
        id: `z-turbo-img2img-${Date.now()}`,
        name: `turbo_img2img_${prompt.slice(0, 15)}.jpg`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.Z_IMAGE_TURBO_IMG2IMG,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: loraValues ? 'Z-Image Turbo Img2Img LoRA generation' : 'Z-Image Turbo Img2Img generation',
    });
    return item;
};

export const generateImageWithGptImage15 = async (
    prompt: string,
    aspectRatio: string = "16:9",
    referenceImages?: { base64: string; mimeType: string }[]
): Promise<MediaItem> => {
    const { width, height } = aspectRatioToSize(aspectRatio, 1024);
    const imageInput = referenceImages && referenceImages.length > 0
        ? referenceImages.map((img) => `data:${img.mimeType};base64,${img.base64}`)
        : null;
    let output: any;
    try {
        const payload: Record<string, any> = {
            prompt,
            width,
            height,
        };
        if (imageInput) {
            payload.image_input = imageInput;
        }
        output = await runReplicate(MODELS.GPT_IMAGE_1_5, payload);
    } catch {
        try {
            const payload: Record<string, any> = {
                prompt,
                width,
                height,
            };
            if (imageInput) {
                payload.image = imageInput[0];
            }
            output = await runReplicate(MODELS.GPT_IMAGE_1_5, payload);
        } catch {
            const size = `${width}x${height}`;
            try {
                const payload: Record<string, any> = {
                    prompt,
                    size,
                };
                if (imageInput) {
                    payload.image_input = imageInput;
                }
                output = await runReplicate(MODELS.GPT_IMAGE_1_5, payload);
            } catch {
                const payload: Record<string, any> = {
                    prompt,
                    size,
                };
                if (imageInput) {
                    payload.image = imageInput[0];
                }
                output = await runReplicate(MODELS.GPT_IMAGE_1_5, payload);
            }
        }
    }

    const rawUrl = pickBestImageUrl(output);
    const imageUrl = await ensureDisplayableImageUrl(rawUrl, { forceDownload: true });

    const item: MediaItem = {
        id: `gpt-image-1.5-${Date.now()}`,
        name: `gpt_image_${prompt.slice(0, 15)}.jpg`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.GPT_IMAGE_1_5,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'GPT Image 1.5 generation',
    });
    return item;
};

export const generateImageWithGemini3ProReplicate = async (
    prompt: string,
    aspectRatio: string = "16:9",
    imageSize: string = "1K",
    referenceImages?: { base64: string; mimeType: string }[]
): Promise<MediaItem> => {
    const normalizedRatio = normalizeAspectRatio(aspectRatio);
    const normalizedSize = imageSize === '4K' ? '4K' : imageSize === '2K' ? '2K' : '1K';
    const imageInput = referenceImages && referenceImages.length > 0
        ? referenceImages.map((img) => `data:${img.mimeType};base64,${img.base64}`)
        : null;
    const { width, height } = aspectRatioToSize(aspectRatio, 1024);

    const nanoPayloads: Array<Record<string, any>> = [];
    nanoPayloads.push({
        prompt,
        aspect_ratio: normalizedRatio,
        resolution: normalizedSize,
        ...(imageInput ? { image_input: imageInput } : {}),
    });
    nanoPayloads.push({
        prompt,
        aspect_ratio: normalizedRatio,
        ...(imageInput ? { image_input: imageInput } : {}),
    });
    if (imageInput && imageInput.length > 0) {
        nanoPayloads.push({
            prompt,
            image_input: imageInput,
        });
        nanoPayloads.push({
            prompt,
            image: imageInput[0],
        });
    }
    nanoPayloads.push({ prompt });

    const geminiPayloads: Array<Record<string, any>> = [];
    geminiPayloads.push({
        prompt,
        aspect_ratio: normalizedRatio,
        image_size: normalizedSize,
        ...(imageInput ? { image_input: imageInput } : {}),
    });
    geminiPayloads.push({
        prompt,
        aspect_ratio: normalizedRatio,
        size: normalizedSize,
        ...(imageInput ? { image_input: imageInput } : {}),
    });
    geminiPayloads.push({
        prompt,
        width,
        height,
        ...(imageInput ? { image_input: imageInput } : {}),
    });
    if (imageInput && imageInput.length > 0) {
        geminiPayloads.push({
            prompt,
            width,
            height,
            image: imageInput[0],
        });
    }
    geminiPayloads.push({ prompt });

    let output: any;
    let lastError: any;
    let usedModel = MODELS.NANO_BANANA_PRO;
    for (const payload of nanoPayloads) {
        try {
            output = await runReplicate(MODELS.NANO_BANANA_PRO, payload);
            break;
        } catch (error) {
            lastError = error;
        }
    }

    if (!output) {
        usedModel = MODELS.GEMINI_3_PRO_IMAGE;
        for (const payload of geminiPayloads) {
            try {
                output = await runReplicate(MODELS.GEMINI_3_PRO_IMAGE, payload);
                break;
            } catch (error) {
                lastError = error;
            }
        }
    }
    if (!output) {
        throw lastError || new Error('Gemini 3 Pro (Replicate) generation failed.');
    }

    const rawUrl = pickBestImageUrl(output);
    const imageUrl = await ensureDisplayableImageUrl(rawUrl, { forceDownload: true });

    const item: MediaItem = {
        id: `gemini-3-pro-${Date.now()}`,
        name: `gemini_3_pro_${prompt.slice(0, 15)}.png`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: usedModel,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'Gemini 3 Pro image generation (Replicate)',
    });
    return item;
};

export const generateImageWithNanoBananaPro = async (
    prompt: string,
    aspectRatio: string = "16:9",
    imageSize: string = "1K",
    referenceImages?: { base64: string; mimeType: string }[]
): Promise<MediaItem> => {
    const normalizedRatio = normalizeAspectRatio(aspectRatio);
    const normalizedSize = imageSize === '4K' ? '4K' : imageSize === '2K' ? '2K' : '1K';
    const imageInput = referenceImages && referenceImages.length > 0
        ? referenceImages.map((img) => `data:${img.mimeType};base64,${img.base64}`)
        : null;

    const payloads: Array<Record<string, any>> = [];
    payloads.push({
        prompt,
        aspect_ratio: normalizedRatio,
        resolution: normalizedSize,
        ...(imageInput ? { image_input: imageInput } : {}),
    });
    payloads.push({
        prompt,
        aspect_ratio: normalizedRatio,
        ...(imageInput ? { image_input: imageInput } : {}),
    });
    if (imageInput && imageInput.length > 0) {
        payloads.push({ prompt, image_input: imageInput });
        payloads.push({ prompt, image: imageInput[0] });
    }
    payloads.push({ prompt });

    let output: any;
    let lastError: any;
    for (const payload of payloads) {
        try {
            output = await runReplicate(MODELS.NANO_BANANA_PRO, payload);
            break;
        } catch (error) {
            lastError = error;
        }
    }

    if (!output) {
        throw lastError || new Error('Nano Banana Pro generation failed.');
    }

    const rawUrl = pickBestImageUrl(output);
    const imageUrl = await ensureDisplayableImageUrl(rawUrl, { forceDownload: true });

    const item: MediaItem = {
        id: `nano-banana-${Date.now()}`,
        name: `nano_banana_${prompt.slice(0, 15)}.png`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.NANO_BANANA_PRO,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'Nano Banana Pro image generation',
    });
    return item;
};

export const generateImageWithGemini3ProReplicateOnly = async (
    prompt: string,
    aspectRatio: string = "16:9",
    imageSize: string = "1K",
    referenceImages?: { base64: string; mimeType: string }[]
): Promise<MediaItem> => {
    const normalizedRatio = normalizeAspectRatio(aspectRatio);
    const normalizedSize = imageSize === '4K' ? '4K' : imageSize === '2K' ? '2K' : '1K';
    const { width, height } = aspectRatioToSize(aspectRatio, 1024);
    const imageInput = referenceImages && referenceImages.length > 0
        ? referenceImages.map((img) => `data:${img.mimeType};base64,${img.base64}`)
        : null;

    const payloads: Array<Record<string, any>> = [];
    payloads.push({
        prompt,
        aspect_ratio: normalizedRatio,
        image_size: normalizedSize,
        ...(imageInput ? { image_input: imageInput } : {}),
    });
    payloads.push({
        prompt,
        aspect_ratio: normalizedRatio,
        size: normalizedSize,
        ...(imageInput ? { image_input: imageInput } : {}),
    });
    payloads.push({
        prompt,
        width,
        height,
        ...(imageInput ? { image_input: imageInput } : {}),
    });
    if (imageInput && imageInput.length > 0) {
        payloads.push({
            prompt,
            width,
            height,
            image: imageInput[0],
        });
    }
    payloads.push({ prompt });

    let output: any;
    let lastError: any;
    for (const payload of payloads) {
        try {
            output = await runReplicate(MODELS.GEMINI_3_PRO_IMAGE, payload);
            break;
        } catch (error) {
            lastError = error;
        }
    }

    if (!output) {
        throw lastError || new Error('Gemini 3 Pro (Replicate) generation failed.');
    }

    const rawUrl = pickBestImageUrl(output);
    const imageUrl = await ensureDisplayableImageUrl(rawUrl, { forceDownload: true });

    const item: MediaItem = {
        id: `gemini-3-pro-${Date.now()}`,
        name: `gemini_3_pro_${prompt.slice(0, 15)}.png`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.GEMINI_3_PRO_IMAGE,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'Gemini 3 Pro image generation (Replicate)',
    });
    return item;
};

export const generateImageWithQwenImage = async (
    prompt: string,
    aspectRatio: string = "16:9",
    image?: { base64: string; mimeType: string }
): Promise<MediaItem> => {
    const normalizedRatio = normalizeAspectRatio(aspectRatio);
    const dataUri = image
        ? (image.base64.startsWith('data:')
            ? image.base64
            : `data:${image.mimeType};base64,${image.base64}`)
        : undefined;

    const inputPayload: Record<string, any> = {
        prompt,
        aspect_ratio: normalizedRatio,
        go_fast: true,
        output_format: "webp",
        output_quality: 95,
    };

    if (dataUri) {
        inputPayload.image = dataUri;
    }

    const output = await runReplicate(MODELS.QWEN_IMAGE_2512, inputPayload);
    const rawUrl = pickBestImageUrl(output);
    const imageUrl = await ensureDisplayableImageUrl(rawUrl, { forceDownload: true });

    const item: MediaItem = {
        id: `qwen-2512-${Date.now()}`,
        name: `qwen_2512_${prompt.slice(0, 15)}.webp`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.QWEN_IMAGE_2512,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'Qwen image generation',
    });
    return item;
};

export const generateImageWithSeedream = async (
    prompt: string,
    aspectRatio: string = "16:9",
    size: '2K' | '4K' = '2K'
): Promise<MediaItem> => {
    const normalizedSize = size === '4K' ? '4K' : '2K';
    const normalizedRatio = normalizeAspectRatio(aspectRatio);
    const output = await runReplicate(MODELS.SEEDREAM_45, {
        prompt,
        size: normalizedSize,
        aspect_ratio: normalizedRatio,
        max_images: 1,
        sequential_image_generation: "disabled"
    });

    const rawUrl = pickBestImageUrl(output);
    const imageUrl = await ensureDisplayableImageUrl(rawUrl);

    const item: MediaItem = {
        id: `seedream-${Date.now()}`,
        name: `seedream_${prompt.slice(0, 15)}.jpg`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.SEEDREAM_45,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'Seedream image generation',
    });
    return item;
};

export const generateImageWithSeedreamReferences = async (
    prompt: string,
    referenceImages: { base64: string; mimeType: string }[],
    aspectRatio: string = "16:9",
    size: '2K' | '4K' = '2K'
): Promise<MediaItem> => {
    const normalizedSize = size === '4K' ? '4K' : '2K';
    const normalizedRatio = normalizeAspectRatio(aspectRatio);
    const imageInput = referenceImages.map((img) => `data:${img.mimeType};base64,${img.base64}`);
    const output = await runReplicate(MODELS.SEEDREAM_45, {
        prompt,
        size: normalizedSize,
        aspect_ratio: normalizedRatio,
        max_images: 1,
        sequential_image_generation: "disabled",
        image_input: imageInput
    });

    const rawUrl = pickBestImageUrl(output);
    const imageUrl = await ensureDisplayableImageUrl(rawUrl);

    const item: MediaItem = {
        id: `seedream-ref-${Date.now()}`,
        name: `seedream_ref_${prompt.slice(0, 15)}.jpg`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.SEEDREAM_45,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'Seedream reference image generation',
    });
    return item;
};

export const generateImageWithWan27ImagePro = async (
    prompt: string,
    aspectRatio: string = "16:9",
    size: '1K' | '2K' | '4K' = '1K',
    referenceImages?: { base64: string; mimeType: string }[],
    opts?: {
        thinkingMode?: boolean;
        seed?: number;
        numOutputs?: number;
        imageSetMode?: boolean;
    }
): Promise<MediaItem> => {
    const references = Array.isArray(referenceImages)
        ? referenceImages.filter((image) => !!image?.base64).slice(0, 9)
        : [];
    const hasReferences = references.length > 0;
    const input: Record<string, any> = {
        prompt,
        size: mapWan27ImageSize(aspectRatio, size, { hasReferences }),
        num_outputs: Math.max(1, Math.round(opts?.numOutputs || 1)),
    };

    if (hasReferences) {
        input.images = references.map((image) => toReplicateDataUri(image));
    }

    const thinkingMode = typeof opts?.thinkingMode === 'boolean' ? opts.thinkingMode : !hasReferences;
    if (thinkingMode) {
        input.thinking_mode = true;
    }
    if (typeof opts?.imageSetMode === 'boolean') {
        input.image_set_mode = opts.imageSetMode;
    }
    if (typeof opts?.seed === 'number' && Number.isFinite(opts.seed)) {
        input.seed = Math.round(opts.seed);
    }

    const output = await runReplicate(MODELS.WAN_2_7_IMAGE_PRO, input);
    const rawUrl = pickBestImageUrl(output);
    const imageUrl = await ensureDisplayableImageUrl(rawUrl, { forceDownload: true });

    const item: MediaItem = {
        id: `wan27-image-pro-${Date.now()}`,
        name: `wan27_image_pro_${prompt.slice(0, 15) || 'image'}.webp`,
        type: 'image',
        url: imageUrl,
        source: 'generated',
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.WAN_2_7_IMAGE_PRO,
        kind: hasReferences ? 'edit' : 'image',
        units: 1,
        unitLabel: 'image',
        note: hasReferences ? 'Wan 2.7 Image Pro edit' : 'Wan 2.7 Image Pro generation',
    });
    return item;
};

export const inpaintWithNanoBanana = async (
    prompt: string,
    maskedImageDataUrl: string,
    resolution: '1K' | '2K' | '4K' = '2K'
): Promise<MediaItem> => {
    const output = await runReplicate(MODELS.NANO_BANANA_PRO, {
        prompt,
        image_input: [maskedImageDataUrl],
        aspect_ratio: 'match_input_image',
        resolution,
        output_format: 'png',
        safety_filter_level: 'block_only_high'
    });

    const imageUrl = await ensureDisplayableImageUrl(pickBestImageUrl(output));
    const item: MediaItem = {
        id: `nano-banana-${Date.now()}`,
        name: `nano_banana_${prompt.slice(0, 15)}.png`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.NANO_BANANA_PRO,
        kind: 'edit',
        units: 1,
        unitLabel: 'image',
        note: 'Nano Banana inpaint',
    });
    return item;
};

export const inpaintWithFlux2Pro = async (
    prompt: string,
    maskedImageDataUrl: string,
    resolution: 'match_input_image' | '0.5 MP' | '1 MP' | '2 MP' | '4 MP' = 'match_input_image'
): Promise<MediaItem> => {
    const output = await runReplicate(MODELS.FLUX_2_PRO, {
        prompt,
        input_images: [maskedImageDataUrl],
        aspect_ratio: 'match_input_image',
        resolution,
        output_format: 'png',
        safety_tolerance: 2
    });

    const imageUrl = await ensureDisplayableImageUrl(pickBestImageUrl(output));
    const item: MediaItem = {
        id: `flux2-pro-${Date.now()}`,
        name: `flux2_inpaint_${prompt.slice(0, 15)}.png`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.FLUX_2_PRO,
        kind: 'edit',
        units: 1,
        unitLabel: 'image',
        note: 'Flux 2 Pro inpaint',
    });
    return item;
};

export const inpaintWithZTurboInpaint = async (
    prompt: string,
    maskedImageDataUrl: string
): Promise<MediaItem> => {
    const output = await runReplicate(MODELS.Z_IMAGE_TURBO_INPAINT, {
        prompt,
        image: maskedImageDataUrl,
        output_format: 'png',
    });

    const imageUrl = await ensureDisplayableImageUrl(pickBestImageUrl(output), { forceDownload: true });
    const item: MediaItem = {
        id: `z-turbo-inpaint-${Date.now()}`,
        name: `z_turbo_inpaint_${prompt.slice(0, 15)}.png`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.Z_IMAGE_TURBO_INPAINT,
        kind: 'edit',
        units: 1,
        unitLabel: 'image',
        note: 'Z-Image Turbo inpaint',
    });
    return item;
};

type UpscaleImageOptions = {
    scale?: number;
    resolution?: string;
};

type UpscaleVideoOptions = {
    scale?: number;
    resolution?: string;
};

const buildUpscalePayloads = (basePayloads: any[], opts?: UpscaleImageOptions | UpscaleVideoOptions) => {
    const payloads: any[] = [];
    const seen = new Set<string>();
    const push = (payload: any) => {
        const key = JSON.stringify(payload);
        if (!seen.has(key)) {
            seen.add(key);
            payloads.push(payload);
        }
    };

    const scaleValue = Number.isFinite(Number(opts?.scale)) ? Number(opts?.scale) : undefined;
    const resolutionValue = typeof opts?.resolution === 'string' ? opts.resolution.trim() : '';

    basePayloads.forEach((base) => {
        push(base);
        if (scaleValue !== undefined) {
            push({ ...base, scale: scaleValue });
            push({ ...base, upscale: scaleValue });
            push({ ...base, factor: scaleValue });
        }
        if (resolutionValue) {
            push({ ...base, resolution: resolutionValue });
            push({ ...base, target_resolution: resolutionValue });
            push({ ...base, output_resolution: resolutionValue });
        }
        if (scaleValue !== undefined && resolutionValue) {
            push({ ...base, scale: scaleValue, resolution: resolutionValue });
            push({ ...base, upscale: scaleValue, target_resolution: resolutionValue });
        }
    });

    return payloads;
};

export const upscaleImage = async (
    image: { base64: string, mimeType: string },
    opts?: UpscaleImageOptions
): Promise<MediaItem> => {
    const dataUri = `data:${image.mimeType};base64,${image.base64}`;
    const payloads = buildUpscalePayloads(
        [{ image: dataUri, scale: 4, face_enhance: true }],
        opts
    );
    let output: any;
    let lastError: any;
    for (const payload of payloads) {
        try {
            output = await runReplicate(MODELS.REAL_ESRGAN, payload);
            break;
        } catch (error) {
            lastError = error;
        }
    }
    if (!output) {
        throw lastError || new Error('Real-ESRGAN upscale failed.');
    }

    const item: MediaItem = {
        id: `upscale-${Date.now()}`,
        name: `upscaled_image.png`,
        type: 'image',
        url: output, // Replicate URL
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.REAL_ESRGAN,
        kind: 'edit',
        units: 1,
        unitLabel: 'image',
        note: 'Image upscale',
    });
    return item;
};

export const upscaleImageWithCrystal = async (
    image: { base64: string; mimeType: string },
    opts?: UpscaleImageOptions
): Promise<MediaItem> => {
    const dataUri = `data:${image.mimeType};base64,${image.base64}`;
    const payloads = buildUpscalePayloads(
        [
            { image: dataUri },
            { input_image: dataUri },
            { input: dataUri },
        ],
        opts
    );

    let output: any;
    let lastError: any;
    for (const payload of payloads) {
        try {
            output = await runReplicate(MODELS.CRYSTAL_UPSCALER, payload);
            break;
        } catch (error) {
            lastError = error;
        }
    }
    if (!output) {
        throw lastError || new Error('Crystal upscale failed.');
    }

    const imageUrl = await ensureDisplayableImageUrl(pickBestImageUrl(output), { forceDownload: true });
    const item: MediaItem = {
        id: `crystal-upscale-${Date.now()}`,
        name: `crystal_upscaled.png`,
        type: 'image',
        url: imageUrl,
        source: 'generated',
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.CRYSTAL_UPSCALER,
        kind: 'edit',
        units: 1,
        unitLabel: 'image',
        note: 'Crystal image upscale',
    });
    return item;
};

export const upscaleImageWithClarity = async (
    image: { base64: string; mimeType: string },
    opts?: UpscaleImageOptions
): Promise<MediaItem> => {
    const dataUri = `data:${image.mimeType};base64,${image.base64}`;
    const payloads = buildUpscalePayloads(
        [
            { image: dataUri },
            { input_image: dataUri },
            { input: dataUri },
        ],
        opts
    );

    let output: any;
    let lastError: any;
    for (const payload of payloads) {
        try {
            output = await runReplicate(MODELS.CLARITY_UPSCALER, payload);
            break;
        } catch (error) {
            lastError = error;
        }
    }
    if (!output) {
        throw lastError || new Error('Clarity upscale failed.');
    }

    const imageUrl = await ensureDisplayableImageUrl(pickBestImageUrl(output), { forceDownload: true });
    const item: MediaItem = {
        id: `clarity-upscale-${Date.now()}`,
        name: `clarity_upscaled.png`,
        type: 'image',
        url: imageUrl,
        source: 'generated',
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.CLARITY_UPSCALER,
        kind: 'edit',
        units: 1,
        unitLabel: 'image',
        note: 'Clarity image upscale',
    });
    return item;
};

export const upscaleImageWithTopaz = async (
    image: { base64: string; mimeType: string },
    opts?: UpscaleImageOptions
): Promise<MediaItem> => {
    const dataUri = `data:${image.mimeType};base64,${image.base64}`;
    const payloads = buildUpscalePayloads(
        [
            { image: dataUri },
            { input_image: dataUri },
            { input: dataUri },
            { image: dataUri, scale: 4 },
            { input_image: dataUri, scale: 4 },
            { input: dataUri, scale: 4 },
        ],
        opts
    );

    let output: any;
    let lastError: any;
    for (const payload of payloads) {
        try {
            output = await runReplicate(MODELS.TOPAZ_UPSCALER, payload);
            break;
        } catch (error) {
            lastError = error;
        }
    }
    if (!output) {
        throw lastError || new Error('Topaz upscale failed.');
    }

    const imageUrl = await ensureDisplayableImageUrl(pickBestImageUrl(output), { forceDownload: true });
    const item: MediaItem = {
        id: `topaz-upscale-${Date.now()}`,
        name: `topaz_upscaled.png`,
        type: 'image',
        url: imageUrl,
        source: 'generated',
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.TOPAZ_UPSCALER,
        kind: 'edit',
        units: 1,
        unitLabel: 'image',
        note: 'Topaz image upscale',
    });
    return item;
};

export const upscaleVideoWithCrystal = async (
    video: { base64: string; mimeType: string },
    opts?: UpscaleVideoOptions
): Promise<MediaItem> => {
    const dataUri = `data:${video.mimeType};base64,${video.base64}`;
    const payloads = buildUpscalePayloads(
        [
            { video: dataUri },
            { input_video: dataUri },
            { input: dataUri },
        ],
        opts
    );

    let output: any;
    let lastError: any;
    for (const payload of payloads) {
        try {
            output = await runReplicate(MODELS.CRYSTAL_VIDEO_UPSCALER, payload);
            break;
        } catch (error) {
            lastError = error;
        }
    }
    if (!output) {
        throw lastError || new Error('Crystal video upscale failed.');
    }
    const rawUrl = pickBestImageUrl(output);
    const videoUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });

    let duration: number | undefined;
    try {
        duration = await getVideoDuration(videoUrl);
    } catch (e) {
        duration = 5;
    }

    const item: MediaItem = {
        id: `crystal-video-upscale-${Date.now()}`,
        name: `crystal_video_upscaled.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration,
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.CRYSTAL_VIDEO_UPSCALER,
        kind: 'edit',
        units: duration || 5,
        unitLabel: 'second',
        note: 'Crystal video upscale',
    });
    return item;
};

export const upscaleVideoWithTopaz = async (
    video: { base64: string; mimeType: string },
    opts?: UpscaleVideoOptions
): Promise<MediaItem> => {
    const dataUri = `data:${video.mimeType};base64,${video.base64}`;
    const payloads = buildUpscalePayloads(
        [
            { video: dataUri },
            { input_video: dataUri },
            { input: dataUri },
        ],
        opts
    );

    let output: any;
    let lastError: any;
    for (const payload of payloads) {
        try {
            output = await runReplicate(MODELS.TOPAZ_VIDEO_UPSCALER, payload);
            break;
        } catch (error) {
            lastError = error;
        }
    }
    if (!output) {
        throw lastError || new Error('Topaz video upscale failed.');
    }

    const rawUrl = pickBestImageUrl(output);
    const videoUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });

    let duration: number | undefined;
    try {
        duration = await getVideoDuration(videoUrl);
    } catch (e) {
        duration = 5;
    }

    const item: MediaItem = {
        id: `topaz-video-upscale-${Date.now()}`,
        name: `topaz_video_upscaled.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration,
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.TOPAZ_VIDEO_UPSCALER,
        kind: 'edit',
        units: duration || 5,
        unitLabel: 'second',
        note: 'Topaz video upscale',
    });
    return item;
};

export const editImageWithFlux = async (prompt: string, image: { base64: string, mimeType: string }, mask?: { base64: string, mimeType: string }): Promise<MediaItem> => {
    const dataUri = `data:${image.mimeType};base64,${image.base64}`;
    const maskUri = mask ? `data:${mask.mimeType};base64,${mask.base64}` : undefined;

    // Flux Fill parameters
    const inputPayload: any = {
        image: dataUri,
        prompt: prompt,
        guidance: 30, // Higher guidance for editing usually
        output_format: "jpg"
    };

    if (maskUri) {
        inputPayload.mask = maskUri;
    }

    const output = await runReplicate(MODELS.FLUX_FILL, inputPayload);

    let imageUrl = output;
    if (Array.isArray(output)) imageUrl = output[0];

    const item: MediaItem = {
        id: `flux-edit-${Date.now()}`,
        name: `edit_${prompt.slice(0, 10)}.jpg`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.FLUX_FILL,
        kind: 'edit',
        units: 1,
        unitLabel: 'image',
        note: 'Flux edit',
    });
    return item;
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
    }
): Promise<MediaItem> => {
    const allImages = [image, ...(opts?.extraImages || [])];
    const dataUris = allImages.map((img) =>
        img.base64.startsWith('data:')
            ? img.base64
            : `data:${img.mimeType};base64,${img.base64}`
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

    const item: MediaItem = {
        id: `qwen-edit-${Date.now()}`,
        name: `qwen_edit_${prompt.slice(0, 10)}.webp`,
        type: 'image',
        url: imageUrl,
        source: 'generated'
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.QWEN_IMAGE_EDIT,
        kind: 'edit',
        units: 1,
        unitLabel: 'image',
        note: 'Qwen image edit',
    });
    return item;
};

export const editImageWithFireRed = async (
    prompt: string,
    images: { base64: string; mimeType: string }[],
    opts?: {
        aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | 'match_input_image';
        goFast?: boolean;
        outputFormat?: 'webp' | 'jpg' | 'png';
        outputQuality?: number;
        trueCfgScale?: number;
        numInferenceSteps?: number;
        seed?: number;
    }
): Promise<MediaItem> => {
    if (!images.length) {
        throw new Error('FireRed Edit requires at least one reference image.');
    }

    const dataUris = images.map((img) =>
        img.base64.startsWith('data:')
            ? img.base64
            : `data:${img.mimeType};base64,${img.base64}`
    );

    const output = await runReplicate(MODELS.FIRERED_IMAGE_EDIT, {
        prompt,
        image: dataUris,
        aspect_ratio: opts?.aspectRatio || 'match_input_image',
        go_fast: opts?.goFast ?? true,
        output_format: opts?.outputFormat || 'webp',
        output_quality: opts?.outputQuality ?? 95,
        true_cfg_scale: opts?.trueCfgScale ?? 4,
        num_inference_steps: opts?.numInferenceSteps ?? 40,
        seed: opts?.seed,
    });

    const rawUrl = pickBestImageUrl(output);
    const imageUrl = await ensureDisplayableImageUrl(rawUrl, { forceDownload: true });

    const item: MediaItem = {
        id: `firered-edit-${Date.now()}`,
        name: `firered_edit_${prompt.slice(0, 10)}.webp`,
        type: 'image',
        url: imageUrl,
        source: 'generated',
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.FIRERED_IMAGE_EDIT,
        kind: 'edit',
        units: 1,
        unitLabel: 'image',
        note: 'FireRed image edit',
    });
    return item;
};

export const relightImageWithReplicate = async (
    prompt: string,
    image: { base64: string; mimeType: string },
    opts?: { aspectRatio?: string }
): Promise<MediaItem> => {
    const item = await editImageWithQwen(prompt, image, {
        aspectRatio: opts?.aspectRatio || 'match_input_image',
        outputFormat: 'png',
        outputQuality: 95,
        goFast: true,
    });
    return {
        ...item,
        name: `relight_${Date.now()}.png`,
    };
};

export const editImageWithQwenMultiAngle = async (
    prompt: string,
    image: { base64: string; mimeType: string },
    opts?: { numOutputs?: number }
): Promise<MediaItem[]> => {
    const dataUri = image.base64.startsWith('data:')
        ? image.base64
        : `data:${image.mimeType};base64,${image.base64}`;
    const input: Record<string, any> = {
        prompt,
        image: dataUri,
    };
    if (opts?.numOutputs) {
        input.num_outputs = opts.numOutputs;
    }

    const output = await runReplicate(MODELS.QWEN_EDIT_MULTIANGLE, input);
    let urls = normalizeImageUrls(output);
    if (urls.length === 0) {
        const fallback = pickBestImageUrl(output);
        if (fallback) urls = [fallback];
    }
    if (urls.length === 0) {
        throw new Error('Qwen multi-angle returned no images.');
    }

    const uniqueUrls = Array.from(new Set(urls));
    const displayUrls = await Promise.all(
        uniqueUrls.map((url) => ensureDisplayableImageUrl(url, { forceDownload: true }))
    );

    recordUsage({
        provider: 'replicate',
        model: MODELS.QWEN_EDIT_MULTIANGLE,
        kind: 'edit',
        units: displayUrls.length || 1,
        unitLabel: 'image',
        note: 'Qwen multi-angle edit',
    });

    return displayUrls.map((url, index) => ({
        id: `qwen-multi-${Date.now()}-${index}`,
        name: `qwen_multi_${prompt.slice(0, 10)}_${index + 1}.png`,
        type: 'image',
        url,
        source: 'generated'
    }));
};

export const generateVideoWithVeoReplicate = async (
    prompt: string,
    aspectRatio: string = '16:9',
    model: string = 'veo-3.1-fast-generate-preview',
    referenceImage?: { base64: string; mimeType: string },
    onProgress?: (message: string) => void
): Promise<MediaItem> => {
    const normalizedRatio = normalizeAspectRatio(aspectRatio);
    const imageUri = referenceImage ? `data:${referenceImage.mimeType};base64,${referenceImage.base64}` : undefined;
    const modelId = model.includes('fast') ? MODELS.VEO_3_1_FAST : MODELS.VEO_3_1;
    const basePayload: Record<string, any> = {
        prompt,
        aspect_ratio: normalizedRatio,
        resolution: '720p',
    };
    if (imageUri) {
        basePayload.image = imageUri;
    }

    let output: any;
    onProgress?.('Starting Veo on Replicate...');
    try {
        output = await runReplicate(modelId, basePayload);
    } catch {
        const fallbackPayload: Record<string, any> = { prompt };
        if (imageUri) {
            fallbackPayload.image = imageUri;
        }
        output = await runReplicate(modelId, fallbackPayload);
    }

    const rawUrl = pickBestImageUrl(output);
    const videoUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });

    let duration: number | undefined;
    try {
        duration = await getVideoDuration(videoUrl);
    } catch (e) {
        duration = 5;
    }

    recordUsage({
        provider: 'replicate',
        model: modelId,
        kind: 'video',
        units: duration || 5,
        unitLabel: 'second',
        note: 'Veo video generation (Replicate)',
    });

    return {
        id: `veo-${Date.now()}`,
        name: `veo_video_${prompt.slice(0, 15)}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration,
    };
};

export const generateVideoWithWanI2V = async (
    prompt: string,
    image: { base64: string; mimeType: string },
    opts?: { resolution?: '480p' | '720p'; numFrames?: number; fps?: number; interpolate?: boolean }
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

    recordUsage({
        provider: 'replicate',
        model: MODELS.WAN_2_2_I2V_FAST,
        kind: 'video',
        units: duration || 5,
        unitLabel: 'second',
        note: 'Wan I2V',
    });

    return {
        id: `wan-${Date.now()}`,
        name: `wan_video_${prompt.slice(0, 15)}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration,
    };
};

export const generateVideoWithSeedance = async (
    prompt: string,
    image?: { base64: string; mimeType: string }
): Promise<MediaItem> => {
    const imageUri = image ? `data:${image.mimeType};base64,${image.base64}` : undefined;
    const input: Record<string, any> = { prompt };
    if (imageUri) {
        input.image = imageUri;
    }

    const output = await runReplicate(MODELS.SEEDANCE_1_5_PRO, input);
    const rawUrl = pickBestImageUrl(output);
    const videoUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });

    let duration: number | undefined;
    try {
        duration = await getVideoDuration(videoUrl);
    } catch (e) {
        duration = 5;
    }

    recordUsage({
        provider: 'replicate',
        model: MODELS.SEEDANCE_1_5_PRO,
        kind: 'video',
        units: duration || 5,
        unitLabel: 'second',
        note: 'Seedance video',
    });

    return {
        id: `seedance-${Date.now()}`,
        name: `seedance_${prompt.slice(0, 15)}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration,
    };
};

export const generateVideoWithWanAnimateReplace = async (
    video: { base64: string; mimeType: string },
    characterImage: { base64: string; mimeType: string },
    opts?: {
        resolution?: '480' | '720';
        fps?: number;
        refertNum?: 1 | 5;
        mergeAudio?: boolean;
        goFast?: boolean;
        seed?: number;
    }
): Promise<MediaItem> => {
    const videoUri = `data:${video.mimeType};base64,${video.base64}`;
    const imageUri = `data:${characterImage.mimeType};base64,${characterImage.base64}`;
    const output = await runReplicate(MODELS.WAN_2_2_ANIMATE_REPLACE, {
        video: videoUri,
        character_image: imageUri,
        resolution: opts?.resolution || '720',
        frames_per_second: opts?.fps || 24,
        refert_num: opts?.refertNum || 1,
        merge_audio: opts?.mergeAudio ?? true,
        go_fast: opts?.goFast ?? true,
        seed: opts?.seed,
    });

    const rawUrl = pickBestImageUrl(output);
    const videoUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });

    let duration: number | undefined;
    try {
        duration = await getVideoDuration(videoUrl);
    } catch (e) {
        duration = 5;
    }

    recordUsage({
        provider: 'replicate',
        model: MODELS.WAN_2_2_ANIMATE_REPLACE,
        kind: 'video',
        units: duration || 5,
        unitLabel: 'second',
        note: 'Wan animate replace',
    });

    return {
        id: `wan-replace-${Date.now()}`,
        name: `wan_replace_${Date.now()}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration,
    };
};

export const generateVideoWithOmniHuman = async (
    image: { base64: string; mimeType: string },
    audio: { base64: string; mimeType: string }
): Promise<MediaItem> => {
    const imageUri = `data:${image.mimeType};base64,${image.base64}`;
    const audioUri = `data:${audio.mimeType};base64,${audio.base64}`;
    const output = await runReplicate(MODELS.OMNI_HUMAN, {
        image: imageUri,
        audio: audioUri,
    });

    const rawUrl = pickBestImageUrl(output);
    const videoUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });

    let duration: number | undefined;
    try {
        duration = await getVideoDuration(videoUrl);
    } catch (e) {
        duration = 5;
    }

    recordUsage({
        provider: 'replicate',
        model: MODELS.OMNI_HUMAN,
        kind: 'video',
        units: duration || 5,
        unitLabel: 'second',
        note: 'OmniHuman video',
    });

    return {
        id: `omni-human-${Date.now()}`,
        name: `omni_human_${Date.now()}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration,
    };
};

export const generateVideoWithKling26 = async (
    prompt: string,
    opts?: {
        startImage?: { base64: string; mimeType: string };
        aspectRatio?: '16:9' | '9:16' | '1:1';
        duration?: 5 | 10;
        negativePrompt?: string;
        generateAudio?: boolean;
    }
): Promise<MediaItem> => {
    const startImageUri = opts?.startImage
        ? `data:${opts.startImage.mimeType};base64,${opts.startImage.base64}`
        : undefined;
    const output = await runReplicate(MODELS.KLING_V2_6, {
        prompt,
        negative_prompt: opts?.negativePrompt || '',
        start_image: startImageUri,
        aspect_ratio: opts?.aspectRatio || '16:9',
        duration: opts?.duration || 5,
        generate_audio: opts?.generateAudio ?? true,
    });

    const rawUrl = pickBestImageUrl(output);
    const videoUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });

    let duration: number | undefined;
    try {
        duration = await getVideoDuration(videoUrl);
    } catch (e) {
        duration = 5;
    }

    recordUsage({
        provider: 'replicate',
        model: MODELS.KLING_V2_6,
        kind: 'video',
        units: duration || 5,
        unitLabel: 'second',
        note: 'Kling 2.6 video',
    });

    return {
        id: `kling-26-${Date.now()}`,
        name: `kling_26_${prompt.slice(0, 15)}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration,
    };
};

export const generateVideoWithKling = async (
    prompt: string,
    image: { base64: string; mimeType: string }
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

    recordUsage({
        provider: 'replicate',
        model: MODELS.KLING_V2_5_TURBO_PRO,
        kind: 'video',
        units: duration || 5,
        unitLabel: 'second',
        note: 'Kling Turbo video',
    });

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
    opts?: { mode?: 'std' | 'pro'; keepOriginalSound?: boolean; characterOrientation?: 'image' | 'video' }
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

    recordUsage({
        provider: 'replicate',
        model: MODELS.KLING_V2_6_MOTION_CONTROL,
        kind: 'video',
        units: duration || 5,
        unitLabel: 'second',
        note: 'Kling motion control',
    });

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
    opts?: { includeFace?: boolean; includeHands?: boolean; useOpenpose?: boolean }
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

    const item: MediaItem = {
        id: `openpose-${Date.now()}`,
        name: `openpose_${Date.now()}.png`,
        type: 'image',
        url: imageUrl,
        source: 'generated',
    };
    recordUsage({
        provider: 'replicate',
        model: MODELS.OPENPOSE,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'OpenPose',
    });
    return item;
};

export const generateVideoWithLtx = async (
    prompt: string,
    opts?: {
        image?: { base64: string; mimeType: string };
        duration?: 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20;
        resolution?: '1080p' | '2k' | '4k';
        generateAudio?: boolean;
    }
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

    recordUsage({
        provider: 'replicate',
        model: MODELS.LTX_2_FAST,
        kind: 'video',
        units: duration || 6,
        unitLabel: 'second',
        note: 'LTX video',
    });

    return {
        id: `ltx-${Date.now()}`,
        name: `ltx_video_${prompt.slice(0, 15)}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration,
    };
};

export const generateVideoWithLtx23Fast = async (
    prompt: string,
    opts?: {
        image?: { base64: string; mimeType: string };
        lastFrameImage?: { base64: string; mimeType: string };
        aspectRatio?: '16:9' | '9:16';
        duration?: 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20;
        resolution?: '1080p' | '2k' | '4k';
        fps?: 24 | 25 | 48 | 50;
        loop?: boolean;
        seed?: number;
    }
): Promise<MediaItem> => {
    const imageUri = opts?.image ? `data:${opts.image.mimeType};base64,${opts.image.base64}` : undefined;
    const lastFrameUri = opts?.lastFrameImage ? `data:${opts.lastFrameImage.mimeType};base64,${opts.lastFrameImage.base64}` : undefined;
    const output = await runReplicate(MODELS.LTX_2_3_FAST, {
        prompt,
        image: imageUri,
        last_frame_image: lastFrameUri,
        aspect_ratio: opts?.aspectRatio || '16:9',
        duration: opts?.duration || 6,
        resolution: opts?.resolution || '1080p',
        fps: opts?.fps || 24,
        loop: opts?.loop ?? false,
        seed: opts?.seed,
    });

    const rawUrl = pickBestImageUrl(output);
    const videoUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });

    let duration: number | undefined;
    try {
        duration = await getVideoDuration(videoUrl);
    } catch {
        duration = opts?.duration || 6;
    }

    recordUsage({
        provider: 'replicate',
        model: MODELS.LTX_2_3_FAST,
        kind: 'video',
        units: duration || opts?.duration || 6,
        unitLabel: 'second',
        note: 'LTX 2.3 Fast video',
    });

    return {
        id: `ltx23-fast-${Date.now()}`,
        name: `ltx23_fast_${prompt.slice(0, 18)}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration,
    };
};

export const generateVideoWithLtx23Pro = async (
    prompt: string,
    opts?: {
        image?: { base64: string; mimeType: string };
        lastFrameImage?: { base64: string; mimeType: string };
        audio?: { base64: string; mimeType: string };
        task?: 'text_to_video' | 'image_to_video' | 'audio_to_video';
        aspectRatio?: '16:9' | '9:16';
        duration?: 6 | 8 | 10;
        resolution?: '1080p' | '2k' | '4k';
        fps?: 24 | 25 | 48 | 50;
        cameraMotion?: 'none' | 'low' | 'medium' | 'high';
        generateAudio?: boolean;
        seed?: number;
    }
): Promise<MediaItem> => {
    const imageUri = opts?.image ? `data:${opts.image.mimeType};base64,${opts.image.base64}` : undefined;
    const lastFrameUri = opts?.lastFrameImage ? `data:${opts.lastFrameImage.mimeType};base64,${opts.lastFrameImage.base64}` : undefined;
    const audioUri = opts?.audio ? `data:${opts.audio.mimeType};base64,${opts.audio.base64}` : undefined;
    const task = opts?.task || (audioUri ? 'audio_to_video' : imageUri ? 'image_to_video' : 'text_to_video');
    if (task === 'audio_to_video' && !audioUri) {
        throw new Error('LTX 2.3 Pro audio-to-video requires an audio track.');
    }
    if (lastFrameUri && !imageUri) {
        throw new Error('LTX 2.3 Pro end-frame guidance requires a start frame.');
    }

    const input: Record<string, any> = {
        task,
        prompt,
        image: imageUri,
        last_frame_image: lastFrameUri,
        audio: audioUri,
        aspect_ratio: opts?.aspectRatio || '16:9',
        duration: opts?.duration || 6,
        resolution: opts?.resolution || '1080p',
        fps: opts?.fps || 24,
        camera_motion: opts?.cameraMotion || 'medium',
        generate_audio: opts?.generateAudio ?? true,
        seed: opts?.seed,
    };

    const output = await runReplicate(MODELS.LTX_2_3_PRO, input);
    const rawUrl = pickBestImageUrl(output);
    const videoUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });

    let duration: number | undefined;
    try {
        duration = await getVideoDuration(videoUrl);
    } catch {
        duration = opts?.duration || 6;
    }

    recordUsage({
        provider: 'replicate',
        model: MODELS.LTX_2_3_PRO,
        kind: 'video',
        units: duration || opts?.duration || 6,
        unitLabel: 'second',
        note: `LTX 2.3 Pro ${task}`,
    });

    return {
        id: `ltx23-pro-${Date.now()}`,
        name: `ltx23_pro_${prompt.slice(0, 18)}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration,
    };
};

export const generateVideoWithLtxAudioToVideo = async (
    audio: { base64: string; mimeType: string },
    opts?: {
        prompt?: string;
        image?: { base64: string; mimeType: string };
        duration?: 6 | 8 | 10;
        resolution?: '720p' | '1080p' | '1440p' | '2160p';
        seed?: number;
    }
): Promise<MediaItem> => {
    const imageUri = opts?.image ? `data:${opts.image.mimeType};base64,${opts.image.base64}` : undefined;
    const audioUri = `data:${audio.mimeType};base64,${audio.base64}`;
    const input: Record<string, any> = {
        audio: audioUri,
        image: imageUri,
        prompt: opts?.prompt?.trim() || undefined,
        duration: opts?.duration || 6,
        resolution: opts?.resolution || '1080p',
        seed: opts?.seed,
    };
    const output = await runReplicate(MODELS.LTX_AUDIO_TO_VIDEO, input);
    const rawUrl = pickBestImageUrl(output);
    const videoUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });

    let duration: number | undefined;
    try {
        duration = await getVideoDuration(videoUrl);
    } catch {
        duration = opts?.duration || 6;
    }

    recordUsage({
        provider: 'replicate',
        model: MODELS.LTX_AUDIO_TO_VIDEO,
        kind: 'video',
        units: duration || opts?.duration || 6,
        unitLabel: 'second',
        note: 'LTX audio-to-video',
    });

    return {
        id: `ltx-audio-${Date.now()}`,
        name: `ltx_audio_${Date.now()}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration,
    };
};

export const generateVideoWithPVideo = async (
    prompt: string,
    opts?: {
        image?: { base64: string; mimeType: string };
        audio?: { base64: string; mimeType: string };
        duration?: number;
        aspectRatio?: '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3' | '1:1';
        resolution?: '720p' | '1080p';
        fps?: 24 | 48;
        draftMode?: boolean;
        promptUpsampling?: boolean;
        seed?: number;
    }
): Promise<MediaItem> => {
    const imageUri = opts?.image ? `data:${opts.image.mimeType};base64,${opts.image.base64}` : undefined;
    const audioUri = opts?.audio ? `data:${opts.audio.mimeType};base64,${opts.audio.base64}` : undefined;
    const safeDuration = Number.isFinite(opts?.duration) ? Math.max(1, Math.min(10, Math.round(Number(opts?.duration)))) : 5;
    const input: Record<string, any> = {
        prompt,
        image: imageUri,
        audio: audioUri,
        duration: audioUri ? undefined : safeDuration,
        aspect_ratio: opts?.aspectRatio || '16:9',
        resolution: opts?.resolution || '720p',
        fps: opts?.fps || 24,
        draft_mode: opts?.draftMode ?? false,
        prompt_upsampling: opts?.promptUpsampling ?? true,
        seed: opts?.seed,
    };
    const output = await runReplicate(MODELS.P_VIDEO, input);
    const rawUrl = pickBestImageUrl(output);
    const videoUrl = await ensureDisplayableFileUrl(rawUrl, { forceDownload: true });

    let duration: number | undefined;
    try {
        duration = await getVideoDuration(videoUrl);
    } catch {
        duration = audioUri ? undefined : safeDuration;
    }

    recordUsage({
        provider: 'replicate',
        model: MODELS.P_VIDEO,
        kind: 'video',
        units: duration || safeDuration,
        unitLabel: 'second',
        note: opts?.draftMode ? 'P-Video draft' : 'P-Video',
    });

    return {
        id: `p-video-${Date.now()}`,
        name: `p_video_${prompt.slice(0, 18)}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration,
    };
};

const FAST_FLUX_TRAINER_MODEL = 'replicate/fast-flux-trainer';
const FAST_FLUX_TRAINER_VERSION = '8b10720c9270af0fce9f3afef0f04077bd7865f2f86608f0f6a0b17f97c8f83f';

export type ReplicateLoraTraining = {
    id: string;
    status?: string;
    destination?: string;
    error?: string;
    output?: any;
    logs?: string;
};

const mapReplicateTraining = (payload: any): ReplicateLoraTraining => ({
    id: payload?.id || '',
    status: payload?.status,
    destination: payload?.destination,
    error: payload?.error,
    output: payload?.output,
    logs: payload?.logs,
});

const requestReplicateTraining = async (
    url: string,
    method: 'GET' | 'POST',
    body?: Record<string, any>
) => {
    const token = getReplicateKeyOptional();
    if (!token && shouldUseByokProxy('replicate')) {
        return byokProxyJson<any>({
            provider: 'replicate',
            url,
            method,
            body,
            usage: {
                kind: 'other',
                model: method === 'POST' ? `${FAST_FLUX_TRAINER_MODEL}/train` : `${FAST_FLUX_TRAINER_MODEL}/status`,
                units: 1,
            },
            meta: {
                billable: method === 'POST',
                note: method === 'POST' ? 'Replicate LoRA training start' : 'Replicate LoRA training status',
            },
        });
    }
    if (!token) {
        throw new Error("Replicate API Token is missing. Please add it in settings.");
    }
    const response = await fetch(proxyUrl(url), {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Replicate training request failed (${response.status}): ${errorText || response.statusText}`);
    }
    return response.json();
};

export const startFastFluxLoraTraining = async (opts: {
    destination: string;
    inputImagesUrl: string;
    triggerWord: string;
    loraType?: 'subject' | 'style';
}): Promise<ReplicateLoraTraining> => {
    const destination = (opts.destination || '').trim();
    const inputImagesUrl = (opts.inputImagesUrl || '').trim();
    const triggerWord = (opts.triggerWord || '').trim();
    if (!destination) throw new Error('LoRA destination is required (e.g. yourname/my-flux-lora).');
    if (!inputImagesUrl) throw new Error('Input ZIP URL is required.');
    if (!triggerWord) throw new Error('Trigger word is required.');

    const url = `https://api.replicate.com/v1/models/${FAST_FLUX_TRAINER_MODEL}/versions/${FAST_FLUX_TRAINER_VERSION}/trainings`;
    const payload = await requestReplicateTraining(url, 'POST', {
        destination,
        input: {
            input_images: inputImagesUrl,
            trigger_word: triggerWord,
            lora_type: opts.loraType || 'subject',
        },
    });
    return mapReplicateTraining(payload);
};

export const getReplicateTraining = async (trainingId: string): Promise<ReplicateLoraTraining> => {
    const id = (trainingId || '').trim();
    if (!id) throw new Error('Training ID is required.');
    const url = `https://api.replicate.com/v1/trainings/${id}`;
    const payload = await requestReplicateTraining(url, 'GET');
    return mapReplicateTraining(payload);
};
