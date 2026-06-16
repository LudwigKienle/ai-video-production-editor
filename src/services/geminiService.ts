import { GoogleGenAI, Modality, Type, GenerateContentResponse, Operation, Chat, FunctionDeclaration, GenerateImagesResponse } from "@google/genai";
import { MediaItem, ScriptAnalysisResult, StoryBible, ChatMessage, ShotPrompt, ReviewFeedback, ScriptLength, CinematographyCritique, AudioScoreRequest, TimelineClip, ReferenceItem, AudioCue, ScriptQualityReport, ScriptDoctorImprovement, NeurocinematicsAnalysisResult, AudioPsychoacousticsResult, DirectorTreatment, SubtitleWordTiming, ShotContinuityReview } from '../types';
import { getVideoDuration, fileToBase64, decode } from "../utils/helpers";
import { recordUsage } from '../utils/usageTracker';
import { getGoogleModelProvider } from './googleModelProvider';
import { generateImageWithGemini3ProReplicate, generateTextWithGemini3ProReplicate, generateVideoWithVeoReplicate } from './replicateService';

declare global {
    interface AIStudio {
        hasSelectedApiKey: () => Promise<boolean>;
        openSelectKey: () => Promise<void>;
    }
    interface Window {
        aistudio?: AIStudio;
    }
}

const withRetry = async <T>(
    apiCall: () => Promise<T>,
    maxRetries = 5,
    initialDelay = 2000
): Promise<T> => {
    let attempt = 0;
    while (true) {
        try {
            return await apiCall();
        } catch (error: any) {
            const errorMessage = error.message || '';
            const isPermissionError = errorMessage.includes('403') || errorMessage.includes('PERMISSION_DENIED') || errorMessage.includes('The caller does not have permission');
            const isQuotaError = errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('quota');

            if (isPermissionError) {
                throw error;
            }

            attempt++;
            if (attempt >= maxRetries) {
                throw error;
            }

            const delay = initialDelay * Math.pow(2, attempt - 1);

            if (isQuotaError) {
                console.warn(`Quota exceeded (429). Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 1000));
            } else if (errorMessage.includes("overloaded")) {
                console.warn(`Model overloaded. Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else if (!errorMessage.includes("400") && !errorMessage.includes("404")) {
                console.warn(`API Error (${errorMessage}). Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
    let timeoutId: number | undefined;
    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
            reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
    }
};

const fetchWithTimeout = async (
    url: string,
    options: RequestInit,
    timeoutMs: number,
    label: string
): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (error: any) {
        if (error?.name === 'AbortError') {
            throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
};

const VIDEO_UPLOAD_START_TIMEOUT_MS = 15000;
const VIDEO_UPLOAD_BYTES_TIMEOUT_MS = 60000;
const VIDEO_PROCESSING_TIMEOUT_MS = 120000;
const VIDEO_STATUS_POLL_INTERVAL_MS = 2000;
const VIDEO_ANALYSIS_TIMEOUT_MS = 120000;

const VIDEO_UPLOAD_CACHE_TTL_MS = 30 * 60 * 1000;
const videoUploadCache = new Map<string, { fileUri: string; mimeType: string; createdAt: number }>();

const getVideoCacheEntry = (key: string) => {
    const cached = videoUploadCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.createdAt > VIDEO_UPLOAD_CACHE_TTL_MS) {
        videoUploadCache.delete(key);
        return null;
    }
    return cached;
};

const setVideoCacheEntry = (key: string, fileUri: string, mimeType: string) => {
    videoUploadCache.set(key, { fileUri, mimeType, createdAt: Date.now() });
};

const buildVideoCacheKey = (file: File) => `file:${file.name}:${file.size}:${file.lastModified}`;

const getAiClient = () => {
    // Check process.env first (for web dev), then LocalStorage (for desktop/user key)
    const envKey = process.env.API_KEY;
    const storageKey = localStorage.getItem('gemini_api_key');

    const apiKey = envKey || storageKey;

    if (!apiKey) {
        throw new Error("API Key is missing. Please enter your Google Gemini API Key in the settings.");
    }
    return new GoogleGenAI({ apiKey });
};

const shouldUseReplicateForGoogleModels = () => getGoogleModelProvider() === 'replicate';
const GEMINI_NANO_BANANA_2_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';
const GEMINI_3_PRO_IMAGE_MODEL = 'gemini-3-pro-image-preview';
const GEMINI_TEXT_MODEL_PRO = 'gemini-3.1-pro-preview';
const GEMINI_TEXT_MODEL_FLASH = 'gemini-3.1-flash-preview';
type StoryboardAspectRatio = '16:9' | '9:16' | '4:3' | '3:4' | '1:1' | '2.39:1' | '235:100' | '239:100';

const isCinemascopeStoryboardRatio = (aspectRatio: StoryboardAspectRatio) =>
    aspectRatio === '2.39:1' || aspectRatio === '235:100' || aspectRatio === '239:100';

const buildStoryboardAspectRatioGuidance = (aspectRatio: StoryboardAspectRatio) => {
    if (aspectRatio === '9:16') {
        return `**Aspect Ratio Strategy: 9:16 Vertical**
        - Compose for a native vertical frame, never like a cropped widescreen shot.
        - Prefer 40mm-70mm lensing; avoid 24mm or wider unless the script explicitly requires distortion.
        - Keep the main subject centered on the X-axis, with eyeline or head position near the upper third and minimal dead headroom.
        - Anchor horizon lines and grounding elements toward the lower third.
        - Build depth vertically from bottom to top with stacked foreground, midground, and background layers.
        - Favor full-body singles, vertically isolated closeups, tall props, mirrors, doorways, stairwells, ceilings, and height-emphasizing environments.
        - Favor top-to-bottom or bottom-to-top movement, smooth gimbal tracking, and deliberate vertical blocking; avoid fast horizontal pans and awkward seated two-shots that clip limbs or faces.
        - Keep critical action, faces, and any text-safe areas inside the centered safe zone so the result still reads well in 4:5 feed previews and under mobile UI overlays.`;
    }

    if (isCinemascopeStoryboardRatio(aspectRatio)) {
        return `**Aspect Ratio Strategy: 2.39 Cinemascope**
        - Compose for width, lateral blocking, and panoramic environmental storytelling.
        - Use the horizontal span intentionally with asymmetrical balance, edge tension, and layered left-to-right foreground/midground/background separation.
        - Favor widescreen staging, side-to-side character interplay, traveling motion, and horizon-driven compositions.
        - Let negative space sit on the sides of frame instead of above the subject.
        - Lean into anamorphic or widescreen language when appropriate: broad vistas, silhouette separation, environmental context, and controlled horizontal movement.`;
    }

    return `**Aspect Ratio Strategy: ${aspectRatio}**
        - Compose intentionally for this frame shape rather than assuming a default widescreen layout.`;
};

const extractJsonFromText = (text: string): string => {
    const trimmed = text.trim();
    if (trimmed.startsWith('```')) {
        const fenced = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
        if (fenced) return fenced;
    }
    const firstObject = trimmed.indexOf('{');
    const firstArray = trimmed.indexOf('[');
    const startCandidates = [firstObject, firstArray].filter((idx) => idx >= 0);
    if (startCandidates.length === 0) return trimmed;
    const start = Math.min(...startCandidates);
    const lastObject = trimmed.lastIndexOf('}');
    const lastArray = trimmed.lastIndexOf(']');
    const endCandidates = [lastObject, lastArray].filter((idx) => idx >= 0);
    const end = Math.max(...endCandidates);
    if (end > start) {
        return trimmed.slice(start, end + 1).trim();
    }
    return trimmed;
};

const parseJsonFromText = <T>(text: string, label: string): T => {
    try {
        return JSON.parse(text.trim()) as T;
    } catch (error) {
        const extracted = extractJsonFromText(text);
        try {
            return JSON.parse(extracted) as T;
        } catch (innerError) {
            console.error(`${label} JSON parse failed. Raw:`, text);
            throw innerError;
        }
    }
};

const isHighDemandModelError = (error: unknown) => {
    const message = String((error as any)?.message || error || '');
    return /UNAVAILABLE|503|high demand|overloaded|RESOURCE_EXHAUSTED|temporarily unavailable/i.test(message);
};

const isModelNotFoundError = (error: unknown) => {
    const message = String((error as any)?.message || error || '');
    return /404|NOT_FOUND|model.*not found|is not supported for generateContent/i.test(message);
};

export const matchConceptReferencesForShots = async (payload: {
    shots: Array<{ shot: number; description: string; prompt: string }>;
    references: ReferenceItem[];
}): Promise<{
    shots: Array<{
        shot: number;
        characterIds: string[];
        environmentId: string | null;
        productIds: string[];
        propIds: string[];
    }>;
}> => {
    const shotSummaries = payload.shots.map((shot) => ({
        shot: shot.shot,
        description: shot.description?.slice(0, 400) || '',
        prompt: shot.prompt?.slice(0, 400) || '',
    }));
    const referenceSummaries = payload.references.map((ref) => ({
        id: ref.id,
        type: ref.type,
        name: ref.name,
        description: ref.description?.slice(0, 200) || '',
        tags: (ref.tags || []).slice(0, 6),
    }));

    const content = `You are a strict production assistant. Match concept references to storyboard shots.
RULES:
1. Use ONLY the reference IDs provided. Do NOT invent new references.
2. **Match characters ONLY if they are EXPLICITLY NAMED** in the shot description or prompt.
   - Do NOT infer presence. If a shot says "A village wakes up", DO NOT add 'Kael' or 'Ashanti' even if they live there.
   - If a shot says "A crowd gathers", DO NOT list specific characters unless named.
   - Using a reference for "Landscape" creates an environment match, NOT character matches.
3. **Match environments** if the shot clearly takes place in that location.
4. **Return empty arrays** if no specific references match. Do not guess.

Return JSON only with the schema:
{"shots":[{"shot":1,"characterIds":["ref_id"],"environmentId":"ref_id_or_null","productIds":["ref_id"],"propIds":["ref_id"]}]}

References:
${JSON.stringify(referenceSummaries)}

Shots:
${JSON.stringify(shotSummaries)}
`;

    if (shouldUseReplicateForGoogleModels()) {
        const text = await generateTextWithGemini3ProReplicate(content, {
            systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
        });
        const parsed = parseJsonFromText<{
            shots: Array<{
                shot: number;
                characterIds: string[];
                environmentId: string | null;
                productIds: string[];
                propIds: string[];
            }>;
        }>(text, 'MatchConceptRefs');

        // Validate and filter out any hallucinated reference IDs
        const validIds = new Set(payload.references.map(ref => ref.id));
        const filterIds = (ids: string[]) => ids.filter(id => validIds.has(id));
        const validateEnvId = (id: string | null) => id && validIds.has(id) ? id : null;

        return {
            shots: parsed.shots.map(shot => ({
                ...shot,
                characterIds: filterIds(shot.characterIds || []),
                environmentId: validateEnvId(shot.environmentId),
                productIds: filterIds(shot.productIds || []),
                propIds: filterIds(shot.propIds || []),
            })),
        };
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_PRO,
        contents: content,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    shots: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                shot: { type: Type.NUMBER },
                                characterIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                                environmentId: { type: Type.STRING, nullable: true },
                                productIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                                propIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                            },
                            required: ["shot", "characterIds", "environmentId", "productIds", "propIds"],
                        },
                    },
                },
                required: ["shots"],
            },
        },
    }));

    const jsonStr = response.text.trim();
    const parsed = JSON.parse(jsonStr) as {
        shots: Array<{
            shot: number;
            characterIds: string[];
            environmentId: string | null;
            productIds: string[];
            propIds: string[];
        }>;
    };

    // Validate and filter out any hallucinated reference IDs
    const validIds = new Set(payload.references.map(ref => ref.id));
    const filterIds = (ids: string[]) => ids.filter(id => validIds.has(id));
    const validateEnvId = (id: string | null) => id && validIds.has(id) ? id : null;

    return {
        shots: parsed.shots.map(shot => ({
            ...shot,
            characterIds: filterIds(shot.characterIds || []),
            environmentId: validateEnvId(shot.environmentId),
            productIds: filterIds(shot.productIds || []),
            propIds: filterIds(shot.propIds || []),
        })),
    };
};

export type SetDesignCopilotAction = {
    type: string;
    mode?: 'translate' | 'rotate' | 'scale';
    primitive?: 'box' | 'sphere' | 'plane';
    name?: string;
    id?: string;
    match?: string;
    lightType?: 'ambient' | 'directional' | 'point';
    color?: string;
    intensity?: number;
    position?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number };
    scale?: { x: number; y: number; z: number };
    target?: { x: number; y: number; z: number };
    fov?: number;
    enabled?: boolean;
    size?: number;
    divisions?: number;
    snapEnabled?: boolean;
    snap?: number;
    text?: string;
};

export const interpretSetDesignCommand = async (payload: {
    instruction: string;
    sceneSummary: string;
}): Promise<{ reply: string; actions: SetDesignCopilotAction[] }> => {
    const content = `You are a 3D set design copilot. Convert the user instruction into actions.
Rules:
- Use only ids/names that exist in the Scene Summary. Never invent references.
- If the request is ambiguous, ask a clarification question and return empty actions.
- Return JSON only: {"reply":"...","actions":[...]}.

Scene Summary:
${payload.sceneSummary}

User Instruction:
${payload.instruction}
`;

    if (shouldUseReplicateForGoogleModels()) {
        const text = await generateTextWithGemini3ProReplicate(content, {
            systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
        });
        return parseJsonFromText<{ reply: string; actions: SetDesignCopilotAction[] }>(text, 'SetDesignCopilot');
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_PRO,
        contents: content,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    reply: { type: Type.STRING },
                    actions: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                type: { type: Type.STRING },
                                mode: { type: Type.STRING },
                                primitive: { type: Type.STRING },
                                name: { type: Type.STRING },
                                id: { type: Type.STRING },
                                match: { type: Type.STRING },
                                lightType: { type: Type.STRING },
                                color: { type: Type.STRING },
                                intensity: { type: Type.NUMBER },
                                position: {
                                    type: Type.OBJECT,
                                    properties: {
                                        x: { type: Type.NUMBER },
                                        y: { type: Type.NUMBER },
                                        z: { type: Type.NUMBER },
                                    },
                                },
                                rotation: {
                                    type: Type.OBJECT,
                                    properties: {
                                        x: { type: Type.NUMBER },
                                        y: { type: Type.NUMBER },
                                        z: { type: Type.NUMBER },
                                    },
                                },
                                scale: {
                                    type: Type.OBJECT,
                                    properties: {
                                        x: { type: Type.NUMBER },
                                        y: { type: Type.NUMBER },
                                        z: { type: Type.NUMBER },
                                    },
                                },
                                target: {
                                    type: Type.OBJECT,
                                    properties: {
                                        x: { type: Type.NUMBER },
                                        y: { type: Type.NUMBER },
                                        z: { type: Type.NUMBER },
                                    },
                                },
                                fov: { type: Type.NUMBER },
                                enabled: { type: Type.BOOLEAN },
                                size: { type: Type.NUMBER },
                                divisions: { type: Type.NUMBER },
                                snapEnabled: { type: Type.BOOLEAN },
                                snap: { type: Type.NUMBER },
                                text: { type: Type.STRING },
                            },
                            required: ["type"],
                        },
                    },
                },
                required: ["reply", "actions"],
            },
        },
    }));

    const jsonStr = response.text.trim();
    return JSON.parse(jsonStr) as { reply: string; actions: SetDesignCopilotAction[] };
};

// ... (Rest of the file remains exactly the same as previous version)
export const generateVideoWithVeo = async (
    prompt: string,
    onProgress: (message: string) => void,
    aspectRatio: '16:9' | '9:16',
    referenceImage?: { base64: string; mimeType: string; },
    model: string = 'veo-3.1-fast-generate-preview'
): Promise<MediaItem> => {
    if (shouldUseReplicateForGoogleModels()) {
        return generateVideoWithVeoReplicate(prompt, aspectRatio, model, referenceImage, onProgress);
    }
    onProgress(`Initializing video generation (${model})...`);
    const ai = getAiClient();

    const requestPayload: any = {
        model: model,
        prompt,
        config: {
            numberOfVideos: 1,
            resolution: '720p',
            aspectRatio,
        }
    };

    if (referenceImage) {
        onProgress("Preparing image-to-video reference...");
        requestPayload.image = {
            imageBytes: referenceImage.base64,
            mimeType: referenceImage.mimeType,
        }
    }

    let operation: Operation<any> = await withRetry(() => ai.models.generateVideos(requestPayload));

    onProgress("Video generation started. This may take a few minutes...");
    let checks = 0;
    while (!operation.done) {
        checks++;
        const progressMessages = [
            "Warming up the digital canvas...",
            "Teaching pixels to dance...",
            "Composing a symphony of light and sound...",
            "Rendering dreams into reality frame by frame...",
            "Almost there, adding the final touches of magic...",
        ];
        const messageIndex = Math.min(checks, progressMessages.length - 1);
        onProgress(`Polling for results... (${progressMessages[messageIndex]})`);

        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    if (operation.error) {
        throw new Error(`Video generation failed: ${operation.error.message}`);
    }

    onProgress("Fetching generated video...");
    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;

    if (!downloadLink) {
        throw new Error("Could not retrieve video download link.");
    }

    // Note: For Veo, we might need the key in the fetch URL if strictly using REST,
    // but the SDK usually handles this. If raw fetch is needed:
    const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
    const response = await fetch(`${downloadLink}&key=${apiKey}`);

    if (!response.ok) {
        throw new Error("Failed to download the generated video.");
    }
    const videoBlob = await response.blob();
    const videoUrl = URL.createObjectURL(videoBlob);

    let duration: number | undefined;
    try {
        duration = await getVideoDuration(videoUrl);
    } catch (e) {
        console.error("Could not get duration of generated video", e);
        duration = 5; // Fallback duration
    }

    recordUsage({
        provider: 'gemini',
        model,
        kind: 'video',
        units: duration || 5,
        unitLabel: 'second',
        note: 'Veo video generation',
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

export const generateImageWithNano = async (
    prompt: string,
    config?: { aspectRatio?: string; imageSize?: string }
): Promise<MediaItem> => {
    if (shouldUseReplicateForGoogleModels()) {
        return generateImageWithGemini3ProReplicate(
            prompt,
            config?.aspectRatio || '16:9',
            config?.imageSize || '1K'
        );
    }
    const ai = getAiClient();
    const model = GEMINI_NANO_BANANA_2_IMAGE_MODEL;
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model,
        contents: {
            parts: [{ text: prompt }],
        },
        config: {
            responseModalities: [Modality.TEXT, Modality.IMAGE],
            imageConfig: {
                aspectRatio: config?.aspectRatio || '1:1',
                imageSize: config?.imageSize || '1K',
            },
        },
    }));

    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
            if (part.inlineData) {
                const base64ImageBytes: string = part.inlineData.data;
                const imageUrl = `data:${part.inlineData.mimeType};base64,${base64ImageBytes}`;
                const item: MediaItem = {
                    id: `nano-${Date.now()}`,
                    name: `nano_image_${prompt.slice(0, 15)}.png`,
                    type: 'image',
                    url: imageUrl,
                    source: 'generated'
                };
                recordUsage({
                    provider: 'gemini',
                    model,
                    kind: 'image',
                    units: 1,
                    unitLabel: 'image',
                    note: 'Nano Banana 2 image generation',
                });
                return item;
            }
        }
    }

    console.error("Image generation (Nano) failed. Full API response:", JSON.stringify(response, null, 2));
    throw new Error("Image generation failed.");
};

