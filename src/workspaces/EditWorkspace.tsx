import React, { useState, useEffect, useRef, useCallback, useMemo, useReducer } from 'react';
import {
    AgentApplyBatchSummary,
    AgentReviewPassResult,
    EditPlan,
    EditPlanApplyResult,
    EditPlanPreview,
    MediaItem,
    NeurocinematicsAnalysisResult,
    RecentProject,
    ShotPrompt,
    TimelineClip,
    EffectType,
    Effect,
    ReferenceItem,
    TransitionType,
    TimelineTrack,
    TitleMotionPreset,
    WaveformCache,
    Workspace,
} from '../types';
import { FunctionDeclaration } from '@google/genai';
import MediaBin from '../components/MediaBin';
import EffectsPanel from '../components/EffectsPanel';
import PreviewPlayer from '../components/PreviewPlayer';
import Timeline from '../components/Timeline';
import InspectorPanel from '../components/InspectorPanel';
import TransitionsPanel from '../components/TransitionsPanel';
import ImageEditorModal from '../components/ImageEditorModal';
import EditorAgentPanel from '../components/EditorAgentPanel';
import TitlesPanel, { TitlePreset } from '../components/TitlesPanel';
import { ChevronLeftIcon, ChevronRightIcon, BrushIcon, MaximizeIcon, KeyboardIcon, PaletteIcon, FilmIcon, TextIcon, EffectsIcon, TransitionsIcon, MusicNoteIcon, ScissorsIcon, BrainIcon } from '../components/icons';
import EditTransportBar from '../components/EditTransportBar';
import { formatTimecode, DEFAULT_TIMELINE_FPS } from '../utils/timecode';
import AutoCutPanel from '../components/AutoCutPanel';
import LookbookPanel from '../components/LookbookPanel';
import MusicAssistantPanel from '../components/MusicAssistantPanel';
import { VideoSegment } from '../services/autoCutService';
import { useLibraryAssets, type LibraryAsset } from '../hooks/useLibraryAssets';
import { ArrowDownToLine, ArrowRightToLine, ArrowUpFromLine, FoldHorizontal, Frame, Maximize } from 'lucide-react';
import { createFxInstance } from '../fx/registry';
import ProDock from './edit-pro/ProDock';
import {
    AudioMetersPanel,
    AudioMixerPanel,
    EffectControlsPanel,
    EffectsBrowserPanel,
    HistoryPanel,
    InfoPanel,
    ProjectViewToggle,
    ToolsPanel,
    WorkspaceBar,
    useSessionHistory,
    useTrackLevels,
} from './edit-pro/ProPanels';
import {
    EDITOR_TOOLS,
    loadProLayoutState,
    proLayoutReducer,
    resolveProShortcut,
    saveProLayoutState,
    textPositionForPoint,
    toolForTrimMode,
    trimModeForTool,
    PRO_WORKSPACES,
    type EditorToolId,
    type MonitorZoom,
    type ProWorkspaceId,
    type ProPanelId,
} from './edit-pro/proLayout';
import './edit-pro/proEditor.css';
import ModeBar from './edit-pro/ModeBar';
import SequenceMarkersPanel from './edit-pro/SequenceMarkersPanel';
import TimecodeField from './edit-pro/TimecodeField';
import { PlaybackResolutionContext } from './edit-pro/PlaybackResolutionContext';
import {
    fxMaxDimensionFor,
    isPlaybackResolution,
    PLAYBACK_RESOLUTIONS,
    type PlaybackResolution,
    type PlaybackResolutionValue,
} from './edit-pro/playbackResolution';
import {
    addMarker,
    markerColorHex,
    markerLabel,
    nextMarker,
    previousMarker,
    removeMarker,
    rippleMarkers,
    updateMarker,
    type MarkerPatch,
    type SequenceMarker,
} from './edit-pro/markers';
import { extractRange, liftRange, rangeEditTracks } from './edit-pro/editOps';
import { registerLiveCommands } from '../mcp/liveCommands';
import { EDIT_LIVE } from '../mcp/modules/timelineTools';
import { EDIT_SHORTCUT_DOCS, formatShuttleRate, nextShuttleRate, resolveEditShortcut, shuttleStepFrames } from './edit-pro/editShortcuts';

interface EditWorkspaceProps {
    mediaItems: MediaItem[];
    timelineClips: TimelineClip[];
    timelineTracks: TimelineTrack[];
    selectedClipId: string | null;
    selectedClip: TimelineClip | null;
    selectedMedia: MediaItem | null;
    playheadPosition: number;
    isSnappingEnabled: boolean;
    waveformCache: WaveformCache;
    onAddMedia: (files: FileList) => void;
    onAddToTimeline: (mediaId: string) => void;
    onImportLibraryAsset: (asset: LibraryAsset, options?: { addToTimeline?: boolean; collectToProject?: boolean; trackId?: string; startTime?: number; sourceIn?: number; sourceOut?: number; timelineIn?: number; timelineOut?: number; mode?: 'insert' | 'overwrite' }) => Promise<void> | void;
    onSelectClip: (clipId: string | null) => void;
    onCreateTextClip: (options?: {
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
        keyframes?: TimelineClip['keyframes'];
    }) => void;
    onApplyCSSEffect: (effect: EffectType) => void;
    onApplyEffectStack: (stackId: string) => void;
    onApplyAIEffect: (effect: Effect) => void;
    onApplyNativeEffect: (effect: Effect, value: string) => void;
    onUpdateClip: (updatedClip: TimelineClip) => void;
    onBatchUpdateClips: (updatedClips: TimelineClip[]) => void;
    onUpdateClipFilters: (clipId: string, filters: TimelineClip['filters']) => void;
    onApplyTransition: (clipId: string, transitionType: TransitionType) => void;
    onUpdateClipTransition: (clipId: string, transition: { type: TransitionType; duration: number } | null) => void;
    onUpdateTextConfig: (clipId: string, textConfig: TimelineClip['textConfig']) => void;
    onUpdateClipTransform: (clipId: string, transform: TimelineClip['transform']) => void;
    onUpdateChromaKeyConfig: (clipId: string, chromaKeyConfig: TimelineClip['chromaKey']) => void;
    onPlayheadUpdate: (newPosition: number) => void;
    onSnappingToggle: () => void;
    onSplitClip: (clipId: string, splitAt: number) => void;
    onUpdateClipSpeed: (clipId: string, newSpeed: number) => void;
    apiKeyReady: boolean;
    references: ReferenceItem[];
    setReferences: React.Dispatch<React.SetStateAction<ReferenceItem[]>>;
    aiTools: FunctionDeclaration[];
    aiToolExecutor: { [key: string]: Function };
    isAssistantVisible: boolean;
    setIsAssistantVisible: React.Dispatch<React.SetStateAction<boolean>>;
    onGenerateVideoFromReference: (ref: ReferenceItem) => void;
    onEditReferenceImage: (ref: ReferenceItem) => void;
    onAddTrack: (type: 'video' | 'audio') => void;
    onRemoveTrack: (trackId: string) => void;
    onUpdateTrack: (trackId: string, updates: Partial<Omit<TimelineTrack, 'id' | 'type'>>) => void;
    activeTrackId: string | null;
    onSetActiveTrack: (trackId: string) => void;
    isPlaying: boolean;
    onTogglePlayback: () => void;
    onDeleteClip: () => void;
    onRippleDeleteClip?: () => void;
    onDropMedia: (mediaId: string, trackId: string, time: number) => void;
    onDropLibraryAsset: (asset: LibraryAsset, trackId: string, time: number) => Promise<void> | void;
    onDropEffectOnClip: (clipId: string, effect: EffectType) => void;
    onDropEffectStackOnClip: (clipId: string, stackId: string) => void;
    onAddGeneratedMedia: (item: MediaItem) => void;
    onUpdateMediaItem: (item: MediaItem) => void;
    onAddMediaItems: (items: MediaItem[]) => void;
    onAddClips: (clips: TimelineClip[]) => void;
    trimMode: 'normal' | 'ripple' | 'roll' | 'slip' | 'slide';
    onTrimModeChange: (mode: 'normal' | 'ripple' | 'roll' | 'slip' | 'slide') => void;
    onThreePointEdit: (params: {
        mediaId: string;
        sourceIn?: number | null;
        sourceOut?: number | null;
        timelineIn?: number | null;
        timelineOut?: number | null;
        mode?: 'insert' | 'overwrite';
        trackId?: string;
    }) => { ok: boolean; message: string };
    onSwitchWorkspace?: (workspace: Workspace) => void;
    canAccessWorkspace?: (workspace: Workspace) => boolean;
    projectName?: string | null;
    currentProjectPath?: string | null;
    scriptText?: string | null;
    storyContext?: string | null;
    analysisResult?: NeurocinematicsAnalysisResult | null;
    shotPrompts?: ShotPrompt[];
    recentProjects?: RecentProject[];
    lastAgentApplyBatch?: AgentApplyBatchSummary | null;
    canUndoLastAgentApply: boolean;
    onPreviewEditPlan: (plan: EditPlan, selectedOperationIds?: string[]) => EditPlanPreview;
    onApplyEditPlan: (plan: EditPlan, selectedOperationIds?: string[]) => EditPlanApplyResult;
    onUndoLastAgentApply: () => void;
    onRunAgentReviewPass: (objective: string) => Promise<AgentReviewPassResult>;
    onGenerateSubtitlesFromClip: (clipId: string) => Promise<{ count: number; transcript: string }>;
    onApplyTitleMotionPreset: (clipId: string, preset: TitleMotionPreset) => void;
    onToggleTitleAutoContrast: (clipId: string, enabled: boolean) => void;
    onUpdateSubtitleClipContent: (clipId: string, content: string) => void;
    onSplitSubtitleClip: (clipId: string) => void;
    onMergeSubtitleClip: (clipId: string, direction: 'previous' | 'next') => void;
    /** Sequence markers saved with the project (optional; without it markers live for the session only). */
    sequenceMarkers?: SequenceMarker[];
    onSequenceMarkersChange?: (markers: SequenceMarker[]) => void;
}

/* ─── Sub-panels ─── */

type LibraryTabId = 'media' | 'lookbook' | 'titles' | 'effects' | 'transitions' | 'music' | 'autocut' | 'agent';
const LIBRARY_TAB_META: Array<{ id: LibraryTabId; label: string; description: string; icon: React.FC<{ className?: string }> }> = [
    { id: 'media', label: 'Media', description: 'Source files and generated assets', icon: FilmIcon },
    { id: 'lookbook', label: 'Lookbook', description: 'References, characters, environments', icon: PaletteIcon },
    { id: 'titles', label: 'Titles', description: 'Lower thirds, subtitles, kinetic text', icon: TextIcon },
    { id: 'effects', label: 'Effects', description: 'Visual effects and generators', icon: EffectsIcon },
    { id: 'transitions', label: 'Transitions', description: 'Cut, fade and wipe transitions', icon: TransitionsIcon },
    { id: 'music', label: 'Music', description: 'Music prompt analysis and generation', icon: MusicNoteIcon },
    { id: 'autocut', label: 'Auto Cut', description: 'AI segment selection and verification', icon: ScissorsIcon },
    { id: 'agent', label: 'Agent', description: 'Plan and apply safe AI edit suggestions', icon: BrainIcon },
];
const LIBRARY_TAB_KEY = 'edit_workspace_browser_tab_v1';

/** Content of the library tabs; shared by the classic browser rail and the pro layout panels. */
const renderLibraryContent = (activeTab: LibraryTabId, props: any): React.ReactNode => {
    switch (activeTab) {
        case 'lookbook':
            return <LookbookPanel references={props.references || []} onGenerateVideoFromRef={props.onGenerateVideoFromReference} onEditImageRef={props.onEditReferenceImage} />;
        case 'media':
            return (
                <MediaBin
                    mediaItems={props.mediaItems}
                    timelineClips={props.timelineClips}
                    timelineTracks={props.timelineTracks}
                    activeTrackId={props.activeTrackId}
                    playheadPosition={props.playheadPosition}
                    onAddMedia={props.onAddMedia}
                    onAddToTimeline={props.onAddToTimeline}
                    onLoadMediaToSource={props.onLoadMediaToSource}
                    onLoadLibraryAssetToSource={props.onLoadLibraryAssetToSource}
                    currentProjectName={props.projectName}
                    currentProjectPath={props.currentProjectPath}
                    references={props.references}
                    shotPrompts={props.shotPrompts}
                    recentProjects={props.recentProjects}
                    onImportLibraryAsset={props.onImportLibraryAsset}
                />
            );
        case 'titles':
            return (
                <TitlesPanel
                    timelineClips={props.timelineClips}
                    mediaItems={props.mediaItems}
                    selectedClip={props.selectedClip}
                    apiKeyReady={props.apiKeyReady}
                    previewFrameUrl={props.sourcePreviewFrame}
                    previewSourceLabel={props.sourcePreviewLabel}
                    onCreateTitleClip={props.onCreateTitleClip}
                    onApplyPresetToSelected={props.onApplyTitlePresetToSelected}
                    onApplyTreatmentToSelected={props.onApplyTitleTreatmentToSelected}
                    onApplyMotionToSelected={props.onApplyTitleMotionToSelected}
                    onToggleAutoContrastForSelected={props.onToggleTitleAutoContrastForSelected}
                    onGenerateSubtitlesFromSelected={props.onGenerateSubtitlesFromSelected}
                    onUpdateSubtitleClipContent={props.onUpdateSubtitleClipContent}
                    onSplitSubtitleClip={props.onSplitSubtitleClip}
                    onMergeSubtitleClip={props.onMergeSubtitleClip}
                    onSelectClip={props.onSelectClip}
                />
            );
        case 'effects':
            return (
                <EffectsPanel
                    onApplyEffect={props.onApplyCSSEffect}
                    onApplyAIEffect={props.onApplyAIEffect}
                    onApplyNativeEffect={props.onApplyNativeEffect}
                    onApplyEffectStack={props.onApplyEffectStack}
                    disabled={!props.selectedClipId}
                    previewFrameUrl={props.sourcePreviewFrame}
                    previewSourceLabel={props.sourcePreviewLabel}
                />
            );
        case 'transitions':
            return <TransitionsPanel onApplyTransition={(type: TransitionType) => props.selectedClipId && props.onApplyTransition(props.selectedClipId, type)} disabled={!props.selectedClipId} />;
        case 'music':
            return <MusicAssistantPanel timelineClips={props.timelineClips} mediaItems={props.mediaItems} onAddGeneratedMedia={props.onAddGeneratedMedia} apiKeyReady={props.apiKeyReady} />;
        case 'autocut':
            return (
                <AutoCutPanel
                        timelineClips={props.timelineClips}
                        timelineTracks={props.timelineTracks}
                        mediaItems={props.mediaItems}
                        selectedClipId={props.selectedClipId}
                        scriptText={props.scriptText}
                        storyContext={props.storyContext}
                        onUpdateClip={props.onUpdateClip}
                        onAddMediaItems={props.onAddMediaItems}
                        onAddClips={(clips: TimelineClip[]) => props.onAddClips(clips)}
                        onSplitClipWithSegments={(clipId: string, segments: VideoSegment[]) => {
                            const clip = props.timelineClips.find((c: TimelineClip) => c.id === clipId);
                            if (clip && segments.length > 0) {
                                const seg = segments[0];
                                props.onUpdateClip({ ...clip, sourceIn: seg.startTime, sourceOut: seg.endTime, duration: seg.endTime - seg.startTime });
                            }
                        }}
                    />
            );
        case 'agent':
            return (
                <EditorAgentPanel
                    mediaItems={props.mediaItems}
                    timelineClips={props.timelineClips}
                    timelineTracks={props.timelineTracks}
                    selectedClipId={props.selectedClipId}
                    playheadPosition={props.playheadPosition}
                    apiKeyReady={props.apiKeyReady}
                    projectName={props.projectName}
                    storyContext={props.storyContext}
                    analysisResult={props.analysisResult}
                    lastAppliedBatch={props.lastAgentApplyBatch}
                    canUndoLastAppliedBatch={props.canUndoLastAgentApply}
                    onPreviewPlan={props.onPreviewEditPlan}
                    onSelectClip={props.onSelectClip}
                    onApplyPlan={props.onApplyEditPlan}
                    onUndoLastAppliedBatch={props.onUndoLastAgentApply}
                    onRunReviewPass={props.onRunAgentReviewPass}
                />
            );
        default: return null;
    }
};

