/**
 * World Labs API Service
 *
 * Generates 3D explorable worlds from text, images, multi-images, and video
 * using the Marble World Model.
 *
 * API Documentation: https://docs.worldlabs.ai/api
 * Platform: https://platform.worldlabs.ai
 */

import { recordUsage } from '../utils/usageTracker';
import { byokProxyJson, shouldUseByokProxy } from './byokProxyClient';
import {
    DEFAULT_WORLD_MODEL_ID,
    normalizeWorldModelId,
    type AnyWorldModelId,
} from './worldModelProviderRegistry';

// API Configuration
const WORLD_LABS_API_BASE = 'https://api.worldlabs.ai/marble/v1';

// Available Models
export const MARBLE_MODELS = {
    PLUS: 'marble-1.1-plus',
    STANDARD: 'marble-1.1',
    LEGACY: 'marble-1.0',
    DRAFT: 'marble-1.0-draft',
    MINI: 'marble-1.0-draft', // Backward-compatible alias for older UI code
} as const;

export type MarbleModel = AnyWorldModelId;

// World Prompt Types
export type WorldPromptType = 'text' | 'image' | 'multi-image' | 'video';

// Input Types
export interface TextPromptInput {
    type: 'text';
    text_prompt: string;
}

export interface ImageSource {
    source: 'uri' | 'media_asset';
    uri?: string;
    media_asset?: {
        media_asset_id: string;
    };
}

export interface ImagePromptInput {
    type: 'image';
    image_prompt: ImageSource;
    text_prompt?: string;
    is_pano?: boolean;  // Set to true for 360° panoramas
}

export interface MultiImageItem {
    azimuth: 0 | 90 | 180 | 270;  // Camera angle: front, right, back, left
    content: ImageSource;
}

export interface MultiImagePromptInput {
    type: 'multi-image';
    multi_image_prompt: MultiImageItem[];
    text_prompt?: string;
}

export interface VideoPromptInput {
    type: 'video';
    video_prompt: ImageSource;
    text_prompt?: string;
}

export type WorldPrompt =
    | TextPromptInput
    | ImagePromptInput
    | MultiImagePromptInput
    | VideoPromptInput;

// Response Types
export interface WorldAssets {
    caption: string;
    thumbnail_url: string;
    splats: {
        spz_urls: {
            '100k': string;
            '500k': string;
            'full_res': string;
        };
    };
    mesh?: {
        collider_mesh_url?: string;
        collider_mesh?: string;
        mesh_url?: string;
        url?: string;
    };
    imagery?: {
        pano_url?: string;
        panorama_url?: string;
    };
}

export interface GeneratedWorld {
    id: string;
    display_name: string;
    tags: string[] | null;
    world_marble_url: string;  // URL to view in browser
    assets: WorldAssets;
    created_at: string;
    updated_at: string;
    permission: string | null;
    world_prompt: WorldPrompt | null;
    model: MarbleModel;
}

export interface OperationProgress {
    status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';
    description: string;
}

export interface WorldOperation {
    operation_id: string;
    created_at: string;
    updated_at: string;
    expires_at: string;
    done: boolean;
    error: string | null;
    metadata: {
        progress: OperationProgress;
        world_id: string;
    } | null;
    response: GeneratedWorld | null;
}

export interface MediaAsset {
    id: string;
    file_name: string;
    kind: 'image' | 'video';
    extension: string;
    created_at: string;
    updated_at: string | null;
    metadata: any | null;
}

export interface UploadInfo {
    upload_url: string;
    upload_method: 'PUT';
    required_headers: Record<string, string>;
}

export interface PrepareUploadResponse {
    media_asset: MediaAsset;
    upload_info: UploadInfo;
}

function getWorldLabsApiKeyOptional(): string | null {
    return localStorage.getItem('worldlabs_api_key');
}

export function setWorldLabsApiKey(key: string): void {
    localStorage.setItem('worldlabs_api_key', key);
}

export function hasWorldLabsApiKey(): boolean {
    return !!localStorage.getItem('worldlabs_api_key');
}

async function worldLabsFetchJson<T>(
    path: string,
    options: RequestInit,
    usage: { kind: string; model: string; units?: number; billable?: boolean; note?: string }
): Promise<T> {
    const key = getWorldLabsApiKeyOptional();
    const method = (options.method || 'GET').toUpperCase();

    if (!key && shouldUseByokProxy('worldlabs')) {
        let body: any = options.body;
        if (typeof body === 'string') {
            try {
                body = JSON.parse(body);
            } catch {
                body = body;
            }
        }

        return byokProxyJson<T>({
            provider: 'worldlabs',
            url: `${WORLD_LABS_API_BASE}${path}`,
            method,
            headers: (options.headers || {}) as Record<string, string>,
            body,
            usage: {
                kind: usage.kind,
                model: usage.model,
                units: usage.units || 1,
            },
            meta: {
                billable: usage.billable ?? !['GET', 'HEAD'].includes(method),
                note: usage.note || `WorldLabs ${path}`,
            },
        });
    }

    if (!key) {
        throw new Error('World Labs API key not set. Please configure it in Settings.');
    }

    const response = await fetch(`${WORLD_LABS_API_BASE}${path}`, {
        ...options,
        headers: {
            ...(options.headers || {}),
            'WLT-Api-Key': key,
        },
    });

    if (!response.ok) {
        const error = await response.text().catch(() => response.statusText);
        throw new Error(`World Labs request failed (${response.status}): ${error}`);
    }
    return response.json() as Promise<T>;
}

