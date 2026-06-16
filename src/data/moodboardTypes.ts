/**
 * Moodboard Category Types
 *
 * Defines the structure for organizing moodboard images
 * into production-relevant categories.
 */

export type MoodboardCategoryId =
    | 'color_palette'
    | 'lighting'
    | 'composition'
    | 'environment'
    | 'set_design'
    | 'architecture'
    | 'character_design'
    | 'costume'
    | 'hair_makeup'
    | 'sound_design'
    | 'music'
    | 'vfx'
    | 'editing'
    | 'world_building'
    | 'uncategorized'
    | 'custom';

export interface MoodboardCategory {
    id: MoodboardCategoryId | string;
    label: string;
    icon: string;
    description: string;
    color?: string;
    isCustom?: boolean;
}

export interface MoodboardItem {
    id: string;
    kind?: 'image' | 'text';
    url?: string;
    text?: string;
    label?: string;
    categoryId: string;
    notes?: string;
    createdAt?: string;
    thumbnailUrl?: string;
    sourceUrl?: string;
    sourceLabel?: string;
    sourceType?: 'upload' | 'search' | 'web' | 'video_frame' | 'library';
    query?: string;
    layout?: {
        x: number;
        y: number;
        width: number;
        height: number;
        zIndex?: number;
    };
}

export interface CategorizedMoodboard {
    categories: MoodboardCategory[];
    items: MoodboardItem[];
}

export const DEFAULT_MOODBOARD_CATEGORIES: MoodboardCategory[] = [
    {
        id: 'color_palette',
        label: 'Color Palette',
        icon: '🎨',
        description: 'Color schemes, mood tones, and contrast references',
        color: '#FF6B6B',
    },
    {
        id: 'lighting',
        label: 'Lighting',
        icon: '💡',
        description: 'Lighting setups, time of day, and atmosphere',
        color: '#FFE66D',
    },
    {
        id: 'composition',
        label: 'Composition',
        icon: '📐',
        description: 'Framing, camera angles, and visual hierarchy',
        color: '#4ECDC4',
    },
    {
        id: 'environment',
        label: 'Environment',
        icon: '🌍',
        description: 'Landscapes, locations, and backgrounds',
        color: '#45B7D1',
    },
    {
        id: 'set_design',
        label: 'Set Design',
        icon: '🏛️',
        description: 'Interior/exterior design, props, and decoration',
        color: '#96CEB4',
    },
    {
        id: 'architecture',
        label: 'Architecture',
        icon: '🏗️',
        description: 'Buildings, structures, and spatial design',
        color: '#A8E6CF',
    },
    {
        id: 'character_design',
        label: 'Character Design',
        icon: '👤',
        description: 'Character appearance, body types, and features',
        color: '#DDA0DD',
    },
    {
        id: 'costume',
        label: 'Costume',
        icon: '👔',
        description: 'Wardrobe, accessories, and styling',
        color: '#E8A87C',
    },
    {
        id: 'hair_makeup',
        label: 'Hair & Makeup',
        icon: '💄',
        description: 'Hairstyles, makeup, and grooming',
        color: '#FF9AA2',
    },
    {
        id: 'sound_design',
        label: 'Sound Design',
        icon: '🔊',
        description: 'Audio mood references and soundscapes',
        color: '#B5EAD7',
    },
    {
        id: 'music',
        label: 'Music',
        icon: '🎵',
        description: 'Soundtrack mood, genre, and tempo references',
        color: '#C7CEEA',
    },
    {
        id: 'vfx',
        label: 'VFX',
        icon: '✨',
        description: 'Visual effects style and CGI references',
        color: '#9B59B6',
    },
    {
        id: 'editing',
        label: 'Editing',
        icon: '✂️',
        description: 'Cutting pace and transition styles',
        color: '#E74C3C',
    },
    {
        id: 'world_building',
        label: 'World Building',
        icon: '🌌',
        description: 'Overall world design and lore references',
        color: '#3498DB',
    },
    {
        id: 'uncategorized',
        label: 'Uncategorized',
        icon: '📁',
        description: 'Unsorted references',
        color: '#95A5A6',
    },
];

export const createDefaultCategorizedMoodboard = (): CategorizedMoodboard => ({
    categories: [...DEFAULT_MOODBOARD_CATEGORIES],
    items: [],
});

export const getCategoryById = (
    categories: MoodboardCategory[],
    id: string
): MoodboardCategory | undefined => {
    return categories.find((cat) => cat.id === id);
};

export const getItemsByCategory = (
    items: MoodboardItem[],
    categoryId: string
): MoodboardItem[] => {
    return items.filter((item) => item.categoryId === categoryId);
};

export const getCategoryItemCount = (
    items: MoodboardItem[],
    categoryId: string
): number => {
    return items.filter((item) => item.categoryId === categoryId).length;
};