const LibraryPanel: React.FC<any> = (props) => {
    const [activeTab, setActiveTabState] = useState<LibraryTabId>(() => {
        if (typeof window === 'undefined') return 'media';
        const saved = window.localStorage?.getItem(LIBRARY_TAB_KEY) as LibraryTabId | null;
        return saved && LIBRARY_TAB_META.some((tab) => tab.id === saved) ? saved : 'media';
    });
    const setActiveTab = (id: LibraryTabId) => {
        setActiveTabState(id);
        try { window.localStorage?.setItem(LIBRARY_TAB_KEY, id); } catch { /* ignore */ }
    };

    const renderTabContent = () => renderLibraryContent(activeTab, props);

    return (
        <div className="edit-browser">
            <nav className="edit-browser__rail" aria-label="Browser panels">
                {LIBRARY_TAB_META.map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`edit-browser__rail-btn ${active ? 'edit-browser__rail-btn--active' : ''}`}
                            title={`${tab.label} · ${tab.description}`}
                            aria-label={tab.label}
                            aria-pressed={active}
                        >
                            <Icon className="w-[18px] h-[18px]" />
                        </button>
                    );
                })}
            </nav>
            <div className="edit-browser__content">{renderTabContent()}</div>
        </div>
    );
};

/* ─── Resizable Dividers with visual grip + double-click reset ─── */

const DraggableDivider: React.FC<{ onDrag: (delta: number) => void; onDoubleClick?: () => void }> = ({ onDrag, onDoubleClick }) => {
    const [active, setActive] = useState(false);
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        setActive(true);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        const move = (ev: MouseEvent) => onDrag(ev.clientX - startX);
        const up = () => { setActive(false); document.body.style.cursor = ''; document.body.style.userSelect = ''; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };
    return (
        <div className={`edit-divider-v ${active ? 'edit-divider-v--active' : ''}`} onMouseDown={handleMouseDown} onDoubleClick={onDoubleClick} title="Drag to resize · Double-click to reset">
            <div className="absolute inset-y-0 -left-1 -right-1 z-10" />
            <div className="edit-divider-v__grip" />
        </div>
    );
};

const HorizontalDraggableDivider: React.FC<{ onDrag: (delta: number) => void; onDoubleClick?: () => void }> = ({ onDrag, onDoubleClick }) => {
    const [active, setActive] = useState(false);
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        setActive(true);
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        const move = (ev: MouseEvent) => onDrag(ev.clientY - startY);
        const up = () => { setActive(false); document.body.style.cursor = ''; document.body.style.userSelect = ''; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };
    return (
        <div className={`edit-divider-h ${active ? 'edit-divider-h--active' : ''}`} onMouseDown={handleMouseDown} onDoubleClick={onDoubleClick} title="Drag to resize · Double-click to reset">
            <div className="absolute -top-1 -bottom-1 inset-x-0 z-10" />
            <div className="edit-divider-h__grip" />
        </div>
    );
};

/* ─── Keyboard Shortcuts Overlay ─── */

const SHORTCUT_SECTIONS: Array<{ title: string; shortcuts: Array<{ keys: string; desc: string }> }> = [
    {
        title: 'Playback',
        shortcuts: [
            { keys: 'Space / K', desc: 'Play / Pause' },
            { keys: 'J', desc: 'Play backward' },
            { keys: 'L', desc: 'Play forward' },
            { keys: 'Left / Right', desc: 'Step 1 frame' },
            { keys: 'Shift+Left/Right', desc: 'Step 1 second' },
            { keys: 'Up / Down', desc: 'Previous / next edit point' },
            { keys: 'Home / End', desc: 'Go to start / end' },
            { keys: 'Click timecode', desc: 'Type a position (1:05, +2, -1:00)' },
        ],
    },
    {
        title: 'Editing',
        shortcuts: [
            { keys: 'C', desc: 'Split / Cut at playhead' },
            { keys: 'Shift+Del', desc: 'Ripple delete' },
            { keys: 'Ctrl+Z', desc: 'Undo' },
            { keys: 'Ctrl+Shift+Z', desc: 'Redo' },
            { keys: 'Ctrl+C / V / X', desc: 'Copy / paste at playhead / cut' },
            { keys: 'Ctrl+D', desc: 'Duplicate clip' },
            { keys: 'Right-click clip', desc: 'Clip menu' },
            { keys: 'Del / Backspace', desc: 'Delete selected clip' },
        ],
    },
    {
        title: 'Trim Modes',
        shortcuts: [
            { keys: 'V', desc: 'Normal Trim' },
            { keys: 'R', desc: 'Ripple Trim' },
            { keys: 'O', desc: 'Roll Edit' },
            { keys: 'Y', desc: 'Slip Edit' },
            { keys: 'U', desc: 'Slide Edit' },
        ],
    },
    {
        title: 'Tracks & Media',
        shortcuts: [
            { keys: 'Alt+V', desc: 'Add video track' },
            { keys: 'Alt+A', desc: 'Add audio track' },
            { keys: 'Alt+S/M/L', desc: 'Add small/medium/large clip' },
            { keys: 'N', desc: 'Toggle snapping' },
        ],
    },
    {
        title: 'Monitors',
        shortcuts: [
            { keys: 'F11', desc: 'Fullscreen program monitor' },
            { keys: 'Esc', desc: 'Exit fullscreen / close' },
            { keys: 'Ctrl+Wheel', desc: 'Zoom timeline around cursor' },
        ],
    },
    {
        title: 'Profi-Layout: Marken, Schnitt, Shuttle',
        shortcuts: EDIT_SHORTCUT_DOCS,
    },
    {
        title: 'Profi-Layout (Schnitt/Farbe/Effekte/Audio)',
        shortcuts: [
            { keys: 'V / A / B / C', desc: 'Auswahl / Spur vorwärts / Ripple / Rasierklinge' },
            { keys: 'Y / H / T', desc: 'Slip / Hand / Text' },
            { keys: 'Cmd/Ctrl+K', desc: 'Clip an der Abspielposition teilen' },
            { keys: 'I / O', desc: 'In/Out (Quelle, wenn Quellmonitor fokussiert)' },
            { keys: 'Space', desc: 'Abspielen (fokussierter Monitor)' },
            { keys: '`', desc: 'Panel maximieren' },
        ],
    },
    {
        title: 'Layout',
        shortcuts: [
            { keys: '?', desc: 'Show this shortcuts panel' },
            { keys: 'F', desc: 'Toggle Focus mode' },
            { keys: '1-7', desc: 'Switch workspace (Media to Deliver)' },
        ],
    },
];