// Core API Functions

/**
 * Generate a 3D world from a prompt
 */
export async function generateWorld(
    displayName: string,
    worldPrompt: WorldPrompt,
    model: MarbleModel = DEFAULT_WORLD_MODEL_ID
): Promise<WorldOperation> {
    const modelId = normalizeWorldModelId(model);
    const operation = await worldLabsFetchJson<WorldOperation>(
        '/worlds:generate',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                display_name: displayName,
                world_prompt: worldPrompt,
                model: modelId,
            }),
        },
        {
            kind: '3d-world',
            model: modelId,
            units: 1,
            billable: true,
            note: `World generation: ${displayName}`,
        },
    );

    // Record usage
    recordUsage({
        provider: 'worldlabs',
        model: modelId,
        kind: '3d-world',
        units: 1,
        unitLabel: 'request',
        note: `World generation: ${displayName}`,
    });

    return operation;
}

/**
 * Poll operation status until complete
 */
export async function waitForOperation(
    operationId: string,
    pollIntervalMs: number = 3000,
    maxWaitMs: number = 300000  // 5 minutes max
): Promise<WorldOperation> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
        const operation = await worldLabsFetchJson<WorldOperation>(
            `/operations/${operationId}`,
            {
                method: 'GET',
            },
            {
                kind: 'other',
                model: 'worldlabs/operation-status',
                units: 1,
                billable: false,
                note: 'WorldLabs operation status',
            },
        );

        if (operation.done) {
            if (operation.error) {
                throw new Error(`World generation failed: ${operation.error}`);
            }
            return operation;
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error('World generation timed out');
}

/**
 * Get a specific world by ID
 */
export async function getWorld(worldId: string): Promise<GeneratedWorld> {
    const data = await worldLabsFetchJson<{ world: GeneratedWorld }>(
        `/worlds/${worldId}`,
        { method: 'GET' },
        {
            kind: 'other',
            model: 'worldlabs/get-world',
            units: 1,
            billable: false,
            note: 'WorldLabs get world',
        },
    );
    return data.world;
}

/**
 * Prepare a media asset upload (for images/videos from local files)
 */
export async function prepareUpload(
    fileName: string,
    kind: 'image' | 'video',
    extension: string
): Promise<PrepareUploadResponse> {
    return worldLabsFetchJson<PrepareUploadResponse>(
        '/media-assets:prepare_upload',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ file_name: fileName, kind, extension }),
        },
        {
            kind: 'other',
            model: 'worldlabs/prepare-upload',
            units: 1,
            billable: false,
            note: 'WorldLabs prepare upload',
        },
    );
}

/**
 * Upload a file to the prepared URL
 */
export async function uploadFile(
    uploadUrl: string,
    file: Blob | ArrayBuffer,
    requiredHeaders: Record<string, string>
): Promise<void> {
    const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: requiredHeaders,
        body: file,
    });

    if (!response.ok) {
        throw new Error(`File upload failed: ${response.statusText}`);
    }
}

// High-Level Convenience Functions

/**
 * Generate a 3D world from text prompt
 */
export async function generateWorldFromText(
    name: string,
    textPrompt: string,
    model: MarbleModel = DEFAULT_WORLD_MODEL_ID,
    onProgress?: (status: string) => void
): Promise<GeneratedWorld> {
    onProgress?.('Starting world generation...');

    const operation = await generateWorld(name, {
        type: 'text',
        text_prompt: textPrompt,
    }, model);

    onProgress?.('Generating 3D world...');

    const completed = await waitForOperation(operation.operation_id, 3000, 300000);

    onProgress?.('World generation complete!');

    return completed.response!;
}

/**
 * Generate a 3D world from an image URL
 */
export async function generateWorldFromImageUrl(
    name: string,
    imageUrl: string,
    textPrompt?: string,
    isPano: boolean = false,
    model: MarbleModel = DEFAULT_WORLD_MODEL_ID,
    onProgress?: (status: string) => void
): Promise<GeneratedWorld> {
    onProgress?.('Starting world generation from image...');

    const worldPrompt: ImagePromptInput = {
        type: 'image',
        image_prompt: {
            source: 'uri',
            uri: imageUrl,
        },
        text_prompt: textPrompt,
        is_pano: isPano,
    };

    const operation = await generateWorld(name, worldPrompt, model);

    onProgress?.('Generating 3D world from image...');

    const completed = await waitForOperation(operation.operation_id, 3000, 300000);

    onProgress?.('World generation complete!');

    return completed.response!;
}

