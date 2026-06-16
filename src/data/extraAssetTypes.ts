/**
 * Extra Asset Types and Utilities
 *
 * Provides helper functions and defaults for movie posters, thumbnails,
 * social media assets, and promotional materials.
 */

import type { ExtraAsset, ExtraAssetCategory, ExtraAssetsState } from '../types';

// ============================================
// Asset Categories
// ============================================

export interface ExtraAssetCategoryInfo {
    id: ExtraAssetCategory;
    label: string;
    icon: string;
    description: string;
    color: string;
    defaultAspectRatio: string;
}

export const EXTRA_ASSET_CATEGORIES: ExtraAssetCategoryInfo[] = [
    {
        id: 'poster',
        label: 'Movie Poster',
        icon: '🎬',
        description: 'Official movie posters for marketing and theatrical release',
        color: '#ef4444',
        defaultAspectRatio: '2:3',
    },
    {
        id: 'thumbnail',
        label: 'Thumbnail',
        icon: '📷',
        description: 'Video thumbnails for YouTube, streaming platforms, etc.',
        color: '#3b82f6',
        defaultAspectRatio: '16:9',
    },
    {
        id: 'social_media',
        label: 'Social Media',
        icon: '📱',
        description: 'Assets for Instagram, TikTok, Twitter, and other platforms',
        color: '#8b5cf6',
        defaultAspectRatio: '1:1',
    },
    {
        id: 'promo',
        label: 'Promo Material',
        icon: '📢',
        description: 'Banner ads, key art, and promotional graphics',
        color: '#f59e0b',
        defaultAspectRatio: '16:9',
    },
    {
        id: 'custom',
        label: 'Custom',
        icon: '✨',
        description: 'Custom marketing or promotional assets',
        color: '#6366f1',
        defaultAspectRatio: '1:1',
    },
];

// ============================================
// Aspect Ratio Presets
// ============================================

export interface AspectRatioPreset {
    id: string;
    label: string;
    ratio: string;
    width: number;
    height: number;
    description: string;
}

export const ASPECT_RATIO_PRESETS: AspectRatioPreset[] = [
    { id: 'poster-2x3', label: 'Movie Poster', ratio: '2:3', width: 1000, height: 1500, description: 'Standard theatrical poster' },
    { id: 'poster-27x40', label: 'One-Sheet', ratio: '27:40', width: 1080, height: 1600, description: 'US theatrical one-sheet' },
    { id: 'landscape-16x9', label: '16:9 Landscape', ratio: '16:9', width: 1920, height: 1080, description: 'HD video thumbnail' },
    { id: 'landscape-21x9', label: 'Ultrawide', ratio: '21:9', width: 2560, height: 1080, description: 'Cinematic banner' },
    { id: 'square-1x1', label: 'Square', ratio: '1:1', width: 1080, height: 1080, description: 'Instagram/social post' },
    { id: 'portrait-9x16', label: '9:16 Portrait', ratio: '9:16', width: 1080, height: 1920, description: 'Stories/Reels/TikTok' },
    { id: 'portrait-4x5', label: '4:5 Portrait', ratio: '4:5', width: 1080, height: 1350, description: 'Instagram portrait' },
    { id: 'banner-3x1', label: 'Banner', ratio: '3:1', width: 1500, height: 500, description: 'Twitter/X header' },
    { id: 'banner-16x3', label: 'Wide Banner', ratio: '16:3', width: 1920, height: 360, description: 'YouTube banner' },
];

// ============================================
// Default Values
// ============================================

export const DEFAULT_EXTRA_ASSETS_STATE: ExtraAssetsState = {
    assets: [],
};

// ============================================
// Factory Functions
// ============================================

let assetIdCounter = 0;

export const generateAssetId = (): string => {
    return `asset-${Date.now()}-${++assetIdCounter}`;
};