const ShortcutsOverlay: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); onClose(); } };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    return (
        <div className="edit-overlay" onClick={onClose}>
            <div className="edit-sheet" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-5">
                    <h2 className="edit-sheet__title">Keyboard shortcuts</h2>
                    <button onClick={onClose} className="edit-text-btn edit-text-btn--outline">Close</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
                    {SHORTCUT_SECTIONS.map(sec => (
                        <div key={sec.title}>
                            <h3 className="edit-sheet__section">{sec.title}</h3>
                            <div>
                                {sec.shortcuts.map(s => (
                                    <div key={s.keys} className="edit-sheet__row">
                                        <span>{s.desc}</span>
                                        <kbd className="edit-kbd">{s.keys}</kbd>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="mt-5 pt-3 border-t text-center text-xs" style={{ borderColor: 'var(--edit-hairline)', color: 'var(--app-muted)' }}>
                    Press <kbd className="edit-kbd">?</kbd> to toggle this sheet
                </div>
            </div>
        </div>
    );
};

/* ─── Fullscreen Monitor Overlay ─── */

const FullscreenMonitor: React.FC<{
    children: React.ReactNode;
    onClose: () => void;
}> = ({ children, onClose }) => {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' || e.key === 'F11') { e.preventDefault(); onClose(); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-[9998] bg-black flex flex-col" onDoubleClick={onClose}>
            <div className="flex-1 min-h-0 flex items-center justify-center" onClick={e => e.stopPropagation()}>
                {children}
            </div>
            <div className="flex-shrink-0 flex items-center justify-center gap-1 py-2 text-xs" style={{ color: 'rgb(255 255 255 / 0.55)' }}>
                Double-click or press <kbd className="edit-kbd">Esc</kbd> to exit fullscreen
            </div>
        </div>
    );
};

/* ─── Saved Layouts System ─── */

interface LayoutPreset {
    name: string;
    panelWidths: number[];
    collapsed: { left: boolean; right: boolean };
    tlHeight: number;
}

const LAYOUTS_STORAGE_KEY = 'edit_workspace_saved_layouts_v1';
const ACTIVE_LAYOUT_KEY = 'edit_workspace_active_layout_v1';

const BUILTIN_LAYOUTS: LayoutPreset[] = [
    { name: 'Default', panelWidths: [18, 64, 18], collapsed: { left: false, right: false }, tlHeight: 38 },
    { name: 'Wide Monitor', panelWidths: [12, 76, 12], collapsed: { left: false, right: false }, tlHeight: 32 },
    { name: 'Edit Focus', panelWidths: [18, 64, 18], collapsed: { left: true, right: true }, tlHeight: 55 },
    { name: 'Color Review', panelWidths: [18, 60, 22], collapsed: { left: true, right: false }, tlHeight: 28 },
    { name: 'Media Import', panelWidths: [26, 54, 20], collapsed: { left: false, right: false }, tlHeight: 30 },
];

const loadSavedLayouts = (): LayoutPreset[] => {
    if (typeof window === 'undefined') return [];
    try { const v = window.localStorage.getItem(LAYOUTS_STORAGE_KEY); return v ? JSON.parse(v) : []; } catch { return []; }
};

const saveSavedLayouts = (layouts: LayoutPreset[]) => {
    window.localStorage?.setItem(LAYOUTS_STORAGE_KEY, JSON.stringify(layouts));
};

/* ─── Constants ─── */

const PREVIEW_PRESETS = [
    { id: '16:9', label: '16:9', width: 1280, height: 720 },
    { id: '9:16', label: '9:16', width: 720, height: 1280 },
    { id: '1:1', label: '1:1', width: 1080, height: 1080 },
    { id: '4:3', label: '4:3', width: 1280, height: 960 },
    { id: '3:4', label: '3:4', width: 960, height: 1280 },
    { id: '2.35:1', label: '2.35:1', width: 1280, height: 545 },
    { id: 'custom', label: 'Custom', width: 1280, height: 720 },
];

const parseRatio = (value: string) => {
    const cleaned = value.trim().toLowerCase().replace(/\s+/g, '');
    if (!cleaned) return null;
    const parts = cleaned.split(/[:x/]/).filter(Boolean);
    if (parts.length === 1) { const r = Number.parseFloat(parts[0]); return Number.isFinite(r) && r > 0 ? r : null; }
    if (parts.length >= 2) { const l = Number.parseFloat(parts[0]); const r = Number.parseFloat(parts[1]); return Number.isFinite(l) && Number.isFinite(r) && r !== 0 ? l / r : null; }
    return null;
};


/* ─── Persistence ─── */

const PANEL_WIDTHS_KEY = 'edit_workspace_panel_widths_v3';
const PANEL_COLLAPSE_KEY = 'edit_workspace_panel_collapsed_v1';
const TIMELINE_HEIGHT_KEY = 'edit_workspace_timeline_height_v3';
const GUIDES_KEY = 'edit_workspace_guides_v1';
const MASK_KEY = 'edit_workspace_mask_v1';

const MASK_PRESETS: Array<{ id: string; label: string; ratio: number | null }> = [
    { id: 'none', label: 'No mask', ratio: null },
    { id: '2.39', label: '2.39:1', ratio: 2.39 },
    { id: '1.85', label: '1.85:1', ratio: 1.85 },
    { id: '16:9', label: '16:9', ratio: 16 / 9 },
    { id: '4:3', label: '4:3', ratio: 4 / 3 },
    { id: '1:1', label: '1:1', ratio: 1 },
    { id: '9:16', label: '9:16', ratio: 9 / 16 },
];

const DEFAULT_WIDTHS = [18, 64, 18];
const DEFAULT_TIMELINE = 38;
const MIN_PANEL = 10;
const MIN_TL = 16;
const MAX_TL = 80;

const loadJson = <T,>(key: string, fallback: T): T => {
    if (typeof window === 'undefined') return fallback;
    try { const v = window.localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};

const getInitWidths = () => {
    const w = loadJson<number[]>(PANEL_WIDTHS_KEY, DEFAULT_WIDTHS);
    return Array.isArray(w) && w.length === 3 && w.every(v => Number.isFinite(v) && v >= MIN_PANEL) ? w : DEFAULT_WIDTHS;
};
const getInitCollapse = () => {
    const c = loadJson<{ left?: boolean; right?: boolean }>(PANEL_COLLAPSE_KEY, { left: false, right: false });
    return { left: c.left === true, right: c.right === true };
};
const getInitTL = () => {
    const v = loadJson<number>(TIMELINE_HEIGHT_KEY, DEFAULT_TIMELINE);
    return Math.max(MIN_TL, Math.min(MAX_TL, Number.isFinite(v) ? v : DEFAULT_TIMELINE));
};

/** Callback-ref based element size (works for panels that mount and unmount with tabs). */
const useElementSize = () => {
    const [size, setSize] = useState({ width: 0, height: 0 });
    const observerRef = useRef<ResizeObserver | null>(null);
    const ref = useCallback((element: HTMLElement | null) => {
        observerRef.current?.disconnect();
        observerRef.current = null;
        if (!element || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect;
            if (rect) setSize((prev) => (prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }));
        });
        observer.observe(element);
        observerRef.current = observer;
        setSize({ width: element.clientWidth, height: element.clientHeight });
    }, []);
    useEffect(() => () => observerRef.current?.disconnect(), []);
    return [ref, size] as const;
};

const safeStorage = (): Storage | null => {
    try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
};

const isTypingTarget = (target: EventTarget | null) => {
    if (!target || !(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

const LINKED_SELECTION_KEY = 'edit_pro_linked_selection_v1';
const PLAYBACK_RES_KEY = 'edit_pro_playback_resolution_v1';

const MONITOR_ZOOM_OPTIONS: Array<{ value: MonitorZoom; label: string }> = [
    { value: 'fit', label: 'Einpassen' },
    { value: 25, label: '25 %' },
    { value: 50, label: '50 %' },
    { value: 75, label: '75 %' },
    { value: 100, label: '100 %' },
    { value: 150, label: '150 %' },
    { value: 200, label: '200 %' },
];

/* ─── Main Component ─── */

const EditWorkspace: React.FC<EditWorkspaceProps> = (props) => {
    const { mediaItems, timelineClips, selectedClipId, onUpdateClip, timelineTracks, waveformCache, onAddMedia } = props;

    const containerRef = useRef<HTMLDivElement>(null);
    const centerRef = useRef<HTMLDivElement>(null);
    const [panelWidths, setPanelWidths] = useState(getInitWidths);
    const [collapsed, setCollapsed] = useState(getInitCollapse);
    const [imageEditorOpen, setImageEditorOpen] = useState(false);
    const [preview, setPreview] = useState({ presetId: '16:9', width: 1280, height: 720 });
    const [customRatio, setCustomRatio] = useState('2.35:1');
    const [tlHeight, setTlHeight] = useState(getInitTL);
    const [monView, setMonView] = useState<'program' | 'source' | 'split'>('program');
    const [focusMode, setFocusMode] = useState(false);
    const [srcId, setSrcId] = useState<string | null>(null);
    const [externalSourceAsset, setExternalSourceAsset] = useState<LibraryAsset | null>(null);
    const [srcPlay, setSrcPlay] = useState(0);
    const [srcIn, setSrcIn] = useState<number | null>(null);
    const [srcOut, setSrcOut] = useState<number | null>(null);
    const [pgmIn, setPgmIn] = useState<number | null>(null);
    const [pgmOut, setPgmOut] = useState<number | null>(null);
    const [srcPlaying, setSrcPlaying] = useState(false);
    const srcVideoRef = useRef<HTMLVideoElement | null>(null);
    const srcAudioRef = useRef<HTMLAudioElement | null>(null);
    const srcRafRef = useRef<number | null>(null);
    const sourcePreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const sourcePreviewLastSampleRef = useRef(0);
    const [sourcePreviewFrame, setSourcePreviewFrame] = useState<string | null>(null);
    const focusSnapRef = useRef<{ collapsed: typeof collapsed; tlHeight: number; monView: typeof monView } | null>(null);
    const timelineClipsRef = useRef(timelineClips);
    timelineClipsRef.current = timelineClips;
    const playheadRef = useRef({ position: props.playheadPosition, update: props.onPlayheadUpdate });
    playheadRef.current = { position: props.playheadPosition, update: props.onPlayheadUpdate };
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [guides, setGuides] = useState<'off' | 'thirds' | 'safe' | 'both'>(() => (loadJson<string>(GUIDES_KEY, 'off') as 'off' | 'thirds' | 'safe' | 'both'));
    const [mask, setMask] = useState<string>(() => loadJson<string>(MASK_KEY, 'none'));
    const programStageRef = useRef<HTMLDivElement | null>(null);
    const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
    useEffect(() => { window.localStorage?.setItem(GUIDES_KEY, JSON.stringify(guides)); }, [guides]);
    useEffect(() => { window.localStorage?.setItem(MASK_KEY, JSON.stringify(mask)); }, [mask]);

    const [isFullscreen, setIsFullscreen] = useState(false);

    /* ─── Pro layout state (workspaces, docked panels, tool) ─── */
    const [pro, dispatchPro] = useReducer(proLayoutReducer, undefined, () => loadProLayoutState(safeStorage()));
    const isPro = pro.workspace !== 'classic';
    const isProRef = useRef(isPro);
    isProRef.current = isPro;
    useEffect(() => {
        const id = window.setTimeout(() => saveProLayoutState(safeStorage(), pro), 250);
        return () => window.clearTimeout(id);
    }, [pro]);
    const [proStageRef, proStageSize] = useElementSize();
    const [savedLayouts, setSavedLayouts] = useState<LayoutPreset[]>(loadSavedLayouts);
    const [activeLayoutName, setActiveLayoutName] = useState<string>(() => {
        if (typeof window === 'undefined') return '';
        return window.localStorage.getItem(ACTIVE_LAYOUT_KEY) || '';
    });

    const allLayouts = [...BUILTIN_LAYOUTS, ...savedLayouts];

    const applyLayout = useCallback((layout: LayoutPreset) => {
        setPanelWidths(layout.panelWidths);
        setCollapsed(layout.collapsed);
        setTlHeight(layout.tlHeight);
        setActiveLayoutName(layout.name);
        window.localStorage?.setItem(ACTIVE_LAYOUT_KEY, layout.name);
    }, []);

    const saveCurrentLayout = useCallback(() => {
        const name = window.prompt('Layout name:');
        if (!name?.trim()) return;
        const layout: LayoutPreset = { name: name.trim(), panelWidths, collapsed, tlHeight };
        const existing = savedLayouts.filter(l => l.name !== layout.name);
        const next = [...existing, layout];
        setSavedLayouts(next);
        saveSavedLayouts(next);
        setActiveLayoutName(layout.name);
        window.localStorage?.setItem(ACTIVE_LAYOUT_KEY, layout.name);
    }, [panelWidths, collapsed, tlHeight, savedLayouts]);

    const deleteLayout = useCallback((name: string) => {
        const next = savedLayouts.filter(l => l.name !== name);
        setSavedLayouts(next);
        saveSavedLayouts(next);
        if (activeLayoutName === name) setActiveLayoutName('');
    }, [savedLayouts, activeLayoutName]);

    // Global keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if (e.key === '?' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setShowShortcuts(prev => !prev); }
            if (e.key === 'F11') { e.preventDefault(); setIsFullscreen(prev => !prev); }
            if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !isProRef.current) { e.preventDefault(); toggleFocus(); }
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const frame = 1 / DEFAULT_TIMELINE_FPS;
            const sequenceEnd = timelineClipsRef.current.reduce((max, clip) => Math.max(max, clip.end), 0);
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const delta = (e.shiftKey ? 1 : frame) * (e.key === 'ArrowLeft' ? -1 : 1);
                playheadRef.current.update(Math.max(0, Math.min(sequenceEnd, playheadRef.current.position + delta)));
            }
            if (e.key === 'Home') { e.preventDefault(); playheadRef.current.update(0); }
            if (e.key === 'End') { e.preventDefault(); playheadRef.current.update(sequenceEnd); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    const { assets: browserLibraryAssets } = useLibraryAssets({
        currentProjectName: props.projectName,
        currentProjectPath: props.currentProjectPath,
        mediaItems,
        references: props.references,
        shotPrompts: props.shotPrompts,
        recentProjects: props.recentProjects,
    });

    const projectSrcMedia = (srcId ? mediaItems.find(i => i.id === srcId) : null) || null;
    const srcSource = useMemo(() => {
        if (externalSourceAsset?.url) {
            return {
                kind: 'library' as const,
                id: externalSourceAsset.id,
                name: externalSourceAsset.name,
                type: externalSourceAsset.kind === 'audio' ? 'audio' as const : externalSourceAsset.kind === 'video' ? 'video' as const : 'image' as const,
                url: externalSourceAsset.url,
                duration: externalSourceAsset.duration,
                projectLabel: externalSourceAsset.projectName,
            };
        }
        if (!projectSrcMedia) return null;
        return {
            kind: 'project' as const,
            id: projectSrcMedia.id,
            name: projectSrcMedia.name,
            type: projectSrcMedia.type,
            url: projectSrcMedia.url,
            duration: projectSrcMedia.duration,
            projectLabel: props.projectName || 'Current Project',
        };
    }, [externalSourceAsset, projectSrcMedia, props.projectName]);
    const srcDur = Math.max(0.1, srcSource?.duration || 5);

    const captureSourcePreviewFrame = useCallback((force = false) => {
        if (!srcSource) {
            setSourcePreviewFrame(null);
            return;
        }
        if (srcSource.type === 'image') {
            setSourcePreviewFrame(srcSource.url);
            return;
        }
        if (srcSource.type !== 'video') {
            setSourcePreviewFrame(null);
            return;
        }
        const video = srcVideoRef.current;
        if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

        const now = performance.now();
        if (!force && now - sourcePreviewLastSampleRef.current < 120) return;
        sourcePreviewLastSampleRef.current = now;

        let canvas = sourcePreviewCanvasRef.current;
        if (!canvas) {
            canvas = document.createElement('canvas');
            sourcePreviewCanvasRef.current = canvas;
        }

        const targetWidth = 320;
        const targetHeight = Math.max(120, Math.round(targetWidth * (video.videoHeight / video.videoWidth)));
        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        try {
            ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
            const url = canvas.toDataURL('image/jpeg', 0.78);
            setSourcePreviewFrame(url);
        } catch {
            // Ignore CORS-tainted frames.
        }
    }, [srcSource]);

    const seekSrc = (v: number) => {
        const n = Math.max(0, Math.min(srcDur, v));
        setSrcPlay(n);
        if (srcSource?.type === 'video' && srcVideoRef.current) srcVideoRef.current.currentTime = n;
        if (srcSource?.type === 'audio' && srcAudioRef.current) srcAudioRef.current.currentTime = n;
    };

    const markSrcIn = () => { const p = Math.max(0, Math.min(srcDur, srcPlay)); setSrcIn(p); if (srcOut !== null && srcOut <= p) setSrcOut(null); };
    const markSrcOut = () => { const p = Math.max(0, Math.min(srcDur, srcPlay)); setSrcOut(p); if (srcIn !== null && srcIn >= p) setSrcIn(null); };
    const markPgmIn = () => { setPgmIn(Math.max(0, props.playheadPosition)); if (pgmOut !== null && pgmOut <= props.playheadPosition) setPgmOut(null); };
    const markPgmOut = () => { setPgmOut(Math.max(0, props.playheadPosition)); if (pgmIn !== null && pgmIn >= props.playheadPosition) setPgmIn(null); };

    /**
     * Insert / overwrite from the source monitor. Missing marks fall back like
     * an NLE three-point edit: whole source (or In → end) and the playhead as
     * program In. `silent` returns the message instead of alerting (MCP).
     */
    const do3PE = (mode: 'insert' | 'overwrite', options: { silent?: boolean } = {}): { ok: boolean; message: string } => {
        // Non-blocking: a toast instead of window.alert (dialogs freeze the tab / automation).
        const fail = (message: string) => { if (!options.silent) setProNotice(message); return { ok: false, message }; };
        if (!srcSource) return fail('Erst ein Medium in den Quellmonitor laden.');
        if (srcSource.kind === 'library') {
            void props.onImportLibraryAsset(externalSourceAsset!, {
                collectToProject: true,
                sourceIn: srcIn ?? 0,
                sourceOut: srcOut ?? srcDur,
                timelineIn: pgmIn ?? undefined,
                timelineOut: pgmOut ?? undefined,
                mode,
                trackId: props.activeTrackId || undefined,
            });
            return { ok: true, message: `${mode === 'insert' ? 'Inserted' : 'Overwrote'} ${srcSource.name}.` };
        }
        const timelineIn = pgmIn ?? (pgmOut === null ? props.playheadPosition : null);
        const sourceIn = srcIn ?? (srcOut === null ? 0 : null);
        const pointCount = [sourceIn, srcOut, timelineIn, pgmOut].filter((value) => value !== null).length;
        const sourceOut = srcOut ?? (pointCount < 3 ? srcDur : null);
        const r = props.onThreePointEdit({ mediaId: srcSource.id, sourceIn, sourceOut, timelineIn, timelineOut: pgmOut, mode, trackId: props.activeTrackId || undefined });
        return r.ok ? r : fail(r.message);
    };

    const canSplit = collapsed.left && collapsed.right;
    const resolved: 'program' | 'source' | 'split' = monView === 'split' && canSplit ? 'split' : monView === 'source' ? 'source' : 'program';
    const effective = focusMode ? 'program' : resolved;
    const effectiveMonitorKey = `${effective}-${collapsed.left}-${collapsed.right}`;
    useEffect(() => {
        const element = programStageRef.current;
        if (!element || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect;
            if (rect) setStageSize({ width: rect.width, height: rect.height });
        });
        observer.observe(element);
        setStageSize({ width: element.clientWidth, height: element.clientHeight });
        return () => observer.disconnect();
    }, [effectiveMonitorKey]);

    const pauseSourcePlayback = useCallback(() => {
        srcVideoRef.current?.pause();
        srcAudioRef.current?.pause();
        setSrcPlaying(false);
    }, []);

    const stepSourceFrame = useCallback((direction: -1 | 1) => {
        if (!srcSource || srcSource.type === 'image') return;
        pauseSourcePlayback();
        seekSrc(srcPlay + direction * (1 / 24));
        captureSourcePreviewFrame(true);
    }, [captureSourcePreviewFrame, pauseSourcePlayback, seekSrc, srcPlay, srcSource]);

    const loadMediaToSource = useCallback((mediaId: string) => {
        setExternalSourceAsset(null);
        setSrcId(mediaId);
        setSrcPlay(0);
        setSrcIn(null);
        setSrcOut(null);
        setSrcPlaying(false);
        setMonView('source');
    }, []);

    const loadLibraryAssetToSource = useCallback((asset: LibraryAsset) => {
        if (!asset.url) return;
        setExternalSourceAsset(asset);
        setSrcId(null);
        const nextIn = Math.max(0, asset.trimInSeconds ?? 0);
        const rawOut = asset.trimOutSeconds ?? asset.duration ?? Math.max(nextIn + 0.5, 5);
        const nextOut = Math.max(nextIn + 0.5, rawOut);
        setSrcPlay(nextIn);
        setSrcIn(nextIn);
        setSrcOut(nextOut);
        setSrcPlaying(false);
        setMonView('source');
    }, []);

    const toggleSrcPlay = () => {
        if (!srcSource || srcSource.type === 'image') return;
        const el = srcSource.type === 'video' ? srcVideoRef.current : srcAudioRef.current;
        if (!el) return;
        if (el.paused) el.play().then(() => setSrcPlaying(true)).catch(() => setSrcPlaying(false));
        else { el.pause(); setSrcPlaying(false); }
    };

    const createTitleClipFromPreset = useCallback((preset: TitlePreset) => {
        props.onCreateTextClip({
            content: preset.content,
            font: preset.textConfig.font,
            size: preset.textConfig.size,
            color: preset.textConfig.color,
            position: preset.textConfig.position,
            autoContrast: preset.textConfig.autoContrast,
            motionPreset: preset.textConfig.motionPreset,
            background: preset.textConfig.background,
            duration: preset.duration,
            transform: preset.transform,
            keyframes: preset.keyframes,
        });
        setMonView('program');
    }, [props]);

    const applyTitlePresetToSelected = useCallback((preset: TitlePreset) => {
        if (!props.selectedClip) {
            createTitleClipFromPreset(preset);
            return;
        }
        const existingContent = props.selectedClip.textConfig?.content?.trim();
        props.onUpdateClip({
            ...props.selectedClip,
            textConfig: {
                ...preset.textConfig,
                content: existingContent || preset.content,
            },
        });
        props.onSelectClip(props.selectedClip.id);
    }, [createTitleClipFromPreset, props]);

    const applyTitleTreatmentToSelected = useCallback((treatment: 'subtitle-plate' | 'lower-third-bar' | 'clear') => {
        if (!props.selectedClip?.textConfig) return;
        const baseTextConfig = props.selectedClip.textConfig;
        let nextTextConfig: NonNullable<TimelineClip['textConfig']>;

        switch (treatment) {
            case 'subtitle-plate':
                nextTextConfig = {
                    ...baseTextConfig,
                    position: 'bottom-center',
                    size: Math.max(36, Math.min(48, baseTextConfig.size || 40)),
                    background: {
                        enabled: true,
                        color: '#020617',
                        opacity: 0.72,
                        paddingX: 20,
                        paddingY: 10,
                        radius: 18,
                        style: 'plate',
                    },
                };
                break;
            case 'lower-third-bar':
                nextTextConfig = {
                    ...baseTextConfig,
                    position: 'bottom-left',
                    background: {
                        enabled: true,
                        color: '#0f172a',
                        opacity: 0.8,
                        paddingX: 28,
                        paddingY: 14,
                        radius: 18,
                        style: 'lower-third-bar',
                    },
                };
                break;
            default:
                nextTextConfig = {
                    ...baseTextConfig,
                    background: undefined,
                };
                break;
        }

        props.onUpdateClip({
            ...props.selectedClip,
            textConfig: nextTextConfig,
        });
        props.onSelectClip(props.selectedClip.id);
    }, [props]);

    const generateSubtitlesFromSelected = useCallback(() => {
        if (!props.selectedClip?.id) {
            throw new Error('Select a video or audio clip first.');
        }
        return props.onGenerateSubtitlesFromClip(props.selectedClip.id);
    }, [props]);

    const applyTitleMotionToSelected = useCallback((preset: TitleMotionPreset) => {
        if (!props.selectedClip?.textConfig) return;
        props.onApplyTitleMotionPreset(props.selectedClip.id, preset);
        props.onSelectClip(props.selectedClip.id);
    }, [props]);

    const toggleTitleAutoContrastForSelected = useCallback((enabled: boolean) => {
        if (!props.selectedClip?.textConfig) return;
        props.onToggleTitleAutoContrast(props.selectedClip.id, enabled);
        props.onSelectClip(props.selectedClip.id);
    }, [props]);

    const usedMediaIds = useMemo(() => new Set(timelineClips.map((clip) => clip.mediaId)), [timelineClips]);
    const recentLibraryCandidates = useMemo(
        () => browserLibraryAssets.filter((asset) => asset.origin === 'recent' && asset.url && asset.kind !== 'audio'),
        [browserLibraryAssets],
    );

    const handleMatchTimelineGap = useCallback(async (gap: {
        trackId: string;
        start: number;
        end: number;
        duration: number;
        previousClipId?: string | null;
        nextClipId?: string | null;
        suggestedCoverage: 'insert' | 'alt-angle' | 'b-roll';
    }) => {
        const STOPWORDS = new Set(['about', 'after', 'again', 'before', 'between', 'camera', 'close', 'could', 'frame', 'image', 'project', 'scene', 'shot', 'their', 'there', 'these', 'video']);
        const ALT_ANGLE_HINTS = ['angle', 'alternate', 'profile', 'side', 'wide', 'close', 'overhead', 'detail', 'insert', 'shoulder'];
        const BROLL_HINTS = ['b-roll', 'broll', 'cutaway', 'detail', 'insert', 'establishing', 'atmosphere', 'montage', 'texture'];
        const INSERT_HINTS = ['insert', 'detail', 'close', 'macro', 'hand', 'prop'];

        const buildText = (value: { name?: string; prompt?: string; generatedBy?: string; detail?: string; projectName?: string; source?: string }) =>
            [value.name, value.prompt, value.generatedBy, value.detail, value.projectName, value.source]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();

        const tokenize = (text: string) => {
            const tokenSet = new Set<string>();
            text.split(/[^a-z0-9]+/).forEach((token) => {
                if (token.length < 4 || STOPWORDS.has(token)) return;
                tokenSet.add(token);
            });
            return tokenSet;
        };

        const previousClip = gap.previousClipId ? timelineClips.find((clip) => clip.id === gap.previousClipId) || null : null;
        const nextClip = gap.nextClipId ? timelineClips.find((clip) => clip.id === gap.nextClipId) || null : null;
        const contextTokens = new Set<string>();
        [previousClip, nextClip]
            .map((clip) => clip ? mediaItems.find((item) => item.id === clip.mediaId) : null)
            .filter(Boolean)
            .forEach((item) => {
                tokenize(buildText(item!)).forEach((token) => contextTokens.add(token));
            });

        const needKeywords = gap.suggestedCoverage === 'b-roll'
            ? BROLL_HINTS
            : gap.suggestedCoverage === 'alt-angle'
                ? ALT_ANGLE_HINTS
                : INSERT_HINTS;

        const scoreCandidate = (text: string, candidateDuration: number | undefined, opts: { isUsed: boolean; isGenerated: boolean; isLibrary: boolean }) => {
            const tokens = tokenize(text);
            const contextScore = Array.from(tokens).reduce((score, token) => score + (contextTokens.has(token) ? 2 : 0), 0);
            const keywordScore = needKeywords.reduce((score, keyword) => score + (text.includes(keyword) ? 2 : 0), 0);
            const duration = Math.max(0.5, candidateDuration || gap.duration || 0.5);
            const durationScore = Math.max(0, 5 - Math.abs(duration - gap.duration));
            const freshnessScore = opts.isUsed ? 0 : 2;
            const generatedScore = opts.isGenerated ? 1 : 0;
            const libraryScore = opts.isLibrary ? 1 : 0;
            return contextScore + keywordScore + durationScore + freshnessScore + generatedScore + libraryScore;
        };

        let best:
            | { score: number; type: 'project'; media: MediaItem }
            | { score: number; type: 'library'; asset: LibraryAsset }
            | null = null;

        mediaItems
            .filter((item) => item.type !== 'audio')
            .forEach((item) => {
                const score = scoreCandidate(buildText(item), item.duration, {
                    isUsed: usedMediaIds.has(item.id),
                    isGenerated: item.source === 'generated' || Boolean(item.generatedBy),
                    isLibrary: false,
                });
                if (!best || score > best.score) {
                    best = { score, type: 'project', media: item };
                }
            });

        recentLibraryCandidates.forEach((asset) => {
            const score = scoreCandidate(buildText(asset), asset.duration, {
                isUsed: false,
                isGenerated: Boolean(asset.generatedBy || asset.prompt),
                isLibrary: true,
            });
            if (!best || score > best.score) {
                best = { score, type: 'library', asset };
            }
        });

        if (!best || best.score < 3) {
            setProNotice('Kein passender Clip für die Lücke gefunden – im Projekt-Panel manuell wählen.');
            return;
        }

        if (best.type === 'project') {
            const usableDuration = Math.max(0.5, Math.min(best.media.duration || gap.duration, gap.duration));
            const result = props.onThreePointEdit({
                mediaId: best.media.id,
                sourceIn: 0,
                sourceOut: usableDuration,
                timelineIn: gap.start,
                timelineOut: gap.start + usableDuration,
                mode: 'overwrite',
                trackId: gap.trackId,
            });
            if (!result.ok) {
                setProNotice(result.message);
                return;
            }
            loadMediaToSource(best.media.id);
            return;
        }

        const sourceIn = Math.max(0, best.asset.trimInSeconds ?? 0);
        const availableDuration = Math.max(0.5, (best.asset.trimOutSeconds ?? best.asset.duration ?? gap.duration) - sourceIn);
        const usableDuration = Math.max(0.5, Math.min(availableDuration, gap.duration));
        const matchedAsset: LibraryAsset = {
            ...best.asset,
            trimInSeconds: sourceIn,
            trimOutSeconds: sourceIn + usableDuration,
        };
        loadLibraryAssetToSource(matchedAsset);
        await props.onImportLibraryAsset(matchedAsset, {
            collectToProject: true,
            sourceIn,
            sourceOut: sourceIn + usableDuration,
            timelineIn: gap.start,
            timelineOut: gap.start + usableDuration,
            mode: 'overwrite',
            trackId: gap.trackId,
        });
    }, [browserLibraryAssets, loadLibraryAssetToSource, loadMediaToSource, mediaItems, props, recentLibraryCandidates, timelineClips, usedMediaIds]);

    useEffect(() => {
        const sourceHotkeysArmed = Boolean(srcSource && (isPro ? pro.focusedPanel === 'source' : effective !== 'program'));
        if (!sourceHotkeysArmed) return;

        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

            const key = e.key.toLowerCase();
            const intercept = () => {
                e.preventDefault();
                e.stopPropagation();
                (e as KeyboardEvent).stopImmediatePropagation?.();
            };

            if (key === 'j') {
                intercept();
                pauseSourcePlayback();
                seekSrc(srcPlay - (e.shiftKey ? 1 : 0.25));
                captureSourcePreviewFrame(true);
                return;
            }
            if (key === 'k') {
                intercept();
                pauseSourcePlayback();
                captureSourcePreviewFrame(true);
                return;
            }
            if (key === 'l') {
                intercept();
                const mediaEl = srcSource?.type === 'video' ? srcVideoRef.current : srcAudioRef.current;
                if (mediaEl) {
                    mediaEl.playbackRate = e.shiftKey ? 2 : 1;
                }
                toggleSrcPlay();
                return;
            }
            if ((key === ',' && !isPro) || key === 'arrowleft') {
                intercept();
                stepSourceFrame(-1);
                return;
            }
            if ((key === '.' && !isPro) || key === 'arrowright') {
                intercept();
                stepSourceFrame(1);
                return;
            }
            if (key === 'i') {
                intercept();
                markSrcIn();
                return;
            }
            if (key === 'o') {
                intercept();
                markSrcOut();
            }
        };

        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [captureSourcePreviewFrame, effective, isPro, pro.focusedPanel, pauseSourcePlayback, srcPlay, srcSource, stepSourceFrame, toggleSrcPlay]);

    const handleDrag = (idx: number) => (dx: number) => {
        if (!containerRef.current) return;
        const dp = (dx / containerRef.current.offsetWidth) * 100;
        setPanelWidths(prev => {
            const n = [...prev]; n[idx] += dp; n[idx + 1] -= dp;
            return n[idx] < MIN_PANEL || n[idx + 1] < MIN_PANEL ? prev : n;
        });
    };

    const handleVDrag = (dy: number) => {
        if (!centerRef.current) return;
        const h = centerRef.current.offsetHeight;
        if (!h) return;
        setTlHeight(prev => Math.max(MIN_TL, Math.min(MAX_TL, prev + (dy / h) * 100)));
    };

    const resetWidths = () => setPanelWidths(DEFAULT_WIDTHS);
    const resetTL = () => setTlHeight(DEFAULT_TIMELINE);
    const togglePanel = (p: 'left' | 'right') => setCollapsed(prev => ({ ...prev, [p]: !prev[p] }));

    const toggleFocus = () => {
        if (!focusMode) {
            focusSnapRef.current = { collapsed, tlHeight, monView };
            setCollapsed({ left: true, right: true }); setTlHeight(55); setMonView('program'); setFocusMode(true);
        } else {
            const s = focusSnapRef.current;
            if (s) { setCollapsed(s.collapsed); setTlHeight(s.tlHeight); setMonView(s.monView); }
            focusSnapRef.current = null; setFocusMode(false);
        }
    };

    // Persistence
    useEffect(() => { if (preview.presetId !== 'custom') setCustomRatio(preview.presetId); }, [preview.presetId]);
    useEffect(() => { window.localStorage?.setItem(PANEL_WIDTHS_KEY, JSON.stringify(panelWidths)); }, [panelWidths]);
    useEffect(() => { window.localStorage?.setItem(PANEL_COLLAPSE_KEY, JSON.stringify(collapsed)); }, [collapsed]);
    useEffect(() => { window.localStorage?.setItem(TIMELINE_HEIGHT_KEY, String(tlHeight)); }, [tlHeight]);

    // Classic layout: the source monitor follows the timeline selection. The pro
    // layout keeps source and program independent (source = media bin selection).
    useEffect(() => {
        if (externalSourceAsset || isProRef.current) return;
        if (props.selectedMedia?.id) setSrcId(props.selectedMedia.id);
    }, [externalSourceAsset, props.selectedMedia?.id]);
    useEffect(() => {
        if (externalSourceAsset) return;
        if (!srcId && mediaItems.length > 0) setSrcId(mediaItems[0].id);
    }, [externalSourceAsset, mediaItems, srcId]);
    useEffect(() => { setSrcPlay(0); setSrcPlaying(false); }, [srcId, externalSourceAsset?.id]);
    useEffect(() => {
        if (!srcSource) return;
        const m = Math.max(0.1, srcDur);
        setSrcIn((p) => p === null ? null : Math.max(0, Math.min(p, m - 0.05)));
        setSrcOut((p) => p === null ? null : Math.max(0.05, Math.min(p, m)));
    }, [srcDur, srcSource]);
    useEffect(() => {
        if (!srcSource) {
            setSourcePreviewFrame(null);
            return;
        }
        if (srcSource.type === 'image') {
            setSourcePreviewFrame(srcSource.url);
            return;
        }
        if (srcSource.type !== 'video') {
            setSourcePreviewFrame(null);
            return;
        }
        captureSourcePreviewFrame(true);
    }, [srcSource, captureSourcePreviewFrame]);
    useEffect(() => {
        if (srcSource?.type !== 'video') return;
        captureSourcePreviewFrame(false);
    }, [srcPlay, srcSource?.type, captureSourcePreviewFrame]);
    useEffect(() => {
        if (!srcPlaying) { srcVideoRef.current?.pause(); srcAudioRef.current?.pause(); if (srcRafRef.current) { cancelAnimationFrame(srcRafRef.current); srcRafRef.current = null; } return; }
        const el = srcSource?.type === 'video' ? srcVideoRef.current : srcAudioRef.current;
        if (!el) { setSrcPlaying(false); return; }
        const tick = () => { setSrcPlay(el.currentTime || 0); if (!el.paused) srcRafRef.current = requestAnimationFrame(tick); };
        srcRafRef.current = requestAnimationFrame(tick);
        return () => { if (srcRafRef.current) { cancelAnimationFrame(srcRafRef.current); srcRafRef.current = null; } };
    }, [srcPlaying, srcSource?.type]);
    useEffect(() => () => { if (srcRafRef.current) cancelAnimationFrame(srcRafRef.current); }, []);

    const handleImageSave = (m: MediaItem) => {
        if (props.selectedMedia && m.id === props.selectedMedia.id) {
            props.onUpdateMediaItem(m);
            return;
        }
        props.onAddGeneratedMedia(m);
    };

    const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const id = e.target.value;
        if (id === 'custom') { setPreview(p => ({ ...p, presetId: 'custom' })); return; }
        const pr = PREVIEW_PRESETS.find(i => i.id === id);
        if (pr) setPreview({ presetId: pr.id, width: pr.width, height: pr.height });
    };

    const handleDimChange = (f: 'width' | 'height', v: number) => {
        if (!Number.isFinite(v) || v <= 0) return;
        setPreview(p => ({ ...p, presetId: 'custom', [f]: Math.max(1, Math.round(v)) }));
    };

    const handleRatioChange = (v: string) => {
        setCustomRatio(v);
        const r = parseRatio(v);
        if (r && Number.isFinite(preview.width) && preview.width > 0) setPreview(p => ({ ...p, presetId: 'custom', height: Math.max(1, Math.round(preview.width / r)) }));
    };

    const aspect = preview.width && preview.height ? { aspectRatio: `${preview.width} / ${preview.height}` } : undefined;

    const sequenceDuration = timelineClips.reduce((max, clip) => Math.max(max, clip.end), 0);
    const clampPlayhead = (value: number) => Math.max(0, Math.min(Math.max(sequenceDuration, 0), value));
    const stepProgramFrame = (direction: -1 | 1) => props.onPlayheadUpdate(clampPlayhead(props.playheadPosition + direction / DEFAULT_TIMELINE_FPS));
    const canThreePointEdit = Boolean(srcSource);

    const previewRatio = preview.width > 0 && preview.height > 0 ? preview.width / preview.height : 16 / 9;
    const fitted = stageSize.width > 0 && stageSize.height > 0
        ? (() => {
            const width = Math.min(stageSize.width, stageSize.height * previewRatio);
            const height = width / previewRatio;
            return { left: (stageSize.width - width) / 2, top: (stageSize.height - height) / 2, width, height };
        })()
        : null;
    const maskRatio = MASK_PRESETS.find((preset) => preset.id === mask)?.ratio ?? null;
    const maskBars = fitted && maskRatio
        ? (maskRatio > previewRatio
            ? { horizontal: true, size: Math.max(0, (fitted.height - fitted.width / maskRatio) / 2) }
            : { horizontal: false, size: Math.max(0, (fitted.width - fitted.height * maskRatio) / 2) })
        : null;

    /* ─── Pro layout: tools, keys, derived data ─── */

    const selectTool = useCallback((tool: EditorToolId) => {
        if (EDITOR_TOOLS.find((entry) => entry.id === tool)?.status === 'planned') return;
        dispatchPro({ type: 'setTool', tool });
        const mode = trimModeForTool(tool);
        if (mode && mode !== props.trimMode) props.onTrimModeChange(mode);
    }, [props.trimMode, props.onTrimModeChange]);

    // Keep the tool strip in sync when the trim mode changes elsewhere (R/O/U keys, Trim page, agents).
    useEffect(() => {
        const next = toolForTrimMode(props.trimMode, pro.tool);
        if (next !== pro.tool) dispatchPro({ type: 'setTool', tool: next });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.trimMode]);

    const splitAtPlayhead = useCallback(() => {
        const time = props.playheadPosition;
        const inside = (clip: TimelineClip) => time > clip.start + 1e-4 && time < clip.end - 1e-4;
        const unlocked = (clip: TimelineClip) => !timelineTracks.find((track) => track.id === clip.trackId)?.isLocked;
        const selected = props.selectedClip && inside(props.selectedClip) && unlocked(props.selectedClip) ? props.selectedClip : null;
        const onActive = timelineClips.find((clip) => clip.trackId === props.activeTrackId && inside(clip) && unlocked(clip));
        const anyClip = timelineClips.find((clip) => inside(clip) && unlocked(clip));
        const target = selected || onActive || anyClip;
        if (target) props.onSplitClip(target.id, time);
    }, [props.playheadPosition, props.selectedClip, props.activeTrackId, props.onSplitClip, timelineClips, timelineTracks]);


    /* ─── Sequence markers (M), lift/extract, shuttle, playback resolution ─── */

    const [localMarkers, setLocalMarkers] = useState<SequenceMarker[]>([]);
    const markers = props.sequenceMarkers ?? localMarkers;
    const markersRef = useRef(markers);
    markersRef.current = markers;
    const onMarkersChangeRef = useRef(props.onSequenceMarkersChange);
    onMarkersChangeRef.current = props.onSequenceMarkersChange;
    const setMarkers = useCallback((fn: (prev: SequenceMarker[]) => SequenceMarker[]) => {
        const next = fn(markersRef.current);
        if (next === markersRef.current) return;
        markersRef.current = next;
        if (onMarkersChangeRef.current) onMarkersChangeRef.current(next);
        else setLocalMarkers(next);
    }, []);
    const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
    const [proNotice, setProNotice] = useState<string | null>(null);
    useEffect(() => {
        if (!proNotice) return;
        const id = window.setTimeout(() => setProNotice(null), 2600);
        return () => window.clearTimeout(id);
    }, [proNotice]);

    const addMarkerAtPlayhead = useCallback(() => {
        const result = addMarker(markersRef.current, playheadRef.current.position, { fps: DEFAULT_TIMELINE_FPS });
        setMarkers(() => result.markers);
        setSelectedMarkerId(result.marker.id);
        // Second M on the same frame opens the marker for editing (like an NLE marker dialog).
        if (!result.created) dispatchPro({ type: 'openPanel', panel: 'markers' });
        else setProNotice(`Marke gesetzt · ${formatTimecode(result.marker.time)}`);
    }, [setMarkers]);
    const updateMarkerById = useCallback((id: string, patch: MarkerPatch) => setMarkers((prev) => updateMarker(prev, id, patch, DEFAULT_TIMELINE_FPS)), [setMarkers]);
    const removeMarkerById = useCallback((id: string) => setMarkers((prev) => removeMarker(prev, id)), [setMarkers]);
    const jumpMarker = useCallback((direction: -1 | 1) => {
        const time = playheadRef.current.position;
        const target = direction > 0 ? nextMarker(markersRef.current, time, DEFAULT_TIMELINE_FPS) : previousMarker(markersRef.current, time, DEFAULT_TIMELINE_FPS);
        if (!target) return;
        setSelectedMarkerId(target.id);
        playheadRef.current.update(target.time);
    }, []);

    /** Lift (;) or extract (') of the program In/Out range on the targeted tracks. */
    const liftOrExtract = useCallback((mode: 'lift' | 'extract') => {
        const sequenceEnd = timelineClipsRef.current.reduce((max, clip) => Math.max(max, clip.end), 0);
        if (pgmIn === null && pgmOut === null) {
            setProNotice('Erst In (I) und Out (O) im Programm setzen');
            return;
        }
        const start = pgmIn ?? 0;
        const end = pgmOut ?? sequenceEnd;
        if (!(end - start > 1e-3)) return;
        const trackIds = rangeEditTracks(timelineTracks);
        const makeId = () => `clip-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        const op = mode === 'lift' ? liftRange : extractRange;
        const result = op(timelineClipsRef.current, trackIds, start, end, { makeId, minLength: 1 / DEFAULT_TIMELINE_FPS });
        if (!result.changed) {
            setProNotice('Im In/Out-Bereich liegt nichts auf den Zielspuren');
            return;
        }
        props.onBatchUpdateClips(result.clips);
        if (mode === 'extract') setMarkers((prev) => rippleMarkers(prev, start, end));
        if (props.selectedClipId && result.removedIds.includes(props.selectedClipId)) props.onSelectClip(null);
        setPgmIn(null);
        setPgmOut(null);
        props.onPlayheadUpdate(start);
        setProNotice(mode === 'lift' ? 'Herausgehoben (Lücke bleibt)' : 'Extrahiert (Lücke geschlossen)');
    }, [pgmIn, pgmOut, timelineTracks, props.onBatchUpdateClips, props.onPlayheadUpdate, props.onSelectClip, props.selectedClipId, setMarkers]);

    // J/K/L shuttle: 1× uses the app's normal playback (with audio); 2×/4× and reverse scrub the playhead.
    const [shuttleRate, setShuttleRate] = useState(0);
    const shuttleRateRef = useRef(0);
    shuttleRateRef.current = shuttleRate;
    const isPlayingRef = useRef(props.isPlaying);
    isPlayingRef.current = props.isPlaying;
    const togglePlaybackRef = useRef(props.onTogglePlayback);
    togglePlaybackRef.current = props.onTogglePlayback;
    const kHeldRef = useRef(false);
    const prevShuttleRateRef = useRef(0);
    useEffect(() => {
        const previous = prevShuttleRateRef.current;
        prevShuttleRateRef.current = shuttleRate;
        if (shuttleRate === 1) {
            if (!isPlayingRef.current) togglePlaybackRef.current();
            return;
        }
        if (shuttleRate === 0) {
            if (previous === 1 && isPlayingRef.current) togglePlaybackRef.current();
            return;
        }
        if (isPlayingRef.current) togglePlaybackRef.current();
        let last = performance.now();
        let current = playheadRef.current.position;
        let raf = 0;
        const tick = () => {
            const now = performance.now();
            const dt = Math.min(0.1, (now - last) / 1000);
            last = now;
            if (Math.abs(playheadRef.current.position - current) > 0.25) current = playheadRef.current.position;
            const end = timelineClipsRef.current.reduce((max, clip) => Math.max(max, clip.end), 0);
            current = Math.max(0, Math.min(end, current + dt * shuttleRate));
            playheadRef.current.update(current);
            if ((shuttleRate < 0 && current <= 0) || (shuttleRate > 0 && current >= end)) { setShuttleRate(0); return; }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [shuttleRate]);
    // Space / transport buttons take over from the shuttle.
    useEffect(() => {
        const rate = shuttleRateRef.current;
        if (props.isPlaying && rate !== 0 && rate !== 1) setShuttleRate(0);
        if (!props.isPlaying && rate === 1) setShuttleRate(0);
    }, [props.isPlaying]);
    const handleShuttle = useCallback((key: 'j' | 'k' | 'l') => {
        if (key === 'k') {
            kHeldRef.current = true;
            if (shuttleRateRef.current === 0 && isPlayingRef.current) togglePlaybackRef.current();
            setShuttleRate(0);
            return;
        }
        if (kHeldRef.current) {
            setShuttleRate(0);
            if (isPlayingRef.current) togglePlaybackRef.current();
            const end = timelineClipsRef.current.reduce((max, clip) => Math.max(max, clip.end), 0);
            const next = Math.max(0, Math.min(end, playheadRef.current.position + shuttleStepFrames(key) / DEFAULT_TIMELINE_FPS));
            playheadRef.current.position = next; // taps faster than a render still accumulate
            playheadRef.current.update(next);
            return;
        }
        setShuttleRate((prev) => nextShuttleRate(prev, key));
    }, []);
    useEffect(() => {
        const up = (event: KeyboardEvent) => { if (event.key.toLowerCase() === 'k') kHeldRef.current = false; };
        const blur = () => { kHeldRef.current = false; };
        window.addEventListener('keyup', up);
        window.addEventListener('blur', blur);
        return () => { window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
    }, []);
    useEffect(() => { if (!isPro) setShuttleRate(0); }, [isPro]);

    const [linkedSelection, setLinkedSelection] = useState<boolean>(() => loadJson<boolean>(LINKED_SELECTION_KEY, true) === true);
    useEffect(() => { try { window.localStorage?.setItem(LINKED_SELECTION_KEY, JSON.stringify(linkedSelection)); } catch { /* ignore */ } }, [linkedSelection]);

    const [playbackRes, setPlaybackRes] = useState<{ program: PlaybackResolution; source: PlaybackResolution }>(() => {
        const raw = loadJson<{ program?: unknown; source?: unknown }>(PLAYBACK_RES_KEY, {});
        return {
            program: isPlaybackResolution(raw?.program) ? raw.program : 'full',
            source: isPlaybackResolution(raw?.source) ? raw.source : 'full',
        };
    });
    useEffect(() => { try { window.localStorage?.setItem(PLAYBACK_RES_KEY, JSON.stringify(playbackRes)); } catch { /* ignore */ } }, [playbackRes]);
    const playbackResValue = useMemo<PlaybackResolutionValue>(() => ({
        program: playbackRes.program,
        source: playbackRes.source,
        fxMaxDimension: fxMaxDimensionFor(playbackRes.program, preview.width, preview.height),
    }), [playbackRes, preview.width, preview.height]);
    const renderResolutionSelect = (target: 'program' | 'source') => (
        <select
            className="ppx-select"
            value={playbackRes[target]}
            onChange={(event) => {
                const value = event.target.value;
                if (isPlaybackResolution(value)) setPlaybackRes((prev) => ({ ...prev, [target]: value }));
            }}
            title={target === 'program'
                ? 'Wiedergabeauflösung: GPU-Effektvorschau in voller, halber oder Viertel-Auflösung (Export immer voll)'
                : 'Wiedergabeauflösung der Quelle (für die Effektvorschau; Export immer voll)'}
            data-automation-id={`pp.${target}.resolution`}
        >
            {PLAYBACK_RESOLUTIONS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>
    );

    const proKeyRef = useRef({ focusedPanel: pro.focusedPanel, selectTool, splitAtPlayhead, markPgmIn, markPgmOut, toggleSrcPlay, addMarkerAtPlayhead, jumpMarker, liftOrExtract, handleShuttle, do3PE, rippleDelete: props.onRippleDeleteClip, hasSource: Boolean(srcSource) });
    proKeyRef.current = { focusedPanel: pro.focusedPanel, selectTool, splitAtPlayhead, markPgmIn, markPgmOut, toggleSrcPlay, addMarkerAtPlayhead, jumpMarker, liftOrExtract, handleShuttle, do3PE, rippleDelete: props.onRippleDeleteClip, hasSource: Boolean(srcSource) };

    /* ─── MCP live commands (src/mcp/modules/timelineTools.ts) ─── */
    const liveRef = useRef<Record<string, (args: Record<string, unknown>) => unknown>>({});
    liveRef.current = {
        [EDIT_LIVE.state]: () => ({
            workspace: pro.workspace,
            tool: pro.tool,
            focusedPanel: pro.focusedPanel,
            programIn: pgmIn,
            programOut: pgmOut,
            sourceIn: srcIn,
            sourceOut: srcOut,
            source: srcSource ? { id: srcSource.id, name: srcSource.name, type: srcSource.type, kind: srcSource.kind } : null,
            playbackResolution: playbackRes,
            fxMaxDimension: playbackResValue.fxMaxDimension ?? null,
            linkedSelection,
            shuttleRate,
            markerCount: markers.length,
            selectedMarkerId,
        }),
        [EDIT_LIVE.inOut]: (args) => {
            const read = (value: unknown, current: number | null) => (value === undefined ? current : value === null ? null : Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : current);
            const nextIn = read(args.in, pgmIn);
            const nextOut = read(args.out, pgmOut);
            if (nextIn !== null && nextOut !== null && nextOut <= nextIn) throw new Error('Out must be after In.');
            setPgmIn(nextIn);
            setPgmOut(nextOut);
            return { programIn: nextIn, programOut: nextOut };
        },
        [EDIT_LIVE.resolution]: (args) => {
            const next = { ...playbackRes };
            if (args.program !== undefined) { if (!isPlaybackResolution(args.program)) throw new Error('program must be full, half or quarter.'); next.program = args.program; }
            if (args.source !== undefined) { if (!isPlaybackResolution(args.source)) throw new Error('source must be full, half or quarter.'); next.source = args.source; }
            setPlaybackRes(next);
            return { playbackResolution: next, fxMaxDimension: fxMaxDimensionFor(next.program, preview.width, preview.height) ?? null };
        },
        [EDIT_LIVE.workspace]: (args) => {
            const id = args.workspace as ProWorkspaceId;
            if (!PRO_WORKSPACES.some((entry) => entry.id === id)) throw new Error(`Unknown workspace ${String(args.workspace)}.`);
            dispatchPro({ type: 'setWorkspace', workspace: id });
            if (args.reset === true && id !== 'classic') dispatchPro({ type: 'resetWorkspace', workspace: id });
            return { workspace: id };
        },
        [EDIT_LIVE.shuttle]: (args) => {
            if (args.key === 'j' || args.key === 'k' || args.key === 'l') {
                handleShuttle(args.key);
                if (args.key === 'k') kHeldRef.current = false;
                return { key: args.key };
            }
            const rate = Number(args.rate);
            if (![-4, -2, -1, 0, 1, 2, 4].includes(rate)) throw new Error('rate must be -4, -2, -1, 0, 1, 2 or 4.');
            if (rate === 0 && shuttleRateRef.current === 0 && isPlayingRef.current) togglePlaybackRef.current();
            setShuttleRate(rate);
            return { rate };
        },
        [EDIT_LIVE.linked]: (args) => { setLinkedSelection(args.enabled === true); return { linkedSelection: args.enabled === true }; },
        [EDIT_LIVE.sourceEdit]: async (args) => {
            if (typeof args.mediaId === 'string' && args.mediaId) {
                if (!mediaItems.some((item) => item.id === args.mediaId)) throw new Error(`Media ${args.mediaId} not found.`);
                loadMediaToSource(args.mediaId);
                await new Promise((resolve) => window.setTimeout(resolve, 60));
            }
            const result = do3PERef.current(args.mode === 'overwrite' ? 'overwrite' : 'insert', { silent: true });
            if (!result.ok) throw new Error(result.message);
            return result;
        },
    };
    const do3PERef = useRef(do3PE);
    do3PERef.current = do3PE;
    useEffect(() => registerLiveCommands(Object.fromEntries(
        Object.values(EDIT_LIVE).filter((name) => name.startsWith('edit.')).map((name) => [name, (args: Record<string, unknown>) => liveRef.current[name](args ?? {})]),
    )), []);
    useEffect(() => {
        if (!isPro) return;
        // Capture phase: runs before the App/Timeline window listeners so pro-only keys
        // (C = razor tool, T = type tool, Cmd/Ctrl+K, I/O) don't also trigger their classic meaning.
        const handler = (event: KeyboardEvent) => {
            if (event.defaultPrevented || isTypingTarget(event.target)) return;
            const current = proKeyRef.current;
            const edit = resolveEditShortcut(event, current.focusedPanel);
            // Zoom and track heights are handled by the Timeline itself.
            if (edit && edit.kind !== 'zoom' && edit.kind !== 'trackHeight') {
                if (event.repeat && edit.kind !== 'shuttle') return;
                if (edit.kind === 'shuttle' && event.repeat) { event.preventDefault(); event.stopPropagation(); return; }
                if ((edit.kind === 'insert' || edit.kind === 'overwrite') && !current.hasSource) return;
                if (edit.kind === 'rippleDelete' && !current.rippleDelete) return;
                event.preventDefault();
                event.stopPropagation();
                switch (edit.kind) {
                    case 'addMarker': current.addMarkerAtPlayhead(); break;
                    case 'nextMarker': current.jumpMarker(1); break;
                    case 'previousMarker': current.jumpMarker(-1); break;
                    case 'lift': current.liftOrExtract('lift'); break;
                    case 'extract': current.liftOrExtract('extract'); break;
                    case 'insert': current.do3PE('insert'); break;
                    case 'overwrite': current.do3PE('overwrite'); break;
                    case 'shuttle': current.handleShuttle(edit.key); break;
                    case 'rippleDelete': current.rippleDelete?.(); break;
                    default: break;
                }
                return;
            }
            if (event.repeat) return;
            const action = resolveProShortcut(event, current.focusedPanel);
            if (!action) return;
            if (action.kind === 'tool' && EDITOR_TOOLS.find((entry) => entry.id === action.tool)?.status === 'planned') return;
            event.preventDefault();
            event.stopPropagation();
            switch (action.kind) {
                case 'tool': current.selectTool(action.tool); break;
                case 'splitAtPlayhead': current.splitAtPlayhead(); break;
                case 'toggleMaximize': dispatchPro({ type: 'toggleMaximize' }); break;
                case 'mark': if (action.edge === 'in') current.markPgmIn(); else current.markPgmOut(); break;
                case 'toggleSourcePlayback': current.toggleSrcPlay(); break;
                default: break;
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [isPro]);

    const hiddenTrackSet = useMemo(() => new Set(isPro ? pro.hiddenTrackIds : []), [isPro, pro.hiddenTrackIds]);
    const programClips = useMemo(
        () => (hiddenTrackSet.size > 0 ? timelineClips.filter((clip) => !hiddenTrackSet.has(clip.trackId)) : timelineClips),
        [hiddenTrackSet, timelineClips],
    );
    const trackLevels = useTrackLevels(timelineTracks, timelineClips, mediaItems, waveformCache, props.playheadPosition);
    const sessionHistory = useSessionHistory(timelineClips, timelineTracks, mediaItems);
    const trackLabelById = useMemo(() => {
        let v = 0;
        let a = 0;
        return Object.fromEntries(timelineTracks.map((track) => [track.id, track.type === 'video' ? `V${++v}` : `A${++a}`])) as Record<string, string>;
    }, [timelineTracks]);
    const selectedClipMedia = props.selectedClip ? mediaItems.find((item) => item.id === props.selectedClip!.mediaId) ?? null : null;

    const appendFxToClip = useCallback((clipId: string, fxId: string, reveal = false) => {
        const clip = timelineClipsRef.current.find((entry) => entry.id === clipId);
        if (!clip) return;
        onUpdateClip({ ...clip, fxStack: [...(clip.fxStack ?? []), createFxInstance(fxId)] });
        props.onSelectClip(clip.id);
        if (reveal) dispatchPro({ type: 'openPanel', panel: 'effectControls' });
    }, [onUpdateClip, props.onSelectClip]);

    const handleTypeToolClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (pro.tool !== 'type') return;
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        props.onCreateTextClip({
            content: 'Neuer Text',
            position: textPositionForPoint((event.clientX - rect.left) / Math.max(1, rect.width), (event.clientY - rect.top) / Math.max(1, rect.height)),
            startTime: props.playheadPosition,
        });
        selectTool('selection');
        dispatchPro({ type: 'openPanel', panel: 'inspector' });
    };

    /* ─── Source Monitor ─── */
    const sourcePanel = (
        <div className="edit-monitor-panel">
            <div className="edit-monitor-panel__bar">
                <div className="edit-monitor-panel__title">
                    <span>Source</span>
                    {srcSource?.kind === 'library' && <small title={srcSource.name}>{srcSource.name}</small>}
                    {srcSource?.kind === 'library' && <span className="edit-chip">{srcSource.projectLabel}</span>}
                    {srcSource?.kind === 'project' && srcSource.duration && <small>{formatTimecode(srcSource.duration)}</small>}
                </div>
                <div className="flex items-center gap-1">
                    <select
                        value={srcSource?.kind === 'project' ? (srcId || '') : ''}
                        onChange={e => { setExternalSourceAsset(null); setSrcId(e.target.value || null); }}
                        className="edit-select max-w-[190px]"
                        title="Load project media into the source monitor"
                        data-automation-id="pp.source.load"
                    >
                        <option value="">Load media…</option>
                        {mediaItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                    {srcSource?.kind === 'library' && (
                        <button onClick={() => setExternalSourceAsset(null)} className="edit-text-btn">Clear</button>
                    )}
                    {isPro && renderResolutionSelect('source')}
                </div>
            </div>
            <div className="edit-monitor-panel__stage">
                {!srcSource && (
                    <div className="edit-monitor-empty">
                        <strong>No source loaded</strong>
                        <span>Pick a clip from the menu above or double-click media in the Browser to review it here and mark in and out points.</span>
                    </div>
                )}
                {srcSource?.type === 'video' && (
                    <video
                        ref={srcVideoRef}
                        src={srcSource.url}
                        className="w-full h-full object-contain"
                        onLoadedMetadata={(e) => {
                            if (srcPlay > 0) e.currentTarget.currentTime = srcPlay;
                        }}
                        onLoadedData={() => captureSourcePreviewFrame(true)}
                        onSeeked={() => captureSourcePreviewFrame(true)}
                        onPause={() => captureSourcePreviewFrame(true)}
                        onTimeUpdate={(e) => {
                            setSrcPlay(e.currentTarget.currentTime || 0);
                            captureSourcePreviewFrame(false);
                        }}
                        onEnded={() => {
                            setSrcPlaying(false);
                            captureSourcePreviewFrame(true);
                        }}
                        playsInline
                    />
                )}
                {srcSource?.type === 'image' && <img src={srcSource.url} className="w-full h-full object-contain" alt={srcSource.name} />}
                {srcSource?.type === 'audio' && (
                    <div className="edit-monitor-empty" style={{ pointerEvents: 'auto' }}>
                        <MusicNoteIcon className="w-8 h-8 opacity-60" />
                        <strong>{srcSource.name}</strong>
                        <span>Audio source · use the transport below to audition and mark a range.</span>
                        <audio ref={srcAudioRef} src={srcSource.url} onTimeUpdate={e => setSrcPlay(e.currentTarget.currentTime || 0)} onEnded={() => setSrcPlaying(false)} />
                    </div>
                )}
            </div>
            <EditTransportBar
                automationId="pp.source"
                isPlaying={srcPlaying}
                position={srcPlay}
                duration={srcSource ? srcDur : 0}
                disabled={!srcSource || srcSource.type === 'image'}
                inPoint={srcIn}
                outPoint={srcOut}
                onTogglePlayback={toggleSrcPlay}
                onSeek={seekSrc}
                onStepFrame={stepSourceFrame}
                onMarkIn={markSrcIn}
                onMarkOut={markSrcOut}
                onClearMarks={() => { setSrcIn(null); setSrcOut(null); }}
                trailing={(
                    <div className="edit-transport__actions">
                        <button onClick={() => do3PE('insert')} disabled={!canThreePointEdit} className="edit-text-btn edit-text-btn--primary" title="Insert the marked range at the playhead, pushing later clips back" data-automation-id="pp.source.insert">Insert</button>
                        <button onClick={() => do3PE('overwrite')} disabled={!canThreePointEdit} className="edit-text-btn edit-text-btn--outline" title="Overwrite the timeline at the playhead with the marked range" data-automation-id="pp.source.overwrite">Overwrite</button>
                    </div>
                )}
            />
        </div>
    );

    /* ─── Program Monitor ─── */
    const programPanel = (
        <div className="edit-monitor-panel relative">
            <div className="edit-monitor-panel__bar">
                <div className="edit-monitor-panel__title">
                    <span>Program</span>
                    <small>{props.projectName || 'Untitled sequence'}</small>
                </div>
                <div className="flex items-center gap-1">
                    <select value={guides} onChange={(e) => setGuides(e.target.value as typeof guides)} className="edit-select" title="Overlay guides">
                        <option value="off">No guides</option>
                        <option value="thirds">Thirds</option>
                        <option value="safe">Safe areas</option>
                        <option value="both">Thirds + safe</option>
                    </select>
                    <select value={mask} onChange={(e) => setMask(e.target.value)} className="edit-select" title="Aspect mask">
                        {MASK_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                    </select>
                    <span className="edit-toolbar__hint hidden md:inline">{preview.width} × {preview.height}</span>
                    <button onClick={() => setIsFullscreen(true)} className="edit-icon-btn" title="Fullscreen (F11)">
                        <MaximizeIcon className="w-4 h-4" />
                    </button>
                </div>
            </div>
            <div ref={programStageRef} className="edit-monitor-panel__stage" onDoubleClick={() => setIsFullscreen(true)} title="Double-click for fullscreen">
                <PreviewPlayer
                    timelineClips={timelineClips} timelineTracks={timelineTracks} mediaItems={mediaItems}
                    playheadPosition={props.playheadPosition} isPlaying={props.isPlaying} onTogglePlayback={props.onTogglePlayback}
                    canvasWidth={preview.width} canvasHeight={preview.height} aspectStyle={aspect} showControls={false}
                />
                {(guides !== 'off' || maskRatio) && fitted && (
                    <div className="edit-guides" style={{ left: fitted.left, top: fitted.top, width: fitted.width, height: fitted.height }} aria-hidden>
                        {maskRatio && maskBars && (
                            <>
                                <div className="edit-guides__mask" style={maskBars.horizontal ? { left: 0, right: 0, top: 0, height: maskBars.size } : { top: 0, bottom: 0, left: 0, width: maskBars.size }} />
                                <div className="edit-guides__mask" style={maskBars.horizontal ? { left: 0, right: 0, bottom: 0, height: maskBars.size } : { top: 0, bottom: 0, right: 0, width: maskBars.size }} />
                            </>
                        )}
                        {(guides === 'thirds' || guides === 'both') && (
                            <>
                                <div className="edit-guides__line edit-guides__line--v" style={{ left: '33.333%' }} />
                                <div className="edit-guides__line edit-guides__line--v" style={{ left: '66.666%' }} />
                                <div className="edit-guides__line edit-guides__line--h" style={{ top: '33.333%' }} />
                                <div className="edit-guides__line edit-guides__line--h" style={{ top: '66.666%' }} />
                            </>
                        )}
                        {(guides === 'safe' || guides === 'both') && (
                            <>
                                <div className="edit-guides__safe" style={{ inset: '5%' }} title="Action safe" />
                                <div className="edit-guides__safe edit-guides__safe--title" style={{ inset: '10%' }} title="Title safe" />
                                <div className="edit-guides__center" />
                            </>
                        )}
                    </div>
                )}
                {timelineClips.length === 0 && (
                    <div className="edit-monitor-empty">
                        <strong>Nothing on the timeline yet</strong>
                        <span>Drag media from the Browser onto a track, or mark a range in the Source monitor and press Insert.</span>
                    </div>
                )}
                {props.selectedMedia?.type === 'image' && (
                    <button onClick={(e) => { e.stopPropagation(); setImageEditorOpen(true); }} className="edit-monitor-panel__overlay-btn" title="Open image editor">
                        <BrushIcon className="w-4 h-4" />
                    </button>
                )}
            </div>
            <EditTransportBar
                isPlaying={props.isPlaying}
                position={props.playheadPosition}
                duration={sequenceDuration}
                disabled={timelineClips.length === 0}
                inPoint={pgmIn}
                outPoint={pgmOut}
                onTogglePlayback={props.onTogglePlayback}
                onSeek={(time) => props.onPlayheadUpdate(clampPlayhead(time))}
                onStepFrame={stepProgramFrame}
                onMarkIn={markPgmIn}
                onMarkOut={markPgmOut}
                onClearMarks={() => { setPgmIn(null); setPgmOut(null); }}
                trailing={effective !== 'split' && effective !== 'source' && srcSource ? (
                    <div className="edit-transport__actions">
                        <button onClick={() => do3PE('insert')} className="edit-text-btn edit-text-btn--primary" title="Insert the source range at the playhead">Insert</button>
                        <button onClick={() => do3PE('overwrite')} className="edit-text-btn edit-text-btn--outline" title="Overwrite at the playhead with the source range">Overwrite</button>
                    </div>
                ) : null}
            />
        </div>
    );

    /* ─── Shared props for library-style panels (classic rail + pro tabs) ─── */
    const libraryProps = {
        ...props,
        onCreateTitleClip: createTitleClipFromPreset,
        onApplyTitlePresetToSelected: applyTitlePresetToSelected,
        onApplyTitleTreatmentToSelected: applyTitleTreatmentToSelected,
        onApplyTitleMotionToSelected: applyTitleMotionToSelected,
        onToggleTitleAutoContrastForSelected: toggleTitleAutoContrastForSelected,
        onGenerateSubtitlesFromSelected: generateSubtitlesFromSelected,
        onUpdateSubtitleClipContent: props.onUpdateSubtitleClipContent,
        onSplitSubtitleClip: props.onSplitSubtitleClip,
        onMergeSubtitleClip: props.onMergeSubtitleClip,
        onLoadMediaToSource: loadMediaToSource,
        onLoadLibraryAssetToSource: loadLibraryAssetToSource,
        sourcePreviewFrame,
        sourcePreviewLabel: srcSource ? `${srcSource.name} @ ${formatTimecode(srcPlay)}` : 'Source monitor',
    };

    /* ─── Pro program monitor ─── */
    const proCanvas = (() => {
        if (pro.monitorZoom !== 'fit') {
            const factor = pro.monitorZoom / 100;
            return { width: Math.round(preview.width * factor), height: Math.round(preview.height * factor) };
        }
        if (!proStageSize.width || !proStageSize.height) return null;
        const availableW = Math.max(1, proStageSize.width - 12);
        const availableH = Math.max(1, proStageSize.height - 12);
        const width = Math.min(availableW, availableH * previewRatio);
        return { width: Math.round(width), height: Math.round(width / previewRatio) };
    })();
    const proMaskBars = proCanvas && maskRatio
        ? (maskRatio > previewRatio
            ? { horizontal: true, size: Math.max(0, (proCanvas.height - proCanvas.width / maskRatio) / 2) }
            : { horizontal: false, size: Math.max(0, (proCanvas.width - proCanvas.height * maskRatio) / 2) })
        : null;

    const proProgramPanel = (
        <div className={`ppx-monitor ${pro.tool === 'type' ? 'ppx-monitor--type' : ''}`} data-automation-id="pp.program">
            <div
                ref={proStageRef}
                className={`ppx-monitor__stage ${pro.monitorZoom !== 'fit' ? 'ppx-monitor__stage--zoomed' : ''}`}
                onDoubleClick={() => { if (pro.tool !== 'type') setIsFullscreen(true); }}
                title={pro.tool === 'type' ? 'Klicken: Textclip an der Abspielposition anlegen' : 'Doppelklick: Vollbild'}
            >
                <div
                    className="ppx-monitor__canvas"
                    style={proCanvas ? { width: proCanvas.width, height: proCanvas.height } : { width: '100%', height: '100%' }}
                    onClick={handleTypeToolClick}
                    data-automation-id="pp.program.canvas"
                >
                    <PlaybackResolutionContext.Provider value={playbackResValue}>
                        <PreviewPlayer
                            timelineClips={programClips} timelineTracks={timelineTracks} mediaItems={mediaItems}
                            playheadPosition={props.playheadPosition} isPlaying={props.isPlaying} onTogglePlayback={props.onTogglePlayback}
                            canvasWidth={preview.width} canvasHeight={preview.height} aspectStyle={aspect} showControls={false}
                        />
                    </PlaybackResolutionContext.Provider>
                    {(guides !== 'off' || maskRatio) && (
                        <div className="edit-guides" style={{ inset: 0 }} aria-hidden>
                            {proMaskBars && (
                                <>
                                    <div className="edit-guides__mask" style={proMaskBars.horizontal ? { left: 0, right: 0, top: 0, height: proMaskBars.size } : { top: 0, bottom: 0, left: 0, width: proMaskBars.size }} />
                                    <div className="edit-guides__mask" style={proMaskBars.horizontal ? { left: 0, right: 0, bottom: 0, height: proMaskBars.size } : { top: 0, bottom: 0, right: 0, width: proMaskBars.size }} />
                                </>
                            )}
                            {(guides === 'thirds' || guides === 'both') && (
                                <>
                                    <div className="edit-guides__line edit-guides__line--v" style={{ left: '33.333%' }} />
                                    <div className="edit-guides__line edit-guides__line--v" style={{ left: '66.666%' }} />
                                    <div className="edit-guides__line edit-guides__line--h" style={{ top: '33.333%' }} />
                                    <div className="edit-guides__line edit-guides__line--h" style={{ top: '66.666%' }} />
                                </>
                            )}
                            {(guides === 'safe' || guides === 'both') && (
                                <>
                                    <div className="edit-guides__safe" style={{ inset: '5%' }} />
                                    <div className="edit-guides__safe edit-guides__safe--title" style={{ inset: '10%' }} />
                                </>
                            )}
                        </div>
                    )}
                    {pro.safeMargins && (
                        <div className="ppx-safe" aria-hidden data-automation-id="pp.program.safe-overlay">
                            <div className="ppx-safe__box" style={{ inset: '5%' }} title="Aktionssicher" />
                            <div className="ppx-safe__box" style={{ inset: '10%' }} title="Titelsicher" />
                            <div className="ppx-safe__cross" />
                        </div>
                    )}
                </div>
                {timelineClips.length === 0 && (
                    <div className="edit-monitor-empty">
                        <strong>Die Sequenz ist leer</strong>
                        <span>Medien aus dem Projekt-Panel auf eine Spur ziehen oder im Quellmonitor In/Out setzen und „Insert“ drücken.</span>
                    </div>
                )}
                {props.selectedMedia?.type === 'image' && (
                    <button onClick={(e) => { e.stopPropagation(); setImageEditorOpen(true); }} className="edit-monitor-panel__overlay-btn" title="Bildeditor öffnen" data-automation-id="pp.program.image-editor">
                        <BrushIcon className="w-4 h-4" />
                    </button>
                )}
            </div>
            <div className="ppx-monitor__bar">
                <TimecodeField
                    className="ppx-monitor__tc"
                    value={props.playheadPosition}
                    max={Math.max(sequenceDuration, 0)}
                    onCommit={(time) => props.onPlayheadUpdate(clampPlayhead(time))}
                    automationId="pp.program.timecode"
                />
                <select
                    className="ppx-select"
                    value={String(pro.monitorZoom)}
                    onChange={(event) => dispatchPro({ type: 'setMonitorZoom', zoom: (event.target.value === 'fit' ? 'fit' : Number(event.target.value)) as MonitorZoom })}
                    title="Zoomstufe"
                    data-automation-id="pp.program.zoom"
                >
                    {MONITOR_ZOOM_OPTIONS.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
                </select>
                {renderResolutionSelect('program')}
                <button
                    type="button"
                    className={`ppx-icon ${pro.safeMargins ? 'ppx-icon--on' : ''}`}
                    onClick={() => dispatchPro({ type: 'setSafeMargins', value: !pro.safeMargins })}
                    aria-pressed={pro.safeMargins}
                    title="Sicherheitsränder ein/aus"
                    data-automation-id="pp.program.safe-margins"
                >
                    <Frame size={13} />
                </button>
                <select value={guides} onChange={(e) => setGuides(e.target.value as typeof guides)} className="ppx-select" title="Hilfslinien" data-automation-id="pp.program.guides">
                    <option value="off">Keine Hilfslinien</option>
                    <option value="thirds">Drittel</option>
                    <option value="safe">Sicherheitsbereiche</option>
                    <option value="both">Drittel + Sicherheit</option>
                </select>
                <select value={mask} onChange={(e) => setMask(e.target.value)} className="ppx-select" title="Seitenverhältnis-Maske" data-automation-id="pp.program.mask">
                    {MASK_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.id === 'none' ? 'Keine Maske' : preset.label}</option>)}
                </select>
                <span className="ppx-monitor__spacer" />
                <span className="ppx-monitor__name">{props.projectName || 'Unbenannte Sequenz'}</span>
                <button type="button" className="ppx-icon" onClick={() => setIsFullscreen(true)} title="Vollbild (F11)" data-automation-id="pp.program.fullscreen">
                    <Maximize size={13} />
                </button>
                <span className="ppx-monitor__dur" title="Sequenzdauer">{formatTimecode(sequenceDuration)}</span>
            </div>
            <div className="ppx-transport-wrap">
            {markers.length > 0 && sequenceDuration > 0 && (
                <div className="ppx-scrub-markers" aria-label="Sequenzmarken" data-automation-id="pp.program.markers">
                    {markers.map((marker, index) => (
                        <button
                            key={marker.id}
                            type="button"
                            className={`ppx-scrub-marker ${marker.id === selectedMarkerId ? 'ppx-scrub-marker--selected' : ''}`}
                            style={{ left: `${Math.min(100, (marker.time / sequenceDuration) * 100)}%`, ['--marker-color' as string]: markerColorHex(marker.color) }}
                            onClick={() => { setSelectedMarkerId(marker.id); props.onPlayheadUpdate(clampPlayhead(marker.time)); }}
                            title={`${markerLabel(marker, index)} · ${formatTimecode(marker.time)}`}
                            data-automation-id={`pp.program.marker.${marker.id}`}
                        />
                    ))}
                </div>
            )}
            <EditTransportBar
                automationId="pp.program"
                isPlaying={props.isPlaying}
                position={props.playheadPosition}
                duration={sequenceDuration}
                disabled={timelineClips.length === 0}
                inPoint={pgmIn}
                outPoint={pgmOut}
                onTogglePlayback={props.onTogglePlayback}
                onSeek={(time) => props.onPlayheadUpdate(clampPlayhead(time))}
                onStepFrame={stepProgramFrame}
                onMarkIn={markPgmIn}
                onMarkOut={markPgmOut}
                onClearMarks={() => { setPgmIn(null); setPgmOut(null); }}
                trailing={(
                    <div className="edit-transport__actions">
                        <button onClick={() => liftOrExtract('lift')} className="edit-icon-btn" disabled={pgmIn === null && pgmOut === null} title="Herausheben: In/Out-Bereich der Zielspuren entfernen, Lücke bleibt (;)" data-automation-id="pp.program.lift"><ArrowUpFromLine className="w-4 h-4" /></button>
                        <button onClick={() => liftOrExtract('extract')} className="edit-icon-btn" disabled={pgmIn === null && pgmOut === null} title="Extrahieren: In/Out-Bereich entfernen und Lücke schließen (')" data-automation-id="pp.program.extract"><FoldHorizontal className="w-4 h-4" /></button>
                        {srcSource && <button onClick={() => do3PE('insert')} className="edit-icon-btn" title="Einfügen: Quellbereich an der Abspielposition einfügen (,)" data-automation-id="pp.program.insert"><ArrowRightToLine className="w-4 h-4" /></button>}
                        {srcSource && <button onClick={() => do3PE('overwrite')} className="edit-icon-btn" title="Überschreiben: Quellbereich an der Abspielposition überschreiben (.)" data-automation-id="pp.program.overwrite"><ArrowDownToLine className="w-4 h-4" /></button>}
                    </div>
                )}
            />
            </div>
        </div>
    );

    const renderProPanel = (panel: ProPanelId): React.ReactNode => {
        switch (panel) {
            case 'source':
                return <div className="ppx-panel-fill" style={{ overflow: 'hidden' }} data-automation-id="pp.source">{sourcePanel}</div>;
            case 'program':
                return proProgramPanel;
            case 'timeline':
                return (
                    <div className="ppx-panel-fill" style={{ overflow: 'hidden' }}>
                        <Timeline
                            variant="pro"
                            tool={pro.tool}
                            hiddenTrackIds={pro.hiddenTrackIds}
                            onToggleTrackVisibility={(trackId) => dispatchPro({ type: 'toggleTrackHidden', trackId })}
                            onDropFx={(clipId, fxId) => appendFxToClip(clipId, fxId, true)}
                            tracks={timelineTracks} clips={timelineClips} mediaItems={mediaItems} selectedClipId={selectedClipId}
                            onSelectClip={props.onSelectClip} onUpdateClip={onUpdateClip} onBatchUpdateClips={props.onBatchUpdateClips}
                            playheadPosition={props.playheadPosition} isSnappingEnabled={props.isSnappingEnabled} trimMode={props.trimMode}
                            onTrimModeChange={props.onTrimModeChange}
                            onPlayheadUpdate={props.onPlayheadUpdate} onSnappingToggle={props.onSnappingToggle} onSplitClip={props.onSplitClip}
                            onAddTrack={props.onAddTrack} onUpdateTrack={props.onUpdateTrack} activeTrackId={props.activeTrackId}
                            onSetActiveTrack={props.onSetActiveTrack} onDropMedia={props.onDropMedia}
                            onDropLibraryAsset={props.onDropLibraryAsset}
                            onDropEffect={props.onDropEffectOnClip} onDropEffectStack={props.onDropEffectStackOnClip}
                            waveformCache={waveformCache}
                            onMatchGap={handleMatchTimelineGap}
                            rangeIn={pgmIn}
                            rangeOut={pgmOut}
                            onDeleteClip={props.onDeleteClip}
                            onRippleDeleteClip={props.onRippleDeleteClip}
                            markers={markers}
                            selectedMarkerId={selectedMarkerId}
                            onSelectMarker={setSelectedMarkerId}
                            onMoveMarker={(id, time) => updateMarkerById(id, { time })}
                            onAddMarker={addMarkerAtPlayhead}
                            linkedSelection={linkedSelection}
                            onToggleLinkedSelection={() => setLinkedSelection((value) => !value)}
                        />
                    </div>
                );
            case 'tools':
                return <ToolsPanel tool={pro.tool} onSelect={selectTool} />;
            case 'meters':
                return <AudioMetersPanel levels={trackLevels} />;
            case 'project':
                return (
                    <div className="ppx-project" data-automation-id="pp.project">
                        <MediaBin
                            mediaItems={mediaItems}
                            timelineClips={timelineClips}
                            timelineTracks={timelineTracks}
                            activeTrackId={props.activeTrackId}
                            playheadPosition={props.playheadPosition}
                            onAddMedia={onAddMedia}
                            onAddToTimeline={props.onAddToTimeline}
                            onLoadMediaToSource={loadMediaToSource}
                            onSelectMedia={loadMediaToSource}
                            selectedMediaId={srcSource?.kind === 'project' ? srcSource.id : null}
                            onLoadLibraryAssetToSource={loadLibraryAssetToSource}
                            currentProjectName={props.projectName}
                            currentProjectPath={props.currentProjectPath}
                            references={props.references}
                            shotPrompts={props.shotPrompts}
                            recentProjects={props.recentProjects}
                            onImportLibraryAsset={props.onImportLibraryAsset}
                            viewMode={pro.projectView}
                            density="compact"
                        />
                    </div>
                );
            case 'effects':
                return (
                    <EffectsBrowserPanel
                        selectedClip={props.selectedClip}
                        onAppendFx={(fxId) => props.selectedClip && appendFxToClip(props.selectedClip.id, fxId, true)}
                        onApplyCssEffect={props.onApplyCSSEffect}
                        onApplyEffectStack={props.onApplyEffectStack}
                        onApplyAIEffect={props.onApplyAIEffect}
                        onApplyNativeEffect={props.onApplyNativeEffect}
                        onApplyTransition={(type) => selectedClipId && props.onApplyTransition(selectedClipId, type)}
                        onCreateTitle={createTitleClipFromPreset}
                    />
                );
            case 'markers':
                return (
                    <SequenceMarkersPanel
                        markers={markers}
                        selectedMarkerId={selectedMarkerId}
                        onSelectMarker={setSelectedMarkerId}
                        onAddMarker={addMarkerAtPlayhead}
                        onUpdateMarker={updateMarkerById}
                        onRemoveMarker={removeMarkerById}
                        clips={timelineClips} mediaItems={mediaItems} tracks={timelineTracks}
                        programIn={pgmIn} programOut={pgmOut} sourceIn={srcIn} sourceOut={srcOut}
                        playhead={props.playheadPosition}
                        onSeek={(time) => props.onPlayheadUpdate(clampPlayhead(time))}
                        onClearProgramMarks={() => { setPgmIn(null); setPgmOut(null); }}
                        persisted={Boolean(props.onSequenceMarkersChange && props.currentProjectPath)}
                    />
                );
            case 'history':
                return <HistoryPanel entries={sessionHistory.entries} onClear={sessionHistory.clear} />;
            case 'info':
                return (
                    <InfoPanel
                        clip={props.selectedClip} media={selectedClipMedia}
                        sourceMedia={srcSource ? { name: srcSource.name, type: srcSource.type, duration: srcSource.duration } : null}
                        tracks={timelineTracks} clips={timelineClips} playhead={props.playheadPosition}
                        sequenceSize={{ width: preview.width, height: preview.height }}
                    />
                );
            case 'effectControls':
                return (
                    <EffectControlsPanel
                        clip={props.selectedClip}
                        media={selectedClipMedia}
                        trackLabel={props.selectedClip ? trackLabelById[props.selectedClip.trackId] : undefined}
                        onUpdateClip={onUpdateClip}
                        playhead={props.playheadPosition}
                        onSeek={(time) => props.onPlayheadUpdate(clampPlayhead(time))}
                    />
                );
            case 'audioMixer':
                return (
                    <AudioMixerPanel
                        tracks={timelineTracks} clips={timelineClips} mediaItems={mediaItems} levels={trackLevels}
                        onUpdateClip={onUpdateClip} onUpdateTrack={props.onUpdateTrack}
                    />
                );
            case 'inspector':
                return <div className="ppx-panel-fill"><InspectorPanel {...props} /></div>;
            case 'transitions':
                return <TransitionsPanel onApplyTransition={(type: TransitionType) => selectedClipId && props.onApplyTransition(selectedClipId, type)} disabled={!selectedClipId} />;
            case 'titles':
            case 'lookbook':
            case 'music':
            case 'autocut':
            case 'agent':
                return <div className="ppx-panel-fill">{renderLibraryContent(panel, libraryProps)}</div>;
            default:
                return null;
        }
    };

    const proBarTrailing = (
        <>
            <select value={preview.presetId} onChange={handlePresetChange} className="edit-select" title="Seitenverhältnis der Sequenz" data-automation-id="pp.sequence.aspect">
                {PREVIEW_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label === 'Custom' ? 'Eigenes…' : p.label}</option>)}
            </select>
            {preview.presetId === 'custom' && (
                <>
                    <input type="number" min="1" value={preview.width} onChange={e => handleDimChange('width', Number(e.target.value))} className="edit-input w-[4.4rem]" title="Breite" data-automation-id="pp.sequence.width" />
                    <span className="edit-toolbar__hint">×</span>
                    <input type="number" min="1" value={preview.height} onChange={e => handleDimChange('height', Number(e.target.value))} className="edit-input w-[4.4rem]" title="Höhe" data-automation-id="pp.sequence.height" />
                </>
            )}
            <button onClick={() => setShowShortcuts(true)} className="ppx-icon" title="Tastaturkürzel (?)" data-automation-id="pp.shortcuts">
                <KeyboardIcon className="w-4 h-4" />
            </button>
        </>
    );

    /* ─── Render ─── */
    return (
        <div className={`studio-workspace edit-workspace ppx-root ${isPro ? 'ppx-dark' : ''}`} style={{ gap: 0 }} data-automation-id="pp.editor" data-workspace={pro.workspace} data-tool={pro.tool}>
            {isPro && (
                <ModeBar
                    active="EDIT"
                    projectName={props.projectName}
                    onSwitch={props.onSwitchWorkspace}
                    canAccess={props.canAccessWorkspace}
                    trailing={(
                        <>
                            {shuttleRate !== 0 && <span className="ppx-modebar__shuttle" data-automation-id="pp.shuttle.rate">{formatShuttleRate(shuttleRate)}</span>}
                        </>
                    )}
                />
            )}
            <WorkspaceBar state={pro} dispatch={dispatchPro} trailing={isPro ? proBarTrailing : null} />
            {isPro ? (
                <div className="ppx-body">
                    <ProDock
                        layout={pro.layouts[pro.workspace as Exclude<typeof pro.workspace, 'classic'>]}
                        state={pro}
                        dispatch={dispatchPro}
                        renderPanel={renderProPanel}
                        renderHeaderExtras={(panel) => (panel === 'project'
                            ? <ProjectViewToggle view={pro.projectView} onChange={(view) => dispatchPro({ type: 'setProjectView', view })} />
                            : null)}
                    />
                </div>
            ) : (
        <div ref={containerRef} className="flex relative flex-1 min-h-0" style={{ padding: 8, gap: '0.5rem' }}>
            {/* Left panel */}
            {!collapsed.left && (
                <div style={{ flexBasis: `${panelWidths[0]}%`, minWidth: 0 }} className="edit-side-panel h-full">
                    <LibraryPanel {...libraryProps} />
                </div>
            )}

            {/* Left toggle */}
            <div className="relative flex-shrink-0" style={{ width: 0 }}>
                <button onClick={() => togglePanel('left')} className="edit-panel-toggle edit-panel-toggle--left" style={{ left: collapsed.left ? 0 : -2 }} title={collapsed.left ? 'Show Browser' : 'Hide Browser'}>
                    {collapsed.left ? <ChevronRightIcon className="w-3 h-3" /> : <ChevronLeftIcon className="w-3 h-3" />}
                </button>
            </div>

            {!collapsed.left && <DraggableDivider onDrag={handleDrag(0)} onDoubleClick={resetWidths} />}

            {/* Center */}
            <div ref={centerRef} style={{ flexBasis: `${panelWidths[1]}%`, flexGrow: 1, minWidth: 0 }} className="edit-center-panel flex flex-col h-full px-0.5">
                {/* Toolbar */}
                <div className="edit-toolbar">
                    <div className="edit-seg" role="tablist" aria-label="Monitor view">
                        {(['program', 'source', 'split'] as const).map(v => (
                            <button
                                key={v}
                                type="button"
                                role="tab"
                                aria-selected={effective === v}
                                onClick={() => setMonView(v)}
                                disabled={v === 'split' && !canSplit}
                                className={`edit-seg__item capitalize ${effective === v ? 'edit-seg__item--active' : ''}`}
                                title={v === 'split' && !canSplit ? 'Hide both side panels to use split view' : `Show ${v} monitor`}
                            >{v}</button>
                        ))}
                    </div>
                    <span className="edit-divider" />
                    <div className="edit-toolbar__group">
                        <select value={preview.presetId} onChange={handlePresetChange} className="edit-select" title="Sequence aspect ratio">
                            {PREVIEW_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label === 'Custom' ? 'Custom…' : p.label}</option>)}
                        </select>
                        {preview.presetId === 'custom' && (
                            <div className="edit-toolbar__group ml-1">
                                <input type="text" value={customRatio} onChange={e => handleRatioChange(e.target.value)} placeholder="16:9" className="edit-input w-16" title="Aspect ratio" />
                                <input type="number" min="1" value={preview.width} onChange={e => handleDimChange('width', Number(e.target.value))} className="edit-input w-[4.4rem]" title="Width" />
                                <span className="edit-toolbar__hint">×</span>
                                <input type="number" min="1" value={preview.height} onChange={e => handleDimChange('height', Number(e.target.value))} className="edit-input w-[4.4rem]" title="Height" />
                            </div>
                        )}
                    </div>
                    <span className="edit-divider" />
                    <div className="edit-toolbar__group">
                        <select value={activeLayoutName} onChange={e => { const l = allLayouts.find(x => x.name === e.target.value); if (l) applyLayout(l); }} className="edit-select" title="Panel layout">
                            <option value="" disabled>Layout…</option>
                            {allLayouts.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                        </select>
                        <button onClick={saveCurrentLayout} className="edit-text-btn" title="Save the current panel arrangement as a layout">Save</button>
                        {savedLayouts.some(l => l.name === activeLayoutName) && (
                            <button onClick={() => deleteLayout(activeLayoutName)} className="edit-text-btn" title="Delete this saved layout">Delete</button>
                        )}
                    </div>
                    <div className="edit-toolbar__spacer" />
                    <button onClick={toggleFocus} className={`edit-text-btn ${focusMode ? 'edit-text-btn--outline' : ''}`} title="Hide side panels and enlarge the timeline (F)">
                        {focusMode ? 'Exit focus' : 'Focus'}
                    </button>
                    <button onClick={() => setShowShortcuts(true)} className="edit-icon-btn" title="Keyboard shortcuts (?)">
                        <KeyboardIcon className="w-4 h-4" />
                    </button>
                </div>

                {/* Monitor - takes all remaining space */}
                <div className="flex-1 min-h-0" style={{ flexBasis: `${100 - tlHeight}%` }}>
                    <div className={`h-full grid gap-2 ${effective === 'split' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        {effective === 'split' ? <>{sourcePanel}{programPanel}</> : effective === 'source' ? sourcePanel : programPanel}
                    </div>
                </div>

                <HorizontalDraggableDivider onDrag={handleVDrag} onDoubleClick={resetTL} />

                {/* Timeline */}
                <div className="edit-timeline-surface flex flex-col" style={{ flexBasis: `${tlHeight}%`, minHeight: 180 }}>
                    <Timeline
                        tracks={timelineTracks} clips={timelineClips} mediaItems={mediaItems} selectedClipId={selectedClipId}
                        onSelectClip={props.onSelectClip} onUpdateClip={onUpdateClip} onBatchUpdateClips={props.onBatchUpdateClips}
                        playheadPosition={props.playheadPosition} isSnappingEnabled={props.isSnappingEnabled} trimMode={props.trimMode}
                        onTrimModeChange={props.onTrimModeChange}
                        onPlayheadUpdate={props.onPlayheadUpdate} onSnappingToggle={props.onSnappingToggle} onSplitClip={props.onSplitClip}
                        onAddTrack={props.onAddTrack} onUpdateTrack={props.onUpdateTrack} activeTrackId={props.activeTrackId}
                        onSetActiveTrack={props.onSetActiveTrack} onDropMedia={props.onDropMedia}
                        onDropLibraryAsset={props.onDropLibraryAsset}
                        onDropEffect={props.onDropEffectOnClip} onDropEffectStack={props.onDropEffectStackOnClip}
                        waveformCache={waveformCache}
                        onMatchGap={handleMatchTimelineGap}
                        rangeIn={pgmIn}
                        rangeOut={pgmOut}
                        onDeleteClip={props.onDeleteClip}
                        onRippleDeleteClip={props.onRippleDeleteClip}
                    />
                </div>
            </div>

            {/* Right divider */}
            {!collapsed.right && <DraggableDivider onDrag={handleDrag(1)} onDoubleClick={resetWidths} />}

            {/* Right toggle */}
            <div className="relative flex-shrink-0" style={{ width: 0 }}>
                <button onClick={() => togglePanel('right')} className="edit-panel-toggle edit-panel-toggle--right" style={{ right: collapsed.right ? 0 : -2 }} title={collapsed.right ? 'Show Inspector' : 'Hide Inspector'}>
                    {collapsed.right ? <ChevronLeftIcon className="w-3 h-3" /> : <ChevronRightIcon className="w-3 h-3" />}
                </button>
            </div>

            {/* Right panel */}
            {!collapsed.right && <div style={{ flexBasis: `${panelWidths[2]}%`, minWidth: 0 }} className="edit-side-panel h-full"><InspectorPanel {...props} /></div>}
        </div>
            )}

            <ImageEditorModal isOpen={imageEditorOpen} mediaItem={props.selectedMedia} onClose={() => setImageEditorOpen(false)} onSave={handleImageSave} />

            {proNotice && <div className="ppx-toast" role="status" aria-live="polite" data-automation-id="pp.notice">{proNotice}</div>}

            {/* Keyboard shortcuts overlay */}
            {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}

            {/* Fullscreen monitor overlay */}
            {isFullscreen && (
                <FullscreenMonitor onClose={() => setIsFullscreen(false)}>
                    <PlaybackResolutionContext.Provider value={playbackResValue}>
                        <PreviewPlayer
                            timelineClips={programClips} timelineTracks={timelineTracks} mediaItems={mediaItems}
                            playheadPosition={props.playheadPosition} isPlaying={props.isPlaying} onTogglePlayback={props.onTogglePlayback}
                            canvasWidth={preview.width} canvasHeight={preview.height} showControls={true}
                        />
                    </PlaybackResolutionContext.Provider>
                </FullscreenMonitor>
            )}
        </div>
    );
};

export default EditWorkspace;