export const generateImageWithGemini3Pro = async (prompt: string, aspectRatio: string, imageSize: string): Promise<MediaItem> => {
    if (shouldUseReplicateForGoogleModels()) {
        return generateImageWithGemini3ProReplicate(prompt, aspectRatio, imageSize);
    }
    const ai = getAiClient();
    const model = GEMINI_3_PRO_IMAGE_MODEL;
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model,
        contents: {
            parts: [{ text: prompt }],
        },
        config: {
            imageConfig: {
                aspectRatio: aspectRatio,
                imageSize: imageSize
            },
        },
    }));

    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
            if (part.inlineData) {
                const base64ImageBytes: string = part.inlineData.data;
                const imageUrl = `data:${part.inlineData.mimeType};base64,${base64ImageBytes}`;
                const item: MediaItem = {
                    id: `gemini-pro-${Date.now()}`,
                    name: `pro_image_${prompt.slice(0, 15)}.png`,
                    type: 'image',
                    url: imageUrl,
                    source: 'generated'
                };
                recordUsage({
                    provider: 'gemini',
                    model,
                    kind: 'image',
                    units: 1,
                    unitLabel: 'image',
                    note: 'Gemini 3 Pro image generation',
                });
                return item;
            }
        }
    }

    console.error("Image generation (Gemini 3 Pro) failed.", JSON.stringify(response, null, 2));
    throw new Error("Image generation failed.");
};

export const generateImageWithImagen = async (prompt: string, aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'): Promise<MediaItem> => {
    if (shouldUseReplicateForGoogleModels()) {
        throw new Error('Imagen is only available via Gemini. Switch Google models to Gemini in settings.');
    }
    const ai = getAiClient();
    const response: GenerateImagesResponse = await withRetry(() => ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: prompt,
        config: {
            numberOfImages: 1,
            outputMimeType: 'image/jpeg',
            aspectRatio,
        },
    }));

    const base64ImageBytes: string | undefined = response.generatedImages?.[0]?.image?.imageBytes;
    if (!base64ImageBytes) {
        throw new Error("Imagen generation failed.");
    }
    const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
    const item: MediaItem = {
        id: `imagen-${Date.now()}`,
        name: `imagen_${prompt.slice(0, 15)}.jpg`,
        type: 'image',
        url: imageUrl,
        source: 'generated',
    };
    recordUsage({
        provider: 'gemini',
        model: 'imagen-4.0-generate-001',
        kind: 'image',
        units: 1,
        unitLabel: 'image',
        note: 'Imagen generation',
    });
    return item;
};

const getApiKey = () => {
    const envKey = process.env.API_KEY;
    const storageKey = localStorage.getItem('gemini_api_key');
    const apiKey = envKey || storageKey;

    if (!apiKey) {
        throw new Error("API Key is missing. Please enter your Google Gemini API Key in the settings.");
    }
    return apiKey;
};

const uploadFileToGemini = async (file: File): Promise<string> => {
    const apiKey = getApiKey();

    // 1. Start Resumable Upload
    const startUploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;
    const startResponse = await fetchWithTimeout(startUploadUrl, {
        method: 'POST',
        headers: {
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': file.size.toString(),
            'X-Goog-Upload-Header-Content-Type': file.type,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { display_name: file.name } })
    }, VIDEO_UPLOAD_START_TIMEOUT_MS, 'Upload initialization');

    if (!startResponse.ok) throw new Error(`Failed to initiate upload: ${startResponse.statusText}`);

    const uploadUrl = startResponse.headers.get('X-Goog-Upload-URL');
    if (!uploadUrl) throw new Error("Failed to get upload URL");

    // 2. Upload Bytes
    const uploadResponse = await fetchWithTimeout(uploadUrl, {
        method: 'POST',
        headers: {
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'upload, finalize',
            'X-Goog-Upload-Offset': '0',
            'Content-Type': file.type,
        },
        body: file
    }, VIDEO_UPLOAD_BYTES_TIMEOUT_MS, 'Video upload');

    if (!uploadResponse.ok) throw new Error(`Failed to upload bytes: ${uploadResponse.statusText}`);

    const uploadResult = await uploadResponse.json();
    const fileUri = uploadResult.file.uri;
    const fileName = uploadResult.file.name;

    // 3. Wait for Active
    console.log(`File uploaded: ${fileUri}. Waiting for processing...`);
    let state = uploadResult.file.state;
    const processingStart = Date.now();
    while (state === 'PROCESSING') {
        if (Date.now() - processingStart > VIDEO_PROCESSING_TIMEOUT_MS) {
            throw new Error("Video processing timed out. Try Quick Scan or a shorter clip.");
        }
        await new Promise(r => setTimeout(r, VIDEO_STATUS_POLL_INTERVAL_MS));
        const checkUrl = `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`;
        const checkResponse = await fetchWithTimeout(checkUrl, {
            method: 'GET'
        }, 15000, 'Video processing status');
        if (!checkResponse.ok) {
            throw new Error(`Failed to check processing status: ${checkResponse.statusText}`);
        }
        const checkResult = await checkResponse.json();
        state = checkResult.state;
        if (state === 'FAILED') throw new Error("Video processing failed on Gemini side.");
    }
    console.log(`File processing complete. State: ${state}`);

    return fileUri;
};

const fileUrlToPath = (url: string) => {
    let filePath = decodeURIComponent(url.replace('file://', ''));
    if (/^\/[A-Za-z]:/.test(filePath)) {
        filePath = filePath.slice(1);
    }
    return filePath;
};

const inferVideoMimeTypeFromName = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.endsWith('.mov')) return 'video/quicktime';
    if (lower.endsWith('.webm')) return 'video/webm';
    if (lower.endsWith('.m4v')) return 'video/x-m4v';
    return 'video/mp4';
};

export const prepareVideoFileDataForGemini = async (
    video: File | string,
): Promise<{ fileUri: string; mimeType: string }> => {
    let fileUri: string;
    let mimeType = 'video/mp4';

    if (video instanceof File) {
        if (video.size === 0) {
            throw new Error('The selected video file is empty (0 bytes).');
        }
        const cacheKey = buildVideoCacheKey(video);
        const cached = getVideoCacheEntry(cacheKey);
        if (cached) {
            return {
                fileUri: cached.fileUri,
                mimeType: cached.mimeType,
            };
        }

        fileUri = await uploadFileToGemini(video);
        mimeType = video.type || 'video/mp4';
        setVideoCacheEntry(cacheKey, fileUri, mimeType);
        return { fileUri, mimeType };
    }

    try {
        const cacheKey = `url:${video}`;
        const cached = getVideoCacheEntry(cacheKey);
        if (cached) {
            return {
                fileUri: cached.fileUri,
                mimeType: cached.mimeType,
            };
        }

        if (video.startsWith('file://') && window.electron?.project?.readFile) {
            const filePath = fileUrlToPath(video);
            const bytes = await window.electron.project.readFile({ filePath });
            const fileName = filePath.split(/[\\/]/).pop() || 'video.mp4';
            const normalizedBytes = new Uint8Array(bytes.byteLength);
            normalizedBytes.set(bytes);
            const file = new File([normalizedBytes.buffer as ArrayBuffer], fileName, { type: inferVideoMimeTypeFromName(fileName) });
            if (file.size === 0) {
                throw new Error('Desktop video proxy is empty.');
            }
            fileUri = await uploadFileToGemini(file);
            mimeType = file.type || 'video/mp4';
            setVideoCacheEntry(cacheKey, fileUri, mimeType);
            return { fileUri, mimeType };
        }

        const response = await fetch(video);
        const blob = await response.blob();
        if (blob.size === 0) throw new Error('Fetched video blob is empty.');
        const file = new File([blob], 'video.mp4', { type: blob.type || 'video/mp4' });
        fileUri = await uploadFileToGemini(file);
        mimeType = blob.type || 'video/mp4';
        setVideoCacheEntry(cacheKey, fileUri, mimeType);
        return { fileUri, mimeType };
    } catch (e) {
        throw new Error(`Failed to fetch/upload video from URL: ${(e as Error).message}`);
    }
};

export const analyzeFramesWithNeurocinematics = async (
    frames: Array<{ base64: string; mimeType: string; timestamp: string }>,
    scriptText?: string,
    modelId: string = GEMINI_TEXT_MODEL_FLASH
): Promise<NeurocinematicsAnalysisResult> => {
    if (frames.length === 0) {
        throw new Error("No frames provided for analysis.");
    }
    const ai = getAiClient();

    const prompt = `
    You are a Neurocinematics Expert and Cognitive Film Analyst.
    You will receive a series of still frames sampled from a video with timestamps.
    Analyze the frames using scientific and logical principles of filmmaking,
    with special attention to AI filmmaking workflows. If motion or sound cues are ambiguous,
    infer cautiously and state assumptions. Emphasize that this is frame-based analysis.

    **Principles to Apply (explicitly reference these in feedback):**
    1. **Mirror Neurons (Neurocinematics):** Embodiment, proximity, and empathy cues.
    2. **Event Segmentation Theory:** Cuts and perceptual boundaries.
    3. **Kuleshov Effect (Context Logic):** Meaning from juxtaposition.
    4. **Cognitive Psychology:** Schemas, prediction error, cognitive load, visual hierarchy, gaze control.
    5. **Deliberate Practice (Learning Science):** Fast feedback loops and targeted iteration with AI.
    6. **Psychoacoustics:** Emotional impact of sound (note limitations for still frames).

    ${scriptText ? `**Script Context:**\n${scriptText.substring(0, 2000)}\n` : ''}

    Return a JSON object with this structure:
    {
        "analysisProcess": "Multi-paragraph explanation with headings (e.g., Visual Sampling, Audio & Transcript, Temporal Understanding, Cinematic Knowledge Base, Summary). Reference specific cues from the video; note limitations where applicable.",
        "overallFeedback": {
            "neurocinematics": "...",
            "kuleshovEffect": "...",
            "cognitivePsychology": "...",
            "soundDesign": "...",
            "deliberatePractice": "..."
        },
        "scenes": [
            {
                "id": "1",
                "timestamp": "MM:SS",
                "description": "Brief scene description",
                "visualFeedback": "Critique on lighting, composition, gaze control",
                "soundFeedback": "Critique on audio cues and emotion (note assumptions)",
                "scientificPrinciple": "Primary principle focus for this scene",
                "mirrorNeurons": "Embodiment/empathetic cues assessment",
                "eventSegmentation": "Cut timing vs perceptual boundaries",
                "kuleshovEffect": "Meaning from juxtaposition/context",
                "cognitivePsychology": "Schemas, prediction error, cognitive load, gaze",
                "psychoacoustics": "Emotional impact of sound",
                "deliberatePractice": "Fast iteration/feedback loop suggestion",
                "improvementSuggestion": "Actionable advice to fix/enhance"
            }
        ]
    }
    `;

    const parts: any[] = [{ text: prompt }];
    frames.forEach((frame, index) => {
        parts.push({ text: `Frame ${index + 1} @ ${frame.timestamp}` });
        parts.push({ inlineData: { data: frame.base64, mimeType: frame.mimeType } });
    });

    const result: GenerateContentResponse = await withTimeout(withRetry(() => ai.models.generateContent({
        model: modelId,
        contents: {
            parts: parts
        },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    analysisProcess: { type: Type.STRING },
                    overallFeedback: {
                        type: Type.OBJECT,
                        properties: {
                            neurocinematics: { type: Type.STRING },
                            kuleshovEffect: { type: Type.STRING },
                            cognitivePsychology: { type: Type.STRING },
                            soundDesign: { type: Type.STRING },
                            deliberatePractice: { type: Type.STRING }
                        },
                        required: ["neurocinematics", "kuleshovEffect", "cognitivePsychology", "soundDesign", "deliberatePractice"]
                    },
                    scenes: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                id: { type: Type.STRING },
                                timestamp: { type: Type.STRING },
                                description: { type: Type.STRING },
                                visualFeedback: { type: Type.STRING },
                                soundFeedback: { type: Type.STRING },
                                scientificPrinciple: { type: Type.STRING },
                                mirrorNeurons: { type: Type.STRING },
                                eventSegmentation: { type: Type.STRING },
                                kuleshovEffect: { type: Type.STRING },
                                cognitivePsychology: { type: Type.STRING },
                                psychoacoustics: { type: Type.STRING },
                                deliberatePractice: { type: Type.STRING },
                                improvementSuggestion: { type: Type.STRING }
                            },
                            required: [
                                "id",
                                "timestamp",
                                "description",
                                "visualFeedback",
                                "soundFeedback",
                                "scientificPrinciple",
                                "mirrorNeurons",
                                "eventSegmentation",
                                "kuleshovEffect",
                                "cognitivePsychology",
                                "psychoacoustics",
                                "deliberatePractice",
                                "improvementSuggestion"
                            ]
                        }
                    }
                },
                required: ["analysisProcess", "overallFeedback", "scenes"]
            }
        }
    })), VIDEO_ANALYSIS_TIMEOUT_MS, 'Frame analysis');

    try {
        return JSON.parse(result.text.trim());
    } catch (e) {
        throw new Error("Failed to parse neurocinematics analysis.");
    }
};

export const analyzeAudioPsychoacoustics = async (
    audio: { base64: string; mimeType: string },
    scriptText?: string,
    modelId: string = GEMINI_TEXT_MODEL_FLASH
): Promise<AudioPsychoacousticsResult> => {
    const ai = getAiClient();
    const prompt = `
    You are a sound designer and psychoacoustics analyst.
    Analyze the provided audio for emotional impact, clarity, pacing, mix balance, and cognitive load.
    Segment the audio into meaningful time ranges where the emotional or sonic profile changes.
    Provide actionable, production-ready improvement suggestions.

    ${scriptText ? `**Script Context:**\n${scriptText.substring(0, 2000)}\n` : ''}

    Return a JSON object with this structure:
    {
        "overall": "...",
        "psychoacoustics": "...",
        "mixNotes": "...",
        "emotionalArc": "...",
        "issues": ["..."],
        "suggestions": ["..."],
        "segments": [
            {
                "timestamp": "MM:SS - MM:SS",
                "observation": "...",
                "improvementSuggestion": "..."
            }
        ]
    }
    `;

    const result: GenerateContentResponse = await withTimeout(withRetry(() => ai.models.generateContent({
        model: modelId,
        contents: {
            parts: [
                { text: prompt },
                { inlineData: { data: audio.base64, mimeType: audio.mimeType } }
            ]
        },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    overall: { type: Type.STRING },
                    psychoacoustics: { type: Type.STRING },
                    mixNotes: { type: Type.STRING },
                    emotionalArc: { type: Type.STRING },
                    issues: { type: Type.ARRAY, items: { type: Type.STRING } },
                    suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
                    segments: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                timestamp: { type: Type.STRING },
                                observation: { type: Type.STRING },
                                improvementSuggestion: { type: Type.STRING }
                            },
                            required: ["timestamp", "observation", "improvementSuggestion"]
                        }
                    }
                },
                required: ["overall", "psychoacoustics", "mixNotes", "emotionalArc", "issues", "suggestions", "segments"]
            }
        }
    })), VIDEO_ANALYSIS_TIMEOUT_MS, 'Audio analysis');

    try {
        return JSON.parse(result.text.trim());
    } catch (e) {
        throw new Error("Failed to parse audio psychoacoustics analysis.");
    }
};

