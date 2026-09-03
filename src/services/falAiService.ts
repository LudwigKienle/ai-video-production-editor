import { MediaItem } from '../types';
import { getVideoDuration } from '../utils/helpers';
import { recordUsage } from '../utils/usageTracker';
import { byokProxyJson, shouldUseByokProxy } from './byokProxyClient';
import { startTask, type TaskKind } from './taskCenter';

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
    SEEDANCE_25_T2V: 'bytedance/seedance-2.5/text-to-video',
    SEEDANCE_25_I2V: 'bytedance/seedance-2.5/image-to-video',
    SEEDANCE_25_REFERENCE: 'bytedance/seedance-2.5/reference-to-video',
    SEEDREAM_V5_PRO_T2I: 'bytedance/seedream/v5/pro/text-to-image',
    SEEDREAM_V5_PRO_EDIT: 'bytedance/seedream/v5/pro/edit',
    KREA_2_LARGE_T2I: 'krea/v2/large/text-to-image',
    KREA_2_TURBO_T2I: 'fal-ai/krea-2/turbo',
    IDEOGRAM_V4_T2I: 'ideogram/v4',
    HUNYUAN3D_V3_IMAGE_TO_3D: 'fal-ai/hunyuan3d-v3/image-to-3d',
    TRELLIS_2_IMAGE_TO_3D: 'fal-ai/trellis-2',
    RODIN_V25_IMAGE_TO_3D: 'fal-ai/hyper3d/rodin/v2.5',
};

export const FAL_MODEL_IDS = MODELS;

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


const describeFalModel = (model: string) => {
    const tail = model.split('/').filter(Boolean);
    const name = tail.slice(-3).join(' / ').replace(/-/g, ' ');
    return name.charAt(0).toUpperCase() + name.slice(1);
};

const falTaskKind = (model: string): TaskKind => {
    const normalized = model.toLowerCase();
    if (normalized.includes('3d') || normalized.includes('trellis') || normalized.includes('rodin')) return '3d';
    const kind = inferFalKind(model);
    return kind === 'video' ? 'video' : 'image';
};

const falEstimateMs = (model: string) => {
    const kind = falTaskKind(model);
    if (kind === 'video') return 150_000;
    if (kind === '3d') return 120_000;
    return 25_000;
};