export const createExtraAsset = (
    category: ExtraAssetCategory,
    name: string,
    overrides?: Partial<ExtraAsset>
): ExtraAsset => {
    const categoryInfo = EXTRA_ASSET_CATEGORIES.find((c) => c.id === category);
    return {
        id: generateAssetId(),
        category,
        name,
        description: '',
        imageUrl: undefined,
        imageVersions: [],
        selectedVersionIndex: 0,
        generatedBy: undefined,
        linkedConceptIds: [],
        linkedShotNumbers: [],
        linkedScriptExcerpt: undefined,
        aspectRatio: categoryInfo?.defaultAspectRatio || '16:9',
        createdAt: new Date().toISOString(),
        isGenerating: false,
        ...overrides,
    };
};

// ============================================
// Utility Functions
// ============================================

export const getCategoryInfo = (category: ExtraAssetCategory): ExtraAssetCategoryInfo | undefined => {
    return EXTRA_ASSET_CATEGORIES.find((c) => c.id === category);
};

export const getAssetsByCategory = (state: ExtraAssetsState, category: ExtraAssetCategory): ExtraAsset[] => {
    return state.assets.filter((a) => a.category === category);
};

export const getAssetById = (state: ExtraAssetsState, id: string): ExtraAsset | undefined => {
    return state.assets.find((a) => a.id === id);
};

export const getAssetsLinkedToShot = (state: ExtraAssetsState, shotNumber: number): ExtraAsset[] => {
    return state.assets.filter((a) => a.linkedShotNumbers?.includes(shotNumber));
};

export const getAssetsLinkedToConcept = (state: ExtraAssetsState, conceptId: string): ExtraAsset[] => {
    return state.assets.filter((a) => a.linkedConceptIds?.includes(conceptId));
};

export const getAspectRatioPreset = (ratio: string): AspectRatioPreset | undefined => {
    return ASPECT_RATIO_PRESETS.find((p) => p.ratio === ratio);
};

export const getAspectRatioForCategory = (category: ExtraAssetCategory): string => {
    const categoryInfo = getCategoryInfo(category);
    return categoryInfo?.defaultAspectRatio || '16:9';
};

/**
 * Builds an AI prompt for generating an extra asset based on context
 */
export const buildExtraAssetPrompt = (
    asset: ExtraAsset,
    context: {
        projectTitle?: string;
        logline?: string;
        style?: string;
        linkedCharacterNames?: string[];
        linkedEnvironmentNames?: string[];
    }
): string => {
    const parts: string[] = [];

    // Category-specific base prompt
    switch (asset.category) {
        case 'poster':
            parts.push('Create a professional movie poster design');
            break;
        case 'thumbnail':
            parts.push('Create an attention-grabbing video thumbnail');
            break;
        case 'social_media':
            parts.push('Create a visually striking social media graphic');
            break;
        case 'promo':
            parts.push('Create a promotional marketing graphic');
            break;
        default:
            parts.push('Create a marketing asset');
    }

    // Add project context
    if (context.projectTitle) {
        parts.push(`for "${context.projectTitle}"`);
    }

    if (context.logline) {
        parts.push(`. Story: ${context.logline}`);
    }

    if (context.style) {
        parts.push(`. Style: ${context.style}`);
    }

    // Add character references
    if (context.linkedCharacterNames && context.linkedCharacterNames.length > 0) {
        parts.push(`. Featuring: ${context.linkedCharacterNames.join(', ')}`);
    }

    // Add environment references
    if (context.linkedEnvironmentNames && context.linkedEnvironmentNames.length > 0) {
        parts.push(`. Setting: ${context.linkedEnvironmentNames.join(', ')}`);
    }

    // Add asset-specific description
    if (asset.description) {
        parts.push(`. ${asset.description}`);
    }

    // Add script excerpt if available
    if (asset.linkedScriptExcerpt) {
        parts.push(`. Key moment: "${asset.linkedScriptExcerpt}"`);
    }

    return parts.join('');
};