export const analyzeVideoWithNeurocinematics = async (
    video: File | string,
    scriptText?: string,
    focusRange?: string,
    modelId: string = GEMINI_TEXT_MODEL_FLASH
): Promise<NeurocinematicsAnalysisResult> => {
    const ai = getAiClient();
    const { fileUri, mimeType } = await prepareVideoFileDataForGemini(video);

    const prompt = `
    You are a Neurocinematics Expert and Cognitive Film Analyst.
    Analyze the provided video (and optional script context) using scientific and logical principles of filmmaking,
    with special attention to AI filmmaking workflows.

    **Principles to Apply (explicitly reference these in feedback):**
    1. **Mirror Neurons (Neurocinematics):** Embodied staging, camera proximity, and sound that make actions feel physical and empathetic.
    2. **Event Segmentation Theory:** Cuts should align with natural perceptual boundaries ("invisible cut" effect).
    3. **Kuleshov Effect (Context Logic):** Meaning emerges from juxtaposition; clip relationships matter more than isolated shots.
    4. **Cognitive Psychology:** Schemas, prediction error, cognitive load, visual hierarchy, and gaze control.
    5. **Deliberate Practice (Learning Science):** Fast feedback loops and targeted iterations; suggest how to test improvements quickly with AI.
    6. **Psychoacoustics:** Sound is processed faster than vision and is tightly linked to emotion.

    ${scriptText ? `**Script Context:**\n${scriptText.substring(0, 2000)}\n` : ''}
    ${focusRange ? `**Focus Range:** ${focusRange}\nPrioritize analysis within this time window, but note any critical context outside it if needed.\n` : ''}

    Return a JSON object with this structure:
    {
        "analysisProcess": "Multi-paragraph explanation with headings (e.g., Visual Sampling, Audio & Transcript, Temporal Understanding, Cinematic Knowledge Base, Summary). Reference specific cues from the video.",
        "overallFeedback": {
            "neurocinematics": "...",
            "kuleshovEffect": "...",
            "cognitivePsychology": "...",
            "soundDesign": "...",
            "deliberatePractice": "..."
        },
        "scenes": [
            {
                "id": "1",
                "timestamp": "MM:SS",
                "description": "Brief scene description",
                "visualFeedback": "Critique on lighting, composition, gaze control",
                "soundFeedback": "Critique on audio cues and emotion",
                "scientificPrinciple": "Primary principle focus for this scene",
                "mirrorNeurons": "Embodiment/empathetic cues assessment",
                "eventSegmentation": "Cut timing vs perceptual boundaries",
                "kuleshovEffect": "Meaning from juxtaposition/context",
                "cognitivePsychology": "Schemas, prediction error, cognitive load, gaze",
                "psychoacoustics": "Emotional impact of sound",
                "deliberatePractice": "Fast iteration/feedback loop suggestion",
                "improvementSuggestion": "Actionable advice to fix/enhance"
            }
        ]
    }
    `;

    const result: GenerateContentResponse = await withTimeout(withRetry(() => ai.models.generateContent({
        model: modelId,
        contents: {
            parts: [
                { text: prompt },
                { fileData: { fileUri: fileUri, mimeType: mimeType } }
            ]
        },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    analysisProcess: { type: Type.STRING },
                    overallFeedback: {
                        type: Type.OBJECT,
                        properties: {
                            neurocinematics: { type: Type.STRING },
                            kuleshovEffect: { type: Type.STRING },
                            cognitivePsychology: { type: Type.STRING },
                            soundDesign: { type: Type.STRING },
                            deliberatePractice: { type: Type.STRING }
                        },
                        required: ["neurocinematics", "kuleshovEffect", "cognitivePsychology", "soundDesign", "deliberatePractice"]
                    },
                    scenes: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                id: { type: Type.STRING },
                                timestamp: { type: Type.STRING },
                                description: { type: Type.STRING },
                                visualFeedback: { type: Type.STRING },
                                soundFeedback: { type: Type.STRING },
                                scientificPrinciple: { type: Type.STRING },
                                mirrorNeurons: { type: Type.STRING },
                                eventSegmentation: { type: Type.STRING },
                                kuleshovEffect: { type: Type.STRING },
                                cognitivePsychology: { type: Type.STRING },
                                psychoacoustics: { type: Type.STRING },
                                deliberatePractice: { type: Type.STRING },
                                improvementSuggestion: { type: Type.STRING }
                            },
                            required: [
                                "id",
                                "timestamp",
                                "description",
                                "visualFeedback",
                                "soundFeedback",
                                "scientificPrinciple",
                                "mirrorNeurons",
                                "eventSegmentation",
                                "kuleshovEffect",
                                "cognitivePsychology",
                                "psychoacoustics",
                                "deliberatePractice",
                                "improvementSuggestion"
                            ]
                        }
                    }
                },
                required: ["analysisProcess", "overallFeedback", "scenes"]
            }
        }
    })), VIDEO_ANALYSIS_TIMEOUT_MS, 'Video analysis');

    try {
        return JSON.parse(result.text.trim());
    } catch (e) {
        throw new Error("Failed to parse neurocinematics analysis.");
    }
};

export const editImage = async (prompt: string, image: { base64: string; mimeType: string }, referenceImage?: { base64: string; mimeType: string }): Promise<MediaItem> => {
    const ai = getAiClient();
    const model = GEMINI_NANO_BANANA_2_IMAGE_MODEL;
    const parts: any[] = [
        { inlineData: { data: image.base64, mimeType: image.mimeType } },
        { text: prompt },
    ];

    if (referenceImage) {
        parts.push({ text: "Use the following image as a style or object reference for the edit:" });
        parts.push({ inlineData: { data: referenceImage.base64, mimeType: referenceImage.mimeType } });
    }

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model,
        contents: {
            parts: parts,
        },
        config: { responseModalities: [Modality.TEXT, Modality.IMAGE] },
    }));

    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
            if (part.inlineData) {
                const base64ImageBytes: string = part.inlineData.data;
                const imageUrl = `data:${part.inlineData.mimeType};base64,${base64ImageBytes}`;
                return {
                    id: `edit-${Date.now()}`,
                    name: `edited_${prompt.slice(0, 15)}.png`,
                    type: 'image',
                    url: imageUrl,
                    source: 'generated',
                };
            }
        }
    }
    throw new Error("Image editing failed.");
};

export const relightImageWithGemini3Pro = async (
    prompt: string,
    image: { base64: string; mimeType: string },
    aspectRatio: string = '16:9',
    imageSize: string = '2K'
): Promise<MediaItem> => {
    return generateImageWithReferences(
        prompt,
        [],
        image,
        'gemini-3-pro-image-preview',
        { aspectRatio, imageSize }
    );
};

export const analyzeImage = async (prompt: string, image: { base64: string, mimeType: string }): Promise<string> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_FLASH,
        contents: {
            parts: [
                { text: prompt },
                { inlineData: { data: image.base64, mimeType: image.mimeType } },
            ],
        },
    }));
    return response.text;
};

export const matchMoodboardImageToConcept = async (payload: {
    image: { base64: string; mimeType: string };
    references: ReferenceItem[];
    script?: string;
}): Promise<{
    referenceId: string | null;
    type: 'character' | 'environment' | 'product' | 'prop';
    name: string;
    description: string;
    confidence: number;
    tags: string[];
}> => {
    const referenceSummaries = payload.references.slice(0, 120).map((ref) => ({
        id: ref.id,
        type: ref.type,
        name: ref.name,
        description: (ref.description || '').slice(0, 220),
        hasImage: !!ref.imageUrl,
        tags: (ref.tags || []).slice(0, 8),
    }));

    const content = `Analyze this moodboard image for film preproduction.
You must either:
1) Match it to ONE existing concept reference by id, OR
2) Propose a new concept reference if no good match exists.

Rules:
- Prefer existing references when semantically close.
- For people/portraits -> type "character"
- For locations/sets -> type "environment"
- For branded object/product hero -> type "product"
- For hand props or small objects -> type "prop"
- confidence is 0-1.
- Return JSON only.

Existing references:
${JSON.stringify(referenceSummaries)}

Script context:
${(payload.script || '').slice(0, 3000) || 'n/a'}
`;

    if (shouldUseReplicateForGoogleModels()) {
        const text = await generateTextWithGemini3ProReplicate(content, {
            systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
        });
        const parsed = parseJsonFromText<{
            referenceId: string | null;
            type: 'character' | 'environment' | 'product' | 'prop';
            name: string;
            description: string;
            confidence?: number;
            tags?: string[];
        }>(text, 'MoodboardImageMatch');
        return {
            referenceId: parsed.referenceId || null,
            type: parsed.type || 'environment',
            name: (parsed.name || 'Reference').trim(),
            description: (parsed.description || '').trim(),
            confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
            tags: Array.isArray(parsed.tags) ? parsed.tags.map(tag => String(tag).trim()).filter(Boolean).slice(0, 8) : [],
        };
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_FLASH,
        contents: {
            parts: [
                { text: content },
                { inlineData: { data: payload.image.base64, mimeType: payload.image.mimeType } },
            ],
        },
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    referenceId: { type: Type.STRING },
                    type: { type: Type.STRING, enum: ['character', 'environment', 'product', 'prop'] },
                    name: { type: Type.STRING },
                    description: { type: Type.STRING },
                    confidence: { type: Type.NUMBER },
                    tags: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                    },
                },
                required: ['type', 'name', 'description'],
            },
        },
    }));

    const parsed = parseJsonFromText<{
        referenceId?: string | null;
        type?: 'character' | 'environment' | 'product' | 'prop';
        name?: string;
        description?: string;
        confidence?: number;
        tags?: string[];
    }>(response.text, 'MoodboardImageMatch');

    return {
        referenceId: parsed.referenceId || null,
        type: parsed.type || 'environment',
        name: (parsed.name || 'Reference').trim(),
        description: (parsed.description || '').trim(),
        confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
        tags: Array.isArray(parsed.tags) ? parsed.tags.map(tag => String(tag).trim()).filter(Boolean).slice(0, 8) : [],
    };
};

export const transcribeAudio = async (audio: { base64: string, mimeType: string }): Promise<string> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_FLASH,
        contents: {
            parts: [
                { text: 'Transcribe the following audio recording.' },
                { inlineData: { data: audio.base64, mimeType: audio.mimeType } },
            ]
        }
    }));
    return response.text;
};

export const transcribeVideo = async (video: File | string): Promise<string> => {
    const ai = getAiClient();
    const { fileUri, mimeType } = await prepareVideoFileDataForGemini(video);

    const response: GenerateContentResponse = await withTimeout(withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_FLASH,
        contents: {
            parts: [
                {
                    text: [
                        'Transcribe the spoken audio from this video.',
                        'Return only the transcript text.',
                        'Ignore visual description unless it clarifies speech labels.',
                        'If multiple speakers are apparent, preserve speaker changes inline in plain text.',
                    ].join(' '),
                },
                { fileData: { fileUri, mimeType } },
            ],
        },
    })), VIDEO_ANALYSIS_TIMEOUT_MS, 'Video transcription');

    return response.text.trim();
};

export const transcribeAudioWithWordTimings = async (
    audio: { base64: string, mimeType: string },
): Promise<{ transcript: string; words: SubtitleWordTiming[] }> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_FLASH,
        contents: {
            parts: [
                {
                    text: [
                        'Transcribe the following audio recording.',
                        'Return JSON with a full transcript and word-level timings.',
                        'Each word entry must contain the spoken word text and its start/end time in seconds.',
                        'Use monotonically increasing timestamps. Keep punctuation attached to the nearest spoken word.',
                    ].join(' '),
                },
                { inlineData: { data: audio.base64, mimeType: audio.mimeType } },
            ],
        },
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    transcript: { type: Type.STRING },
                    words: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                text: { type: Type.STRING },
                                start: { type: Type.NUMBER },
                                end: { type: Type.NUMBER },
                            },
                            required: ['text', 'start', 'end'],
                        },
                    },
                },
                required: ['transcript', 'words'],
            },
        },
    }));

    const parsed = parseJsonFromText<{
        transcript?: string;
        words?: Array<{ text?: string; start?: number; end?: number }>;
    }>(response.text, 'AudioWordTimingTranscript');

    const words = Array.isArray(parsed.words)
        ? parsed.words
            .map((entry) => ({
                text: String(entry.text || '').trim(),
                start: typeof entry.start === 'number' ? Math.max(0, entry.start) : 0,
                end: typeof entry.end === 'number' ? Math.max(0, entry.end) : 0,
            }))
            .filter((entry) => entry.text && entry.end >= entry.start)
            .sort((a, b) => a.start - b.start)
        : [];

    return {
        transcript: (parsed.transcript || words.map((entry) => entry.text).join(' ')).trim(),
        words,
    };
};

export const runChat = async (
    history: ChatMessage[],
    mode: 'chat' | 'search' | 'maps' | 'thinking',
    tools?: FunctionDeclaration[],
    systemInstruction?: string,
): Promise<GenerateContentResponse> => {
    const ai = getAiClient();
    const normalizeToolResponseParts = (toolResponses: any[] | undefined) => {
        if (!Array.isArray(toolResponses)) return [];
        return toolResponses
            .map((entry) => {
                if (!entry || typeof entry !== 'object') return null;
                const name = typeof entry.name === 'string' ? entry.name : '';
                if (!name) return null;
                const rawResponse = entry.response && typeof entry.response === 'object'
                    ? entry.response
                    : { result: entry.response };
                return {
                    functionResponse: {
                        id: typeof entry.id === 'string' ? entry.id : undefined,
                        name,
                        response: rawResponse,
                    },
                };
            })
            .filter(Boolean);
    };

    const normalizeToolCallParts = (toolCalls: any[] | undefined) => {
        if (!Array.isArray(toolCalls)) return [];
        return toolCalls
            .map((entry) => {
                if (!entry || typeof entry !== 'object') return null;
                if (entry.functionCall && typeof entry.functionCall === 'object') {
                    const name = typeof entry.functionCall.name === 'string' ? entry.functionCall.name : '';
                    if (!name) return null;
                    return {
                        functionCall: {
                            id: typeof entry.functionCall.id === 'string' ? entry.functionCall.id : undefined,
                            name,
                            args: entry.functionCall.args && typeof entry.functionCall.args === 'object' ? entry.functionCall.args : {},
                        },
                        thought: entry.thought === true ? true : undefined,
                        thoughtSignature: typeof entry.thoughtSignature === 'string' ? entry.thoughtSignature : undefined,
                    };
                }

                const name = typeof entry.name === 'string' ? entry.name : '';
                const thoughtSignature = typeof entry.thoughtSignature === 'string' ? entry.thoughtSignature : undefined;
                if (!name || !thoughtSignature) return null;
                return {
                    functionCall: {
                        id: typeof entry.id === 'string' ? entry.id : undefined,
                        name,
                        args: entry.args && typeof entry.args === 'object' ? entry.args : {},
                    },
                    thought: entry.thought === true ? true : undefined,
                    thoughtSignature,
                };
            })
            .filter(Boolean);
    };

    const contents: any[] = history
        .map((h) => {
            if (h.role === 'tool') {
                const parts = normalizeToolResponseParts(h.toolResponses);
                return parts.length > 0 ? { role: 'user', parts } : null;
            }
            if (h.role === 'model' && h.toolCalls) {
                const parts = normalizeToolCallParts(h.toolCalls);
                return parts.length > 0 ? { role: 'model', parts } : null;
            }
            if (typeof h.text === 'string' && h.text.trim().length > 0) {
                return { role: h.role, parts: [{ text: h.text }] };
            }
            return null;
        })
        .filter(Boolean);

    let model: string;
    let config: any = {};
    const functionTool = tools && tools.length > 0 ? [{ functionDeclarations: tools }] : [];
    if (systemInstruction) {
        config.systemInstruction = systemInstruction;
    }
    switch (mode) {
        case 'search': model = GEMINI_TEXT_MODEL_FLASH; config.tools = [{ googleSearch: {} }, ...functionTool]; break;
        case 'maps': model = GEMINI_TEXT_MODEL_FLASH; config.tools = [{ googleMaps: {} }, ...functionTool]; break;
        case 'thinking': model = GEMINI_TEXT_MODEL_PRO; config.thinkingConfig = { thinkingBudget: 32768 }; break;
        default:
            model = tools ? GEMINI_TEXT_MODEL_PRO : GEMINI_TEXT_MODEL_FLASH;
            if (functionTool.length > 0) {
                config.tools = functionTool;
            }
            break;
    }

    const response = await withRetry(() => ai.models.generateContent({ model, contents, config }));
    return response;
};

export const analyzeScriptQuality = async (script: string): Promise<ScriptQualityReport> => {
    const content = `You are a world-class Script Doctor and Story Editor.

        **Task:**
        Analyze the following script for quality, character consistency, pacing, and visual storytelling potential.

        **Required Analysis:**
        1. **Score:** Give an overall script quality score (1-100).
        2. **Character Consistency:** Analyze if characters' voices, actions, and motivations are consistent throughout. Point out contradictions.
        3. **Pacing:** Is the dialogue snappy? Are action lines clear?
        4. **Plot Holes:** Identify logical gaps.
        5. **Golden Shots:** Suggest 3-5 specific moments that would benefit from high-budget visual effects or specific camera techniques to enhance the scene.

        **Script:**
        ---
        ${script.substring(0, 15000)}
        ---
        `;

    if (shouldUseReplicateForGoogleModels()) {
        const text = await generateTextWithGemini3ProReplicate(content, {
            systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
        });
        try {
            return parseJsonFromText<ScriptQualityReport>(text, 'ScriptQualityReport');
        } catch (e) {
            throw new Error("Failed to parse script analysis report.");
        }
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_PRO,
        contents: content,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    score: { type: Type.NUMBER },
                    pacingAnalysis: { type: Type.STRING },
                    characterConsistency: { type: Type.STRING },
                    plotHoles: { type: Type.ARRAY, items: { type: Type.STRING } },
                    goldenShots: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                sceneHeader: { type: Type.STRING },
                                description: { type: Type.STRING },
                                visualEnhancement: { type: Type.STRING, description: "Specific camera or VFX suggestion" }
                            },
                            required: ["sceneHeader", "description", "visualEnhancement"]
                        }
                    },
                    dialogueNotes: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["score", "pacingAnalysis", "characterConsistency", "plotHoles", "goldenShots", "dialogueNotes"]
            }
        }
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        throw new Error("Failed to parse script analysis report.");
    }
};

export const applyScriptDoctorImprovements = async (
    script: string,
    report: ScriptQualityReport,
): Promise<ScriptDoctorImprovement> => {
    const content = `You are a world-class Script Doctor and Story Editor.

Task:
Rewrite ONLY the lines that are problematic based on the Script Doctor feedback. Keep everything else identical.

Rules:
- Keep standard screenplay format.
- Do not add new scenes unless necessary to fix a clear plot hole.
- Preserve character voice and intent.
- Return JSON only. No markdown.

Script Doctor Feedback:
${JSON.stringify(report)}

Script:
---
${script.substring(0, 15000)}
---

Output JSON schema:
{
  "revisedScript": "string (full revised script)",
  "diff": "string (unified diff of changes)",
  "summary": ["string", "string"]
}`;

    if (shouldUseReplicateForGoogleModels()) {
        const text = await generateTextWithGemini3ProReplicate(content, {
            systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
        });
        try {
            return parseJsonFromText<ScriptDoctorImprovement>(text, 'ScriptDoctorImprovement');
        } catch (e) {
            throw new Error("Failed to parse script improvements.");
        }
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_PRO,
        contents: content,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    revisedScript: { type: Type.STRING },
                    diff: { type: Type.STRING },
                    summary: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['revisedScript', 'diff', 'summary'],
            },
        },
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        throw new Error("Failed to parse script improvements.");
    }
};

