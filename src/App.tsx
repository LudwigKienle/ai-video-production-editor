
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    Workspace,
    MediaItem,
    TimelineClip,
    TimelineTrack,
    EffectType,
    Effect,
    ReferenceItem,
    StoryBible,
    ProjectCollaboration,
    ProjectCollaborationPresence,
    ProjectCollaborativeLock,
    ProjectCollaborator,
    ProjectSyncConfig,
    ScriptLength,
    ShotPrompt,
    StudioAgentApprovalMode,
    StudioAgentApprovalBundle,
    StudioAgentCapabilityId,
    StudioAgentControlMode,
    StudioAgentSnapshot,
    StudioAgentTask,
    WaveformCache,
    TransitionType,
    EditPlan,
    EditPlanApplyResult,
    EditPlanOperation,
    EditPlanPreview,
    EditPlanTextPosition,
    EditPlanClipSnapshot,
    AgentApplyBatchSummary,
    AgentReviewPassResult,
    Keyframe,
    ClipEffectLayer,
    User,
    RecentProject,
    AvatarProfile,
    NeurocinematicsAnalysisResult,
    UserProfile,
    ReviewData,
    ReviewFeedback,
    NamingTemplate,
    UsageLedger,
    CostSettings,
    CostRate,
    UsageKind,
    UsageProvider,
    Theme,
    ShortcutMap,
    ShortcutAction,
    NodeGraphState,
    DesignCanvasState,
    SetDesignState,
    WorldGenerationState,
    SetDesignAsset,
    SceneMapState,
    SceneWallState,
    SubtitleWordTiming,
    TitleMotionPreset,
} from './types';
import { useHistoryState } from './hooks/useHistoryState';
import { selectAppHistoryDomain, type AppHistoryDomain } from './utils/appHistoryDomain';
import Header from './components/Header';
import PresenceBar from './components/PresenceBar';
import RemoteCursorOverlay from './components/RemoteCursorOverlay';
import StudioAgentStrip from './components/StudioAgentStrip';
import WorkspaceSwitcher from './components/WorkspaceSwitcher';
import ApiKeyModal from './components/ApiKeyModal';
import OnboardingModal from './components/OnboardingModal';
import FloatingActionButton from './components/FloatingActionButton';
import AIAssistant from './components/AIAssistant';
import LiveConversation from './components/LiveConversation';
import DesignSystemSheet from './components/DesignSystemSheet';
import ProjectHubWorkspace, { type ProjectHubStudioAutomationBindings } from './workspaces/ProjectHubWorkspace';
import OutfitWorkspace from './workspaces/OutfitWorkspace';
import ImportWorkspace from './workspaces/ImportWorkspace';
import EditWorkspace from './workspaces/EditWorkspace';
import AssetLibraryWorkspace from './workspaces/AssetLibraryWorkspace';
import DesignWorkspace from './workspaces/DesignWorkspace';
import ImageGenerationWorkspace from './workspaces/ImageGenerationWorkspace';
import VideoGenerationWorkspace from './workspaces/VideoGenerationWorkspace';
import NodeWorkspace from './workspaces/NodeWorkspace';
import SetDesignWorkspace from './workspaces/SetDesignWorkspace';
import SceneMapWorkspace from './workspaces/SceneMapWorkspace';
import WorldGenerationWorkspace from './workspaces/WorldGenerationWorkspace';
import UpscaleWorkspace from './workspaces/UpscaleWorkspace';
import PhotoWorkspace from './workspaces/PhotoWorkspace';
import SoundWorkspace from './workspaces/SoundWorkspace';
import TrimWorkspace from './workspaces/TrimWorkspace';
import PostWorkspace from './workspaces/GradingWorkspace';
import ExportWorkspace from './workspaces/ExportWorkspace';
import ScriptWorkspace from './workspaces/ScriptWorkspace';
import AvatarWorkspace from './workspaces/AvatarWorkspace';
import AnalysisWorkspace from './workspaces/AnalysisWorkspace';
import ReviewWorkspace from './workspaces/ReviewWorkspace';
import RequestsWorkspace from './workspaces/RequestsWorkspace';
import CompositingWorkspace from './workspaces/CompositingWorkspace';
import MoodboardWorkspace from './workspaces/MoodboardWorkspace';
import NotebookLMWorkspace from './workspaces/NotebookLMWorkspace';
import MicrodramaWorkspace from './workspaces/MicrodramaWorkspace';
import PricingScreen from './components/PricingScreen';
import OptionsModal, { EstimateResult, OptionsModalConfig, PricingResult } from './components/OptionsModal';
import AuthScreen from './components/AuthScreen';
import StudioLogin from './components/StudioLogin';
import AboutModal from './components/AboutModal';
import { useStudioAgentRuntime } from './hooks/useStudioAgentRuntime';
import {
    buildStudioAgentProjectRunTask,
    getNextStudioAgentTaskStep,
    patchStudioAgentTask,
    patchStudioAgentTaskStep,
    summarizeStudioAgentTask,
} from './services/studioAgentTaskService';
import { DEFAULT_SHORTCUTS, SHORTCUT_DEFINITIONS, matchesShortcut } from './utils/shortcuts';
import { estimateGenerationCost, formatUnitSummary } from './utils/generationPricing';
import {
    generateVideoWithVeo,
    generateSpeechWithTTS,
    generateImageWithImagen,
    generateImageWithGemini3Pro,
    analyzeProjectDraft,
    analyzeVideoWithNeurocinematics,
    transcribeAudioWithWordTimings,
} from './services/geminiService';
import { generateSpeechWithElevenLabs } from './services/elevenLabsService';
import {
    selectProjectFolder,
    selectProjectFile,
    probeProjectFolder,
    initializeProjectFolder,
    saveProjectToFolder,
    loadProjectFromFolder,
    openProjectFolder,
    statProjectFile,
    readProjectMetaFile,
    writeProjectMetaFile,
    deleteProjectMetaFile,
    readProjectBinaryFile,
    writeProjectBinaryFile,
    statProjectAsset,
    collectMediaIntoProject,
} from './services/projectService';
import {
    generateImageWithFlux,
    editImageWithFlux,
    editImageWithQwen,
    upscaleImage,
    generateImageWithSeedream,
    generateVideoWithOmniHuman,
    generateVideoWithWanAnimateReplace,
    generateVideoWithWanI2V,
    generateVideoWithKling26,
    generateVideoWithKlingMotionControl
} from './services/replicateService';
import { registerMediaFile } from './services/mediaSourceService';
import { inferImportedMediaType, prepareDesktopVideoForEditing, shouldCreateDesktopVideoProxy } from './services/videoIngestService';
import { getVideoDuration, generateWaveformData, fileToBase64, getBase64FromUrl } from './utils/helpers';
import { normalizeFilters } from './utils/colorGrading';
import { normalizeDesignState } from './utils/designCanvas';
import { getClipEffectLayers, normalizeEffectLayer, syncClipEffectsLegacyField } from './utils/effects';
import { applyWorldCameraSnapshotToShot } from './utils/storyboardWorldCamera';
import {
    applyOpenTimelineIOImportToProject,
    parseOpenTimelineIOToTimeline,
    type OpenTimelineIOImportMode,
} from './utils/openTimelineIOImport';
import { subscribeUsage } from './utils/usageTracker';
import { FunctionDeclaration, Type } from '@google/genai';
import { EFFECT_STACK_PRESETS, TRANSITIONS } from './constants';
import { handleCloudOAuthCallback } from './services/cloudAuthService';
import { getSupabase } from './lib/supabase';
import {
    createProjectRealtimeSession,
    type ProjectRealtimeSession,
    type ProjectRealtimeStatus,
} from './services/realtimeCollaborationService';
import {
    createCollaborativeProjectSession,
    type CollaborativeProjectSession as StructuredCollaborativeProjectSession,
    toProjectSnapshot,
} from './services/collaborativeProjectService';
import { loginWithEmail, loginWithProvider, logoutStudio, onStudioAuthChange, resolveStudioUser } from './services/studioAuth';
import { downloadProjectJsonFromCloud, fetchCloudProjectMeta, uploadProjectJsonToCloud, uploadProjectAssetToCloud, downloadProjectAssetFromCloud } from './services/cloudSyncService';
import { collectAssetPathsFromProjectJson } from './services/projectAssetService';
import { createDefaultCategorizedMoodboard } from './data/moodboardTypes';
import {
    buildSceneWallFromProjectContext,
    normalizeSceneWallState,
} from './data/sceneWallTypes';
import { createDefaultWorldbuildingState } from './data/worldbuildingTypes';
import {
    UIMode,
    UI_MODE_STORAGE_KEY,
    UI_MODE_META,
    normalizeUIMode,
    getAllowedWorkspacesForMode,
    filterWorkspacesForRole,
} from './config/uiModes';
import {
    extractFramesFromVideoUrl,
    isLikelyVideoUrl,
    resolveImageFromWebUrl,
    searchWikimediaCommonsImages
} from './services/moodboardResearchService';
import { buildReviewDrivenObjective, buildTimelineDraftShotList, generateEditPlan } from './services/editorAgentService';
import { searchBrave } from './services/braveSearchService';
import { analyzeImageAsset, resolveLookAgentSource, runLookAgentTool } from './services/lookAgentService';
import { findCreativeDNASceneOverride, resolveCreativeDNAProfile } from './services/creativeDnaService';
import { env } from './config/env';
import type { LibraryAsset } from './hooks/useLibraryAssets';

type ProjectSyncStatus = {
    state: 'idle' | 'checking' | 'up-to-date' | 'incoming' | 'error';
    message?: string;
    lastCheckedAt?: string;
    incoming?: { by?: string; at?: string };
    lock?: { by?: string; at?: string; isActive?: boolean };
};

type ProjectHubPhase =
    | 'library'
    | 'script'
    | 'worldbuilding'
    | 'director'
    | 'concept'
    | 'scene_wall'
    | 'storyboard'
    | 'filming'
    | 'review'
    | 'marketing';

const PROJECT_HUB_PHASES: ProjectHubPhase[] = [
    'library',
    'script',
    'worldbuilding',
    'director',
    'concept',
    'scene_wall',
    'storyboard',
    'filming',
    'review',
    'marketing',
];

type BillingStatus = {
    mode: string;
    plan_id: string | null;
    credit_balance_cents: number | null;
    byo_entitled?: boolean | null;
    trial_started_at?: string | null;
    trial_ends_at?: string | null;
    trial_active?: boolean | null;
    status?: string | null;
    last_usage_at?: string | null;
};

type StartupPreferences = {
    startupWorkspace: Workspace;
    autoOpenAssistant: boolean;
    studioAgentMode: StudioAgentControlMode;
    studioAgentApprovalMode: StudioAgentApprovalMode;
};

type StudioAgentTaskRunResult = {
    success: boolean;
    message: string;
    taskId?: string;
    needsApproval?: boolean;
};

type LibraryImportOptions = {
    addToTimeline?: boolean;
    collectToProject?: boolean;
    trackId?: string;
    startTime?: number;
    sourceIn?: number;
    sourceOut?: number;
    timelineIn?: number;
    timelineOut?: number;
    mode?: 'insert' | 'overwrite';
};

type StandaloneTextClipOptions = {
    content?: string;
    font?: string;
    size?: number;
    color?: string;
    position?: NonNullable<TimelineClip['textConfig']>['position'];
    autoContrast?: boolean;
    motionPreset?: Exclude<TitleMotionPreset, 'clear'> | null;
    background?: NonNullable<TimelineClip['textConfig']>['background'];
    duration?: number;
    startTime?: number;
    trackId?: string;
    transform?: TimelineClip['transform'];
    keyframes?: Keyframe[];
};

const DEFAULT_SUBTITLE_BACKGROUND: NonNullable<NonNullable<TimelineClip['textConfig']>['background']> = {
    enabled: true,
    color: '#020617',
    opacity: 0.72,
    paddingX: 20,
    paddingY: 10,
    radius: 18,
    style: 'plate',
};

const INITIAL_TRACKS: TimelineTrack[] = [
    { id: 'video-1', type: 'video', isLocked: false, isMuted: false, isTargeted: true, isSolo: false },
    { id: 'audio-1', type: 'audio', isLocked: false, isMuted: false, isTargeted: true, isSolo: false },
];

const buildDefaultSetDesignState = (): SetDesignState => ({
    assets: [],
    lights: [
        { id: 'light-ambient', type: 'ambient', color: '#ffffff', intensity: 0.6 },
        { id: 'light-key', type: 'directional', color: '#ffffff', intensity: 1.2, position: { x: 5, y: 8, z: 5 } },
    ],
    grid: { enabled: true, size: 30, divisions: 30, snapEnabled: true, snap: 0.5 },
    camera: { position: { x: 6, y: 4, z: 6 }, target: { x: 0, y: 1, z: 0 }, fov: 45 },
});

const INITIAL_BIBLE: StoryBible = {
    logline: '',
    characters: [],
    plotBeats: '',
    script: '',
    productionGuidelines: '',
    worldbuilding: createDefaultWorldbuildingState(),
    directorPersona: 'none',
    directorPersonaPrompt: '',
    directorPersonas: [],
    directorPersonaPresets: [],
};

const DEFAULT_PROJECT_COLLABORATION: ProjectCollaboration = {
    collaborators: [],
    chatThreads: [],
    meetingLinks: [],
    storageLinks: [],
};

const DEFAULT_PROJECT_SYNC: ProjectSyncConfig = {
    provider: undefined,
    rootPath: '',
    autoSync: true,
};

const INITIAL_REVIEW_DATA: ReviewData = {
    reviewSets: [],
    variants: [],
    comments: [],
    decisions: [],
    tasks: [],
    directorFeedback: [],
    changeRequests: [],
    shotTasks: [],
    shotAnnotations: [],
};

type SmartFillStyle = 'bridge' | 'cutaway' | 'montage' | 'atmosphere';

type SmartFillGap = {
    id: string;
    trackId: string;
    trackLabel: string;
    start: number;
    end: number;
    duration: number;
    prevLabel: string;
    nextLabel: string;
};

const SMART_FILL_MIN_GAP_SECONDS = 0.5;

const SMART_FILL_STYLE_OPTIONS: Array<{ value: SmartFillStyle; label: string; guidance: string }> = [
    {
        value: 'bridge',
        label: 'Bridge Scene',
        guidance: 'Show a connective shot that naturally carries the viewer from the previous setup into the next one.',
    },
    {
        value: 'cutaway',
        label: 'Cutaway Insert',
        guidance: 'Use a motivated insert, reaction, or detail shot that supports the surrounding action without breaking continuity.',
    },
    {
        value: 'montage',
        label: 'Montage Insert',
        guidance: 'Create a punchy editorial insert with clear motion and visual rhythm that still matches the sequence tone.',
    },
    {
        value: 'atmosphere',
        label: 'Atmosphere / B-roll',
        guidance: 'Focus on environmental mood, texture, and scene-setting details while preserving the story world.',
    },
];

const formatSmartFillTimecode = (seconds: number) => {
    const totalTenths = Math.max(0, Math.round(seconds * 10));
    const mins = Math.floor(totalTenths / 600);
    const secs = Math.floor((totalTenths % 600) / 10);
    const tenths = totalTenths % 10;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
};

const summarizeSmartFillText = (value: string | null | undefined, fallback: string, maxLength = 96) => {
    const compact = (value || '').replace(/\s+/g, ' ').trim();
    if (!compact) return fallback;
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength - 3).trimEnd()}...`;
};

const buildSmartFillGapLabel = (gap: SmartFillGap) =>
    `${gap.trackLabel} | ${formatSmartFillTimecode(gap.start)}-${formatSmartFillTimecode(gap.end)} | ${gap.duration.toFixed(1)}s | ${gap.prevLabel} -> ${gap.nextLabel}`;

const buildSmartFillPrompt = (opts: {
    gap: SmartFillGap;
    fillStyle: SmartFillStyle;
    projectTitle?: string;
    projectLogline?: string;
    styleNotes?: string;
}) => {
    const style = SMART_FILL_STYLE_OPTIONS.find((option) => option.value === opts.fillStyle) || SMART_FILL_STYLE_OPTIONS[0];
    const promptParts = [
        `Create a cinematic ${style.label.toLowerCase()} that fills an editorial gap in a timeline.`,
        `Target duration: about ${opts.gap.duration.toFixed(1)} seconds.`,
        `Previous shot context: ${opts.gap.prevLabel}.`,
        `Next shot context: ${opts.gap.nextLabel}.`,
        opts.projectTitle ? `Project title: ${summarizeSmartFillText(opts.projectTitle, '', 80)}.` : '',
        opts.projectLogline ? `Story context: ${summarizeSmartFillText(opts.projectLogline, '', 180)}.` : '',
        opts.styleNotes ? `Visual direction: ${summarizeSmartFillText(opts.styleNotes, '', 220)}.` : '',
        style.guidance,
        'Maintain continuity in subject, lighting, geography, and screen direction.',
        'Make it editorially useful and production-ready. No captions, subtitles, logos, or on-screen text.',
    ];
    return promptParts.filter(Boolean).join(' ');
};

const withMargin = (providerCost: number) =>
    Number((providerCost * 1.02).toFixed(6));

const DEFAULT_COST_RATES: CostRate[] = [
    { id: 'gemini-image', provider: 'gemini', kind: 'image', unitCost: withMargin(0.065), unitLabel: 'image', label: 'Gemini Image (avg)' },
    { id: 'gemini-video', provider: 'gemini', kind: 'video', unitCost: withMargin(0.275), unitLabel: 'second', label: 'Veo Video (avg/sec)' },
    { id: 'replicate-image', provider: 'replicate', kind: 'image', unitCost: withMargin(0.055), unitLabel: 'image', label: 'Replicate Image (avg)' },
    { id: 'replicate-video', provider: 'replicate', kind: 'video', unitCost: withMargin(0.115), unitLabel: 'second', label: 'Replicate Video (avg/sec)' },
    { id: 'replicate-edit', provider: 'replicate', kind: 'edit', unitCost: withMargin(0.042), unitLabel: 'image', label: 'Replicate Edit (avg)' },
    { id: 'fal-edit', provider: 'fal', kind: 'edit', unitCost: withMargin(0.075), unitLabel: 'request', label: 'FAL Edit (avg/request)' },
    { id: 'elevenlabs-audio', provider: 'elevenlabs', kind: 'audio', unitCost: withMargin(0.12), unitLabel: 'minute', label: 'ElevenLabs Audio (~1k chars)' },
    { id: 'sonauto-audio', provider: 'sonauto', kind: 'audio', unitCost: withMargin(0.06), unitLabel: 'clip', label: 'Sonauto Song (estimated/track)' },
    { id: 'xai-image', provider: 'xai', kind: 'image', unitCost: withMargin(0.07), unitLabel: 'image', label: 'xAI Grok Image (avg)' },
    { id: 'xai-video', provider: 'xai', kind: 'video', unitCost: withMargin(0.05), unitLabel: 'second', label: 'xAI Grok Video (avg/sec)' },
];

const DEFAULT_MODEL_RATES: CostRate[] = [
    // Gemini
    { id: 'gemini-flash-image', provider: 'gemini', model: 'gemini-3.1-flash-image-preview', kind: 'image', unitCost: withMargin(0.039), unitLabel: 'image', label: 'Nano Banana 2 (Gemini API)' },
    { id: 'gemini-pro-image', provider: 'gemini', model: 'gemini-3-pro-image-preview', kind: 'image', unitCost: withMargin(0.134), unitLabel: 'image', label: 'Gemini 3 Pro Image Preview' },
    { id: 'gemini-imagen', provider: 'gemini', model: 'imagen-4.0-generate-001', kind: 'image', unitCost: withMargin(0.04), unitLabel: 'image', label: 'Imagen 4' },
    { id: 'gemini-veo-fast', provider: 'gemini', model: 'veo-3.1-fast-generate-preview', kind: 'video', unitCost: withMargin(0.15), unitLabel: 'second', label: 'Veo 3.1 Fast' },
    { id: 'gemini-veo-hq', provider: 'gemini', model: 'veo-3.1-generate-preview', kind: 'video', unitCost: withMargin(0.4), unitLabel: 'second', label: 'Veo 3.1 HQ' },
    { id: 'gemini-tts', provider: 'gemini', model: 'gemini-2.5-flash-preview-tts', kind: 'audio', unitCost: withMargin(0.02), unitLabel: 'minute', label: 'Gemini TTS (estimated/min)' },

    // xAI
    { id: 'xai-grok-image', provider: 'xai', model: 'grok-2-image', kind: 'image', unitCost: withMargin(0.07), unitLabel: 'image', label: 'Grok 2 Image' },
    { id: 'xai-grok-video', provider: 'xai', model: 'grok-imagine-video', kind: 'video', unitCost: withMargin(0.05), unitLabel: 'second', label: 'Grok Imagine Video (estimated/sec)' },

    // FAL
    { id: 'fal-qwen-max-t2i', provider: 'fal', model: 'fal-ai/qwen-image-max/text-to-image', kind: 'image', unitCost: withMargin(0.075), unitLabel: 'image', label: 'FAL Qwen Image Max T2I' },
    { id: 'fal-qwen-multi', provider: 'fal', model: 'fal-ai/qwen-image-max/edit', kind: 'edit', unitCost: withMargin(0.075), unitLabel: 'request', label: 'FAL Qwen Image Max Edit' },
    { id: 'fal-gpt-image-2', provider: 'fal', model: 'openai/gpt-image-2', kind: 'image', unitCost: withMargin(0.15), unitLabel: 'image', label: 'FAL GPT Image 2 T2I' },
    { id: 'fal-gpt-image-2-edit', provider: 'fal', model: 'openai/gpt-image-2/edit', kind: 'edit', unitCost: withMargin(0.15), unitLabel: 'request', label: 'FAL GPT Image 2 Edit' },
    { id: 'fal-nano-banana-2-t2i', provider: 'fal', model: 'fal-ai/nano-banana-2', kind: 'image', unitCost: withMargin(0.08), unitLabel: 'image', label: 'FAL Nano Banana 2 T2I' },
    { id: 'fal-nano-banana-2-edit', provider: 'fal', model: 'fal-ai/nano-banana-2/edit', kind: 'edit', unitCost: withMargin(0.08), unitLabel: 'request', label: 'FAL Nano Banana 2 Edit' },
    { id: 'fal-seedream-v5-lite-t2i', provider: 'fal', model: 'fal-ai/bytedance/seedream/v5/lite/text-to-image', kind: 'image', unitCost: withMargin(0.035), unitLabel: 'image', label: 'FAL Seedream v5 Lite T2I' },
    { id: 'fal-wan-v27-pro-t2i', provider: 'fal', model: 'fal-ai/wan/v2.7/pro/text-to-image', kind: 'image', unitCost: withMargin(0.075), unitLabel: 'image', label: 'FAL WAN 2.7 Pro T2I' },
    { id: 'fal-wan-v27-pro-edit', provider: 'fal', model: 'fal-ai/wan/v2.7/pro/edit', kind: 'edit', unitCost: withMargin(0.075), unitLabel: 'request', label: 'FAL WAN 2.7 Pro Edit' },
    { id: 'fal-wan-v27-t2v', provider: 'fal', model: 'fal-ai/wan/v2.7/text-to-video', kind: 'video', unitCost: withMargin(0.1), unitLabel: 'second', label: 'FAL WAN 2.7 T2V' },
    { id: 'fal-wan-v27-i2v', provider: 'fal', model: 'fal-ai/wan/v2.7/image-to-video', kind: 'video', unitCost: withMargin(0.1), unitLabel: 'second', label: 'FAL WAN 2.7 I2V' },
    { id: 'fal-happy-horse-t2v', provider: 'fal', model: 'alibaba/happy-horse/text-to-video', kind: 'video', unitCost: withMargin(0.28), unitLabel: 'second', label: 'FAL Happy Horse 1.0 T2V (1080p)' },
    { id: 'fal-happy-horse-i2v', provider: 'fal', model: 'alibaba/happy-horse/image-to-video', kind: 'video', unitCost: withMargin(0.28), unitLabel: 'second', label: 'FAL Happy Horse 1.0 I2V (1080p)' },
    { id: 'fal-seedance-2-i2v', provider: 'fal', model: 'bytedance/seedance-2.0/image-to-video', kind: 'video', unitCost: withMargin(0.3024), unitLabel: 'second', label: 'FAL Seedance 2.0 I2V (720p)' },
    { id: 'fal-seedance-2-ref', provider: 'fal', model: 'bytedance/seedance-2.0/reference-to-video', kind: 'video', unitCost: withMargin(0.3024), unitLabel: 'second', label: 'FAL Seedance 2.0 Reference-to-Video (720p)' },
    { id: 'fal-kling-o3', provider: 'fal', model: 'fal-ai/kling-video/o3/pro/image-to-video', kind: 'video', unitCost: withMargin(0.28), unitLabel: 'second', label: 'FAL Kling O3 Pro I2V' },
    { id: 'fal-kling-o3-ref', provider: 'fal', model: 'fal-ai/kling-video/o3/pro/reference-to-video', kind: 'video', unitCost: withMargin(0.28), unitLabel: 'second', label: 'FAL Kling O3 Pro Reference-to-Video' },
    { id: 'fal-kling-v3-i2v', provider: 'fal', model: 'fal-ai/kling-video/v3/pro/image-to-video', kind: 'video', unitCost: withMargin(0.336), unitLabel: 'second', label: 'FAL Kling v3 Pro I2V' },
    { id: 'fal-kling-v3-t2v', provider: 'fal', model: 'fal-ai/kling-video/v3/pro/text-to-video', kind: 'video', unitCost: withMargin(0.336), unitLabel: 'second', label: 'FAL Kling v3 Pro T2V' },
    { id: 'fal-pixverse-c1-ref', provider: 'fal', model: 'fal-ai/pixverse/c1/reference-to-video', kind: 'video', unitCost: withMargin(0.05), unitLabel: 'second', label: 'FAL PixVerse C1 Reference-to-Video (720p base)' },
    { id: 'fal-aurora', provider: 'fal', model: 'fal-ai/creatify/aurora', kind: 'video', unitCost: withMargin(0.14), unitLabel: 'second', label: 'FAL Creatify Aurora (720p)' },
    { id: 'fal-grok-i2v', provider: 'fal', model: 'xai/grok-imagine-video/image-to-video', kind: 'video', unitCost: withMargin(0.05), unitLabel: 'second', label: 'FAL Grok Imagine I2V' },

    // Replicate image generation
    { id: 'replicate-z-image', provider: 'replicate', model: 'prunaai/z-image-turbo', kind: 'image', unitCost: withMargin(0.004), unitLabel: 'image', label: 'Z-Image Turbo' },
    { id: 'replicate-z-image-base', provider: 'replicate', model: 'prunaai/z-image', kind: 'image', unitCost: withMargin(0.006), unitLabel: 'image', label: 'Z-Image' },
    { id: 'replicate-z-image-versioned', provider: 'replicate', model: 'prunaai/z-image:eb865cc448032613678cd0e4e99548671cdff1286bc04f0f605b3fc10fffe3aa', kind: 'image', unitCost: withMargin(0.006), unitLabel: 'image', label: 'Z-Image (versioned)' },
    { id: 'replicate-z-img2img', provider: 'replicate', model: 'prunaai/z-image-turbo-img2img', kind: 'image', unitCost: withMargin(0.005), unitLabel: 'image', label: 'Z-Image Turbo Img2Img' },
    { id: 'replicate-flux', provider: 'replicate', model: 'black-forest-labs/flux-1.1-pro', kind: 'image', unitCost: withMargin(0.04), unitLabel: 'image', label: 'Flux 1.1 Pro' },
    { id: 'replicate-flux-klein', provider: 'replicate', model: 'black-forest-labs/flux-2-klein-9b-base', kind: 'image', unitCost: withMargin(0.015), unitLabel: 'image', label: 'Flux 2 Klein 9B Base' },
    { id: 'replicate-flux-2-turbo', provider: 'replicate', model: 'prunaai/flux-2-turbo', kind: 'image', unitCost: withMargin(0.02), unitLabel: 'image', label: 'Flux 2 Turbo (estimated)' },
    { id: 'replicate-flux-schnell', provider: 'replicate', model: 'black-forest-labs/flux-schnell', kind: 'image', unitCost: withMargin(0.003), unitLabel: 'image', label: 'Flux Schnell' },
    { id: 'replicate-seedream', provider: 'replicate', model: 'bytedance/seedream-4.5', kind: 'image', unitCost: withMargin(0.04), unitLabel: 'image', label: 'Seedream 4.5' },
    { id: 'replicate-wan27-image-pro', provider: 'replicate', model: 'wan-video/wan-2.7-image-pro', kind: 'image', unitCost: withMargin(0.06), unitLabel: 'image', label: 'WAN 2.7 Image Pro (estimated)' },
    { id: 'replicate-qwen-image', provider: 'replicate', model: 'qwen/qwen-image-2512', kind: 'image', unitCost: withMargin(0.02), unitLabel: 'image', label: 'Qwen Image 2512' },
    { id: 'replicate-gpt-image', provider: 'replicate', model: 'openai/gpt-image-1.5', kind: 'image', unitCost: withMargin(0.042), unitLabel: 'image', label: 'GPT Image 1.5' },
    { id: 'replicate-gemini3pro', provider: 'replicate', model: 'google/gemini-3-pro', kind: 'image', unitCost: withMargin(0.134), unitLabel: 'image', label: 'Gemini 3 Pro (Replicate)' },
    { id: 'replicate-nano-banana-image', provider: 'replicate', model: 'google/nano-banana-pro', kind: 'image', unitCost: withMargin(0.15), unitLabel: 'image', label: 'Nano Banana Pro (image)' },
    { id: 'replicate-openpose', provider: 'replicate', model: 'aiunivers/openpose', kind: 'image', unitCost: withMargin(0.009), unitLabel: 'image', label: 'OpenPose' },
    { id: 'replicate-dpt', provider: 'replicate', model: 'isl-org/dpt', kind: 'image', unitCost: withMargin(0.01), unitLabel: 'image', label: 'DPT Depth' },
    { id: 'replicate-midas', provider: 'replicate', model: 'intel-isl/midas', kind: 'image', unitCost: withMargin(0.01), unitLabel: 'image', label: 'MiDaS Depth' },
    { id: 'replicate-rembg', provider: 'replicate', model: 'cjwbw/rembg', kind: 'image', unitCost: withMargin(0.008), unitLabel: 'image', label: 'Background Removal (rembg)' },
    { id: 'replicate-gfpgan', provider: 'replicate', model: 'tencentarc/gfpgan', kind: 'image', unitCost: withMargin(0.01), unitLabel: 'image', label: 'GFPGAN Face Restore' },
    { id: 'replicate-restoreformer', provider: 'replicate', model: 'sczhou/restoreformer', kind: 'image', unitCost: withMargin(0.01), unitLabel: 'image', label: 'RestoreFormer' },
    { id: 'replicate-runway-gen4', provider: 'replicate', model: 'runwayml/gen4-image-turbo', kind: 'image', unitCost: withMargin(0.05), unitLabel: 'image', label: 'Runway Gen-4 Image Turbo' },
    { id: 'replicate-controlnet', provider: 'replicate', model: 'jagilley/controlnet', kind: 'image', unitCost: withMargin(0.015), unitLabel: 'image', label: 'ControlNet Base' },
    { id: 'replicate-controlnet-scribble', provider: 'replicate', model: 'jagilley/controlnet-scribble', kind: 'image', unitCost: withMargin(0.015), unitLabel: 'image', label: 'ControlNet Scribble' },
    { id: 'replicate-controlnet-normal', provider: 'replicate', model: 'jagilley/controlnet-normal', kind: 'image', unitCost: withMargin(0.015), unitLabel: 'image', label: 'ControlNet Normal' },
    { id: 'replicate-rodin', provider: 'replicate', model: 'hyper3d/rodin', kind: 'image', unitCost: withMargin(0.6), unitLabel: 'image', label: 'Rodin 3D' },

    // Replicate edit / upscaling
    { id: 'replicate-nano-banana-edit', provider: 'replicate', model: 'google/nano-banana-pro', kind: 'edit', unitCost: withMargin(0.15), unitLabel: 'image', label: 'Nano Banana Pro (edit)' },
    { id: 'replicate-flux-edit', provider: 'replicate', model: 'black-forest-labs/flux-fill-dev', kind: 'edit', unitCost: withMargin(0.05), unitLabel: 'image', label: 'Flux Fill' },
    { id: 'replicate-flux-2-pro', provider: 'replicate', model: 'black-forest-labs/flux-2-pro', kind: 'edit', unitCost: withMargin(0.045), unitLabel: 'image', label: 'Flux 2 Pro (edit)' },
    { id: 'replicate-z-turbo-inpaint', provider: 'replicate', model: 'prunaai/z-image-turbo-inpaint', kind: 'edit', unitCost: withMargin(0.005), unitLabel: 'image', label: 'Z-Image Turbo Inpaint' },
    { id: 'replicate-firered-edit', provider: 'replicate', model: 'prunaai/firered-image-edit', kind: 'edit', unitCost: withMargin(0.016), unitLabel: 'image', label: 'FireRed Image Edit' },
    { id: 'replicate-qwen-edit', provider: 'replicate', model: 'qwen/qwen-image-edit-2511', kind: 'edit', unitCost: withMargin(0.02), unitLabel: 'image', label: 'Qwen Image Edit 2511' },
    { id: 'replicate-qwen-multi', provider: 'replicate', model: 'qwen/qwen-edit-multiangle', kind: 'edit', unitCost: withMargin(0.035), unitLabel: 'image', label: 'Qwen Multi-Angle Edit' },
    { id: 'replicate-upscale-real', provider: 'replicate', model: 'nightmareai/real-esrgan', kind: 'edit', unitCost: withMargin(0.015), unitLabel: 'image', label: 'Real-ESRGAN Upscale' },
    { id: 'replicate-upscale-crystal', provider: 'replicate', model: 'philz1337x/crystal-upscaler', kind: 'edit', unitCost: withMargin(0.02), unitLabel: 'image', label: 'Crystal Upscaler' },
    { id: 'replicate-upscale-clarity', provider: 'replicate', model: 'philz1337x/clarity-upscaler', kind: 'edit', unitCost: withMargin(0.02), unitLabel: 'image', label: 'Clarity Upscaler' },
    { id: 'replicate-upscale-topaz', provider: 'replicate', model: 'topazlabs/image-upscale', kind: 'edit', unitCost: withMargin(0.06), unitLabel: 'image', label: 'Topaz Image Upscale' },
    { id: 'replicate-video-upscale-crystal', provider: 'replicate', model: 'philz1337x/crystal-video-upscaler', kind: 'edit', unitCost: withMargin(0.03), unitLabel: 'second', label: 'Crystal Video Upscale' },
    { id: 'replicate-video-upscale-topaz', provider: 'replicate', model: 'topazlabs/video-upscale', kind: 'edit', unitCost: withMargin(0.08), unitLabel: 'second', label: 'Topaz Video Upscale' },
    { id: 'ltx-video-to-video-hdr', provider: 'ltx', model: 'video-to-video-hdr', kind: 'edit', unitCost: withMargin(0.2), unitLabel: 'clip', label: 'LTX Color Science Upscale (ACES HDR)' },

    // Replicate video generation
    { id: 'replicate-veo-fast', provider: 'replicate', model: 'google/veo-3.1-fast', kind: 'video', unitCost: withMargin(0.15), unitLabel: 'second', label: 'Veo 3.1 Fast (Replicate)' },
    { id: 'replicate-veo-hq', provider: 'replicate', model: 'google/veo-3.1', kind: 'video', unitCost: withMargin(0.4), unitLabel: 'second', label: 'Veo 3.1 HQ (Replicate)' },
    { id: 'replicate-seedance', provider: 'replicate', model: 'bytedance/seedance-1.5-pro', kind: 'video', unitCost: withMargin(0.052), unitLabel: 'second', label: 'Seedance 1.5 Pro' },
    { id: 'replicate-wan-i2v', provider: 'replicate', model: 'wan-video/wan-2.2-i2v-fast', kind: 'video', unitCost: withMargin(0.05), unitLabel: 'second', label: 'Wan I2V' },
    { id: 'replicate-wan-replace', provider: 'replicate', model: 'wan-video/wan-2.2-animate-replace', kind: 'video', unitCost: withMargin(0.05), unitLabel: 'second', label: 'Wan Animate Replace' },
    { id: 'replicate-kling-26', provider: 'replicate', model: 'kwaivgi/kling-v2.6', kind: 'video', unitCost: withMargin(0.14), unitLabel: 'second', label: 'Kling 2.6 Pro' },
    { id: 'replicate-kling-turbo', provider: 'replicate', model: 'kwaivgi/kling-v2.5-turbo-pro', kind: 'video', unitCost: withMargin(0.07), unitLabel: 'second', label: 'Kling 2.5 Turbo Pro' },
    { id: 'replicate-kling-motion', provider: 'replicate', model: 'kwaivgi/kling-v2.6-motion-control', kind: 'video', unitCost: withMargin(0.18), unitLabel: 'second', label: 'Kling Motion Control' },
    { id: 'replicate-ltx', provider: 'replicate', model: 'lightricks/ltx-2-fast', kind: 'video', unitCost: withMargin(0.04), unitLabel: 'second', label: 'LTX 2 Fast' },
    { id: 'replicate-ltx-23-fast', provider: 'replicate', model: 'lightricks/ltx-2.3-fast', kind: 'video', unitCost: withMargin(0.05), unitLabel: 'second', label: 'LTX 2.3 Fast (estimated)' },
    { id: 'replicate-ltx-23-pro', provider: 'replicate', model: 'lightricks/ltx-2.3-pro', kind: 'video', unitCost: withMargin(0.08), unitLabel: 'second', label: 'LTX 2.3 Pro (estimated)' },
    { id: 'replicate-ltx-audio', provider: 'replicate', model: 'lightricks/audio-to-video', kind: 'video', unitCost: withMargin(0.08), unitLabel: 'second', label: 'LTX Audio-to-Video (estimated)' },
    { id: 'replicate-p-video', provider: 'replicate', model: 'prunaai/p-video', kind: 'video', unitCost: withMargin(0.02), unitLabel: 'second', label: 'P-Video 720p' },
    { id: 'replicate-omni', provider: 'replicate', model: 'bytedance/omni-human', kind: 'video', unitCost: withMargin(0.16), unitLabel: 'second', label: 'OmniHuman' },
    { id: 'replicate-rife', provider: 'replicate', model: 'sczhou/rife', kind: 'video', unitCost: withMargin(0.04), unitLabel: 'clip', label: 'RIFE Frame Interpolation' },

    // Replicate audio
    { id: 'replicate-minimax-speech', provider: 'replicate', model: 'minimax/speech-02-hd', kind: 'audio', unitCost: withMargin(0.02), unitLabel: 'clip', label: 'Minimax Speech 02 HD (clip)' },
    { id: 'replicate-lyria', provider: 'replicate', model: 'google/lyria-2', kind: 'audio', unitCost: withMargin(0.03), unitLabel: 'clip', label: 'Google Lyria 2 (clip)' },
    { id: 'replicate-demucs', provider: 'replicate', model: 'facebookresearch/demucs', kind: 'audio', unitCost: withMargin(0.009), unitLabel: 'stem', label: 'Demucs Stem Separation (per stem)' },

    // ElevenLabs (kept for manual estimates and invoice parity)
    { id: 'elevenlabs-tts', provider: 'elevenlabs', model: 'eleven_multilingual_v2', kind: 'audio', unitCost: withMargin(0.12), unitLabel: 'minute', label: 'ElevenLabs Multilingual v2' },
    { id: 'elevenlabs-turbo', provider: 'elevenlabs', model: 'turbo_v2.5', kind: 'audio', unitCost: withMargin(0.06), unitLabel: 'minute', label: 'ElevenLabs Turbo v2.5' },

    // Sonauto audio
    { id: 'sonauto-v3', provider: 'sonauto', model: 'v3-preview', kind: 'audio', unitCost: withMargin(0.06), unitLabel: 'clip', label: 'Sonauto v3 (estimated/track)' },
];

const INITIAL_USAGE_LEDGER: UsageLedger = {
    entries: [],
};

const DEFAULT_COST_SETTINGS: CostSettings = {
    currency: 'USD',
    usdToEurRate: 0.92,
    visibility: {
        artist: true,
        director: true,
    },
    includeSoftwareFee: true,
    softwareFee: 10,
    softwareLabel: 'AI Video Production Editor License',
    rates: [...DEFAULT_MODEL_RATES, ...DEFAULT_COST_RATES],
    extraLineItems: [],
    invoiceNotes: '',
};

const normalizeReviewData = (value?: ReviewData | null): ReviewData => ({
    reviewSets: value?.reviewSets ?? [],
    variants: value?.variants ?? [],
    comments: value?.comments ?? [],
    decisions: value?.decisions ?? [],
    tasks: value?.tasks ?? [],
    directorFeedback: value?.directorFeedback ?? [],
    changeRequests: value?.changeRequests ?? [],
    shotTasks: value?.shotTasks ?? [],
    shotAnnotations: value?.shotAnnotations ?? [],
});

const normalizeShotPromptList = (shots?: ShotPrompt[]) => {
    if (!Array.isArray(shots)) return [];
    const used = new Set<number>();
    let needsRenumber = false;
    const normalized = shots.map((shot, index) => {
        const numericShot = Number.isFinite(shot.shot) ? shot.shot : index + 1;
        if (used.has(numericShot)) {
            needsRenumber = true;
        }
        used.add(numericShot);
        return { ...shot, shot: numericShot };
    });
    if (!needsRenumber) return normalized;
    return normalized.map((shot, index) => ({ ...shot, shot: index + 1 }));
};

const normalizeCostSettings = (value?: CostSettings | null): CostSettings => ({
    ...DEFAULT_COST_SETTINGS,
    ...value,
    usdToEurRate: value?.usdToEurRate ?? DEFAULT_COST_SETTINGS.usdToEurRate,
    visibility: {
        ...DEFAULT_COST_SETTINGS.visibility,
        ...(value?.visibility || {}),
    },
    rates: value?.rates && value.rates.length > 0 ? value.rates : DEFAULT_COST_SETTINGS.rates,
    extraLineItems: value?.extraLineItems ?? [],
    invoiceNotes: value?.invoiceNotes ?? '',
});

type AutosaveSettings = {
    enabled: boolean;
    debounceMs: number;
    minIntervalMs: number;
    recoverOnCrash: boolean;
};

const DEFAULT_AUTOSAVE_SETTINGS: AutosaveSettings = {
    enabled: true,
    debounceMs: 20000,
    minIntervalMs: 60000,
    recoverOnCrash: true,
};

const clampAutosaveMs = (value: number, min: number, max: number, fallback: number) => {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
};

const normalizeAutosaveSettings = (value?: Partial<AutosaveSettings> | null): AutosaveSettings => ({
    enabled: value?.enabled !== false,
    debounceMs: clampAutosaveMs(value?.debounceMs ?? DEFAULT_AUTOSAVE_SETTINGS.debounceMs, 3000, 180000, DEFAULT_AUTOSAVE_SETTINGS.debounceMs),
    minIntervalMs: clampAutosaveMs(value?.minIntervalMs ?? DEFAULT_AUTOSAVE_SETTINGS.minIntervalMs, 15000, 900000, DEFAULT_AUTOSAVE_SETTINGS.minIntervalMs),
    recoverOnCrash: value?.recoverOnCrash !== false,
});

const SYNC_POLL_INTERVAL_MS = 12000;
const LOCK_HEARTBEAT_MS = 30000;
const LOCK_STALE_AFTER_MS = 120000;
const LOCK_FILE_NAME = '.aivp-lock.json';
const SESSION_ACTIVE_KEY = 'session_active_v1';
const AUTOSAVE_META_KEY = 'autosave_meta_v1';
const AUTOSAVE_SETTINGS_KEY = 'autosave_settings_v1';
const THEME_STORAGE_KEY = 'ui_theme_v1';
const SHORTCUT_STORAGE_KEY = 'ui_shortcuts_v1';
const STARTUP_PREFERENCES_KEY = 'startup_preferences_v1';
const ONBOARDING_COMPLETED_KEY = 'studio_onboarding_completed_v1';
const WEB_TEAM_STORAGE_KEY = 'bw_active_team_id';
const THEME_OPTIONS: Theme[] = ['dark', 'light', 'fantasy', 'cyberpunk', 'studio', 'cinematic'];
const DEFAULT_STARTUP_PREFERENCES: StartupPreferences = {
    startupWorkspace: 'PROJECT',
    autoOpenAssistant: false,
    studioAgentMode: 'agent',
    studioAgentApprovalMode: 'important_only',
};
const TOKEN_BUDGETS = {
    video: 500,
    image: 1000,
};

const estimatePromptTokens = (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return 0;
    return Math.ceil(trimmed.length / 4);
};

const buildCostEstimate = (prompt: string, budget: number, multiplier = 1): EstimateResult => {
    const tokens = estimatePromptTokens(prompt);
    const adjusted = Math.ceil(tokens * multiplier);
    const severity: EstimateResult['severity'] = adjusted >= budget ? 'high' : adjusted >= budget * 0.6 ? 'medium' : 'low';
    const detail = multiplier !== 1 ? `Quality multiplier ${multiplier.toFixed(1)}x → ${adjusted} tokens` : undefined;
    return { tokens, budget, severity, detail, adjustedTokens: adjusted };
};

const getInitialTheme = (): Theme => {
    if (typeof window === 'undefined') return 'dark';
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && THEME_OPTIONS.includes(stored as Theme)) return stored as Theme;
    const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
    return prefersLight ? 'light' : 'dark';
};

const getInitialShortcuts = (): ShortcutMap => {
    if (typeof window === 'undefined') return DEFAULT_SHORTCUTS;
    const stored = window.localStorage.getItem(SHORTCUT_STORAGE_KEY);
    if (!stored) return DEFAULT_SHORTCUTS;
    try {
        const parsed = JSON.parse(stored) as Partial<ShortcutMap>;
        return { ...DEFAULT_SHORTCUTS, ...parsed };
    } catch {
        return DEFAULT_SHORTCUTS;
    }
};

const getInitialAutosaveSettings = (): AutosaveSettings => {
    if (typeof window === 'undefined') return DEFAULT_AUTOSAVE_SETTINGS;
    const stored = window.localStorage.getItem(AUTOSAVE_SETTINGS_KEY);
    if (!stored) return DEFAULT_AUTOSAVE_SETTINGS;
    try {
        const parsed = JSON.parse(stored) as Partial<AutosaveSettings>;
        return normalizeAutosaveSettings(parsed);
    } catch {
        return DEFAULT_AUTOSAVE_SETTINGS;
    }
};

const getInitialStartupPreferences = (): StartupPreferences => {
    if (typeof window === 'undefined') return DEFAULT_STARTUP_PREFERENCES;
    const stored = window.localStorage.getItem(STARTUP_PREFERENCES_KEY);
    if (!stored) return DEFAULT_STARTUP_PREFERENCES;
    try {
        const parsed = JSON.parse(stored) as Partial<StartupPreferences>;
        const workspace = parsed.startupWorkspace;
        const isWorkspaceValid = typeof workspace === 'string' && workspace.length > 0;
        return {
            startupWorkspace: isWorkspaceValid ? workspace as Workspace : DEFAULT_STARTUP_PREFERENCES.startupWorkspace,
            autoOpenAssistant: parsed.autoOpenAssistant === true,
            studioAgentMode: parsed.studioAgentMode === 'manual' ? 'manual' : DEFAULT_STARTUP_PREFERENCES.studioAgentMode,
            studioAgentApprovalMode: parsed.studioAgentApprovalMode === 'every_action'
                ? 'every_action'
                : DEFAULT_STARTUP_PREFERENCES.studioAgentApprovalMode,
        };
    } catch {
        return DEFAULT_STARTUP_PREFERENCES;
    }
};

const getInitialUIMode = (): UIMode => {
    if (typeof window === 'undefined') return normalizeUIMode(null);
    return normalizeUIMode(window.localStorage.getItem(UI_MODE_STORAGE_KEY));
};

const isProjectHubPhase = (value: string): value is ProjectHubPhase =>
    PROJECT_HUB_PHASES.includes(value as ProjectHubPhase);

const BACKGROUND_SAFE_STUDIO_AGENT_CAPABILITIES = new Set<StudioAgentCapabilityId>([
    'write_project_script',
    'improve_project_script',
    'run_director_pass',
    'apply_director_treatment',
    'generate_project_concepts',
    'generate_storyboard_images',
    'generate_storyboard_videos',
    'research_web',
    'analyze_image_asset',
    'edit_image_asset',
    'relight_image_asset',
]);

const BACKGROUND_SAFE_STUDIO_AGENT_STATUSES = new Set([
    'planning',
    'acting',
    'verifying',
]);

const mapProfileToCollaboratorRole = (
    role?: UserProfile['role'],
): ProjectCollaborator['role'] => {
    if (role === 'director') return 'admin';
    return 'editor';
};

const clampRatio = (value: number) => Math.max(0, Math.min(1, value));

const hasAnyLocalApiKey = () => {
    if (typeof window === 'undefined') return false;
    return Boolean(
        localStorage.getItem('gemini_api_key') ||
        localStorage.getItem('replicate_api_key') ||
        localStorage.getItem('elevenlabs_api_key') ||
        localStorage.getItem('fal_api_key') ||
        localStorage.getItem('ltx_api_key') ||
        localStorage.getItem('xai_api_key') ||
        localStorage.getItem('worldlabs_api_key') ||
        localStorage.getItem('sonauto_api_key') ||
        localStorage.getItem('unsplash_access_key')
    );
};

const isTypingTarget = (target: EventTarget | null) => {
    if (!target || !(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
};

const fileToPayload = async (file: File) => {
    const base64 = await fileToBase64(file);
    return { base64, mimeType: file.type || 'application/octet-stream' };
};

const urlToImagePayload = async (url: string) => {
    const { base64, mimeType } = await getBase64FromUrl(url);
    return { base64, mimeType: mimeType || 'image/png' };
};

const nextPaint = () =>
    new Promise<void>((resolve) => {
        if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
            setTimeout(resolve, 0);
            return;
        }
        window.requestAnimationFrame(() => resolve());
    });

function App() {
    // Authentication State
    const [user, setUser] = useState<User | null>(null);
    const [authStatus, setAuthStatus] = useState<'checking' | 'signed_in' | 'signed_out'>('checking');
    const [teamId, setTeamId] = useState<string | null>(null);
    const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
    const [showAbout, setShowAbout] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showPricing, setShowPricing] = useState(false);
    const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);

    // Application State
    const lastHistoryDomainRef = useRef<AppHistoryDomain | null>(null);
    const [activeWorkspace, setActiveWorkspace] = useState<Workspace>('PROJECT');
    const [
        mediaItems,
        setMediaItemsWithHistory,
        undoMediaItems,
        redoMediaItems,
        canUndoMediaItems,
        canRedoMediaItems,
        resetMediaItems,
    ] = useHistoryState<MediaItem[]>([]);
    const [
        timelineClips,
        setTimelineClipsWithHistory,
        undoTimelineClips,
        redoTimelineClips,
        canUndoTimelineClips,
        canRedoTimelineClips,
        resetTimelineClips,
    ] = useHistoryState<TimelineClip[]>([]);
    const [timelineTracks, setTimelineTracks] = useState<TimelineTrack[]>(INITIAL_TRACKS);
    const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
    const [activeTrackId, setActiveTrackId] = useState<string | null>(INITIAL_TRACKS[0]?.id || null);
    const [playheadPosition, setPlayheadPosition] = useState(0);
    const [isSnappingEnabled, setIsSnappingEnabled] = useState(true);
    const [editTrimMode, setEditTrimMode] = useState<'normal' | 'ripple' | 'roll' | 'slip' | 'slide'>('normal');
    const [storyBible, setStoryBible] = useState<StoryBible>(INITIAL_BIBLE);
    const [projectCollaboration, setProjectCollaboration] = useState<ProjectCollaboration>(DEFAULT_PROJECT_COLLABORATION);
    const [projectSync, setProjectSync] = useState<ProjectSyncConfig>(DEFAULT_PROJECT_SYNC);
    const [projectSyncStatus, setProjectSyncStatus] = useState<ProjectSyncStatus>({ state: 'idle' });
    const [realtimePresence, setRealtimePresence] = useState<ProjectCollaborationPresence[]>([]);
    const [realtimeStatus, setRealtimeStatus] = useState<'DISCONNECTED' | ProjectRealtimeStatus>('DISCONNECTED');
    const [collaborationDocStatus, setCollaborationDocStatus] = useState<'disabled' | 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'>('disabled');
    const [collaborativeLocks, setCollaborativeLocks] = useState<ProjectCollaborativeLock[]>([]);
    const [projectHubActivePhase, setProjectHubActivePhase] = useState<ProjectHubPhase | null>(null);
    const [projectHubRequestedPhase, setProjectHubRequestedPhase] = useState<ProjectHubPhase | null>(null);
    const [projectHubActiveShotNumber, setProjectHubActiveShotNumber] = useState<number | null>(null);
    const [studioAgentAssistantControlActive, setStudioAgentAssistantControlActive] = useState(false);
    const [studioAgentTasks, setStudioAgentTasks] = useState<StudioAgentTask[]>([]);
    const [studioAgentActiveTaskId, setStudioAgentActiveTaskId] = useState<string | null>(null);
    const [studioAgentApprovalBundle, setStudioAgentApprovalBundle] = useState<StudioAgentApprovalBundle | null>(null);
    const [latestAgentActivity, setLatestAgentActivity] = useState<{
        actorName: string;
        detail: string;
        createdAt: string;
    } | null>(null);
    const [
        references,
        setReferencesWithHistory,
        undoReferences,
        redoReferences,
        canUndoReferences,
        canRedoReferences,
        resetReferences,
    ] = useHistoryState<ReferenceItem[]>([]);
    const [avatars, setAvatars] = useState<AvatarProfile[]>([]);
    const [profiles, setProfiles] = useState<UserProfile[]>([]);
    const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
    const [
        shotPrompts,
        setShotPromptsWithHistory,
        undoShotPrompts,
        redoShotPrompts,
        canUndoShotPrompts,
        canRedoShotPrompts,
        resetShotPrompts,
    ] = useHistoryState<ShotPrompt[]>([]);
    const [reviewData, setReviewData] = useState<ReviewData>(INITIAL_REVIEW_DATA);
    const [namingTemplates, setNamingTemplates] = useState<NamingTemplate[]>([]);
    const [usageLedger, setUsageLedger] = useState<UsageLedger>(INITIAL_USAGE_LEDGER);
    const [costSettings, setCostSettings] = useState<CostSettings>(DEFAULT_COST_SETTINGS);
    const [waveformCache, setWaveformCache] = useState<WaveformCache>({});
    const [nodeGraph, setNodeGraph] = useState<NodeGraphState | null>(null);
    const [designCanvasState, setDesignCanvasState] = useState<DesignCanvasState | null>(null);
    const [setDesignState, setSetDesignState] = useState<SetDesignState | null>(null);
    const [sceneMapState, setSceneMapState] = useState<SceneMapState | null>(null);
    const [sceneWallState, setSceneWallState] = useState<SceneWallState | null>(null);
    const [worldGenState, setWorldGenState] = useState<WorldGenerationState | null>(null);
    const [analysisVideoFile, setAnalysisVideoFile] = useState<File | null>(null);
    const [analysisVideoUrl, setAnalysisVideoUrl] = useState<string | null>(null);
    const [analysisScriptText, setAnalysisScriptText] = useState('');
    const [analysisResult, setAnalysisResult] = useState<NeurocinematicsAnalysisResult | null>(null);
    const [videoGenSeed, setVideoGenSeed] = useState<MediaItem | null>(null);
    const [photoSeedImage, setPhotoSeedImage] = useState<string | null>(null);
    const [compositingSeedVideo, setCompositingSeedVideo] = useState<string | null>(null);
    const [apiKeyReady, setApiKeyReady] = useState(false);
    const [isLiveVisible, setIsLiveVisible] = useState(false);
    const [modalConfig, setModalConfig] = useState<OptionsModalConfig | null>(null);
    const [modalSubmitHandler, setModalSubmitHandler] = useState<((values: any, pricing?: PricingResult | null) => void | Promise<void>) | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isAssistantVisible, setIsAssistantVisible] = useState(false);
    const [projectPath, setProjectPath] = useState<string | null>(null);
    const [projectName, setProjectName] = useState<string | null>(null);
    const [lastAgentApplyBatch, setLastAgentApplyBatch] = useState<AgentApplyBatchSummary | null>(null);
    const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
    const [lastAutoSavedAt, setLastAutoSavedAt] = useState<string | null>(null);
    const [isProjectSaving, setIsProjectSaving] = useState(false);
    const [isAutoSaving, setIsAutoSaving] = useState(false);
    const [isProjectLoading, setIsProjectLoading] = useState(false);
    const [showDesignSystem, setShowDesignSystem] = useState(false);
    const [uiMode, setUiMode] = useState<UIMode>(getInitialUIMode);
    const [theme, setTheme] = useState<Theme>(getInitialTheme);
    const [shortcuts, setShortcuts] = useState<ShortcutMap>(getInitialShortcuts);
    const [autosaveSettings, setAutosaveSettings] = useState<AutosaveSettings>(getInitialAutosaveSettings);
    const [startupPreferences, setStartupPreferences] = useState<StartupPreferences>(getInitialStartupPreferences);
    const [studioAgentYieldedToManualControl, setStudioAgentYieldedToManualControl] = useState(false);
    const [showOnboarding, setShowOnboarding] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.localStorage.getItem(ONBOARDING_COMPLETED_KEY) !== 'true';
    });
    const realtimeSessionRef = useRef<ProjectRealtimeSession | null>(null);
    const collaborativeSessionRef = useRef<StructuredCollaborativeProjectSession | null>(null);
    const collaborativeSnapshotSignatureRef = useRef('');
    const studioAgentTasksRef = useRef<StudioAgentTask[]>([]);
    const studioAgentApprovalBundleRef = useRef<StudioAgentApprovalBundle | null>(null);
    const studioAgentRunningTaskIdRef = useRef<string | null>(null);
    const skipCollaborativePushSignatureRef = useRef<string | null>(null);
    const claimedStoryboardLockRef = useRef<string | null>(null);
    const claimedTimelineLockRef = useRef<string | null>(null);
    const projectHubAutomationRef = useRef<ProjectHubStudioAutomationBindings | null>(null);
    const localCursorRef = useRef<ProjectCollaborationPresence['cursor']>(null);
    const lastCursorPresenceAtRef = useRef(0);
    const setTimelineClips = useCallback<React.Dispatch<React.SetStateAction<TimelineClip[]>>>((nextTimelineClips) => {
        lastHistoryDomainRef.current = 'timeline';
        setTimelineClipsWithHistory(nextTimelineClips);
    }, [setTimelineClipsWithHistory]);
    const setMediaItems = useCallback<React.Dispatch<React.SetStateAction<MediaItem[]>>>((nextMediaItems) => {
        lastHistoryDomainRef.current = 'media';
        setMediaItemsWithHistory(nextMediaItems);
    }, [setMediaItemsWithHistory]);
    const setReferences = useCallback<React.Dispatch<React.SetStateAction<ReferenceItem[]>>>((nextReferences) => {
        lastHistoryDomainRef.current = 'references';
        setReferencesWithHistory(nextReferences);
    }, [setReferencesWithHistory]);
    const setShotPrompts = useCallback<React.Dispatch<React.SetStateAction<ShotPrompt[]>>>((nextShotPrompts) => {
        lastHistoryDomainRef.current = 'shots';
        setShotPromptsWithHistory(nextShotPrompts);
    }, [setShotPromptsWithHistory]);
    const activeProfile = profiles.find(profile => profile.id === activeProfileId) || profiles[0] || null;
    const isDirector = activeProfile?.role === 'director';
    const activeRole = activeProfile?.role || 'artist';
    const canViewPricing = costSettings.visibility?.[activeRole] ?? true;
    const canOpenDesignSystem = uiMode === 'pro';
    const showLiveConversationTool = uiMode !== 'beginner';
    const sceneWallFeatureAvailable = uiMode === 'pro';
    const sceneWallEnabled = Boolean(sceneWallState && sceneWallState.enabled !== false);
    const baseAllowedWorkspaces = useMemo(
        () => filterWorkspacesForRole(getAllowedWorkspacesForMode(uiMode), isDirector),
        [isDirector, uiMode],
    );
    const allowedWorkspaces = useMemo(
        () => baseAllowedWorkspaces.filter((workspace) => workspace !== 'SCENE_WALL' || sceneWallEnabled),
        [baseAllowedWorkspaces, sceneWallEnabled],
    );
    const allowedWorkspaceSet = useMemo(() => new Set<Workspace>(allowedWorkspaces), [allowedWorkspaces]);
    const canAccessWorkspace = useCallback(
        (workspace: Workspace) => allowedWorkspaceSet.has(workspace),
        [allowedWorkspaceSet],
    );
    const getPreferredHistoryDomain = useCallback((direction: 'undo' | 'redo'): AppHistoryDomain | null => {
        return selectAppHistoryDomain({
            activeWorkspace,
            lastDomain: lastHistoryDomainRef.current,
            availability: {
                timeline: direction === 'undo' ? canUndoTimelineClips : canRedoTimelineClips,
                references: direction === 'undo' ? canUndoReferences : canRedoReferences,
                shots: direction === 'undo' ? canUndoShotPrompts : canRedoShotPrompts,
                media: direction === 'undo' ? canUndoMediaItems : canRedoMediaItems,
            },
        });
    }, [
        activeWorkspace,
        canRedoMediaItems,
        canRedoReferences,
        canRedoShotPrompts,
        canRedoTimelineClips,
        canUndoMediaItems,
        canUndoReferences,
        canUndoShotPrompts,
        canUndoTimelineClips,
    ]);
    const undo = useCallback(() => {
        const domain = getPreferredHistoryDomain('undo');
        if (domain === 'references') {
            lastHistoryDomainRef.current = 'references';
            undoReferences();
            return;
        }
        if (domain === 'shots') {
            lastHistoryDomainRef.current = 'shots';
            undoShotPrompts();
            return;
        }
        if (domain === 'media') {
            lastHistoryDomainRef.current = 'media';
            undoMediaItems();
            return;
        }
        if (domain === 'timeline') {
            lastHistoryDomainRef.current = 'timeline';
            undoTimelineClips();
        }
    }, [getPreferredHistoryDomain, undoMediaItems, undoReferences, undoShotPrompts, undoTimelineClips]);
    const redo = useCallback(() => {
        const domain = getPreferredHistoryDomain('redo');
        if (domain === 'references') {
            lastHistoryDomainRef.current = 'references';
            redoReferences();
            return;
        }
        if (domain === 'shots') {
            lastHistoryDomainRef.current = 'shots';
            redoShotPrompts();
            return;
        }
        if (domain === 'media') {
            lastHistoryDomainRef.current = 'media';
            redoMediaItems();
            return;
        }
        if (domain === 'timeline') {
            lastHistoryDomainRef.current = 'timeline';
            redoTimelineClips();
        }
    }, [getPreferredHistoryDomain, redoMediaItems, redoReferences, redoShotPrompts, redoTimelineClips]);
    const canUndo = canUndoTimelineClips || canUndoReferences || canUndoShotPrompts || canUndoMediaItems;
    const canRedo = canRedoTimelineClips || canRedoReferences || canRedoShotPrompts || canRedoMediaItems;
    const localCollaborator = useMemo<ProjectCollaborator>(() => {
        const preferredName =
            activeProfile?.name?.trim() ||
            user?.name?.trim() ||
            user?.email?.split('@')[0] ||
            'Local Studio';
        const matchingCollaborator =
            projectCollaboration.collaborators.find((collaborator) => user?.email && collaborator.email === user.email) ||
            projectCollaboration.collaborators.find((collaborator) => collaborator.name === preferredName);

        return {
            id:
                matchingCollaborator?.id ||
                user?.id ||
                `local-${preferredName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`,
            name: matchingCollaborator?.name || preferredName,
            role: matchingCollaborator?.role || mapProfileToCollaboratorRole(activeProfile?.role),
            email: matchingCollaborator?.email || user?.email,
        };
    }, [activeProfile?.name, activeProfile?.role, projectCollaboration.collaborators, user?.email, user?.id, user?.name]);
    const localPresenceStatus = useMemo<ProjectCollaborationPresence['status']>(() => {
        if (isProjectSaving || isAutoSaving || projectSyncStatus.state === 'checking') return 'syncing';
        if (activeWorkspace === 'EXPORT') return 'rendering';
        if (activeWorkspace === 'REVIEW' || activeWorkspace === 'REQUESTS') return 'reviewing';
        return 'active';
    }, [activeWorkspace, isAutoSaving, isProjectSaving, projectSyncStatus.state]);
    const projectRealtimeId = useMemo(() => {
        const base = projectPath || projectName || storyBible.title || '';
        const normalized = base.trim();
        return normalized || null;
    }, [projectName, projectPath, storyBible.title]);
    const resolvedCreativeDNA = useMemo(
        () => resolveCreativeDNAProfile({ storyBible }),
        [storyBible],
    );
    const collaborativeSnapshot = useMemo(() => ({
        shotPrompts,
        reviewData,
        timelineClips,
        timelineTracks,
        selectedClipId,
    }), [reviewData, selectedClipId, shotPrompts, timelineClips, timelineTracks]);
    const collaborativeSnapshotSignature = useMemo(
        () => JSON.stringify(collaborativeSnapshot),
        [collaborativeSnapshot],
    );
    const resolveCreativeDNAForImageUrl = useCallback((imageUrl: string) => {
        const matchedShot = shotPrompts.find((shot) =>
            [
                shot.imageUrl,
                shot.sketchUrl,
                shot.startFrameUrl,
                shot.endFrameUrl,
                shot.openPoseReferenceUrl,
                shot.openPoseSourceUrl,
            ].includes(imageUrl),
        );

        if (!matchedShot) {
            return resolvedCreativeDNA;
        }

        const sceneOverride = findCreativeDNASceneOverride(storyBible, {
            sceneNumber: matchedShot.sceneNumber,
            sceneSlugline: matchedShot.sceneSlugline,
        });

        return resolveCreativeDNAProfile({
            storyBible,
            sceneOverride,
            shotOverride: matchedShot.creativeDNAOverride || null,
        });
    }, [resolvedCreativeDNA, shotPrompts, storyBible]);
    const activeCollaborativeLocks = useMemo(
        () =>
            collaborativeLocks.filter((lock) => {
                if (!lock.expiresAt) return true;
                return new Date(lock.expiresAt).getTime() > Date.now();
            }),
        [collaborativeLocks],
    );
    const updateCollaborativeLockState = useCallback((
        nextLock: ProjectCollaborativeLock,
        action: 'claim' | 'release',
    ) => {
        setCollaborativeLocks((prev) => {
            const filtered = prev.filter(
                (entry) => !(entry.scope === nextLock.scope && entry.key === nextLock.key),
            );
            if (action === 'release') {
                return filtered;
            }
            return [...filtered, nextLock];
        });
    }, []);
    const changeRequests = reviewData.changeRequests ?? [];
    const requestSummaries = useMemo(() => {
        const normalize = (value: string) => value.trim().toLowerCase();
        return changeRequests.map((request) => {
            const target = normalize(request.targetName);
            const affectedShots = shotPrompts
                .filter((shot) => {
                    if (request.type === 'character') {
                        return shot.characters?.some((name) => normalize(name) === target);
                    }
                    if (request.type === 'environment') {
                        return normalize(shot.environment || '') === target;
                    }
                    if (request.type === 'product' || request.type === 'brand') {
                        const productMatch = shot.products?.some((name) => normalize(name) === target);
                        const textMatch =
                            normalize(shot.prompt || '').includes(target) ||
                            normalize(shot.description || '').includes(target);
                        return Boolean(productMatch || textMatch);
                    }
                    return false;
                })
                .map((shot) => shot.shot);
            return { ...request, affectedShots };
        });
    }, [changeRequests, shotPrompts]);
    const autosaveTimerRef = useRef<number | null>(null);
    const lastAutoSaveRef = useRef<number>(0);
    const suppressAutosaveRef = useRef(true);
    const isHydratingRef = useRef(false);
    const playbackRafRef = useRef<number | null>(null);
    const playheadRef = useRef(0);
    const projectFileMtimeRef = useRef<number | null>(null);
    const syncStatusRef = useRef<ProjectSyncStatus>({ state: 'idle' });
    const sessionIdRef = useRef(`session-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const startupAppliedRef = useRef(false);
    const projectHubActivePhaseRef = useRef<ProjectHubPhase | null>(null);
    const assistantExplicitAgentIntentRef = useRef(false);

    const isElectron =
        typeof window !== 'undefined' &&
        (Boolean(window.electron?.project) ||
            navigator.userAgent.toLowerCase().includes(' electron/'));

    const waitForProjectHubAutomation = useCallback(async () => {
        for (let attempt = 0; attempt < 16; attempt += 1) {
            if (projectHubAutomationRef.current) {
                return projectHubAutomationRef.current;
            }
            await nextPaint();
        }
        throw new Error('Project Hub automation is not ready yet.');
    }, []);

    const ensureProjectHubAutomation = useCallback(async (phase?: ProjectHubPhase) => {
        if (activeWorkspace !== 'PROJECT') {
            setActiveWorkspace('PROJECT');
            await nextPaint();
        }
        if (phase && projectHubRequestedPhase !== phase) {
            setProjectHubRequestedPhase(phase);
        }
        const bindings = await waitForProjectHubAutomation();
        if (phase && projectHubRequestedPhase !== phase) {
            await nextPaint();
        }
        return bindings;
    }, [activeWorkspace, projectHubRequestedPhase, waitForProjectHubAutomation]);

    const studioSnapshot = useMemo<StudioAgentSnapshot>(() => ({
        projectName: projectName || storyBible.title || 'Untitled project',
        activeWorkspace,
        activeProjectPhase: projectHubActivePhase,
        selectedClipId,
        playheadPosition,
        timelineClipCount: timelineClips.length,
        timelineTrackCount: timelineTracks.length,
        storyboardShotCount: shotPrompts.length,
        referencesCount: references.length,
        draftReady: shotPrompts.some((shot) => Boolean(shot.imageUrl || shot.videoUrl)),
        creativeDNA: resolvedCreativeDNA,
        reviewCommentCount:
            reviewData.comments.length +
            (reviewData.directorFeedback?.length || 0) +
            (reviewData.changeRequests?.length || 0),
        collaboration: {
            collaboratorCount: Math.max(projectCollaboration.collaborators.length, realtimePresence.length),
            activePresenceCount: realtimePresence.filter((entry) => entry.status !== 'idle').length,
            syncProvider: projectSync.provider || null,
            autoSync: projectSync.autoSync !== false,
        },
    }), [
        activeWorkspace,
        playheadPosition,
        projectCollaboration.collaborators.length,
        projectHubActivePhase,
        projectName,
        projectSync.autoSync,
        projectSync.provider,
        realtimePresence,
        references.length,
        resolvedCreativeDNA,
        reviewData.changeRequests,
        reviewData.comments.length,
        reviewData.directorFeedback,
        selectedClipId,
        shotPrompts,
        storyBible.title,
        timelineClips.length,
        timelineTracks.length,
    ]);

    const pushRealtimePresence = useCallback((overrides: Partial<ProjectCollaborationPresence> = {}) => {
        const session = realtimeSessionRef.current;
        if (!session) return;
        void session.updatePresence({
            workspace: activeWorkspace,
            activePhase: projectHubActivePhase || undefined,
            activeShotNumber: projectHubActiveShotNumber,
            activeClipId: selectedClipId,
            status: localPresenceStatus,
            cursor: localCursorRef.current,
            ...overrides,
        });
    }, [
        activeWorkspace,
        localPresenceStatus,
        projectHubActivePhase,
        projectHubActiveShotNumber,
        selectedClipId,
    ]);

    useEffect(() => {
        projectHubActivePhaseRef.current = projectHubActivePhase;
    }, [projectHubActivePhase]);

    useEffect(() => {
        collaborativeSnapshotSignatureRef.current = collaborativeSnapshotSignature;
    }, [collaborativeSnapshotSignature]);

    useEffect(() => {
        studioAgentTasksRef.current = studioAgentTasks;
    }, [studioAgentTasks]);

    useEffect(() => {
        studioAgentApprovalBundleRef.current = studioAgentApprovalBundle;
    }, [studioAgentApprovalBundle]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setCollaborativeLocks((prev) =>
                prev.filter((lock) => !lock.expiresAt || new Date(lock.expiresAt).getTime() > Date.now()),
            );
        }, 15000);
        return () => window.clearInterval(timer);
    }, []);

    const {
        state: studioAgentState,
        execute: executeStudioAgent,
        approvePending: approvePendingStudioAgentActionRaw,
        rejectPending: rejectPendingStudioAgentActionRaw,
        cancelCurrent: cancelStudioAgentExecution,
    } = useStudioAgentRuntime({
        snapshot: studioSnapshot,
        actor: {
            id: localCollaborator.id,
            name: localCollaborator.name,
            role: localCollaborator.role,
            sessionId: sessionIdRef.current,
        },
        enabled: startupPreferences.studioAgentMode === 'agent',
        approvalMode: startupPreferences.studioAgentApprovalMode,
        onNavigateWorkspace: async (workspace) => {
            setActiveWorkspace(workspace);
            await nextPaint();
        },
        onSetProjectPhase: async (phase) => {
            if (isProjectHubPhase(phase)) {
                setProjectHubRequestedPhase(phase);
                await ensureProjectHubAutomation(phase);
                for (let attempt = 0; attempt < 12; attempt += 1) {
                    if (projectHubActivePhaseRef.current === phase) {
                        break;
                    }
                    await nextPaint();
                }
            }
        },
        onSelectTimelineClip: async (clipId) => {
            setSelectedClipId(clipId || null);
            await nextPaint();
        },
        onWriteProjectScript: async ({ prompt, length, mode }) => {
            setProjectHubRequestedPhase('script');
            const bindings = await ensureProjectHubAutomation('script');
            return bindings.writeProjectScript({
                prompt,
                length,
                mode,
            });
        },
        onImproveProjectScript: async ({ instruction, targetScore, maxPasses }) => {
            setProjectHubRequestedPhase('script');
            const bindings = await ensureProjectHubAutomation('script');
            return bindings.improveProjectScript({
                instruction,
                targetScore,
                maxPasses,
            });
        },
        onGenerateProjectConcepts: async ({ limit }) => {
            setProjectHubRequestedPhase('concept');
            const bindings = await ensureProjectHubAutomation('concept');
            return bindings.generateProjectConcepts({ limit });
        },
        onRunDirectorPass: async () => {
            setProjectHubRequestedPhase('director');
            const bindings = await ensureProjectHubAutomation('director');
            return bindings.runDirectorPass();
        },
        onApplyDirectorTreatment: async () => {
            setProjectHubRequestedPhase('director');
            const bindings = await ensureProjectHubAutomation('director');
            return bindings.applyDirectorTreatment();
        },
        onGenerateStoryboardImages: async ({ limit }) => {
            setProjectHubRequestedPhase('storyboard');
            const bindings = await ensureProjectHubAutomation('storyboard');
            return bindings.generateStoryboardImages({ limit });
        },
        onGenerateStoryboardVideos: async ({ limit }) => {
            setProjectHubRequestedPhase('filming');
            const bindings = await ensureProjectHubAutomation('filming');
            return bindings.generateStoryboardVideos({ limit });
        },
        onResearchWeb: async ({ query, kind }) => {
            const result = await searchBrave(
                query,
                kind === 'news' || kind === 'image' ? kind : 'web',
                { count: 6 },
            );
            if (!result.ok) {
                throw new Error(result.error || 'Brave research failed.');
            }
            return {
                detail: `Research returned ${result.hits.length} ${result.kind} sources for "${query}".`,
            };
        },
        onAnalyzeImageAsset: async ({ imageUrl, objective }) => {
            const creativeDNA = resolveCreativeDNAForImageUrl(imageUrl);
            const result = await analyzeImageAsset({
                mediaOrUrl: imageUrl,
                prompt: objective || 'Critique this image for cinematic quality, lighting continuity, framing, and shot usefulness.',
                creativeDNA,
            });
            setMediaItems((prev) => prev.map((item) => (
                item.url !== imageUrl
                    ? item
                    : {
                        ...item,
                        analysisNotes: [...(item.analysisNotes || []), result.analysis],
                    }
            )));
            setShotPrompts((prev) => prev.map((shot) => (
                shot.imageUrl !== imageUrl && shot.sketchUrl !== imageUrl && shot.startFrameUrl !== imageUrl && shot.endFrameUrl !== imageUrl
                    ? shot
                    : {
                        ...shot,
                        analysisNotes: [...(shot.analysisNotes || []), result.analysis],
                    }
            )));
            return {
                detail: result.analysis.slice(0, 180),
            };
        },
        onEditImageAsset: async ({ imageUrl, prompt, referenceImageUrl }) => {
            const source = await resolveLookAgentSource(imageUrl);
            const referenceImage = referenceImageUrl
                ? await resolveLookAgentSource(referenceImageUrl)
                : null;
            const result = await runLookAgentTool({
                tool: 'edit',
                prompt,
                provider: 'gemini',
                source,
                referenceImage,
                creativeDNA: resolveCreativeDNAForImageUrl(imageUrl),
            });
            if (!result.media) {
                throw new Error('Image edit completed without a generated asset.');
            }
            setMediaItems((prev) => [...prev, result.media as MediaItem]);
            return {
                detail: `Edited image generated: ${result.media.name}.`,
            };
        },
        onRelightImageAsset: async ({ imageUrl, prompt }) => {
            const source = await resolveLookAgentSource(imageUrl);
            const result = await runLookAgentTool({
                tool: 'relight',
                prompt,
                provider: 'gemini',
                source,
                creativeDNA: resolveCreativeDNAForImageUrl(imageUrl),
            });
            if (!result.media) {
                throw new Error('Relight completed without a generated asset.');
            }
            setMediaItems((prev) => [...prev, result.media as MediaItem]);
            return {
                detail: `Relit image generated: ${result.media.name}.`,
            };
        },
        onAgentActivity: ({ capabilityId, capabilityTitle, detail, status, createdAt }) => {
            setLatestAgentActivity({
                actorName: localCollaborator.name,
                detail,
                createdAt,
            });
            const session = realtimeSessionRef.current;
            if (!session) return;
            void session.broadcast(
                'agent_activity',
                {
                    capabilityId,
                    capabilityTitle,
                    detail,
                    status,
                },
                { source: 'local' },
            );
        },
    });

    const replaceStudioAgentTasks = useCallback((nextTasks: StudioAgentTask[]) => {
        studioAgentTasksRef.current = nextTasks;
        setStudioAgentTasks(nextTasks);
    }, []);

    const mutateStudioAgentTask = useCallback((
        taskId: string,
        updater: (task: StudioAgentTask) => StudioAgentTask,
    ) => {
        const nextTasks = studioAgentTasksRef.current.map((task) => (
            task.id === taskId ? updater(task) : task
        ));
        studioAgentTasksRef.current = nextTasks;
        setStudioAgentTasks(nextTasks);
        return nextTasks.find((task) => task.id === taskId) || null;
    }, []);

    const patchStudioAgentTaskWithSummary = useCallback((
        taskId: string,
        updater: (task: StudioAgentTask) => StudioAgentTask,
    ) => mutateStudioAgentTask(taskId, (task) => {
        const updatedTask = updater(task);
        return patchStudioAgentTask(updatedTask, {
            resultSummary: summarizeStudioAgentTask(updatedTask),
        });
    }), [mutateStudioAgentTask]);

    const activeStudioAgentTask = useMemo(() => {
        if (studioAgentActiveTaskId) {
            return studioAgentTasks.find((task) => task.id === studioAgentActiveTaskId) || null;
        }
        const incompleteTask = [...studioAgentTasks].reverse().find((task) => task.status !== 'completed');
        return incompleteTask || studioAgentTasks[studioAgentTasks.length - 1] || null;
    }, [studioAgentActiveTaskId, studioAgentTasks]);

    const activeStudioAgentTaskSummary = useMemo(
        () => activeStudioAgentTask?.resultSummary || (activeStudioAgentTask ? summarizeStudioAgentTask(activeStudioAgentTask) : null),
        [activeStudioAgentTask],
    );

    const ensureAssistantAgentAccess = useCallback(() => {
        if (startupPreferences.studioAgentMode !== 'agent') {
            return {
                ok: false as const,
                message: 'Studio Agent is in manual mode. Switch Agent Mode on in settings to let the assistant drive the workflow.',
            };
        }
        if (studioAgentYieldedToManualControl) {
            return {
                ok: false as const,
                message: 'Studio Agent yielded to manual navigation. Send a new assistant request to resume agent control.',
            };
        }
        if (!assistantExplicitAgentIntentRef.current) {
            return {
                ok: false as const,
                message: 'Studio Agent execution is blocked until you explicitly ask the assistant to use the agent.',
            };
        }
        return { ok: true as const };
    }, [
        startupPreferences.studioAgentMode,
        studioAgentYieldedToManualControl,
    ]);

    const findIncompleteStudioAgentTask = useCallback(() => {
        const tasks = studioAgentTasksRef.current;
        if (studioAgentActiveTaskId) {
            const activeTask = tasks.find((task) => task.id === studioAgentActiveTaskId);
            if (activeTask && activeTask.status !== 'completed') {
                return activeTask;
            }
        }
        return [...tasks].reverse().find((task) => task.status !== 'completed') || null;
    }, [studioAgentActiveTaskId]);

    const resumeStudioAgentTask = useCallback(async (
        requestedTaskId?: string,
        options?: { initiatedByAssistant?: boolean },
    ): Promise<StudioAgentTaskRunResult> => {
        const targetTask = requestedTaskId
            ? studioAgentTasksRef.current.find((task) => task.id === requestedTaskId) || null
            : findIncompleteStudioAgentTask();

        if (!targetTask) {
            return { success: false, message: 'No incomplete Studio Agent run is queued.' };
        }

        if (targetTask.status === 'completed') {
            setStudioAgentActiveTaskId(targetTask.id);
            return {
                success: true,
                taskId: targetTask.id,
                message: targetTask.resultSummary || 'Studio Agent run is already complete.',
            };
        }

        if (
            studioAgentRunningTaskIdRef.current
            && studioAgentRunningTaskIdRef.current !== targetTask.id
        ) {
            return {
                success: false,
                taskId: targetTask.id,
                message: 'Another Studio Agent run is already in progress.',
            };
        }

        if (options?.initiatedByAssistant) {
            const access = ensureAssistantAgentAccess();
            if (!access.ok) {
                return {
                    success: false,
                    taskId: targetTask.id,
                    message: access.message,
                };
            }
            setStudioAgentAssistantControlActive(true);
        }

        setStudioAgentActiveTaskId(targetTask.id);
        studioAgentRunningTaskIdRef.current = targetTask.id;

        try {
            while (true) {
                const currentTask = studioAgentTasksRef.current.find((task) => task.id === targetTask.id) || null;
                if (!currentTask) {
                    return { success: false, taskId: targetTask.id, message: 'Studio Agent run was not found.' };
                }

                const nextStep = getNextStudioAgentTaskStep(currentTask);
                if (!nextStep) {
                    const completedTask = patchStudioAgentTaskWithSummary(currentTask.id, (task) => (
                        patchStudioAgentTask(task, {
                            status: 'completed',
                            approvalRequest: null,
                        })
                    ));
                    if (studioAgentApprovalBundleRef.current?.taskId === currentTask.id) {
                        setStudioAgentApprovalBundle(null);
                    }
                    return {
                        success: true,
                        taskId: currentTask.id,
                        message: completedTask?.resultSummary || 'Studio Agent run completed.',
                    };
                }

                if (!nextStep.capabilityId) {
                    const continuedTask = patchStudioAgentTaskWithSummary(currentTask.id, (task) => (
                        patchStudioAgentTaskStep(task, nextStep.id, {
                            status: 'completed',
                            detail: nextStep.detail || `${nextStep.title} is already satisfied.`,
                        })
                    ));
                    if (!continuedTask) {
                        return {
                            success: false,
                            taskId: currentTask.id,
                            message: 'Studio Agent run could not advance to the next step.',
                        };
                    }
                    continue;
                }

                patchStudioAgentTaskWithSummary(currentTask.id, (task) => {
                    const taskWithRunningStep = patchStudioAgentTaskStep(task, nextStep.id, {
                        status: 'running',
                        detail: `Running ${nextStep.title}.`,
                    });
                    return patchStudioAgentTask(taskWithRunningStep, {
                        status: 'running',
                        approvalRequest: null,
                    });
                });

                let rawResult = await executeStudioAgent(
                    nextStep.capabilityId,
                    nextStep.input || {},
                    { taskId: currentTask.id },
                ) as { ok?: boolean; needsApproval?: boolean; detail?: string; cancelled?: boolean };

                if (rawResult.needsApproval) {
                    const canAutoApproveWithBundle =
                        startupPreferences.studioAgentApprovalMode !== 'every_action'
                        && studioAgentApprovalBundleRef.current?.taskId === currentTask.id
                        && studioAgentApprovalBundleRef.current?.autoApproveRemaining;

                    if (canAutoApproveWithBundle) {
                        rawResult = await approvePendingStudioAgentActionRaw() as {
                            ok?: boolean;
                            detail?: string;
                            cancelled?: boolean;
                        };
                    } else {
                        const blockedTask = patchStudioAgentTaskWithSummary(currentTask.id, (task) => {
                            const taskWithBlockedStep = patchStudioAgentTaskStep(task, nextStep.id, {
                                status: 'blocked',
                                detail: rawResult.detail || `${nextStep.title} is awaiting approval.`,
                            });
                            return patchStudioAgentTask(taskWithBlockedStep, {
                                status: 'awaiting_approval',
                            });
                        });
                        return {
                            success: false,
                            taskId: currentTask.id,
                            needsApproval: true,
                            message: blockedTask?.resultSummary || rawResult.detail || `${nextStep.title} is awaiting approval.`,
                        };
                    }
                }

                if (rawResult.ok === false) {
                    const failedTask = patchStudioAgentTaskWithSummary(currentTask.id, (task) => {
                        const taskWithFailedStep = patchStudioAgentTaskStep(task, nextStep.id, {
                            status: 'failed',
                            detail: rawResult.detail || `${nextStep.title} failed.`,
                        });
                        return patchStudioAgentTask(taskWithFailedStep, {
                            status: 'failed',
                            approvalRequest: null,
                        });
                    });
                    return {
                        success: false,
                        taskId: currentTask.id,
                        message: failedTask?.resultSummary || rawResult.detail || `${nextStep.title} failed.`,
                    };
                }

                patchStudioAgentTaskWithSummary(currentTask.id, (task) => {
                    const taskWithCompletedStep = patchStudioAgentTaskStep(task, nextStep.id, {
                        status: 'completed',
                        detail: rawResult.detail || `${nextStep.title} completed.`,
                    });
                    return patchStudioAgentTask(taskWithCompletedStep, {
                        status: 'running',
                        approvalRequest: null,
                    });
                });
            }
        } finally {
            if (studioAgentRunningTaskIdRef.current === targetTask.id) {
                studioAgentRunningTaskIdRef.current = null;
            }
        }
    }, [
        approvePendingStudioAgentActionRaw,
        ensureAssistantAgentAccess,
        executeStudioAgent,
        findIncompleteStudioAgentTask,
        patchStudioAgentTaskWithSummary,
        startupPreferences.studioAgentApprovalMode,
    ]);

    const runStudioAgentProjectWorkflow = useCallback(async (payload?: {
        prompt?: string;
        length?: ScriptLength;
        mode?: 'fast' | 'slow';
        conceptLimit?: number;
        storyboardLimit?: number;
        includeVideos?: boolean;
        videoLimit?: number;
    }): Promise<StudioAgentTaskRunResult> => {
        const existingTask = findIncompleteStudioAgentTask();
        if (existingTask) {
            setStudioAgentActiveTaskId(existingTask.id);
            return {
                success: false,
                taskId: existingTask.id,
                message: `${existingTask.title} is already in progress. ${existingTask.resultSummary || summarizeStudioAgentTask(existingTask)}`,
            };
        }

        try {
            const task = buildStudioAgentProjectRunTask({
                prompt: typeof payload?.prompt === 'string' ? payload.prompt : undefined,
                length: payload?.length,
                mode: payload?.mode,
                scriptExists: Boolean((storyBible.script || '').trim()),
                conceptLimit: typeof payload?.conceptLimit === 'number' && Number.isFinite(payload.conceptLimit)
                    ? Math.max(1, Math.floor(payload.conceptLimit))
                    : undefined,
                storyboardLimit: typeof payload?.storyboardLimit === 'number' && Number.isFinite(payload.storyboardLimit)
                    ? Math.max(1, Math.floor(payload.storyboardLimit))
                    : undefined,
                includeVideos: payload?.includeVideos === true,
                videoLimit: typeof payload?.videoLimit === 'number' && Number.isFinite(payload.videoLimit)
                    ? Math.max(1, Math.floor(payload.videoLimit))
                    : undefined,
            });
            replaceStudioAgentTasks([...studioAgentTasksRef.current, task]);
            setStudioAgentActiveTaskId(task.id);
            setStudioAgentApprovalBundle(null);
            return resumeStudioAgentTask(task.id, { initiatedByAssistant: true });
        } catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Failed to create the Studio Agent run.',
            };
        }
    }, [
        findIncompleteStudioAgentTask,
        replaceStudioAgentTasks,
        resumeStudioAgentTask,
        storyBible.script,
    ]);

    const resumeStudioAgentTaskQueue = useCallback(async (
        options?: { initiatedByAssistant?: boolean },
    ): Promise<StudioAgentTaskRunResult> => {
        return resumeStudioAgentTask(undefined, options);
    }, [resumeStudioAgentTask]);

    const approveStudioAgentAction = useCallback(async () => {
        const pendingApproval = studioAgentState.pendingApproval;
        if (!pendingApproval) {
            const rawResult = await approvePendingStudioAgentActionRaw() as {
                ok?: boolean;
                detail?: string;
                needsApproval?: boolean;
            };
            return {
                success: rawResult.ok !== false,
                needsApproval: rawResult.needsApproval === true,
                capabilityId: 'navigate_workspace',
                message: rawResult.detail || 'Studio Agent action finished.',
            };
        }

        const capabilityId = pendingApproval.capabilityId;
        const taskId = pendingApproval.taskId;
        const shouldActivateBundle = Boolean(
            taskId
            && startupPreferences.studioAgentApprovalMode !== 'every_action',
        );

        if (shouldActivateBundle && taskId) {
            const task = studioAgentTasksRef.current.find((entry) => entry.id === taskId);
            setStudioAgentApprovalBundle({
                id: `approval-bundle-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
                taskId,
                title: task?.title || 'Studio Agent Run',
                createdAt: pendingApproval.createdAt,
                approvedAt: new Date().toISOString(),
                autoApproveRemaining: true,
            });
        }

        const rawResult = await approvePendingStudioAgentActionRaw() as {
            ok?: boolean;
            detail?: string;
            needsApproval?: boolean;
            cancelled?: boolean;
        };
        const detail = typeof rawResult.detail === 'string'
            ? rawResult.detail
            : 'Studio Agent action approved.';

        if (!taskId) {
            return {
                success: rawResult.ok !== false,
                needsApproval: rawResult.needsApproval === true,
                capabilityId,
                message: detail,
            };
        }

        patchStudioAgentTaskWithSummary(taskId, (task) => {
            const pendingStep = task.steps.find((step) => (
                step.capabilityId === capabilityId
                && (step.status === 'blocked' || step.status === 'running' || step.status === 'failed' || step.status === 'pending')
            )) || getNextStudioAgentTaskStep(task);

            if (!pendingStep) {
                return patchStudioAgentTask(task, {
                    status: rawResult.ok === false ? 'failed' : 'running',
                    approvalRequest: null,
                });
            }

            const taskWithResolvedStep = patchStudioAgentTaskStep(task, pendingStep.id, {
                status: rawResult.ok === false ? 'failed' : 'completed',
                detail,
            });
            return patchStudioAgentTask(taskWithResolvedStep, {
                status: rawResult.ok === false ? 'failed' : 'running',
                approvalRequest: null,
            });
        });

        if (rawResult.ok === false) {
            return {
                success: false,
                capabilityId,
                message: detail,
            };
        }

        const resumeResult = await resumeStudioAgentTask(taskId, {
            initiatedByAssistant: studioAgentAssistantControlActive,
        });
        const prefix = shouldActivateBundle
            ? 'Approval bundle active for the remaining run. '
            : '';
        return {
            success: resumeResult.success,
            needsApproval: resumeResult.needsApproval,
            capabilityId,
            message: `${prefix}${resumeResult.message}`,
        };
    }, [
        approvePendingStudioAgentActionRaw,
        patchStudioAgentTaskWithSummary,
        resumeStudioAgentTask,
        startupPreferences.studioAgentApprovalMode,
        studioAgentAssistantControlActive,
        studioAgentState.pendingApproval,
    ]);

    const rejectStudioAgentAction = useCallback((reason?: string) => {
        const pendingApproval = studioAgentState.pendingApproval;
        const capabilityId = pendingApproval?.capabilityId || 'navigate_workspace';
        const rawResult = rejectPendingStudioAgentActionRaw(reason) as {
            ok?: boolean;
            detail?: string;
            needsApproval?: boolean;
        };

        if (pendingApproval?.taskId) {
            patchStudioAgentTaskWithSummary(pendingApproval.taskId, (task) => {
                const pendingStep = task.steps.find((step) => (
                    step.capabilityId === capabilityId
                    && (step.status === 'blocked' || step.status === 'running' || step.status === 'failed' || step.status === 'pending')
                )) || getNextStudioAgentTaskStep(task);

                if (!pendingStep) {
                    return patchStudioAgentTask(task, {
                        status: 'failed',
                        approvalRequest: null,
                    });
                }

                const taskWithRejectedStep = patchStudioAgentTaskStep(task, pendingStep.id, {
                    status: 'failed',
                    detail: rawResult.detail || 'Approval rejected.',
                });
                return patchStudioAgentTask(taskWithRejectedStep, {
                    status: 'failed',
                    approvalRequest: null,
                });
            });

            if (studioAgentApprovalBundleRef.current?.taskId === pendingApproval.taskId) {
                setStudioAgentApprovalBundle(null);
            }

            const task = studioAgentTasksRef.current.find((entry) => entry.id === pendingApproval.taskId) || null;
            return {
                success: false,
                capabilityId,
                message: task?.resultSummary || rawResult.detail || 'Approval rejected.',
            };
        }

        return {
            success: rawResult.ok !== false,
            needsApproval: rawResult.needsApproval === true,
            capabilityId,
            message: rawResult.detail || 'Studio Agent action finished.',
        };
    }, [
        patchStudioAgentTaskWithSummary,
        rejectPendingStudioAgentActionRaw,
        studioAgentState.pendingApproval,
    ]);

    useEffect(() => {
        if (!studioAgentAssistantControlActive) return;
        if (studioAgentState.pendingApproval) return;
        if (
            activeStudioAgentTask
            && activeStudioAgentTask.status !== 'completed'
        ) {
            return;
        }
        if (
            studioAgentState.status === 'planning' ||
            studioAgentState.status === 'acting' ||
            studioAgentState.status === 'verifying'
        ) {
            return;
        }
        setStudioAgentAssistantControlActive(false);
    }, [
        activeStudioAgentTask,
        studioAgentAssistantControlActive,
        studioAgentState.pendingApproval,
        studioAgentState.status,
    ]);

    const handleManualWorkspaceSwitch = useCallback((workspace: Workspace) => {
        if (!studioAgentAssistantControlActive) {
            setActiveWorkspace(workspace);
            return;
        }

        const activeCapabilityId = studioAgentState.capabilityId;
        const canContinueInBackground = Boolean(
            activeCapabilityId &&
            BACKGROUND_SAFE_STUDIO_AGENT_CAPABILITIES.has(activeCapabilityId) &&
            BACKGROUND_SAFE_STUDIO_AGENT_STATUSES.has(studioAgentState.status),
        );

        if (canContinueInBackground) {
            setStudioAgentYieldedToManualControl(true);
            setStudioAgentAssistantControlActive(false);
            setLatestAgentActivity({
                actorName: localCollaborator.name,
                detail: `${studioAgentState.capabilityTitle || activeCapabilityId} continues in the background. Further agent UI control is paused while you work in ${workspace}.`,
                createdAt: new Date().toISOString(),
            });
            setActiveWorkspace(workspace);
            return;
        }
        setStudioAgentYieldedToManualControl(true);
        setStudioAgentAssistantControlActive(false);
        cancelStudioAgentExecution('Manual workspace switch detected. Studio Agent yielded control.');
        setActiveWorkspace(workspace);
    }, [
        cancelStudioAgentExecution,
        localCollaborator.name,
        studioAgentAssistantControlActive,
        studioAgentState.capabilityId,
        studioAgentState.capabilityTitle,
        studioAgentState.status,
    ]);

    useEffect(() => {
        setRealtimePresence([]);
        setRealtimeStatus('DISCONNECTED');
        if (!projectRealtimeId) return;

        const session = createProjectRealtimeSession({
            projectId: projectRealtimeId,
            collaborator: localCollaborator,
            sessionId: sessionIdRef.current,
            initialPresence: {
                workspace: activeWorkspace,
                activePhase: projectHubActivePhase || undefined,
                activeShotNumber: projectHubActiveShotNumber,
                activeClipId: selectedClipId,
                status: localPresenceStatus,
                cursor: localCursorRef.current,
            },
            callbacks: {
                onStatus: (status) => setRealtimeStatus(status),
                onPresence: (presence) => setRealtimePresence(presence),
                onEvent: (event) => {
                    if (!event.payload || typeof event.payload !== 'object') {
                        return;
                    }
                    if (event.type === 'agent_activity') {
                        const payload = event.payload as { detail?: unknown };
                        if (typeof payload.detail !== 'string') return;
                        setLatestAgentActivity({
                            actorName: event.actor.name,
                            detail: payload.detail,
                            createdAt: event.createdAt,
                        });
                        return;
                    }

                    if (event.type === 'lock_claim') {
                        updateCollaborativeLockState(
                            event.payload as ProjectCollaborativeLock,
                            'claim',
                        );
                        return;
                    }

                    if (event.type === 'lock_release') {
                        updateCollaborativeLockState(
                            event.payload as ProjectCollaborativeLock,
                            'release',
                        );
                    }
                },
            },
        });

        if (!session) return;

        realtimeSessionRef.current = session;
        void session.connect();

        return () => {
            if (realtimeSessionRef.current === session) {
                realtimeSessionRef.current = null;
            }
            void session.disconnect();
        };
    }, [
        projectRealtimeId,
        localCollaborator.id,
        localCollaborator.name,
        localCollaborator.role,
        localCollaborator.email,
        updateCollaborativeLockState,
    ]);

    useEffect(() => {
        if (!projectRealtimeId) {
            setCollaborationDocStatus('disabled');
            return;
        }

        const session = createCollaborativeProjectSession({
            projectId: projectRealtimeId,
            hocuspocusUrl: env.hocuspocus.url || null,
            token: env.hocuspocus.token || null,
            awareness: {
                collaboratorId: localCollaborator.id,
                workspace: activeWorkspace,
                activePhase: projectHubActivePhase || undefined,
                shotNumber: projectHubActiveShotNumber,
                clipId: selectedClipId,
                updatedAt: new Date().toISOString(),
            },
        });

        collaborativeSessionRef.current = session;
        session.seedFromSnapshot(collaborativeSnapshot);

        const detachSnapshot = session.onSnapshotChange((doc) => {
            const next = toProjectSnapshot(doc);
            const nextSignature = JSON.stringify(next);
            if (nextSignature === collaborativeSnapshotSignatureRef.current) {
                return;
            }
            skipCollaborativePushSignatureRef.current = nextSignature;
            resetShotPrompts(normalizeShotPromptList(next.shotPrompts));
            setReviewData(normalizeReviewData(next.reviewData));
            resetTimelineClips(next.timelineClips);
            setTimelineTracks(next.timelineTracks.length > 0 ? next.timelineTracks : INITIAL_TRACKS);
            setSelectedClipId(next.selectedClipId || null);
        });
        const detachStatus = session.onStatusChange((status) => {
            setCollaborationDocStatus(status);
        });

        void session.connect();

        return () => {
            detachSnapshot();
            detachStatus();
            if (collaborativeSessionRef.current === session) {
                collaborativeSessionRef.current = null;
            }
            session.disconnect();
        };
    }, [
        localCollaborator.id,
        projectRealtimeId,
        env.hocuspocus.token,
        env.hocuspocus.url,
    ]);

    useEffect(() => {
        const session = collaborativeSessionRef.current;
        if (!session) return;
        if (skipCollaborativePushSignatureRef.current === collaborativeSnapshotSignature) {
            skipCollaborativePushSignatureRef.current = null;
            return;
        }
        session.syncLocalSnapshot(collaborativeSnapshot);
    }, [collaborativeSnapshot, collaborativeSnapshotSignature]);

    useEffect(() => {
        const session = collaborativeSessionRef.current;
        if (!session) return;
        session.setAwarenessState({
            collaboratorId: localCollaborator.id,
            workspace: activeWorkspace,
            activePhase: projectHubActivePhase || undefined,
            shotNumber: projectHubActiveShotNumber,
            clipId: selectedClipId,
        });
    }, [
        activeWorkspace,
        localCollaborator.id,
        projectHubActivePhase,
        projectHubActiveShotNumber,
        selectedClipId,
    ]);

    useEffect(() => {
        const session = realtimeSessionRef.current;
        if (!session) return;

        const nextShotKey =
            activeWorkspace === 'PROJECT' &&
            projectHubActivePhase === 'storyboard' &&
            typeof projectHubActiveShotNumber === 'number'
                ? String(projectHubActiveShotNumber)
                : null;
        const previousKey = claimedStoryboardLockRef.current;

        if (previousKey && previousKey !== nextShotKey) {
            void session.releaseLock('storyboard_shot', previousKey);
        }
        if (nextShotKey) {
            void session.claimLock({
                scope: 'storyboard_shot',
                key: nextShotKey,
                claimedBy: {
                    id: localCollaborator.id,
                    name: localCollaborator.name,
                    role: localCollaborator.role,
                    sessionId: sessionIdRef.current,
                },
                expiresAt: new Date(Date.now() + LOCK_STALE_AFTER_MS).toISOString(),
            });
        }
        claimedStoryboardLockRef.current = nextShotKey;
    }, [
        activeWorkspace,
        localCollaborator.id,
        localCollaborator.name,
        localCollaborator.role,
        projectHubActivePhase,
        projectHubActiveShotNumber,
        realtimeStatus,
    ]);

    useEffect(() => {
        const session = realtimeSessionRef.current;
        if (!session) return;

        const nextClipKey =
            activeWorkspace === 'EDIT' && selectedClipId ? selectedClipId : null;
        const previousKey = claimedTimelineLockRef.current;

        if (previousKey && previousKey !== nextClipKey) {
            void session.releaseLock('timeline', previousKey);
        }
        if (nextClipKey) {
            void session.claimLock({
                scope: 'timeline',
                key: nextClipKey,
                claimedBy: {
                    id: localCollaborator.id,
                    name: localCollaborator.name,
                    role: localCollaborator.role,
                    sessionId: sessionIdRef.current,
                },
                expiresAt: new Date(Date.now() + LOCK_STALE_AFTER_MS).toISOString(),
            });
        }
        claimedTimelineLockRef.current = nextClipKey;
    }, [
        activeWorkspace,
        localCollaborator.id,
        localCollaborator.name,
        localCollaborator.role,
        realtimeStatus,
        selectedClipId,
    ]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            const session = realtimeSessionRef.current;
            if (!session) return;
            const expiresAt = new Date(Date.now() + LOCK_STALE_AFTER_MS).toISOString();
            if (claimedStoryboardLockRef.current) {
                void session.claimLock({
                    scope: 'storyboard_shot',
                    key: claimedStoryboardLockRef.current,
                    claimedBy: {
                        id: localCollaborator.id,
                        name: localCollaborator.name,
                        role: localCollaborator.role,
                        sessionId: sessionIdRef.current,
                    },
                    expiresAt,
                });
            }
            if (claimedTimelineLockRef.current) {
                void session.claimLock({
                    scope: 'timeline',
                    key: claimedTimelineLockRef.current,
                    claimedBy: {
                        id: localCollaborator.id,
                        name: localCollaborator.name,
                        role: localCollaborator.role,
                        sessionId: sessionIdRef.current,
                    },
                    expiresAt,
                });
            }
        }, LOCK_HEARTBEAT_MS);

        return () => window.clearInterval(timer);
    }, [localCollaborator.id, localCollaborator.name, localCollaborator.role]);

    useEffect(() => {
        pushRealtimePresence();
    }, [pushRealtimePresence]);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const handleMouseMove = (event: MouseEvent) => {
            localCursorRef.current = {
                x: clampRatio(event.clientX / Math.max(window.innerWidth, 1)),
                y: clampRatio(event.clientY / Math.max(window.innerHeight, 1)),
            };
            const now = Date.now();
            if (now - lastCursorPresenceAtRef.current < 120) return;
            lastCursorPresenceAtRef.current = now;
            pushRealtimePresence({ cursor: localCursorRef.current });
        };

        const handleBlur = () => {
            localCursorRef.current = null;
            pushRealtimePresence({ cursor: null });
        };

        window.addEventListener('mousemove', handleMouseMove, { passive: true });
        window.addEventListener('blur', handleBlur);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('blur', handleBlur);
        };
    }, [pushRealtimePresence]);


    useEffect(() => {
        const stored = localStorage.getItem('recent_projects_v1');
        if (!stored) return;
        try {
            const parsed = JSON.parse(stored) as RecentProject[];
            if (Array.isArray(parsed)) {
                setRecentProjects(parsed);
            }
        } catch {
            setRecentProjects([]);
        }

        const storedProfiles = localStorage.getItem('user_profiles_v1');
        if (storedProfiles) {
            try {
                const parsed = JSON.parse(storedProfiles) as UserProfile[];
                if (Array.isArray(parsed)) {
                    const normalized = parsed.map(profile => ({
                        ...profile,
                        role: profile.role ?? 'artist',
                    }));
                    setProfiles(normalized);
                }
                const active = localStorage.getItem('active_profile_id_v1');
                if (active) setActiveProfileId(active);
            } catch { }
        }
    }, []);

    useEffect(() => {
        handleCloudOAuthCallback()
            .then((handled) => {
                if (handled) {
                    setShowSettings(true);
                }
            })
            .catch((error) => {
                console.error('Cloud OAuth callback failed', error);
            });
    }, []);

    useEffect(() => {
        const unsubscribe = subscribeUsage((entry) => {
            setUsageLedger((prev) => ({ entries: [...prev.entries, entry] }));
            if (!isElectron && teamId) {
                (async () => {
                    const client = getSupabase();
                    if (!client) return;
                    const { data } = await client.auth.getSession();
                    const token = data.session?.access_token;
                    if (!token) return;

                    const response = await fetch('/api/usage/record', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({ teamId, entry }),
                    });
                    const payload = await response.json().catch(() => null);
                    if (payload && typeof payload.balanceCents === 'number') {
                        setBillingStatus((prev) =>
                            prev
                                ? { ...prev, credit_balance_cents: payload.balanceCents, last_usage_at: new Date().toISOString() }
                                : prev,
                        );
                    }
                })().catch(() => undefined);
            }
        });
        return () => { unsubscribe(); };
    }, [isElectron, teamId]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!teamId) {
            localStorage.removeItem(WEB_TEAM_STORAGE_KEY);
            return;
        }
        localStorage.setItem(WEB_TEAM_STORAGE_KEY, teamId);
    }, [teamId]);

    useEffect(() => {
        if (profiles.length > 0) {
            localStorage.setItem('user_profiles_v1', JSON.stringify(profiles));
        }
    }, [profiles]);

    useEffect(() => {
        if (activeProfileId) {
            localStorage.setItem('active_profile_id_v1', activeProfileId);
        }
    }, [activeProfileId]);

    useEffect(() => {
        syncStatusRef.current = projectSyncStatus;
    }, [projectSyncStatus]);

    useEffect(() => {
        if (typeof document === 'undefined') return;
        document.body.dataset.theme = theme;
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    }, [theme]);

    useEffect(() => {
        localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(shortcuts));
    }, [shortcuts]);

    useEffect(() => {
        localStorage.setItem(AUTOSAVE_SETTINGS_KEY, JSON.stringify(autosaveSettings));
    }, [autosaveSettings]);

    useEffect(() => {
        localStorage.setItem(STARTUP_PREFERENCES_KEY, JSON.stringify(startupPreferences));
    }, [startupPreferences]);

    useEffect(() => {
        localStorage.setItem(UI_MODE_STORAGE_KEY, uiMode);
    }, [uiMode]);

    useEffect(() => {
        if (startupAppliedRef.current) return;
        startupAppliedRef.current = true;
        const normalizedStartupWorkspace: Workspace =
            startupPreferences.startupWorkspace === 'OUTFIT'
                ? 'PROJECT'
                : startupPreferences.startupWorkspace;
        if (normalizedStartupWorkspace !== 'PROJECT') {
            setActiveWorkspace(normalizedStartupWorkspace);
        }
        if (!showOnboarding && startupPreferences.autoOpenAssistant) {
            window.setTimeout(() => setIsAssistantVisible(true), 240);
        }
    }, [showOnboarding, startupPreferences]);

    useEffect(() => {
        if (!showLiveConversationTool && isLiveVisible) {
            setIsLiveVisible(false);
        }
    }, [isLiveVisible, showLiveConversationTool]);

    useEffect(() => {
        if (!canOpenDesignSystem && showDesignSystem) {
            setShowDesignSystem(false);
        }
    }, [canOpenDesignSystem, showDesignSystem]);

    useEffect(() => {
        playheadRef.current = playheadPosition;
    }, [playheadPosition]);

    useEffect(() => {
        if (timelineTracks.length === 0) {
            setActiveTrackId(null);
            return;
        }
        if (!activeTrackId || !timelineTracks.some((track) => track.id === activeTrackId)) {
            setActiveTrackId(timelineTracks[0].id);
        }
    }, [timelineTracks, activeTrackId]);

    useEffect(() => {
        if (!isPlaying) {
            if (playbackRafRef.current) {
                cancelAnimationFrame(playbackRafRef.current);
                playbackRafRef.current = null;
            }
            return;
        }

        if (timelineClips.length === 0) {
            setIsPlaying(false);
            return;
        }

        const totalDuration = Math.max(...timelineClips.map(c => c.end), 0);
        let lastTime = performance.now();
        let current = playheadRef.current;

        const tick = () => {
            const now = performance.now();
            const delta = (now - lastTime) / 1000;
            lastTime = now;

            if (Math.abs(playheadRef.current - current) > 0.05) {
                current = playheadRef.current;
            }

            current = Math.min(current + delta, totalDuration);
            setPlayheadPosition(current);
            if (current >= totalDuration) {
                setIsPlaying(false);
                return;
            }
            playbackRafRef.current = requestAnimationFrame(tick);
        };

        playbackRafRef.current = requestAnimationFrame(tick);
        return () => {
            if (playbackRafRef.current) {
                cancelAnimationFrame(playbackRafRef.current);
                playbackRafRef.current = null;
            }
        };
    }, [isPlaying, timelineClips]);

    // Check for API Key on load
    useEffect(() => {
        const localKeyReady = hasAnyLocalApiKey();

        if (window.aistudio) {
            window.aistudio.hasSelectedApiKey().then((hasKey) => {
                if (hasKey || localKeyReady) {
                    setApiKeyReady(true);
                }
            });
        } else if (process.env.API_KEY || localKeyReady) {
            setApiKeyReady(true);
        }
    }, []);

    useEffect(() => {
        const wasActive = localStorage.getItem(SESSION_ACTIVE_KEY) === 'true';
        const autosaveRaw = localStorage.getItem(AUTOSAVE_META_KEY);
        const autosavePrefs = getInitialAutosaveSettings();
        if (autosavePrefs.recoverOnCrash && wasActive && autosaveRaw) {
            try {
                const autosaveMeta = JSON.parse(autosaveRaw) as { projectPath?: string; savedAt?: string; name?: string };
                if (autosaveMeta.projectPath) {
                    const label = autosaveMeta.name ? `"${autosaveMeta.name}"` : 'your last project';
                    const shouldRecover = window.confirm(
                        `We detected an unclean shutdown. Recover the latest auto-save for ${label}?`
                    );
                    if (shouldRecover) {
                        handleLoadProject(autosaveMeta.projectPath);
                    }
                }
            } catch {
                localStorage.removeItem(AUTOSAVE_META_KEY);
            }
        }

        localStorage.setItem(SESSION_ACTIVE_KEY, 'true');
        const handleBeforeUnload = () => {
            localStorage.setItem(SESSION_ACTIVE_KEY, 'false');
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            localStorage.setItem(SESSION_ACTIVE_KEY, 'false');
        };
    }, []);

    const mapAuthUser = useCallback((authUser: { id: string; name: string; email: string }): User => ({
        id: authUser.id,
        name: authUser.name,
        email: authUser.email,
        plan: 'pro',
    }), []);

    // --- Auth Handlers ---
    const handleLogin = (loggedInUser: User) => {
        setUser({ ...loggedInUser, plan: 'pro' });
    };

    const handleLogout = async () => {
        if (!isElectron && getSupabase()) {
            await logoutStudio();
        }
        setUser(null);
        setTeamId(null);
        setBillingStatus(null);
        setAuthStatus(isElectron ? 'signed_in' : 'signed_out');
    };

    const refreshWebUser = useCallback(async () => {
        if (isElectron) return;
        const authUser = await resolveStudioUser();
        if (authUser) {
            setUser(mapAuthUser(authUser));
            setAuthStatus('signed_in');
        } else {
            setUser(null);
            setAuthStatus('signed_out');
        }
    }, [isElectron, mapAuthUser]);

    const refreshBilling = useCallback(async (targetTeamId?: string | null) => {
        if (isElectron) return;
        const id = targetTeamId || teamId;
        if (!id) return;
        const client = getSupabase();
        if (!client) return;
        const { data } = await client
            .from('team_billing')
            .select('mode, plan_id, credit_balance_cents, byo_entitled, trial_started_at, trial_ends_at, trial_active, status')
            .eq('team_id', id)
            .maybeSingle();
        if (data) setBillingStatus(data as BillingStatus);
    }, [isElectron, teamId]);

    const bootstrapBilling = useCallback(async () => {
        if (isElectron) return;
        const client = getSupabase();
        if (!client) return;
        const { data } = await client.auth.getSession();
        const session = data.session;
        const authUser = session?.user;
        if (!authUser || !session?.access_token) return;
        const response = await fetch('/api/billing/bootstrap', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
                email: authUser.email,
                name: authUser.user_metadata?.name || authUser.user_metadata?.full_name,
            }),
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (payload?.teamId) {
            setTeamId(payload.teamId);
        }
        if (payload?.billing) {
            setBillingStatus(payload.billing);
        }
    }, [isElectron]);

    useEffect(() => {
        // FORCE LOCAL DEV LOGIN
        if (import.meta.env.DEV) {
             setUser({
                id: 'local-dev',
                name: 'Local Developer',
                email: 'dev@local.test',
                plan: 'pro',
            });
            setAuthStatus('signed_in');
            return;
        }

        if (isElectron) {
            setUser({
                id: 'local-electron',
                name: 'Director',
                email: 'local-session',
                plan: 'pro',
            });
            setAuthStatus('signed_in');
            return;
        }

        refreshWebUser();
        const unsubscribe = onStudioAuthChange((authUser) => {
            if (authUser) {
                setUser(mapAuthUser(authUser));
                setAuthStatus('signed_in');
            } else {
                setUser(null);
                setAuthStatus('signed_out');
            }
        });
        return () => {
            unsubscribe?.();
        };
    }, [isElectron, mapAuthUser, refreshWebUser]);

    useEffect(() => {
        if (!user || isElectron) return;
        bootstrapBilling();
    }, [bootstrapBilling, isElectron, user]);

    useEffect(() => {
        if (isElectron || !teamId) return;
        refreshBilling(teamId);
        const timer = window.setInterval(() => {
            refreshBilling(teamId);
        }, 30000);
        return () => {
            window.clearInterval(timer);
        };
    }, [isElectron, refreshBilling, teamId]);

    const handleSwitchProfile = (id: string) => {
        setActiveProfileId(id);
    };

    useEffect(() => {
        if (!activeProfileId && profiles.length > 0) {
            setActiveProfileId(profiles[0].id);
        }
    }, [activeProfileId, profiles]);

    useEffect(() => {
        if (canAccessWorkspace(activeWorkspace)) return;
        const fallbackWorkspace = allowedWorkspaces.includes('PROJECT')
            ? 'PROJECT'
            : allowedWorkspaces[0];
        if (fallbackWorkspace && fallbackWorkspace !== activeWorkspace) {
            setActiveWorkspace(fallbackWorkspace);
        }
    }, [activeWorkspace, allowedWorkspaces, canAccessWorkspace]);

    useEffect(() => {
        if (!sceneWallEnabled) return;
        if (!sceneWallState || sceneWallState.autoSyncFromScriptContext === false) return;
        if (isHydratingRef.current) return;

        setSceneWallState((prev) => {
            if (!prev || prev.enabled === false || prev.autoSyncFromScriptContext === false) return prev;
            return buildSceneWallFromProjectContext({
                scriptText: storyBible.script || '',
                shotPrompts,
                references,
                existing: prev,
                enabled: true,
                vfxPrefix: prev.vfxPrefix,
                autoLinkStoryboard: prev.autoLinkStoryboard,
                autoLinkConcept: prev.autoLinkConcept,
                autoSyncFromScriptContext: prev.autoSyncFromScriptContext,
                scriptSourceName: prev.scriptSourceName || 'Project Auto Sync',
            });
        });
    }, [
        references,
        sceneWallEnabled,
        sceneWallState?.autoLinkConcept,
        sceneWallState?.autoLinkStoryboard,
        sceneWallState?.autoSyncFromScriptContext,
        sceneWallState?.vfxPrefix,
        shotPrompts,
        storyBible.script,
    ]);

    const handleCreateProfile = (name: string, role: UserProfile['role']) => {
        const newProfile: UserProfile = {
            id: `profile-${Date.now()}`,
            name: name,
            themePreference: theme,
            role: role || 'artist',
        };
        setProfiles(prev => [...prev, newProfile]);
        setActiveProfileId(newProfile.id);
    };

    const handleUpdateProfileRole = (id: string, role: UserProfile['role']) => {
        setProfiles(prev =>
            prev.map(profile => profile.id === id ? { ...profile, role: role || 'artist' } : profile)
        );
    };

    const upsertRecentProject = useCallback((entry: RecentProject) => {
        setRecentProjects(prev => {
            const existing = prev.find(item => item.path === entry.path);
            const merged: RecentProject = {
                ...existing,
                ...entry,
                lastSavedAt: entry.lastSavedAt ?? existing?.lastSavedAt ?? null,
            };
            const next = [merged, ...prev.filter(item => item.path !== entry.path)].slice(0, 8);
            localStorage.setItem('recent_projects_v1', JSON.stringify(next));
            return next;
        });
    }, []);

    const refreshProjectFileMtime = useCallback(async (folderOverride?: string) => {
        const target = folderOverride || projectPath;
        if (!target) return;
        try {
            const stat = await statProjectFile(target);
            if (stat?.exists && typeof stat.mtimeMs === 'number') {
                projectFileMtimeRef.current = stat.mtimeMs;
            }
        } catch {
        }
    }, [projectPath]);

    const buildCollaborationForSave = useCallback(() => {
        const now = new Date().toISOString();
        const name = activeProfile?.name?.trim() || 'Unknown';
        return {
            ...projectCollaboration,
            lastModifiedBy: name,
            lastModifiedAt: now,
        };
    }, [activeProfile, projectCollaboration]);

    const getProjectDisplayName = useCallback(() => {
        return projectName || storyBible.title || 'Untitled Project';
    }, [projectName, storyBible.title]);

    const mergeProjectSyncIntoRaw = useCallback((raw: string, sync: ProjectSyncConfig) => {
        try {
            const parsed = JSON.parse(raw);
            parsed.sync = sync;
            return JSON.stringify(parsed, null, 2);
        } catch {
            return raw;
        }
    }, []);

    const normalizeShotPrompts = useCallback((shots?: ShotPrompt[]) => {
        return normalizeShotPromptList(shots);
    }, []);

    const buildSceneWallFromCurrentProject = useCallback((sourceName?: string) => {
        setSceneWallState((prev) =>
            buildSceneWallFromProjectContext({
                scriptText: storyBible.script || '',
                shotPrompts,
                references,
                existing: prev,
                enabled: true,
                vfxPrefix: prev?.vfxPrefix,
                autoLinkStoryboard: prev?.autoLinkStoryboard,
                autoLinkConcept: prev?.autoLinkConcept,
                autoSyncFromScriptContext: prev?.autoSyncFromScriptContext,
                scriptSourceName: sourceName,
            }),
        );
    }, [references, shotPrompts, storyBible.script]);

    const toggleSceneWallFeature = useCallback((enabled: boolean) => {
        if (enabled) {
            setSceneWallState((prev) => {
                if (prev) {
                    const normalized = normalizeSceneWallState(prev);
                    return {
                        ...normalized,
                        enabled: true,
                        updatedAt: new Date().toISOString(),
                    };
                }
                return buildSceneWallFromProjectContext({
                    scriptText: storyBible.script || '',
                    shotPrompts,
                    references,
                    enabled: true,
                    scriptSourceName: 'Project Script',
                });
            });
            return;
        }

        setSceneWallState((prev) => {
            if (!prev) return null;
            const normalized = normalizeSceneWallState(prev);
            return {
                ...normalized,
                enabled: false,
                updatedAt: new Date().toISOString(),
            };
        });
        if (activeWorkspace === 'SCENE_WALL') {
            setActiveWorkspace('PROJECT');
        }
    }, [activeWorkspace, references, shotPrompts, storyBible.script]);

    const handleLoadProject = async (folderOverride?: string) => {
        try {
            isHydratingRef.current = true;
            suppressAutosaveRef.current = true;
            let selectedPath = folderOverride || await selectProjectFile();
            if (!selectedPath) {
                selectedPath = await selectProjectFolder();
            }
            if (!selectedPath) return;
            const folderPath = selectedPath.toLowerCase().endsWith('.json')
                ? selectedPath.replace(/[/\\][^/\\]+$/, '')
                : selectedPath;
            setIsProjectLoading(true);
            const project = await loadProjectFromFolder(folderPath);
            setStoryBible(project.storyBible || INITIAL_BIBLE);
            const loadedCollaboration = project.collaboration || DEFAULT_PROJECT_COLLABORATION;
            setProjectCollaboration({
                ...DEFAULT_PROJECT_COLLABORATION,
                ...loadedCollaboration,
                collaborators: loadedCollaboration.collaborators || [],
                chatThreads: loadedCollaboration.chatThreads || [],
                meetingLinks: loadedCollaboration.meetingLinks || [],
                storageLinks: loadedCollaboration.storageLinks || [],
            });
            setProjectSync({ ...DEFAULT_PROJECT_SYNC, ...project.sync });
            setProjectSyncStatus({ state: 'idle' });
            resetReferences(project.references || []);
            setAvatars(project.avatars || []);
            resetShotPrompts(normalizeShotPrompts(project.projectHub?.shotPrompts));
            setReviewData(normalizeReviewData(project.reviewData));
            setNamingTemplates(Array.isArray(project.namingTemplates) ? project.namingTemplates : []);
            setUsageLedger(project.usageLedger ?? INITIAL_USAGE_LEDGER);
            setCostSettings(normalizeCostSettings(project.costSettings));
            resetMediaItems(project.mediaItems || []);
            const loadedClips = Array.isArray(project.timelineClips)
                ? project.timelineClips.map((clip) => {
                    const speed = Math.max(0.05, clip.speed || 1);
                    const sourceIn = clip.sourceIn ?? 0;
                    const sourceOut = clip.sourceOut ?? (sourceIn + Math.max(0.05, clip.duration || (clip.end - clip.start) * speed));
                    const effects = getClipEffectLayers(clip);
                    return {
                        ...clip,
                        speed,
                        sourceIn,
                        sourceOut,
                        effect: effects[0]?.effect || null,
                        effects,
                    };
                })
                : [];
            resetTimelineClips(loadedClips);
            const loadedTracksRaw = Array.isArray(project.timelineTracks) && project.timelineTracks.length > 0
                ? project.timelineTracks
                : INITIAL_TRACKS;
            const loadedTracks = loadedTracksRaw.map((track) => ({
                ...track,
                isTargeted: track.isTargeted ?? false,
                isSolo: track.isSolo ?? false,
            }));
            const ensureTargeted = (type: 'video' | 'audio') => {
                if (loadedTracks.some((track) => track.type === type && track.isTargeted)) return;
                const firstIndex = loadedTracks.findIndex((track) => track.type === type);
                if (firstIndex >= 0) {
                    loadedTracks[firstIndex] = { ...loadedTracks[firstIndex], isTargeted: true };
                }
            };
            ensureTargeted('video');
            ensureTargeted('audio');
            setTimelineTracks(loadedTracks);
            setActiveTrackId(loadedTracks[0]?.id || null);
            setWaveformCache(project.waveformCache || {});
            setNodeGraph(project.nodeGraph || null);
            setDesignCanvasState(project.designCanvas ? normalizeDesignState(project.designCanvas) : null);
            setSetDesignState(project.setDesign || null);
            setSceneMapState(project.sceneMap || null);
            setSceneWallState(project.sceneWall ? normalizeSceneWallState(project.sceneWall) : null);
            setWorldGenState(project.worldGen || null);
            setVideoGenSeed(null);
            setLastAgentApplyBatch(null);
            setSelectedClipId(null);
            setPlayheadPosition(0);
            setIsPlaying(false);
            setProjectPath(folderPath);
            setProjectName(project.name || project.storyBible?.title || 'Untitled Project');
            setLastSavedAt(project.savedAt || null);
            setLastAutoSavedAt(null);
            setActiveWorkspace('PROJECT');
            projectFileMtimeRef.current = null;
            refreshProjectFileMtime(folderPath);
            upsertRecentProject({
                path: folderPath,
                name: project.name || project.storyBible?.title || 'Untitled Project',
                lastOpened: new Date().toISOString(),
                lastSavedAt: project.savedAt || null,
                projectGroup: project.storyBible?.projectGroup,
                projectSubgroup: project.storyBible?.projectSubgroup,
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            alert(`Project load failed: ${msg}`);
        } finally {
            setIsProjectLoading(false);
            isHydratingRef.current = false;
        }
    };

    const handleSelectProjectFolder = async () => {
        try {
            const folderPath = await selectProjectFolder();
            if (!folderPath) return;
            const probe = await probeProjectFolder(folderPath);
            if (probe.exists) {
                const shouldLoad = window.confirm('An existing project was found in this folder. Load it now?');
                if (shouldLoad) {
                    await handleLoadProject(folderPath);
                    return;
                }
            }
            await initializeProjectFolder(folderPath);
            setProjectPath(folderPath);
            setProjectName(storyBible.title || 'Untitled Project');
            setLastAgentApplyBatch(null);
            setProjectCollaboration(DEFAULT_PROJECT_COLLABORATION);
            setProjectSync(DEFAULT_PROJECT_SYNC);
            setProjectSyncStatus({ state: 'idle' });
            setUsageLedger(INITIAL_USAGE_LEDGER);
            setCostSettings(DEFAULT_COST_SETTINGS);
            setNodeGraph(null);
            setSetDesignState(null);
            setSceneMapState(null);
            setSceneWallState(null);
            setWorldGenState(null);
            setVideoGenSeed(null);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            alert(`Project folder setup failed: ${msg}`);
        }
    };

    const handleOpenRecentProject = async (path: string) => {
        await handleLoadProject(path);
    };

    const pushProjectToCloud = useCallback(async (folderPath: string) => {
        if (!projectSync.provider) return;
        try {
            const raw = await readProjectMetaFile(folderPath, 'project.json');
            if (!raw) {
                throw new Error('Project file not found.');
            }
            const result = await uploadProjectJsonToCloud(
                projectSync.provider,
                projectSync,
                getProjectDisplayName(),
                raw,
            );
            const assetPaths = collectAssetPathsFromProjectJson(raw);
            let nextSync = result.sync;
            for (let i = 0; i < assetPaths.length; i++) {
                const path = assetPaths[i];
                const data = await readProjectBinaryFile(folderPath, path);
                if (!data) {
                    setProjectSyncStatus(prev => ({
                        ...prev,
                        state: 'checking',
                        message: `Skipping missing asset ${i + 1}/${assetPaths.length}...`,
                    }));
                    continue;
                }
                setProjectSyncStatus(prev => ({
                    ...prev,
                    state: 'checking',
                    message: `Uploading assets ${i + 1}/${assetPaths.length}...`,
                }));
                nextSync = await uploadProjectAssetToCloud(
                    projectSync.provider,
                    nextSync,
                    getProjectDisplayName(),
                    path,
                    data,
                );
            }
            const mergedRaw = mergeProjectSyncIntoRaw(raw, nextSync);
            if (mergedRaw !== raw) {
                await writeProjectMetaFile(folderPath, 'project.json', mergedRaw);
                refreshProjectFileMtime(folderPath);
            }
            setProjectSync(nextSync);
            setProjectSyncStatus(prev => ({
                ...prev,
                state: 'up-to-date',
                message: assetPaths.length ? 'Project and assets uploaded.' : 'Project uploaded.',
                incoming: undefined,
            }));
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Cloud upload failed.';
            setProjectSyncStatus(prev => ({ ...prev, state: 'error', message: msg }));
        }
    }, [projectSync, getProjectDisplayName, mergeProjectSyncIntoRaw, refreshProjectFileMtime]);

    const pullProjectFromCloud = useCallback(async () => {
        if (!projectPath || !projectSync.provider) return;
        try {
            const download = await downloadProjectJsonFromCloud(
                projectSync.provider,
                projectSync,
                getProjectDisplayName(),
            );
            const conflictStamp = new Date().toISOString().replace(/[:.]/g, '-');
            const localRaw = await readProjectMetaFile(projectPath, 'project.json');
            if (localRaw) {
                await writeProjectMetaFile(projectPath, `conflicts/project_conflict_${conflictStamp}.json`, localRaw);
            }
            let nextSync = download.sync;
            const mergedContent = mergeProjectSyncIntoRaw(download.content, nextSync);
            await writeProjectMetaFile(projectPath, 'project.json', mergedContent);
            const assetPaths = collectAssetPathsFromProjectJson(mergedContent);
            for (let i = 0; i < assetPaths.length; i++) {
                const path = assetPaths[i];
                setProjectSyncStatus(prev => ({
                    ...prev,
                    state: 'checking',
                    message: `Downloading assets ${i + 1}/${assetPaths.length}...`,
                }));
                const asset = await downloadProjectAssetFromCloud(
                    projectSync.provider,
                    nextSync,
                    getProjectDisplayName(),
                    path,
                );
                nextSync = asset.sync;
                const stat = await statProjectAsset(projectPath, path);
                if (stat?.exists) {
                    const localData = await readProjectBinaryFile(projectPath, path);
                    if (localData) {
                        await writeProjectBinaryFile(
                            projectPath,
                            `conflicts/assets_${conflictStamp}/${path}`,
                            localData
                        );
                    }
                }
                await writeProjectBinaryFile(projectPath, path, new Uint8Array(asset.data));
            }
            setProjectSync(nextSync);
            await handleLoadProject(projectPath);
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Cloud download failed.';
            setProjectSyncStatus(prev => ({ ...prev, state: 'error', message: msg }));
        }
    }, [projectPath, projectSync, getProjectDisplayName, handleLoadProject]);

    const handleReloadProject = async () => {
        if (!projectPath) return;
        await handleLoadProject(projectPath);
    };

    const handleSendWorldMeshToSetDesign = useCallback((asset: SetDesignAsset) => {
        setSetDesignState(prev => {
            const base = prev || buildDefaultSetDesignState();
            return {
                ...base,
                assets: [...base.assets, asset],
            };
        });
        setActiveWorkspace('SET_DESIGN');
    }, []);

    const handleApplySetDesignSnapshotToShot = useCallback((payload: { shotNumber: number; imageUrl: string }) => {
        setShotPrompts(prev => applyWorldCameraSnapshotToShot(prev, {
            shotNumber: payload.shotNumber,
            imageUrl: payload.imageUrl,
            sourceLabel: 'Set Design World Camera',
        }));
    }, []);

    const handleSaveProject = async () => {
        try {
            let folderPath = projectPath;
            if (!folderPath) {
                folderPath = await selectProjectFolder();
                if (!folderPath) return;
                await initializeProjectFolder(folderPath);
                setProjectPath(folderPath);
            }
            setIsProjectSaving(true);
            const collaborationForSave = buildCollaborationForSave();
            const { savedAt } = await saveProjectToFolder(
                folderPath,
                {
                    storyBible,
                    collaboration: collaborationForSave,
                    sync: projectSync,
                    references,
                    avatars,
                    projectHub: { shotPrompts },
                    mediaItems,
                    timelineClips,
                    timelineTracks,
                    waveformCache,
                    nodeGraph,
                    designCanvas: designCanvasState,
                    setDesign: setDesignState,
                    sceneMap: sceneMapState,
                    sceneWall: sceneWallState,
                    worldGen: worldGenState,
                    reviewData,
                    namingTemplates,
                    usageLedger,
                    costSettings,
                },
                projectName || storyBible.title || 'Untitled Project',
            );
            setLastSavedAt(savedAt);
            setProjectName(projectName || storyBible.title || 'Untitled Project');
            setLastAutoSavedAt(null);
            suppressAutosaveRef.current = true;
            setProjectCollaboration(collaborationForSave);
            setProjectSyncStatus(prev => ({
                ...prev,
                state: projectSync.provider ? 'up-to-date' : prev.state,
                message: projectSync.provider ? 'Saved to disk.' : prev.message,
            }));
            refreshProjectFileMtime(folderPath);
            if (projectSync.provider && projectSync.autoSync !== false && typeof window !== 'undefined' && window.electron?.project) {
                await pushProjectToCloud(folderPath);
            }
            upsertRecentProject({
                path: folderPath,
                name: projectName || storyBible.title || 'Untitled Project',
                lastOpened: new Date().toISOString(),
                lastSavedAt: savedAt,
                projectGroup: storyBible.projectGroup,
                projectSubgroup: storyBible.projectSubgroup,
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            alert(`Project save failed: ${msg}`);
        } finally {
            setIsProjectSaving(false);
        }
    };

    const handleOpenProjectFolder = async () => {
        if (!projectPath) return;
        try {
            await openProjectFolder(projectPath);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            alert(`Open folder failed: ${msg}`);
        }
    };

    const handleCloseProject = () => {
        if (autosaveTimerRef.current) {
            window.clearTimeout(autosaveTimerRef.current);
            autosaveTimerRef.current = null;
        }
        setProjectPath(null);
        setProjectName(null);
        setLastAgentApplyBatch(null);
        setLastSavedAt(null);
        setLastAutoSavedAt(null);
        setProjectCollaboration(DEFAULT_PROJECT_COLLABORATION);
        setProjectSync(DEFAULT_PROJECT_SYNC);
        setProjectSyncStatus({ state: 'idle' });
        setRealtimePresence([]);
        setRealtimeStatus('DISCONNECTED');
        setProjectHubActivePhase(null);
        setProjectHubRequestedPhase(null);
        setProjectHubActiveShotNumber(null);
        setLatestAgentActivity(null);
        resetShotPrompts([]);
        setAvatars([]);
        setReviewData(INITIAL_REVIEW_DATA);
        setNamingTemplates([]);
        setUsageLedger(INITIAL_USAGE_LEDGER);
        setCostSettings(DEFAULT_COST_SETTINGS);
        setNodeGraph(null);
        setDesignCanvasState(null);
        setSetDesignState(null);
        setSceneMapState(null);
        setSceneWallState(null);
        setWorldGenState(null);
        setVideoGenSeed(null);
        projectFileMtimeRef.current = null;
    };

    const runAutoSave = useCallback(async () => {
        if (!autosaveSettings.enabled) return;
        if (!projectPath || isProjectSaving || isProjectLoading || isAutoSaving) return;
        if (projectSyncStatus.state === 'incoming') return;
        const now = Date.now();
        if (now - lastAutoSaveRef.current < autosaveSettings.minIntervalMs) {
            return;
        }
        setIsAutoSaving(true);
        try {
            const collaborationForSave = buildCollaborationForSave();
            const { savedAt } = await saveProjectToFolder(
                projectPath,
                {
                    storyBible,
                    collaboration: collaborationForSave,
                    sync: projectSync,
                    references,
                    avatars,
                    projectHub: { shotPrompts },
                    mediaItems,
                    timelineClips,
                    timelineTracks,
                    waveformCache,
                    nodeGraph,
                    designCanvas: designCanvasState,
                    setDesign: setDesignState,
                    sceneMap: sceneMapState,
                    sceneWall: sceneWallState,
                    worldGen: worldGenState,
                    reviewData,
                    namingTemplates,
                    usageLedger,
                    costSettings,
                },
                projectName || storyBible.title || 'Untitled Project',
            );
            lastAutoSaveRef.current = Date.now();
            setLastAutoSavedAt(savedAt);
            suppressAutosaveRef.current = true;
            setProjectCollaboration(collaborationForSave);
            setProjectSyncStatus(prev => ({
                ...prev,
                state: projectSync.provider ? 'up-to-date' : prev.state,
                message: projectSync.provider ? 'Auto-saved to disk.' : prev.message,
            }));
            refreshProjectFileMtime(projectPath);
            if (projectSync.provider && projectSync.autoSync !== false && typeof window !== 'undefined' && window.electron?.project) {
                await pushProjectToCloud(projectPath);
            }
            localStorage.setItem(
                AUTOSAVE_META_KEY,
                JSON.stringify({
                    projectPath,
                    name: projectName || storyBible.title || 'Untitled Project',
                    savedAt,
                }),
            );
            upsertRecentProject({
                path: projectPath,
                name: projectName || storyBible.title || 'Untitled Project',
                lastOpened: new Date().toISOString(),
                lastSavedAt: savedAt,
                projectGroup: storyBible.projectGroup,
                projectSubgroup: storyBible.projectSubgroup,
            });
        } catch (e) {
            console.error('Auto-save failed', e);
        } finally {
            setIsAutoSaving(false);
        }
    }, [
        projectPath,
        storyBible,
        references,
        avatars,
        shotPrompts,
        reviewData,
        namingTemplates,
        usageLedger,
        costSettings,
        mediaItems,
        timelineClips,
        timelineTracks,
        waveformCache,
        nodeGraph,
        designCanvasState,
        setDesignState,
        sceneMapState,
        sceneWallState,
        worldGenState,
        projectName,
        isProjectSaving,
        isProjectLoading,
        isAutoSaving,
        autosaveSettings,
        projectSyncStatus.state,
        projectSync,
        buildCollaborationForSave,
        refreshProjectFileMtime,
        pushProjectToCloud,
        upsertRecentProject,
    ]);

    const scheduleAutoSave = useCallback(() => {
        if (!autosaveSettings.enabled) {
            if (autosaveTimerRef.current) {
                window.clearTimeout(autosaveTimerRef.current);
                autosaveTimerRef.current = null;
            }
            return;
        }
        if (!projectPath || isProjectSaving || isProjectLoading || isAutoSaving) return;
        if (autosaveTimerRef.current) {
            window.clearTimeout(autosaveTimerRef.current);
        }
        autosaveTimerRef.current = window.setTimeout(() => {
            runAutoSave();
        }, autosaveSettings.debounceMs);
    }, [projectPath, isProjectSaving, isProjectLoading, isAutoSaving, runAutoSave, autosaveSettings]);

    useEffect(() => {
        if (suppressAutosaveRef.current) {
            suppressAutosaveRef.current = false;
            return;
        }
        if (isHydratingRef.current) return;
        if (!projectPath) return;
        scheduleAutoSave();
    }, [
        projectPath,
        projectName,
        storyBible,
        projectCollaboration,
        projectSync,
        references,
        avatars,
        shotPrompts,
        mediaItems,
        timelineClips,
        timelineTracks,
        waveformCache,
        nodeGraph,
        designCanvasState,
        setDesignState,
        sceneMapState,
        sceneWallState,
        worldGenState,
        autosaveSettings.enabled,
        scheduleAutoSave,
    ]);

    useEffect(() => {
        return () => {
            if (autosaveTimerRef.current) {
                window.clearTimeout(autosaveTimerRef.current);
                autosaveTimerRef.current = null;
            }
        };
    }, [projectPath]);

    useEffect(() => {
        if (!projectPath || !projectSync.provider) {
            setProjectSyncStatus(prev => ({ ...prev, state: 'idle', message: projectPath ? 'Sync not configured.' : undefined, incoming: undefined }));
            return;
        }
        if (projectSync.autoSync === false) {
            setProjectSyncStatus(prev => ({ ...prev, state: 'idle', message: 'Auto-sync paused.', incoming: undefined }));
            return;
        }
        if (typeof window === 'undefined' || !window.electron?.project) {
            setProjectSyncStatus(prev => ({ ...prev, state: 'error', message: 'Cloud sync is available in the desktop app.', incoming: undefined }));
            return;
        }
        const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        const root = projectSync.rootPath ? normalizePath(projectSync.rootPath) : '';
        const projectFolder = normalizePath(projectPath);
        if (root && !projectFolder.startsWith(`${root}/`) && projectFolder !== root) {
            setProjectSyncStatus(prev => ({ ...prev, state: 'idle', message: 'Project is outside the selected sync folder.', incoming: undefined }));
            return;
        }

        let isActive = true;
        const poll = async () => {
            if (!isActive) return;
            if (syncStatusRef.current.state === 'incoming') return;
            const timestamp = new Date().toISOString();
            try {
                setProjectSyncStatus(prev => ({ ...prev, state: 'checking', lastCheckedAt: timestamp }));
                const stat = await statProjectFile(projectPath);
                if (!stat.exists || typeof stat.mtimeMs !== 'number') {
                    setProjectSyncStatus(prev => ({ ...prev, state: 'error', message: 'Project file not found.', incoming: undefined }));
                    return;
                }
                const known = projectFileMtimeRef.current;
                if (known && stat.mtimeMs > known + 2000 && !isProjectSaving && !isProjectLoading && !isAutoSaving) {
                    const remote = await loadProjectFromFolder(projectPath);
                    if (!isActive) return;
                    setProjectSyncStatus(prev => ({
                        ...prev,
                        state: 'incoming',
                        message: 'Incoming update detected.',
                        lastCheckedAt: timestamp,
                        incoming: {
                            by: remote.collaboration?.lastModifiedBy,
                            at: remote.collaboration?.lastModifiedAt,
                        },
                    }));
                    return;
                }
                projectFileMtimeRef.current = stat.mtimeMs;
                setProjectSyncStatus(prev => ({
                    ...prev,
                    state: 'up-to-date',
                    message: 'Up to date.',
                    lastCheckedAt: timestamp,
                    incoming: undefined,
                }));

                if (projectSync.provider) {
                    try {
                        const remote = await fetchCloudProjectMeta(projectSync.provider, projectSync, getProjectDisplayName());
                        if (remote) {
                            setProjectSync(remote.sync);
                            if (remote.modifiedAt && projectSync.remoteModifiedAt) {
                                const remoteTime = new Date(remote.modifiedAt).getTime();
                                const knownTime = new Date(projectSync.remoteModifiedAt).getTime();
                                if (Number.isFinite(remoteTime) && Number.isFinite(knownTime) && remoteTime > knownTime + 2000) {
                                    setProjectSyncStatus(prev => ({
                                        ...prev,
                                        state: 'incoming',
                                        message: 'Incoming cloud update detected.',
                                        lastCheckedAt: timestamp,
                                        incoming: {
                                            by: prev.incoming?.by,
                                            at: remote.modifiedAt,
                                        },
                                    }));
                                }
                            }
                        }
                    } catch (e) {
                        const msg = e instanceof Error ? e.message : 'Cloud sync check failed.';
                        const normalized = msg.toLowerCase();
                        const friendly = normalized.includes('not_found') || normalized.includes('not found')
                            ? 'Cloud file not found. Push to create it.'
                            : msg;
                        setProjectSyncStatus(prev => ({ ...prev, message: friendly }));
                    }
                }
            } catch (e) {
                if (!isActive) return;
                const msg = e instanceof Error ? e.message : 'Sync status failed.';
                setProjectSyncStatus(prev => ({ ...prev, state: 'error', message: msg }));
            }
        };

        poll();
        const intervalId = window.setInterval(poll, SYNC_POLL_INTERVAL_MS);
        return () => {
            isActive = false;
            window.clearInterval(intervalId);
        };
    }, [
        projectPath,
        projectSync.provider,
        projectSync.rootPath,
        projectSync.autoSync,
        projectSync.remoteModifiedAt,
        isProjectSaving,
        isProjectLoading,
        isAutoSaving,
        getProjectDisplayName,
    ]);

    useEffect(() => {
        if (!projectPath) {
            setProjectSyncStatus(prev => ({ ...prev, lock: undefined }));
            return;
        }
        if (typeof window === 'undefined' || !window.electron?.project) {
            return;
        }

        let isActive = true;
        const sessionId = sessionIdRef.current;
        const userName = activeProfile?.name?.trim() || 'Unknown';

        const writeLock = async () => {
            const payload = JSON.stringify({
                sessionId,
                user: userName,
                updatedAt: new Date().toISOString(),
                userAgent: navigator.userAgent,
            });
            await writeProjectMetaFile(projectPath, LOCK_FILE_NAME, payload);
        };

        const readLock = async () => {
            try {
                const raw = await readProjectMetaFile(projectPath, LOCK_FILE_NAME);
                if (!raw) {
                    setProjectSyncStatus(prev => ({ ...prev, lock: undefined }));
                    return;
                }
                const data = JSON.parse(raw) as { sessionId?: string; user?: string; updatedAt?: string };
                if (!data.updatedAt) {
                    setProjectSyncStatus(prev => ({ ...prev, lock: undefined }));
                    return;
                }
                const updatedAt = new Date(data.updatedAt).getTime();
                const isActiveLock = !Number.isNaN(updatedAt) && Date.now() - updatedAt < LOCK_STALE_AFTER_MS;
                const isSelf = data.sessionId && data.sessionId === sessionId;
                if (!isActiveLock) {
                    setProjectSyncStatus(prev => ({ ...prev, lock: undefined }));
                    return;
                }
                if (!isActive) return;
                setProjectSyncStatus(prev => ({
                    ...prev,
                    lock: {
                        by: data.user || 'Unknown',
                        at: data.updatedAt,
                        isActive: !isSelf,
                    },
                }));
            } catch {
            }
        };

        const heartbeat = async () => {
            try {
                await writeLock();
                await readLock();
            } catch {
            }
        };

        heartbeat();
        const intervalId = window.setInterval(heartbeat, LOCK_HEARTBEAT_MS);

        return () => {
            isActive = false;
            window.clearInterval(intervalId);
            readProjectMetaFile(projectPath, LOCK_FILE_NAME)
                .then((raw) => {
                    if (!raw) return;
                    const data = JSON.parse(raw) as { sessionId?: string };
                    if (data.sessionId === sessionId) {
                        return deleteProjectMetaFile(projectPath, LOCK_FILE_NAME);
                    }
                })
                .catch(() => {
                });
        };
    }, [projectPath, activeProfile?.name]);

    // Centralized Error Handler for AI API calls
    const handleAIError = (error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("AI Operation Failed:", errorMessage);

        if (errorMessage.includes('403') || errorMessage.includes('PERMISSION_DENIED') || errorMessage.includes('permission')) {
            // Check if it is a Replicate error specifically
            if (errorMessage.includes("Replicate")) {
                alert("Replicate API Error: Please check your Replicate API Token in settings.");
                setShowSettings(true);
            } else {
                setApiKeyReady(false);
                alert("Google API Permission Denied. The key may be invalid, expired, or lack access to the selected model.");
            }
        } else {
            alert(`AI Error: ${errorMessage}`);
        }
    };

    // --- Media & Timeline Helpers ---

    const MIN_TIMELINE_CLIP_DURATION = 0.05;

    const clampNumber = (value: number, min: number, max: number) =>
        Math.min(max, Math.max(min, value));

    const createEffectLayerId = (effect: EffectType) => {
        const slug = effect.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const nonce = Math.random().toString(36).slice(2, 7);
        return `fx-${slug || 'effect'}-${Date.now()}-${nonce}`;
    };

    const createEffectLayer = (effect: EffectType, intensity = 100): ClipEffectLayer =>
        normalizeEffectLayer(
            {
                id: createEffectLayerId(effect),
                effect,
                intensity,
                enabled: true,
            },
            0,
        );

    const getMediaDurationById = (mediaId: string, fallback = 5) => {
        const media = mediaItems.find((item) => item.id === mediaId);
        return Math.max(MIN_TIMELINE_CLIP_DURATION, media?.duration || fallback);
    };

    const normalizeClipTiming = (clip: TimelineClip): TimelineClip => {
        const mediaDuration = getMediaDurationById(clip.mediaId, clip.duration || 5);
        const sourceIn = clampNumber(clip.sourceIn ?? 0, 0, mediaDuration);
        const unclampedSourceOut = clip.sourceOut ?? sourceIn + Math.max(MIN_TIMELINE_CLIP_DURATION, clip.duration || (clip.end - clip.start));
        const sourceOut = clampNumber(unclampedSourceOut, sourceIn + MIN_TIMELINE_CLIP_DURATION, mediaDuration);
        const speed = Math.max(0.05, clip.speed || 1);
        const duration = Math.max(MIN_TIMELINE_CLIP_DURATION, sourceOut - sourceIn);
        const start = Math.max(0, clip.start);
        const end = Math.max(start + MIN_TIMELINE_CLIP_DURATION, clip.end);
        const effects = getClipEffectLayers(clip);
        return {
            ...clip,
            start,
            end,
            speed,
            sourceIn,
            sourceOut,
            duration,
            effect: effects[0]?.effect || null,
            effects,
        };
    };

    const getTrackTypeForMedia = (media: MediaItem): 'video' | 'audio' =>
        media.type === 'audio' ? 'audio' : 'video';

    const buildTimelineSignature = (clips: TimelineClip[]) =>
        JSON.stringify(
            clips
                .slice()
                .sort((a, b) => {
                    if (a.trackId !== b.trackId) return a.trackId.localeCompare(b.trackId);
                    if (a.start !== b.start) return a.start - b.start;
                    return a.id.localeCompare(b.id);
                })
                .map((clip) => ({
                    id: clip.id,
                    trackId: clip.trackId,
                    start: Number(clip.start.toFixed(3)),
                    end: Number(clip.end.toFixed(3)),
                    sourceIn: Number((clip.sourceIn ?? 0).toFixed(3)),
                    sourceOut: Number((clip.sourceOut ?? 0).toFixed(3)),
                    transitionOut: clip.transitionOut?.type || null,
                    transitionDuration: clip.transitionOut ? Number(clip.transitionOut.duration.toFixed(3)) : null,
                    text: clip.textConfig?.content || null,
                })),
        );

    const currentTimelineSignature = useMemo(
        () => buildTimelineSignature(timelineClips),
        [timelineClips],
    );

    const createEditPlanClipSnapshot = (clip: TimelineClip): EditPlanClipSnapshot => {
        const media = mediaItems.find((item) => item.id === clip.mediaId);
        const currentTrack = timelineTracks.find((track) => track.id === clip.trackId);
        const sameTypeTracks = timelineTracks.filter((track) => track.type === (currentTrack?.type || 'video'));
        const trackIndex = sameTypeTracks.findIndex((track) => track.id === clip.trackId);
        const trackType = currentTrack?.type === 'audio' ? 'A' : 'V';
        const trackLabel = `${trackType}${trackIndex >= 0 ? trackIndex + 1 : 1}`;
        const clipLabel = (media?.prompt || media?.name || clip.id).replace(/\s+/g, ' ').trim();
        return {
            clipId: clip.id,
            trackId: clip.trackId,
            trackLabel,
            start: clip.start,
            end: clip.end,
            duration: Math.max(MIN_TIMELINE_CLIP_DURATION, clip.end - clip.start),
            label: clipLabel.length > 120 ? `${clipLabel.slice(0, 117).trimEnd()}...` : clipLabel,
            transitionType: clip.transitionOut?.type || null,
            textOverlay: clip.textConfig?.content || null,
        };
    };

    const createTimelineTrack = (type: 'video' | 'audio', existingTracks: TimelineTrack[]): TimelineTrack => {
        const hasTargetedTrack = existingTracks.some(
            (track) => track.type === type && track.isTargeted && !track.isLocked,
        );
        return {
            id: `${type}-${Date.now()}`,
            type,
            isLocked: false,
            isMuted: false,
            isTargeted: !hasTargetedTrack,
            isSolo: false,
        };
    };

    const pickTimelineTrack = (trackType: 'video' | 'audio') => {
        const candidates = timelineTracks.filter((track) => track.type === trackType && !track.isLocked);
        if (candidates.length === 0) return null;
        const targeted = candidates.find((track) => track.isTargeted);
        return targeted || candidates[0];
    };

    const getLibraryAssetMediaType = (asset: LibraryAsset): MediaItem['type'] =>
        asset.kind === 'audio'
            ? 'audio'
            : asset.kind === 'video'
                ? 'video'
                : 'image';

    const buildMediaItemFromLibraryAsset = (asset: LibraryAsset, url: string): MediaItem => {
        const mappedType = getLibraryAssetMediaType(asset);
        return {
            id: `library-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: asset.name || `${asset.projectName} Asset`,
            type: mappedType,
            url,
            source: asset.source === 'upload' ? 'upload' : 'generated',
            generatedBy: asset.generatedBy || `${asset.projectName} Library`,
            prompt: asset.prompt,
            duration: mappedType === 'video' || mappedType === 'audio'
                ? Math.max(MIN_TIMELINE_CLIP_DURATION, asset.duration || 5)
                : undefined,
            originUrl: asset.url || undefined,
            originProjectPath: asset.projectPath || null,
        };
    };

    const resolveTimelineTrackForMedia = (media: MediaItem, preferredTrackId?: string) => {
        const trackType = getTrackTypeForMedia(media);
        if (preferredTrackId) {
            const preferredTrack = timelineTracks.find((track) => track.id === preferredTrackId);
            if (!preferredTrack) {
                alert('The target track no longer exists.');
                return null;
            }
            if (preferredTrack.isLocked) {
                alert('Unlock the target track before dropping footage on it.');
                return null;
            }
            if (preferredTrack.type !== trackType) {
                alert(trackType === 'audio' ? 'Drop audio onto an audio track.' : 'Drop visuals onto a video track.');
                return null;
            }
            return preferredTrack;
        }
        return pickTimelineTrack(trackType);
    };

    const handleAddMedia = async (files: FileList) => {
        const newItems: MediaItem[] = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const mediaId = `upload-${Date.now()}-${i}`;
            let type: 'video' | 'image' | 'audio' = inferImportedMediaType(file);
            let duration = 5;
            let url = '';
            let sourceUrl: string | undefined = undefined;

            if (type === 'video') {
                if (shouldCreateDesktopVideoProxy(file)) {
                    try {
                        const prepared = await prepareDesktopVideoForEditing(file);
                        if (prepared) {
                            url = prepared.previewUrl;
                            sourceUrl = prepared.sourceUrl;
                            if (typeof prepared.durationSeconds === 'number' && Number.isFinite(prepared.durationSeconds) && prepared.durationSeconds > 0) {
                                duration = prepared.durationSeconds;
                            }
                        }
                    } catch (e) {
                        console.error('Failed to create desktop proxy for imported video', e);
                    }
                }

                if (!url) {
                    url = URL.createObjectURL(file);
                }

                if (duration <= 5) {
                    try {
                        duration = await getVideoDuration(url);
                    } catch (e) {
                        console.error("Error getting video duration", e);
                    }
                }
            } else if (type === 'audio') {
                url = URL.createObjectURL(file);
                try {
                    duration = await getVideoDuration(url);
                } catch (e) { console.error(e); }
                generateWaveformData(url).then(data => {
                    setWaveformCache(prev => ({ ...prev, [`upload-${file.name}-${i}`]: data }));
                });
            } else {
                url = URL.createObjectURL(file);
            }

            newItems.push({
                id: mediaId,
                name: file.name,
                type,
                url,
                sourceUrl,
                source: 'upload',
                duration
            });
            registerMediaFile(mediaId, file);
        }
        setMediaItems(prev => [...prev, ...newItems]);
    };

    const handleImportTimelineOtio = async (file: File, mode: OpenTimelineIOImportMode = 'replace') => {
        const imported = parseOpenTimelineIOToTimeline(await file.text());
        if (mode === 'replace' && timelineClips.length > 0) {
            const shouldReplace = window.confirm(`Replace the current timeline with "${imported.projectName}" from ${file.name}? Media already in the bin will be reused by URL.`);
            if (!shouldReplace) {
                return 'OTIO import cancelled.';
            }
        }

        const applied = applyOpenTimelineIOImportToProject({
            mode,
            currentMediaItems: mediaItems,
            currentTimelineTracks: timelineTracks,
            currentTimelineClips: timelineClips,
            imported,
        });

        setMediaItems(applied.mediaItems);
        setTimelineTracks(applied.timelineTracks.length > 0 ? applied.timelineTracks : INITIAL_TRACKS);
        setTimelineClips(applied.timelineClips);
        setSelectedClipId(null);
        setActiveTrackId(applied.activeTrackId || INITIAL_TRACKS[0]?.id || null);
        setPlayheadPosition(0);
        setIsPlaying(false);
        setActiveWorkspace('EDIT');

        const warningText = applied.warnings.length > 0 ? ` ${applied.warnings.length} warning(s).` : '';
        return `${applied.summary}${warningText}`;
    };

    const appendMediaToTimeline = (media: MediaItem, placement?: { trackId?: string; startTime?: number; sourceIn?: number; sourceOut?: number }) => {
        const track = resolveTimelineTrackForMedia(media, placement?.trackId);
        if (!track) {
            if (!placement?.trackId) {
                const trackType = getTrackTypeForMedia(media);
                alert(`No unlocked ${trackType} track available.`);
            }
            return;
        }

        const lastClipEnd = timelineClips
            .filter(c => c.trackId === track.id)
            .reduce((max, c) => Math.max(max, c.end), 0);
        const start = typeof placement?.startTime === 'number'
            ? Math.max(0, placement.startTime)
            : lastClipEnd;
        const mediaDuration = Math.max(MIN_TIMELINE_CLIP_DURATION, media.duration || 5);
        const sourceIn = Number.isFinite(placement?.sourceIn) ? Math.max(0, Number(placement?.sourceIn)) : 0;
        const requestedSourceOut = Number.isFinite(placement?.sourceOut) ? Number(placement?.sourceOut) : mediaDuration;
        const sourceOut = Math.max(sourceIn + MIN_TIMELINE_CLIP_DURATION, Math.min(mediaDuration, requestedSourceOut));
        const sourceDuration = Math.max(MIN_TIMELINE_CLIP_DURATION, sourceOut - sourceIn);

        const newClip = normalizeClipTiming({
            id: `clip-${Date.now()}`,
            mediaId: media.id,
            trackId: track.id,
            start,
            end: start + sourceDuration,
            duration: sourceDuration,
            speed: 1,
            sourceIn,
            sourceOut,
            effect: null,
        });

        setActiveTrackId(track.id);
        setTimelineClips([...timelineClips, newClip]);
    };

    const createTransparentTitleMedia = (name: string, duration: number): MediaItem => {
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Could not initialize title canvas.');
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        return {
            id: `text-overlay-${Date.now()}`,
            name,
            type: 'image',
            url: canvas.toDataURL('image/png'),
            source: 'generated',
            duration,
            generatedBy: 'Edit Title Tool',
        };
    };

    const ensureTitleOverlayTrack = (rangeStart: number, rangeEnd: number) => {
        const overlapsRange = (trackId: string) =>
            timelineClips.some((clip) => clip.trackId === trackId && clip.end > rangeStart + 0.001 && clip.start < rangeEnd - 0.001);

        const videoTracks = timelineTracks.filter((track) => track.type === 'video');
        const reusableTitleTrack = [...videoTracks].reverse().find((track) => {
            if (track.isLocked) return false;
            const trackClips = timelineClips.filter((clip) => clip.trackId === track.id);
            const titleOnly = trackClips.every((clip) => Boolean(clip.textConfig));
            return titleOnly && !overlapsRange(track.id);
        });
        if (reusableTitleTrack) return reusableTitleTrack;

        const emptyTrack = [...videoTracks].reverse().find((track) => !track.isLocked && timelineClips.every((clip) => clip.trackId !== track.id));
        if (emptyTrack) return emptyTrack;

        const newTrack = createTimelineTrack('video', timelineTracks);
        setTimelineTracks((prev) => [...prev, newTrack]);
        return newTrack;
    };

    const buildTextOverlayClip = (
        mediaId: string,
        trackId: string,
        start: number,
        options: StandaloneTextClipOptions = {},
    ) => {
        const clipDuration = Math.max(MIN_TIMELINE_CLIP_DURATION, options.duration || 5);
        return normalizeClipTiming({
            id: `clip-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
            mediaId,
            trackId,
            start,
            end: start + clipDuration,
            duration: clipDuration,
            speed: 1,
            sourceIn: 0,
            sourceOut: clipDuration,
            effect: null,
            textConfig: {
                content: options.content?.trim() || 'Text Overlay',
                font: options.font || 'Arial',
                size: options.size || 72,
                color: options.color || '#FFFFFF',
                position: options.position || 'center',
                autoContrast: options.autoContrast,
                motionPreset: options.motionPreset,
                background: options.background,
            },
            transform: options.transform,
            keyframes: options.keyframes,
        });
    };

    const createStandaloneTextClip = (options: StandaloneTextClipOptions = {}) => {
        const clipStart = Math.max(0, options.startTime ?? playheadPosition ?? 0);
        const clipDuration = Math.max(MIN_TIMELINE_CLIP_DURATION, options.duration || 5);
        const track = options.trackId
            ? resolveTimelineTrackForMedia({ id: 'title-probe', name: 'Title Probe', type: 'image', url: '', source: 'generated', duration: clipDuration } as MediaItem, options.trackId)
            : ensureTitleOverlayTrack(clipStart, clipStart + clipDuration);
        if (!track) {
            alert('No unlocked video track available.');
            return;
        }

        const textMedia = createTransparentTitleMedia(
            options.content?.trim() ? `${options.content.trim().slice(0, 24)} Title` : 'Text Overlay Clip',
            clipDuration,
        );
        const newClip = buildTextOverlayClip(textMedia.id, track.id, clipStart, options);

        setMediaItems((prev) => [...prev, textMedia]);
        setActiveTrackId(track.id);
        setSelectedClipId(newClip.id);
        setTimelineClips([...timelineClips, newClip]);
    };

    const formatSubtitleText = (value: string) => {
        const cleanValue = value
            .replace(/\s+/g, ' ')
            .replace(/\s+([,.!?;:])/g, '$1')
            .trim();
        if (!cleanValue) return '';
        if (cleanValue.length <= 42) return cleanValue;

        const tokens = cleanValue.split(' ').filter(Boolean);
        if (tokens.length <= 4) return cleanValue;

        let bestSplit = Math.ceil(tokens.length / 2);
        let bestScore = Number.POSITIVE_INFINITY;
        for (let index = 2; index <= tokens.length - 2; index += 1) {
            const left = tokens.slice(0, index).join(' ');
            const right = tokens.slice(index).join(' ');
            const imbalance = Math.abs(left.length - right.length);
            const overflowPenalty = Math.max(0, left.length - 42) + Math.max(0, right.length - 42);
            const punctuationBonus = /[,.!?;:]$/.test(tokens[index - 1]) ? -6 : 0;
            const score = imbalance + overflowPenalty * 3 + punctuationBonus;
            if (score < bestScore) {
                bestScore = score;
                bestSplit = index;
            }
        }

        return `${tokens.slice(0, bestSplit).join(' ')}\n${tokens.slice(bestSplit).join(' ')}`.trim();
    };

    const createSyntheticWordTimings = (transcript: string, duration: number): SubtitleWordTiming[] => {
        const words = transcript
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .filter(Boolean);
        if (words.length === 0) return [];

        const unit = Math.max(MIN_TIMELINE_CLIP_DURATION / 2, duration / words.length);
        return words.map((word, index) => ({
            text: word,
            start: Math.min(duration, index * unit),
            end: Math.min(duration, (index + 1) * unit),
        }));
    };

    const splitWordsIntoSubtitleSegments = (words: SubtitleWordTiming[], duration: number) => {
        const cleanWords = words
            .map((word) => ({
                text: String(word.text || '').trim(),
                start: clampNumber(word.start, 0, duration),
                end: clampNumber(word.end, 0, duration),
            }))
            .filter((word) => word.text)
            .map((word) => ({
                ...word,
                end: Math.max(word.start + MIN_TIMELINE_CLIP_DURATION, word.end),
            }))
            .sort((a, b) => a.start - b.start);

        if (cleanWords.length === 0) return [] as Array<{ text: string; words: SubtitleWordTiming[]; startOffset: number; endOffset: number }>;

        const rawSegments: SubtitleWordTiming[][] = [];
        let current: SubtitleWordTiming[] = [];

        cleanWords.forEach((word, index) => {
            const nextWord = cleanWords[index + 1];
            const candidate = [...current, word];
            const candidateText = candidate.map((entry) => entry.text).join(' ');
            const candidateDuration = candidate[candidate.length - 1].end - candidate[0].start;

            if (
                current.length > 0 &&
                (candidateText.length > 58 || candidateDuration > 4.8 || candidate.length > 11)
            ) {
                rawSegments.push(current);
                current = [word];
            } else {
                current = candidate;
            }

            const punctuationStop = /[.!?]$/.test(word.text) && current.length >= 4;
            const clauseStop = /[,;:]$/.test(word.text) && current.length >= 6;
            const hasPause = Boolean(nextWord && nextWord.start - word.end > 0.28 && current.length >= 3);
            if (punctuationStop || clauseStop || hasPause) {
                rawSegments.push(current);
                current = [];
            }
        });

        if (current.length > 0) {
            rawSegments.push(current);
        }

        const mergedSegments: SubtitleWordTiming[][] = [];
        rawSegments.forEach((segment) => {
            const segmentDuration = segment[segment.length - 1].end - segment[0].start;
            if (mergedSegments.length > 0 && (segment.length < 3 || segmentDuration < 0.7)) {
                mergedSegments[mergedSegments.length - 1] = [...mergedSegments[mergedSegments.length - 1], ...segment];
                return;
            }
            mergedSegments.push(segment);
        });

        return mergedSegments.map((segment) => ({
            text: formatSubtitleText(segment.map((entry) => entry.text).join(' ')),
            words: segment,
            startOffset: segment[0].start,
            endOffset: segment[segment.length - 1].end,
        }));
    };

    const buildSubtitleClipFromWords = (
        mediaId: string,
        trackId: string,
        groupBaseStart: number,
        sourceClipId: string,
        groupId: string,
        segmentIndex: number,
        words: SubtitleWordTiming[],
        existingClip?: TimelineClip,
    ) => {
        const normalizedWords = words
            .map((word) => ({
                text: String(word.text || '').trim(),
                start: Math.max(0, word.start),
                end: Math.max(0, word.end),
            }))
            .filter((word) => word.text)
            .sort((a, b) => a.start - b.start);
        const textConfig = existingClip?.textConfig;
        const startOffset = normalizedWords[0]?.start ?? 0;
        const endOffset = Math.max(startOffset + MIN_TIMELINE_CLIP_DURATION, normalizedWords[normalizedWords.length - 1]?.end ?? (startOffset + 2));
        const duration = Math.max(MIN_TIMELINE_CLIP_DURATION, endOffset - startOffset);
        const start = groupBaseStart + startOffset;
        const content = formatSubtitleText(existingClip?.textConfig?.content || normalizedWords.map((word) => word.text).join(' '));

        return normalizeClipTiming({
            id: existingClip?.id || `clip-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
            mediaId,
            trackId,
            start,
            end: start + duration,
            duration,
            speed: 1,
            sourceIn: 0,
            sourceOut: duration,
            effect: null,
            textConfig: {
                content,
                font: textConfig?.font || 'Arial',
                size: textConfig?.size || 40,
                color: textConfig?.color || '#F8FAFC',
                position: textConfig?.position || 'bottom-center',
                autoContrast: textConfig?.autoContrast ?? true,
                motionPreset: textConfig?.motionPreset ?? null,
                background: textConfig?.background || DEFAULT_SUBTITLE_BACKGROUND,
            },
            subtitleSegment: {
                groupId,
                sourceClipId,
                segmentIndex,
                startOffset,
                endOffset,
                words: normalizedWords,
            },
            transform: existingClip?.transform,
            keyframes: existingClip?.keyframes,
        });
    };

    const reindexSubtitleGroup = (clips: TimelineClip[], groupId: string) => {
        const orderedGroup = clips
            .filter((entry) => entry.subtitleSegment?.groupId === groupId)
            .sort((a, b) => a.start - b.start);
        const indexById = new Map(orderedGroup.map((entry, index) => [entry.id, index]));
        return clips.map((entry) => (
            entry.subtitleSegment?.groupId === groupId
                ? {
                    ...entry,
                    subtitleSegment: {
                        ...entry.subtitleSegment,
                        segmentIndex: indexById.get(entry.id) ?? entry.subtitleSegment.segmentIndex,
                    },
                }
                : entry
        ));
    };

    const generateSubtitleClipsFromClip = useCallback(async (clipId: string) => {
        const clip = timelineClips.find((entry) => entry.id === clipId);
        if (!clip) throw new Error('Select a timeline clip first.');
        const media = mediaItems.find((entry) => entry.id === clip.mediaId);
        if (!media || (media.type !== 'video' && media.type !== 'audio')) {
            throw new Error('Subtitle generation needs a video or audio clip.');
        }

        const audio = await getBase64FromUrl(media.url);
        const timedTranscript = await transcribeAudioWithWordTimings(audio);
        const mediaDuration = Math.max(MIN_TIMELINE_CLIP_DURATION, media.duration || clip.sourceOut || clip.duration || 5);
        const sourceIn = Math.max(0, clip.sourceIn ?? 0);
        const sourceOut = Math.max(sourceIn + MIN_TIMELINE_CLIP_DURATION, Math.min(mediaDuration, clip.sourceOut ?? mediaDuration));
        const clipTimelineDuration = Math.max(MIN_TIMELINE_CLIP_DURATION, clip.end - clip.start);
        const playbackSpeed = Math.max(0.05, clip.speed || 1);

        let scopedWords = timedTranscript.words
            .filter((word) => word.end > sourceIn && word.start < sourceOut)
            .map((word) => ({
                text: word.text,
                start: clampNumber((Math.max(word.start, sourceIn) - sourceIn) / playbackSpeed, 0, clipTimelineDuration),
                end: clampNumber((Math.min(word.end, sourceOut) - sourceIn) / playbackSpeed, 0, clipTimelineDuration),
            }))
            .filter((word) => word.end > word.start);

        const scopedTranscript = scopedWords.length > 0
            ? scopedWords.map((word) => word.text).join(' ')
            : timedTranscript.transcript
                .replace(/\s+/g, ' ')
                .trim();

        if (scopedWords.length === 0) {
            scopedWords = createSyntheticWordTimings(scopedTranscript, clipTimelineDuration);
        }

        const segments = splitWordsIntoSubtitleSegments(scopedWords, clipTimelineDuration);
        if (segments.length === 0) {
            throw new Error('Transcript came back empty.');
        }

        const track = ensureTitleOverlayTrack(clip.start, clip.end);
        const sharedMedia = createTransparentTitleMedia(`${media.name.slice(0, 24)} Subtitles`, clip.end - clip.start);
        const groupId = `subtitle-group-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
        const subtitleClips = segments.map((segment, index) => buildSubtitleClipFromWords(
            sharedMedia.id,
            track.id,
            clip.start,
            clip.id,
            groupId,
            index,
            segment.words,
            {
                ...clip,
                mediaId: sharedMedia.id,
                trackId: track.id,
                textConfig: {
                    content: segment.text,
                    font: 'Arial',
                    size: 40,
                    color: '#F8FAFC',
                    position: 'bottom-center',
                    autoContrast: true,
                    motionPreset: null,
                    background: DEFAULT_SUBTITLE_BACKGROUND,
                },
            },
        ));

        setMediaItems((prev) => [...prev, sharedMedia]);
        setTimelineClips([...timelineClips, ...subtitleClips]);
        setActiveTrackId(track.id);
        setSelectedClipId(subtitleClips[0]?.id || null);
        setPlayheadPosition(clip.start);

        return {
            count: subtitleClips.length,
            transcript: scopedTranscript,
        };
    }, [mediaItems, timelineClips]);

    const applyTitleMotionPresetToClip = useCallback((clipId: string, preset: TitleMotionPreset) => {
        const clip = timelineClips.find((entry) => entry.id === clipId);
        if (!clip?.textConfig) return;

        const baseTransform = clip.transform || { scale: 1, opacity: 1, position: { x: 50, y: 50 } };
        const preservedKeyframes = (clip.keyframes || []).filter((frame) => !['scale', 'x', 'y', 'opacity', 'textBlur'].includes(frame.property));
        const position = clip.textConfig.position;
        const horizontalIn = position.includes('right') ? 55 : position.includes('left') ? 45 : 50;
        const verticalIn = position.includes('bottom') ? 53 : position.includes('top') ? 47 : 51.5;
        let presetKeyframes: Keyframe[] = [];
        let nextTransform = { ...baseTransform, scale: 1, opacity: 1, position: { x: 50, y: 50 } };

        if (preset === 'slide-in') {
            presetKeyframes = [
                { id: `kf-${Date.now()}-slide-x-0`, time: 0, property: 'x', value: horizontalIn, easing: 'ease-out' },
                { id: `kf-${Date.now()}-slide-x-1`, time: 0.34, property: 'x', value: 50, easing: 'ease-in-out' },
                { id: `kf-${Date.now()}-slide-y-0`, time: 0, property: 'y', value: verticalIn, easing: 'ease-out' },
                { id: `kf-${Date.now()}-slide-y-1`, time: 0.34, property: 'y', value: 50, easing: 'ease-in-out' },
                { id: `kf-${Date.now()}-slide-o-0`, time: 0, property: 'opacity', value: 0, easing: 'ease-out' },
                { id: `kf-${Date.now()}-slide-o-1`, time: 0.22, property: 'opacity', value: 1, easing: 'ease-out' },
            ];
        } else if (preset === 'soft-fade') {
            presetKeyframes = [
                { id: `kf-${Date.now()}-fade-o-0`, time: 0, property: 'opacity', value: 0, easing: 'ease-in' },
                { id: `kf-${Date.now()}-fade-o-1`, time: 0.42, property: 'opacity', value: 1, easing: 'ease-out' },
                { id: `kf-${Date.now()}-fade-y-0`, time: 0, property: 'y', value: 51.5, easing: 'ease-out' },
                { id: `kf-${Date.now()}-fade-y-1`, time: 0.42, property: 'y', value: 50, easing: 'ease-in-out' },
            ];
        } else if (preset === 'blur-settle') {
            presetKeyframes = [
                { id: `kf-${Date.now()}-blur-o-0`, time: 0, property: 'opacity', value: 0.25, easing: 'ease-out' },
                { id: `kf-${Date.now()}-blur-o-1`, time: 0.36, property: 'opacity', value: 1, easing: 'ease-out' },
                { id: `kf-${Date.now()}-blur-s-0`, time: 0, property: 'scale', value: 0.985, easing: 'ease-out' },
                { id: `kf-${Date.now()}-blur-s-1`, time: 0.36, property: 'scale', value: 1, easing: 'ease-in-out' },
                { id: `kf-${Date.now()}-blur-b-0`, time: 0, property: 'textBlur', value: 18, easing: 'ease-out' },
                { id: `kf-${Date.now()}-blur-b-1`, time: 0.36, property: 'textBlur', value: 0, easing: 'ease-in-out' },
            ];
        }

        setTimelineClips(timelineClips.map((entry) => entry.id === clip.id ? {
            ...clip,
            transform: nextTransform,
            keyframes: preset === 'clear' ? preservedKeyframes : [...preservedKeyframes, ...presetKeyframes],
            textConfig: {
                ...clip.textConfig,
                motionPreset: preset === 'clear' ? null : preset,
            },
        } : entry));
    }, [timelineClips]);

    const toggleTitleAutoContrast = useCallback((clipId: string, enabled: boolean) => {
        const clip = timelineClips.find((entry) => entry.id === clipId);
        if (!clip?.textConfig) return;
        setTimelineClips(timelineClips.map((entry) => entry.id === clip.id ? {
            ...clip,
            textConfig: {
                ...clip.textConfig,
                autoContrast: enabled,
            },
        } : entry));
    }, [timelineClips]);

    const updateSubtitleClipContent = useCallback((clipId: string, content: string) => {
        const clip = timelineClips.find((entry) => entry.id === clipId);
        if (!clip?.textConfig) return;
        setTimelineClips(timelineClips.map((entry) => entry.id === clip.id ? {
            ...clip,
            textConfig: {
                ...clip.textConfig,
                content: formatSubtitleText(content),
            },
        } : entry));
    }, [timelineClips]);

    const splitSubtitleClip = useCallback((clipId: string) => {
        const clip = timelineClips.find((entry) => entry.id === clipId);
        const segment = clip?.subtitleSegment;
        if (!clip || !segment || segment.words.length < 2) return;

        let splitIndex = Math.max(1, Math.floor(segment.words.length / 2));
        for (let index = splitIndex; index < segment.words.length - 1; index += 1) {
            if (/[,.!?;:]$/.test(segment.words[index].text)) {
                splitIndex = index + 1;
                break;
            }
        }

        const leftWords = segment.words.slice(0, splitIndex);
        const rightWords = segment.words.slice(splitIndex);
        if (leftWords.length === 0 || rightWords.length === 0) return;

        const groupBaseStart = clip.start - segment.startOffset;
        const leftClip = buildSubtitleClipFromWords(
            clip.mediaId,
            clip.trackId,
            groupBaseStart,
            segment.sourceClipId,
            segment.groupId,
            segment.segmentIndex,
            leftWords,
            {
                ...clip,
                textConfig: {
                    ...clip.textConfig!,
                    content: formatSubtitleText(leftWords.map((word) => word.text).join(' ')),
                },
            },
        );
        const rightClip = buildSubtitleClipFromWords(
            clip.mediaId,
            clip.trackId,
            groupBaseStart,
            segment.sourceClipId,
            segment.groupId,
            segment.segmentIndex + 1,
            rightWords,
            {
                ...clip,
                id: `clip-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
                textConfig: {
                    ...clip.textConfig!,
                    content: formatSubtitleText(rightWords.map((word) => word.text).join(' ')),
                },
            },
        );

        const nextClips = reindexSubtitleGroup(
            timelineClips
                .filter((entry) => entry.id !== clipId)
                .concat(leftClip, rightClip),
            segment.groupId,
        );
        setTimelineClips(nextClips);
        setSelectedClipId(leftClip.id);
    }, [timelineClips]);

    const mergeSubtitleClip = useCallback((clipId: string, direction: 'previous' | 'next') => {
        const clip = timelineClips.find((entry) => entry.id === clipId);
        const segment = clip?.subtitleSegment;
        if (!clip || !segment) return;

        const groupClips = timelineClips
            .filter((entry) => entry.subtitleSegment?.groupId === segment.groupId)
            .sort((a, b) => a.start - b.start);
        const currentIndex = groupClips.findIndex((entry) => entry.id === clipId);
        const neighbor = direction === 'previous' ? groupClips[currentIndex - 1] : groupClips[currentIndex + 1];
        if (!neighbor?.subtitleSegment) return;

        const first = direction === 'previous' ? neighbor : clip;
        const second = direction === 'previous' ? clip : neighbor;
        const groupBaseStart = first.start - (first.subtitleSegment?.startOffset || 0);
        const mergedWords = [...(first.subtitleSegment?.words || []), ...(second.subtitleSegment?.words || [])]
            .sort((a, b) => a.start - b.start);

        const mergedClip = buildSubtitleClipFromWords(
            first.mediaId,
            first.trackId,
            groupBaseStart,
            first.subtitleSegment?.sourceClipId || segment.sourceClipId,
            segment.groupId,
            first.subtitleSegment?.segmentIndex || 0,
            mergedWords,
            {
                ...first,
                textConfig: {
                    ...first.textConfig!,
                    content: formatSubtitleText(
                        [first.textConfig?.content, second.textConfig?.content]
                            .filter(Boolean)
                            .join(' ')
                            .replace(/\n/g, ' '),
                    ),
                },
            },
        );

        const nextClips = reindexSubtitleGroup(
            timelineClips
                .filter((entry) => entry.id !== first.id && entry.id !== second.id)
                .concat(mergedClip),
            segment.groupId,
        );
        setTimelineClips(nextClips);
        setSelectedClipId(mergedClip.id);
    }, [timelineClips]);

    const handleAddToTimeline = (mediaId: string) => {
        const media = mediaItems.find(m => m.id === mediaId);
        if (!media) return;
        appendMediaToTimeline(media);
    };

    const handleExportDesignCanvas = (dataUrl: string, name: string, sendToTimeline = false) => {
        const item: MediaItem = {
            id: `design-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
            name,
            type: 'image',
            url: dataUrl,
            source: 'generated',
            generatedBy: 'AI Design Canvas',
            duration: 5,
        };
        setMediaItems(prev => [...prev, item]);
        if (sendToTimeline) {
            appendMediaToTimeline(item);
        }
    };

    const handleGenerateDesignImage = (prompt: string, aspectRatio: '1:1' | '16:9' | '9:16' | '3:4') =>
        generateImageWithImagen(prompt, aspectRatio);

    const handleImportLibraryAsset = async (asset: LibraryAsset, options: LibraryImportOptions = {}) => {
        if (!asset.url) {
            alert('This library asset has no source URL.');
            return;
        }

        const mappedType = getLibraryAssetMediaType(asset);
        const shouldCollect = options.collectToProject ?? Boolean(projectPath && window.electron?.project);
        const canCollect = Boolean(shouldCollect && projectPath && window.electron?.project);

        if (shouldCollect && !canCollect) {
            alert('Save the project locally in the desktop app first to collect footage into the project folder. Importing by reference instead.');
        }

        let importedItem = mediaItems.find((item) =>
            item.type === mappedType && (
                item.originUrl === asset.url ||
                item.url === asset.url
            ),
        );

        if (canCollect && projectPath) {
            const needsCollection = !importedItem || importedItem.url === asset.url;
            if (needsCollection) {
                try {
                    const collected = await collectMediaIntoProject({
                        folderPath: projectPath,
                        item: {
                            id: importedItem?.id || `library-collect-${Date.now()}`,
                            name: asset.name || `${asset.projectName} Asset`,
                            type: mappedType,
                            url: asset.url,
                            source: asset.source === 'upload' ? 'upload' : 'generated',
                            generatedBy: asset.generatedBy || `${asset.projectName} Library`,
                            prompt: asset.prompt,
                            duration: mappedType === 'video' || mappedType === 'audio'
                                ? Math.max(MIN_TIMELINE_CLIP_DURATION, asset.duration || 5)
                                : undefined,
                        },
                    });

                    if (importedItem) {
                        importedItem = {
                            ...importedItem,
                            url: collected.url,
                            generatedBy: importedItem.generatedBy || asset.generatedBy || `${asset.projectName} Library`,
                            prompt: importedItem.prompt || asset.prompt,
                            duration: importedItem.duration || (mappedType === 'video' || mappedType === 'audio'
                                ? Math.max(MIN_TIMELINE_CLIP_DURATION, asset.duration || 5)
                                : undefined),
                            originUrl: asset.url,
                            originProjectPath: asset.projectPath || null,
                        };
                        setMediaItems(prev => prev.map((item) => item.id === importedItem!.id ? importedItem! : item));
                    } else {
                        importedItem = buildMediaItemFromLibraryAsset(asset, collected.url);
                        setMediaItems(prev => [...prev, importedItem!]);
                    }
                } catch (error) {
                    alert(error instanceof Error ? `Could not collect asset into project: ${error.message}` : 'Could not collect asset into project.');
                    if (!importedItem) return;
                }
            }
        }

        if (!importedItem) {
            importedItem = buildMediaItemFromLibraryAsset(asset, asset.url);
            setMediaItems(prev => [...prev, importedItem!]);
        }

        const wantsThreePointEdit = options.timelineIn !== undefined || options.timelineOut !== undefined || options.mode !== undefined;

        if (wantsThreePointEdit) {
            const editResult = performThreePointEditWithMedia(importedItem, {
                sourceIn: options.sourceIn,
                sourceOut: options.sourceOut,
                timelineIn: options.timelineIn,
                timelineOut: options.timelineOut,
                mode: options.mode,
                trackId: options.trackId,
            });
            if (!editResult.ok) {
                alert(editResult.message);
            }
            return;
        }

        if (options.addToTimeline) {
            appendMediaToTimeline(importedItem, {
                trackId: options.trackId,
                startTime: options.startTime,
                sourceIn: options.sourceIn,
                sourceOut: options.sourceOut,
            });
        }
    };

    const handleAnimateImage = useCallback((item: MediaItem) => {
        setVideoGenSeed(item);
        setActiveWorkspace('VIDEO_GEN');
    }, []);

    const handleDropMedia = (mediaId: string, trackId: string, time: number) => {
        const media = mediaItems.find(m => m.id === mediaId);
        const track = timelineTracks.find(t => t.id === trackId);

        if (!media || !track || track.isLocked) return;
        if (media.type === 'audio' && track.type !== 'audio') return;
        if (media.type !== 'audio' && track.type === 'audio') return;

        const sourceDuration = Math.max(MIN_TIMELINE_CLIP_DURATION, media.duration || 5);
        const newClip = normalizeClipTiming({
            id: `clip-${Date.now()}`,
            mediaId: media.id,
            trackId: track.id,
            start: time,
            end: time + sourceDuration,
            duration: sourceDuration,
            speed: 1,
            sourceIn: 0,
            sourceOut: sourceDuration,
            effect: null,
        });
        setActiveTrackId(track.id);
        setTimelineClips([...timelineClips, newClip]);
    };

    const handleDropLibraryAsset = async (asset: LibraryAsset, trackId: string, time: number) => {
        await handleImportLibraryAsset(asset, {
            addToTimeline: true,
            collectToProject: true,
            trackId,
            startTime: time,
            sourceIn: asset.trimInSeconds,
            sourceOut: asset.trimOutSeconds,
        });
    };

    const handleSmartFill = () => {
        const describeGapClip = (clip: TimelineClip | null, fallback: string) => {
            if (!clip) return fallback;
            const media = mediaItems.find((item) => item.id === clip.mediaId);
            if (!media) return fallback;
            return summarizeSmartFillText(media.prompt || media.name, fallback);
        };

        const videoTrackIds = timelineTracks
            .filter((track) => track.type === 'video')
            .map((track) => track.id);
        const unlockedVideoTracks = timelineTracks.filter((track) => track.type === 'video' && !track.isLocked);

        if (unlockedVideoTracks.length === 0) {
            alert('No unlocked video tracks found.');
            return;
        }

        const smartFillGaps: SmartFillGap[] = [];

        unlockedVideoTracks.forEach((track) => {
            const clips = timelineClips
                .filter((clip) => clip.trackId === track.id)
                .sort((a, b) => a.start - b.start);

            if (clips.length === 0) return;

            let cursor = 0;
            let prevClip: TimelineClip | null = null;
            const trackIndex = videoTrackIds.indexOf(track.id);
            const trackLabel = `V${trackIndex >= 0 ? trackIndex + 1 : 1}`;

            clips.forEach((clip) => {
                if (clip.start > cursor + SMART_FILL_MIN_GAP_SECONDS) {
                    const gapStart = cursor;
                    const gapEnd = clip.start;
                    smartFillGaps.push({
                        id: `${track.id}:${gapStart.toFixed(3)}:${gapEnd.toFixed(3)}`,
                        trackId: track.id,
                        trackLabel,
                        start: gapStart,
                        end: gapEnd,
                        duration: gapEnd - gapStart,
                        prevLabel: describeGapClip(prevClip, 'Fade in from black'),
                        nextLabel: describeGapClip(clip, 'Cut to black'),
                    });
                }
                cursor = Math.max(cursor, clip.end);
                prevClip = clip;
            });
        });

        if (smartFillGaps.length === 0) {
            alert(`No gaps longer than ${SMART_FILL_MIN_GAP_SECONDS.toFixed(1)}s found on unlocked video tracks.`);
            return;
        }

        smartFillGaps.sort((a, b) => {
            const trackA = timelineTracks.find((track) => track.id === a.trackId);
            const trackB = timelineTracks.find((track) => track.id === b.trackId);
            const priorityA = a.trackId === activeTrackId ? 0 : trackA?.isTargeted ? 1 : 2;
            const priorityB = b.trackId === activeTrackId ? 0 : trackB?.isTargeted ? 1 : 2;
            if (priorityA !== priorityB) return priorityA - priorityB;
            if (a.trackId !== b.trackId) {
                return videoTrackIds.indexOf(a.trackId) - videoTrackIds.indexOf(b.trackId);
            }
            return a.start - b.start;
        });

        const defaultGap = smartFillGaps[0];
        const defaultStyle: SmartFillStyle = 'bridge';
        const styleNotes = [
            storyBible.selectedStyle,
            storyBible.directorPersonaPrompt,
            storyBible.productionGuidelines,
        ]
            .filter(Boolean)
            .join(' ');

        setModalConfig({
            title: 'Gap Fill Assistant',
            description: smartFillGaps.length === 1
                ? `Found 1 fillable gap on ${defaultGap.trackLabel}. Choose a fill type or let the assistant auto-compose the prompt from story context.`
                : `Found ${smartFillGaps.length} fillable gaps across unlocked video tracks. Pick the gap, choose the fill type, then auto-compose or override the prompt.`,
            submitText: 'Generate Fill Shot',
            fields: [
                {
                    name: 'gapId',
                    label: 'Gap',
                    type: 'select',
                    options: smartFillGaps.map((gap) => ({ value: gap.id, label: buildSmartFillGapLabel(gap) })),
                    defaultValue: defaultGap.id,
                    required: true,
                },
                {
                    name: 'fillStyle',
                    label: 'Fill Type',
                    type: 'select',
                    options: SMART_FILL_STYLE_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
                    defaultValue: defaultStyle,
                    required: true,
                },
                {
                    name: 'model',
                    label: 'Model',
                    type: 'select',
                    options: [
                        { value: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast' },
                        { value: 'veo-3.1-generate-preview', label: 'Veo 3.1 HQ' },
                    ],
                    defaultValue: 'veo-3.1-fast-generate-preview',
                    required: true,
                },
                {
                    name: 'aspectRatio',
                    label: 'Aspect Ratio',
                    type: 'select',
                    options: [
                        { value: '16:9', label: '16:9 Landscape' },
                        { value: '9:16', label: '9:16 Vertical' },
                    ],
                    defaultValue: '16:9',
                    required: true,
                },
                {
                    name: 'promptMode',
                    label: 'Prompt Mode',
                    type: 'select',
                    options: [
                        { value: 'auto', label: 'Auto-compose from gap context' },
                        { value: 'manual', label: 'Use custom override below' },
                    ],
                    defaultValue: 'auto',
                    required: true,
                },
                {
                    name: 'prompt',
                    label: 'Custom Prompt Override',
                    type: 'textarea',
                    defaultValue: buildSmartFillPrompt({
                        gap: defaultGap,
                        fillStyle: defaultStyle,
                        projectTitle: storyBible.title,
                        projectLogline: storyBible.logline,
                        styleNotes,
                    }),
                },
            ],
            pricing: {
                label: 'Generation Cost',
                compute: (values) => {
                    const selectedGap = smartFillGaps.find((gap) => gap.id === values.gapId) || defaultGap;
                    const selectedModel = values.model || 'veo-3.1-fast-generate-preview';
                    return buildModalPricing({
                        provider: 'gemini',
                        kind: 'video',
                        model: selectedModel,
                        units: Math.max(3, Math.min(10, selectedGap.duration)),
                        detail: `Estimated from ${selectedGap.trackLabel} gap length (${selectedGap.duration.toFixed(1)}s).`,
                    });
                },
            },
        });

        setModalSubmitHandler(() => async (values: any) => {
            setModalConfig(null);
            try {
                const selectedGap = smartFillGaps.find((gap) => gap.id === values.gapId) || defaultGap;
                const fillStyle = SMART_FILL_STYLE_OPTIONS.some((option) => option.value === values.fillStyle)
                    ? values.fillStyle as SmartFillStyle
                    : defaultStyle;
                const model = values.model || 'veo-3.1-fast-generate-preview';
                const aspectRatio = values.aspectRatio === '9:16' ? '9:16' : '16:9';
                const useManualPrompt = values.promptMode === 'manual' && typeof values.prompt === 'string' && values.prompt.trim().length > 0;
                const prompt = useManualPrompt
                    ? values.prompt.trim()
                    : buildSmartFillPrompt({
                        gap: selectedGap,
                        fillStyle,
                        projectTitle: storyBible.title,
                        projectLogline: storyBible.logline,
                        styleNotes,
                    });

                const newItem = await generateVideoWithVeo(prompt, (msg) => console.log(msg), aspectRatio, undefined, model);
                setMediaItems((prev) => [...prev, newItem]);

                const placedDuration = Math.max(
                    MIN_TIMELINE_CLIP_DURATION,
                    Math.min(selectedGap.duration, newItem.duration || selectedGap.duration),
                );
                const newClip = normalizeClipTiming({
                    id: `fill-${Date.now()}`,
                    mediaId: newItem.id,
                    trackId: selectedGap.trackId,
                    start: selectedGap.start,
                    end: selectedGap.start + placedDuration,
                    duration: placedDuration,
                    speed: 1,
                    sourceIn: 0,
                    sourceOut: placedDuration,
                    effect: null,
                });

                setActiveTrackId(selectedGap.trackId);
                setTimelineClips([...timelineClips, newClip]);
            } catch (e) {
                handleAIError(e);
            }
        });
    };

    const handleAutoDuck = () => {
        const videoTracks = timelineTracks.filter(t => t.type === 'video');
        const videoClips = timelineClips.filter(c => videoTracks.some(t => t.id === c.trackId));
        const audioClips = timelineClips.filter(c => !videoTracks.some(t => t.id === c.trackId));

        if (videoClips.length === 0) return;

        const newAudioClips = audioClips.map(ac => {
            const baseKeyframes = (ac.keyframes || []).filter(k => k.property !== 'volume');
            const volumeKeyframes: Keyframe[] = [];

            const overlapping = videoClips.filter(vc => vc.start < ac.end && vc.end > ac.start);

            if (overlapping.length === 0) return { ...ac, keyframes: baseKeyframes };

            overlapping.sort((a, b) => a.start - b.start);

            const FADE_DURATION = 1.0;
            const DUCK_VOLUME = 0.2;

            if (overlapping[0].start > ac.start + FADE_DURATION) {
                volumeKeyframes.push({ id: `kf-start-${ac.id}`, time: 0, value: 1, property: 'volume', easing: 'linear' });
            }

            overlapping.forEach((vc, index) => {
                const relStart = Math.max(0, vc.start - ac.start);
                const relEnd = Math.min(ac.duration, vc.end - ac.start);

                const fadeOutStart = Math.max(0, relStart - FADE_DURATION);
                volumeKeyframes.push({ id: `kf-out-start-${index}-${ac.id}`, time: fadeOutStart, value: 1, property: 'volume', easing: 'linear' });
                volumeKeyframes.push({ id: `kf-out-end-${index}-${ac.id}`, time: relStart, value: DUCK_VOLUME, property: 'volume', easing: 'linear' });

                const fadeInEnd = Math.min(ac.duration, relEnd + FADE_DURATION);
                volumeKeyframes.push({ id: `kf-in-start-${index}-${ac.id}`, time: relEnd, value: DUCK_VOLUME, property: 'volume', easing: 'linear' });
                volumeKeyframes.push({ id: `kf-in-end-${index}-${ac.id}`, time: fadeInEnd, value: 1, property: 'volume', easing: 'linear' });
            });

            return { ...ac, keyframes: [...baseKeyframes, ...volumeKeyframes] };
        });

        setTimelineClips([...videoClips, ...newAudioClips]);
    };

    const updateClip = (updatedClip: TimelineClip) => {
        const normalized = normalizeClipTiming(updatedClip);
        setTimelineClips(timelineClips.map(c => c.id === updatedClip.id ? normalized : c));
    };

    const updateBatchClips = (updatedClips: TimelineClip[]) => {
        setTimelineClips(updatedClips.map(normalizeClipTiming));
    };

    const deleteClipFromTimeline = useCallback((clipId: string, options?: { ripple?: boolean }) => {
        const targetClip = timelineClips.find(c => c.id === clipId);
        if (!targetClip) return;

        if (options?.ripple) {
            const cutDuration = targetClip.end - targetClip.start;
            const nextClips = timelineClips
                .filter(c => c.id !== clipId)
                .map((clip) => {
                    if (clip.trackId !== targetClip.trackId || clip.start < targetClip.end) {
                        return clip;
                    }
                    const shiftedStart = Math.max(0, clip.start - cutDuration);
                    const shiftedEnd = Math.max(shiftedStart + 0.01, clip.end - cutDuration);
                    return normalizeClipTiming({
                        ...clip,
                        start: shiftedStart,
                        end: shiftedEnd,
                    });
                });
            setTimelineClips(nextClips);
        } else {
            setTimelineClips(timelineClips.filter(c => c.id !== clipId));
        }

        if (selectedClipId === clipId) {
            setSelectedClipId(null);
        }
    }, [timelineClips, selectedClipId]);

    const addTimelineClips = (clips: TimelineClip[]) => {
        if (clips.length === 0) return;
        setTimelineClips([...timelineClips, ...clips.map(normalizeClipTiming)]);
    };

    const addMediaItems = (items: MediaItem[]) => {
        if (items.length === 0) return;
        setMediaItems(prev => [...prev, ...items]);
    };

    const updateClipFilters = (clipId: string, filters: TimelineClip['filters']) => {
        setTimelineClips(timelineClips.map(c => c.id === clipId ? { ...c, filters } : c));
    };

    const applyCssEffectToClip = (clipId: string, effect: EffectType) => {
        setTimelineClips(
            timelineClips.map((clip) => (
                clip.id !== clipId
                    ? clip
                    : (() => {
                        const activeEffects = getClipEffectLayers(clip);
                        const existing = activeEffects.findIndex((entry) => entry.effect === effect);
                        const nextEffects = existing >= 0
                            ? activeEffects.filter((_, index) => index !== existing)
                            : [...activeEffects, createEffectLayer(effect)];
                        return syncClipEffectsLegacyField(clip, nextEffects);
                    })()
            )),
        );
    };

    const applyEffectStackToClip = (clipId: string, stackId: string) => {
        const stack = EFFECT_STACK_PRESETS.find((entry) => entry.id === stackId);
        if (!stack) return;
        const stackEffects = Array.isArray(stack.effects) && stack.effects.length > 0
            ? stack.effects
            : [{ effect: stack.baseEffect, intensity: 100 }];
        setTimelineClips(
            timelineClips.map((clip) => {
                if (clip.id !== clipId) return clip;
                const activeEffects = getClipEffectLayers(clip);
                const nextEffects = [...activeEffects];
                stackEffects.forEach((entry) => {
                    const normalized = normalizeEffectLayer({
                        id: createEffectLayerId(entry.effect),
                        effect: entry.effect,
                        intensity: entry.intensity ?? 100,
                        enabled: entry.enabled !== false,
                    });
                    const existingIndex = nextEffects.findIndex((candidate) => candidate.effect === normalized.effect);
                    if (existingIndex >= 0) {
                        nextEffects[existingIndex] = {
                            ...nextEffects[existingIndex],
                            intensity: normalized.intensity,
                            enabled: normalized.enabled,
                        };
                    } else {
                        nextEffects.push(normalized);
                    }
                });
                const mergedFilters = stack.filterOverrides
                    ? { ...normalizeFilters(clip.filters), ...stack.filterOverrides }
                    : clip.filters;
                return {
                    ...syncClipEffectsLegacyField(clip, nextEffects),
                    filters: mergedFilters,
                };
            }),
        );
    };

    const updateClipTransition = (clipId: string, transition: { type: TransitionType; duration: number } | null) => {
        setTimelineClips(timelineClips.map(c => c.id === clipId ? { ...c, transitionOut: transition || undefined } : c));
    };

    const updateTextConfig = (clipId: string, textConfig: TimelineClip['textConfig']) => {
        setTimelineClips(timelineClips.map(c => c.id === clipId ? { ...c, textConfig } : c));
    };

    const updateClipTransform = (clipId: string, transform: TimelineClip['transform']) => {
        setTimelineClips(timelineClips.map(c => c.id === clipId ? { ...c, transform } : c));
    };

    const updateChromaKeyConfig = (clipId: string, chromaKey: TimelineClip['chromaKey']) => {
        setTimelineClips(timelineClips.map(c => c.id === clipId ? { ...c, chromaKey } : c));
    };

    const handleSplitClip = (clipId: string, splitAt: number) => {
        const clip = timelineClips.find(c => c.id === clipId);
        if (!clip) return;
        if (splitAt <= clip.start || splitAt >= clip.end) return;

        const sourceIn = clip.sourceIn ?? 0;
        const sourceOut = clip.sourceOut ?? (sourceIn + clip.duration);
        const splitSourceAt = sourceIn + (splitAt - clip.start) * clip.speed;
        const firstDuration = Math.max(MIN_TIMELINE_CLIP_DURATION, splitSourceAt - sourceIn);
        const secondDuration = Math.max(MIN_TIMELINE_CLIP_DURATION, sourceOut - splitSourceAt);

        const firstClip = normalizeClipTiming({
            ...clip,
            end: splitAt,
            duration: firstDuration,
            sourceIn,
            sourceOut: splitSourceAt,
        });

        const secondClip = normalizeClipTiming({
            ...clip,
            id: `clip-${Date.now()}`,
            start: splitAt,
            duration: secondDuration,
            sourceIn: splitSourceAt,
            sourceOut,
        });

        setTimelineClips(timelineClips.map(c => c.id === clipId ? firstClip : c).concat(secondClip));
    };

    const simulateEditPlan = useCallback((plan: EditPlan, selectedOperationIds?: string[]): EditPlanApplyResult & {
        preview: EditPlanPreview;
        nextClips: TimelineClip[];
        nextSelectedClipId: string | null;
    } => {
        const operationsToApply = new Set(
            Array.isArray(selectedOperationIds) && selectedOperationIds.length > 0
                ? selectedOperationIds
                : plan.operations.map((operation) => operation.id),
        );
        const validTextPositions = new Set<EditPlanTextPosition>([
            'center',
            'top-left',
            'top-center',
            'top-right',
            'bottom-left',
            'bottom-center',
            'bottom-right',
        ]);
        const appliedOperationIds: string[] = [];
        const rejected: EditPlanApplyResult['rejected'] = [];
        const operationPreviews: EditPlanPreview['operationPreviews'] = [];
        let nextClips = [...timelineClips];
        let nextSelectedClipId = selectedClipId;

        const getClipIndex = (clipId: string) => nextClips.findIndex((clip) => clip.id === clipId);
        const getTrackById = (trackId: string) => timelineTracks.find((track) => track.id === trackId) || null;
        const overlapsAnyClip = (candidate: TimelineClip, ignoreClipId: string) =>
            nextClips.some((clip) =>
                clip.id !== ignoreClipId &&
                clip.trackId === candidate.trackId &&
                candidate.start < clip.end - 0.001 &&
                candidate.end > clip.start + 0.001,
            );
        const buildOperationTitle = (
            operation: EditPlanOperation,
            before?: EditPlanClipSnapshot | null,
            after?: EditPlanClipSnapshot | null,
        ) => {
            const reference = after || before;
            const clipLabel = reference ? `${reference.trackLabel} ${reference.label}` : operation.clipId;
            switch (operation.type) {
                case 'trim_clip':
                    return `Trim ${clipLabel}`;
                case 'move_clip':
                    return `Move ${clipLabel}`;
                case 'delete_clip':
                    return `${operation.ripple ? 'Ripple delete' : 'Delete'} ${clipLabel}`;
                case 'set_transition':
                    return `Transition ${clipLabel}`;
                case 'set_text_overlay':
                    return `Text overlay ${clipLabel}`;
                default:
                    return clipLabel;
            }
        };
        const pushPreview = (
            operation: EditPlanOperation,
            status: 'ready' | 'rejected',
            message: string,
            before?: EditPlanClipSnapshot | null,
            after?: EditPlanClipSnapshot | null,
        ) => {
            operationPreviews.push({
                operationId: operation.id,
                status,
                title: buildOperationTitle(operation, before, after),
                message,
                before,
                after,
            });
        };
        const rejectOperation = (operation: EditPlanOperation, message: string, before?: EditPlanClipSnapshot | null, after?: EditPlanClipSnapshot | null) => {
            rejected.push({ operationId: operation.id, message });
            pushPreview(operation, 'rejected', message, before, after);
        };
        const acceptOperation = (operation: EditPlanOperation, before?: EditPlanClipSnapshot | null, after?: EditPlanClipSnapshot | null) => {
            appliedOperationIds.push(operation.id);
            pushPreview(operation, 'ready', operation.reason, before, after);
        };

        for (const operation of plan.operations) {
            if (!operationsToApply.has(operation.id)) continue;

            const clipIndex = getClipIndex(operation.clipId);
            if (clipIndex < 0) {
                rejectOperation(operation, `Clip ${operation.clipId} no longer exists.`);
                continue;
            }

            const clip = nextClips[clipIndex];
            const beforeSnapshot = createEditPlanClipSnapshot(clip);
            const currentTrack = getTrackById(clip.trackId);
            if (!currentTrack || currentTrack.isLocked) {
                rejectOperation(operation, `Track ${clip.trackId} is locked or unavailable.`, beforeSnapshot);
                continue;
            }

            if (operation.type === 'trim_clip') {
                const requestedStart = typeof operation.start === 'number' ? operation.start : clip.start;
                const requestedEnd = typeof operation.end === 'number' ? operation.end : clip.end;
                if (requestedStart < clip.start - 0.001 || requestedEnd > clip.end + 0.001) {
                    rejectOperation(operation, 'Phase 1 trim operations may only shorten clips.', beforeSnapshot);
                    continue;
                }
                if (requestedEnd - requestedStart < MIN_TIMELINE_CLIP_DURATION) {
                    rejectOperation(operation, 'Trim would create an invalid clip duration.', beforeSnapshot);
                    continue;
                }

                const speed = Math.max(0.05, clip.speed || 1);
                const currentSourceIn = clip.sourceIn ?? 0;
                const currentSourceOut = clip.sourceOut ?? (currentSourceIn + Math.max(MIN_TIMELINE_CLIP_DURATION, clip.duration || (clip.end - clip.start)));
                const newSourceIn = currentSourceIn + Math.max(0, requestedStart - clip.start) * speed;
                const newSourceOut = currentSourceOut - Math.max(0, clip.end - requestedEnd) * speed;
                const candidate = normalizeClipTiming({
                    ...clip,
                    start: requestedStart,
                    end: requestedEnd,
                    duration: requestedEnd - requestedStart,
                    sourceIn: newSourceIn,
                    sourceOut: newSourceOut,
                });

                if (overlapsAnyClip(candidate, clip.id)) {
                    rejectOperation(operation, 'Trim would create an overlap on the same track.', beforeSnapshot);
                    continue;
                }

                nextClips[clipIndex] = candidate;
                nextSelectedClipId = candidate.id;
                acceptOperation(operation, beforeSnapshot, createEditPlanClipSnapshot(candidate));
                continue;
            }

            if (operation.type === 'move_clip') {
                const media = mediaItems.find((item) => item.id === clip.mediaId) || null;
                const targetTrackId = operation.trackId || clip.trackId;
                const targetTrack = getTrackById(targetTrackId);
                if (!targetTrack || targetTrack.isLocked) {
                    rejectOperation(operation, `Target track ${targetTrackId} is locked or unavailable.`, beforeSnapshot);
                    continue;
                }
                if (media && getTrackTypeForMedia(media) !== targetTrack.type) {
                    rejectOperation(operation, `Target track ${targetTrackId} is incompatible with ${media.type} media.`, beforeSnapshot);
                    continue;
                }

                const sequenceDuration = Math.max(MIN_TIMELINE_CLIP_DURATION, clip.end - clip.start);
                const start = Math.max(0, operation.start);
                const candidate = normalizeClipTiming({
                    ...clip,
                    trackId: targetTrackId,
                    start,
                    end: start + sequenceDuration,
                    duration: sequenceDuration,
                });

                if (overlapsAnyClip(candidate, clip.id)) {
                    rejectOperation(operation, 'Move would overlap another clip on the target track.', beforeSnapshot);
                    continue;
                }

                nextClips[clipIndex] = candidate;
                nextSelectedClipId = candidate.id;
                acceptOperation(operation, beforeSnapshot, createEditPlanClipSnapshot(candidate));
                continue;
            }

            if (operation.type === 'delete_clip') {
                const cutDuration = Math.max(MIN_TIMELINE_CLIP_DURATION, clip.end - clip.start);
                if (operation.ripple) {
                    nextClips = nextClips
                        .filter((entry) => entry.id !== clip.id)
                        .map((entry) => {
                            if (entry.trackId !== clip.trackId || entry.start < clip.end) {
                                return entry;
                            }
                            return normalizeClipTiming({
                                ...entry,
                                start: Math.max(0, entry.start - cutDuration),
                                end: Math.max(MIN_TIMELINE_CLIP_DURATION, entry.end - cutDuration),
                            });
                        });
                } else {
                    nextClips = nextClips.filter((entry) => entry.id !== clip.id);
                }
                if (nextSelectedClipId === clip.id) {
                    nextSelectedClipId = null;
                }
                acceptOperation(operation, beforeSnapshot, null);
                continue;
            }

            if (operation.type === 'set_transition') {
                const maxTransition = Math.max(0.1, Math.min(2.5, (clip.end - clip.start) - 0.05));
                const duration = clampNumber(
                    typeof operation.transitionDuration === 'number' ? operation.transitionDuration : (clip.transitionOut?.duration || 0.35),
                    0.1,
                    maxTransition,
                );
                const candidate = {
                    ...clip,
                    transitionOut: { type: operation.transitionType, duration },
                };
                nextClips[clipIndex] = candidate;
                nextSelectedClipId = clip.id;
                acceptOperation(operation, beforeSnapshot, createEditPlanClipSnapshot(candidate));
                continue;
            }

            if (operation.type === 'set_text_overlay') {
                const content = (operation.textContent || '').trim();
                if (!content) {
                    rejectOperation(operation, 'Text overlay content is empty.', beforeSnapshot);
                    continue;
                }
                const color = typeof operation.textColor === 'string' && /^#(?:[0-9a-f]{3}){1,2}$/i.test(operation.textColor.trim())
                    ? operation.textColor.trim()
                    : '#FFFFFF';
                const position = typeof operation.textPosition === 'string' && validTextPositions.has(operation.textPosition)
                    ? operation.textPosition
                    : 'center';
                const size = clampNumber(typeof operation.textSize === 'number' ? operation.textSize : (clip.textConfig?.size || 48), 18, 160);

                const candidate = {
                    ...clip,
                    textConfig: {
                        content,
                        font: clip.textConfig?.font || 'Arial',
                        size,
                        color,
                        position,
                    },
                };
                nextClips[clipIndex] = candidate;
                nextSelectedClipId = clip.id;
                acceptOperation(operation, beforeSnapshot, createEditPlanClipSnapshot(candidate));
            }
        }

        const normalizedNextClips = nextClips.map(normalizeClipTiming);
        const readyOperationIds = operationPreviews
            .filter((entry) => entry.status === 'ready')
            .map((entry) => entry.operationId);
        const rejectedOperationIds = operationPreviews
            .filter((entry) => entry.status === 'rejected')
            .map((entry) => entry.operationId);
        const touchedClipIds = Array.from(
            new Set(
                operationPreviews.flatMap((entry) => [
                    entry.before?.clipId,
                    entry.after?.clipId,
                ].filter((value): value is string => Boolean(value))),
            ),
        );
        const totalDurationDelta = operationPreviews.reduce((sum, entry) => {
            if (entry.status !== 'ready') return sum;
            return sum + ((entry.after?.duration || 0) - (entry.before?.duration || 0));
        }, 0);

        return {
            appliedOperationIds,
            rejected,
            preview: {
                operationPreviews,
                readyOperationIds,
                rejectedOperationIds,
                totalDurationDelta,
                touchedClipIds,
            },
            nextClips: normalizedNextClips,
            nextSelectedClipId,
        };
    }, [createEditPlanClipSnapshot, mediaItems, normalizeClipTiming, selectedClipId, timelineClips, timelineTracks]);

    const previewEditPlan = useCallback((plan: EditPlan, selectedOperationIds?: string[]): EditPlanPreview => {
        return simulateEditPlan(plan, selectedOperationIds).preview;
    }, [simulateEditPlan]);

    const applyEditPlan = useCallback((plan: EditPlan, selectedOperationIds?: string[]): EditPlanApplyResult => {
        const simulation = simulateEditPlan(plan, selectedOperationIds);
        if (simulation.appliedOperationIds.length > 0) {
            setTimelineClips(simulation.nextClips);
            setSelectedClipId(simulation.nextSelectedClipId);
            setLastAgentApplyBatch({
                id: `agent-batch-${Date.now()}`,
                label: `${simulation.appliedOperationIds.length} agent edit${simulation.appliedOperationIds.length === 1 ? '' : 's'}`,
                operationCount: simulation.appliedOperationIds.length,
                createdAt: new Date().toISOString(),
                beforeSignature: currentTimelineSignature,
                afterSignature: buildTimelineSignature(simulation.nextClips),
                previousSelectedClipId: selectedClipId,
                nextSelectedClipId: simulation.nextSelectedClipId,
            });
        }
        return {
            appliedOperationIds: simulation.appliedOperationIds,
            rejected: simulation.rejected,
        };
    }, [buildTimelineSignature, currentTimelineSignature, selectedClipId, setTimelineClips, simulateEditPlan]);

    const canUndoLastAgentApply = Boolean(
        lastAgentApplyBatch &&
        canUndoTimelineClips &&
        lastAgentApplyBatch.afterSignature === currentTimelineSignature,
    );

    const undoLastAgentApply = useCallback(() => {
        if (!canUndoLastAgentApply || !lastAgentApplyBatch) return;
        lastHistoryDomainRef.current = 'timeline';
        undoTimelineClips();
        setSelectedClipId(lastAgentApplyBatch.previousSelectedClipId || null);
        setLastAgentApplyBatch(null);
    }, [canUndoLastAgentApply, lastAgentApplyBatch, undoTimelineClips]);

    const runAgentReviewPass = useCallback(async (objective: string): Promise<AgentReviewPassResult> => {
        if (timelineClips.length === 0) {
            throw new Error('Add clips to the timeline before running a review pass.');
        }
        if (!(localStorage.getItem('gemini_api_key') || process.env.API_KEY)) {
            throw new Error('Add a Gemini API key in Settings to run the review pass.');
        }

        const draftShots = buildTimelineDraftShotList({ mediaItems, timelineClips, timelineTracks });
        let reviewFeedback: ReviewFeedback | null = null;
        let renderedAnalysis: NeurocinematicsAnalysisResult | null = null;
        let usedRenderedDraft = false;
        let draftOutputPath: string | null = null;
        let draftPreviewUrl: string | null = null;
        let note: string | null = null;

        reviewFeedback = await analyzeProjectDraft(
            storyBible.script || storyBible.logline || '',
            storyBible.productionGuidelines || '',
            draftShots,
        );

        const canRenderDraft = typeof window !== 'undefined'
            && Boolean(window.electron?.project?.exportVideo)
            && Boolean(window.electron?.project?.readFile)
            && Boolean(projectPath);

        if (canRenderDraft && projectPath) {
            try {
                const filename = `agent-review-${Date.now()}.mp4`;
                const renderResult = await window.electron.project.exportVideo({
                    folderPath: projectPath,
                    project: {
                        timelineClips,
                        timelineTracks,
                        mediaItems,
                    },
                    settings: {
                        filename,
                        width: 1280,
                        height: 720,
                        fps: 24,
                        bitrateKbps: 8000,
                        gpuAcceleration: 'auto',
                    },
                });

                if (!renderResult.ok || !renderResult.outputPath) {
                    throw new Error(renderResult.error || 'Draft render failed.');
                }

                draftOutputPath = renderResult.outputPath;
                const bytes = await window.electron.project.readFile!({ filePath: draftOutputPath });
                const safeBytes = new Uint8Array(bytes.byteLength);
                safeBytes.set(bytes);
                const blob = new Blob([safeBytes.buffer], { type: 'video/mp4' });
                draftPreviewUrl = URL.createObjectURL(blob);
                const draftFile = new File([blob], filename, { type: 'video/mp4' });
                renderedAnalysis = await analyzeVideoWithNeurocinematics(
                    draftFile,
                    storyBible.script || storyBible.logline || '',
                    undefined,
                    'gemini-3.1-flash-preview',
                );
                setAnalysisResult(renderedAnalysis);
                usedRenderedDraft = true;
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                note = `Rendered draft review fell back to timeline-only mode: ${reason}`;
            }
        } else {
            note = 'Rendered draft review requires the desktop app with a saved project. Used timeline-only review context instead.';
        }

        const plan = await generateEditPlan({
            objective: buildReviewDrivenObjective(objective, reviewFeedback, renderedAnalysis || analysisResult),
            mediaItems,
            timelineClips,
            timelineTracks,
            selectedClipId,
            projectName: projectName || storyBible.title || null,
            storyContext: [
                storyBible.logline,
                storyBible.plotBeats,
                storyBible.productionGuidelines,
                reviewFeedback?.summary ? `Draft review: ${reviewFeedback.summary}` : '',
            ].filter(Boolean).join('\n\n') || null,
            analysisResult: renderedAnalysis || analysisResult,
            playheadPosition,
        });

        return {
            plan,
            reviewFeedback,
            analysisResult: renderedAnalysis,
            usedRenderedDraft,
            draftOutputPath,
            draftPreviewUrl,
            note,
        };
    }, [analysisResult, mediaItems, playheadPosition, projectPath, projectName, selectedClipId, storyBible.logline, storyBible.plotBeats, storyBible.productionGuidelines, storyBible.script, storyBible.title, timelineClips, timelineTracks]);

    const performThreePointEditWithMedia = useCallback((media: MediaItem, params: {
        sourceIn?: number | null;
        sourceOut?: number | null;
        timelineIn?: number | null;
        timelineOut?: number | null;
        mode?: 'insert' | 'overwrite';
        trackId?: string | null;
    }) => {
        const trackType = getTrackTypeForMedia(media);
        const targetTrack = params.trackId
            ? timelineTracks.find((track) => track.id === params.trackId && !track.isLocked && track.type === trackType) || null
            : pickTimelineTrack(trackType);
        if (!targetTrack) {
            return { ok: false as const, message: `No unlocked ${trackType} track available.` };
        }

        const hasSourceIn = params.sourceIn !== null && params.sourceIn !== undefined;
        const hasSourceOut = params.sourceOut !== null && params.sourceOut !== undefined;
        const hasTimelineIn = params.timelineIn !== null && params.timelineIn !== undefined;
        const hasTimelineOut = params.timelineOut !== null && params.timelineOut !== undefined;
        const definedPoints = [hasSourceIn, hasSourceOut, hasTimelineIn, hasTimelineOut].filter(Boolean).length;
        if (definedPoints < 3) {
            return { ok: false as const, message: '3-point edit requires at least three points (Source In/Out + Program In/Out).' };
        }

        const mediaDuration = Math.max(MIN_TIMELINE_CLIP_DURATION, media.duration || 5);
        let sourceIn = clampNumber(Number(params.sourceIn ?? 0), 0, mediaDuration - MIN_TIMELINE_CLIP_DURATION);
        let sourceOut = clampNumber(Number(params.sourceOut ?? mediaDuration), sourceIn + MIN_TIMELINE_CLIP_DURATION, mediaDuration);
        let sourceRange = Math.max(MIN_TIMELINE_CLIP_DURATION, sourceOut - sourceIn);

        let timelineIn = Math.max(0, Number(params.timelineIn ?? playheadPosition));
        let timelineOut = Math.max(timelineIn + MIN_TIMELINE_CLIP_DURATION, Number(params.timelineOut ?? (timelineIn + sourceRange)));

        if (hasTimelineIn && hasTimelineOut) {
            const sequenceRange = Math.max(MIN_TIMELINE_CLIP_DURATION, timelineOut - timelineIn);
            if (hasSourceIn && hasSourceOut) {
                sourceOut = clampNumber(sourceIn + sequenceRange, sourceIn + MIN_TIMELINE_CLIP_DURATION, mediaDuration);
            } else if (hasSourceIn) {
                sourceOut = clampNumber(sourceIn + sequenceRange, sourceIn + MIN_TIMELINE_CLIP_DURATION, mediaDuration);
            } else if (hasSourceOut) {
                sourceIn = clampNumber(sourceOut - sequenceRange, 0, sourceOut - MIN_TIMELINE_CLIP_DURATION);
            } else {
                sourceOut = clampNumber(sourceIn + sequenceRange, sourceIn + MIN_TIMELINE_CLIP_DURATION, mediaDuration);
            }
        } else if (hasTimelineOut && !hasTimelineIn) {
            timelineIn = Math.max(0, timelineOut - sourceRange);
        } else {
            timelineOut = timelineIn + sourceRange;
        }

        sourceRange = Math.max(MIN_TIMELINE_CLIP_DURATION, sourceOut - sourceIn);
        const insertDuration = Math.max(MIN_TIMELINE_CLIP_DURATION, timelineOut - timelineIn);
        const mode = params.mode === 'overwrite' ? 'overwrite' : 'insert';

        const makeSourceTimeAt = (clip: TimelineClip, timelineTime: number) => {
            const clipSourceIn = clip.sourceIn ?? 0;
            const clipSourceOut = clip.sourceOut ?? (clipSourceIn + clip.duration);
            const clipSpeed = Math.max(0.05, clip.speed || 1);
            const sourceTime = clipSourceIn + (timelineTime - clip.start) * clipSpeed;
            return clampNumber(sourceTime, clipSourceIn, clipSourceOut);
        };

        const insertedClip = normalizeClipTiming({
            id: `clip-${Date.now()}`,
            mediaId: media.id,
            trackId: targetTrack.id,
            start: timelineIn,
            end: timelineIn + insertDuration,
            duration: sourceRange,
            speed: sourceRange / insertDuration,
            sourceIn,
            sourceOut,
            effect: null,
        });

        let nextClips: TimelineClip[] = [];

        if (mode === 'insert') {
            for (const clip of timelineClips) {
                if (clip.trackId !== targetTrack.id) {
                    nextClips.push(clip);
                    continue;
                }

                if (clip.start < timelineIn && clip.end > timelineIn) {
                    const splitSource = makeSourceTimeAt(clip, timelineIn);
                    const leftClip = normalizeClipTiming({
                        ...clip,
                        end: timelineIn,
                        sourceOut: splitSource,
                    });
                    const rightClip = normalizeClipTiming({
                        ...clip,
                        id: `clip-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
                        start: timelineIn + insertDuration,
                        end: clip.end + insertDuration,
                        sourceIn: splitSource,
                    });
                    nextClips.push(leftClip, rightClip);
                    continue;
                }

                if (clip.start >= timelineIn) {
                    nextClips.push(normalizeClipTiming({
                        ...clip,
                        start: clip.start + insertDuration,
                        end: clip.end + insertDuration,
                    }));
                    continue;
                }

                nextClips.push(clip);
            }
        } else {
            for (const clip of timelineClips) {
                if (clip.trackId !== targetTrack.id) {
                    nextClips.push(clip);
                    continue;
                }
                const overlaps = clip.start < timelineOut && clip.end > timelineIn;
                if (!overlaps) {
                    nextClips.push(clip);
                    continue;
                }

                const leftOverlap = clip.start < timelineIn;
                const rightOverlap = clip.end > timelineOut;
                if (leftOverlap && rightOverlap) {
                    const splitInSource = makeSourceTimeAt(clip, timelineIn);
                    const splitOutSource = makeSourceTimeAt(clip, timelineOut);
                    const leftClip = normalizeClipTiming({
                        ...clip,
                        end: timelineIn,
                        sourceOut: splitInSource,
                    });
                    const rightClip = normalizeClipTiming({
                        ...clip,
                        id: `clip-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
                        start: timelineOut,
                        sourceIn: splitOutSource,
                    });
                    nextClips.push(leftClip, rightClip);
                    continue;
                }
                if (leftOverlap) {
                    const splitSource = makeSourceTimeAt(clip, timelineIn);
                    nextClips.push(normalizeClipTiming({
                        ...clip,
                        end: timelineIn,
                        sourceOut: splitSource,
                    }));
                    continue;
                }
                if (rightOverlap) {
                    const splitSource = makeSourceTimeAt(clip, timelineOut);
                    nextClips.push(normalizeClipTiming({
                        ...clip,
                        start: timelineOut,
                        sourceIn: splitSource,
                    }));
                }
            }
        }

        nextClips.push(insertedClip);
        setActiveTrackId(targetTrack.id);
        setTimelineClips(nextClips);
        setSelectedClipId(insertedClip.id);
        setPlayheadPosition(insertedClip.start);
        return { ok: true as const, message: `${mode === 'insert' ? 'Insert' : 'Overwrite'} edit placed on ${trackType} track.` };
    }, [playheadPosition, timelineClips, timelineTracks]);

    const handleThreePointEdit = useCallback((params: {
        mediaId: string;
        sourceIn?: number | null;
        sourceOut?: number | null;
        timelineIn?: number | null;
        timelineOut?: number | null;
        mode?: 'insert' | 'overwrite';
        trackId?: string;
    }) => {
        const media = mediaItems.find((item) => item.id === params.mediaId);
        if (!media) return { ok: false as const, message: 'Source media not found.' };
        return performThreePointEditWithMedia(media, params);
    }, [mediaItems, performThreePointEditWithMedia]);

    const togglePlayback = useCallback(() => {
        const totalDuration = timelineClips.length > 0 ? Math.max(...timelineClips.map(c => c.end), 0) : 0;
        if (!isPlaying && totalDuration > 0 && playheadPosition >= totalDuration) {
            setPlayheadPosition(0);
        }
        setIsPlaying(prev => !prev);
    }, [timelineClips, isPlaying, playheadPosition]);

    // --- Director Mode Tools (Gemini Live) ---

    const directorTools: FunctionDeclaration[] = [
        {
            name: 'splitClip',
            description: 'Split the currently selected clip at the current playhead position.',
            parameters: { type: Type.OBJECT, properties: {}, },
        },
        {
            name: 'togglePlayback',
            description: 'Play or pause the video preview.',
            parameters: { type: Type.OBJECT, properties: {}, },
        },
        {
            name: 'deleteSelectedClip',
            description: 'Delete the currently selected clip from the timeline.',
            parameters: { type: Type.OBJECT, properties: {}, },
        },
        {
            name: 'zoomIn',
            description: 'Apply a Ken Burns zoom effect to the selected clip.',
            parameters: { type: Type.OBJECT, properties: {}, },
        },
        {
            name: 'muteMusic',
            description: 'Mute all audio tracks.',
            parameters: { type: Type.OBJECT, properties: {}, },
        },
        {
            name: 'autoMix',
            description: 'Automatically lower music volume when video/speech is playing (audio ducking).',
            parameters: { type: Type.OBJECT, properties: {}, },
        }
    ];

    const directorToolExecutor = {
        splitClip: () => {
            if (selectedClipId) {
                handleSplitClip(selectedClipId, playheadPosition);
                return { success: true, message: "Clip split." };
            }
            return { success: false, message: "No clip selected." };
        },
        togglePlayback: () => {
            const willPlay = !isPlaying;
            togglePlayback();
            return { success: true, message: willPlay ? "Playing." : "Paused." };
        },
        deleteSelectedClip: () => {
            if (selectedClipId) {
                deleteClipFromTimeline(selectedClipId);
                return { success: true, message: "Clip deleted." };
            }
            return { success: false, message: "No clip selected." };
        },
        zoomIn: () => {
            if (selectedClipId) {
                setTimelineClips(timelineClips.map(c => c.id === selectedClipId ? {
                    ...c,
                    kenBurns: { enabled: true, start: { scale: 1, x: 0, y: 0 }, end: { scale: 1.5, x: 0, y: 0 } }
                } : c));
                return { success: true, message: "Zoom effect applied." };
            }
            return { success: false, message: "No clip selected." };
        },
        muteMusic: () => {
            const newTracks = timelineTracks.map(t => t.type === 'audio' ? { ...t, isMuted: true } : t);
            setTimelineTracks(newTracks);
            return { success: true, message: "Music tracks muted." };
        },
        autoMix: () => {
            handleAutoDuck();
            return { success: true, message: "Auto-ducking applied to audio tracks." };
        }
    };

    useEffect(() => {
        const handleUndoRedoKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.altKey) return;
            if (isTypingTarget(event.target)) return;
            if (!event.metaKey && !event.ctrlKey) return;

            const key = event.key.toLowerCase();
            if (key === 'z' && event.shiftKey) {
                if (!canRedo) return;
                event.preventDefault();
                redo();
                return;
            }
            if (key === 'z') {
                if (!canUndo) return;
                event.preventDefault();
                undo();
                return;
            }
            if (key === 'y' && !event.shiftKey) {
                if (!canRedo) return;
                event.preventDefault();
                redo();
            }
        };

        window.addEventListener('keydown', handleUndoRedoKeyDown);
        return () => window.removeEventListener('keydown', handleUndoRedoKeyDown);
    }, [canRedo, canUndo, redo, undo]);

    useEffect(() => {
        if (activeWorkspace !== 'EDIT') return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
            if (isTypingTarget(event.target)) return;
            const key = event.key.toLowerCase();
            const totalDuration = timelineClips.length > 0 ? Math.max(...timelineClips.map(c => c.end), 0) : 0;
            const activeTrack = activeTrackId
                ? timelineTracks.find((track) => track.id === activeTrackId) || null
                : null;

            if (event.altKey) {
                const toggleTrackFlag = (trackId: string | null, field: 'isLocked' | 'isMuted' | 'isSolo') => {
                    if (!trackId) return;
                    setTimelineTracks((prev) => prev.map((track) => (
                        track.id === trackId ? { ...track, [field]: !track[field] } : track
                    )));
                };

                if (key === 'arrowup' || key === 'arrowdown') {
                    event.preventDefault();
                    if (timelineTracks.length === 0) return;
                    const currentIndex = timelineTracks.findIndex((track) => track.id === activeTrackId);
                    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
                    const nextIndex = key === 'arrowup'
                        ? Math.max(0, safeIndex - 1)
                        : Math.min(timelineTracks.length - 1, safeIndex + 1);
                    setActiveTrackId(timelineTracks[nextIndex].id);
                    return;
                }

                if (key === 's') {
                    event.preventDefault();
                    toggleTrackFlag(activeTrack?.id || null, 'isSolo');
                    return;
                }
                if (key === 'm') {
                    event.preventDefault();
                    toggleTrackFlag(activeTrack?.id || null, 'isMuted');
                    return;
                }
                if (key === 'l') {
                    event.preventDefault();
                    toggleTrackFlag(activeTrack?.id || null, 'isLocked');
                    return;
                }
                if (key === 'v' || key === 'a') {
                    event.preventDefault();
                    const targetType = key === 'v' ? 'video' : 'audio';
                    const firstTrack = timelineTracks.find((track) => track.type === targetType);
                    if (!firstTrack) return;
                    setTimelineTracks((prev) => prev.map((track) => (
                        track.id === firstTrack.id
                            ? { ...track, isTargeted: !(track.isTargeted ?? false) }
                            : track
                    )));
                    setActiveTrackId(firstTrack.id);
                    return;
                }
                return;
            }

            if (key === ' ') {
                event.preventDefault();
                togglePlayback();
                return;
            }

            if (key === 'k') {
                event.preventDefault();
                setIsPlaying(false);
                return;
            }

            if (key === 'j' || key === 'l') {
                event.preventDefault();
                const shuttle = event.shiftKey ? 5 : 1;
                setIsPlaying(false);
                if (key === 'j') {
                    setPlayheadPosition(prev => Math.max(0, prev - shuttle));
                } else {
                    setPlayheadPosition(prev => Math.min(totalDuration, prev + shuttle));
                }
                return;
            }

            if (/^[1-7]$/.test(key)) {
                const stageMap: Record<string, Workspace> = {
                    '1': 'IMPORT',
                    '2': 'TRIM',
                    '3': 'EDIT',
                    '4': 'COMPOSITING',
                    '5': 'POST',
                    '6': 'SOUND',
                    '7': 'EXPORT',
                };
                const target = stageMap[key];
                if (target && canAccessWorkspace(target)) {
                    event.preventDefault();
                    setActiveWorkspace(target);
                }
                return;
            }

            if (key === 'c') {
                event.preventDefault();
                const clipId = selectedClipId || timelineClips.find(c => playheadPosition >= c.start && playheadPosition <= c.end)?.id;
                if (clipId) {
                    handleSplitClip(clipId, playheadPosition);
                }
                return;
            }

            if (key === 'v') {
                event.preventDefault();
                setEditTrimMode('normal');
                return;
            }

            if (key === 'r') {
                event.preventDefault();
                setEditTrimMode('ripple');
                return;
            }

            if (key === 'o') {
                event.preventDefault();
                setEditTrimMode('roll');
                return;
            }

            if (key === 'y') {
                event.preventDefault();
                setEditTrimMode('slip');
                return;
            }

            if (key === 'u') {
                event.preventDefault();
                setEditTrimMode('slide');
                return;
            }

            if (key === 't') {
                event.preventDefault();
                if (selectedClipId) {
                    setActiveWorkspace('TRIM');
                }
                return;
            }

            if (key === 'backspace' || key === 'delete') {
                event.preventDefault();
                if (selectedClipId) {
                    deleteClipFromTimeline(selectedClipId, { ripple: event.shiftKey });
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [activeWorkspace, selectedClipId, playheadPosition, timelineClips, timelineTracks, activeTrackId, togglePlayback, deleteClipFromTimeline, canAccessWorkspace]);

    useEffect(() => {
        const handleGlobalKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;

            if (isTypingTarget(event.target)) return;

            const match = SHORTCUT_DEFINITIONS.find((definition) => {
                const combo = shortcuts[definition.id];
                return combo && matchesShortcut(event, combo);
            });
            if (!match) return;

            event.preventDefault();
            const action = match.id as ShortcutAction;

            switch (action) {
                case 'toggle_pricing':
                    setShowPricing((prev) => !prev);
                    break;
                case 'open_settings':
                    setShowSettings(true);
                    break;
                case 'open_design_system':
                    if (canOpenDesignSystem) setShowDesignSystem(true);
                    break;
                case 'open_about':
                    setShowAbout(true);
                    break;
                case 'workspace_project':
                    if (canAccessWorkspace('PROJECT')) setActiveWorkspace('PROJECT');
                    break;
                case 'workspace_edit':
                    if (canAccessWorkspace('EDIT')) setActiveWorkspace('EDIT');
                    break;
                case 'workspace_review':
                    if (canAccessWorkspace('REVIEW')) setActiveWorkspace('REVIEW');
                    break;
                case 'workspace_requests':
                    if (canAccessWorkspace('REQUESTS')) setActiveWorkspace('REQUESTS');
                    break;
                default:
                    break;
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [shortcuts, canAccessWorkspace, canOpenDesignSystem]);

    useEffect(() => {
        if (!isAssistantVisible) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsAssistantVisible(false);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isAssistantVisible]);

    const addMoodboardResearchItems = useCallback((
        items: Array<{
            url: string;
            title?: string;
            sourceUrl?: string;
            sourceLabel?: string;
            sourceType?: 'upload' | 'search' | 'web' | 'video_frame' | 'library';
            query?: string;
        }>,
        categoryId?: string
    ) => {
        let added = 0;
        const requestedCategoryId = (categoryId || '').trim();
        setStoryBible((prev) => {
            const categorized = prev.categorizedMoodboard || createDefaultCategorizedMoodboard();
            const fallbackCategoryId = categorized.categories.some((cat) => cat.id === 'uncategorized')
                ? 'uncategorized'
                : (categorized.categories[0]?.id || 'uncategorized');
            const resolvedCategoryId = requestedCategoryId && categorized.categories.some((cat) => cat.id === requestedCategoryId)
                ? requestedCategoryId
                : fallbackCategoryId;
            const now = new Date().toISOString();
            const batchToken = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
            const nextItems = (items || [])
                .filter((item) => typeof item.url === 'string' && item.url.trim().length > 0)
                .map((item, index) => ({
                    id: `mood-research-${batchToken}-${index}`,
                    url: item.url.trim(),
                    label: (item.title || 'Research image').trim(),
                    categoryId: resolvedCategoryId,
                    createdAt: now,
                    sourceUrl: item.sourceUrl || item.url,
                    sourceLabel: item.sourceLabel,
                    sourceType: item.sourceType || 'web',
                    query: item.query,
                }));
            added = nextItems.length;
            if (nextItems.length === 0) return prev;
            return {
                ...prev,
                categorizedMoodboard: {
                    ...categorized,
                    items: [...categorized.items, ...nextItems],
                },
            };
        });
        return added;
    }, [setStoryBible]);

    const selectedTimelineClip = useMemo(
        () => timelineClips.find((clip) => clip.id === selectedClipId) || null,
        [selectedClipId, timelineClips],
    );
    const selectedTimelineMedia = useMemo(
        () =>
            selectedTimelineClip
                ? mediaItems.find((item) => item.id === selectedTimelineClip.mediaId) || null
                : null,
        [mediaItems, selectedTimelineClip],
    );
    const activeStoryboardShot = useMemo(
        () =>
            typeof projectHubActiveShotNumber === 'number'
                ? shotPrompts.find((shot) => shot.shot === projectHubActiveShotNumber) || null
                : null,
        [projectHubActiveShotNumber, shotPrompts],
    );
    const assistantImageTarget = useMemo(() => {
        if (selectedTimelineMedia?.type === 'image' && selectedTimelineMedia.url) {
            return {
                imageUrl: selectedTimelineMedia.url,
                label: `selected timeline image "${selectedTimelineMedia.name}"`,
            };
        }

        const storyboardImageUrl =
            activeStoryboardShot?.imageUrl ||
            activeStoryboardShot?.startFrameUrl ||
            activeStoryboardShot?.endFrameUrl ||
            activeStoryboardShot?.sketchUrl;

        if (storyboardImageUrl) {
            return {
                imageUrl: storyboardImageUrl,
                label: `active storyboard shot ${activeStoryboardShot?.shot}`,
            };
        }

        return null;
    }, [activeStoryboardShot, selectedTimelineMedia]);

    const normalizeStudioAgentResult = useCallback((
        capabilityId: StudioAgentCapabilityId,
        result: unknown,
    ) => {
        const payload = typeof result === 'object' && result !== null
            ? result as { ok?: boolean; needsApproval?: boolean; detail?: string }
            : {};
        const detail = typeof payload.detail === 'string'
            ? payload.detail
            : 'Studio Agent action finished.';

        if (payload.needsApproval) {
            return {
                success: false,
                needsApproval: true,
                capabilityId,
                message: detail,
            };
        }

        return {
            success: payload.ok !== false,
            capabilityId,
            message: detail,
        };
    }, []);

    const resolveAssistantImageUrl = useCallback((requestedImageUrl?: string) => {
        const trimmed = typeof requestedImageUrl === 'string' ? requestedImageUrl.trim() : '';
        if (trimmed) {
            return {
                imageUrl: trimmed,
                label: 'provided image target',
            };
        }
        return assistantImageTarget;
    }, [assistantImageTarget]);

    const handleAssistantTurnStart = useCallback((message: string) => {
        const normalized = message.toLowerCase();
        assistantExplicitAgentIntentRef.current =
            /\bagent\b/.test(normalized) ||
            /studio\s+agent/.test(normalized) ||
            /via\s+agent/.test(normalized) ||
            /über\s+agent/.test(normalized) ||
            /mit\s+agent/.test(normalized) ||
            /autonom/.test(normalized);
        setStudioAgentYieldedToManualControl(false);
    }, []);

    const assistantContext = useMemo(() => {
        const moodboardCount =
            storyBible.categorizedMoodboard?.items?.length ||
            storyBible.moodboard?.length ||
            0;
        const projectLabel = (projectName || storyBible.title || 'Untitled').trim() || 'Untitled';
        return [
            `Active workspace: ${activeWorkspace}`,
            `Project: ${projectLabel}`,
            `Timeline clips: ${timelineClips.length}`,
            `Media assets: ${mediaItems.length}`,
            `References: ${references.length}`,
            `Storyboard shots: ${shotPrompts.length}`,
            `Moodboard images: ${moodboardCount}`,
            `Selected clip: ${selectedClipId || 'none'}`,
            `Selected clip media: ${selectedTimelineMedia ? `${selectedTimelineMedia.name} (${selectedTimelineMedia.type})` : 'none'}`,
            `Assistant image target: ${assistantImageTarget?.label || 'none'}`,
            `Playhead: ${playheadPosition.toFixed(2)}s`,
            `Studio agent mode: ${startupPreferences.studioAgentMode}`,
            `Studio agent activation: ${studioAgentAssistantControlActive ? 'assistant-active' : 'idle'}`,
            `Studio agent approvals: ${startupPreferences.studioAgentApprovalMode}`,
            `Studio agent manual override: ${studioAgentYieldedToManualControl ? 'yielded' : 'clear'}`,
            `Studio agent explicit intent: ${assistantExplicitAgentIntentRef.current ? 'granted' : 'not-granted'}`,
            `Studio agent status: ${studioAgentState.status}${studioAgentState.capabilityTitle ? ` (${studioAgentState.capabilityTitle})` : ''}`,
            `Studio agent detail: ${studioAgentState.detail}`,
            `Studio agent approval: ${studioAgentState.pendingApproval?.reason || 'none'}`,
            `Studio agent run queue: ${activeStudioAgentTask ? `${activeStudioAgentTask.title} (${activeStudioAgentTask.status})` : 'none'}`,
            `Studio agent run summary: ${activeStudioAgentTaskSummary || 'none'}`,
            `Studio agent approval bundle: ${studioAgentApprovalBundle ? `${studioAgentApprovalBundle.title} active` : 'none'}`,
        ].join('\n');
    }, [
        activeWorkspace,
        activeStudioAgentTask,
        activeStudioAgentTaskSummary,
        assistantImageTarget,
        mediaItems.length,
        playheadPosition,
        projectName,
        selectedTimelineMedia,
        references.length,
        selectedClipId,
        shotPrompts.length,
        studioAgentAssistantControlActive,
        startupPreferences.studioAgentApprovalMode,
        startupPreferences.studioAgentMode,
        studioAgentYieldedToManualControl,
        storyBible.categorizedMoodboard?.items?.length,
        storyBible.moodboard?.length,
        storyBible.title,
        studioAgentState.capabilityTitle,
        studioAgentState.detail,
        studioAgentState.pendingApproval?.reason,
        studioAgentState.status,
        studioAgentApprovalBundle,
        timelineClips.length,
    ]);

    const assistantWorkspaceEnum: Workspace[] = allowedWorkspaces;

    const apiProviderLinks = {
        gemini: 'https://aistudio.google.com/app/apikey',
        replicate: 'https://replicate.com/account/api-tokens',
        fal: 'https://fal.ai/dashboard/api-keys',
        ltx: 'https://console.ltx.video',
        xai: 'https://console.x.ai/',
        elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
        worldlabs: 'https://platform.worldlabs.ai/',
        sonauto: 'https://sonauto.ai/developers',
        unsplash: 'https://unsplash.com/developers',
    } as const;

    const assistantTools: FunctionDeclaration[] = [
        {
            name: 'navigateWorkspace',
            description: 'Open a workspace tab.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    workspace: {
                        type: Type.STRING,
                        enum: assistantWorkspaceEnum,
                        description: 'Workspace id to open.',
                    },
                },
                required: ['workspace'],
            },
        },
        {
            name: 'openSettings',
            description: 'Open the settings modal.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'openProjectPicker',
            description: 'Open the project picker to load or select a project.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'toggleSnapping',
            description: 'Toggle timeline snapping on or off.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'splitClipAtPlayhead',
            description: 'Split the selected clip at the current playhead position.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'addTrack',
            description: 'Add a new track to the timeline.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    type: { type: Type.STRING, enum: ['video', 'audio'] },
                },
                required: ['type'],
            },
        },
        {
            name: 'addTextOverlayToClip',
            description: 'Add or update a text overlay on the selected clip.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    clipIndex: { type: Type.NUMBER },
                    text: { type: Type.STRING },
                    fontSize: { type: Type.NUMBER },
                    fontColor: { type: Type.STRING },
                    position: { type: Type.STRING },
                },
                required: ['text'],
            },
        },
        {
            name: 'researchMoodboardFrames',
            description: 'Search internet images for moodboard research and import them to the Moodboard workspace. Can also extract still frames from direct video URLs.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    query: { type: Type.STRING, description: 'Research query for image search (for example: cinematic noir rainy street).' },
                    sourceUrls: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Optional web/image/video URLs to import from.' },
                    categoryId: { type: Type.STRING, description: 'Optional moodboard category id, for example lighting or composition.' },
                    maxResults: { type: Type.NUMBER, description: 'Maximum imported images (1-24).' },
                    extractFrames: { type: Type.BOOLEAN, description: 'If true, extract still frames from video URLs.' },
                    framesPerVideo: { type: Type.NUMBER, description: 'How many frames to extract per video URL (1-6).' },
                },
            },
        },
        {
            name: 'getStudioAgentStatus',
            description: 'Inspect the Studio Agent runtime, including current state, pending approval, selected clip, and current image target.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'studioAgentWriteProjectScript',
            description: 'Use the Studio Agent to write a script from an idea and place it into Project Hub > Script.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    prompt: {
                        type: Type.STRING,
                        description: 'Creative brief or idea for the script.',
                    },
                    length: {
                        type: Type.STRING,
                        enum: ['teaser', 'trailer', 'short', 'feature', 'commercial', 'micro-drama', 'reelshort'],
                        description: 'Optional target script format.',
                    },
                    mode: {
                        type: Type.STRING,
                        enum: ['fast', 'slow'],
                        description: 'Optional writing mode.',
                    },
                },
                required: ['prompt'],
            },
        },
        {
            name: 'studioAgentImproveProjectScript',
            description: 'Use the Studio Agent to refine the current script with assistant instructions and Script Doctor passes.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    instruction: {
                        type: Type.STRING,
                        description: 'Optional rewrite direction for the current script.',
                    },
                    targetScore: {
                        type: Type.NUMBER,
                        description: 'Optional target Script Doctor score.',
                    },
                    maxPasses: {
                        type: Type.NUMBER,
                        description: 'Optional maximum Script Doctor passes.',
                    },
                },
            },
        },
        {
            name: 'studioAgentNavigateWorkspace',
            description: 'Use the Studio Agent to switch to a workspace with observe-plan-act-verify execution.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    workspace: {
                        type: Type.STRING,
                        enum: assistantWorkspaceEnum,
                        description: 'Workspace id to open.',
                    },
                },
                required: ['workspace'],
            },
        },
        {
            name: 'studioAgentSetProjectPhase',
            description: 'Use the Studio Agent to move the Project Hub to a specific phase.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    phase: {
                        type: Type.STRING,
                        enum: PROJECT_HUB_PHASES,
                        description: 'Project Hub phase identifier.',
                    },
                },
                required: ['phase'],
            },
        },
        {
            name: 'studioAgentRunProjectWorkflow',
            description: 'Use the Studio Agent to queue and run a bundled Project Hub workflow from script through storyboard, with automatic resume support.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    prompt: {
                        type: Type.STRING,
                        description: 'Optional script brief. If omitted, the current project script is reused.',
                    },
                    length: {
                        type: Type.STRING,
                        description: 'Optional script format such as teaser, trailer, short, feature, commercial, micro-drama, or reelshort.',
                    },
                    mode: {
                        type: Type.STRING,
                        enum: ['fast', 'slow'],
                        description: 'Optional writing mode when generating a fresh script.',
                    },
                    conceptLimit: {
                        type: Type.NUMBER,
                        description: 'Optional maximum number of concept references to generate in this run.',
                    },
                    storyboardLimit: {
                        type: Type.NUMBER,
                        description: 'Optional maximum number of storyboard images to generate in this run.',
                    },
                    includeVideos: {
                        type: Type.BOOLEAN,
                        description: 'Whether the run should continue into storyboard video generation.',
                    },
                    videoLimit: {
                        type: Type.NUMBER,
                        description: 'Optional maximum number of storyboard videos to generate when includeVideos is true.',
                    },
                },
            },
        },
        {
            name: 'studioAgentResumeTaskQueue',
            description: 'Resume the current Studio Agent run queue from the next incomplete or blocked step.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'studioAgentRunDirectorPass',
            description: 'Use the Studio Agent to analyze the current script and prepare a director treatment.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'studioAgentGenerateProjectConcepts',
            description: 'Use the Studio Agent to build concept references from the script and generate concept images for them.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    limit: {
                        type: Type.NUMBER,
                        description: 'Optional maximum number of concept references to generate.',
                    },
                },
            },
        },
        {
            name: 'studioAgentApplyDirectorTreatment',
            description: 'Use the Studio Agent to apply the latest director treatment into storyboard shots.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'studioAgentGenerateStoryboardImages',
            description: 'Use the Studio Agent to batch-generate pending storyboard images.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    limit: {
                        type: Type.NUMBER,
                        description: 'Optional maximum number of storyboard shots to generate.',
                    },
                },
            },
        },
        {
            name: 'studioAgentGenerateStoryboardVideos',
            description: 'Use the Studio Agent to batch-generate storyboard videos from ready shots.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    limit: {
                        type: Type.NUMBER,
                        description: 'Optional maximum number of storyboard shots to film.',
                    },
                },
            },
        },
        {
            name: 'studioAgentSelectTimelineClip',
            description: 'Use the Studio Agent to focus a timeline clip. If clipId is omitted, use the currently selected clip.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    clipId: {
                        type: Type.STRING,
                        description: 'Optional clip id. Omit to use the currently selected clip.',
                    },
                },
            },
        },
        {
            name: 'studioAgentResearchWeb',
            description: 'Use the Studio Agent to run Brave web, news, or image research in read-only mode.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    query: {
                        type: Type.STRING,
                        description: 'Research query.',
                    },
                    kind: {
                        type: Type.STRING,
                        enum: ['web', 'news', 'image'],
                        description: 'Optional research mode.',
                    },
                },
                required: ['query'],
            },
        },
        {
            name: 'studioAgentAnalyzeImage',
            description: 'Use the Studio Agent to analyze the current image target or a provided image URL.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    imageUrl: {
                        type: Type.STRING,
                        description: 'Optional explicit image URL. If omitted, the assistant uses the selected image clip or active storyboard shot image.',
                    },
                    objective: {
                        type: Type.STRING,
                        description: 'Optional critique focus.',
                    },
                },
            },
        },
        {
            name: 'studioAgentEditImage',
            description: 'Use the Studio Agent to run a controlled image edit on the current image target or a provided image URL.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    imageUrl: {
                        type: Type.STRING,
                        description: 'Optional explicit image URL.',
                    },
                    prompt: {
                        type: Type.STRING,
                        description: 'Required edit instruction.',
                    },
                    referenceImageUrl: {
                        type: Type.STRING,
                        description: 'Optional style or content reference image URL.',
                    },
                },
                required: ['prompt'],
            },
        },
        {
            name: 'studioAgentRelightImage',
            description: 'Use the Studio Agent to relight the current image target or a provided image URL.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    imageUrl: {
                        type: Type.STRING,
                        description: 'Optional explicit image URL.',
                    },
                    prompt: {
                        type: Type.STRING,
                        description: 'Required relight instruction.',
                    },
                },
                required: ['prompt'],
            },
        },
        {
            name: 'approveStudioAgentAction',
            description: 'Approve the currently pending Studio Agent action.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'rejectStudioAgentAction',
            description: 'Reject the currently pending Studio Agent action.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    reason: {
                        type: Type.STRING,
                        description: 'Optional rejection reason.',
                    },
                },
            },
        },
        {
            name: 'getApiSetupStatus',
            description: 'Get saved API-key status and official setup URLs for providers.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'openApiProviderWebsite',
            description: 'Open the official API-key page for a provider.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    provider: {
                        type: Type.STRING,
                        enum: ['gemini', 'replicate', 'fal', 'ltx', 'xai', 'elevenlabs', 'worldlabs', 'sonauto', 'unsplash'],
                    },
                },
                required: ['provider'],
            },
        },
        {
            name: 'runSetupCheck',
            description: 'Check setup completeness (API keys, moodboard, first storyboard shots, first video render) and return missing steps with links.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
    ];

    const getStudioAgentStatusPayload = useCallback(() => ({
        success: true,
        mode: startupPreferences.studioAgentMode,
        activation: studioAgentAssistantControlActive ? 'assistant-active' : 'idle',
        approvalMode: startupPreferences.studioAgentApprovalMode,
        yieldedToManualControl: studioAgentYieldedToManualControl,
        status: studioAgentState.status,
        capabilityId: studioAgentState.capabilityId || null,
        capabilityTitle: studioAgentState.capabilityTitle || null,
        detail: studioAgentState.detail,
        pendingApproval: studioAgentState.pendingApproval || null,
        activeTask: activeStudioAgentTask
            ? {
                id: activeStudioAgentTask.id,
                title: activeStudioAgentTask.title,
                status: activeStudioAgentTask.status,
                summary: activeStudioAgentTaskSummary,
                nextStep: getNextStudioAgentTaskStep(activeStudioAgentTask)?.title || null,
                steps: activeStudioAgentTask.steps.map((step) => ({
                    id: step.id,
                    title: step.title,
                    status: step.status,
                    detail: step.detail || null,
                })),
            }
            : null,
        approvalBundle: studioAgentApprovalBundle || null,
        selectedClipId,
        selectedImageTarget: assistantImageTarget,
        message: [
            `Studio Agent mode: ${startupPreferences.studioAgentMode}.`,
            `Activation: ${studioAgentAssistantControlActive ? 'assistant-active' : 'idle'}.`,
            `Approval mode: ${startupPreferences.studioAgentApprovalMode}.`,
            studioAgentYieldedToManualControl ? 'The agent yielded to manual navigation.' : null,
            `Studio Agent is ${studioAgentState.status}.`,
            studioAgentState.capabilityTitle ? `Current capability: ${studioAgentState.capabilityTitle}.` : null,
            `Detail: ${studioAgentState.detail}`,
            studioAgentState.pendingApproval
                ? `Pending approval: ${studioAgentState.pendingApproval.reason}`
                : 'Pending approval: none.',
            activeStudioAgentTask
                ? `Run queue: ${activeStudioAgentTask.title} is ${activeStudioAgentTask.status}. ${activeStudioAgentTaskSummary}`
                : 'Run queue: none.',
            studioAgentApprovalBundle
                ? `Approval bundle: active for ${studioAgentApprovalBundle.title}.`
                : 'Approval bundle: none.',
            `Selected clip: ${selectedClipId || 'none'}.`,
            `Image target: ${assistantImageTarget?.label || 'none'}.`,
        ].filter(Boolean).join(' '),
    }), [
        activeStudioAgentTask,
        activeStudioAgentTaskSummary,
        assistantImageTarget,
        selectedClipId,
        studioAgentAssistantControlActive,
        studioAgentApprovalBundle,
        startupPreferences.studioAgentApprovalMode,
        startupPreferences.studioAgentMode,
        studioAgentYieldedToManualControl,
        studioAgentState.capabilityId,
        studioAgentState.capabilityTitle,
        studioAgentState.detail,
        studioAgentState.pendingApproval,
        studioAgentState.status,
    ]);

    const runStudioAgentCapability = useCallback(async (
        capabilityId: StudioAgentCapabilityId,
        input: Record<string, unknown>,
    ) => {
        if (startupPreferences.studioAgentMode !== 'agent') {
            return {
                success: false,
                capabilityId,
                message: 'Studio Agent is in manual mode. Switch Agent Mode on in settings to let the assistant drive the workflow.',
            };
        }
        if (studioAgentYieldedToManualControl) {
            return {
                success: false,
                capabilityId,
                message: 'Studio Agent yielded to manual navigation. Send a new assistant request to resume agent control.',
            };
        }
        if (!assistantExplicitAgentIntentRef.current) {
            return {
                success: false,
                capabilityId,
                message: 'Studio Agent execution is blocked until you explicitly ask the assistant to use the agent.',
            };
        }
        setStudioAgentAssistantControlActive(true);
        return normalizeStudioAgentResult(
            capabilityId,
            await executeStudioAgent(capabilityId, input),
        );
    }, [
        executeStudioAgent,
        normalizeStudioAgentResult,
        startupPreferences.studioAgentMode,
        studioAgentYieldedToManualControl,
    ]);

    const aiToolExecutor = {
        getStudioAgentStatus: () => getStudioAgentStatusPayload(),
        studioAgentRunProjectWorkflow: async ({
            prompt,
            length,
            mode,
            conceptLimit,
            storyboardLimit,
            includeVideos,
            videoLimit,
        }: {
            prompt?: string;
            length?: ScriptLength;
            mode?: 'fast' | 'slow';
            conceptLimit?: number;
            storyboardLimit?: number;
            includeVideos?: boolean;
            videoLimit?: number;
        }) => {
            const result = await runStudioAgentProjectWorkflow({
                prompt: typeof prompt === 'string' && prompt.trim() ? prompt.trim() : undefined,
                length,
                mode,
                conceptLimit: typeof conceptLimit === 'number' && Number.isFinite(conceptLimit)
                    ? conceptLimit
                    : undefined,
                storyboardLimit: typeof storyboardLimit === 'number' && Number.isFinite(storyboardLimit)
                    ? storyboardLimit
                    : undefined,
                includeVideos: includeVideos === true,
                videoLimit: typeof videoLimit === 'number' && Number.isFinite(videoLimit)
                    ? videoLimit
                    : undefined,
            });
            return {
                success: result.success,
                needsApproval: result.needsApproval,
                taskId: result.taskId,
                message: result.message,
            };
        },
        studioAgentResumeTaskQueue: async () => {
            const result = await resumeStudioAgentTaskQueue({ initiatedByAssistant: true });
            return {
                success: result.success,
                needsApproval: result.needsApproval,
                taskId: result.taskId,
                message: result.message,
            };
        },
        studioAgentWriteProjectScript: async ({
            prompt,
            length,
            mode,
        }: {
            prompt?: string;
            length?: ScriptLength;
            mode?: 'fast' | 'slow';
        }) => {
            const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
            if (!trimmedPrompt) {
                return { success: false, message: 'Script prompt is required.' };
            }
            const result = await runStudioAgentCapability('write_project_script', {
                prompt: trimmedPrompt,
                length,
                mode,
            });
            return {
                ...result,
                message: `Project Hub > Script: ${result.message}`,
            };
        },
        studioAgentImproveProjectScript: async ({
            instruction,
            targetScore,
            maxPasses,
        }: {
            instruction?: string;
            targetScore?: number;
            maxPasses?: number;
        }) => {
            const result = await runStudioAgentCapability('improve_project_script', {
                instruction: typeof instruction === 'string' && instruction.trim()
                    ? instruction.trim()
                    : undefined,
                targetScore: typeof targetScore === 'number' && Number.isFinite(targetScore)
                    ? targetScore
                    : undefined,
                maxPasses: typeof maxPasses === 'number' && Number.isFinite(maxPasses)
                    ? maxPasses
                    : undefined,
            });
            return {
                ...result,
                message: `Project Hub > Script: ${result.message}`,
            };
        },
        studioAgentNavigateWorkspace: async ({ workspace }: { workspace?: Workspace }) => {
            if (!workspace) {
                return { success: false, message: 'Workspace not specified.' };
            }
            if (!canAccessWorkspace(workspace)) {
                const modeLabel = UI_MODE_META[uiMode].label;
                return { success: false, message: `${workspace} is not available in ${modeLabel} mode.` };
            }
            return runStudioAgentCapability('navigate_workspace', { workspace });
        },
        studioAgentSetProjectPhase: async ({ phase }: { phase?: string }) => {
            if (!phase || !isProjectHubPhase(phase)) {
                return { success: false, message: 'Invalid project phase.' };
            }
            return runStudioAgentCapability('set_project_phase', { phase });
        },
        studioAgentRunDirectorPass: async () => runStudioAgentCapability('run_director_pass', {}),
        studioAgentGenerateProjectConcepts: async ({ limit }: { limit?: number }) => runStudioAgentCapability(
            'generate_project_concepts',
            typeof limit === 'number' && Number.isFinite(limit) ? { limit: Math.max(1, Math.floor(limit)) } : {},
        ),
        studioAgentApplyDirectorTreatment: async () => runStudioAgentCapability('apply_director_treatment', {}),
        studioAgentGenerateStoryboardImages: async ({ limit }: { limit?: number }) => runStudioAgentCapability(
            'generate_storyboard_images',
            typeof limit === 'number' && Number.isFinite(limit) ? { limit: Math.max(1, Math.floor(limit)) } : {},
        ),
        studioAgentGenerateStoryboardVideos: async ({ limit }: { limit?: number }) => runStudioAgentCapability(
            'generate_storyboard_videos',
            typeof limit === 'number' && Number.isFinite(limit) ? { limit: Math.max(1, Math.floor(limit)) } : {},
        ),
        studioAgentSelectTimelineClip: async ({ clipId }: { clipId?: string }) => {
            const resolvedClipId = typeof clipId === 'string' && clipId.trim()
                ? clipId.trim()
                : selectedClipId;
            if (!resolvedClipId) {
                return { success: false, message: 'No clip selected. Pass a clipId or select a clip first.' };
            }
            if (!timelineClips.some((clip) => clip.id === resolvedClipId)) {
                return { success: false, message: `Clip ${resolvedClipId} was not found.` };
            }
            return runStudioAgentCapability('select_timeline_clip', { clipId: resolvedClipId });
        },
        studioAgentResearchWeb: async ({ query, kind }: { query?: string; kind?: 'web' | 'news' | 'image' }) => {
            const trimmedQuery = typeof query === 'string' ? query.trim() : '';
            if (!trimmedQuery) {
                return { success: false, message: 'Research query is required.' };
            }
            return runStudioAgentCapability('research_web', { query: trimmedQuery, kind });
        },
        studioAgentAnalyzeImage: async ({ imageUrl, objective }: { imageUrl?: string; objective?: string }) => {
            const target = resolveAssistantImageUrl(imageUrl);
            if (!target?.imageUrl) {
                return {
                    success: false,
                    message: 'No image target available. Select an image clip, open a storyboard shot with an image, or pass imageUrl.',
                };
            }
            const result = await runStudioAgentCapability('analyze_image_asset', {
                imageUrl: target.imageUrl,
                objective,
            });
            return {
                ...result,
                message: `${target.label}: ${result.message}`,
            };
        },
        studioAgentEditImage: async ({
            imageUrl,
            prompt,
            referenceImageUrl,
        }: {
            imageUrl?: string;
            prompt?: string;
            referenceImageUrl?: string;
        }) => {
            const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
            if (!trimmedPrompt) {
                return { success: false, message: 'Edit prompt is required.' };
            }
            const target = resolveAssistantImageUrl(imageUrl);
            if (!target?.imageUrl) {
                return {
                    success: false,
                    message: 'No image target available. Select an image clip, open a storyboard shot with an image, or pass imageUrl.',
                };
            }
            const result = await runStudioAgentCapability('edit_image_asset', {
                imageUrl: target.imageUrl,
                prompt: trimmedPrompt,
                referenceImageUrl: typeof referenceImageUrl === 'string' && referenceImageUrl.trim()
                    ? referenceImageUrl.trim()
                    : undefined,
            });
            return {
                ...result,
                message: `${target.label}: ${result.message}`,
            };
        },
        studioAgentRelightImage: async ({ imageUrl, prompt }: { imageUrl?: string; prompt?: string }) => {
            const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
            if (!trimmedPrompt) {
                return { success: false, message: 'Relight prompt is required.' };
            }
            const target = resolveAssistantImageUrl(imageUrl);
            if (!target?.imageUrl) {
                return {
                    success: false,
                    message: 'No image target available. Select an image clip, open a storyboard shot with an image, or pass imageUrl.',
                };
            }
            const result = await runStudioAgentCapability('relight_image_asset', {
                imageUrl: target.imageUrl,
                prompt: trimmedPrompt,
            });
            return {
                ...result,
                message: `${target.label}: ${result.message}`,
            };
        },
        approveStudioAgentAction: async () => approveStudioAgentAction(),
        rejectStudioAgentAction: ({ reason }: { reason?: string }) => {
            return rejectStudioAgentAction(reason);
        },
        navigateWorkspace: ({ workspace }: { workspace?: Workspace }) => {
            if (!workspace) {
                return { success: false, message: 'Workspace not specified.' };
            }
            if (!canAccessWorkspace(workspace)) {
                const modeLabel = UI_MODE_META[uiMode].label;
                return { success: false, message: `${workspace} is not available in ${modeLabel} mode.` };
            }
            setActiveWorkspace(workspace);
            return { success: true, message: `Opened ${workspace} workspace.` };
        },
        openSettings: () => {
            setShowSettings(true);
            return { success: true, message: 'Settings opened.' };
        },
        openProjectPicker: async () => {
            await handleLoadProject();
            return { success: true, message: 'Project picker opened.' };
        },
        toggleSnapping: () => {
            setIsSnappingEnabled(prev => !prev);
            return { success: true, message: 'Snapping toggled.' };
        },
        splitClipAtPlayhead: () => {
            if (!selectedClipId) {
                return { success: false, message: 'No clip selected.' };
            }
            handleSplitClip(selectedClipId, playheadPosition);
            return { success: true, message: 'Clip split at playhead.' };
        },
        addTrack: ({ type }: { type?: 'video' | 'audio' }) => {
            if (type !== 'video' && type !== 'audio') {
                return { success: false, message: 'Invalid track type.' };
            }
            setTimelineTracks((prev) => {
                const newTrack = createTimelineTrack(type, prev);
                setActiveTrackId(newTrack.id);
                return [...prev, newTrack];
            });
            return { success: true, message: `${type === 'video' ? 'Video' : 'Audio'} track added.` };
        },
        addTextOverlayToClip: ({ clipIndex, text, fontSize, fontColor, position }: { clipIndex?: number; text: string; fontSize?: number; fontColor?: string; position?: string }) => {
            let targetClipId = selectedClipId;
            if (clipIndex) {
                const videoClips = timelineClips.filter(c => timelineTracks.find(t => t.id === c.trackId)?.type === 'video').sort((a, b) => a.start - b.start);
                const targetClip = videoClips[clipIndex - 1];
                if (!targetClip) return { success: false, reason: `Clip at index ${clipIndex} not found.` };
                targetClipId = targetClip.id;
            }
            if (!targetClipId) return { success: false, reason: 'No clip is selected.' };

            let success = false;
            const newClips = timelineClips.map(clip => {
                if (clip.id === targetClipId) {
                    success = true;
                    const currentConfig = clip.textConfig || { content: '', font: 'Arial', size: 48, color: '#FFFFFF', position: 'center' };
                    const newConfig: any = {
                        content: text,
                        font: currentConfig.font,
                        size: fontSize !== undefined ? fontSize : currentConfig.size,
                        color: fontColor !== undefined ? fontColor : currentConfig.color,
                        position: position ? position : currentConfig.position,
                    };
                    return { ...clip, textConfig: newConfig };
                }
                return clip;
            });

            if (success) {
                setTimelineClips(newClips);
                return { success: true, message: `Applied text overlay.` };
            }
            return { success: false, reason: 'Clip not found.' };
        },
        researchMoodboardFrames: async ({
            query,
            sourceUrls,
            categoryId,
            maxResults,
            extractFrames,
            framesPerVideo,
        }: {
            query?: string;
            sourceUrls?: string[];
            categoryId?: string;
            maxResults?: number;
            extractFrames?: boolean;
            framesPerVideo?: number;
        }) => {
            const trimmedQuery = (query || '').trim();
            const urls = Array.isArray(sourceUrls)
                ? Array.from(new Set(sourceUrls.map((value) => String(value || '').trim()).filter(Boolean)))
                : [];
            const shouldExtractFrames = extractFrames !== false;
            const maxImportCount = Math.min(24, Math.max(1, Math.round(maxResults || 8)));
            const perVideoFrames = Math.min(6, Math.max(1, Math.round(framesPerVideo || 3)));

            if (!trimmedQuery && urls.length === 0) {
                return { success: false, message: 'Provide a query or at least one source URL.' };
            }

            const collected: Array<{
                url: string;
                title?: string;
                sourceUrl?: string;
                sourceLabel?: string;
                sourceType?: 'search' | 'web' | 'video_frame';
                query?: string;
            }> = [];
            const notes: string[] = [];

            if (trimmedQuery) {
                try {
                    const results = await searchWikimediaCommonsImages(trimmedQuery, maxImportCount);
                    collected.push(...results.map((item) => ({
                        url: item.url,
                        title: item.title,
                        sourceUrl: item.sourcePageUrl || item.url,
                        sourceLabel: item.sourceLabel,
                        sourceType: 'search' as const,
                        query: trimmedQuery,
                    })));
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'Image search failed.';
                    notes.push(`Search failed: ${message}`);
                }
            }

            for (const sourceUrl of urls) {
                try {
                    if (shouldExtractFrames && isLikelyVideoUrl(sourceUrl)) {
                        const frames = await extractFramesFromVideoUrl(sourceUrl, perVideoFrames);
                        collected.push(...frames.map((frame) => ({
                            url: frame.url,
                            title: frame.title,
                            sourceUrl: sourceUrl,
                            sourceLabel: frame.sourceLabel,
                            sourceType: 'video_frame' as const,
                        })));
                        continue;
                    }
                    const resolved = await resolveImageFromWebUrl(sourceUrl);
                    if (!resolved) {
                        notes.push(`No image found at: ${sourceUrl}`);
                        continue;
                    }
                    collected.push({
                        url: resolved.url,
                        title: resolved.title,
                        sourceUrl: resolved.sourcePageUrl || sourceUrl,
                        sourceLabel: resolved.sourceLabel,
                        sourceType: 'web',
                    });
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'Import failed.';
                    notes.push(`${sourceUrl}: ${message}`);
                }
            }

            const uniqueByUrl = Array.from(new Map(collected.map((item) => [item.url, item])).values());
            const toImport = uniqueByUrl.slice(0, maxImportCount);
            const added = addMoodboardResearchItems(toImport, categoryId);

            const canOpenMoodboard = canAccessWorkspace('MOODBOARD');
            if (added > 0 && canOpenMoodboard) {
                setActiveWorkspace('MOODBOARD');
            }

            if (added === 0) {
                return {
                    success: false,
                    message: notes.length > 0 ? `No assets imported. ${notes.join(' | ')}` : 'No assets imported.',
                };
            }

            const noteSummary = notes.length > 0 ? ` Notes: ${notes.slice(0, 3).join(' | ')}` : '';
            return {
                success: true,
                message: canOpenMoodboard
                    ? `Imported ${added} moodboard research image(s) to ${categoryId || 'uncategorized'} and opened Moodboard.${noteSummary}`
                    : `Imported ${added} moodboard research image(s) to ${categoryId || 'uncategorized'}.${noteSummary}`,
                added,
                notes,
            };
        },
        getApiSetupStatus: () => {
            const status = {
                gemini: Boolean(localStorage.getItem('gemini_api_key')),
                replicate: Boolean(localStorage.getItem('replicate_api_key')),
                fal: Boolean(localStorage.getItem('fal_api_key')),
                ltx: Boolean(localStorage.getItem('ltx_api_key')),
                xai: Boolean(localStorage.getItem('xai_api_key')),
                elevenlabs: Boolean(localStorage.getItem('elevenlabs_api_key')),
                worldlabs: Boolean(localStorage.getItem('worldlabs_api_key')),
                sonauto: Boolean(localStorage.getItem('sonauto_api_key')),
                unsplash: Boolean(localStorage.getItem('unsplash_access_key')),
            };
            return {
                success: true,
                status,
                links: apiProviderLinks,
                message: `API setup status loaded. Connected: ${Object.entries(status).filter(([, ok]) => ok).map(([name]) => name).join(', ') || 'none'}.`,
            };
        },
        openApiProviderWebsite: ({ provider }: { provider?: keyof typeof apiProviderLinks }) => {
            if (!provider || !apiProviderLinks[provider]) {
                return { success: false, message: 'Unknown provider.' };
            }
            const url = apiProviderLinks[provider];
            window.open(url, '_blank', 'noopener,noreferrer');
            return { success: true, message: `Opened ${provider} API setup page.` };
        },
        runSetupCheck: () => {
            const status = {
                keys: {
                    gemini: Boolean(localStorage.getItem('gemini_api_key')),
                    replicate: Boolean(localStorage.getItem('replicate_api_key')),
                    fal: Boolean(localStorage.getItem('fal_api_key')),
                    ltx: Boolean(localStorage.getItem('ltx_api_key')),
                    xai: Boolean(localStorage.getItem('xai_api_key')),
                    elevenlabs: Boolean(localStorage.getItem('elevenlabs_api_key')),
                    worldlabs: Boolean(localStorage.getItem('worldlabs_api_key')),
                    sonauto: Boolean(localStorage.getItem('sonauto_api_key')),
                    unsplash: Boolean(localStorage.getItem('unsplash_access_key')),
                },
                moodboard: (storyBible.categorizedMoodboard?.items?.length || storyBible.moodboard?.length || 0) > 0,
                storyboard: shotPrompts.length >= 3 || shotPrompts.some((shot) => Boolean(shot.imageUrl)),
                firstVideo: shotPrompts.some((shot) => Boolean(shot.videoUrl)),
            };
            const connectedProviders = Object.entries(status.keys)
                .filter(([, connected]) => connected)
                .map(([provider]) => provider);
            const missingProviders = Object.entries(status.keys)
                .filter(([, connected]) => !connected)
                .map(([provider]) => provider as keyof typeof apiProviderLinks);

            const lines: string[] = [];
            lines.push(`Connected providers: ${connectedProviders.length > 0 ? connectedProviders.join(', ') : 'none'}.`);
            lines.push(`Moodboard: ${status.moodboard ? 'ok' : 'missing references'}.`);
            lines.push(`Storyboard: ${status.storyboard ? 'ok' : 'missing first shots'}.`);
            lines.push(`First video: ${status.firstVideo ? 'ok' : 'not rendered yet'}.`);

            if (!status.moodboard) {
                lines.push('Next step: collect references in Moodboard or run assistant moodboard research.');
            }
            if (!status.storyboard) {
                lines.push('Next step: generate first storyboard shots in Project Hub > Storyboard.');
            }
            if (!status.firstVideo) {
                lines.push('Next step: render one shot in Project Hub > Filming.');
            }

            const links = missingProviders.slice(0, 4).map((provider) => ({
                uri: apiProviderLinks[provider],
                title: `${provider} API key page`,
            }));

            if (missingProviders.length > 0) {
                lines.push(`Missing API keys: ${missingProviders.join(', ')}.`);
            }

            return {
                success: true,
                status,
                message: lines.join('\n'),
                links,
            };
        },
    };

    const hasAnyApiKeyConfigured = useMemo(() => hasAnyLocalApiKey(), [
        apiKeyReady,
        showSettings,
    ]);

    const completeOnboarding = (markCompleted: boolean) => {
        if (markCompleted) {
            localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
        }
        setShowOnboarding(false);

        if (!hasAnyLocalApiKey()) {
            setShowSettings(true);
        }

        if (startupPreferences.autoOpenAssistant) {
            window.setTimeout(() => setIsAssistantVisible(true), 180);
        }
    };

    const planLabel = (() => {
        if (isElectron) return 'Desktop';
        if (!billingStatus) return 'Free';
        if (billingStatus.mode === 'trial') {
            const end = billingStatus.trial_ends_at ? new Date(billingStatus.trial_ends_at) : null;
            if (end && end.getTime() > Date.now()) {
                const daysLeft = Math.max(0, Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                return `Trial · ${daysLeft}d`;
            }
            return 'Trial ended';
        }
        if (billingStatus.mode === 'byo' || billingStatus.plan_id === 'byo') return 'Lifetime BYOK';
        if (billingStatus.mode?.startsWith('hosted')) return 'Hosted Credits';
        return billingStatus.plan_id ? billingStatus.plan_id : 'Free';
    })();

    const creditBalance =
        typeof billingStatus?.credit_balance_cents === 'number'
            ? billingStatus.credit_balance_cents / 100
            : null;

    const trialEndsAt = billingStatus?.trial_ends_at ? new Date(billingStatus.trial_ends_at) : null;
    const trialExpired =
        billingStatus?.mode === 'trial' &&
        Boolean(trialEndsAt && trialEndsAt.getTime() <= Date.now());
    const isHostedPlan = billingStatus?.mode?.startsWith('hosted');
    const lowCredits =
        isHostedPlan && typeof creditBalance === 'number' && creditBalance > 0 && creditBalance <= 2;
    const creditsExhausted =
        isHostedPlan && typeof creditBalance === 'number' && creditBalance <= 0;
    const blockForBilling =
        !isElectron && (trialExpired || creditsExhausted);
    const effectiveCostRates =
        costSettings.rates && costSettings.rates.length > 0
            ? costSettings.rates
            : DEFAULT_COST_SETTINGS.rates;
    const isByokMode =
        isElectron ||
        billingStatus?.mode === 'byo' ||
        billingStatus?.plan_id === 'byo' ||
        billingStatus?.plan_id === 'byok';
    const estimateTtsMinutes = (text: string): number => {
        const chars = (text || '').trim().length;
        if (chars <= 0) return 0.2;
        return Math.max(0.2, Math.min(8, chars / 900));
    };
    const buildModalPricing = (opts: {
        provider: CostRate['provider'];
        kind: CostRate['kind'];
        model?: string;
        units?: number;
        detail?: string;
    }): PricingResult | null => {
        const estimate = estimateGenerationCost({
            rates: effectiveCostRates,
            provider: opts.provider,
            kind: opts.kind,
            model: opts.model,
            units: opts.units,
        });
        if (!estimate) return null;
        return {
            mode: isByokMode ? 'byok' : 'hosted',
            hostedUsd: estimate.hostedUsd,
            byokUsd: estimate.providerUsd,
            credits: estimate.credits,
            units: estimate.units,
            unitLabel: estimate.unitLabel,
            detail: opts.detail || `Estimated for ${formatUnitSummary(estimate.units, estimate.unitLabel)}.`,
            provider: opts.provider,
            kind: opts.kind,
            model: opts.model,
        };
    };

    const validateHostedGeneration = useCallback(async (opts: {
        provider: UsageProvider;
        kind: UsageKind;
        model?: string;
        units?: number;
        credits?: number;
    }) => {
        if (isElectron || isByokMode) return { ok: true as const };
        if (!isHostedPlan) return { ok: true as const };

        const requiredCredits =
            typeof opts.credits === 'number'
                ? Math.max(1, Math.ceil(opts.credits))
                : 0;
        const currentBalanceCents =
            typeof billingStatus?.credit_balance_cents === 'number'
                ? billingStatus.credit_balance_cents
                : null;

        if (
            requiredCredits > 0 &&
            currentBalanceCents !== null &&
            currentBalanceCents < requiredCredits
        ) {
            return {
                ok: false as const,
                message: `Insufficient hosted credits. Need ${requiredCredits}, available ${currentBalanceCents}.`,
            };
        }

        if (!teamId) {
            return { ok: true as const };
        }

        const client = getSupabase();
        if (!client) return { ok: true as const };

        const { data } = await client.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return { ok: true as const };

        const response = await fetch('/api/usage/record', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                teamId,
                dryRun: true,
                entry: {
                    provider: opts.provider,
                    kind: opts.kind,
                    model: opts.model,
                    units: opts.units || 1,
                },
            }),
        });

        const payload = await response.json().catch(() => null);
        if (payload && typeof payload.balanceCents === 'number') {
            setBillingStatus((prev) =>
                prev
                    ? { ...prev, credit_balance_cents: payload.balanceCents }
                    : prev,
            );
        }

        if (!response.ok || payload?.blocked) {
            return {
                ok: false as const,
                message: payload?.message || payload?.error || 'Hosted generation blocked due to billing guardrail.',
            };
        }

        return { ok: true as const };
    }, [billingStatus?.credit_balance_cents, isByokMode, isElectron, isHostedPlan, teamId]);

    // --- Render ---

    if (!user) {
        if (isElectron) {
            return <AuthScreen onLogin={handleLogin} />;
        }
        if (authStatus === 'checking') {
            return (
                <div className="flex h-screen w-full items-center justify-center bg-gray-950 text-gray-300">
                    Checking session...
                </div>
            );
        }
        return (
            <StudioLogin
                onLogin={async (email) => {
                    await loginWithEmail(email);
                }}
                onProviderLogin={async (provider) => {
                    await loginWithProvider(provider);
                }}
                onRefresh={refreshWebUser}
            />
        );
    }

    const renderWorkspace = () => {
        const commonProps = {
            mediaItems,
            timelineClips,
            timelineTracks,
            activeTrackId,
            selectedClipId,
            selectedClip: timelineClips.find(c => c.id === selectedClipId) || null,
            selectedMedia: selectedClipId ? mediaItems.find(m => m.id === timelineClips.find(c => c.id === selectedClipId)?.mediaId) || null : null,
            playheadPosition,
            isSnappingEnabled,
            waveformCache,
            trimMode: editTrimMode,
            onAddMedia: handleAddMedia,
            onAddToTimeline: handleAddToTimeline,
            onImportLibraryAsset: handleImportLibraryAsset,
            onDropLibraryAsset: handleDropLibraryAsset,
            onCreateTextClip: createStandaloneTextClip,
            onSelectClip: setSelectedClipId,
            onUpdateClip: updateClip,
            onBatchUpdateClips: updateBatchClips,
            onTrimModeChange: setEditTrimMode,
            onThreePointEdit: handleThreePointEdit,
            onSwitchWorkspace: setActiveWorkspace,
            canAccessWorkspace,
            projectName: projectName || storyBible.title || null,
            currentProjectPath: projectPath,
            scriptText: storyBible.script || null,
            storyContext: [storyBible.logline, storyBible.plotBeats, storyBible.productionGuidelines].filter(Boolean).join('\n\n') || null,
            analysisResult,
            shotPrompts,
            recentProjects,
            lastAgentApplyBatch,
            canUndoLastAgentApply,
            onPreviewEditPlan: previewEditPlan,
            onApplyEditPlan: applyEditPlan,
            onUndoLastAgentApply: undoLastAgentApply,
            onRunAgentReviewPass: runAgentReviewPass,
            onGenerateSubtitlesFromClip: generateSubtitleClipsFromClip,
            onApplyTitleMotionPreset: applyTitleMotionPresetToClip,
            onToggleTitleAutoContrast: toggleTitleAutoContrast,
            onUpdateSubtitleClipContent: updateSubtitleClipContent,
            onSplitSubtitleClip: splitSubtitleClip,
            onMergeSubtitleClip: mergeSubtitleClip,
            onUpdateClipFilters: updateClipFilters,
            onApplyCSSEffect: (effect: EffectType) => {
                if (!selectedClipId) return;
                applyCssEffectToClip(selectedClipId, effect);
            },
            onApplyEffectStack: (stackId: string) => {
                if (!selectedClipId) {
                    alert('Select a clip first.');
                    return;
                }
                applyEffectStackToClip(selectedClipId, stackId);
            },
            onApplyTransition: (clipId: string, transitionType: TransitionType) => {
                const transitionDef = TRANSITIONS.find(t => t.id === transitionType);
                const duration = transitionDef ? transitionDef.duration : 1.0;
                const transitionObj = { type: transitionType, duration };
                setTimelineClips(timelineClips.map(c => c.id === clipId ? { ...c, transitionOut: transitionObj } : c));
            },
            onApplyAIEffect: async (effect: Effect) => {
                if (
                    !selectedClipId &&
                    effect.id !== EffectType.VEOGEN &&
                    effect.id !== EffectType.IMAGEN_GEN &&
                    effect.id !== EffectType.TTSGEN &&
                    effect.id !== EffectType.GEMINI_3_PRO_IMAGE &&
                    effect.id !== EffectType.REPLICATE_FLUX &&
                    effect.id !== EffectType.REPLICATE_SEEDREAM &&
                    effect.id !== EffectType.OMNI_HUMAN &&
                    effect.id !== EffectType.WAN_ANIMATE_REPLACE &&
                    effect.id !== EffectType.WAN_IMAGE_TO_VIDEO &&
                    effect.id !== EffectType.KLING_26 &&
                    effect.id !== EffectType.KLING_MOTION_CONTROL
                ) {
                    alert("Please select a clip first.");
                    return;
                }
                if (effect.id === EffectType.VEOGEN) {
                    setModalConfig({
                        title: 'Generate Video (Veo)',
                        description: 'Create 720p videos from text prompts.',
                        fields: [
                            { name: 'prompt', label: 'Prompt', type: 'textarea', required: true },
                            {
                                name: 'aspectRatio', label: 'Aspect Ratio', type: 'select', options: [
                                    { value: '16:9', label: 'Landscape (16:9)' },
                                    { value: '9:16', label: 'Portrait (9:16)' }
                                ], defaultValue: '16:9'
                            },
                            {
                                name: 'model', label: 'Model', type: 'select', options: [
                                    { value: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast' },
                                    { value: 'veo-3.1-generate-preview', label: 'Veo 3.1 (High Quality)' }
                                ], defaultValue: 'veo-3.1-fast-generate-preview'
                            }
                        ],
                        estimate: {
                            label: 'Token Budget (Veo)',
                            compute: (values) => {
                                const multiplier = values.model === 'veo-3.1-generate-preview' ? 1.4 : 1;
                                return buildCostEstimate(values.prompt || '', TOKEN_BUDGETS.video, multiplier);
                            }
                        },
                        pricing: {
                            label: 'Generation Cost',
                            compute: (values) =>
                                buildModalPricing({
                                    provider: 'gemini',
                                    kind: 'video',
                                    model:
                                        values.model === 'veo-3.1-generate-preview'
                                            ? 'veo-3.1-generate-preview'
                                            : 'veo-3.1-fast-generate-preview',
                                    units: 5,
                                    detail: 'Assumes a 5 second clip.',
                                }),
                        }
                    });
                    setModalSubmitHandler(() => async (values: any) => {
                        setModalConfig(null);
                        const multiplier = values.model === 'veo-3.1-generate-preview' ? 1.4 : 1;
                        const estimate = buildCostEstimate(values.prompt || '', TOKEN_BUDGETS.video, multiplier);
                        if (estimate.severity === 'high') {
                            const proceed = window.confirm(
                                `High cost warning: ${estimate.adjustedTokens || estimate.tokens} tokens vs budget ${estimate.budget}. Continue?`
                            );
                            if (!proceed) return;
                        }
                        try {
                            const item = await generateVideoWithVeo(values.prompt, (msg) => console.log(msg), values.aspectRatio || '16:9', undefined, values.model);
                            setMediaItems(p => [...p, item]);
                        } catch (e) { handleAIError(e); }
                    });
                } else if (effect.id === EffectType.REPLICATE_FLUX) {
                    setModalConfig({
                        title: 'Generate Image (Flux)',
                        description: 'Generate high-quality images using Flux on Replicate.',
                        fields: [
                            { name: 'prompt', label: 'Prompt', type: 'textarea', required: true },
                            {
                                name: 'aspectRatio', label: 'Aspect Ratio', type: 'select', options: [
                                    { value: '16:9', label: 'Landscape (16:9)' },
                                    { value: '1:1', label: 'Square (1:1)' },
                                    { value: '9:16', label: 'Portrait (9:16)' }
                                ], defaultValue: '16:9'
                            }
                        ],
                        pricing: {
                            label: 'Generation Cost',
                            compute: () =>
                                buildModalPricing({
                                    provider: 'replicate',
                                    kind: 'image',
                                    model: 'black-forest-labs/flux-1.1-pro',
                                    units: 1,
                                }),
                        }
                    });
                    setModalSubmitHandler(() => async (values: any) => {
                        setModalConfig(null);
                        try {
                            const item = await generateImageWithFlux(values.prompt, values.aspectRatio);
                            setMediaItems(p => [...p, item]);
                        } catch (e) { handleAIError(e); }
                    });
                } else if (effect.id === EffectType.REPLICATE_SEEDREAM) {
                    setModalConfig({
                        title: 'Generate Image (Seedream 4.5)',
                        description: 'Generate images using Seedream 4.5 on Replicate.',
                        fields: [
                            { name: 'prompt', label: 'Prompt', type: 'textarea', required: true },
                            {
                                name: 'aspectRatio', label: 'Aspect Ratio', type: 'select', options: [
                                    { value: '16:9', label: 'Landscape (16:9)' },
                                    { value: '1:1', label: 'Square (1:1)' },
                                    { value: '9:16', label: 'Portrait (9:16)' },
                                    { value: '4:3', label: 'Standard (4:3)' },
                                    { value: '3:4', label: 'Portrait (3:4)' }
                                ], defaultValue: '16:9'
                            },
                            {
                                name: 'size', label: 'Size', type: 'select', options: [
                                    { value: '2K', label: '2K' },
                                    { value: '4K', label: '4K' }
                                ], defaultValue: '2K'
                            }
                        ],
                        pricing: {
                            label: 'Generation Cost',
                            compute: (values) =>
                                buildModalPricing({
                                    provider: 'replicate',
                                    kind: 'image',
                                    model: 'bytedance/seedream-4.5',
                                    units: values.size === '4K' ? 1.5 : 1,
                                    detail: values.size === '4K' ? '4K output usually costs more than 2K.' : undefined,
                                }),
                        }
                    });
                    setModalSubmitHandler(() => async (values: any) => {
                        setModalConfig(null);
                        try {
                            const item = await generateImageWithSeedream(values.prompt, values.aspectRatio, values.size);
                            setMediaItems(p => [...p, item]);
                        } catch (e) { handleAIError(e); }
                    });
                } else if (effect.id === EffectType.REPLICATE_FLUX_EDIT) {
                    const currentMedia = selectedClipId ? mediaItems.find(m => m.id === timelineClips.find(c => c.id === selectedClipId)?.mediaId) : null;
                    if (!currentMedia || currentMedia.type !== 'image') {
                        alert("Please select an image clip first to use Flux Edit.");
                        return;
                    }
                    setModalConfig({
                        title: 'Edit Image (Flux)',
                        description: 'Edit this image using text instructions.',
                        fields: [
                            { name: 'prompt', label: 'Instruction', type: 'textarea', required: true, defaultValue: 'Make it cyberpunk style' },
                        ],
                        pricing: {
                            label: 'Generation Cost',
                            compute: () =>
                                buildModalPricing({
                                    provider: 'replicate',
                                    kind: 'edit',
                                    model: 'black-forest-labs/flux-fill-dev',
                                    units: 1,
                                }),
                        }
                    });
                    setModalSubmitHandler(() => async (values: any) => {
                        setModalConfig(null);
                        try {
                            const response = await fetch(currentMedia.url);
                            const blob = await response.blob();
                            const base64 = await fileToBase64(new File([blob], "src", { type: blob.type }));
                            const item = await editImageWithFlux(values.prompt, { base64, mimeType: blob.type });
                            setMediaItems(p => [...p, item]);
                        } catch (e) { handleAIError(e); }
                    });
                } else if (effect.id === EffectType.REPLICATE_QWEN_EDIT) {
                    const currentMedia = selectedClipId ? mediaItems.find(m => m.id === timelineClips.find(c => c.id === selectedClipId)?.mediaId) : null;
                    if (!currentMedia || currentMedia.type !== 'image') {
                        alert("Please select an image clip first to use Qwen Edit.");
                        return;
                    }
                    setModalConfig({
                        title: 'Edit Image (Qwen)',
                        description: 'Edit this image using Qwen Image Edit.',
                        fields: [
                            { name: 'prompt', label: 'Instruction', type: 'textarea', required: true, defaultValue: 'Replace the background with a modern studio' },
                            {
                                name: 'aspectRatio', label: 'Aspect Ratio', type: 'select', options: [
                                    { value: 'match_input_image', label: 'Match Input' },
                                    { value: '16:9', label: '16:9' },
                                    { value: '9:16', label: '9:16' },
                                    { value: '4:3', label: '4:3' },
                                    { value: '3:4', label: '3:4' },
                                    { value: '1:1', label: '1:1' }
                                ], defaultValue: 'match_input_image'
                            }
                        ],
                        pricing: {
                            label: 'Generation Cost',
                            compute: () =>
                                buildModalPricing({
                                    provider: 'replicate',
                                    kind: 'edit',
                                    model: 'qwen/qwen-image-edit-2511',
                                    units: 1,
                                }),
                        }
                    });
                    setModalSubmitHandler(() => async (values: any) => {
                        setModalConfig(null);
                        try {
                            const response = await fetch(currentMedia.url);
                            const blob = await response.blob();
                            const base64 = await fileToBase64(new File([blob], "src", { type: blob.type }));
                            const item = await editImageWithQwen(values.prompt, { base64, mimeType: blob.type }, { aspectRatio: values.aspectRatio });
                            setMediaItems(p => [...p, item]);
                        } catch (e) { handleAIError(e); }
                    });
                } else if (effect.id === EffectType.REPLICATE_UPSCALER) {
                    const currentMedia = selectedClipId ? mediaItems.find(m => m.id === timelineClips.find(c => c.id === selectedClipId)?.mediaId) : null;
                    if (!currentMedia || currentMedia.type !== 'image') {
                        alert("Please select an image clip first to upscale.");
                        return;
                    }
                    if (!confirm("Upscale this image (4x) using Clarity/Real-ESRGAN?")) return;

                    try {
                        const response = await fetch(currentMedia.url);
                        const blob = await response.blob();
                        const base64 = await fileToBase64(new File([blob], "src", { type: blob.type }));
                        const item = await upscaleImage({ base64, mimeType: blob.type });
                        setMediaItems(p => [...p, item]);
                    } catch (e) { handleAIError(e); }

                } else if (effect.id === EffectType.IMAGEN_GEN) {
                    setModalConfig({
                        title: 'Generate Image (Imagen)',
                        description: 'Create high-quality AI images.',
                        fields: [
                            { name: 'prompt', label: 'Prompt', type: 'textarea', required: true },
                            {
                                name: 'aspectRatio', label: 'Aspect Ratio', type: 'select', options: [
                                    { value: '16:9', label: 'Cinematic (16:9)' },
                                    { value: '9:16', label: 'Mobile (9:16)' },
                                    { value: '4:3', label: 'Classic TV (4:3)' },
                                    { value: '3:4', label: 'Portrait (3:4)' },
                                    { value: '1:1', label: 'Square (1:1)' }
                                ], defaultValue: '16:9'
                            }
                        ],
                        estimate: {
                            label: 'Token Budget (Imagen)',
                            compute: (values) => buildCostEstimate(values.prompt || '', TOKEN_BUDGETS.image),
                        },
                        pricing: {
                            label: 'Generation Cost',
                            compute: () =>
                                buildModalPricing({
                                    provider: 'gemini',
                                    kind: 'image',
                                    model: 'imagen-4.0-generate-001',
                                    units: 1,
                                }),
                        }
                    });
                    setModalSubmitHandler(() => async (values: any) => {
                        setModalConfig(null);
                        const estimate = buildCostEstimate(values.prompt || '', TOKEN_BUDGETS.image);
                        if (estimate.severity === 'high') {
                            const proceed = window.confirm(
                                `High cost warning: ${estimate.adjustedTokens || estimate.tokens} tokens vs budget ${estimate.budget}. Continue?`
                            );
                            if (!proceed) return;
                        }
                        try { const item = await generateImageWithImagen(values.prompt, values.aspectRatio); setMediaItems(p => [...p, item]); } catch (e) { handleAIError(e); }
                    });
                } else if (effect.id === EffectType.GEMINI_3_PRO_IMAGE) {
                    setModalConfig({
                        title: 'Generate Image (Gemini 3 Pro)',
                        description: 'Create high-quality images with size control.',
                        fields: [
                            { name: 'prompt', label: 'Prompt', type: 'textarea', required: true },
                            {
                                name: 'aspectRatio', label: 'Aspect Ratio', type: 'select', options: [
                                    { value: '16:9', label: 'Landscape (16:9)' },
                                    { value: '9:16', label: 'Portrait (9:16)' },
                                    { value: '4:3', label: 'Standard (4:3)' },
                                    { value: '3:4', label: 'Portrait (3:4)' },
                                    { value: '1:1', label: 'Square (1:1)' }
                                ], defaultValue: '16:9'
                            },
                            {
                                name: 'imageSize', label: 'Image Size', type: 'select', options: [
                                    { value: '1K', label: '1K' },
                                    { value: '2K', label: '2K' },
                                    { value: '4K', label: '4K' }
                                ], defaultValue: '1K'
                            }
                        ],
                        estimate: {
                            label: 'Token Budget (Gemini)',
                            compute: (values) => {
                                const sizeMultiplier = values.imageSize === '4K' ? 1.6 : values.imageSize === '2K' ? 1.3 : 1;
                                return buildCostEstimate(values.prompt || '', TOKEN_BUDGETS.image, sizeMultiplier);
                            },
                        },
                        pricing: {
                            label: 'Generation Cost',
                            compute: (values) => {
                                const sizeMultiplier = values.imageSize === '4K' ? 1.6 : values.imageSize === '2K' ? 1.3 : 1;
                                return buildModalPricing({
                                    provider: 'gemini',
                                    kind: 'image',
                                    model: 'gemini-3-pro-image-preview',
                                    units: sizeMultiplier,
                                    detail: values.imageSize === '1K' ? undefined : `${values.imageSize} render has higher compute cost.`,
                                });
                            },
                        }
                    });
                    setModalSubmitHandler(() => async (values: any) => {
                        setModalConfig(null);
                        const sizeMultiplier = values.imageSize === '4K' ? 1.6 : values.imageSize === '2K' ? 1.3 : 1;
                        const estimate = buildCostEstimate(values.prompt || '', TOKEN_BUDGETS.image, sizeMultiplier);
                        if (estimate.severity === 'high') {
                            const proceed = window.confirm(
                                `High cost warning: ${estimate.adjustedTokens || estimate.tokens} tokens vs budget ${estimate.budget}. Continue?`
                            );
                            if (!proceed) return;
                        }
                        try {
                            const item = await generateImageWithGemini3Pro(values.prompt, values.aspectRatio, values.imageSize);
                            setMediaItems(p => [...p, item]);
                        } catch (e) {
                            handleAIError(e);
                        }
                    });
                } else if (effect.id === EffectType.TTSGEN) {
                    setModalConfig({
                        title: 'TTS',
                        description: 'Generate speech with Gemini or ElevenLabs.',
                        fields: [
                            { name: 'prompt', label: 'Text', type: 'textarea', required: true },
                            {
                                name: 'provider', label: 'Provider', type: 'select', options: [
                                    { value: 'gemini', label: 'Gemini (Flash TTS)' },
                                    { value: 'elevenlabs', label: 'ElevenLabs' }
                                ], defaultValue: 'gemini'
                            },
                            { name: 'voiceId', label: 'ElevenLabs Voice ID', type: 'text', defaultValue: 'JBFqnCBsd6RMkjVDRZzb' },
                            { name: 'modelId', label: 'ElevenLabs Model ID', type: 'text', defaultValue: 'eleven_multilingual_v2' },
                            { name: 'outputFormat', label: 'ElevenLabs Output Format', type: 'text', defaultValue: 'mp3_44100_128' }
                        ],
                        pricing: {
                            label: 'Generation Cost',
                            compute: (values) => {
                                const provider = values.provider === 'elevenlabs' ? 'elevenlabs' : 'gemini';
                                const model =
                                    provider === 'elevenlabs'
                                        ? (values.modelId || 'eleven_multilingual_v2')
                                        : 'gemini-2.5-flash-preview-tts';
                                return buildModalPricing({
                                    provider,
                                    kind: 'audio',
                                    model,
                                    units: estimateTtsMinutes(values.prompt || ''),
                                    detail: 'Speech duration is estimated from text length.',
                                });
                            },
                        }
                    });
                    setModalSubmitHandler(() => async (v: any) => {
                        setModalConfig(null);
                        try {
                            const item = v.provider === 'elevenlabs'
                                ? await generateSpeechWithElevenLabs(v.prompt, {
                                    voiceId: v.voiceId,
                                    modelId: v.modelId,
                                    outputFormat: v.outputFormat
                                })
                                : await generateSpeechWithTTS(v.prompt);
                            setMediaItems(p => [...p, item]);
                        } catch (e) { handleAIError(e); }
                    });
                } else if (effect.id === EffectType.OMNI_HUMAN) {
                    if (avatars.length === 0) {
                        alert('No avatars found. Create one in the Avatar workspace first.');
                        return;
                    }
                    setModalConfig({
                        title: 'Avatar Video (OmniHuman)',
                        description: 'Generate a talking avatar from a reference image and audio (<= 15s recommended).',
                        fields: [
                            { name: 'avatarId', label: 'Avatar', type: 'select', options: avatars.map(a => ({ value: a.id, label: a.name })), defaultValue: avatars[0].id },
                            { name: 'audio', label: 'Audio File', type: 'file', required: true, accept: 'audio/*' }
                        ],
                        pricing: {
                            label: 'Generation Cost',
                            compute: () =>
                                buildModalPricing({
                                    provider: 'replicate',
                                    kind: 'video',
                                    model: 'bytedance/omni-human',
                                    units: 8,
                                    detail: 'Estimated for an 8 second talking avatar clip.',
                                }),
                        }
                    });
                    setModalSubmitHandler(() => async (values: any) => {
                        setModalConfig(null);
                        try {
                            const avatar = avatars.find(a => a.id === values.avatarId);
                            if (!avatar?.imageUrl) {
                                alert('Selected avatar has no reference image.');
                                return;
                            }
                            const audioFile = values.audio as File | undefined;
                            if (!audioFile) {
                                alert('Please select an audio file.');
                                return;
                            }
                            const imagePayload = await urlToImagePayload(avatar.imageUrl);
                            const audioPayload = await fileToPayload(audioFile);
                            const item = await generateVideoWithOmniHuman(imagePayload, audioPayload);
                            setMediaItems(p => [...p, item]);
                        } catch (e) { handleAIError(e); }
                    });
                } else if (effect.id === EffectType.WAN_ANIMATE_REPLACE) {
                    if (avatars.length === 0) {
                        alert('No avatars found. Create one in the Avatar workspace first.');
                        return;
                    }
                    setModalConfig({
                        title: 'Avatar Replace (Wan Animate)',
                        description: 'Replace a character in the video using your avatar image.',
                        fields: [
                            { name: 'avatarId', label: 'Avatar', type: 'select', options: avatars.map(a => ({ value: a.id, label: a.name })), defaultValue: avatars[0].id },
                            { name: 'video', label: 'Video to Replace', type: 'file', required: true, accept: 'video/*' },
                            {
                                name: 'resolution', label: 'Resolution', type: 'select', options: [
                                    { value: '720', label: '720p' },
                                    { value: '480', label: '480p' }
                                ], defaultValue: '720'
                            },
                            { name: 'fps', label: 'FPS', type: 'text', defaultValue: '24' },
                            {
                                name: 'refertNum', label: 'Reference Frames', type: 'select', options: [
                                    { value: '1', label: '1' },
                                    { value: '5', label: '5' }
                                ], defaultValue: '1'
                            },
                            {
                                name: 'mergeAudio', label: 'Merge Audio', type: 'select', options: [
                                    { value: 'true', label: 'Yes' },
                                    { value: 'false', label: 'No' }
                                ], defaultValue: 'true'
                            },
                            {
                                name: 'goFast', label: 'Go Fast', type: 'select', options: [
                                    { value: 'true', label: 'Yes' },
                                    { value: 'false', label: 'No' }
                                ], defaultValue: 'true'
                            }
                        ],
                        pricing: {
                            label: 'Generation Cost',
                            compute: () =>
                                buildModalPricing({
                                    provider: 'replicate',
                                    kind: 'video',
                                    model: 'wan-video/wan-2.2-animate-replace',
                                    units: 5,
                                    detail: 'Estimated for a 5 second replace clip.',
                                }),
                        }
                    });
                    setModalSubmitHandler(() => async (values: any) => {
                        setModalConfig(null);
                        try {
                            const avatar = avatars.find(a => a.id === values.avatarId);
                            if (!avatar?.imageUrl) {
                                alert('Selected avatar has no reference image.');
                                return;
                            }
                            const videoFile = values.video as File | undefined;
                            if (!videoFile) {
                                alert('Please select a video file.');
                                return;
                            }
                            const imagePayload = await urlToImagePayload(avatar.imageUrl);
                            const videoPayload = await fileToPayload(videoFile);
                            const item = await generateVideoWithWanAnimateReplace(videoPayload, imagePayload, {
                                resolution: values.resolution === '480' ? '480' : '720',
                                fps: Number(values.fps) || 24,
                                refertNum: values.refertNum === '5' ? 5 : 1,
                                mergeAudio: values.mergeAudio !== 'false',
                                goFast: values.goFast !== 'false',
                            });
                            setMediaItems(p => [...p, item]);
                        } catch (e) { handleAIError(e); }
                    });
                } else if (effect.id === EffectType.WAN_IMAGE_TO_VIDEO) {
                    if (avatars.length === 0) {
                        alert('No avatars found. Create one in the Avatar workspace first.');
                        return;
                    }
                    setModalConfig({
                        title: 'Animate Image (Wan 2.2)',
                        description: 'Animate your avatar image into motion.',
                        fields: [
                            { name: 'avatarId', label: 'Avatar', type: 'select', options: avatars.map(a => ({ value: a.id, label: a.name })), defaultValue: avatars[0].id },
                            { name: 'prompt', label: 'Prompt', type: 'textarea', required: true },
                            {
                                name: 'resolution', label: 'Resolution', type: 'select', options: [
                                    { value: '720p', label: '720p' },
                                    { value: '480p', label: '480p' }
                                ], defaultValue: '720p'
                            },
                            { name: 'fps', label: 'FPS', type: 'text', defaultValue: '16' },
                            { name: 'numFrames', label: 'Frames', type: 'text', defaultValue: '81' },
                            {
                                name: 'interpolate', label: 'Interpolate Output', type: 'select', options: [
                                    { value: 'false', label: 'No' },
                                    { value: 'true', label: 'Yes' }
                                ], defaultValue: 'false'
                            }
                        ],
                        pricing: {
                            label: 'Generation Cost',
                            compute: (values) => {
                                const fps = Number(values.fps) || 16;
                                const numFrames = Number(values.numFrames) || 81;
                                const durationSeconds = Math.max(1, numFrames / Math.max(1, fps));
                                return buildModalPricing({
                                    provider: 'replicate',
                                    kind: 'video',
                                    model: 'wan-video/wan-2.2-i2v-fast',
                                    units: durationSeconds,
                                });
                            },
                        }
                    });
                    setModalSubmitHandler(() => async (values: any) => {
                        setModalConfig(null);
                        try {
                            const avatar = avatars.find(a => a.id === values.avatarId);
                            if (!avatar?.imageUrl) {
                                alert('Selected avatar has no reference image.');
                                return;
                            }
                            const imagePayload = await urlToImagePayload(avatar.imageUrl);
                            const item = await generateVideoWithWanI2V(values.prompt, imagePayload, {
                                resolution: values.resolution === '480p' ? '480p' : '720p',
                                fps: Number(values.fps) || 16,
                                numFrames: Number(values.numFrames) || 81,
                                interpolate: values.interpolate === 'true',
                            });
                            setMediaItems(p => [...p, item]);
                        } catch (e) { handleAIError(e); }
                    });
                } else if (effect.id === EffectType.KLING_26) {
                    setModalConfig({
                        title: 'Generate Video (Kling 2.6)',
                        description: 'Text-to-video or image-to-video with cinematic output.',
                        fields: [
                            { name: 'prompt', label: 'Prompt', type: 'textarea', required: true },
                            { name: 'negativePrompt', label: 'Negative Prompt', type: 'text', defaultValue: '' },
                            {
                                name: 'aspectRatio', label: 'Aspect Ratio', type: 'select', options: [
                                    { value: '16:9', label: '16:9' },
                                    { value: '9:16', label: '9:16' },
                                    { value: '1:1', label: '1:1' }
                                ], defaultValue: '16:9'
                            },
                            {
                                name: 'duration', label: 'Duration (s)', type: 'select', options: [
                                    { value: '5', label: '5' },
                                    { value: '10', label: '10' }
                                ], defaultValue: '5'
                            },
                            {
                                name: 'generateAudio', label: 'Generate Audio', type: 'select', options: [
                                    { value: 'true', label: 'Yes' },
                                    { value: 'false', label: 'No' }
                                ], defaultValue: 'true'
                            },
                            { name: 'startImage', label: 'Start Image (optional)', type: 'file', required: false, accept: 'image/*' }
                        ],
                        pricing: {
                            label: 'Generation Cost',
                            compute: (values) =>
                                buildModalPricing({
                                    provider: 'replicate',
                                    kind: 'video',
                                    model: 'kwaivgi/kling-v2.6',
                                    units: values.duration === '10' ? 10 : 5,
                                }),
                        }
                    });
                    setModalSubmitHandler(() => async (values: any) => {
                        setModalConfig(null);
                        try {
                            const startImageFile = values.startImage as File | undefined;
                            const startImagePayload = startImageFile ? await fileToPayload(startImageFile) : undefined;
                            const item = await generateVideoWithKling26(values.prompt, {
                                negativePrompt: values.negativePrompt || '',
                                aspectRatio: values.aspectRatio || '16:9',
                                duration: values.duration === '10' ? 10 : 5,
                                generateAudio: values.generateAudio !== 'false',
                                startImage: startImagePayload,
                            });
                            setMediaItems(p => [...p, item]);
                        } catch (e) { handleAIError(e); }
                    });
                } else if (effect.id === EffectType.KLING_MOTION_CONTROL) {
                    if (avatars.length === 0) {
                        alert('No avatars found. Create one in the Avatar workspace first.');
                        return;
                    }
                    setModalConfig({
                        title: 'Motion Control (Kling 2.6)',
                        description: 'Drive avatar motion with a video reference.',
                        fields: [
                            { name: 'avatarId', label: 'Avatar', type: 'select', options: avatars.map(a => ({ value: a.id, label: a.name })), defaultValue: avatars[0].id },
                            { name: 'prompt', label: 'Prompt', type: 'textarea', required: true },
                            { name: 'video', label: 'Motion Video', type: 'file', required: true, accept: 'video/*' },
                            {
                                name: 'mode', label: 'Mode', type: 'select', options: [
                                    { value: 'std', label: 'Standard' },
                                    { value: 'pro', label: 'Pro' }
                                ], defaultValue: 'std'
                            },
                            {
                                name: 'keepOriginalSound', label: 'Keep Original Sound', type: 'select', options: [
                                    { value: 'true', label: 'Yes' },
                                    { value: 'false', label: 'No' }
                                ], defaultValue: 'true'
                            },
                            {
                                name: 'characterOrientation', label: 'Character Orientation', type: 'select', options: [
                                    { value: 'image', label: 'Image' },
                                    { value: 'video', label: 'Video' }
                                ], defaultValue: 'image'
                            }
                        ],
                        pricing: {
                            label: 'Generation Cost',
                            compute: () =>
                                buildModalPricing({
                                    provider: 'replicate',
                                    kind: 'video',
                                    model: 'kwaivgi/kling-v2.6-motion-control',
                                    units: 5,
                                    detail: 'Estimated for a 5 second motion transfer.',
                                }),
                        }
                    });
                    setModalSubmitHandler(() => async (values: any) => {
                        setModalConfig(null);
                        try {
                            const avatar = avatars.find(a => a.id === values.avatarId);
                            if (!avatar?.imageUrl) {
                                alert('Selected avatar has no reference image.');
                                return;
                            }
                            const videoFile = values.video as File | undefined;
                            if (!videoFile) {
                                alert('Please select a motion video.');
                                return;
                            }
                            const imagePayload = await urlToImagePayload(avatar.imageUrl);
                            const videoPayload = await fileToPayload(videoFile);
                            const item = await generateVideoWithKlingMotionControl(values.prompt, imagePayload, videoPayload, {
                                mode: values.mode === 'pro' ? 'pro' : 'std',
                                keepOriginalSound: values.keepOriginalSound !== 'false',
                                characterOrientation: values.characterOrientation === 'video' ? 'video' : 'image',
                            });
                            setMediaItems(p => [...p, item]);
                        } catch (e) { handleAIError(e); }
                    });
                }
            },
            onApplyNativeEffect: (effect: Effect, value: string) => {
                if (effect.id === EffectType.NATIVE_SOLID_COLOR) {
                    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
                    const ctx = canvas.getContext('2d'); if (ctx) {
                        ctx.fillStyle = value; ctx.fillRect(0, 0, 1280, 720);
                        const newItem = { id: `solid-${Date.now()}`, name: `Solid ${value}`, type: 'image' as const, url: canvas.toDataURL(), source: 'generated' as const, duration: 5 };
                        setMediaItems(p => [...p, newItem]);
                    }
                    return;
                }

                if (!selectedClipId) return;

                if (effect.id === EffectType.TEXT) {
                    if (!selectedClipId) {
                        createStandaloneTextClip();
                        return;
                    }
                    setTimelineClips(timelineClips.map((clip) => (
                        clip.id !== selectedClipId
                            ? clip
                            : {
                                ...clip,
                                textConfig: clip.textConfig
                                    ? undefined
                                    : {
                                        content: 'Text Overlay',
                                        font: 'Arial',
                                        size: 56,
                                        color: '#FFFFFF',
                                        position: 'center',
                                    },
                            }
                    )));
                    return;
                }

                if (effect.id === EffectType.CHROMA_KEY) {
                    setTimelineClips(timelineClips.map((clip) => (
                        clip.id !== selectedClipId
                            ? clip
                            : {
                                ...clip,
                                chromaKey: clip.chromaKey
                                    ? undefined
                                    : { color: '#00ff00', tolerance: 0.35 },
                            }
                    )));
                }
            },
            onPlayheadUpdate: setPlayheadPosition,
            onSnappingToggle: () => setIsSnappingEnabled(!isSnappingEnabled),
            onSplitClip: handleSplitClip,
            onUpdateClipTransition: updateClipTransition,
            onUpdateTextConfig: updateTextConfig,
            onUpdateClipTransform: updateClipTransform,
            onUpdateClipSpeed: (clipId: string, speed: number) => setTimelineClips(timelineClips.map(c => c.id === clipId ? { ...c, speed, duration: c.duration } : c)),
            onUpdateChromaKeyConfig: updateChromaKeyConfig,
            apiKeyReady,
            onAddTrack: (type: 'video' | 'audio') => setTimelineTracks((prev) => {
                const newTrack = createTimelineTrack(type, prev);
                setActiveTrackId(newTrack.id);
                return [...prev, newTrack];
            }),
            onRemoveTrack: (trackId: string) => {
                setTimelineTracks((prev) => {
                    const next = prev.filter((track) => track.id !== trackId);
                    if (activeTrackId === trackId) {
                        setActiveTrackId(next[0]?.id || null);
                    }
                    return next;
                });
            },
            onUpdateTrack: (trackId: string, updates: Partial<Omit<TimelineTrack, 'id' | 'type'>>) =>
                setTimelineTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, ...updates } : t)),
            onSetActiveTrack: setActiveTrackId,
            isPlaying,
            onTogglePlayback: togglePlayback,
            onDeleteClip: () => { if (selectedClipId) { deleteClipFromTimeline(selectedClipId); } },
            onDropMedia: handleDropMedia,
            onDropEffectOnClip: (clipId: string, effect: EffectType) => applyCssEffectToClip(clipId, effect),
            onDropEffectStackOnClip: (clipId: string, stackId: string) => applyEffectStackToClip(clipId, stackId),
            onSmartFill: handleSmartFill,
        };

        switch (activeWorkspace) {
            case 'PROJECT':
                return (
                    <ProjectHubWorkspace
                        storyBible={storyBible}
                        setStoryBible={setStoryBible}
                        projectPath={projectPath}
                        projectSync={projectSync}
                        setProjectSync={setProjectSync}
                        projectCollaboration={projectCollaboration}
                        setProjectCollaboration={setProjectCollaboration}
                        syncStatus={projectSyncStatus}
                        activeProfileName={activeProfile?.name || ''}
                        onReloadProject={handleReloadProject}
                        onPushToCloud={() => {
                            if (projectPath && typeof window !== 'undefined' && window.electron?.project) {
                                pushProjectToCloud(projectPath);
                            }
                        }}
                        onPullFromCloud={() => {
                            if (typeof window !== 'undefined' && window.electron?.project) {
                                pullProjectFromCloud();
                            }
                        }}
                        shotPrompts={shotPrompts}
                        setShotPrompts={setShotPrompts}
                        onRoughCutReady={(newMedia) => {
                            setMediaItems([...mediaItems, ...newMedia]);
                            setActiveWorkspace('EDIT');
                        }}
                        apiKeyReady={apiKeyReady}
                        setApiKeyReady={setApiKeyReady}
                        setMediaItems={setMediaItems}
                        references={references}
                        setReferences={setReferences}
                        recentProjects={recentProjects}
                        onOpenRecentProject={handleOpenRecentProject}
                        onOpenProjectPicker={() => handleLoadProject()}
                        onOpenSettings={() => setShowSettings(true)}
                        canUseSceneWall={sceneWallFeatureAvailable}
                        sceneWallEnabled={sceneWallEnabled}
                        sceneWallState={sceneWallState}
                        onChangeSceneWallState={setSceneWallState}
                        onToggleSceneWallFeature={toggleSceneWallFeature}
                        onBuildSceneWallFromContext={(sourceName) => buildSceneWallFromCurrentProject(sourceName || 'Project Context')}
                        collaborativeLocks={activeCollaborativeLocks}
                        requestedPhase={projectHubRequestedPhase}
                        onBindStudioAutomation={(bindings) => {
                            projectHubAutomationRef.current = bindings;
                        }}
                        onSendWorldMeshToSetDesign={handleSendWorldMeshToSetDesign}
                        onActivityChange={({ activePhase, activeShotNumber }) => {
                            setProjectHubActivePhase(activePhase);
                            setProjectHubRequestedPhase((current) => {
                                if (!studioAgentAssistantControlActive || studioAgentYieldedToManualControl) {
                                    return null;
                                }
                                return current === activePhase ? null : current;
                            });
                            setProjectHubActiveShotNumber(activeShotNumber);
                        }}
                    />
                );
            case 'OUTFIT':
                return (
                    <OutfitWorkspace
                        references={references}
                        setReferences={setReferences}
                        onOpenProject={() => setActiveWorkspace('PROJECT')}
                    />
                );
            case 'ASSET_LIBRARY': return (
                <AssetLibraryWorkspace
                    currentProjectName={projectName || storyBible.title}
                    currentProjectPath={projectPath}
                    mediaItems={mediaItems}
                    references={references}
                    shotPrompts={shotPrompts}
                    recentProjects={recentProjects}
                    onEditImage={(asset) => {
                        if (!asset.url) return;
                        setPhotoSeedImage(asset.url);
                        setActiveWorkspace('PHOTO');
                    }}
                    onEditVideo={(asset) => {
                        if (!asset.url) return;
                        setCompositingSeedVideo(asset.url);
                        setActiveWorkspace('COMPOSITING');
                    }}
                    onAddStockImage={(item) => setMediaItems((prev) => [...prev, item])}
                />
            );
            case 'IMPORT': return <ImportWorkspace mediaItems={mediaItems} onAddMedia={handleAddMedia} onAddToTimeline={handleAddToTimeline} onImportTimelineOtio={handleImportTimelineOtio} />;
            case 'MICRODRAMA': return (
                <MicrodramaWorkspace
                    storyBible={storyBible}
                    setStoryBible={setStoryBible}
                    shotPrompts={shotPrompts}
                    setShotPrompts={setShotPrompts}
                    mediaItems={mediaItems}
                    setMediaItems={setMediaItems}
                    references={references}
                    setReferences={setReferences}
                    apiKeyReady={apiKeyReady}
                />
            );
            case 'DESIGN': return (
                <DesignWorkspace
                    designState={designCanvasState}
                    onChange={setDesignCanvasState}
                    mediaItems={mediaItems}
                    projectName={projectName || storyBible.title}
                    apiKeyReady={apiKeyReady}
                    onAddGeneratedMedia={(item) => setMediaItems(prev => [...prev, item])}
                    onExportDesign={handleExportDesignCanvas}
                    onGenerateImage={handleGenerateDesignImage}
                />
            );
            case 'EDIT': return (
                <EditWorkspace
                    {...commonProps}
                    references={references}
                    setReferences={setReferences}
                    aiTools={assistantTools}
                    aiToolExecutor={aiToolExecutor}
                    isAssistantVisible={isAssistantVisible}
                    setIsAssistantVisible={setIsAssistantVisible}
                    onGenerateVideoFromReference={() => { }}
                    onEditReferenceImage={() => { }}
                    onAddGeneratedMedia={(item) => setMediaItems(prev => [...prev, item])}
                    onUpdateMediaItem={(item) => setMediaItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, ...item } : entry))}
                    onAddMediaItems={addMediaItems}
                    onAddClips={addTimelineClips}
                />
            );
            case 'IMAGE_GEN': return (
                <ImageGenerationWorkspace
                    uiMode={uiMode}
                    apiKeyReady={apiKeyReady}
                    onAddGeneratedMedia={(item) => setMediaItems(prev => [...prev, item])}
                    mediaItems={mediaItems}
                    references={references}
                    shotPrompts={shotPrompts}
                    recentProjects={recentProjects}
                    currentProjectName={projectName || storyBible.title}
                    currentProjectPath={projectPath}
                    costRates={effectiveCostRates}
                    billingMode={isByokMode ? 'byok' : 'hosted'}
                    onValidateHostedGeneration={validateHostedGeneration}
                    onAnimateImage={handleAnimateImage}
                />
            );
            case 'VIDEO_GEN': return (
                <VideoGenerationWorkspace
                    apiKeyReady={apiKeyReady}
                    onAddGeneratedMedia={(item) => setMediaItems(prev => [...prev, item])}
                    mediaItems={mediaItems}
                    references={references}
                    shotPrompts={shotPrompts}
                    recentProjects={recentProjects}
                    currentProjectName={projectName || storyBible.title}
                    currentProjectPath={projectPath}
                    costRates={effectiveCostRates}
                    billingMode={isByokMode ? 'byok' : 'hosted'}
                    onValidateHostedGeneration={validateHostedGeneration}
                    seedImage={videoGenSeed}
                    onConsumeSeed={() => setVideoGenSeed(null)}
                />
            );
            case 'SOUND': return (
                <SoundWorkspace
                    apiKeyReady={apiKeyReady}
                    onAddGeneratedMedia={(item) => setMediaItems(prev => [...prev, item])}
                    mediaItems={mediaItems}
                    references={references}
                    shotPrompts={shotPrompts}
                    recentProjects={recentProjects}
                    currentProjectName={projectName || storyBible.title}
                    currentProjectPath={projectPath}
                />
            );
            case 'NODES': return (
                <NodeWorkspace
                    nodeGraph={nodeGraph}
                    onNodeGraphChange={setNodeGraph}
                    onAddGeneratedMedia={(item) => setMediaItems(prev => [...prev, item])}
                    apiKeyReady={apiKeyReady}
                    mediaItems={mediaItems}
                    references={references}
                    shotPrompts={shotPrompts}
                    recentProjects={recentProjects}
                    currentProjectName={projectName || storyBible.title}
                    currentProjectPath={projectPath}
                />
            );
            case 'SET_DESIGN': return (
                <SetDesignWorkspace
                    setDesign={setDesignState}
                    onChange={setSetDesignState}
                    apiKeyReady={apiKeyReady}
                    onAddGeneratedMedia={(item) => setMediaItems(prev => [...prev, item])}
                    mediaItems={mediaItems}
                    references={references}
                    shotPrompts={shotPrompts}
                    recentProjects={recentProjects}
                    currentProjectName={projectName || storyBible.title}
                    currentProjectPath={projectPath}
                    onApplySnapshotToShot={handleApplySetDesignSnapshotToShot}
                />
            );
            case 'SCENE_MAP': return (
                <SceneMapWorkspace
                    sceneMap={sceneMapState}
                    onChange={setSceneMapState}
                    references={references}
                    shotPrompts={shotPrompts}
                />
            );
            case 'WORLD_GEN': return (
                <WorldGenerationWorkspace
                    worldGen={worldGenState}
                    onChange={setWorldGenState}
                    onAddGeneratedMedia={(item) => setMediaItems(prev => [...prev, item])}
                    onSendToSetDesign={handleSendWorldMeshToSetDesign}
                />
            );
            case 'UPSCALE': return (
                <UpscaleWorkspace
                    apiKeyReady={apiKeyReady}
                    onAddGeneratedMedia={(item) => setMediaItems(prev => [...prev, item])}
                    mediaItems={mediaItems}
                    references={references}
                    shotPrompts={shotPrompts}
                    recentProjects={recentProjects}
                    currentProjectName={projectName || storyBible.title}
                    currentProjectPath={projectPath}
                />
            );
            case 'PHOTO': return (
                <PhotoWorkspace
                    onAddGeneratedMedia={(item) => setMediaItems(prev => [...prev, item])}
                    seedImageUrl={photoSeedImage}
                    onConsumeSeed={() => setPhotoSeedImage(null)}
                />
            );
            case 'AVATAR': return <AvatarWorkspace avatars={avatars} onUpdateAvatars={setAvatars} onAddGeneratedMedia={(item) => setMediaItems(prev => [...prev, item])} />;
            case 'TRIM': return <TrimWorkspace selectedClip={commonProps.selectedClip} selectedMedia={commonProps.selectedMedia} onTrim={(id, dur) => { setTimelineClips(timelineClips.map(c => c.id === id ? { ...c, end: c.start + dur, duration: dur } : c)); setActiveWorkspace('EDIT'); }} onCancel={() => setActiveWorkspace('EDIT')} />;
            case 'POST': return <PostWorkspace selectedClip={commonProps.selectedClip} selectedMedia={commonProps.selectedMedia} onUpdateFilters={updateClipFilters} timelineClips={timelineClips} mediaItems={mediaItems} storyBible={storyBible} />;
            case 'COMPOSITING': return (
                <CompositingWorkspace
                    apiKeyReady={apiKeyReady}
                    mediaItems={mediaItems}
                    onAddGeneratedMedia={(item) => setMediaItems(prev => [...prev, item])}
                    seedVideoUrl={compositingSeedVideo}
                    onConsumeSeed={() => setCompositingSeedVideo(null)}
                    currentProjectPath={projectPath}
                />
            );
            case 'ANALYSIS': return (
                <AnalysisWorkspace
                    onBack={() => setActiveWorkspace('PROJECT')}
                    videoFile={analysisVideoFile}
                    setVideoFile={setAnalysisVideoFile}
                    videoUrl={analysisVideoUrl}
                    setVideoUrl={setAnalysisVideoUrl}
                    scriptText={analysisScriptText}
                    setScriptText={setAnalysisScriptText}
                    analysisResult={analysisResult}
                    setAnalysisResult={setAnalysisResult}
                    targetAudience={storyBible.targetAudience ?? ''}
                    setTargetAudience={(val) => setStoryBible(prev => ({ ...prev, targetAudience: val }))}
                    audienceAnalysis={storyBible.audienceAnalysis ?? null}
                    setAudienceAnalysis={(val) => setStoryBible(prev => ({ ...prev, audienceAnalysis: val ?? undefined }))}
                />
            );
            case 'REVIEW': return (
                <ReviewWorkspace
                    reviewData={reviewData}
                    setReviewData={setReviewData}
                    projectName={projectName || storyBible.title}
                    storyBible={storyBible}
                    references={references}
                    shotPrompts={shotPrompts}
                    mediaItems={mediaItems}
                    profiles={profiles}
                    activeProfileId={activeProfileId}
                    namingTemplates={namingTemplates}
                    setNamingTemplates={setNamingTemplates}
                    collaborativeLocks={activeCollaborativeLocks}
                />
            );
            case 'REQUESTS': return (
                <RequestsWorkspace
                    reviewData={reviewData}
                    setReviewData={setReviewData}
                    shotPrompts={shotPrompts}
                    storyBible={storyBible}
                />
            );
            case 'MOODBOARD': return (
                <MoodboardWorkspace
                    storyBible={storyBible}
                    setStoryBible={setStoryBible}
                />
            );
            case 'NOTEBOOKLM': return (
                <NotebookLMWorkspace
                    storyBible={storyBible}
                    setStoryBible={setStoryBible}
                    onOpenMoodboard={() => setActiveWorkspace('MOODBOARD')}
                    onOpenSettings={() => setShowSettings(true)}
                />
            );
            case 'EXPORT': return <ExportWorkspace mediaItems={mediaItems} timelineClips={timelineClips} timelineTracks={timelineTracks} projectPath={projectPath} />;
            default: return <ScriptWorkspace />;
        }
    };

    return (
        <div className="app-shell relative flex flex-col h-screen overflow-hidden">
            <Header
                onUndo={undo}
                onRedo={redo}
                canUndo={canUndo}
                canRedo={canRedo}
                projectName={projectName || storyBible.title}
                projectPath={projectPath}
                lastSavedAt={lastSavedAt}
                lastAutoSavedAt={lastAutoSavedAt}
                isProjectSaving={isProjectSaving}
                isAutoSaving={isAutoSaving}
                isProjectLoading={isProjectLoading}
                onSelectProjectFolder={handleSelectProjectFolder}
                onSaveProject={handleSaveProject}
                onOpenProjectFolder={handleOpenProjectFolder}
                onCloseProject={handleCloseProject}
                user={user}
                onLogout={handleLogout}
                onOpenAbout={() => setShowAbout(true)}
                onOpenSettings={() => setShowSettings(true)}
                onOpenPricing={() => setShowPricing(true)}
                onOpenDesignSystem={() => {
                    if (canOpenDesignSystem) {
                        setShowDesignSystem(true);
                    }
                }}
                canOpenDesignSystem={canOpenDesignSystem}
                theme={theme}
                onSelectTheme={setTheme}
                uiMode={uiMode}
                onSelectUIMode={setUiMode}
                profiles={profiles}
                activeProfileId={activeProfileId}
                onSelectProfile={handleSwitchProfile}
                onCreateProfile={handleCreateProfile}
                onUpdateProfileRole={handleUpdateProfileRole}
                planLabel={planLabel}
                creditBalance={creditBalance}
                auxiliaryContent={(
                    <div className="header-auxiliary mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,1fr)]">
                        <PresenceBar
                            presence={realtimePresence}
                            configuredCollaboratorCount={projectCollaboration.collaborators.length}
                            realtimeStatus={realtimeStatus}
                            syncProvider={projectSync.provider || (collaborationDocStatus === 'connected' ? 'yjs' : null)}
                            localUserName={localCollaborator.name}
                            activeWorkspace={activeWorkspace}
                            activePhase={projectHubActivePhase}
                            activeShotNumber={projectHubActiveShotNumber}
                            selectedClipId={selectedClipId}
                            locks={activeCollaborativeLocks}
                            latestAgentActivity={latestAgentActivity}
                        />
                        <StudioAgentStrip
                            state={studioAgentState}
                            activeTask={activeStudioAgentTask}
                            approvalBundle={studioAgentApprovalBundle}
                            selectedClipId={selectedClipId}
                            showQuickActions={false}
                            onExecute={executeStudioAgent}
                            onResumeTaskQueue={() => resumeStudioAgentTaskQueue()}
                            onApprovePending={approveStudioAgentAction}
                            onRejectPending={() => rejectStudioAgentAction()}
                        />
                    </div>
                )}
            />
            <RemoteCursorOverlay
                presence={realtimePresence}
                localCollaboratorId={localCollaborator.id}
            />
            {!isElectron && (trialExpired || lowCredits) && (
                <div className="px-6 py-3 border-b border-amber-500/30 bg-amber-500/10 text-amber-100 text-sm">
                    <div className="container mx-auto flex flex-wrap items-center justify-between gap-3">
                        <div>
                            {trialExpired && 'Your 7‑day trial ended. Choose a plan to keep full access.'}
                            {!trialExpired && lowCredits && 'Low credits. Top up to continue hosted generation.'}
                            {!trialExpired && creditsExhausted && ' Credits are exhausted. Generation is paused until top-up.'}
                        </div>
                        <a
                            href="./studio.html"
                            className="px-3 py-1 rounded-full border border-amber-300/40 text-amber-100 text-xs hover:bg-amber-300/10"
                        >
                            Open Billing
                        </a>
                    </div>
                </div>
            )}
            <WorkspaceSwitcher
                activeWorkspace={activeWorkspace}
                onSwitch={handleManualWorkspaceSwitch}
                uiMode={uiMode}
                allowedWorkspaces={allowedWorkspaces}
                showReview={isDirector}
                showRequests={!isDirector}
            />
            {!isDirector && requestSummaries.length > 0 && (
                <div className="px-6 py-3 border-b border-slate-500/20 bg-slate-900/40 text-slate-200">
                    <div className="container mx-auto flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <div className="text-xs uppercase tracking-[0.2em] text-amber-300">Director Requests</div>
                            <div className="text-sm">
                                {requestSummaries.length} change request{requestSummaries.length === 1 ? '' : 's'} pending.
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                            {requestSummaries.map((request) => (
                                <span key={request.id} className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5">
                                    {request.type} {request.action} {request.targetName}
                                    {request.affectedShots.length > 0 ? ` → shots ${request.affectedShots.join(', ')}` : ''}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            )}
            <main className={`app-main-surface flex-grow overflow-hidden ${blockForBilling ? 'pointer-events-none opacity-45' : ''}`}>
                {renderWorkspace()}
            </main>
            {blockForBilling && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="mx-6 w-full max-w-md rounded-2xl border border-amber-300/30 bg-slate-950/95 p-6 text-center text-slate-100 shadow-2xl">
                        <div className="text-xs uppercase tracking-[0.22em] text-amber-300">Billing Required</div>
                        <h2 className="mt-2 text-xl font-semibold">
                            {trialExpired ? 'Trial ended' : 'Credits exhausted'}
                        </h2>
                        <p className="mt-2 text-sm text-slate-300">
                            {trialExpired
                                ? 'Choose a plan or buy credits to continue using the web app.'
                                : 'Top up your hosted credits to continue AI generation in the web app.'}
                        </p>
                        <div className="mt-5 flex items-center justify-center gap-3">
                            <a
                                href="./studio.html"
                                className="rounded-full bg-amber-300 px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-200"
                            >
                                Open Billing
                            </a>
                            <button
                                type="button"
                                className="rounded-full border border-slate-500 px-4 py-2 text-xs text-slate-200 hover:bg-slate-800"
                                onClick={() => refreshBilling(teamId)}
                            >
                                Refresh Status
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <FloatingActionButton
                onAssistantClick={() => setIsAssistantVisible(true)}
                onLiveClick={() => setIsLiveVisible(true)}
                showLiveAction={showLiveConversationTool}
            />

            {isAssistantVisible && (
                <>
                    <button
                        type="button"
                        className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[1px]"
                        onClick={() => setIsAssistantVisible(false)}
                        aria-label="Close assistant"
                    />
                    <div className="fixed inset-y-0 right-0 z-[70] w-full max-w-md border-l border-gray-700 bg-gray-900 shadow-2xl">
                        <button
                            type="button"
                            onClick={() => setIsAssistantVisible(false)}
                            className="absolute right-3 top-3 z-10 rounded-md bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
                        >
                            Close
                        </button>
                        <AIAssistant
                            apiKeyReady={apiKeyReady}
                            tools={assistantTools}
                            toolExecutor={aiToolExecutor}
                            context={assistantContext}
                            onUserTurnStart={handleAssistantTurnStart}
                        />
                    </div>
                </>
            )}

            {isLiveVisible && (
                <LiveConversation
                    apiKeyReady={apiKeyReady}
                    onClose={() => setIsLiveVisible(false)}
                    directorTools={directorTools}
                    directorToolExecutor={directorToolExecutor}
                    systemInstruction={`You are a Director AI Assistant for a video editor.
            Current Playhead: ${playheadPosition.toFixed(2)}s.
            Selected Clip ID: ${selectedClipId || 'None'}.
            Tracks: ${timelineTracks.map(t => t.type).join(', ')}.
            Available actions: Split clips, toggle playback, delete clips, zoom effects, mute music, auto-mix audio.
                    Listen to the user's voice command and execute the tool.`}
                />
            )}

            <OnboardingModal
                isOpen={showOnboarding}
                theme={theme}
                onSelectTheme={setTheme}
                startupPreferences={startupPreferences}
                onUpdateStartupPreferences={setStartupPreferences}
                hasAnyApiKey={hasAnyApiKeyConfigured}
                onOpenApiSettings={() => {
                    setShowOnboarding(false);
                    setShowSettings(true);
                }}
                onOpenAssistant={() => setIsAssistantVisible(true)}
                onNavigateWorkspace={setActiveWorkspace}
                onComplete={completeOnboarding}
                uiMode={uiMode}
                onSelectUIMode={setUiMode}
            />

            {(!showOnboarding && (!apiKeyReady || showSettings)) && (
                <ApiKeyModal
                    onKeySelected={() => {
                        setApiKeyReady(true);
                        setShowSettings(false);
                    }}
                    onClose={apiKeyReady ? () => setShowSettings(false) : undefined}
                    shortcuts={shortcuts}
                    onUpdateShortcuts={setShortcuts}
                    autosaveSettings={autosaveSettings}
                    onUpdateAutosaveSettings={setAutosaveSettings}
                    startupPreferences={startupPreferences}
                    onUpdateStartupPreferences={setStartupPreferences}
                    onRestartOnboarding={() => {
                        localStorage.removeItem(ONBOARDING_COMPLETED_KEY);
                        setShowSettings(false);
                        setShowOnboarding(true);
                    }}
                />
            )}
            {showPricing && (
                <PricingScreen
                    onSelectPlan={(plan) => {
                        if (!user) return;
                        setUser({ ...user, plan });
                    }}
                    onClose={() => setShowPricing(false)}
                    usageLedger={usageLedger}
                    costSettings={costSettings}
                    onUpdateCostSettings={setCostSettings}
                    projectName={projectName || storyBible.title || 'Untitled Project'}
                    canView={canViewPricing}
                    activeRole={activeRole}
                />
            )}
            <OptionsModal
                isOpen={!!modalConfig}
                config={modalConfig}
                onClose={() => setModalConfig(null)}
                onSubmit={async (values, pricing) => {
                    if (
                        pricing &&
                        pricing.mode !== 'byok' &&
                        pricing.provider &&
                        pricing.kind
                    ) {
                        const validation = await validateHostedGeneration({
                            provider: pricing.provider,
                            kind: pricing.kind,
                            model: pricing.model,
                            units: pricing.units,
                            credits: pricing.credits,
                        });
                        if (!validation.ok) {
                            alert(validation.message || 'Hosted generation blocked by billing guardrail.');
                            return;
                        }
                    }
                    if (modalSubmitHandler) {
                        await modalSubmitHandler(values, pricing);
                    }
                }}
            />
            <DesignSystemSheet
                isOpen={showDesignSystem}
                onClose={() => setShowDesignSystem(false)}
                theme={theme}
                onSelectTheme={setTheme}
            />

            {showAbout && user && (
                <AboutModal
                    user={user}
                    onClose={() => setShowAbout(false)}
                />
            )}
        </div>
    );
}

export default App;