/**
 * Generate a 3D world from a local image file
 */
export async function generateWorldFromImageFile(
    name: string,
    file: File,
    textPrompt?: string,
    isPano: boolean = false,
    model: MarbleModel = DEFAULT_WORLD_MODEL_ID,
    onProgress?: (status: string) => void
): Promise<GeneratedWorld> {
    onProgress?.('Uploading image...');

    // Prepare upload
    const ext = file.name.split('.').pop() || 'jpg';
    const prepareResult = await prepareUpload(file.name, 'image', ext);

    // Upload file
    await uploadFile(
        prepareResult.upload_info.upload_url,
        file,
        prepareResult.upload_info.required_headers
    );

    onProgress?.('Starting world generation...');

    // Generate world using the uploaded asset
    const worldPrompt: ImagePromptInput = {
        type: 'image',
        image_prompt: {
            source: 'media_asset',
            media_asset: { media_asset_id: prepareResult.media_asset.id },
        },
        text_prompt: textPrompt,
        is_pano: isPano,
    };

    const operation = await generateWorld(name, worldPrompt, model);

    onProgress?.('Generating 3D world...');

    const completed = await waitForOperation(operation.operation_id, 3000, 300000);

    onProgress?.('World generation complete!');

    return completed.response!;
}

/**
 * Generate a 3D world from multiple images (different angles)
 */
export async function generateWorldFromMultiImage(
    name: string,
    images: { azimuth: 0 | 90 | 180 | 270; url: string }[],
    textPrompt?: string,
    model: MarbleModel = DEFAULT_WORLD_MODEL_ID,
    onProgress?: (status: string) => void
): Promise<GeneratedWorld> {
    onProgress?.('Starting multi-image world generation...');

    const worldPrompt: MultiImagePromptInput = {
        type: 'multi-image',
        multi_image_prompt: images.map(img => ({
            azimuth: img.azimuth,
            content: {
                source: 'uri' as const,
                uri: img.url,
            },
        })),
        text_prompt: textPrompt,
    };

    const operation = await generateWorld(name, worldPrompt, model);

    onProgress?.('Generating 3D world from multiple images...');

    const completed = await waitForOperation(operation.operation_id, 3000, 300000);

    onProgress?.('World generation complete!');

    return completed.response!;
}

/**
 * Generate a 3D world from a video URL
 */
export async function generateWorldFromVideoUrl(
    name: string,
    videoUrl: string,
    textPrompt?: string,
    model: MarbleModel = DEFAULT_WORLD_MODEL_ID,
    onProgress?: (status: string) => void
): Promise<GeneratedWorld> {
    onProgress?.('Starting world generation from video...');

    const worldPrompt: VideoPromptInput = {
        type: 'video',
        video_prompt: {
            source: 'uri',
            uri: videoUrl,
        },
        text_prompt: textPrompt,
    };

    const operation = await generateWorld(name, worldPrompt, model);

    onProgress?.('Generating 3D world from video...');

    const completed = await waitForOperation(operation.operation_id, 3000, 300000);

    onProgress?.('World generation complete!');

    return completed.response!;
}

/**
 * Download world assets (splats, mesh, pano)
 */
export function getWorldAssetUrls(world: GeneratedWorld) {
    const assets = world.assets || (world as any).world_assets || (world as any).data?.assets || (world as any).result?.assets || {};
    const mesh = assets.mesh || (world as any).mesh || {};
    const imagery = assets.imagery || (world as any).imagery || {};
    const meshUrl =
        mesh.collider_mesh_url ||
        mesh.collider_mesh ||
        mesh.mesh_url ||
        mesh.url ||
        assets.collider_mesh_url ||
        assets.mesh_url ||
        undefined;
    const panoramaUrl = imagery.pano_url || imagery.panorama_url || assets.pano_url || assets.panorama_url || undefined;
    return {
        // Gaussian Splat files (for 3D rendering)
        splat100k: assets.splats?.spz_urls?.['100k'],
        splat500k: assets.splats?.spz_urls?.['500k'],
        splatFullRes: assets.splats?.spz_urls?.['full_res'],

        // Mesh for physics/collisions (GLB format)
        colliderMesh: meshUrl,

        // Panorama image
        panorama: panoramaUrl,

        // Thumbnail
        thumbnail: assets.thumbnail_url || (world as any).thumbnail_url,

        // View in browser
        viewUrl: world.world_marble_url || (world as any).view_url || (world as any).viewer_url,
    };
}