export const analyzeAudioRequirements = async (
    script: string,
    timelineDescription: string,
    videoFrames?: { base64: string; mimeType: string }[]
): Promise<AudioCue[]> => {
    const ai = getAiClient();

    const parts: any[] = [
        {
            text: `You are a professional Music Supervisor and Sound Designer.

        **Task:**
        Analyze the provided Script and Visual Timeline/Footage.
        Identify exact moments where Music or Voiceover is needed.

        **Output:**
        Return a JSON array of "Audio Cues".
        Each cue must have:
        - timecode: "MM:SS" format.
        - seconds: The float value in seconds.
        - type: "music" or "voiceover" or "sfx".
        - prompt:
            - IF MUSIC: A detailed prompt optimized for Suno.ai (Genre, Instruments, Vibe, BPM, Key).
            - IF VOICEOVER: A detailed prompt optimized for ElevenLabs (Voice Description: Age, Gender, Accent, Tone, Emotion) AND the exact text to read.
        - reasoning: Why this audio fits here based on the script/visuals.

        **Context:**
        Script:
        ---
        ${script.substring(0, 10000)}
        ---

        Timeline/Edit Description:
        ---
        ${timelineDescription}
        ---
        ` }
    ];

    if (videoFrames && videoFrames.length > 0) {
        parts.push({ text: "Here are reference frames from the video edit:" });
        videoFrames.forEach(frame => {
            parts.push({ inlineData: { data: frame.base64, mimeType: frame.mimeType } });
        });
    }

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_PRO,
        contents: { parts },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        timecode: { type: Type.STRING },
                        seconds: { type: Type.NUMBER },
                        type: { type: Type.STRING, enum: ["music", "voiceover", "sfx"] },
                        title: { type: Type.STRING },
                        prompt: { type: Type.STRING },
                        reasoning: { type: Type.STRING },
                        voiceSettings: { type: Type.STRING, nullable: true },
                        lyrics: { type: Type.STRING, nullable: true }
                    },
                    required: ["timecode", "seconds", "type", "title", "prompt", "reasoning"]
                }
            }
        }
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        console.error("Failed to parse audio analysis", e);
        throw new Error("Could not generate audio cues.");
    }
};

export const analyzeScriptForReferences = async (script: string): Promise<ScriptAnalysisResult> => {
    const scriptExcerpt = script.substring(0, 10000);
    const content = `You are a film director's assistant. Analyze the script below to extract Characters, Environments, and Products (if it is a commercial).

        **Crucial Requirement: Character Identity First**
        - Return ONLY ONE entry per unique character identity.
        - Do NOT duplicate the same character by wardrobe changes (no "Anna (Casual)", "Anna (Date Night)" duplicates).
        - Put wardrobe/outfit variation notes inside the character description instead of creating extra character entries.

        **Commercial/Ads:**
        - If the script promotes a product or brand, extract it as a "Product" entry. This includes Logos, specific items (e.g., "Perfume Bottle"), or branded props.

        Script: --- ${scriptExcerpt} ---

        Return JSON only with keys "characters", "environments", and optional "products".
        Example:
        {"characters":[{"name":"Name","description":"..." }],"environments":[{"name":"Location","description":"..."}],"products":[{"name":"Brand","description":"..."}]}`;

    if (shouldUseReplicateForGoogleModels()) {
        const text = await generateTextWithGemini3ProReplicate(content, {
            systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
            maxTokens: 2400,
        });
        try {
            return parseJsonFromText<ScriptAnalysisResult>(text, 'ScriptAnalysisResult');
        } catch (e) {
            console.error("Script analysis raw response (replicate):", text);
        }

        const retryExcerpt = script.substring(0, 6000);
        const retryContent = content.replace(scriptExcerpt, retryExcerpt);
        const retryText = await generateTextWithGemini3ProReplicate(retryContent, {
            systemPrompt: 'Return only valid JSON. No markdown, no commentary. Output minified JSON only.',
            maxTokens: 1600,
        });
        try {
            return parseJsonFromText<ScriptAnalysisResult>(retryText, 'ScriptAnalysisResult');
        } catch (e) {
            console.error("Script analysis retry response (replicate):", retryText);
            throw new Error("Could not understand the AI's analysis.");
        }
    }

    const ai = getAiClient();
    const config = {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                characters: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            name: { type: Type.STRING, description: "Character name (single identity only, no outfit variant suffix)." },
                            description: { type: Type.STRING, description: "Visual description of appearance. Include outfit/wardrobe variations as notes in this field." }
                        },
                        required: ['name', 'description']
                    }
                },
                environments: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            name: { type: Type.STRING },
                            description: { type: Type.STRING }
                        },
                        required: ['name', 'description']
                    }
                },
                products: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            name: { type: Type.STRING },
                            description: { type: Type.STRING, description: "Visual details of the product, logo, or brand asset." }
                        },
                        required: ['name', 'description']
                    }
                }
            },
            required: ['characters', 'environments']
        },
    } as const;

    const modelCandidates = [
        'gemini-2.5-flash',
        GEMINI_TEXT_MODEL_FLASH,
        'gemini-1.5-flash',
        'gemini-2.5-pro',
        GEMINI_TEXT_MODEL_PRO,
    ];

    let lastError: unknown;
    for (const modelName of modelCandidates) {
        try {
            const isFastModel = /flash/i.test(modelName);
            const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
                model: modelName,
                contents: content,
                config,
            }), isFastModel ? 2 : 4, isFastModel ? 700 : 1500);
            return parseJsonFromText<ScriptAnalysisResult>(response.text, 'ScriptAnalysisResult');
        } catch (error) {
            lastError = error;
            if (isModelNotFoundError(error) || isHighDemandModelError(error)) {
                continue;
            }
            const rawText = String((error as any)?.response?.text || '');
            if (rawText) {
                console.error("Script analysis raw response:", rawText);
            }
        }
    }

    throw new Error(`Could not understand the AI's analysis. ${String((lastError as any)?.message || '')}`.trim());
}

export type SceneWallChunkAnalysisResult = {
    scenes: Array<{
        slugline: string;
        summary?: string;
        characters?: string[];
        environments?: string[];
        shotHints?: string[];
    }>;
};

export const analyzeScriptForSceneWallChunk = async (scriptChunk: string): Promise<SceneWallChunkAnalysisResult> => {
    const excerpt = scriptChunk.substring(0, 10000);
    const content = `You are a senior editorial assistant creating a scene wall for a feature film.

Task:
- Extract EVERY scene in script order from this chunk.
- Prioritize real sluglines/headings (INT./EXT./INT/EXT./I/E).
- If a scene lacks a clean slugline, infer a concise fallback heading.
- Keep output deterministic and compact.

Rules:
1) Do not skip scenes.
2) Keep slugline uppercase.
3) Keep summary short (1 sentence max).
4) Extract character names and environment names only when explicitly present.
5) shotHints should only include explicit shot/blocking hints if present (max 6 per scene).

Return JSON only:
{
  "scenes": [
    {
      "slugline": "INT. HOUSE - NIGHT",
      "summary": "...",
      "characters": ["NAME"],
      "environments": ["HOUSE"],
      "shotHints": ["LOW ANGLE CLOSEUP"]
    }
  ]
}

SCRIPT CHUNK:
---
${excerpt}
---`;

    if (shouldUseReplicateForGoogleModels()) {
        const text = await generateTextWithGemini3ProReplicate(content, {
            systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
            maxTokens: 2200,
        });
        const parsed = parseJsonFromText<SceneWallChunkAnalysisResult>(text, 'SceneWallChunkAnalysisResult');
        return {
            scenes: Array.isArray(parsed?.scenes) ? parsed.scenes : [],
        };
    }

    const ai = getAiClient();
    const config = {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                scenes: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            slugline: { type: Type.STRING },
                            summary: { type: Type.STRING, nullable: true },
                            characters: { type: Type.ARRAY, items: { type: Type.STRING } },
                            environments: { type: Type.ARRAY, items: { type: Type.STRING } },
                            shotHints: { type: Type.ARRAY, items: { type: Type.STRING } },
                        },
                        required: ['slugline'],
                    },
                },
            },
            required: ['scenes'],
        },
    } as const;

    const modelCandidates = [
        'gemini-2.5-flash',
        GEMINI_TEXT_MODEL_FLASH,
        'gemini-1.5-flash',
        'gemini-2.5-pro',
        GEMINI_TEXT_MODEL_PRO,
    ];

    let lastError: unknown;
    for (const modelName of modelCandidates) {
        try {
            const isFastModel = /flash/i.test(modelName);
            const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
                model: modelName,
                contents: content,
                config,
            }), isFastModel ? 2 : 4, isFastModel ? 700 : 1500);
            const parsed = parseJsonFromText<SceneWallChunkAnalysisResult>(response.text, 'SceneWallChunkAnalysisResult');
            return {
                scenes: Array.isArray(parsed?.scenes) ? parsed.scenes : [],
            };
        } catch (error) {
            lastError = error;
            if (isModelNotFoundError(error) || isHighDemandModelError(error)) {
                continue;
            }
        }
    }

    throw lastError || new Error('Scene wall chunk analysis failed.');
};

const getScriptLengthInstruction = (length: ScriptLength): string => {
    switch (length) {
        case 'teaser': return "Write a high-impact 30-second teaser script (approx 0.5 - 1 page). Focus on hooks and mystery.";
        case 'trailer': return "Write a 60-90 second trailer script (approx 1-2 pages). Follow a 3-act structure: Setup, Confrontation, Climax.";
        case 'short': return "Write a 5-10 minute short film script (approx 5-10 pages). Develop characters and a complete narrative arc.";
        case 'feature': return "Write a detailed Treatment and the First Scene for a 90-minute feature film. Do not write the full 90 pages. Outline the major beats of the Feature Film first, then write the opening scene in standard screenplay format.";
        case 'commercial': return "Write a compelling 15-60 second TV Commercial / Ad script. Focus on: 1. The Hook (Grab attention immediately), 2. The Value Proposition (Solve a problem), 3. The Call to Action (CTA). Keep dialogue snappy. Mention specific products/logos visually.";
        case 'micro-drama': return "Write a compact vertical micro-drama script for 45-120 seconds (ReelShort style). Start with a hook in the first 3 seconds, include a sharp emotional twist, and end with a cliffhanger.";
        case 'reelshort': return "Write an episodic ReelShort-style script (2-4 minutes). Use fast pacing, high emotional stakes, short punchy dialogue beats, and 2-3 cliffhanger moments.";
        default: return "Write a cinematic script with clear scene structure and visual storytelling.";
    }
};

export const generateScript = async (prompt: string, length: ScriptLength): Promise<string> => {
    return generateScriptWithMode(prompt, length, 'slow');
};

export const generateScriptWithMode = async (
    prompt: string,
    length: ScriptLength,
    mode: 'fast' | 'slow' = 'slow'
): Promise<string> => {
    const lengthInstruction = getScriptLengthInstruction(length);

    const content = `You are an expert screenwriter embodying the storytelling principles of Robert McKee (Story) and Joseph Campbell (The Hero's Journey).

        Task: Write a script based on the idea: "${prompt}".
        Format: Standard Final Draft Industry Format (Scene Headings in CAPS, Character names centered, Dialogue centered).

        ${lengthInstruction}

        Apply McKee's principle of "Conflict" in every scene. Ensure the dialogue has subtext.`;

    const isFast = mode === 'fast';
    if (shouldUseReplicateForGoogleModels()) {
        try {
            return await generateTextWithGemini3ProReplicate(content, {
                maxTokens: isFast ? 2400 : 4800,
                temperature: isFast ? 0.7 : 0.8,
            });
        } catch (error) {
            if (!isFast && isHighDemandModelError(error)) {
                console.warn('Quality script model unavailable on Replicate. Falling back to fast script mode.');
                return generateTextWithGemini3ProReplicate(content, {
                    maxTokens: 2400,
                    temperature: 0.7,
                });
            }
            throw error;
        }
    }

    const ai = getAiClient();
    const runGenerate = async (targetMode: 'fast' | 'slow') => {
        const fast = targetMode === 'fast';
        const candidates = fast
            ? [GEMINI_TEXT_MODEL_FLASH, 'gemini-2.5-flash', 'gemini-2.5-flash-preview', 'gemini-1.5-flash']
            : [GEMINI_TEXT_MODEL_PRO, 'gemini-2.5-pro', 'gemini-1.5-pro'];
        let lastError: unknown;

        for (const modelName of candidates) {
            try {
                const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
                    model: modelName,
                    contents: content,
                    config: { thinkingConfig: { thinkingBudget: fast ? 1024 : 4096 } }
                }), fast ? 2 : 5, fast ? 700 : 2000);
                return response.text;
            } catch (error) {
                lastError = error;
                if (isModelNotFoundError(error)) {
                    continue;
                }
                throw error;
            }
        }

        throw lastError || new Error(`No compatible ${targetMode} script model available.`);
    };

    if (isFast) {
        return runGenerate('fast');
    }

    try {
        return await runGenerate('slow');
    } catch (error) {
        if (isHighDemandModelError(error)) {
            console.warn('Quality script model unavailable. Falling back to fast script mode.');
            return runGenerate('fast');
        }
        throw error;
    }
};

export const generateScriptFromImages = async (payload: {
    images: Array<{ base64: string; mimeType: string }>;
    length: ScriptLength;
    prompt?: string;
}): Promise<string> => {
    const boundedImages = (payload.images || []).slice(0, 6);
    if (boundedImages.length === 0) {
        throw new Error('Upload at least one image to generate a script.');
    }

    const lengthInstruction = getScriptLengthInstruction(payload.length);
    const promptHint = (payload.prompt || '').trim();

    const instructions = `You are an expert screenwriter.

Task:
- Analyze the uploaded reference images.
- Infer story world, key characters, environment, tone, and likely conflict from the visuals.
- Write one coherent screenplay treatment/script in standard screenplay style.
- Do not mention "image", "uploaded", or "reference" in the final script.

Format requirements:
- Use scene headings (INT./EXT., LOCATION, TIME).
- Use concise action lines and natural dialogue.
- Keep continuity consistent across scenes.
- If product/brand cues are visible, include them naturally in the story only when relevant.

Length target:
${lengthInstruction}

${promptHint ? `Additional user direction: ${promptHint}` : 'No additional user direction provided.'}`;

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_PRO,
        contents: {
            parts: [
                { text: instructions },
                ...boundedImages.map((image) => ({ inlineData: { data: image.base64, mimeType: image.mimeType || 'image/jpeg' } })),
            ],
        },
        config: { thinkingConfig: { thinkingBudget: 3072 } },
    }));

    return response.text.trim();
};

export const editScriptSelection = async (fullScript: string, selection: string, instruction: string): Promise<string> => {
    const content = `You are a professional script doctor.

        Context (Full Script):
        ---
        ${fullScript.substring(0, 2000)}... (truncated context)
        ---

        Selected Text to Edit:
        "${selection}"

        Instruction: "${instruction}"

        Return ONLY the rewritten version of the Selected Text. Maintain standard screenplay format.`;

    if (shouldUseReplicateForGoogleModels()) {
        return generateTextWithGemini3ProReplicate(content);
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_PRO,
        contents: content,
    }));
    return response.text;
};

export const suggestNextPlotPoints = async (script: string): Promise<string[]> => {
    const content = `Based on the following script, suggest 3 divergent plot progressions or "next beats" for the story.

        Script so far:
        ---
        ${script.substring(script.length - 3000)}
        ---

        Return a JSON array of 3 strings. Each string should be a concise plot beat description.`;

    if (shouldUseReplicateForGoogleModels()) {
        try {
            const text = await generateTextWithGemini3ProReplicate(content, {
                systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
            });
            return parseJsonFromText<string[]>(text, 'NextPlotPoints');
        } catch {
            return ["Continue the confrontation", "Introduce a twist", "Reveal a secret"];
        }
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_FLASH,
        contents: content,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                minItems: 3,
                maxItems: 3
            }
        }
    }));
    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        return ["Continue the confrontation", "Introduce a twist", "Reveal a secret"];
    }
};

export const suggestVisualStyles = async (script: string): Promise<string[]> => {
    const content = `Analyze the mood and genre of this script. Suggest 5 distinct visual styles (e.g., "Gritty Noir", "Vibrant 3D Animation", "Hand-drawn Anime", "Photorealistic Cinematic", "Symmetric Pastel").

        Script excerpt: "${script.substring(0, 1000)}..."

        Return a JSON array of strings.`;

    if (shouldUseReplicateForGoogleModels()) {
        try {
            const text = await generateTextWithGemini3ProReplicate(content, {
                systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
            });
            return parseJsonFromText<string[]>(text, 'VisualStyles');
        } catch {
            return ["Cinematic Photorealistic", "Stylized Animation"];
        }
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_FLASH,
        contents: content,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
            }
        }
    }));
    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        return ["Cinematic Photorealistic", "Stylized Animation"];
    }
};

export const generateProductionGuidelines = async (bible: StoryBible): Promise<string> => {
    const content = `Create production guidelines. Logline: ${bible.logline}. Script: ${bible.script}`;

    if (shouldUseReplicateForGoogleModels()) {
        return generateTextWithGemini3ProReplicate(content);
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_PRO,
        contents: content,
    }));
    return response.text;
};

export const generateReferenceDetails = async (
    type: 'character' | 'environment' | 'product' | 'prop',
    name: string,
    description: string,
    scriptContext?: string,
    style?: string
): Promise<{ prompt: string, tags: string[] }> => {
    // Construct a rich context prompt
    const userPrompt = `
        You are a Concept Artist. Generate a detailed, high-quality image generation prompt for a ${type} named "${name}".

        **Base Description:** "${description}"

        **Visual Style:** "${style || 'Cinematic, Photorealistic'}"

        **Script Context:**
        ---
        ${scriptContext?.substring(0, 3000) || ''}... (truncated)
        ---

        **Instructions:**
        1. Analyze the script to understand the ${type}'s role, appearance details mentioned (clothing, features, lighting), and mood.
        2. Combine the "Base Description" with the script context.
        3. Apply the "Visual Style" strictly.
        4. ${type === 'product' ? 'Focus on high-end Product Photography: Sharp focus, studio lighting, clean background or contextual lifestyle setting as per script, reflections, and premium material rendering.' : ''}
        5. ${type === 'prop' ? 'Focus on clear, production-ready prop design: readable silhouette, material detail, and context of use in-scene.' : ''}
        6. Output a single, cohesive, detailed prompt suitable for a text-to-image model (like Midjourney or Imagen).
        7. Also extract 5 relevant tags.

        Return JSON { prompt: string, tags: string[] }.
    `;

    if (shouldUseReplicateForGoogleModels()) {
        try {
            const text = await generateTextWithGemini3ProReplicate(userPrompt, {
                systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
            });
            return parseJsonFromText<{ prompt: string; tags: string[] }>(text, 'ReferenceDetails');
        } catch {
            const fallbackStyle = style || 'Cinematic, Photorealistic';
            return { prompt: `${fallbackStyle}. ${description}`, tags: [] };
        }
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_FLASH,
        contents: userPrompt,
        config: { responseMimeType: "application/json" },
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch {
        // Fallback if JSON parsing fails
        return { prompt: `${style}. ${description}`, tags: [] };
    }
};

export const generateCharacterProfile = async (payload: {
    name: string;
    description: string;
    script: string;
}): Promise<{
    personalityNotes: string;
    voiceNotes: string;
    backstory: string;
    characterGoals: string;
    characterArc: string;
    designNotes: string;
}> => {
    const content = `You are a character designer for film. Create a concise, production-ready character profile.

Character Name: ${payload.name}
Description: ${payload.description}

Script (context): ${payload.script.substring(0, 3000)}

Return JSON only with: personalityNotes, voiceNotes, backstory, characterGoals, characterArc, designNotes.`;

    if (shouldUseReplicateForGoogleModels()) {
        try {
            const text = await generateTextWithGemini3ProReplicate(content, {
                systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
            });
            return parseJsonFromText<{
                personalityNotes: string;
                voiceNotes: string;
                backstory: string;
                characterGoals: string;
                characterArc: string;
                designNotes: string;
            }>(text, 'CharacterProfile');
        } catch (e) {
            console.error("Failed to parse character profile:", e);
            throw new Error("Could not generate character profile.");
        }
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_PRO,
        contents: content,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    personalityNotes: { type: Type.STRING },
                    voiceNotes: { type: Type.STRING },
                    backstory: { type: Type.STRING },
                    characterGoals: { type: Type.STRING },
                    characterArc: { type: Type.STRING },
                    designNotes: { type: Type.STRING },
                },
                required: ["personalityNotes", "voiceNotes", "backstory", "characterGoals", "characterArc", "designNotes"]
            }
        }
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        console.error("Failed to parse character profile:", e);
        throw new Error("Could not generate character profile.");
    }
};

