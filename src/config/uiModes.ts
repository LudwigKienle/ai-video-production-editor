import { Workspace } from '../types';

export type UIMode = 'beginner' | 'advanced' | 'pro';

export const UI_MODE_STORAGE_KEY = 'ui_mode_v1';
export const DEFAULT_UI_MODE: UIMode = 'beginner';

export const UI_MODE_META: Record<UIMode, { label: string; description: string; emoji: string }> = {
    beginner: {
        label: 'Simple',
        description: 'Perfect to get started — just the tools you need.',
        emoji: '🎬',
    },
    advanced: {
        label: 'Standard',
        description: 'Balanced tools for most projects.',
        emoji: '🎯',
    },
    pro: {
        label: 'Pro',
        description: 'Full studio workflow with all advanced controls.',
        emoji: '⚡',
    },
};

const MODE_WORKSPACES: Record<UIMode, Workspace[]> = {
    beginner: [
        'PROJECT',
        'MICRODRAMA',
        'IMPORT',
        'DESIGN',
        'IMAGE_GEN',
        'VIDEO_GEN',
        'EDIT',
        'SOUND',
        'EXPORT',
    ],
    advanced: [
        'PROJECT',
        'MICRODRAMA',
        'ASSET_LIBRARY',
        'MOODBOARD',
        'NOTEBOOKLM',
        'IMPORT',
        'DESIGN',
        'IMAGE_GEN',
        'VIDEO_GEN',
        'NODES',
        'SCENE_MAP',
        'AVATAR',
        'SOUND',
        'EDIT',
        'PHOTO',
        'UPSCALE',
        'COMPOSITING',
        'TRIM',
        'POST',
        'ANALYSIS',
        'REVIEW',
        'REQUESTS',
        'EXPORT',
    ],
    pro: [
        'PROJECT',
        'MICRODRAMA',
        'ASSET_LIBRARY',
        'MOODBOARD',
        'NOTEBOOKLM',
        'IMPORT',
        'DESIGN',
        'IMAGE_GEN',
        'VIDEO_GEN',
        'NODES',
        'SET_DESIGN',
        'SCENE_MAP',
        'WORLD_GEN',
        'AVATAR',
        'SOUND',
        'EDIT',
        'PHOTO',
        'UPSCALE',
        'COMPOSITING',
        'TRIM',
        'POST',
        'ANALYSIS',
        'REVIEW',
        'REQUESTS',
        'EXPORT',
    ],
};

const BEGINNER_LABELS: Partial<Record<Workspace, string>> = {
    PROJECT: 'My Project',
    MICRODRAMA: '9:16 Microdrama',
    IMPORT: 'Upload',
    DESIGN: 'Design',
    IMAGE_GEN: 'Make Image',
    VIDEO_GEN: 'Make Video',
    EDIT: 'Edit Video',
    SOUND: 'Music',
    EXPORT: 'Download',
};

const ADVANCED_LABELS: Partial<Record<Workspace, string>> = {
    IMAGE_GEN: 'Img Gen',
    VIDEO_GEN: 'Vid Gen',
    COMPOSITING: 'Comp',
    ANALYSIS: 'QC',
};

const BEGINNER_GROUP_LABELS: Record<string, string> = {
    PROJECTS: 'Start',
    CREATE: 'Create',
    EDITING: 'Edit',
    REVIEW: 'Review',
    DELIVERY: 'Finish',
};

const ADVANCED_GROUP_LABELS: Record<string, string> = {
    PROJECTS: 'Project',
    CREATE: 'Build',
    EDITING: 'Post',
    REVIEW: 'Review',
    DELIVERY: 'Ship',
};

export const normalizeUIMode = (value: unknown): UIMode => {
    if (value === 'beginner' || value === 'advanced' || value === 'pro') {
        return value;
    }
    return DEFAULT_UI_MODE;
};

export const getAllowedWorkspacesForMode = (mode: UIMode): Workspace[] => {
    return MODE_WORKSPACES[mode];
};

export const filterWorkspacesForRole = (workspaces: Workspace[], isDirector: boolean): Workspace[] => {
    return workspaces.filter((workspace) => {
        if (workspace === 'REVIEW') return isDirector;
        if (workspace === 'REQUESTS') return !isDirector;
        return true;
    });
};

export const getWorkspaceDisplayLabel = (workspace: Workspace, fallback: string, mode: UIMode): string => {
    if (mode === 'beginner') {
        return BEGINNER_LABELS[workspace] || fallback;
    }
    if (mode === 'advanced') {
        return ADVANCED_LABELS[workspace] || fallback;
    }
    return fallback;
};

export const getWorkspaceGroupDisplayLabel = (groupId: string, fallback: string, mode: UIMode): string => {
    if (mode === 'beginner') {
        return BEGINNER_GROUP_LABELS[groupId] || fallback;
    }
    if (mode === 'advanced') {
        return ADVANCED_GROUP_LABELS[groupId] || fallback;
    }
    return fallback;
};