const runFalInner = async (model: string, input: Record<string, any>) => {
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

const runFal = async (model: string, input: Record<string, any>) => {
    const task = startTask({ label: describeFalModel(model), kind: falTaskKind(model), provider: 'fal', estimatedMs: falEstimateMs(model), message: 'Generating…' });
    try {
        const output = await runFalInner(model, input);
        task.complete();
        return output;
    } catch (error) {
        task.fail(error);
        throw error;
    }
};

const runFalQueueInner = async (
    model: string,
    input: Record<string, any>,
    opts?: { pollIntervalMs?: number; maxChecks?: number },
    onStatus?: (status: string, checks: number) => void,
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
        onStatus?.(status, checks);
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

const runFalQueue = async (
    model: string,
    input: Record<string, any>,
    opts?: { pollIntervalMs?: number; maxChecks?: number }
) => {
    const task = startTask({ label: describeFalModel(model), kind: falTaskKind(model), provider: 'fal', estimatedMs: falEstimateMs(model), message: 'Queued…' });
    try {
        const output = await runFalQueueInner(model, input, opts, (status) => {
            task.update({ message: status === 'IN_PROGRESS' ? 'Rendering…' : status === 'IN_QUEUE' ? 'Waiting in queue…' : status ? status.toLowerCase() : 'Working…' });
        });
        task.complete();
        return output;
    } catch (error) {
        task.fail(error);
        throw error;
    }
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


// ---------------------------------------------------------------------------
// Seedance 2.5 (ByteDance) - text / image / reference to video, 4-30s, up to 1080p
// ---------------------------------------------------------------------------

export type FalSeedance25Resolution = '480p' | '720p' | '1080p';
export type FalSeedance25AspectRatio = FalSeedanceVideoAspectRatio;

const normalizeFalSeedance25Duration = (value: number | 'auto' | undefined): 'auto' | string => {
    if (value === 'auto' || value === undefined) return 'auto';
    const normalized = clampDurationRange(typeof value === 'number' ? value : undefined, 10, 4, 30);
    return String(normalized);
};

const finalizeFalSeedance25Video = async (
    output: any,
    model: string,
    prompt: string,
    duration: 'auto' | string,
    label: string,
    idPrefix: string,
): Promise<MediaItem> => {
    const urls = Array.from(new Set(collectFalVideoUrls(output)));
    if (urls.length === 0) {
        throw new Error(`FAL ${label} returned no video.`);
    }
    const videoUrl = urls[0];
    const fallbackDuration = duration === 'auto' ? 10 : Number(duration);
    let resolvedDuration = fallbackDuration;
    try {
        resolvedDuration = await getVideoDuration(videoUrl);
    } catch {
        resolvedDuration = fallbackDuration;
    }
    recordUsage({
        provider: 'fal',
        model,
        kind: 'video',
        units: resolvedDuration || fallbackDuration,
        unitLabel: 'second',
        note: `FAL ${label}`,
    });
    return {
        id: `${idPrefix}-${Date.now()}`,
        name: `${idPrefix.replace(/-/g, '_')}_${prompt.slice(0, 15) || 'clip'}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        generatedBy: label,
        prompt,
        duration: resolvedDuration,
    };
};

export const generateVideoWithFalSeedance25Text = async (
    prompt: string,
    opts?: {
        duration?: number | 'auto';
        aspectRatio?: FalSeedance25AspectRatio;
        resolution?: FalSeedance25Resolution;
        generateAudio?: boolean;
        highBitrate?: boolean;
    }
): Promise<MediaItem> => {
    const duration = normalizeFalSeedance25Duration(opts?.duration);
    const input: Record<string, any> = {
        prompt,
        resolution: opts?.resolution || '720p',
        duration,
        aspect_ratio: opts?.aspectRatio || 'auto',
        generate_audio: opts?.generateAudio ?? true,
        bitrate_mode: opts?.highBitrate ? 'high' : 'standard',
    };
    const output = await runFalQueue(MODELS.SEEDANCE_25_T2V, input, { pollIntervalMs: 5000, maxChecks: 360 });
    return finalizeFalSeedance25Video(output, MODELS.SEEDANCE_25_T2V, prompt, duration, 'Seedance 2.5 text-to-video', 'fal-seedance-25-t2v');
};

export const generateVideoWithFalSeedance25Image = async (
    prompt: string,
    image: { base64: string; mimeType: string },
    opts?: {
        endImage?: { base64: string; mimeType: string };
        duration?: number | 'auto';
        resolution?: FalSeedance25Resolution;
        generateAudio?: boolean;
        highBitrate?: boolean;
    }
): Promise<MediaItem> => {
    const duration = normalizeFalSeedance25Duration(opts?.duration);
    const input: Record<string, any> = {
        prompt,
        image_url: toDataUri(image),
        resolution: opts?.resolution || '720p',
        duration,
        aspect_ratio: 'auto',
        generate_audio: opts?.generateAudio ?? true,
        bitrate_mode: opts?.highBitrate ? 'high' : 'standard',
    };
    if (opts?.endImage) {
        input.end_image_url = toDataUri(opts.endImage);
    }
    const output = await runFalQueue(MODELS.SEEDANCE_25_I2V, input, { pollIntervalMs: 5000, maxChecks: 360 });
    return finalizeFalSeedance25Video(output, MODELS.SEEDANCE_25_I2V, prompt, duration, 'Seedance 2.5 image-to-video', 'fal-seedance-25-i2v');
};

export const generateVideoWithFalSeedance25Reference = async (
    prompt: string,
    opts?: {
        images?: Array<{ base64: string; mimeType: string }>;
        videos?: Array<{ base64: string; mimeType: string }>;
        audios?: Array<{ base64: string; mimeType: string }>;
        duration?: number | 'auto';
        aspectRatio?: FalSeedance25AspectRatio;
        resolution?: FalSeedance25Resolution;
        generateAudio?: boolean;
        highBitrate?: boolean;
    }
): Promise<MediaItem> => {
    const images = Array.isArray(opts?.images) ? opts.images.slice(0, 30) : [];
    const videos = Array.isArray(opts?.videos) ? opts.videos.slice(0, 10) : [];
    const audios = Array.isArray(opts?.audios) ? opts.audios.slice(0, 10) : [];
    if (images.length === 0 && videos.length === 0) {
        throw new Error('Seedance 2.5 reference mode needs at least one image or video reference.');
    }
    const duration = normalizeFalSeedance25Duration(opts?.duration);
    const input: Record<string, any> = {
        prompt,
        resolution: opts?.resolution || '720p',
        duration,
        aspect_ratio: opts?.aspectRatio || 'auto',
        generate_audio: opts?.generateAudio ?? true,
        bitrate_mode: opts?.highBitrate ? 'high' : 'standard',
    };
    if (images.length > 0) input.image_urls = images.map((image) => toDataUri(image));
    if (videos.length > 0) input.video_urls = videos.map((video) => toDataUri(video));
    if (audios.length > 0) input.audio_urls = audios.map((audio) => toDataUri(audio));
    const output = await runFalQueue(MODELS.SEEDANCE_25_REFERENCE, input, { pollIntervalMs: 5000, maxChecks: 360 });
    return finalizeFalSeedance25Video(output, MODELS.SEEDANCE_25_REFERENCE, prompt, duration, 'Seedance 2.5 reference-to-video', 'fal-seedance-25-ref');
};

// ---------------------------------------------------------------------------
// Image models: Seedream 5.0 Pro, Krea 2, Ideogram 4
// ---------------------------------------------------------------------------

type FalStandardImageAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';

const mapStandardImageSizePreset = (aspectRatio?: FalStandardImageAspectRatio) => {
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

const finalizeFalImages = (
    output: any,
    model: string,
    prompt: string,
    label: string,
    idPrefix: string,
    extension: 'png' | 'jpg' = 'png',
): MediaItem[] => {
    const urls = Array.from(new Set(collectFalImageUrls(output)));
    if (urls.length === 0) {
        throw new Error(`FAL ${label} returned no images.`);
    }
    recordUsage({
        provider: 'fal',
        model,
        kind: 'image',
        units: urls.length,
        unitLabel: 'image',
        note: `FAL ${label}`,
    });
    const stamp = Date.now();
    return urls.map((url, index) => ({
        id: `${idPrefix}-${stamp}-${index}`,
        name: `${idPrefix.replace(/-/g, '_')}_${prompt.slice(0, 16) || 'image'}${index > 0 ? `_${index + 1}` : ''}.${extension}`,
        type: 'image' as const,
        url,
        source: 'generated' as const,
        generatedBy: label,
        prompt,
    }));
};

export const generateImageWithFalSeedreamV5Pro = async (
    prompt: string,
    opts?: { aspectRatio?: FalStandardImageAspectRatio; resolution?: '1K' | '2K'; numOutputs?: number; outputFormat?: 'png' | 'jpeg' }
): Promise<MediaItem> => {
    const input: Record<string, any> = {
        prompt,
        image_size: opts?.aspectRatio ? mapStandardImageSizePreset(opts.aspectRatio) : (opts?.resolution === '1K' ? 'auto_1K' : 'auto_2K'),
        num_images: opts?.numOutputs || 1,
        output_format: opts?.outputFormat || 'png',
    };
    const output = await runFalQueue(MODELS.SEEDREAM_V5_PRO_T2I, input, { pollIntervalMs: 2500, maxChecks: 120 });
    return finalizeFalImages(output, MODELS.SEEDREAM_V5_PRO_T2I, prompt, 'Seedream 5.0 Pro text-to-image', 'fal-seedream-v5-pro-t2i')[0];
};

export const editImageWithFalSeedreamV5Pro = async (
    prompt: string,
    images: Array<{ base64: string; mimeType: string }>,
    opts?: { aspectRatio?: FalStandardImageAspectRatio; numOutputs?: number; outputFormat?: 'png' | 'jpeg' }
): Promise<MediaItem[]> => {
    const refs = images.slice(0, 10);
    if (refs.length === 0) {
        throw new Error('Seedream 5.0 Pro Edit needs at least one reference image.');
    }
    const input: Record<string, any> = {
        prompt,
        image_urls: refs.map((image) => toDataUri(image)),
        image_size: opts?.aspectRatio ? mapStandardImageSizePreset(opts.aspectRatio) : 'auto_2K',
        num_images: opts?.numOutputs || 1,
        output_format: opts?.outputFormat || 'png',
    };
    const output = await runFalQueue(MODELS.SEEDREAM_V5_PRO_EDIT, input, { pollIntervalMs: 2500, maxChecks: 120 });
    return finalizeFalImages(output, MODELS.SEEDREAM_V5_PRO_EDIT, prompt, 'Seedream 5.0 Pro edit', 'fal-seedream-v5-pro-edit');
};

export type FalKrea2Variant = 'large' | 'turbo';
export type FalKrea2AspectRatio = '1:1' | '4:3' | '3:2' | '16:9' | '2.35:1' | '4:5' | '2:3' | '9:16';

export const generateImageWithFalKrea2 = async (
    prompt: string,
    opts?: {
        variant?: FalKrea2Variant;
        aspectRatio?: FalKrea2AspectRatio;
        creativity?: 'raw' | 'low' | 'medium' | 'high';
        styleReferences?: Array<{ base64: string; mimeType: string }>;
        numOutputs?: number;
        seed?: number;
    }
): Promise<MediaItem> => {
    const variant = opts?.variant || 'large';
    if (variant === 'turbo') {
        const ratio = opts?.aspectRatio || '16:9';
        const preset = ratio === '9:16' ? 'portrait_16_9'
            : ratio === '4:3' ? 'landscape_4_3'
                : ratio === '1:1' ? 'square_hd'
                    : ratio === '2:3' || ratio === '4:5' ? 'portrait_4_3'
                        : 'landscape_16_9';
        const input: Record<string, any> = {
            prompt,
            image_size: preset,
            num_images: opts?.numOutputs || 1,
            output_format: 'png',
        };
        if (typeof opts?.seed === 'number') input.seed = opts.seed;
        const output = await runFalQueue(MODELS.KREA_2_TURBO_T2I, input, { pollIntervalMs: 2000, maxChecks: 90 });
        return finalizeFalImages(output, MODELS.KREA_2_TURBO_T2I, prompt, 'Krea 2 Turbo text-to-image', 'fal-krea-2-turbo')[0];
    }
    const input: Record<string, any> = {
        prompt,
        aspect_ratio: opts?.aspectRatio || '16:9',
        creativity: opts?.creativity || 'medium',
    };
    if (typeof opts?.seed === 'number') input.seed = opts.seed;
    if (Array.isArray(opts?.styleReferences) && opts.styleReferences.length > 0) {
        input.image_style_references = opts.styleReferences.slice(0, 10).map((image) => ({
            url: toDataUri(image),
            strength: 1,
        }));
    }
    const output = await runFalQueue(MODELS.KREA_2_LARGE_T2I, input, { pollIntervalMs: 2500, maxChecks: 120 });
    return finalizeFalImages(output, MODELS.KREA_2_LARGE_T2I, prompt, 'Krea 2 Large text-to-image', 'fal-krea-2-large')[0];
};

export type FalIdeogramRenderingSpeed = 'TURBO' | 'BALANCED' | 'QUALITY';

export const generateImageWithFalIdeogramV4 = async (
    prompt: string,
    opts?: {
        aspectRatio?: FalStandardImageAspectRatio;
        renderingSpeed?: FalIdeogramRenderingSpeed;
        promptExpansion?: 'None' | 'Medium' | 'Large';
        numOutputs?: number;
        seed?: number;
    }
): Promise<MediaItem> => {
    const input: Record<string, any> = {
        prompt,
        image_size: mapStandardImageSizePreset(opts?.aspectRatio),
        rendering_speed: opts?.renderingSpeed || 'BALANCED',
        expansion_model: opts?.promptExpansion || 'Medium',
        num_images: opts?.numOutputs || 1,
        output_format: 'png',
    };
    if (typeof opts?.seed === 'number') input.seed = opts.seed;
    const output = await runFalQueue(MODELS.IDEOGRAM_V4_T2I, input, { pollIntervalMs: 2500, maxChecks: 120 });
    return finalizeFalImages(output, MODELS.IDEOGRAM_V4_T2I, prompt, 'Ideogram 4 text-to-image', 'fal-ideogram-v4')[0];
};

// ---------------------------------------------------------------------------
// Image-to-3D (blockouts): Hunyuan3D v3, Trellis 2, Rodin 2.5
// ---------------------------------------------------------------------------

export type FalImageTo3dEngine = 'hunyuan3d-v3' | 'trellis-2' | 'rodin-v2.5';

export type FalImageTo3dResult = MediaItem & {
    meshUrl: string;
    thumbnailUrl?: string;
    engine: FalImageTo3dEngine;
    format: 'glb';
};

const pickFalMeshUrl = (output: any): { meshUrl: string | null; thumbnailUrl?: string } => {
    if (!output || typeof output !== 'object') return { meshUrl: null };
    const candidates = [
        output.model_glb?.url,
        output.model_urls?.glb?.url,
        output.model_mesh?.url,
        Array.isArray(output.model_meshes) ? output.model_meshes[0]?.url : undefined,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);
    return {
        meshUrl: candidates[0] || null,
        thumbnailUrl: typeof output.thumbnail?.url === 'string' ? output.thumbnail.url : undefined,
    };
};

const finalizeFalMesh = (output: any, engine: FalImageTo3dEngine, model: string, label: string, name: string): FalImageTo3dResult => {
    const { meshUrl, thumbnailUrl } = pickFalMeshUrl(output);
    if (!meshUrl) {
        throw new Error(`FAL ${label} returned no mesh.`);
    }
    recordUsage({
        provider: 'fal',
        model,
        kind: 'edit',
        units: 1,
        unitLabel: 'request',
        note: `FAL ${label}`,
    });
    return {
        id: `fal-3d-${engine}-${Date.now()}`,
        name: `${name.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) || 'blockout'}.glb`,
        type: 'image',
        url: meshUrl,
        source: 'generated',
        generatedBy: label,
        meshUrl,
        thumbnailUrl,
        engine,
        format: 'glb',
    };
};

export const generate3dWithFalHunyuan3dV3 = async (
    image: { base64: string; mimeType: string },
    opts?: {
        name?: string;
        lowPoly?: boolean;
        geometryOnly?: boolean;
        faceCount?: number;
        enablePbr?: boolean;
        backImage?: { base64: string; mimeType: string };
        leftImage?: { base64: string; mimeType: string };
        rightImage?: { base64: string; mimeType: string };
    }
): Promise<FalImageTo3dResult> => {
    const input: Record<string, any> = {
        input_image_url: toDataUri(image),
        generate_type: opts?.geometryOnly ? 'Geometry' : opts?.lowPoly ? 'LowPoly' : 'Normal',
        polygon_type: 'triangle',
        enable_pbr: opts?.enablePbr ?? !opts?.lowPoly,
    };
    if (typeof opts?.faceCount === 'number') {
        input.face_count = Math.min(1500000, Math.max(40000, Math.round(opts.faceCount)));
    }
    if (opts?.backImage) input.back_image_url = toDataUri(opts.backImage);
    if (opts?.leftImage) input.left_image_url = toDataUri(opts.leftImage);
    if (opts?.rightImage) input.right_image_url = toDataUri(opts.rightImage);
    const output = await runFalQueue(MODELS.HUNYUAN3D_V3_IMAGE_TO_3D, input, { pollIntervalMs: 4000, maxChecks: 240 });
    return finalizeFalMesh(output, 'hunyuan3d-v3', MODELS.HUNYUAN3D_V3_IMAGE_TO_3D, 'Hunyuan3D v3 image-to-3D', opts?.name || 'hunyuan3d_blockout');
};

export const generate3dWithFalTrellis2 = async (
    image: { base64: string; mimeType: string },
    opts?: { name?: string; resolution?: 512 | 1024 | 1536; textureSize?: 1024 | 2048 | 4096; decimationTarget?: number; seed?: number }
): Promise<FalImageTo3dResult> => {
    const input: Record<string, any> = {
        image_url: toDataUri(image),
        resolution: opts?.resolution || 1024,
        texture_size: opts?.textureSize || 2048,
    };
    if (typeof opts?.decimationTarget === 'number') input.decimation_target = Math.max(5000, Math.round(opts.decimationTarget));
    if (typeof opts?.seed === 'number') input.seed = opts.seed;
    const output = await runFalQueue(MODELS.TRELLIS_2_IMAGE_TO_3D, input, { pollIntervalMs: 4000, maxChecks: 240 });
    return finalizeFalMesh(output, 'trellis-2', MODELS.TRELLIS_2_IMAGE_TO_3D, 'Trellis 2 image-to-3D', opts?.name || 'trellis2_blockout');
};

export const generate3dWithFalRodinV25 = async (
    images: Array<{ base64: string; mimeType: string }>,
    opts?: {
        name?: string;
        prompt?: string;
        tier?: 'Gen-2.5-Low' | 'Gen-2.5-Medium' | 'Gen-2.5-High';
        material?: 'PBR' | 'Shaded' | 'All' | 'None';
        seed?: number;
    }
): Promise<FalImageTo3dResult> => {
    const refs = images.slice(0, 5);
    if (refs.length === 0) {
        throw new Error('Rodin 2.5 needs at least one reference image.');
    }
    const input: Record<string, any> = {
        prompt: opts?.prompt || '',
        image_urls: refs.map((image) => toDataUri(image)),
        tier: opts?.tier || 'Gen-2.5-Medium',
        geometry_file_format: 'glb',
        material: opts?.material || 'PBR',
        quality_mesh_option: 'Auto',
    };
    if (typeof opts?.seed === 'number') input.seed = opts.seed;
    const output = await runFalQueue(MODELS.RODIN_V25_IMAGE_TO_3D, input, { pollIntervalMs: 5000, maxChecks: 240 });
    return finalizeFalMesh(output, 'rodin-v2.5', MODELS.RODIN_V25_IMAGE_TO_3D, 'Rodin 2.5 image-to-3D', opts?.name || 'rodin_blockout');
};