export const generateCharacterOutfitPlan = async (payload: {
    name: string;
    description: string;
    basePrompt?: string;
    script: string;
    count?: number;
    wardrobeMoments?: string[];
}): Promise<Array<{ name: string; description: string; prompt: string }>> => {
    const desiredCount = Math.max(1, Math.min(payload.count ?? 4, 8));
    const wardrobeMoments = (payload.wardrobeMoments || []).map((item) => item.trim()).filter(Boolean).slice(0, 8);
    const content = `You are a costume designer. Based on the script, list exactly ${desiredCount} distinct outfit variations needed for this character across scenes.

Character: ${payload.name}
Description: ${payload.description}
Base Visual Prompt: ${payload.basePrompt || 'n/a'}
${wardrobeMoments.length > 0 ? `Detected wardrobe beats:\n- ${wardrobeMoments.join('\n- ')}` : ''}

Script (context): ${payload.script.substring(0, 4000)}

Return JSON with an array "outfits" (name, description, prompt). The description must include when/why the outfit appears (scene/setting/time/occasion). The prompt should describe the outfit on the same character, preserving identity, and be compatible with a try-on workflow where the character starts from a neutral swimsuit/base body and is then dressed with the target garments.`;

    if (shouldUseReplicateForGoogleModels()) {
        try {
            const text = await generateTextWithGemini3ProReplicate(content, {
                systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
            });
            const result = parseJsonFromText<{ outfits: Array<{ name: string; description: string; prompt: string }> }>(text, 'OutfitPlan');
            return Array.isArray(result.outfits) ? result.outfits : [];
        } catch (e) {
            console.error("Failed to parse outfit plan:", e);
            throw new Error("Could not generate outfit variations.");
        }
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_PRO,
        contents: content,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    outfits: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                description: { type: Type.STRING },
                                prompt: { type: Type.STRING },
                            },
                            required: ["name", "description", "prompt"]
                        }
                    }
                },
                required: ["outfits"]
            }
        }
    }));

    try {
        const result = JSON.parse(response.text.trim());
        return Array.isArray(result.outfits) ? result.outfits : [];
    } catch (e) {
        console.error("Failed to parse outfit plan:", e);
        throw new Error("Could not generate outfit variations.");
    }
};

export const generateEnvironmentCoveragePlan = async (payload: {
    name: string;
    description?: string;
    prompt?: string;
    script?: string;
    requiredZones?: string[];
    maxShots?: number;
}): Promise<{
    environmentType: string;
    inferredZones: string[];
    shots: Array<{
        id: string;
        label: string;
        prompt: string;
        yaw?: number;
        pitch?: number;
        zone?: string;
    }>;
}> => {
    const maxShots = Math.max(4, Math.min(payload.maxShots ?? 8, 10));
    const requiredZones = (payload.requiredZones || [])
        .map((zone) => zone.trim())
        .filter(Boolean)
        .slice(0, 8);
    const content = `You are a production designer and location scout. Build a coverage plan for a single environment reference image.

Environment name: ${payload.name}
Environment description: ${payload.description || 'n/a'}
Environment prompt: ${payload.prompt || 'n/a'}
Script context: ${(payload.script || '').slice(0, 2500) || 'n/a'}
Required zones (must include as detail shots if plausible): ${requiredZones.length > 0 ? requiredZones.join(', ') : 'none'}

Task:
1) Infer the environment type from the input (examples: bar, apartment, street, office, restaurant, warehouse, hallway, bedroom, bathroom).
2) Return a practical coverage plan with up to ${maxShots} shots.
3) Make angle choices depend on the environment type:
   - Bar/interior: include counter, seating, entry/window, service zones as relevant.
   - Apartment/home: include hallway + key rooms if implied (living room, bedroom, bathroom, kitchen).
   - Street/exterior: include overhead/drone-like overview, pedestrian path, front/back street sections, key sides.
4) Keep shots physically plausible and consistent with the same base location.
5) Include yaw and pitch when useful for camera direction. yaw range: -180..180, pitch range: -60..60.
6) Do not output duplicate shots.

Return JSON only with:
{
  "environmentType": "string",
  "inferredZones": ["string"],
  "shots": [
    {
      "id": "short-kebab-id",
      "label": "short label",
      "prompt": "what this angle should cover",
      "yaw": 0,
      "pitch": 0,
      "zone": "optional zone name"
    }
  ]
}`;

    if (shouldUseReplicateForGoogleModels()) {
        try {
            const text = await generateTextWithGemini3ProReplicate(content, {
                systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
            });
            return parseJsonFromText<{
                environmentType: string;
                inferredZones: string[];
                shots: Array<{ id: string; label: string; prompt: string; yaw?: number; pitch?: number; zone?: string }>;
            }>(text, 'EnvironmentCoveragePlan');
        } catch (e) {
            console.error("Failed to parse environment coverage plan:", e);
            throw new Error("Could not generate environment coverage plan.");
        }
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_PRO,
        contents: content,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    environmentType: { type: Type.STRING },
                    inferredZones: { type: Type.ARRAY, items: { type: Type.STRING } },
                    shots: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                id: { type: Type.STRING },
                                label: { type: Type.STRING },
                                prompt: { type: Type.STRING },
                                yaw: { type: Type.NUMBER, nullable: true },
                                pitch: { type: Type.NUMBER, nullable: true },
                                zone: { type: Type.STRING, nullable: true },
                            },
                            required: ["id", "label", "prompt"]
                        }
                    }
                },
                required: ["environmentType", "inferredZones", "shots"]
            }
        }
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        console.error("Failed to parse environment coverage plan:", e);
        throw new Error("Could not generate environment coverage plan.");
    }
};


export const generateShotImagePrompts = async (
    script: string,
    productionGuidelines: string,
    stylePrompt?: string,
    aspectRatio: StoryboardAspectRatio = '16:9'
): Promise<ShotPrompt[]> => {
    const resolvedStyle = stylePrompt?.trim();
    const styleBlock = resolvedStyle
        ? `**Visual Style:** ${resolvedStyle}
        - Apply this style consistently in every prompt.
        - Do not mention photorealism unless it appears in the visual style.`
        : `**Visual Style:** Cinematic, photorealistic`;
    const aspectRatioBlock = buildStoryboardAspectRatioGuidance(aspectRatio);
    const scriptExcerpt = script.substring(0, 14000);
    const guidelinesExcerpt = productionGuidelines.substring(0, 6000);
    const content = `You are a world-class Director of Photography (DoP) and Storyboard Artist. Your task is to translate a film script into a series of highly technical, cinematic, and actionable visual prompts for an image generation AI.

        **Expert Cinematography Instructions:**
        1. **Lighting:** Define the lighting setup for every shot (e.g., "High-key", "Low-key noir", "Rembrandt lighting", "Soft diffused window light", "Practical neons"). Ensure the lighting reflects the emotional beat of the scene as per the script.
        2. **Composition:** Specify lens choices (e.g., "35mm wide", "85mm portrait", "Anamorphic"), camera angles ("Low angle hero shot", "Dutch tilt", "Over-the-shoulder"), and depth of field ("Shallow depth of field with bokeh").
        3. **Continuity:** Analyze the script sequentially. When generating the prompt for Shot 2, you MUST consider the visual state established in Shot 1 to maintain continuity.
        4. **Color:** Specify a color palette that supports the narrative (e.g., "Cold blues and cyans for isolation", "Warm golden hues for nostalgia").
        5. **Products/Branding:** If this is a commercial, explicitly identify any products or logos mentioned in the shot.
        6. **Style:** Follow the Visual Style below for every shot and include it explicitly in each prompt.
        7. **Aspect Ratio:** Follow the aspect-ratio-specific framing strategy below in both shot design and prompt wording.

        ${styleBlock}
        ${aspectRatioBlock}

        For each distinct shot or action sequence in the script, generate a single, detailed prompt consistent with the visual style.

        Return the output as a single JSON object with a key "shots".
        Output must be valid JSON only (no markdown, no extra text).
        Example:
        {"shots":[{"shot":1,"description":"...","prompt":"...","characters":["Name"],"environment":"Location","products":[]}]}

        **Production Guidelines:**
        ---
        ${guidelinesExcerpt}
        ---

        **Script:**
        ---
        ${scriptExcerpt}
        ---
        `;

    if (shouldUseReplicateForGoogleModels()) {
        const text = await generateTextWithGemini3ProReplicate(content, {
            systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
        });
        try {
            const result = parseJsonFromText<{ shots: ShotPrompt[] }>(text, 'ShotPrompts');
            if (!result.shots || !Array.isArray(result.shots)) {
                throw new Error('Shot prompt response missing shots array.');
            }
            return result.shots;
        } catch (e) {
            console.error("Failed to parse shot prompts from AI response:", e);
            console.error("Storyboard raw response (replicate):", text);
        }

        const retryScript = script.substring(0, 8000);
        const retryGuidelines = productionGuidelines.substring(0, 3000);
        const retryContent = content
            .replace(scriptExcerpt, retryScript)
            .replace(guidelinesExcerpt, retryGuidelines)
            .replace('Output must be valid JSON only (no markdown, no extra text).', 'Return minified JSON only. No markdown, no extra text.');
        const retryText = await generateTextWithGemini3ProReplicate(retryContent, {
            systemPrompt: 'Return only valid JSON. Output minified JSON only.',
        });
        try {
            const result = parseJsonFromText<{ shots: ShotPrompt[] }>(retryText, 'ShotPrompts');
            if (!result.shots || !Array.isArray(result.shots)) {
                throw new Error('Shot prompt response missing shots array.');
            }
            return result.shots;
        } catch (e) {
            console.error("Storyboard raw response (replicate retry):", retryText);
        }

        const repairInput = retryText || text;
        const repairPrompt = `Fix the following into valid JSON. Return only JSON with { "shots": [...] } and no extra text.\n\n${repairInput.slice(0, 12000)}`;
        const repaired = await generateTextWithGemini3ProReplicate(repairPrompt, {
            systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
        });
        try {
            const result = parseJsonFromText<{ shots: ShotPrompt[] }>(repaired, 'ShotPrompts');
            if (!result.shots || !Array.isArray(result.shots)) {
                throw new Error('Shot prompt response missing shots array.');
            }
            return result.shots;
        } catch (e) {
            console.error("Storyboard raw response (replicate repair):", repaired);
            throw new Error("Could not understand the AI's storyboard analysis. Please try again.");
        }
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_PRO,
        contents: content,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    shots: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                shot: { type: Type.NUMBER, description: "The sequential shot number." },
                                description: { type: Type.STRING, description: "A brief description of the shot from the script." },
                                prompt: { type: Type.STRING, description: "The detailed, cinematic image generation prompt, explicitly including lighting, lens choice, and continuity details." },
                                characters: { type: Type.ARRAY, description: "A list of character names in the shot.", items: { type: Type.STRING } },
                                environment: { type: Type.STRING, description: "The name of the environment/location for this shot.", nullable: true },
                                products: { type: Type.ARRAY, description: "List of products or logos appearing in this shot.", items: { type: Type.STRING } }
                            },
                            required: ["shot", "description", "prompt", "characters", "environment"]
                        }
                    }
                },
                required: ['shots']
            },
        },
    }));

    try {
        const jsonStr = response.text.trim();
        const result = JSON.parse(jsonStr);
        if (!result.shots || !Array.isArray(result.shots)) {
            throw new Error(`AI response is not in the expected format ({ shots: [...] }). Response: ${jsonStr}`);
        }
        return result.shots;
    } catch (e) {
        console.error("Failed to parse shot prompts from AI response:", e);
        console.error("Raw AI response:", response.text);
        throw new Error("Could not understand the AI's storyboard analysis. Please try again.");
    }
};

export const generateExtraShotPrompt = async (payload: {
    script: string;
    productionGuidelines: string;
    stylePrompt?: string;
    aspectRatio?: StoryboardAspectRatio;
    idea: string;
    afterShot?: { shot: number; description: string; prompt?: string };
    beforeShot?: { shot: number; description: string; prompt?: string };
}): Promise<{
    shot: {
        description: string;
        prompt: string;
        characters: string[];
        environment: string | null;
        products?: string[];
    };
    references: Array<{
        type: 'character' | 'environment' | 'product' | 'prop';
        name: string;
        description: string;
    }>;
}> => {
    const resolvedStyle = payload.stylePrompt?.trim();
    const styleBlock = resolvedStyle
        ? `**Visual Style:** ${resolvedStyle}
        - Apply this style consistently in every prompt.
        - Do not mention photorealism unless it appears in the visual style.`
        : `**Visual Style:** Cinematic, photorealistic`;
    const aspectRatioBlock = buildStoryboardAspectRatioGuidance(payload.aspectRatio || '16:9');
    const placementNotes = [
        payload.afterShot
            ? `Insert after Shot ${payload.afterShot.shot}: ${payload.afterShot.description}`
            : undefined,
        payload.beforeShot
            ? `Next shot is Shot ${payload.beforeShot.shot}: ${payload.beforeShot.description}`
            : undefined,
    ].filter(Boolean);
    const placementBlock = placementNotes.length
        ? `**Placement Context:**\n${placementNotes.join('\n')}`
        : '';
    const content = `You are a world-class Director of Photography (DoP) and Storyboard Artist. Generate one additional shot based on the idea below and the script context.

        **Expert Cinematography Instructions:**
        1. **Lighting:** Define the lighting setup (e.g., "High-key", "Low-key noir", "Rembrandt lighting", "Soft diffused window light", "Practical neons").
        2. **Composition:** Specify lens choice, camera angle, and depth of field.
        3. **Continuity:** Maintain continuity with adjacent shots.
        4. **Color:** Specify a supporting color palette.
        5. **Products/Branding:** If this is a commercial, identify products or logos.
        6. **Style:** Follow the Visual Style below and include it explicitly in the prompt.
        7. **Aspect Ratio:** Follow the aspect-ratio-specific framing strategy below in both shot design and prompt wording.

        ${styleBlock}
        ${aspectRatioBlock}
        ${placementBlock}

        **Shot Idea / Type:**
        ${payload.idea}

        **Production Guidelines:**
        ---
        ${payload.productionGuidelines}
        ---

        **Script:**
        ---
        ${payload.script}
        ---

        Return JSON with:
        - "shot": { description, prompt, characters, environment, products }
        - "references": optional suggested visual references (character/environment/product/prop) with name and description.
        `;

    if (shouldUseReplicateForGoogleModels()) {
        try {
            const text = await generateTextWithGemini3ProReplicate(content, {
                systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
            });
            const result = parseJsonFromText<{
                shot: {
                    description: string;
                    prompt: string;
                    characters: string[];
                    environment: string | null;
                    products?: string[];
                };
                references?: Array<{ type: 'character' | 'environment' | 'product' | 'prop'; name: string; description: string }>;
            }>(text, 'ExtraShotPrompt');
            return {
                shot: result.shot,
                references: Array.isArray(result.references) ? result.references : []
            };
        } catch (e) {
            console.error("Failed to parse extra shot response:", e);
            throw new Error("Could not generate the extra shot. Please try again.");
        }
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_PRO,
        contents: content,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    shot: {
                        type: Type.OBJECT,
                        properties: {
                            description: { type: Type.STRING },
                            prompt: { type: Type.STRING },
                            characters: { type: Type.ARRAY, items: { type: Type.STRING } },
                            environment: { type: Type.STRING, nullable: true },
                            products: { type: Type.ARRAY, items: { type: Type.STRING } },
                        },
                        required: ["description", "prompt", "characters", "environment"]
                    },
                    references: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                type: { type: Type.STRING },
                                name: { type: Type.STRING },
                                description: { type: Type.STRING }
                            },
                            required: ["type", "name", "description"]
                        }
                    }
                },
                required: ["shot"]
            }
        },
    }));

    try {
        const result = JSON.parse(response.text.trim());
        return {
            shot: result.shot,
            references: Array.isArray(result.references) ? result.references : []
        };
    } catch (e) {
        console.error("Failed to parse extra shot response:", e);
        console.error("Raw AI response:", response.text);
        throw new Error("Could not generate the extra shot. Please try again.");
    }
};

