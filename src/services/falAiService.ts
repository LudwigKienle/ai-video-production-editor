import { MediaItem } from '../types';
import { getVideoDuration } from '../utils/helpers';
import { recordUsage } from '../utils/usageTracker';
import { byokProxyJson, shouldUseByokProxy } from './byokProxyClient';

const MODELS = {
    GROK_IMAGINE_IMAGE_T2I: 'xai/grok-imagine-image',
    QWEN_IMAGE_MAX_T2I: 'fal-ai/qwen-image-max/text-to-image',
    QWEN_IMAGE_MAX_EDIT: 'fal-ai/qwen-image-max/edit',
    GPT_IMAGE_2_T2I: 'openai/gpt-image-2',
    GPT_IMAGE_2_EDIT: 'openai/gpt-image-2/edit',
    NANO_BANANA_2_T2I: 'fal-ai/nano-banana-2',
    NANO_BANANA_2_EDIT: 'fal-ai/nano-banana-2/edit',
    SEEDREAM_V5_LITE_T2I: 'fal-ai/bytedance/seedream/v5/lite/text-to-image',
    WAN_V27_PRO_T2I: 'fal-ai/wan/v2.7/pro/text-to-image',
    WAN_V27_PRO_EDIT: 'fal-ai/wan/v2.7/pro/edit',
    WAN_V27_T2V: 'fal-ai/wan/v2.7/text-to-video',
    WAN_V27_I2V: 'fal-ai/wan/v2.7/image-to-video',
    HAPPY_HORSE_T2V: 'alibaba/happy-horse/text-to-video',
    HAPPY_HORSE_I2V: 'alibaba/happy-horse/image-to-video',
    GROK_IMAGINE_IMAGE_EDIT: 'xai/grok-imagine-image/edit',
    LUMA_RAY_2_REFRAME: 'fal-ai/luma-dream-machine/ray-2/reframe',
    KLING_O3_PRO_I2V: 'fal-ai/kling-video/o3/pro/image-to-video',
    KLING_O3_PRO_REFERENCE_V2V: 'fal-ai/kling-video/o3/pro/reference-to-video',
    KLING_V3_PRO_I2V: 'fal-ai/kling-video/v3/pro/image-to-video',
    KLING_V3_PRO_T2V: 'fal-ai/kling-video/v3/pro/text-to-video',
    SEEDANCE_2_I2V: 'bytedance/seedance-2.0/image-to-video',
    SEEDANCE_2_REFERENCE: 'bytedance/seedance-2.0/reference-to-video',
    PIXVERSE_C1_REFERENCE_TO_VIDEO: 'fal-ai/pixverse/c1/reference-to-video',
    CREATIFY_AURORA: 'fal-ai/creatify/aurora',
    GROK_IMAGINE_I2V: 'xai/grok-imagine-video/image-to-video',
};

const getFalKeyOptional = () => {
    return localStorage.getItem('fal_api_key');
};