export const shouldUsePreviousShotContext = async (payload: {
    script: string;
    previousShot: { description: string; prompt?: string; environment?: string | null };
    currentShot: { description: string; prompt?: string; environment?: string | null };
}): Promise<{ usePreviousShot: boolean; reason: string }> => {
    const content = `You are a storyboard continuity assistant. Decide if the previous shot image should be used as a visual continuity reference for the current shot.

Use the previous shot as context when the action, environment, time of day, lighting, or character placement should stay consistent. Do NOT use it if the scene changes location/time or the shot is a hard reset.

Return JSON only.

Script (for context): ${payload.script.substring(0, 2500)}

Previous Shot:
Description: ${payload.previousShot.description}
Environment: ${payload.previousShot.environment || 'unspecified'}
Prompt: ${payload.previousShot.prompt || 'n/a'}

Current Shot:
Description: ${payload.currentShot.description}
Environment: ${payload.currentShot.environment || 'unspecified'}
Prompt: ${payload.currentShot.prompt || 'n/a'}
        `;

    if (shouldUseReplicateForGoogleModels()) {
        try {
            const text = await generateTextWithGemini3ProReplicate(content, {
                systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
            });
            return parseJsonFromText<{ usePreviousShot: boolean; reason: string }>(text, 'PreviousShotContext');
        } catch (e) {
            console.error("Failed to parse previous shot context decision:", e);
            throw new Error("Could not determine whether to use previous shot context.");
        }
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_FLASH,
        contents: content,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    usePreviousShot: { type: Type.BOOLEAN, description: "Whether to use the previous shot image as a context reference." },
                    reason: { type: Type.STRING, description: "Short reason for the decision." }
                },
                required: ["usePreviousShot", "reason"]
            }
        },
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        console.error("Failed to parse previous shot context decision:", e);
        throw new Error("Could not determine whether to use previous shot context.");
    }
};

export const refineStoryboardPromptForContinuity = async (payload: {
    script: string;
    projectTitle?: string;
    projectStyle?: string;
    currentPrompt: string;
    shot: {
        shot: number;
        description: string;
        prompt?: string;
        environment?: string | null;
        characters?: string[];
        products?: string[];
        wardrobe?: string[];
        contextReferences?: Array<{ name: string; purpose: string; tag?: string }>;
        usePreviousShotContext?: boolean;
    };
    previousShot?: {
        shot: number;
        description: string;
        prompt?: string;
        environment?: string | null;
        characters?: string[];
        wardrobe?: string[];
    } | null;
    review: ShotContinuityReview;
}): Promise<{ shouldRetry: boolean; refinedPrompt: string; summary: string }> => {
    if (payload.review.status === 'aligned') {
        return {
            shouldRetry: false,
            refinedPrompt: payload.currentPrompt,
            summary: 'Shot is already aligned; no continuity retry needed.',
        };
    }

    const currentContext = {
        shot: payload.shot.shot,
        description: payload.shot.description,
        environment: payload.shot.environment || null,
        characters: payload.shot.characters || [],
        products: payload.shot.products || [],
        wardrobe: payload.shot.wardrobe || [],
        usePreviousShotContext: payload.shot.usePreviousShotContext ?? null,
        contextReferences: (payload.shot.contextReferences || []).slice(0, 6),
    };

    const previousContext = payload.previousShot
        ? {
            shot: payload.previousShot.shot,
            description: payload.previousShot.description,
            environment: payload.previousShot.environment || null,
            characters: payload.previousShot.characters || [],
            wardrobe: payload.previousShot.wardrobe || [],
        }
        : null;

    const reviewContext = {
        status: payload.review.status,
        score: payload.review.score,
        summary: payload.review.summary,
        topAnchors: payload.review.topAnchors || [],
        issues: payload.review.issues.map((issue) => ({
            kind: issue.kind,
            severity: issue.severity,
            message: issue.message,
            anchorName: issue.anchorName || null,
            comparedShot: issue.comparedShot || null,
        })),
    };

    const content = `You are a storyboard continuity prompt refiner.

Your task: decide whether the current storyboard prompt should be retried, and if yes, rewrite the FULL prompt so the next image generation is more visually consistent.

Rules:
1. Preserve the intended action and composition of the current shot.
2. Preserve continuity for character identity, environment, lighting, wardrobe, props, and framing when the story clearly carries over from the previous shot.
3. If the current shot intentionally changes location, time of day, or outfit, KEEP the intended change while preserving character identity and project style.
4. Do not make the prompt generic. Keep it specific and production-ready.
5. Preserve any explicit aspect-ratio framing strategy already present in the current prompt.
6. Do not mention scores, debugging text, JSON, or "previous shot" literally inside the refined prompt.
7. Keep the refined prompt under 1400 characters.
8. Return JSON only.

Project:
${JSON.stringify({
        title: payload.projectTitle || null,
        style: payload.projectStyle || null,
        scriptExcerpt: payload.script.slice(0, 3000),
    })}

Current Shot:
${JSON.stringify(currentContext)}

Previous Shot:
${JSON.stringify(previousContext)}

Current Full Prompt:
${payload.currentPrompt}

Continuity Review:
${JSON.stringify(reviewContext)}
`;

    if (shouldUseReplicateForGoogleModels()) {
        try {
            const text = await generateTextWithGemini3ProReplicate(content, {
                systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
            });
            return parseJsonFromText<{ shouldRetry: boolean; refinedPrompt: string; summary: string }>(text, 'StoryboardContinuityRefine');
        } catch (e) {
            console.error('Failed to parse storyboard continuity refinement:', e);
            throw new Error('Could not refine the storyboard prompt for continuity.');
        }
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_FLASH,
        contents: content,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    shouldRetry: { type: Type.BOOLEAN },
                    refinedPrompt: { type: Type.STRING },
                    summary: { type: Type.STRING },
                },
                required: ["shouldRetry", "refinedPrompt", "summary"],
            },
        },
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        console.error('Failed to parse storyboard continuity refinement:', e);
        throw new Error('Could not refine the storyboard prompt for continuity.');
    }
};

export const refineFilmingPromptForContinuity = async (payload: {
    script: string;
    projectTitle?: string;
    projectStyle?: string;
    currentPrompt: string;
    shot: {
        shot: number;
        description: string;
        prompt?: string;
        environment?: string | null;
        characters?: string[];
        products?: string[];
        wardrobe?: string[];
        contextReferences?: Array<{ name: string; purpose: string; tag?: string }>;
        usePreviousShotContext?: boolean;
        hasStartFrame?: boolean;
        hasEndFrame?: boolean;
        hasMotionReference?: boolean;
    };
    previousShot?: {
        shot: number;
        description: string;
        prompt?: string;
        environment?: string | null;
        characters?: string[];
        wardrobe?: string[];
    } | null;
    review: ShotContinuityReview;
}): Promise<{ shouldRetry: boolean; refinedPrompt: string; summary: string }> => {
    if (payload.review.status === 'aligned') {
        return {
            shouldRetry: false,
            refinedPrompt: payload.currentPrompt,
            summary: 'Shot is already aligned; no filming retry needed.',
        };
    }

    const currentContext = {
        shot: payload.shot.shot,
        description: payload.shot.description,
        environment: payload.shot.environment || null,
        characters: payload.shot.characters || [],
        products: payload.shot.products || [],
        wardrobe: payload.shot.wardrobe || [],
        usePreviousShotContext: payload.shot.usePreviousShotContext ?? null,
        hasStartFrame: payload.shot.hasStartFrame ?? false,
        hasEndFrame: payload.shot.hasEndFrame ?? false,
        hasMotionReference: payload.shot.hasMotionReference ?? false,
        contextReferences: (payload.shot.contextReferences || []).slice(0, 6),
    };

    const previousContext = payload.previousShot
        ? {
            shot: payload.previousShot.shot,
            description: payload.previousShot.description,
            environment: payload.previousShot.environment || null,
            characters: payload.previousShot.characters || [],
            wardrobe: payload.previousShot.wardrobe || [],
        }
        : null;

    const reviewContext = {
        status: payload.review.status,
        score: payload.review.score,
        summary: payload.review.summary,
        topAnchors: payload.review.topAnchors || [],
        issues: payload.review.issues.map((issue) => ({
            kind: issue.kind,
            severity: issue.severity,
            message: issue.message,
            anchorName: issue.anchorName || null,
            comparedShot: issue.comparedShot || null,
        })),
    };

    const content = `You are a video continuity prompt refiner.

Your task: decide whether the current filming prompt should be retried, and if yes, rewrite the FULL motion/video prompt so the next render is more visually and narratively consistent.

Rules:
1. Preserve the intended action, camera movement, pacing, and shot idea.
2. Strengthen continuity for character identity, wardrobe, props, environment, lighting, and framing cues when the story carries over.
3. If the shot intentionally changes location, time, or outfit, KEEP that change while preserving character identity and project style.
4. If a start frame, end frame, or motion reference exists, write the prompt to respect those anchors rather than fighting them.
5. Preserve any explicit aspect-ratio framing strategy already present in the current prompt.
6. Do not make the prompt generic. Keep it specific and production-ready.
7. Do not mention scores, debugging text, JSON, or "previous shot" literally inside the refined prompt.
8. Keep the refined prompt under 1200 characters.
9. Return JSON only.

Project:
${JSON.stringify({
        title: payload.projectTitle || null,
        style: payload.projectStyle || null,
        scriptExcerpt: payload.script.slice(0, 3000),
    })}

Current Shot:
${JSON.stringify(currentContext)}

Previous Shot:
${JSON.stringify(previousContext)}

Current Full Motion Prompt:
${payload.currentPrompt}

Continuity Review:
${JSON.stringify(reviewContext)}
`;

    if (shouldUseReplicateForGoogleModels()) {
        try {
            const text = await generateTextWithGemini3ProReplicate(content, {
                systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
            });
            return parseJsonFromText<{ shouldRetry: boolean; refinedPrompt: string; summary: string }>(text, 'FilmingContinuityRefine');
        } catch (e) {
            console.error('Failed to parse filming continuity refinement:', e);
            throw new Error('Could not refine the filming prompt for continuity.');
        }
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_FLASH,
        contents: content,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    shouldRetry: { type: Type.BOOLEAN },
                    refinedPrompt: { type: Type.STRING },
                    summary: { type: Type.STRING },
                },
                required: ["shouldRetry", "refinedPrompt", "summary"],
            },
        },
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        console.error('Failed to parse filming continuity refinement:', e);
        throw new Error('Could not refine the filming prompt for continuity.');
    }
};

export const analyzeProjectDraft = async (
    script: string,
    guidelines: string,
    shotList: { shot: number; description: string; prompt: string; imageUrl?: string }[]
): Promise<ReviewFeedback> => {
    const content = `You are a professional Film Editor and Director. Review the following "Draft" of a film production against the original Script and Production Guidelines.

        Analyze the shot list (which represents the visual storyboard or filmed footage) for:
        1. **Script Adherence:** Does the visual flow match the narrative?
        2. **Visual Continuity:** Are there potential jumps in logic, lighting, or character placement based on the descriptions/prompts?
        3. **Enhancement:** Which shots feel weak or generic? How can they be improved?

        Return a comprehensive review in JSON format.

        **Script:**
        ${script.substring(0, 5000)}... (truncated)

        **Guidelines:**
        ${guidelines.substring(0, 2000)}...

        **Shot List (Draft):**
        ${JSON.stringify(shotList.map(s => ({ shot: s.shot, desc: s.description, prompt: s.prompt })), null, 2)}
        `;

    if (shouldUseReplicateForGoogleModels()) {
        try {
            const text = await generateTextWithGemini3ProReplicate(content, {
                systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
            });
            return parseJsonFromText<ReviewFeedback>(text, 'ProjectDraftReview');
        } catch (e) {
            console.error("Failed to parse review:", e);
            throw new Error("Could not understand the AI's review.");
        }
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_PRO,
        contents: content,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    overallScore: { type: Type.NUMBER, description: "Score from 1-10 based on quality and coherence." },
                    summary: { type: Type.STRING, description: "Executive summary of the draft status." },
                    strengths: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of what is working well." },
                    weaknesses: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of critical issues." },
                    continuityIssues: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Specific continuity errors found." },
                    shotSpecificFeedback: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                shot: { type: Type.NUMBER },
                                feedback: { type: Type.STRING, description: "Specific advice to enhance this shot." }
                            },
                            required: ["shot", "feedback"]
                        }
                    }
                },
                required: ["overallScore", "summary", "strengths", "weaknesses", "shotSpecificFeedback"]
            }
        }
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        console.error("Failed to parse review:", e);
        throw new Error("Could not parse AI review.");
    }
};

export const reviewCinematography = async (
    image: { base64: string, mimeType: string },
    scriptContext: string,
    shotDescription: string
): Promise<CinematographyCritique> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_FLASH,
        contents: {
            parts: [
                {
                    text: `You are a strict, world-renowned Director of Photography (DoP) like Roger Deakins. Critique this shot based on the script context.

                Script Context: "${scriptContext}"
                Shot Description: "${shotDescription}"

                Analyze:
                1. Lighting: Does it match the emotional tone? Is it too flat?
                2. Composition: Rule of thirds, leading lines, headroom.
                3. Storytelling: Does the visual reinforce the narrative beat?

                Provide a score (1-10) for each and constructive, technical feedback.` },
                { inlineData: { data: image.base64, mimeType: image.mimeType } }
            ]
        },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    lightingScore: { type: Type.NUMBER },
                    compositionScore: { type: Type.NUMBER },
                    storyRelevanceScore: { type: Type.NUMBER },
                    feedback: { type: Type.STRING, description: "Professional critique." },
                    technicalSuggestions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Specific technical fixes (e.g. 'Use a rim light')." }
                },
                required: ["lightingScore", "compositionScore", "storyRelevanceScore", "feedback", "technicalSuggestions"]
            }
        }
    }));
    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        throw new Error("Could not parse cinematography review.");
    }
};

export const generateImageWithReferences = async (
    prompt: string,
    referenceImages: { base64: string; mimeType: string }[],
    sketchImage?: { base64: string; mimeType: string },
    model: 'gemini-3.1-flash-image-preview' | 'gemini-3-pro-image-preview' = 'gemini-3.1-flash-image-preview',
    config?: { aspectRatio?: string, imageSize?: string }
): Promise<MediaItem> => {
    if (shouldUseReplicateForGoogleModels()) {
        const combinedReferences: { base64: string; mimeType: string }[] = [];
        if (sketchImage) {
            combinedReferences.push(sketchImage);
        }
        if (referenceImages.length > 0) {
            combinedReferences.push(...referenceImages);
        }
        return generateImageWithGemini3ProReplicate(
            prompt,
            config?.aspectRatio || '16:9',
            config?.imageSize || '1K',
            combinedReferences.length > 0 ? combinedReferences : undefined
        );
    }
    const ai = getAiClient();

    // Construct prompt parts
    const parts: any[] = [{ text: prompt }];

    // If we have a sketch, add it first with context
    if (sketchImage) {
        parts.push({ text: "Use the following image as a strict Composition Reference (Sketch). Follow the layout, framing, and positioning of elements exactly." });
        parts.push({ inlineData: { data: sketchImage.base64, mimeType: sketchImage.mimeType } });
    }

    // Add character/environment references
    if (referenceImages.length > 0) {
        parts.push({ text: "Use the following images as Style/Character/Environment/Product References:" });
        referenceImages.forEach(img => {
            parts.push({ inlineData: { data: img.base64, mimeType: img.mimeType } });
        });
    }

    const contents = { parts };

    let modelConfig: any = {};
    if (model === GEMINI_3_PRO_IMAGE_MODEL) {
        modelConfig = {
            imageConfig: {
                aspectRatio: config?.aspectRatio || "16:9",
                imageSize: config?.imageSize || "1K"
            }
        };
    } else {
        modelConfig = {
            responseModalities: [Modality.TEXT, Modality.IMAGE],
            imageConfig: {
                aspectRatio: config?.aspectRatio || "16:9",
                imageSize: config?.imageSize || "1K"
            }
        };
    }

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: model,
        contents,
        config: modelConfig,
    }));

    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
            if (part.inlineData) {
                const base64ImageBytes: string = part.inlineData.data;
                const imageUrl = `data:${part.inlineData.mimeType};base64,${base64ImageBytes}`;
                const item: MediaItem = {
                    id: `ref-shot-${Date.now()}`,
                    name: `shot_${prompt.slice(0, 15)}.png`,
                    type: 'image',
                    url: imageUrl,
                    source: 'generated'
                };
                recordUsage({
                    provider: 'gemini',
                    model,
                    kind: 'image',
                    units: 1,
                    unitLabel: 'image',
                    note: 'Reference-guided image generation',
                });
                return item;
            }
        }
    }

    // Fallback logic if the first attempt fails
    console.warn("Image generation with references failed. Retrying without references as a fallback.");
    try {
        const fallbackImage = await generateImageWithNano(prompt, {
            aspectRatio: config?.aspectRatio || '16:9',
            imageSize: config?.imageSize || '1K',
        });
        // Prepend name to indicate it's a fallback
        fallbackImage.name = `(fallback)_${fallbackImage.name}`;
        return fallbackImage;
    } catch (fallbackError) {
        console.error("Fallback image generation also failed:", fallbackError);
        throw new Error("Image generation failed.");
    }
};

export const generateMotionPromptForShot = async (
    script: string,
    shotNumber: number,
    shotDescription: string,
    stylePrompt?: string,
    aspectRatioGuidance?: string,
): Promise<string> => {
    const resolvedStyle = stylePrompt?.trim();
    const styleLine = resolvedStyle ? `**Visual Style:** ${resolvedStyle}` : '**Visual Style:** Cinematic, photorealistic';
    const aspectRatioBlock = aspectRatioGuidance?.trim()
        ? `**Aspect Ratio / Framing Strategy:** ${aspectRatioGuidance}`
        : '';
    const content = `I have an image for a shot in a trailer. I need a detailed image-to-video prompt for a model like Veo. The prompt should describe the motion and action while preserving the visual style.

        ${styleLine}
        ${aspectRatioBlock}

        **Shot Description from Script:** "${shotDescription}" (This is Shot ${shotNumber})

        **Full Script Context:**
        ---
        ${script}
        ---

        Respect any aspect-ratio-specific framing and movement constraints above.

        Generate only the motion prompt.`;

    if (shouldUseReplicateForGoogleModels()) {
        return generateTextWithGemini3ProReplicate(content);
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_PRO,
        contents: content,
    }));
    return response.text;
};

export const getAudioSuggestions = async (timelineClips: any[], mediaItems: MediaItem[]): Promise<string> => {
    const sceneDescriptions = timelineClips
        .filter(c => c.track === 'video')
        .map((clip: any, index: number) => {
            const media = mediaItems.find(m => m.id === clip.mediaId);
            return `Scene ${index + 1} (Duration: ${clip.duration.toFixed(1)}s): A shot of ${media?.name.replace(/_/g, ' ')}`;
        }).join('\n');

    const content = `You are a post-production sound designer. Recommend music styles and SFX. Scene List: ${sceneDescriptions}`;

    if (shouldUseReplicateForGoogleModels()) {
        return generateTextWithGemini3ProReplicate(content);
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_FLASH,
        contents: content,
    }));
    return response.text;
};

export const generateSmartScore = async (timelineClips: TimelineClip[], mediaItems: MediaItem[]): Promise<AudioScoreRequest[]> => {
    // 1. Analyze the timeline to understand the narrative arc
    const timelineDescription = timelineClips
        .sort((a, b) => a.start - b.start)
        .map((clip, i) => {
            const media = mediaItems.find(m => m.id === clip.mediaId);
            return `Shot ${i + 1} (${clip.start.toFixed(1)}s - ${clip.end.toFixed(1)}s): ${media?.name || 'Unknown'}`;
        }).join('\n');

    const content = `Analyze this video editing timeline and suggest a list of audio assets (Music or SFX) needed to create a cohesive soundscape.

        Timeline:
        ${timelineDescription}

        Return a JSON array of audio requests. For music, suggest a mood. For SFX, be specific.`;

    if (shouldUseReplicateForGoogleModels()) {
        try {
            const text = await generateTextWithGemini3ProReplicate(content, {
                systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
            });
            return parseJsonFromText<AudioScoreRequest[]>(text, 'SmartScore');
        } catch {
            return [];
        }
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_FLASH,
        contents: content,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        sceneDescription: { type: Type.STRING },
                        mood: { type: Type.STRING },
                        duration: { type: Type.NUMBER },
                        type: { type: Type.STRING, enum: ['music', 'sfx', 'ambience'] }
                    },
                    required: ['sceneDescription', 'mood', 'duration', 'type']
                }
            }
        }
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        return [];
    }
};

export const generateMusicPromptForTimeline = async (
    timelineClips: TimelineClip[],
    mediaItems: MediaItem[]
): Promise<{ prompt: string; duration: number; mood: string; bpm?: number; instruments?: string[]; mixNotes?: string }> => {
    const timelineDescription = timelineClips
        .sort((a, b) => a.start - b.start)
        .map((clip, i) => {
            const media = mediaItems.find(m => m.id === clip.mediaId);
            return `Shot ${i + 1} (${clip.start.toFixed(1)}s - ${clip.end.toFixed(1)}s): ${media?.name || 'Unknown'}`;
        }).join('\n');
    const totalDuration = timelineClips.reduce((max, clip) => Math.max(max, clip.end), 0);

    const content = `You are a music supervisor. Analyze the edit and produce a single concise prompt for a music generator.

Timeline:
${timelineDescription}

Total Duration: ${totalDuration.toFixed(1)}s

Return JSON with:
- prompt: a rich, single-paragraph music prompt
- duration: total duration in seconds
- mood: 2-4 words describing emotional tone
- bpm: optional BPM suggestion
- instruments: optional list of key instruments
- mixNotes: optional mixing notes (e.g., \"duck under dialogue\", \"big rise at 0:45\")`;

    if (shouldUseReplicateForGoogleModels()) {
        try {
            const text = await generateTextWithGemini3ProReplicate(content, {
                systemPrompt: 'Return only valid JSON. No markdown, no commentary.',
            });
            return parseJsonFromText<{
                prompt: string;
                duration: number;
                mood: string;
                bpm?: number;
                instruments?: string[];
                mixNotes?: string;
            }>(text, 'MusicPrompt');
        } catch (e) {
            throw new Error("Failed to parse music prompt.");
        }
    }

    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_PRO,
        contents: content,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    prompt: { type: Type.STRING },
                    duration: { type: Type.NUMBER },
                    mood: { type: Type.STRING },
                    bpm: { type: Type.NUMBER, nullable: true },
                    instruments: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
                    mixNotes: { type: Type.STRING, nullable: true },
                },
                required: ["prompt", "duration", "mood"]
            }
        }
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        throw new Error("Failed to parse music prompt.");
    }
};

export const generateSoundEffect = async (description: string, duration: number): Promise<MediaItem> => {
    // Note: Gemini 2.5 Flash Native Audio is primarily for speech, but we can try to use it for simple SFX or fallback to TTS with specific instructions.

    const prompt = `(Sound Effect Simulation): ${description}`;

    try {
        const item = await generateSpeechWithTTS(prompt);
        item.name = `SFX: ${description}`;
        item.duration = duration; // Override duration
        return item;
    } catch (e) {
        throw new Error("Could not generate SFX");
    }
};

export const generateSpeechWithTTS = async (prompt: string, multiSpeaker?: { speaker: string, voice: string }[]): Promise<MediaItem> => {
    const ai = getAiClient();
    const speechConfig: any = { responseModalities: [Modality.AUDIO] };
    if (multiSpeaker && multiSpeaker.length > 0) {
        speechConfig.speechConfig = {
            multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: multiSpeaker.map(s => ({
                    speaker: s.speaker,
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } }
                }))
            }
        };
    } else {
        speechConfig.speechConfig = {
            voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
        };
    }

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: prompt }] }],
        config: speechConfig,
    }));

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
        throw new Error("Speech generation failed to produce audio data.");
    }

    const pcmData = decode(base64Audio);
    // Helper `createWavBlob` assumed to be available locally or re-implemented
    const createWavBlob = (pcmData: Uint8Array, sampleRate: number, numChannels: number, bitsPerSample: number): Blob => {
        const dataSize = pcmData.length;
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        const writeString = (offset: number, str: string) => {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        };

        const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
        const blockAlign = numChannels * (bitsPerSample / 8);

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);
        new Uint8Array(buffer, 44).set(pcmData);

        return new Blob([buffer], { type: 'audio/wav' });
    };

    const audioBlob = createWavBlob(pcmData, 24000, 1, 16);
    const audioUrl = URL.createObjectURL(audioBlob);

    let duration: number | undefined;
    try {
        duration = await getVideoDuration(audioUrl);
    } catch (e) {
        duration = 5;
    }

    recordUsage({
        provider: 'gemini',
        model: 'gemini-2.5-flash-preview-tts',
        kind: 'audio',
        units: Math.max(0.01, (duration || 0) / 60),
        unitLabel: 'minute',
        note: 'Gemini TTS',
    });

    return {
        id: `tts-${Date.now()}`,
        name: `tts_audio_${prompt.slice(0, 15)}.wav`,
        type: 'audio',
        url: audioUrl,
        source: 'generated',
        duration,
    };
};

export const suggestColorGrade = async (
    imageBase64: string,
    mimeType: string,
): Promise<{ analysis: string; suggestions: Array<{ name: string; filters: any }> }> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() =>
        ai.models.generateContent({
            model: GEMINI_TEXT_MODEL_FLASH,
            contents: {
                parts: [
                    {
                        text: `Analyze color palette. Suggest 3 color grades with JSON {name, filters: {brightness, contrast, saturate, hueRotate}}`,
                    },
                    { inlineData: { data: imageBase64, mimeType } },
                ],
            },
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        analysis: { type: Type.STRING },
                        suggestions: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    name: { type: Type.STRING },
                                    filters: {
                                        type: Type.OBJECT,
                                        properties: {
                                            brightness: { type: Type.NUMBER },
                                            contrast: { type: Type.NUMBER },
                                            saturate: { type: Type.NUMBER },
                                            hueRotate: { type: Type.NUMBER },
                                        },
                                        required: ['brightness', 'contrast', 'saturate', 'hueRotate'],
                                    },
                                },
                                required: ['name', 'filters'],
                            },
                        },
                    },
                    required: ['analysis', 'suggestions'],
                },
            },
        }),
    );

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        throw new Error('Could not understand the AI response for color grading.');
    }
};

export const gradeImageFromPrompt = async (
    imageBase64: string,
    mimeType: string,
    prompt: string,
): Promise<{ filters: any }> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() =>
        ai.models.generateContent({
            model: GEMINI_TEXT_MODEL_FLASH,
            contents: {
                parts: [
                    {
                        text: `Apply color grade based on: "${prompt}". Return JSON {filters: {brightness, contrast, saturate, hueRotate}}.`,
                    },
                    { inlineData: { data: imageBase64, mimeType } },
                ],
            },
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        filters: {
                            type: Type.OBJECT,
                            properties: {
                                brightness: { type: Type.NUMBER },
                                contrast: { type: Type.NUMBER },
                                saturate: { type: Type.NUMBER },
                                hueRotate: { type: Type.NUMBER },
                            },
                            required: ['brightness', 'contrast', 'saturate', 'hueRotate'],
                        },
                    },
                    required: ['filters'],
                },
            },
        }),
    );

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        throw new Error('Could not understand the AI response for prompt-based grading.');
    }
};

export const matchReferenceGrade = async (
    targetBase64: string,
    targetMimeType: string,
    referenceBase64: string,
    referenceMimeType: string,
): Promise<{ filters: any }> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() =>
        ai.models.generateContent({
            model: GEMINI_TEXT_MODEL_FLASH,
            contents: {
                parts: [
                    {
                        text: `Match the color palette of the reference image. The first image is the target frame, the second is the reference still. Return JSON {filters: {brightness, contrast, saturate, hueRotate}}. Keep brightness/contrast/saturate in 0-200 range and hueRotate in 0-360.`,
                    },
                    { inlineData: { data: targetBase64, mimeType: targetMimeType } },
                    { inlineData: { data: referenceBase64, mimeType: referenceMimeType } },
                ],
            },
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        filters: {
                            type: Type.OBJECT,
                            properties: {
                                brightness: { type: Type.NUMBER },
                                contrast: { type: Type.NUMBER },
                                saturate: { type: Type.NUMBER },
                                hueRotate: { type: Type.NUMBER },
                            },
                            required: ['brightness', 'contrast', 'saturate', 'hueRotate'],
                        },
                    },
                    required: ['filters'],
                },
            },
        }),
    );

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        throw new Error('Could not understand the AI response for reference matching.');
    }
};

export const generateMoviePoster = async (bible: StoryBible, references: ReferenceItem[], style: string): Promise<MediaItem> => {
    // 1. Construct context for prompt generation
    const charactersDescription = references
        .filter(r => r.type === 'character')
        .map(r => `${r.name}: ${r.description}`)
        .join('\n');

    const environmentsDescription = references
        .filter(r => r.type === 'environment')
        .map(r => `${r.name}: ${r.description}`)
        .join('\n');

    // 2. Ask Gemini to act as Art Director and write the Image Prompt
    const promptContent = `You are an expert Movie Poster Designer and Art Director.

        **Project Info:**
        Title: "${bible.title || 'Untitled Project'}"
        Logline: "${bible.logline}"
        Style: "${style}"

        **Key Visual Elements:**
        Characters:
        ${charactersDescription}

        Environments:
        ${environmentsDescription}

        **Task:**
        Write a highly detailed, single text-to-image prompt to generate a professional, cinematic movie poster (Aspect Ratio 2:3).

        **Requirements:**
        - Include the title text "${bible.title || 'Untitled'}" prominently in the visual description (e.g. "Bold typography at the bottom reading...").
        - Describe the composition (e.g. "floating heads," "hero silhouette," "ensemble cast," "minimalist symbolic").
        - Define lighting, color palette, and mood matching the logline.
        - Ensure character visual consistency based on the descriptions provided.

        Output ONLY the prompt text.`;

    const imagePrompt = shouldUseReplicateForGoogleModels()
        ? (await generateTextWithGemini3ProReplicate(promptContent)).trim()
        : (await (async () => {
            const ai = getAiClient();
            const promptResponse: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
                model: GEMINI_TEXT_MODEL_PRO,
                contents: promptContent,
            }));
            return promptResponse.text.trim();
        })());

    if (shouldUseReplicateForGoogleModels()) {
        const posterImage = await generateImageWithGemini3ProReplicate(imagePrompt, "3:4", "2K");
        return {
            ...posterImage,
            name: `Poster - ${bible.title || 'Untitled'}.png`,
        };
    }

    // 3. Generate Image with high quality model
    // Using Gemini 3 Pro Image for best text rendering capabilities
    const ai = getAiClient();
    const imageResponse: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: { parts: [{ text: imagePrompt }] },
        config: {
            imageConfig: {
                aspectRatio: "3:4", // Closest to 2:3 poster format available in standard ratios
                imageSize: "2K"
            },
        },
    }));

    const candidate = imageResponse.candidates?.[0];
    if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
            if (part.inlineData) {
                const base64ImageBytes: string = part.inlineData.data;
                const imageUrl = `data:${part.inlineData.mimeType};base64,${base64ImageBytes}`;
                return {
                    id: `poster-${Date.now()}`,
                    name: `Poster - ${bible.title}.png`,
                    type: 'image',
                    url: imageUrl,
                    source: 'generated'
                };
            }
        }
    }
    throw new Error("Failed to generate poster image.");
};

export const analyzeTargetAudience = async (
    scriptText: string,
    targetAudience: string,
    modelId: string = GEMINI_TEXT_MODEL_FLASH
): Promise<string> => {
    const prompt = `
    You are a Marketing Strategist and Content Analyst.
    Analyze the provided video script for its suitability for the specified target audience.

    **Target Audience:** ${targetAudience}

    **Script:**
    ${scriptText.substring(0, 5000)}

    Provide a detailed analysis in Markdown format covering:
    1. **Fit Score:** A score from 1-10 indicating how well the content matches the audience.
    2. **Tone & Language:** Is the vocabulary and tone appropriate?
    3. **Thematic Relevance:** Do the topics resonate with this demographic?
    4. **Engagement Potential:** Will this hold their attention?
    5. **Critical Improvements:** 3-5 specific changes to make it appeal more to this audience.

    Keep the output structured and concise.
    `;

    if (shouldUseReplicateForGoogleModels()) {
        return generateTextWithGemini3ProReplicate(prompt);
    }

    const ai = getAiClient();
    const result: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: modelId,
        contents: {
            parts: [{ text: prompt }]
        }
    }));

    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    return text || "Analysis failed.";
};

export const generateTextWithGemini3Pro = async (prompt: string): Promise<string> => {
    if (shouldUseReplicateForGoogleModels()) {
        return generateTextWithGemini3ProReplicate(prompt);
    }
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: GEMINI_TEXT_MODEL_PRO,
        contents: {
            parts: [{ text: prompt }],
        },
    }));

    return response.text.trim();
};

type DirectorSceneBlock = {
    sceneNumber: number;
    slugline: string;
    text: string;
};

const DIRECTOR_FAST_MODEL_CANDIDATES = [
    GEMINI_TEXT_MODEL_FLASH,
    'gemini-2.5-flash',
    'gemini-2.5-flash-preview',
    'gemini-1.5-flash',
    'gemini-3-pro',
    GEMINI_TEXT_MODEL_PRO,
    'gemini-2.5-pro',
    'gemini-1.5-pro',
];

const DIRECTOR_SCENE_BY_SCENE_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        analysis: {
            type: Type.OBJECT,
            properties: {
                mood: { type: Type.STRING },
                visualTheme: { type: Type.STRING },
                pacing: { type: Type.STRING },
                keySymbols: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['mood', 'visualTheme', 'pacing'],
        },
        shots: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    sceneNumber: { type: Type.NUMBER },
                    sceneSlugline: { type: Type.STRING },
                    sceneShotNumber: { type: Type.NUMBER },
                    shotNumber: { type: Type.NUMBER },
                    description: { type: Type.STRING },
                    rationale: { type: Type.STRING },
                    shotTypePresetId: { type: Type.STRING },
                    lightingPresetId: { type: Type.STRING },
                    cameraAngle: { type: Type.STRING },
                    prompt: { type: Type.STRING },
                    visualTriggers: { type: Type.ARRAY, items: { type: Type.STRING } },
                    characters: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['sceneNumber', 'description', 'rationale', 'shotTypePresetId', 'lightingPresetId', 'prompt'],
            },
        },
    },
    required: ['analysis', 'shots'],
};

const DIRECTOR_CORE_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        analysis: {
            type: Type.OBJECT,
            properties: {
                mood: { type: Type.STRING },
                visualTheme: { type: Type.STRING },
                pacing: { type: Type.STRING },
                keySymbols: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["mood", "visualTheme", "pacing"]
        },
        shots: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    shotNumber: { type: Type.NUMBER },
                    description: { type: Type.STRING },
                    rationale: { type: Type.STRING },
                    shotTypePresetId: { type: Type.STRING },
                    lightingPresetId: { type: Type.STRING },
                    cameraAngle: { type: Type.STRING },
                    prompt: { type: Type.STRING },
                    visualTriggers: { type: Type.ARRAY, items: { type: Type.STRING } },
                    characters: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["shotNumber", "description", "rationale", "shotTypePresetId", "lightingPresetId", "prompt"]
            }
        }
    },
    required: ["analysis", "shots"]
};

const isDirectorPermissionError = (error: unknown) => {
    const message = String((error as any)?.message || error || '');
    return /403|PERMISSION_DENIED|The caller does not have permission/i.test(message);
};

const isLikelyTransientDirectorError = (error: unknown) => {
    const message = String((error as any)?.message || error || '');
    return (
        isModelNotFoundError(error) ||
        isHighDemandModelError(error) ||
        /429|RESOURCE_EXHAUSTED|quota|overloaded|UNAVAILABLE|NOT_FOUND/i.test(message)
    );
};

const generateDirectorChunkJson = async <T>(
    ai: GoogleGenAI,
    prompt: string,
    responseSchema: any,
    label: string,
): Promise<T> => {
    if (shouldUseReplicateForGoogleModels()) {
        const text = await generateTextWithGemini3ProReplicate(prompt, {
            systemPrompt: 'Return only valid JSON. No markdown.',
            temperature: 0.35,
            maxTokens: 2800,
            priority: 'speed',
        });
        return parseJsonFromText<T>(text, label);
    }

    let lastError: unknown;
    for (const modelName of DIRECTOR_FAST_MODEL_CANDIDATES) {
        const isFlashFamily = /flash/i.test(modelName);
        try {
            const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
                model: modelName,
                contents: { role: 'user', parts: [{ text: prompt }] },
                config: {
                    responseMimeType: 'application/json',
                    responseSchema,
                },
            }), isFlashFamily ? 2 : 3, isFlashFamily ? 700 : 1200);
            return parseJsonFromText<T>(String(response.text || ''), label);
        } catch (error) {
            lastError = error;
            if (isDirectorPermissionError(error)) {
                throw error;
            }
            if (isLikelyTransientDirectorError(error)) {
                continue;
            }
            continue;
        }
    }

    throw lastError || new Error('No compatible director model available.');
};