const proxyFalUrl = (url: string) => {
    const isElectron = navigator.userAgent.toLowerCase().includes(' electron/');
    return isElectron ? url : `https://corsproxy.io/?${encodeURIComponent(url)}`;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toDataUri = (image: { base64: string; mimeType: string }) => {
    return image.base64.startsWith('data:')
        ? image.base64
        : `data:${image.mimeType};base64,${image.base64}`;
};

type FalKlingMultiPrompt = {
    prompt: string;
    duration?: number;
};

type FalKlingElement = {
    type?: 'image' | 'video' | 'text';
    prompt?: string;
    image?: { base64: string; mimeType: string };
    video?: { base64: string; mimeType: string };
    imageUrls?: Array<{ base64: string; mimeType: string }>;
    weight?: number;
};

const toFalMultiPrompt = (multiPrompt?: FalKlingMultiPrompt[]) => {
    if (!Array.isArray(multiPrompt) || multiPrompt.length === 0) return undefined;
    const mapped = multiPrompt
        .map((entry) => ({
            prompt: String(entry?.prompt || '').trim(),
            duration: Number(entry?.duration) > 0 ? Number(entry.duration) : undefined,
        }))
        .filter((entry) => !!entry.prompt);
    return mapped.length > 0 ? mapped : undefined;
};

const toFalElements = (elements?: FalKlingElement[]) => {
    if (!Array.isArray(elements) || elements.length === 0) return undefined;
    const mapped = elements
        .map((element) => {
            const prompt = typeof element?.prompt === 'string' ? element.prompt.trim() : '';
            const type = element?.type || (element?.video ? 'video' : element?.image ? 'image' : prompt ? 'text' : undefined);
            const payload: Record<string, any> = {};
            if (type) payload.type = type;
            if (prompt) payload.prompt = prompt;
            if (element?.image) payload.image_url = toDataUri(element.image);
            if (element?.video) payload.video_url = toDataUri(element.video);
            if (Array.isArray(element?.imageUrls) && element.imageUrls.length > 0) {
                payload.image_urls = element.imageUrls.map((img) => toDataUri(img));
            }
            if (typeof element?.weight === 'number' && Number.isFinite(element.weight)) {
                payload.weight = element.weight;
            }
            return payload;
        })
        .filter((payload) => Object.keys(payload).length > 0);
    return mapped.length > 0 ? mapped : undefined;
};

const normalizeVoiceIds = (voiceIds?: string[]) => {
    if (!Array.isArray(voiceIds)) return undefined;
    const ids = voiceIds.map((id) => String(id || '').trim()).filter(Boolean);
    return ids.length > 0 ? ids : undefined;
};

const clampDurationSeconds = (value: number | undefined, fallback = 5) => {
    return clampDurationRange(value, fallback, 3, 15);
};

const clampDurationRange = (value: number | undefined, fallback: number, min: number, max: number) => {
    if (!Number.isFinite(value)) return fallback;
    const rounded = Math.round(value as number);
    return Math.min(max, Math.max(min, rounded));
};

const collectFalImageUrls = (payload: any): string[] => {
    if (!payload) return [];
    if (typeof payload === 'string') return [payload];
    if (Array.isArray(payload)) return payload.flatMap(collectFalImageUrls);

    if (typeof payload === 'object') {
        if (typeof payload.url === 'string') return [payload.url];
        if (typeof payload.image_url === 'string') return [payload.image_url];
        if (typeof payload.image === 'string') return [payload.image];
        if (Array.isArray(payload.images)) return collectFalImageUrls(payload.images);
        if (Array.isArray(payload.output)) return collectFalImageUrls(payload.output);
        if (Array.isArray(payload.result)) return collectFalImageUrls(payload.result);
        if (payload.data) return collectFalImageUrls(payload.data);
    }

    return [];
};

const collectFalVideoUrls = (payload: any): string[] => {
    if (!payload) return [];
    if (typeof payload === 'string') return [payload];
    if (Array.isArray(payload)) return payload.flatMap(collectFalVideoUrls);

    if (typeof payload === 'object') {
        if (payload.video && typeof payload.video.url === 'string') return [payload.video.url];
        if (typeof payload.url === 'string' && typeof payload.content_type === 'string' && payload.content_type.startsWith('video/')) {
            return [payload.url];
        }
        if (Array.isArray(payload.videos)) return payload.videos.flatMap(collectFalVideoUrls);
        if (Array.isArray(payload.output)) return collectFalVideoUrls(payload.output);
        if (Array.isArray(payload.result)) return collectFalVideoUrls(payload.result);
        if (payload.data) return collectFalVideoUrls(payload.data);
    }

    return [];
};

const inferFalKind = (model: string): 'video' | 'edit' | 'image' => {
    const normalized = (model || '').toLowerCase();
    if (
        normalized.includes('video')
        || normalized.includes('kling')
        || normalized.includes('aurora')
        || normalized.includes('reframe')
        || normalized.includes('luma')
        || normalized.includes('ray-2')
    ) {
        return 'video';
    }
    if (normalized.includes('edit') || normalized.includes('multi-angle') || normalized.includes('multiangle')) {
        return 'edit';
    }
    return 'image';
};

const toOptionalInteger = (value: number | undefined) => {
    if (!Number.isFinite(value)) return undefined;
    return Math.round(value as number);
};

const runFal = async (model: string, input: Record<string, any>) => {
    const token = getFalKeyOptional();
    const url = `https://fal.run/${model}`;
    if (!token && shouldUseByokProxy('fal')) {
        return byokProxyJson<any>({
            provider: 'fal',
            url,
            method: 'POST',
            body: input,
            usage: {
                kind: inferFalKind(model),
                model,
                units: 1,
            },
            meta: {
                billable: true,
                note: `FAL request ${model}`,
            },
        });
    }
    if (!token) {
        throw new Error('FAL API key is missing. Add it in Settings.');
    }

    const response = await fetch(proxyFalUrl(url), {
        method: 'POST',
        headers: {
            'Authorization': `Key ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`FAL API Error (${response.status}): ${errorText || response.statusText}`);
    }

    return response.json();
};

type FalQueueStatus = {
    request_id?: string;
    status?: string;
    response_url?: string;
    status_url?: string;
    error?: string;
};

const runFalQueue = async (
    model: string,
    input: Record<string, any>,
    opts?: { pollIntervalMs?: number; maxChecks?: number }
) => {
    const token = getFalKeyOptional();
    const url = `https://queue.fal.run/${model}`;
    const start = token
        ? (await (async () => {
            const response = await fetch(proxyFalUrl(url), {
                method: 'POST',
                headers: {
                    'Authorization': `Key ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(input),
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                throw new Error(`FAL Queue Error (${response.status}): ${errorText || response.statusText}`);
            }
            return response.json().catch(() => ({}));
        })()) as FalQueueStatus
        : shouldUseByokProxy('fal')
            ? await byokProxyJson<FalQueueStatus>({
                provider: 'fal',
                url,
                method: 'POST',
                body: input,
                usage: {
                    kind: inferFalKind(model),
                    model,
                    units: 1,
                },
                meta: {
                    billable: true,
                    note: `FAL queue request ${model}`,
                },
            })
            : (() => { throw new Error('FAL API key is missing. Add it in Settings.'); })();

    const requestId = start.request_id;
    if (!requestId) {
        throw new Error('FAL Queue did not return a request_id.');
    }

    let status = (start.status || '').toUpperCase();
    let responseUrl = start.response_url;
    let statusUrl = start.status_url || `https://queue.fal.run/${model}/requests/${requestId}/status`;

    const pollIntervalMs = opts?.pollIntervalMs ?? 5000;
    const maxChecks = opts?.maxChecks ?? 120;

    let checks = 0;
    while (checks < maxChecks) {
        if (status === 'COMPLETED') {
            break;
        }
        if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELED') {
            throw new Error(`FAL Queue failed (${status}).`);
        }
        checks += 1;
        await sleep(pollIntervalMs);

        const statusBody = token
            ? (await (async () => {
                const statusResponse = await fetch(proxyFalUrl(statusUrl), {
                    headers: {
                        'Authorization': `Key ${token}`,
                    },
                });
                if (!statusResponse.ok) {
                    const errorText = await statusResponse.text().catch(() => '');
                    throw new Error(`FAL Queue status error (${statusResponse.status}): ${errorText || statusResponse.statusText}`);
                }
                return statusResponse.json().catch(() => ({}));
            })()) as FalQueueStatus
            : await byokProxyJson<FalQueueStatus>({
                provider: 'fal',
                url: statusUrl,
                method: 'GET',
                usage: {
                    kind: 'other',
                    model: `${model}/status`,
                    units: 1,
                },
                meta: {
                    billable: false,
                    note: `FAL queue status ${model}`,
                },
            });

        status = (statusBody.status || status).toUpperCase();
        if (statusBody.response_url) {
            responseUrl = statusBody.response_url;
        }
        if (statusBody.status_url) {
            statusUrl = statusBody.status_url;
        }
        if (statusBody.error) {
            throw new Error(`FAL Queue error: ${statusBody.error}`);
        }
    }

    if (status !== 'COMPLETED') {
        throw new Error('FAL Queue timed out before completion.');
    }

    const resultUrl = responseUrl || `https://queue.fal.run/${model}/requests/${requestId}`;
    if (!token) {
        return byokProxyJson<any>({
            provider: 'fal',
            url: resultUrl,
            method: 'GET',
            usage: {
                kind: 'other',
                model: `${model}/result`,
                units: 1,
            },
            meta: {
                billable: false,
                note: `FAL queue result ${model}`,
            },
        });
    }

    const resultResponse = await fetch(proxyFalUrl(resultUrl), {
        headers: {
            'Authorization': `Key ${token}`,
        },
    });

    if (!resultResponse.ok) {
        const errorText = await resultResponse.text().catch(() => '');
        throw new Error(`FAL Queue result error (${resultResponse.status}): ${errorText || resultResponse.statusText}`);
    }

    return resultResponse.json();
};

export const editImageWithFalQwenMultiAngle = async (
    prompt: string,
    image: { base64: string; mimeType: string } | Array<{ base64: string; mimeType: string }>,
    opts?: { numOutputs?: number }
): Promise<MediaItem[]> => {
    const images = Array.isArray(image) ? image : [image];
    const imageUrls = images
        .filter((item) => !!item?.base64)
        .map((item) => toDataUri(item));
    if (imageUrls.length === 0) {
        throw new Error('FAL Qwen Image Max Edit requires at least one reference image.');
    }

    const input: Record<string, any> = {
        prompt,
        image_urls: imageUrls,
    };
    if (opts?.numOutputs) {
        input.num_images = opts.numOutputs;
    }

    const output = await runFalQueue(MODELS.QWEN_IMAGE_MAX_EDIT, input);
    const urls = Array.from(new Set(collectFalImageUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL Qwen Image Max Edit returned no images.');
    }

    recordUsage({
        provider: 'fal',
        model: MODELS.QWEN_IMAGE_MAX_EDIT,
        kind: 'edit',
        units: 1,
        unitLabel: 'request',
        note: 'FAL Qwen Image Max edit',
    });

    return urls.map((url, index) => ({
        id: `fal-qwen-max-${Date.now()}-${index}`,
        name: `fal_qwen_max_${prompt.slice(0, 10)}_${index + 1}.png`,
        type: 'image',
        url,
        source: 'generated',
    }));
};

export const editImageWithFalGptImage2 = async (
    prompt: string,
    image: { base64: string; mimeType: string } | Array<{ base64: string; mimeType: string }>,
    opts?: {
        aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
        numOutputs?: number;
        quality?: 'low' | 'medium' | 'high';
        outputFormat?: 'jpeg' | 'png' | 'webp';
    }
): Promise<MediaItem[]> => {
    const images = Array.isArray(image) ? image : [image];
    const imageUrls = images
        .filter((item) => !!item?.base64)
        .map((item) => toDataUri(item));
    if (imageUrls.length === 0) {
        throw new Error('FAL GPT Image 2 Edit requires at least one reference image.');
    }

    const input: Record<string, any> = {
        prompt,
        image_urls: imageUrls,
        quality: opts?.quality || 'high',
        output_format: opts?.outputFormat || 'png',
    };
    if (opts?.aspectRatio) {
        input.image_size = mapQwenMaxImageSize(opts.aspectRatio);
    }
    if (opts?.numOutputs) {
        input.num_images = opts.numOutputs;
    }

    const output = await runFalQueue(MODELS.GPT_IMAGE_2_EDIT, input);
    const urls = Array.from(new Set(collectFalImageUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL GPT Image 2 Edit returned no images.');
    }

    recordUsage({
        provider: 'fal',
        model: MODELS.GPT_IMAGE_2_EDIT,
        kind: 'edit',
        units: 1,
        unitLabel: 'request',
        note: 'FAL GPT Image 2 edit',
    });

    return urls.map((url, index) => ({
        id: `fal-gpt-image-2-edit-${Date.now()}-${index}`,
        name: `fal_gpt_image_2_edit_${prompt.slice(0, 10)}_${index + 1}.png`,
        type: 'image',
        url,
        source: 'generated',
    }));
};

export const generateImageWithFalGptImage2 = async (
    prompt: string,
    opts?: {
        aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
        numOutputs?: number;
        quality?: 'low' | 'medium' | 'high';
        outputFormat?: 'jpeg' | 'png' | 'webp';
    }
): Promise<MediaItem> => {
    const input: Record<string, any> = {
        prompt,
        image_size: mapQwenMaxImageSize(opts?.aspectRatio),
        quality: opts?.quality || 'high',
        output_format: opts?.outputFormat || 'png',
    };
    if (opts?.numOutputs) {
        input.num_images = opts.numOutputs;
    }

    const output = await runFalQueue(MODELS.GPT_IMAGE_2_T2I, input);
    const urls = Array.from(new Set(collectFalImageUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL GPT Image 2 text-to-image returned no images.');
    }

    recordUsage({
        provider: 'fal',
        model: MODELS.GPT_IMAGE_2_T2I,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'FAL GPT Image 2 text-to-image',
    });

    return {
        id: `fal-gpt-image-2-t2i-${Date.now()}`,
        name: `fal_gpt_image_2_t2i_${prompt.slice(0, 16) || 'image'}.png`,
        type: 'image',
        url: urls[0],
        source: 'generated',
    };
};

const mapQwenMaxImageSize = (aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4') => {
    switch (aspectRatio) {
        case '16:9':
            return 'landscape_16_9';
        case '9:16':
            return 'portrait_16_9';
        case '4:3':
            return 'landscape_4_3';
        case '3:4':
            return 'portrait_4_3';
        case '1:1':
        default:
            return 'square_hd';
    }
};

const mapSeedreamV5LiteImageSize = (aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4') => {
    switch (aspectRatio) {
        case '16:9':
            return 'landscape_16_9';
        case '9:16':
            return 'portrait_16_9';
        case '4:3':
            return 'landscape_4_3';
        case '3:4':
            return 'portrait_4_3';
        case '1:1':
        default:
            return 'square_hd';
    }
};

type FalWanImageAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
type FalWanVideoAspectRatio = FalWanImageAspectRatio;
type FalWanVideoResolution = '720p' | '1080p';
type FalHappyHorseAspectRatio = FalWanImageAspectRatio;
type FalHappyHorseResolution = '720p' | '1080p';
type FalSeedanceVideoAspectRatio = 'auto' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
type FalSeedanceVideoResolution = '480p' | '720p';
type FalPixverseAspectRatio = '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '2:3' | '3:2' | '21:9';
type FalPixverseResolution = '360p' | '540p' | '720p' | '1080p';
type FalPixverseReferenceType = 'subject' | 'background';

const normalizeFalSeedanceDuration = (value: number | 'auto' | undefined): 'auto' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12' | '13' | '14' | '15' => {
    if (value === 'auto') return 'auto';
    const normalized = clampDurationRange(typeof value === 'number' ? value : undefined, 10, 4, 15);
    return String(normalized) as '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12' | '13' | '14' | '15';
};

const mapWanV27ImageSize = (aspectRatio?: FalWanImageAspectRatio) => {
    switch (aspectRatio) {
        case '16:9':
            return 'landscape_16_9';
        case '9:16':
            return 'portrait_16_9';
        case '4:3':
            return 'landscape_4_3';
        case '3:4':
            return 'portrait_4_3';
        case '1:1':
        default:
            return 'square_hd';
    }
};

type FalNanoBananaAspectRatio =
    | '21:9'
    | '16:9'
    | '3:2'
    | '4:3'
    | '5:4'
    | '1:1'
    | '4:5'
    | '3:4'
    | '2:3'
    | '9:16'
    | 'auto';

type FalNanoBananaResolution = '0.5K' | '1K' | '2K' | '4K';

const normalizeFalNanoBananaAspectRatio = (aspectRatio?: string): FalNanoBananaAspectRatio => {
    const allowed = new Set<FalNanoBananaAspectRatio>([
        '21:9',
        '16:9',
        '3:2',
        '4:3',
        '5:4',
        '1:1',
        '4:5',
        '3:4',
        '2:3',
        '9:16',
        'auto',
    ]);
    const value = String(aspectRatio || '').trim() as FalNanoBananaAspectRatio;
    return allowed.has(value) ? value : 'auto';
};

const normalizeFalNanoBananaResolution = (resolution?: string): FalNanoBananaResolution => {
    switch (resolution) {
        case '0.5K':
        case '2K':
        case '4K':
            return resolution;
        default:
            return '1K';
    }
};

export const generateImageWithFalNanoBanana2 = async (
    prompt: string,
    opts?: {
        aspectRatio?: FalNanoBananaAspectRatio;
        resolution?: FalNanoBananaResolution;
        numOutputs?: number;
        enableWebSearch?: boolean;
    }
): Promise<MediaItem> => {
    const input: Record<string, any> = {
        prompt,
        aspect_ratio: normalizeFalNanoBananaAspectRatio(opts?.aspectRatio),
        resolution: normalizeFalNanoBananaResolution(opts?.resolution),
    };
    if (opts?.numOutputs) {
        input.num_images = opts.numOutputs;
    }
    if (typeof opts?.enableWebSearch === 'boolean') {
        input.enable_web_search = opts.enableWebSearch;
    }

    const output = await runFal(MODELS.NANO_BANANA_2_T2I, input);
    const urls = Array.from(new Set(collectFalImageUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL Nano Banana 2 text-to-image returned no images.');
    }

    const url = urls[0];
    recordUsage({
        provider: 'fal',
        model: MODELS.NANO_BANANA_2_T2I,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'FAL Nano Banana 2 text-to-image',
    });

    return {
        id: `fal-nano-banana-2-t2i-${Date.now()}`,
        name: `fal_nano_banana_2_${prompt.slice(0, 16) || 'image'}.png`,
        type: 'image',
        url,
        source: 'generated',
    };
};

export const editImageWithFalNanoBanana2 = async (
    prompt: string,
    image: { base64: string; mimeType: string } | Array<{ base64: string; mimeType: string }>,
    opts?: {
        aspectRatio?: FalNanoBananaAspectRatio;
        resolution?: FalNanoBananaResolution;
        numOutputs?: number;
        enableWebSearch?: boolean;
    }
): Promise<MediaItem[]> => {
    const images = Array.isArray(image) ? image : [image];
    const imageUrls = images
        .filter((item) => !!item?.base64)
        .map((item) => toDataUri(item));
    if (imageUrls.length === 0) {
        throw new Error('FAL Nano Banana 2 Edit requires at least one reference image.');
    }

    const input: Record<string, any> = {
        prompt,
        image_urls: imageUrls,
        aspect_ratio: normalizeFalNanoBananaAspectRatio(opts?.aspectRatio),
        resolution: normalizeFalNanoBananaResolution(opts?.resolution),
    };
    if (opts?.numOutputs) {
        input.num_images = opts.numOutputs;
    }
    if (typeof opts?.enableWebSearch === 'boolean') {
        input.enable_web_search = opts.enableWebSearch;
    }

    const output = await runFal(MODELS.NANO_BANANA_2_EDIT, input);
    const urls = Array.from(new Set(collectFalImageUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL Nano Banana 2 Edit returned no images.');
    }

    recordUsage({
        provider: 'fal',
        model: MODELS.NANO_BANANA_2_EDIT,
        kind: 'edit',
        units: 1,
        unitLabel: 'request',
        note: 'FAL Nano Banana 2 edit',
    });

    return urls.map((url, index) => ({
        id: `fal-nano-banana-2-edit-${Date.now()}-${index}`,
        name: `fal_nano_banana_2_edit_${prompt.slice(0, 10)}_${index + 1}.png`,
        type: 'image',
        url,
        source: 'generated',
    }));
};

export const generateImageWithFalQwenImageMax = async (
    prompt: string,
    opts?: { aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4'; numOutputs?: number }
): Promise<MediaItem> => {
    const input: Record<string, any> = {
        prompt,
        image_size: mapQwenMaxImageSize(opts?.aspectRatio),
    };
    if (opts?.numOutputs) {
        input.num_images = opts.numOutputs;
    }

    const output = await runFal(MODELS.QWEN_IMAGE_MAX_T2I, input);
    const urls = Array.from(new Set(collectFalImageUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL Qwen Image Max text-to-image returned no images.');
    }

    const url = urls[0];
    recordUsage({
        provider: 'fal',
        model: MODELS.QWEN_IMAGE_MAX_T2I,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'FAL Qwen Image Max text-to-image',
    });

    return {
        id: `fal-qwen-max-t2i-${Date.now()}`,
        name: `fal_qwen_max_t2i_${prompt.slice(0, 16) || 'image'}.png`,
        type: 'image',
        url,
        source: 'generated',
    };
};

export const generateImageWithFalSeedreamV5Lite = async (
    prompt: string,
    opts?: { aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4'; numOutputs?: number }
): Promise<MediaItem> => {
    const input: Record<string, any> = {
        prompt,
        image_size: mapSeedreamV5LiteImageSize(opts?.aspectRatio),
    };
    if (opts?.numOutputs) {
        input.num_images = opts.numOutputs;
    }

    const output = await runFal(MODELS.SEEDREAM_V5_LITE_T2I, input);
    const urls = Array.from(new Set(collectFalImageUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL Seedream v5 Lite text-to-image returned no images.');
    }

    const url = urls[0];
    recordUsage({
        provider: 'fal',
        model: MODELS.SEEDREAM_V5_LITE_T2I,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'FAL Seedream v5 Lite text-to-image',
    });

    return {
        id: `fal-seedream-v5-lite-t2i-${Date.now()}`,
        name: `fal_seedream_v5_lite_t2i_${prompt.slice(0, 16) || 'image'}.png`,
        type: 'image',
        url,
        source: 'generated',
    };
};

export const generateImageWithFalWanV27Pro = async (
    prompt: string,
    opts?: {
        aspectRatio?: FalWanImageAspectRatio;
        numOutputs?: number;
        negativePrompt?: string;
        enablePromptExpansion?: boolean;
    }
): Promise<MediaItem> => {
    const input: Record<string, any> = {
        prompt,
        image_size: mapWanV27ImageSize(opts?.aspectRatio),
    };
    if (opts?.numOutputs) {
        input.num_images = opts.numOutputs;
    }
    if (opts?.negativePrompt) {
        input.negative_prompt = opts.negativePrompt;
    }
    if (typeof opts?.enablePromptExpansion === 'boolean') {
        input.enable_prompt_expansion = opts.enablePromptExpansion;
    }

    const output = await runFalQueue(MODELS.WAN_V27_PRO_T2I, input, {
        pollIntervalMs: 4000,
        maxChecks: 180,
    });
    const urls = Array.from(new Set(collectFalImageUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL WAN 2.7 Pro text-to-image returned no images.');
    }

    const url = urls[0];
    recordUsage({
        provider: 'fal',
        model: MODELS.WAN_V27_PRO_T2I,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'FAL WAN 2.7 Pro text-to-image',
    });

    return {
        id: `fal-wan-v27-pro-t2i-${Date.now()}`,
        name: `fal_wan_v27_pro_${prompt.slice(0, 16) || 'image'}.png`,
        type: 'image',
        url,
        source: 'generated',
    };
};

export const editImageWithFalWanV27Pro = async (
    prompt: string,
    image: { base64: string; mimeType: string } | Array<{ base64: string; mimeType: string }>,
    opts?: {
        aspectRatio?: FalWanImageAspectRatio;
        numOutputs?: number;
        negativePrompt?: string;
        enablePromptExpansion?: boolean;
    }
): Promise<MediaItem[]> => {
    const images = Array.isArray(image) ? image : [image];
    const imageUrls = images
        .filter((item) => !!item?.base64)
        .map((item) => toDataUri(item));
    if (imageUrls.length === 0) {
        throw new Error('FAL WAN 2.7 Pro Edit requires at least one reference image.');
    }

    const input: Record<string, any> = {
        prompt,
        image_urls: imageUrls,
        image_size: mapWanV27ImageSize(opts?.aspectRatio),
    };
    if (opts?.numOutputs) {
        input.num_images = opts.numOutputs;
    }
    if (opts?.negativePrompt) {
        input.negative_prompt = opts.negativePrompt;
    }
    if (typeof opts?.enablePromptExpansion === 'boolean') {
        input.enable_prompt_expansion = opts.enablePromptExpansion;
    }

    const output = await runFalQueue(MODELS.WAN_V27_PRO_EDIT, input, {
        pollIntervalMs: 4000,
        maxChecks: 180,
    });
    const urls = Array.from(new Set(collectFalImageUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL WAN 2.7 Pro Edit returned no images.');
    }

    recordUsage({
        provider: 'fal',
        model: MODELS.WAN_V27_PRO_EDIT,
        kind: 'edit',
        units: 1,
        unitLabel: 'request',
        note: 'FAL WAN 2.7 Pro edit',
    });

    return urls.map((url, index) => ({
        id: `fal-wan-v27-pro-edit-${Date.now()}-${index}`,
        name: `fal_wan_v27_pro_edit_${prompt.slice(0, 10)}_${index + 1}.png`,
        type: 'image',
        url,
        source: 'generated',
    }));
};

export const generateImageWithFalGrokImagine = async (
    prompt: string,
    opts?: { aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '3:2' | '2:3' | 'auto' }
): Promise<MediaItem> => {
    const input: Record<string, any> = { prompt };
    if (opts?.aspectRatio) {
        input.aspect_ratio = opts.aspectRatio;
    }

    const output = await runFal(MODELS.GROK_IMAGINE_IMAGE_T2I, input);
    const urls = Array.from(new Set(collectFalImageUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL Grok Imagine text-to-image returned no images.');
    }

    const url = urls[0];
    recordUsage({
        provider: 'fal',
        model: MODELS.GROK_IMAGINE_IMAGE_T2I,
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'FAL Grok Imagine text-to-image',
    });

    return {
        id: `fal-grok-t2i-${Date.now()}`,
        name: `fal_grok_t2i_${prompt.slice(0, 16) || 'image'}.png`,
        type: 'image',
        url,
        source: 'generated',
    };
};

export const editImageWithFalGrokImagine = async (
    prompt: string,
    image: { base64: string; mimeType: string }
): Promise<MediaItem> => {
    const input: Record<string, any> = {
        prompt,
        image_url: toDataUri(image),
    };

    const output = await runFal(MODELS.GROK_IMAGINE_IMAGE_EDIT, input);
    const urls = Array.from(new Set(collectFalImageUrls(output)));
    if (urls.length === 0) {
        throw new Error('FAL Grok Imagine Image Edit returned no images.');
    }

    const url = urls[0];

    recordUsage({
        provider: 'fal',
        model: MODELS.GROK_IMAGINE_IMAGE_EDIT,
        kind: 'edit',
        units: 1,
        unitLabel: 'request',
        note: 'FAL Grok Imagine image edit',
    });

    return {
        id: `fal-grok-edit-${Date.now()}`,
        name: `fal_grok_edit_${prompt.slice(0, 16) || 'image'}.png`,
        type: 'image',
        url,
        source: 'generated',
    };
};

export type FalLumaRay2ReframeAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9' | '9:21';

export const generateVideoWithFalLumaRay2Reframe = async (
    video: { base64: string; mimeType: string },
    opts?: {
        aspectRatio?: FalLumaRay2ReframeAspectRatio;
        prompt?: string;
        image?: { base64: string; mimeType: string };
        gridPositionX?: number;
        gridPositionY?: number;
        xStart?: number;
        xEnd?: number;
        yStart?: number;
        yEnd?: number;
    }
): Promise<MediaItem> => {
    const input: Record<string, any> = {
        video_url: toDataUri(video),
        aspect_ratio: opts?.aspectRatio || '9:16',
    };
    const prompt = typeof opts?.prompt === 'string' ? opts.prompt.trim() : '';
    if (prompt) {
        input.prompt = prompt;
    }
    if (opts?.image) {
        input.image_url = toDataUri(opts.image);
    }

    const integerFields: Array<[string, number | undefined]> = [
        ['grid_position_x', opts?.gridPositionX],
        ['grid_position_y', opts?.gridPositionY],
        ['x_start', opts?.xStart],
        ['x_end', opts?.xEnd],
        ['y_start', opts?.yStart],
        ['y_end', opts?.yEnd],
    ];
    integerFields.forEach(([key, value]) => {
        const normalized = toOptionalInteger(value);
        if (normalized !== undefined) {
            input[key] = normalized;
        }
    });

    const output = await runFalQueue(MODELS.LUMA_RAY_2_REFRAME, input, {
        pollIntervalMs: 5000,
        maxChecks: 180,
    });
    const urls = Array.from(new Set(collectFalVideoUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL Luma Ray 2 Reframe returned no video.');
    }

    const videoUrl = urls[0];
    let resolvedDuration = 0;
    try {
        resolvedDuration = await getVideoDuration(videoUrl);
    } catch {
        resolvedDuration = 0;
    }

    recordUsage({
        provider: 'fal',
        model: MODELS.LUMA_RAY_2_REFRAME,
        kind: 'video',
        units: resolvedDuration || 0,
        unitLabel: 'second',
        note: 'FAL Luma Ray 2 Reframe video',
    });

    return {
        id: `fal-luma-reframe-${Date.now()}`,
        name: `fal_luma_reframe_${Date.now()}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration: resolvedDuration || undefined,
    };
};

export const generateVideoWithFalKlingO3 = async (
    prompt: string,
    image: { base64: string; mimeType: string },
    opts?: {
        endImage?: { base64: string; mimeType: string };
        duration?: number;
        generateAudio?: boolean;
        aspectRatio?: '16:9' | '9:16' | '1:1';
        multiPrompt?: FalKlingMultiPrompt[];
        shotType?: 'static' | 'dynamic';
        referenceImages?: Array<{ base64: string; mimeType: string }>;
        elements?: FalKlingElement[];
        referenceVideo?: { base64: string; mimeType: string };
    }
): Promise<MediaItem> => {
    const duration = clampDurationSeconds(opts?.duration, 5);
    const multiPrompt = toFalMultiPrompt(opts?.multiPrompt);
    const elements = toFalElements(opts?.elements);
    const referenceImageUrls = Array.isArray(opts?.referenceImages) && opts.referenceImages.length > 0
        ? opts.referenceImages.map((img) => toDataUri(img))
        : undefined;

    const input: Record<string, any> = {
        prompt,
        image_url: toDataUri(image),
        duration,
        generate_audio: opts?.generateAudio ?? true,
    };
    if (opts?.endImage) {
        input.end_image_url = toDataUri(opts.endImage);
    }
    if (multiPrompt) {
        input.multi_prompt = multiPrompt;
    }
    if (opts?.shotType) {
        input.shot_type = opts.shotType;
    }
    if (referenceImageUrls) {
        input.image_urls = referenceImageUrls;
    }
    if (elements) {
        input.elements = elements;
    }

    let model = MODELS.KLING_O3_PRO_I2V;
    let output: any;
    if (opts?.referenceVideo) {
        model = MODELS.KLING_O3_PRO_REFERENCE_V2V;
        const referenceInput: Record<string, any> = {
            prompt,
            start_image_url: toDataUri(image),
            duration,
            generate_audio: opts?.generateAudio ?? true,
            aspect_ratio: opts?.aspectRatio || '16:9',
        };
        if (opts?.endImage) {
            referenceInput.end_image_url = toDataUri(opts.endImage);
        }
        if (multiPrompt) {
            referenceInput.multi_prompt = multiPrompt;
        }
        if (opts?.shotType) {
            referenceInput.shot_type = opts.shotType;
        }
        if (referenceImageUrls) {
            referenceInput.image_urls = referenceImageUrls;
        }
        const referenceElements = [
            ...(elements || []),
            { type: 'video', video_url: toDataUri(opts.referenceVideo) },
        ];
        referenceInput.elements = referenceElements;
        output = await runFalQueue(model, referenceInput);
    } else {
        output = await runFal(model, input);
    }
    const urls = Array.from(new Set(collectFalVideoUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL Kling O3 Pro returned no video.');
    }

    const videoUrl = urls[0];
    let resolvedDuration = duration;
    try {
        resolvedDuration = await getVideoDuration(videoUrl);
    } catch (e) {
        resolvedDuration = duration;
    }

    recordUsage({
        provider: 'fal',
        model,
        kind: 'video',
        units: resolvedDuration || duration,
        unitLabel: 'second',
        note: 'FAL Kling O3 Pro video',
    });

    return {
        id: `fal-kling-o3-${Date.now()}`,
        name: `fal_kling_o3_${prompt.slice(0, 15)}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration: resolvedDuration,
    };
};

export const generateVideoWithFalKlingV3Image = async (
    prompt: string,
    image: { base64: string; mimeType: string },
    opts?: {
        endImage?: { base64: string; mimeType: string };
        duration?: number;
        aspectRatio?: '16:9' | '9:16' | '1:1';
        generateAudio?: boolean;
        negativePrompt?: string;
        cfgScale?: number;
        voiceIds?: string[];
        multiPrompt?: FalKlingMultiPrompt[];
        shotType?: 'static' | 'dynamic' | 'customize' | 'intelligent';
        elements?: FalKlingElement[];
        referenceImages?: Array<{ base64: string; mimeType: string }>;
    }
): Promise<MediaItem> => {
    const duration = clampDurationSeconds(opts?.duration, 5);
    const input: Record<string, any> = {
        prompt,
        start_image_url: toDataUri(image),
        duration: String(duration),
        aspect_ratio: opts?.aspectRatio || '16:9',
        generate_audio: opts?.generateAudio ?? true,
    };
    if (opts?.endImage) {
        input.end_image_url = toDataUri(opts.endImage);
    }
    if (opts?.negativePrompt) {
        input.negative_prompt = opts.negativePrompt;
    }
    if (typeof opts?.cfgScale === 'number' && Number.isFinite(opts.cfgScale)) {
        input.cfg_scale = opts.cfgScale;
    }
    const voiceIds = normalizeVoiceIds(opts?.voiceIds);
    if (voiceIds) {
        input.voice_ids = voiceIds;
    }
    const multiPrompt = toFalMultiPrompt(opts?.multiPrompt);
    if (multiPrompt) {
        input.multi_prompt = multiPrompt;
    }
    if (opts?.shotType) {
        input.shot_type = opts.shotType;
    }
    const elements = toFalElements(opts?.elements);
    if (elements) {
        input.elements = elements;
    }
    if (Array.isArray(opts?.referenceImages) && opts.referenceImages.length > 0) {
        input.image_urls = opts.referenceImages.map((img) => toDataUri(img));
    }

    const output = await runFalQueue(MODELS.KLING_V3_PRO_I2V, input);
    const urls = Array.from(new Set(collectFalVideoUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL Kling v3 Pro I2V returned no video.');
    }

    const videoUrl = urls[0];
    let resolvedDuration = duration;
    try {
        resolvedDuration = await getVideoDuration(videoUrl);
    } catch {
        resolvedDuration = duration;
    }

    recordUsage({
        provider: 'fal',
        model: MODELS.KLING_V3_PRO_I2V,
        kind: 'video',
        units: resolvedDuration || duration,
        unitLabel: 'second',
        note: 'FAL Kling v3 Pro I2V video',
    });

    return {
        id: `fal-kling-v3-i2v-${Date.now()}`,
        name: `fal_kling_v3_i2v_${prompt.slice(0, 15)}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration: resolvedDuration,
    };
};

export const generateVideoWithFalKlingV3Text = async (
    prompt: string,
    opts?: {
        duration?: number;
        aspectRatio?: '16:9' | '9:16' | '1:1';
        generateAudio?: boolean;
        negativePrompt?: string;
        cfgScale?: number;
        voiceIds?: string[];
        multiPrompt?: FalKlingMultiPrompt[];
        shotType?: 'static' | 'dynamic' | 'customize' | 'intelligent';
        elements?: FalKlingElement[];
        referenceImages?: Array<{ base64: string; mimeType: string }>;
    }
): Promise<MediaItem> => {
    const duration = clampDurationSeconds(opts?.duration, 5);
    const input: Record<string, any> = {
        prompt,
        duration: String(duration),
        aspect_ratio: opts?.aspectRatio || '16:9',
        generate_audio: opts?.generateAudio ?? true,
    };
    if (opts?.negativePrompt) {
        input.negative_prompt = opts.negativePrompt;
    }
    if (typeof opts?.cfgScale === 'number' && Number.isFinite(opts.cfgScale)) {
        input.cfg_scale = opts.cfgScale;
    }
    const voiceIds = normalizeVoiceIds(opts?.voiceIds);
    if (voiceIds) {
        input.voice_ids = voiceIds;
    }
    const multiPrompt = toFalMultiPrompt(opts?.multiPrompt);
    if (multiPrompt) {
        input.multi_prompt = multiPrompt;
    }
    if (opts?.shotType) {
        input.shot_type = opts.shotType;
    }
    const elements = toFalElements(opts?.elements);
    if (elements) {
        input.elements = elements;
    }
    if (Array.isArray(opts?.referenceImages) && opts.referenceImages.length > 0) {
        input.image_urls = opts.referenceImages.map((img) => toDataUri(img));
    }

    const output = await runFalQueue(MODELS.KLING_V3_PRO_T2V, input);
    const urls = Array.from(new Set(collectFalVideoUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL Kling v3 Pro T2V returned no video.');
    }

    const videoUrl = urls[0];
    let resolvedDuration = duration;
    try {
        resolvedDuration = await getVideoDuration(videoUrl);
    } catch {
        resolvedDuration = duration;
    }

    recordUsage({
        provider: 'fal',
        model: MODELS.KLING_V3_PRO_T2V,
        kind: 'video',
        units: resolvedDuration || duration,
        unitLabel: 'second',
        note: 'FAL Kling v3 Pro T2V video',
    });

    return {
        id: `fal-kling-v3-t2v-${Date.now()}`,
        name: `fal_kling_v3_t2v_${prompt.slice(0, 15)}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration: resolvedDuration,
    };
};

export const generateVideoWithFalCreatifyAurora = async (
    image: { base64: string; mimeType: string },
    audio: { base64: string; mimeType: string },
    opts?: {
        prompt?: string;
        guidanceScale?: number;
        audioGuidanceScale?: number;
        resolution?: '480p' | '720p';
    }
): Promise<MediaItem> => {
    const input: Record<string, any> = {
        image_url: toDataUri(image),
        audio_url: toDataUri(audio),
        resolution: opts?.resolution || '720p',
    };
    if (opts?.prompt) {
        input.prompt = opts.prompt;
    }
    if (typeof opts?.guidanceScale === 'number') {
        input.guidance_scale = opts.guidanceScale;
    }
    if (typeof opts?.audioGuidanceScale === 'number') {
        input.audio_guidance_scale = opts.audioGuidanceScale;
    }

    const output = await runFal(MODELS.CREATIFY_AURORA, input);
    const urls = Array.from(new Set(collectFalVideoUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL Creatify Aurora returned no video.');
    }

    const videoUrl = urls[0];
    let resolvedDuration = 0;
    try {
        resolvedDuration = await getVideoDuration(videoUrl);
    } catch {
        resolvedDuration = 0;
    }

    recordUsage({
        provider: 'fal',
        model: MODELS.CREATIFY_AURORA,
        kind: 'video',
        units: resolvedDuration || 0,
        unitLabel: 'second',
        note: 'FAL Creatify Aurora video',
    });

    return {
        id: `fal-aurora-${Date.now()}`,
        name: `fal_aurora_${Date.now()}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration: resolvedDuration || undefined,
    };
};

export const generateVideoWithFalGrokImagineI2V = async (
    prompt: string,
    image: { base64: string; mimeType: string },
    opts?: {
        duration?: number;
        aspectRatio?: 'auto' | '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '3:2' | '2:3';
        resolution?: '480p' | '720p';
    }
): Promise<MediaItem> => {
    const duration = clampDurationSeconds(opts?.duration, 6);
    const input: Record<string, any> = {
        prompt,
        image_url: toDataUri(image),
        duration,
        aspect_ratio: opts?.aspectRatio || 'auto',
        resolution: opts?.resolution || '720p',
    };

    const output = await runFal(MODELS.GROK_IMAGINE_I2V, input);
    const urls = Array.from(new Set(collectFalVideoUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL Grok Imagine I2V returned no video.');
    }

    const videoUrl = urls[0];
    let resolvedDuration = duration;
    try {
        resolvedDuration = await getVideoDuration(videoUrl);
    } catch {
        resolvedDuration = duration;
    }

    recordUsage({
        provider: 'fal',
        model: MODELS.GROK_IMAGINE_I2V,
        kind: 'video',
        units: resolvedDuration || duration,
        unitLabel: 'second',
        note: 'FAL Grok Imagine I2V video',
    });

    return {
        id: `fal-grok-i2v-${Date.now()}`,
        name: `fal_grok_i2v_${prompt.slice(0, 16) || 'clip'}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration: resolvedDuration,
    };
};

export const generateVideoWithFalSeedanceImage = async (
    prompt: string,
    image: { base64: string; mimeType: string },
    opts?: {
        endImage?: { base64: string; mimeType: string };
        duration?: number | 'auto';
        aspectRatio?: FalSeedanceVideoAspectRatio;
        resolution?: FalSeedanceVideoResolution;
        generateAudio?: boolean;
    }
): Promise<MediaItem> => {
    const duration = normalizeFalSeedanceDuration(opts?.duration);
    const input: Record<string, any> = {
        prompt,
        image_url: toDataUri(image),
        resolution: opts?.resolution || '720p',
        duration,
        aspect_ratio: opts?.aspectRatio || 'auto',
        generate_audio: opts?.generateAudio ?? true,
    };

    if (opts?.endImage) {
        input.end_image_url = toDataUri(opts.endImage);
    }

    const output = await runFalQueue(MODELS.SEEDANCE_2_I2V, input, {
        pollIntervalMs: 5000,
        maxChecks: 240,
    });
    const urls = Array.from(new Set(collectFalVideoUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL Seedance 2.0 Image-to-Video returned no video.');
    }

    const videoUrl = urls[0];
    let resolvedDuration = duration === 'auto' ? 10 : Number(duration);
    try {
        resolvedDuration = await getVideoDuration(videoUrl);
    } catch {
        resolvedDuration = duration === 'auto' ? 10 : Number(duration);
    }

    recordUsage({
        provider: 'fal',
        model: MODELS.SEEDANCE_2_I2V,
        kind: 'video',
        units: resolvedDuration || (duration === 'auto' ? 10 : Number(duration)),
        unitLabel: 'second',
        note: 'FAL Seedance 2.0 image-to-video',
    });

    return {
        id: `fal-seedance-2-i2v-${Date.now()}`,
        name: `fal_seedance_2_i2v_${prompt.slice(0, 15) || 'clip'}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration: resolvedDuration,
    };
};

export const generateVideoWithFalSeedanceReference = async (
    prompt: string,
    opts?: {
        images?: Array<{ base64: string; mimeType: string }>;
        videos?: Array<{ base64: string; mimeType: string }>;
        audios?: Array<{ base64: string; mimeType: string }>;
        duration?: number | 'auto';
        aspectRatio?: FalSeedanceVideoAspectRatio;
        resolution?: FalSeedanceVideoResolution;
        generateAudio?: boolean;
    }
): Promise<MediaItem> => {
    const images = Array.isArray(opts?.images) ? opts.images.slice(0, 9) : [];
    const videos = Array.isArray(opts?.videos) ? opts.videos.slice(0, 3) : [];
    const audios = Array.isArray(opts?.audios) ? opts.audios.slice(0, 3) : [];
    if (images.length === 0 && videos.length === 0) {
        throw new Error('Seedance 2.0 reference mode needs at least one image or video reference.');
    }

    const duration = normalizeFalSeedanceDuration(opts?.duration);
    const input: Record<string, any> = {
        prompt,
        resolution: opts?.resolution || '720p',
        duration,
        aspect_ratio: opts?.aspectRatio || 'auto',
        generate_audio: opts?.generateAudio ?? true,
    };
    if (images.length > 0) {
        input.image_urls = images.map((image) => toDataUri(image));
    }
    if (videos.length > 0) {
        input.video_urls = videos.map((video) => toDataUri(video));
    }
    if (audios.length > 0) {
        input.audio_urls = audios.map((audio) => toDataUri(audio));
    }

    const output = await runFalQueue(MODELS.SEEDANCE_2_REFERENCE, input, {
        pollIntervalMs: 5000,
        maxChecks: 240,
    });
    const urls = Array.from(new Set(collectFalVideoUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL Seedance 2.0 Reference-to-Video returned no video.');
    }

    const videoUrl = urls[0];
    let resolvedDuration = duration === 'auto' ? 10 : Number(duration);
    try {
        resolvedDuration = await getVideoDuration(videoUrl);
    } catch {
        resolvedDuration = duration === 'auto' ? 10 : Number(duration);
    }

    recordUsage({
        provider: 'fal',
        model: MODELS.SEEDANCE_2_REFERENCE,
        kind: 'video',
        units: resolvedDuration || (duration === 'auto' ? 10 : Number(duration)),
        unitLabel: 'second',
        note: 'FAL Seedance 2.0 reference-to-video',
    });

    return {
        id: `fal-seedance-2-reference-${Date.now()}`,
        name: `fal_seedance_2_reference_${prompt.slice(0, 15) || 'clip'}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration: resolvedDuration,
    };
};

export const generateVideoWithFalPixverseC1Reference = async (
    prompt: string,
    imageReferences: Array<{
        refName: string;
        type: FalPixverseReferenceType;
        image: { base64: string; mimeType: string };
    }>,
    opts?: {
        aspectRatio?: FalPixverseAspectRatio;
        resolution?: FalPixverseResolution;
        duration?: number;
        generateAudio?: boolean;
    }
): Promise<MediaItem> => {
    const refs = imageReferences
        .map((entry) => ({
            ref_name: String(entry?.refName || '').trim(),
            type: entry?.type || 'background',
            image_url: entry?.image ? toDataUri(entry.image) : undefined,
        }))
        .filter((entry) => entry.ref_name && entry.image_url);
    if (refs.length === 0) {
        throw new Error('PixVerse C1 reference mode needs at least one image reference.');
    }

    const duration = clampDurationRange(opts?.duration, 5, 1, 15);
    const input: Record<string, any> = {
        prompt,
        aspect_ratio: opts?.aspectRatio || '16:9',
        resolution: opts?.resolution || '720p',
        duration,
        generate_audio_switch: opts?.generateAudio ?? false,
        image_references: refs,
    };

    const output = await runFalQueue(MODELS.PIXVERSE_C1_REFERENCE_TO_VIDEO, input, {
        pollIntervalMs: 5000,
        maxChecks: 240,
    });
    const urls = Array.from(new Set(collectFalVideoUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL PixVerse C1 Reference-to-Video returned no video.');
    }

    const videoUrl = urls[0];
    let resolvedDuration = duration;
    try {
        resolvedDuration = await getVideoDuration(videoUrl);
    } catch {
        resolvedDuration = duration;
    }

    recordUsage({
        provider: 'fal',
        model: MODELS.PIXVERSE_C1_REFERENCE_TO_VIDEO,
        kind: 'video',
        units: resolvedDuration || duration,
        unitLabel: 'second',
        note: 'FAL PixVerse C1 reference-to-video',
    });

    return {
        id: `fal-pixverse-c1-reference-${Date.now()}`,
        name: `fal_pixverse_c1_reference_${prompt.slice(0, 15) || 'clip'}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration: resolvedDuration,
    };
};

export const generateVideoWithFalWanV27Text = async (
    prompt: string,
    opts?: {
        duration?: number;
        aspectRatio?: FalWanVideoAspectRatio;
        resolution?: FalWanVideoResolution;
        audio?: { base64: string; mimeType: string };
        negativePrompt?: string;
        enablePromptExpansion?: boolean;
    }
): Promise<MediaItem> => {
    const duration = clampDurationRange(opts?.duration, 5, 2, 15);
    const input: Record<string, any> = {
        prompt,
        aspect_ratio: opts?.aspectRatio || '16:9',
        resolution: opts?.resolution || '1080p',
        duration,
    };
    if (opts?.audio) {
        input.audio_url = toDataUri(opts.audio);
    }
    if (opts?.negativePrompt) {
        input.negative_prompt = opts.negativePrompt;
    }
    if (typeof opts?.enablePromptExpansion === 'boolean') {
        input.enable_prompt_expansion = opts.enablePromptExpansion;
    }

    const output = await runFalQueue(MODELS.WAN_V27_T2V, input, {
        pollIntervalMs: 5000,
        maxChecks: 240,
    });
    const urls = Array.from(new Set(collectFalVideoUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL WAN 2.7 Text-to-Video returned no video.');
    }

    const videoUrl = urls[0];
    let resolvedDuration = duration;
    try {
        resolvedDuration = await getVideoDuration(videoUrl);
    } catch {
        resolvedDuration = duration;
    }

    recordUsage({
        provider: 'fal',
        model: MODELS.WAN_V27_T2V,
        kind: 'video',
        units: resolvedDuration || duration,
        unitLabel: 'second',
        note: 'FAL WAN 2.7 text-to-video',
    });

    return {
        id: `fal-wan-v27-t2v-${Date.now()}`,
        name: `fal_wan_v27_t2v_${prompt.slice(0, 15) || 'clip'}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration: resolvedDuration,
    };
};

export const generateVideoWithFalWanV27Image = async (
    prompt: string,
    image: { base64: string; mimeType: string },
    opts?: {
        endImage?: { base64: string; mimeType: string };
        duration?: number;
        aspectRatio?: FalWanVideoAspectRatio;
        resolution?: FalWanVideoResolution;
        audio?: { base64: string; mimeType: string };
        negativePrompt?: string;
        enablePromptExpansion?: boolean;
        video?: { base64: string; mimeType: string };
    }
): Promise<MediaItem> => {
    const duration = clampDurationRange(opts?.duration, 5, 2, 15);
    const input: Record<string, any> = {
        prompt,
        image_url: toDataUri(image),
        aspect_ratio: opts?.aspectRatio || '16:9',
        resolution: opts?.resolution || '1080p',
        duration,
    };
    if (opts?.endImage) {
        input.end_image_url = toDataUri(opts.endImage);
    }
    if (opts?.audio) {
        input.audio_url = toDataUri(opts.audio);
    }
    if (opts?.negativePrompt) {
        input.negative_prompt = opts.negativePrompt;
    }
    if (typeof opts?.enablePromptExpansion === 'boolean') {
        input.enable_prompt_expansion = opts.enablePromptExpansion;
    }
    if (opts?.video) {
        input.video_url = toDataUri(opts.video);
    }

    const output = await runFalQueue(MODELS.WAN_V27_I2V, input, {
        pollIntervalMs: 5000,
        maxChecks: 240,
    });
    const urls = Array.from(new Set(collectFalVideoUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL WAN 2.7 Image-to-Video returned no video.');
    }

    const videoUrl = urls[0];
    let resolvedDuration = duration;
    try {
        resolvedDuration = await getVideoDuration(videoUrl);
    } catch {
        resolvedDuration = duration;
    }

    recordUsage({
        provider: 'fal',
        model: MODELS.WAN_V27_I2V,
        kind: 'video',
        units: resolvedDuration || duration,
        unitLabel: 'second',
        note: 'FAL WAN 2.7 image-to-video',
    });

    return {
        id: `fal-wan-v27-i2v-${Date.now()}`,
        name: `fal_wan_v27_i2v_${prompt.slice(0, 15) || 'clip'}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration: resolvedDuration,
    };
};

export const generateVideoWithFalHappyHorseText = async (
    prompt: string,
    opts?: {
        duration?: number;
        aspectRatio?: FalHappyHorseAspectRatio;
        resolution?: FalHappyHorseResolution;
        seed?: number;
        enableSafetyChecker?: boolean;
    }
): Promise<MediaItem> => {
    const duration = clampDurationRange(opts?.duration, 5, 3, 15);
    const input: Record<string, any> = {
        prompt,
        aspect_ratio: opts?.aspectRatio || '16:9',
        resolution: opts?.resolution || '1080p',
        duration,
        enable_safety_checker: opts?.enableSafetyChecker ?? true,
    };
    const seed = toOptionalInteger(opts?.seed);
    if (typeof seed === 'number') {
        input.seed = seed;
    }

    const output = await runFalQueue(MODELS.HAPPY_HORSE_T2V, input, {
        pollIntervalMs: 5000,
        maxChecks: 240,
    });
    const urls = Array.from(new Set(collectFalVideoUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL Happy Horse Text-to-Video returned no video.');
    }

    const videoUrl = urls[0];
    let resolvedDuration = duration;
    try {
        resolvedDuration = await getVideoDuration(videoUrl);
    } catch {
        resolvedDuration = duration;
    }

    recordUsage({
        provider: 'fal',
        model: MODELS.HAPPY_HORSE_T2V,
        kind: 'video',
        units: resolvedDuration || duration,
        unitLabel: 'second',
        note: 'FAL Happy Horse text-to-video',
    });

    return {
        id: `fal-happy-horse-t2v-${Date.now()}`,
        name: `fal_happy_horse_t2v_${prompt.slice(0, 15) || 'clip'}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration: resolvedDuration,
    };
};

export const generateVideoWithFalHappyHorseImage = async (
    prompt: string,
    image: { base64: string; mimeType: string },
    opts?: {
        duration?: number;
        resolution?: FalHappyHorseResolution;
        seed?: number;
        enableSafetyChecker?: boolean;
    }
): Promise<MediaItem> => {
    const duration = clampDurationRange(opts?.duration, 5, 3, 15);
    const input: Record<string, any> = {
        image_url: toDataUri(image),
        prompt,
        resolution: opts?.resolution || '1080p',
        duration,
        enable_safety_checker: opts?.enableSafetyChecker ?? true,
    };
    const seed = toOptionalInteger(opts?.seed);
    if (typeof seed === 'number') {
        input.seed = seed;
    }

    const output = await runFalQueue(MODELS.HAPPY_HORSE_I2V, input, {
        pollIntervalMs: 5000,
        maxChecks: 240,
    });
    const urls = Array.from(new Set(collectFalVideoUrls(output)));

    if (urls.length === 0) {
        throw new Error('FAL Happy Horse Image-to-Video returned no video.');
    }

    const videoUrl = urls[0];
    let resolvedDuration = duration;
    try {
        resolvedDuration = await getVideoDuration(videoUrl);
    } catch {
        resolvedDuration = duration;
    }

    recordUsage({
        provider: 'fal',
        model: MODELS.HAPPY_HORSE_I2V,
        kind: 'video',
        units: resolvedDuration || duration,
        unitLabel: 'second',
        note: 'FAL Happy Horse image-to-video',
    });

    return {
        id: `fal-happy-horse-i2v-${Date.now()}`,
        name: `fal_happy_horse_i2v_${prompt.slice(0, 15) || 'clip'}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration: resolvedDuration,
    };
};