const DIRECTOR_SCENE_HEADER_REGEX = /^\s*(?:\[SCENE\]\s*)?(?:\d{1,4}[A-Z]?(?:[.)-])?\s+)?(?:INT\.?|EXT\.?|INT\/EXT\.?|EXT\/INT\.?|EST\.?|I\/E\.?|E\/I\.?)/i;

const splitScriptIntoDirectorSceneBlocks = (scriptText: string, maxChunkChars = 2600): DirectorSceneBlock[] => {
    const text = (scriptText || '').trim();
    if (!text) return [];

    const lines = text.replace(/\r/g, '\n').split('\n');
    const rawBlocks: Array<{ slugline: string; text: string }> = [];
    let currentSlugline = '';
    let currentLines: string[] = [];
    let detectedHeadings = false;

    const pushCurrent = () => {
        const blockText = currentLines.join('\n').trim();
        if (!blockText) return;
        rawBlocks.push({
            slugline: (currentSlugline || `SCENE ${rawBlocks.length + 1}`).replace(/\s+/g, ' ').trim(),
            text: blockText,
        });
    };

    lines.forEach((line) => {
        const trimmed = line.trim();
        if (DIRECTOR_SCENE_HEADER_REGEX.test(trimmed)) {
            detectedHeadings = true;
            pushCurrent();
            currentSlugline = trimmed.replace(/\s+/g, ' ').trim();
            currentLines = [line];
            return;
        }
        currentLines.push(line);
    });
    pushCurrent();

    const sourceBlocks = detectedHeadings
        ? rawBlocks
        : text
            .split(/\n{2,}/)
            .map((chunk, index) => ({
                slugline: `SCENE ${index + 1}`,
                text: chunk.trim(),
            }))
            .filter((chunk) => chunk.text.length > 0);

    const expanded: DirectorSceneBlock[] = [];
    sourceBlocks.forEach((block, index) => {
        const baseSceneNumber = index + 1;
        if (block.text.length <= maxChunkChars) {
            expanded.push({
                sceneNumber: baseSceneNumber,
                slugline: block.slugline || `SCENE ${baseSceneNumber}`,
                text: block.text,
            });
            return;
        }

        const paragraphs = block.text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
        let buffer = '';
        let partIndex = 1;
        const flush = () => {
            if (!buffer.trim()) return;
            expanded.push({
                sceneNumber: baseSceneNumber,
                slugline: `${block.slugline || `SCENE ${baseSceneNumber}`} (PART ${partIndex})`,
                text: buffer.trim(),
            });
            partIndex += 1;
            buffer = '';
        };

        paragraphs.forEach((paragraph) => {
            if (!buffer) {
                buffer = paragraph;
                return;
            }
            if ((buffer.length + paragraph.length + 2) <= maxChunkChars) {
                buffer = `${buffer}\n\n${paragraph}`;
                return;
            }
            flush();
            if (paragraph.length > maxChunkChars) {
                for (let i = 0; i < paragraph.length; i += maxChunkChars) {
                    expanded.push({
                        sceneNumber: baseSceneNumber,
                        slugline: `${block.slugline || `SCENE ${baseSceneNumber}`} (PART ${partIndex})`,
                        text: paragraph.slice(i, i + maxChunkChars),
                    });
                    partIndex += 1;
                }
            } else {
                buffer = paragraph;
            }
        });
        flush();
    });

    return expanded.length > 0
        ? expanded
        : [{ sceneNumber: 1, slugline: 'SCENE 1', text: text.slice(0, maxChunkChars) }];
};

const buildDirectorSceneBatches = (
    scenes: DirectorSceneBlock[],
    maxBatchChars = 8600,
    maxScenesPerBatch = 5,
): DirectorSceneBlock[][] => {
    if (scenes.length === 0) return [];
    const batches: DirectorSceneBlock[][] = [];
    let current: DirectorSceneBlock[] = [];
    let currentChars = 0;

    const flush = () => {
        if (current.length > 0) batches.push(current);
        current = [];
        currentChars = 0;
    };

    scenes.forEach((scene) => {
        const nextChars = currentChars + scene.text.length;
        const shouldFlush = current.length > 0 && (nextChars > maxBatchChars || current.length >= maxScenesPerBatch);
        if (shouldFlush) flush();
        current.push(scene);
        currentChars += scene.text.length;
    });
    flush();

    return batches.length > 0 ? batches : [scenes];
};

export const generateViMaxStoryboardSceneByScene = async (
    scriptText: string,
    context?: { style?: string; period?: string; references?: string[] },
    onProgress?: (msg: string) => void
): Promise<DirectorTreatment> => {
    onProgress?.('Initializing Director Agent (Scene-by-Scene)...');
    const sceneBlocks = splitScriptIntoDirectorSceneBlocks(scriptText, 2600);
    if (sceneBlocks.length <= 1) {
        return generateViMaxStoryboard(scriptText, context, onProgress);
    }

    const ai = getAiClient();
    const styleHint = context?.style ? `**Visual Style Directive:** ${context.style}` : '';
    const periodHint = context?.period ? `**Period/Setting:** ${context.period}` : '';
    const referencesHint = context?.references?.length
        ? `**Reference Keywords:** ${context.references.join(', ')}`
        : '';
    const contextBlock = [styleHint, periodHint, referencesHint].filter(Boolean).join('\n');
    const batches = buildDirectorSceneBatches(sceneBlocks, 8600, 5);
    const sceneOrder = new Map<number, number>();
    sceneBlocks.forEach((scene, index) => {
        if (!sceneOrder.has(scene.sceneNumber)) sceneOrder.set(scene.sceneNumber, index);
    });

    const mergedSymbols = new Set<string>();
    const collectedShots: DirectorTreatment['shots'] = [];
    let analysis: DirectorTreatment['analysis'] | null = null;

    const buildPrompt = (batch: DirectorSceneBlock[], batchIndex: number, totalBatches: number) => `
You are an autonomous AI Director and Cinematographer.
Generate a scene-specific treatment and shot list for the provided scene batch.

${contextBlock}

**BATCH ${batchIndex + 1} of ${totalBatches}**
Rules:
1. Generate shots for each listed scene number.
2. Every output shot MUST include the correct "sceneNumber" from the input list.
3. sceneShotNumber starts at 1 for each scene and increments without gaps.
4. Include enough coverage for editorial flexibility. Prefer more shots over fewer shots.
5. Keep strict continuity inside each scene.

Authorized presets:
- ShotType: closeup, extreme_closeup, portrait, medium, full_body, wide, extreme_wide, low_angle, overhead, ots, b_roll
- Lighting: golden, studio, cinematic, neon, dramatic, fantasy, natural

Return JSON only:
{
  "analysis": { "mood": "...", "visualTheme": "...", "pacing": "...", "keySymbols": ["..."] },
  "shots": [
    {
      "sceneNumber": 12,
      "sceneSlugline": "INT. HOUSE - NIGHT",
      "sceneShotNumber": 1,
      "shotNumber": 1,
      "description": "...",
      "rationale": "...",
      "shotTypePresetId": "medium",
      "lightingPresetId": "cinematic",
      "cameraAngle": "...",
      "prompt": "...",
      "visualTriggers": ["..."],
      "characters": ["..."]
    }
  ]
}

Scene list:
${batch.map((scene) => `- Scene ${scene.sceneNumber}: ${scene.slugline}`).join('\n')}

Script batch:
${batch.map((scene) => `\n### SCENE ${scene.sceneNumber} | ${scene.slugline}\n${scene.text}`).join('\n')}
`;

    for (let i = 0; i < batches.length; i += 1) {
        const batch = batches[i];
        const progressLabel = `${i + 1}/${batches.length}`;
        const sceneRange = `${batch[0]?.sceneNumber}-${batch[batch.length - 1]?.sceneNumber}`;
        onProgress?.(`Director Agent analyzing scenes ${sceneRange} (${progressLabel})...`);

        const prompt = buildPrompt(batch, i, batches.length);
        const batchResult = await generateDirectorChunkJson<DirectorTreatment>(
            ai,
            prompt,
            DIRECTOR_SCENE_BY_SCENE_RESPONSE_SCHEMA,
            'ViMaxStoryboardSceneByScene',
        );

        if (!analysis) {
            analysis = batchResult.analysis;
        }
        (batchResult.analysis?.keySymbols || []).forEach((symbol) => mergedSymbols.add(symbol));

        const validSceneNumbers = new Set(batch.map((scene) => scene.sceneNumber));
        const batchSceneByNumber = new Map(batch.map((scene) => [scene.sceneNumber, scene]));
        (batchResult.shots || []).forEach((shot, index) => {
            const sceneNumber = Number.isFinite(shot.sceneNumber) && validSceneNumbers.has(Number(shot.sceneNumber))
                ? Number(shot.sceneNumber)
                : batch[0].sceneNumber;
            const sceneSlugline = (shot.sceneSlugline || batchSceneByNumber.get(sceneNumber)?.slugline || '').trim();
            const sceneShotNumber = Number.isFinite(shot.sceneShotNumber) ? Number(shot.sceneShotNumber) : undefined;
            collectedShots.push({
                ...shot,
                sceneNumber,
                sceneSlugline,
                sceneShotNumber,
                shotNumber: Number.isFinite(shot.shotNumber) ? shot.shotNumber : (index + 1),
            });
        });
    }

    const byScene = new Map<number, DirectorTreatment['shots']>();
    collectedShots.forEach((shot) => {
        const sceneNumber = Number.isFinite(shot.sceneNumber) ? Number(shot.sceneNumber) : 1;
        const list = byScene.get(sceneNumber) || [];
        list.push(shot);
        byScene.set(sceneNumber, list);
    });

    const allSceneNumbers = Array.from(new Set(sceneBlocks.map((scene) => scene.sceneNumber)));
    const orderedSceneNumbers = allSceneNumbers.sort((a, b) => {
        const aOrder = sceneOrder.get(a) ?? Number.MAX_SAFE_INTEGER;
        const bOrder = sceneOrder.get(b) ?? Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a - b;
    });

    const finalShots: DirectorTreatment['shots'] = [];
    let globalShotNumber = 1;
    orderedSceneNumbers.forEach((sceneNumber) => {
        const generatedSceneShots = (byScene.get(sceneNumber) || []).sort((a, b) => {
            const aSceneShot = Number.isFinite(a.sceneShotNumber) ? Number(a.sceneShotNumber) : Number.MAX_SAFE_INTEGER;
            const bSceneShot = Number.isFinite(b.sceneShotNumber) ? Number(b.sceneShotNumber) : Number.MAX_SAFE_INTEGER;
            if (aSceneShot !== bSceneShot) return aSceneShot - bSceneShot;
            return (a.shotNumber || 0) - (b.shotNumber || 0);
        });
        const baseSlugline = sceneBlocks.find((scene) => scene.sceneNumber === sceneNumber)?.slugline || `SCENE ${sceneNumber}`;
        const sceneShots = generatedSceneShots.length > 0
            ? generatedSceneShots
            : [{
                shotNumber: 1,
                sceneNumber,
                sceneSlugline: baseSlugline,
                sceneShotNumber: 1,
                description: `Editorial fallback coverage for ${baseSlugline}`,
                rationale: 'Fallback shot because this scene had no generated coverage in the model response.',
                shotTypePresetId: 'wide',
                lightingPresetId: 'natural',
                cameraAngle: 'eye-level',
                prompt: `Cinematic wide establishing shot, ${baseSlugline}, coherent continuity, production-ready storyboard frame`,
                visualTriggers: [],
                characters: [],
            }];

        sceneShots.forEach((shot, index) => {
            const sceneShotNumber = index + 1;
            finalShots.push({
                ...shot,
                shotNumber: globalShotNumber,
                sceneNumber,
                sceneShotNumber,
                shotLabel: `${sceneNumber}.${sceneShotNumber}`,
            });
            globalShotNumber += 1;
        });
    });

    return {
        analysis: {
            mood: analysis?.mood || '',
            visualTheme: analysis?.visualTheme || '',
            pacing: analysis?.pacing || '',
            keySymbols: Array.from(mergedSymbols),
        },
        shots: finalShots,
    };
};

export const generateViMaxStoryboard = async (
    scriptText: string,
    context?: { style?: string; period?: string; references?: string[] },
    onProgress?: (msg: string) => void
): Promise<DirectorTreatment> => {
    onProgress?.("Initializing Director Agent (ViMax Core)...");
    const ai = getAiClient();

    const styleHint = context?.style ? `**Visual Style Directive:** ${context.style}` : '';
    const periodHint = context?.period ? `**Period/Setting:** ${context.period}` : '';
    const referencesHint = context?.references?.length
        ? `**Reference Keywords:** ${context.references.join(', ')}`
        : '';
    const contextBlock = [styleHint, periodHint, referencesHint].filter(Boolean).join('\n');

    const buildPrompt = (chunk: string, chunkIndex: number, totalChunks: number) => `
    You are an autonomous AI Director and Cinematographer (Modeled after ViMax Agentic Framework).
    Your task is to translate a raw script/concept into a "Director's Treatment" and a precision Storyboard.

    ${contextBlock}

    **CHUNK ${chunkIndex + 1} of ${totalChunks}**
    Only generate shots for this script chunk. Do not repeat shots from earlier chunks.
    Coverage is mandatory: do not skip beats in this chunk.

    **PHASE 1: SCRIPT ANALYSIS (The "Director" Agent)**
    - Analyze the *Subtext*, *Mood*, and *Pacing* for this chunk.
    - Identify key *Visual Symbols*.

    **PHASE 2: SHOT CONSTRUCTION (The "Cinematographer" Agent)**
    - Break the script into shots.
    - For EACH shot, you MUST select a **Shot Type Preset** and a **Lighting Preset** from the authorized list below.
    - Explain your rationale (Why this angle? Why this light?).
    - Include every meaningful action beat, dialogue turn, location change, or character entrance/exit from this chunk.
    - If this chunk contains multiple scene headings, output at least one shot per scene heading.
    - Prefer more shots over fewer shots when uncertain.

    **AUTHORIZED PRESETS (Strict Enforce):**
    [SHOT TYPES]
    - closeup, extreme_closeup, portrait, medium, full_body
    - wide, extreme_wide, low_angle, overhead, ots, b_roll

    [LIGHTING TYPES]
    - golden (Warm/Sunset), studio (Clean/Softbox), cinematic (Moody/Tungsten)
    - neon (Cyberpunk/Pink+Blue), dramatic (Low Key/Shadows)
    - fantasy (Ethereal/Gold), natural (Window/Daylight)

    **OUTPUT FORMAT:**
    Return strictly JSON matching this schema:
    {
        "analysis": {
            "mood": "...",
            "visualTheme": "...",
            "pacing": "...",
            "keySymbols": ["..."]
        },
        "shots": [
            {
                "shotNumber": 1,
                "description": "...",
                "rationale": "...",
                "shotTypePresetId": "MUST_BE_FROM_LIST",
                "lightingPresetId": "MUST_BE_FROM_LIST",
                "cameraAngle": "...",
                "prompt": "Full detailed image generation prompt...",
                "visualTriggers": ["..."],
                "characters": ["..."]
            }
        ]
    }

    **SCRIPT CHUNK:**
    ${chunk}
    `;

    const splitIntoChunks = (text: string, maxChunkChars = 4200) => {
        if (text.length <= maxChunkChars) return [text];
        const sceneHeader = /^\s*(INT\.|EXT\.|INT\/EXT\.|EST\.|I\/E\.)/i;
        const lines = text.split(/\r?\n/);
        const scenes: string[] = [];
        let current: string[] = [];
        let hasSceneHeaders = false;

        lines.forEach((line) => {
            if (sceneHeader.test(line.trim())) {
                hasSceneHeaders = true;
                if (current.length) scenes.push(current.join('\n'));
                current = [line];
            } else {
                current.push(line);
            }
        });
        if (current.length) scenes.push(current.join('\n'));

        const chunks: string[] = [];
        const source = hasSceneHeaders ? scenes : text.split(/\n{2,}/);
        let buffer = '';

        const flush = () => {
            if (buffer.trim()) chunks.push(buffer.trim());
            buffer = '';
        };

        source.forEach((block) => {
            if (!block.trim()) return;
            if (!buffer) {
                buffer = block;
                return;
            }
            if ((buffer.length + block.length + 2) <= maxChunkChars) {
                buffer = `${buffer}\n\n${block}`;
                return;
            }
            flush();
            if (block.length > maxChunkChars) {
                for (let i = 0; i < block.length; i += maxChunkChars) {
                    chunks.push(block.slice(i, i + maxChunkChars));
                }
                buffer = '';
            } else {
                buffer = block;
            }
        });
        flush();
        return chunks.length ? chunks : [text.slice(0, maxChunkChars)];
    };

    const chunks = splitIntoChunks(scriptText, 4200);
    const mergedShots: DirectorTreatment['shots'] = [];
    const mergedSymbols = new Set<string>();
    let analysis: DirectorTreatment['analysis'] | null = null;

    try {
        for (let i = 0; i < chunks.length; i += 1) {
            onProgress?.(`Director Agent is analyzing chunk ${i + 1} / ${chunks.length}...`);
            const prompt = buildPrompt(chunks[i], i, chunks.length);
            const chunkResult = await generateDirectorChunkJson<DirectorTreatment>(
                ai,
                prompt,
                DIRECTOR_CORE_RESPONSE_SCHEMA,
                'ViMaxStoryboard',
            );

            if (!analysis) {
                analysis = chunkResult.analysis;
            }
            (chunkResult.analysis?.keySymbols || []).forEach((symbol) => mergedSymbols.add(symbol));
            if (Array.isArray(chunkResult.shots)) {
                mergedShots.push(...chunkResult.shots);
            }
        }

        const normalizedShotKey = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
        const dedupedShots = mergedShots.filter((shot, index) => {
            const key = `${normalizedShotKey(shot.description || '')}|${normalizedShotKey(shot.prompt || '').slice(0, 240)}`;
            return mergedShots.findIndex((candidate) => {
                const candidateKey = `${normalizedShotKey(candidate.description || '')}|${normalizedShotKey(candidate.prompt || '').slice(0, 240)}`;
                return candidateKey === key;
            }) === index;
        });

        const reindexedShots = dedupedShots.map((shot, index) => ({
            ...shot,
            shotNumber: index + 1,
        }));

        return {
            analysis: {
                mood: analysis?.mood || '',
                visualTheme: analysis?.visualTheme || '',
                pacing: analysis?.pacing || '',
                keySymbols: Array.from(mergedSymbols),
            },
            shots: reindexedShots,
        };
    } catch (error) {
        console.error("ViMax Storyboard Generation Failed:", error);
        throw error;
    }
};
