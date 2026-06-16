import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import { ChevronLeftIcon, ChevronRightIcon, BrushIcon } from '../components/icons';
import AutoCutPanel from '../components/AutoCutPanel';
import { VideoSegment } from '../services/autoCutService';
import { generateMusicPromptForTimeline } from '../services/geminiService';
import { generateSpeechWithElevenLabs } from '../services/elevenLabsService';
import { useLibraryAssets, type LibraryAsset } from '../hooks/useLibraryAssets';

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
}

/* ─── Sub-panels ─── */

const LookbookPanel: React.FC<any> = ({ references, onGenerateVideoFromRef, onEditImageRef }) => (
    <div className="bg-gray-800/50 p-4 flex flex-col h-full">
        <h3 className="text-lg font-semibold mb-4 text-white">Lookbook</h3>
        <div className="flex-grow overflow-y-auto pr-2 -mr-2 space-y-2">
            {references.length === 0 && <p className="text-gray-500 text-center">Run the &apos;Automated Production Pipeline&apos; in the &apos;Project&apos; tab to generate references.</p>}
            {references.map((ref: ReferenceItem) => (
                <div key={ref.id} className="bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                    <p className="font-semibold capitalize text-indigo-300">{ref.type}: {ref.name}</p>
                    {ref.isGenerating && <div className="text-center text-sm text-yellow-400 mt-2">Generating...</div>}
                    {ref.imageUrl && (
                        <div className="mt-2 flex items-center gap-2">
                            <img src={ref.imageUrl} className="w-16 h-16 object-cover rounded" alt={`Reference for ${ref.name}`} />
                            <div className="flex flex-col gap-1">
                                <button onClick={() => onEditImageRef(ref)} className="text-xs bg-purple-700 hover:bg-purple-600 px-2 py-1 rounded disabled:opacity-50" disabled={ref.isGenerating}>Edit</button>
                                <button onClick={() => onGenerateVideoFromRef(ref)} className="text-xs bg-green-700 hover:bg-green-600 px-2 py-1 rounded disabled:opacity-50" disabled={ref.isGenerating}>To Video</button>
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    </div>
);

const MusicAssistantPanel: React.FC<{
    timelineClips: TimelineClip[];
    mediaItems: MediaItem[];
    onAddGeneratedMedia: (item: MediaItem) => void;
    apiKeyReady: boolean;
}> = ({ timelineClips, mediaItems, onAddGeneratedMedia, apiKeyReady }) => {
    const [prompt, setPrompt] = useState('');
    const [mood, setMood] = useState('');
    const [duration, setDuration] = useState<number | null>(null);
    const [bpm, setBpm] = useState<number | null>(null);
    const [instruments, setInstruments] = useState<string[]>([]);
    const [mixNotes, setMixNotes] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState('');
    const [voiceId, setVoiceId] = useState('JBFqnCBsd6RMkjVDRZzb');
    const [modelId, setModelId] = useState('eleven_multilingual_v2');
    const [outputFormat, setOutputFormat] = useState('mp3_44100_128');

    const handleAnalyze = async () => {
        if (!apiKeyReady) return setError('Add a Google Gemini API key in Settings.');
        if (timelineClips.length === 0) return setError('Add clips to the timeline first.');
        setError('');
        setIsAnalyzing(true);
        try {
            const result = await generateMusicPromptForTimeline(timelineClips, mediaItems);
            setPrompt(result.prompt); setMood(result.mood); setDuration(result.duration);
            setBpm(typeof result.bpm === 'number' ? result.bpm : null);
            setInstruments(result.instruments || []); setMixNotes(result.mixNotes || '');
        } catch (e: any) { setError(e instanceof Error ? e.message : String(e)); } finally { setIsAnalyzing(false); }
    };

    const handleGenerateAudio = async () => {
        if (!prompt.trim()) return setError('Generate or enter a prompt first.');
        setError(''); setIsGenerating(true);
        try { const item = await generateSpeechWithElevenLabs(prompt, { voiceId, modelId, outputFormat }); onAddGeneratedMedia(item); }
        catch (e: any) { setError(e instanceof Error ? e.message : String(e)); } finally { setIsGenerating(false); }
    };

    return (
        <div className="bg-gray-800/50 p-4 flex flex-col h-full">
            <h3 className="text-lg font-semibold mb-4 text-white">Music Assistant</h3>
            <div className="space-y-3 text-xs text-gray-300">
                <button onClick={handleAnalyze} disabled={isAnalyzing} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2 rounded-lg">
                    {isAnalyzing ? 'Analyzing Timeline...' : 'Analyze Edit'}
                </button>
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="w-full bg-gray-900/70 border border-gray-700 rounded-lg p-2 text-xs" rows={5} placeholder="Music prompt will appear here..." />
                <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-400">
                    <div>Mood: <span className="text-gray-200">{mood || '-'}</span></div>
                    <div>Duration: <span className="text-gray-200">{duration ? `${duration.toFixed(1)}s` : '-'}</span></div>
                    <div>BPM: <span className="text-gray-200">{bpm ?? '-'}</span></div>
                    <div>Instruments: <span className="text-gray-200">{instruments.length ? instruments.join(', ') : '-'}</span></div>
                </div>
                {mixNotes && <p className="text-[10px] text-gray-400">Mix Notes: {mixNotes}</p>}
                <div className="space-y-2 pt-2 border-t border-gray-700">
                    <label className="text-[10px] text-gray-500 uppercase">ElevenLabs Voice ID</label>
                    <input value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className="w-full bg-gray-900/70 border border-gray-700 rounded-lg p-2 text-xs" />
                    <label className="text-[10px] text-gray-500 uppercase">ElevenLabs Model</label>
                    <input value={modelId} onChange={(e) => setModelId(e.target.value)} className="w-full bg-gray-900/70 border border-gray-700 rounded-lg p-2 text-xs" />
                    <label className="text-[10px] text-gray-500 uppercase">Output Format</label>
                    <input value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)} className="w-full bg-gray-900/70 border border-gray-700 rounded-lg p-2 text-xs" />
                    <button onClick={handleGenerateAudio} disabled={isGenerating} className="w-full bg-gray-700 hover:bg-gray-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2 rounded-lg">
                        {isGenerating ? 'Generating Audio...' : 'Generate Audio (ElevenLabs)'}
                    </button>
                </div>
                {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
        </div>
    );
};

type LibraryTabId = 'lookbook' | 'media' | 'titles' | 'effects' | 'transitions' | 'music' | 'autocut' | 'agent';
const LIBRARY_TAB_META: Array<{ id: LibraryTabId; label: string; description: string }> = [
    { id: 'lookbook', label: 'Lookbook', description: 'References, characters, environments.' },
    { id: 'media', label: 'Media', description: 'Source files and generated assets.' },
    { id: 'titles', label: 'Titles', description: 'Lower thirds, subtitles, kinetic text, review.' },
    { id: 'effects', label: 'Effects', description: 'Visual effects and generators.' },
    { id: 'transitions', label: 'Transitions', description: 'Cut, fade, wipe transitions.' },
    { id: 'music', label: 'Music', description: 'Music prompt analysis and generation.' },
    { id: 'autocut', label: 'Auto Cut', description: 'AI segment selection and verification.' },
    { id: 'agent', label: 'Agent', description: 'Plan and apply safe AI edit suggestions.' },
];

const LibraryPanel: React.FC<any> = (props) => {
    const [activeTab, setActiveTab] = useState<LibraryTabId>('effects');
    const [navigationView, setNavigationView] = useState<'tabs' | 'list'>('tabs');

    const renderTabContent = () => {
        switch (activeTab) {
            case 'lookbook':
                return <LookbookPanel {...props} onGenerateVideoFromRef={props.onGenerateVideoFromReference} onEditImageRef={props.onEditReferenceImage} />;
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
                    <div className="bg-gray-800/50 p-4 flex flex-col h-full">
                        <h3 className="text-lg font-semibold mb-4 text-white">Auto Cut</h3>
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
                    </div>
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

    return (
        <div className="flex flex-col h-full bg-gray-800/50 border border-gray-700/60 rounded-lg overflow-hidden">
            <div className="flex-shrink-0 border-b border-gray-700/50">
                <div className="flex items-center justify-between px-2.5 py-1">
                    <span className="text-[10px] uppercase tracking-widest text-gray-500 font-medium">Browser</span>
                    <div className="flex items-center gap-0.5 text-[9px]">
                        <button onClick={() => setNavigationView('tabs')} className={`px-1.5 py-0.5 rounded ${navigationView === 'tabs' ? 'bg-indigo-600/20 text-indigo-300' : 'text-gray-500 hover:text-gray-300'}`}>Tabs</button>
                        <button onClick={() => setNavigationView('list')} className={`px-1.5 py-0.5 rounded ${navigationView === 'list' ? 'bg-indigo-600/20 text-indigo-300' : 'text-gray-500 hover:text-gray-300'}`}>List</button>
                    </div>
                </div>
                {navigationView === 'tabs' ? (
                    <div className="flex overflow-x-auto">
                        {LIBRARY_TAB_META.map((tab) => (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id)} title={tab.description}
                                className={`px-2.5 py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === tab.id ? 'text-indigo-400 border-indigo-400 bg-gray-700/30' : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-700/20'}`}
                            >{tab.label}</button>
                        ))}
                    </div>
                ) : (
                    <div className="px-2 pb-2 space-y-1">
                        {LIBRARY_TAB_META.map((tab) => (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                                className={`w-full text-left rounded-md px-3 py-2 border ${activeTab === tab.id ? 'border-indigo-500/70 bg-indigo-700/20' : 'border-gray-700 bg-gray-900/40 hover:border-gray-600'}`}
                            >
                                <div className="text-sm font-semibold text-white">{tab.label}</div>
                                <div className="text-[11px] text-gray-400">{tab.description}</div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <div className="flex-grow min-h-0 flex flex-col">{renderTabContent()}</div>
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
        <div className={`w-[5px] h-full cursor-col-resize flex items-center justify-center group relative ${active ? 'bg-indigo-500/20' : ''}`} onMouseDown={handleMouseDown} onDoubleClick={onDoubleClick} title="Drag to resize · Double-click to reset">
            <div className="absolute inset-y-0 -left-1 -right-1 z-10" />
            <div className={`w-[3px] rounded-full transition-all duration-150 ${active ? 'bg-indigo-400 h-16' : 'bg-gray-600/50 h-10 group-hover:bg-indigo-400/60 group-hover:h-14'}`} />
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
        <div className={`h-[5px] w-full cursor-row-resize flex items-center justify-center group relative ${active ? 'bg-indigo-500/20' : ''}`} onMouseDown={handleMouseDown} onDoubleClick={onDoubleClick} title="Drag to resize · Double-click to reset">
            <div className="absolute -top-1 -bottom-1 inset-x-0 z-10" />
            <div className={`h-[3px] rounded-full transition-all duration-150 ${active ? 'bg-indigo-400 w-20' : 'bg-gray-600/50 w-14 group-hover:bg-indigo-400/60 group-hover:w-20'}`} />
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
            { keys: 'Home', desc: 'Go to start' },
            { keys: 'End', desc: 'Go to end' },
        ],
    },
    {
        title: 'Editing',
        shortcuts: [
            { keys: 'C', desc: 'Split / Cut at playhead' },
            { keys: 'Shift+Del', desc: 'Ripple delete' },
            { keys: 'Ctrl+Z', desc: 'Undo' },
            { keys: 'Ctrl+Shift+Z', desc: 'Redo' },
            { keys: 'Ctrl+C / V / X', desc: 'Copy / Paste / Cut' },
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
        title: 'Monitors & I/O',
        shortcuts: [
            { keys: 'I', desc: 'Mark In point' },
            { keys: 'O', desc: 'Mark Out point' },
            { keys: 'F11', desc: 'Fullscreen monitor' },
            { keys: 'Esc', desc: 'Exit fullscreen / close' },
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
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-lg font-semibold text-white">Keyboard Shortcuts</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-white text-sm px-2 py-1 rounded border border-gray-700 hover:border-gray-500">Esc</button>
                </div>
                <div className="grid grid-cols-2 gap-5">
                    {SHORTCUT_SECTIONS.map(sec => (
                        <div key={sec.title}>
                            <h3 className="text-xs uppercase tracking-widest text-indigo-400 font-semibold mb-2">{sec.title}</h3>
                            <div className="space-y-1">
                                {sec.shortcuts.map(s => (
                                    <div key={s.keys} className="flex items-center justify-between text-[11px] py-0.5">
                                        <span className="text-gray-400">{s.desc}</span>
                                        <kbd className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-300 font-mono ml-3 whitespace-nowrap">{s.keys}</kbd>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="mt-5 pt-3 border-t border-gray-700 text-[10px] text-gray-600 text-center">
                    Press <kbd className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-400 font-mono">?</kbd> to toggle this overlay
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
            <div className="flex-shrink-0 flex items-center justify-center py-2 bg-gray-900/80 text-[10px] text-gray-500">
                Double-click or press <kbd className="mx-1 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-400 font-mono">Esc</kbd> to exit fullscreen
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
    toolbarOpen: boolean;
}

const LAYOUTS_STORAGE_KEY = 'edit_workspace_saved_layouts_v1';
const ACTIVE_LAYOUT_KEY = 'edit_workspace_active_layout_v1';

const BUILTIN_LAYOUTS: LayoutPreset[] = [
    { name: 'Default', panelWidths: [14, 72, 14], collapsed: { left: false, right: false }, tlHeight: 38, toolbarOpen: true },
    { name: 'Wide Monitor', panelWidths: [10, 80, 10], collapsed: { left: false, right: false }, tlHeight: 32, toolbarOpen: false },
    { name: 'Edit Focus', panelWidths: [14, 72, 14], collapsed: { left: true, right: true }, tlHeight: 55, toolbarOpen: false },
    { name: 'Color Review', panelWidths: [14, 72, 14], collapsed: { left: true, right: false }, tlHeight: 28, toolbarOpen: false },
    { name: 'Media Import', panelWidths: [22, 60, 18], collapsed: { left: false, right: false }, tlHeight: 30, toolbarOpen: true },
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

const formatEditTime = (seconds: number | null | undefined) => {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--:--';
    const s = Math.max(0, seconds);
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}:${Math.floor((s % 1) * 100).toString().padStart(2, '0')}`;
};

/* ─── Persistence ─── */

const PANEL_WIDTHS_KEY = 'edit_workspace_panel_widths_v2';
const PANEL_COLLAPSE_KEY = 'edit_workspace_panel_collapsed_v1';
const WORKFLOW_VIEW_KEY = 'edit_workspace_flow_view_v1';
const TIMELINE_HEIGHT_KEY = 'edit_workspace_timeline_height_v3';
const TOOLBAR_COLLAPSED_KEY = 'edit_workspace_toolbar_collapsed_v1';

const DEFAULT_WIDTHS = [14, 72, 14];
const DEFAULT_TIMELINE = 38;
const MIN_PANEL = 8;
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
    const [wfView, setWfView] = useState<'compact' | 'list'>(() => loadJson<string>(WORKFLOW_VIEW_KEY, 'compact') === 'list' ? 'list' : 'compact');
    const [tlHeight, setTlHeight] = useState(getInitTL);
    const [monView, setMonView] = useState<'program' | 'source' | 'split'>('program');
    const [focusMode, setFocusMode] = useState(false);
    const [toolbarOpen, setToolbarOpen] = useState(() => loadJson<string>(TOOLBAR_COLLAPSED_KEY, 'false') !== 'true');
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
    const focusSnapRef = useRef<{ collapsed: typeof collapsed; tlHeight: number; monView: typeof monView; wfView: typeof wfView } | null>(null);
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
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
        setToolbarOpen(layout.toolbarOpen);
        setActiveLayoutName(layout.name);
        window.localStorage?.setItem(ACTIVE_LAYOUT_KEY, layout.name);
    }, []);

    const saveCurrentLayout = useCallback(() => {
        const name = window.prompt('Layout name:');
        if (!name?.trim()) return;
        const layout: LayoutPreset = { name: name.trim(), panelWidths, collapsed, tlHeight, toolbarOpen };
        const existing = savedLayouts.filter(l => l.name !== layout.name);
        const next = [...existing, layout];
        setSavedLayouts(next);
        saveSavedLayouts(next);
        setActiveLayoutName(layout.name);
        window.localStorage?.setItem(ACTIVE_LAYOUT_KEY, layout.name);
    }, [panelWidths, collapsed, tlHeight, toolbarOpen, savedLayouts]);

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
            if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleFocus(); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    const wfSteps: Array<{ id: string; label: string; workspace: Workspace; key: string; desc: string }> = [
        { id: 'media', label: 'Media', workspace: 'IMPORT', key: '1', desc: 'Collect and organize source assets.' },
        { id: 'trim', label: 'Trim', workspace: 'TRIM', key: '2', desc: 'Create selects and rough cuts.' },
        { id: 'edit', label: 'Edit', workspace: 'EDIT', key: '3', desc: 'Build the master timeline.' },
        { id: 'fusion', label: 'Fusion', workspace: 'COMPOSITING', key: '4', desc: 'Compositing, keys, and VFX layers.' },
        { id: 'color', label: 'Color', workspace: 'POST', key: '5', desc: 'Color grading and look matching.' },
        { id: 'fairlight', label: 'Fairlight', workspace: 'SOUND', key: '6', desc: 'Dialogue, music, and final mix.' },
        { id: 'deliver', label: 'Deliver', workspace: 'EXPORT', key: '7', desc: 'Render presets and final output.' },
    ];

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

    const do3PE = (mode: 'insert' | 'overwrite') => {
        if (!srcSource) { window.alert('Select a source item first.'); return; }
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
            return;
        }
        const r = props.onThreePointEdit({ mediaId: srcSource.id, sourceIn: srcIn, sourceOut: srcOut, timelineIn: pgmIn, timelineOut: pgmOut, mode, trackId: props.activeTrackId || undefined });
        if (!r.ok) window.alert(r.message);
    };

    const canSplit = collapsed.left && collapsed.right;
    const resolved: 'program' | 'source' | 'split' = monView === 'split' && canSplit ? 'split' : monView === 'source' ? 'source' : 'program';
    const effective = focusMode ? 'program' : resolved;

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
            window.alert('No strong automatic gap match found. Open the Media tab and use "Best Match for Current Gap" for manual picks.');
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
                window.alert(result.message);
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
        const sourceHotkeysArmed = Boolean(srcSource && effective !== 'program');
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
            if (key === ',' || key === 'arrowleft') {
                intercept();
                stepSourceFrame(-1);
                return;
            }
            if (key === '.' || key === 'arrowright') {
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
    }, [captureSourcePreviewFrame, effective, pauseSourcePlayback, srcPlay, srcSource, stepSourceFrame, toggleSrcPlay]);

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
            focusSnapRef.current = { collapsed, tlHeight, monView, wfView };
            setCollapsed({ left: true, right: true }); setTlHeight(55); setMonView('program'); setToolbarOpen(false); setFocusMode(true);
        } else {
            const s = focusSnapRef.current;
            if (s) { setCollapsed(s.collapsed); setTlHeight(s.tlHeight); setMonView(s.monView); setWfView(s.wfView); }
            focusSnapRef.current = null; setFocusMode(false);
        }
    };

    // Persistence
    useEffect(() => { if (preview.presetId !== 'custom') setCustomRatio(preview.presetId); }, [preview.presetId]);
    useEffect(() => { window.localStorage?.setItem(PANEL_WIDTHS_KEY, JSON.stringify(panelWidths)); }, [panelWidths]);
    useEffect(() => { window.localStorage?.setItem(PANEL_COLLAPSE_KEY, JSON.stringify(collapsed)); }, [collapsed]);
    useEffect(() => { window.localStorage?.setItem(WORKFLOW_VIEW_KEY, wfView); }, [wfView]);
    useEffect(() => { window.localStorage?.setItem(TIMELINE_HEIGHT_KEY, String(tlHeight)); }, [tlHeight]);
    useEffect(() => { window.localStorage?.setItem(TOOLBAR_COLLAPSED_KEY, String(!toolbarOpen)); }, [toolbarOpen]);

    useEffect(() => {
        if (externalSourceAsset) return;
        if (props.selectedMedia?.id) {
            setSrcId(props.selectedMedia.id);
            return;
        }
        if (!srcId && mediaItems.length > 0) setSrcId(mediaItems[0].id);
    }, [externalSourceAsset, props.selectedMedia?.id, mediaItems, srcId]);
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

    /* ─── Source Monitor ─── */
    const sourcePanel = (
        <div className="edit-monitor-panel bg-gray-900/50 border border-gray-700/50 rounded-lg flex flex-col min-h-0 overflow-hidden">
            <div className="edit-monitor-panel__bar flex items-center justify-between px-2 py-1 border-b border-gray-700/30 bg-gray-800/30 flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] uppercase tracking-widest text-gray-500 font-medium">Source</span>
                    {srcSource?.kind === 'library' && (
                        <span className="truncate rounded border border-indigo-500/40 bg-indigo-600/10 px-1.5 py-0.5 text-[10px] text-indigo-200">
                            Browser: {srcSource.projectLabel}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <select value={srcSource?.kind === 'project' ? (srcId || '') : ''} onChange={e => { setExternalSourceAsset(null); setSrcId(e.target.value || null); }} className="max-w-[160px] bg-gray-900/80 border border-gray-700/50 rounded px-1.5 py-0.5 text-[10px] text-gray-300">
                        <option value="">Project media...</option>
                        {mediaItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                    {srcSource?.kind === 'library' && (
                        <button onClick={() => setExternalSourceAsset(null)} className="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 border border-gray-700/50 text-gray-300 hover:bg-gray-700">
                            Clear
                        </button>
                    )}
                </div>
            </div>
            <div className="edit-monitor-panel__stage relative bg-black flex-1 min-h-[100px]">
                {!srcSource && <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-600">Select or load media to preview</div>}
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
                {srcSource?.type === 'audio' && <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-1"><div className="text-[10px] uppercase tracking-widest text-gray-600">Audio</div><div className="text-xs font-medium">{srcSource.name}</div><audio ref={srcAudioRef} src={srcSource.url} onTimeUpdate={e => setSrcPlay(e.currentTarget.currentTime || 0)} onEnded={() => setSrcPlaying(false)} /></div>}
            </div>
            <div className="edit-monitor-panel__controls flex items-center gap-1 px-2 py-0.5 border-t border-gray-700/30 bg-gray-800/20 flex-shrink-0">
                <button onClick={toggleSrcPlay} disabled={!srcSource || srcSource.type === 'image'} className="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 border border-gray-700/50 text-gray-300 disabled:opacity-40 hover:bg-gray-700">{srcPlaying ? 'Pause' : 'Play'}</button>
                <button onClick={() => stepSourceFrame(-1)} disabled={!srcSource || srcSource.type === 'image'} className="px-1 py-0.5 rounded text-[10px] bg-gray-800 border border-gray-700/50 text-gray-300 disabled:opacity-40">-1f</button>
                <button onClick={() => stepSourceFrame(1)} disabled={!srcSource || srcSource.type === 'image'} className="px-1 py-0.5 rounded text-[10px] bg-gray-800 border border-gray-700/50 text-gray-300 disabled:opacity-40">+1f</button>
                <button onClick={markSrcIn} disabled={!srcSource} className="px-1 py-0.5 rounded text-[10px] bg-indigo-900/25 border border-indigo-500/30 text-indigo-300 disabled:opacity-40">I</button>
                <button onClick={markSrcOut} disabled={!srcSource} className="px-1 py-0.5 rounded text-[10px] bg-indigo-900/25 border border-indigo-500/30 text-indigo-300 disabled:opacity-40">O</button>
                <button onClick={() => { setSrcIn(null); setSrcOut(null); }} className="px-1 py-0.5 rounded text-[10px] bg-gray-800 border border-gray-700/50 text-gray-500">Clear</button>
                <span className="text-[9px] text-gray-600 ml-auto hidden sm:inline">J/K/L ,/. · {formatEditTime(srcIn)} - {formatEditTime(srcOut)}</span>
            </div>
            <input type="range" min={0} max={srcDur} step={0.01} value={Math.max(0, Math.min(srcDur, srcPlay))} onChange={e => seekSrc(Number(e.target.value))} disabled={!srcSource} className="w-full h-1 bg-gray-800 cursor-pointer accent-indigo-500 flex-shrink-0" />
        </div>
    );

    /* ─── Program Monitor ─── */
    const programPanel = (
        <div className="edit-monitor-panel bg-gray-900/50 border border-gray-700/50 rounded-lg flex flex-col min-h-0 overflow-hidden relative">
            <div className="edit-monitor-panel__bar flex items-center justify-between px-2 py-1 border-b border-gray-700/30 bg-gray-800/30 flex-shrink-0">
                <span className="text-[10px] uppercase tracking-widest text-gray-500 font-medium">Program</span>
                <div className="flex items-center gap-1">
                    <button onClick={markPgmIn} className="px-1 py-0.5 rounded text-[10px] bg-indigo-900/25 border border-indigo-500/30 text-indigo-300">I</button>
                    <button onClick={markPgmOut} className="px-1 py-0.5 rounded text-[10px] bg-indigo-900/25 border border-indigo-500/30 text-indigo-300">O</button>
                    <button onClick={() => { setPgmIn(null); setPgmOut(null); }} className="px-1 py-0.5 rounded text-[10px] bg-gray-800 border border-gray-700/50 text-gray-500">Clear</button>
                    <span className="text-[9px] text-gray-600 hidden sm:inline ml-0.5">{formatEditTime(pgmIn)} - {formatEditTime(pgmOut)}</span>
                    <span className="mx-0.5 text-gray-700/50">|</span>
                    <button onClick={() => do3PE('insert')} className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-900/25 border border-emerald-500/30 text-emerald-300">Insert</button>
                    <button onClick={() => do3PE('overwrite')} className="px-1.5 py-0.5 rounded text-[10px] bg-amber-900/25 border border-amber-500/30 text-amber-300">Overwrite</button>
                </div>
            </div>
            <div className="edit-monitor-panel__stage flex-1 min-h-[100px] relative bg-black" onDoubleClick={() => setIsFullscreen(true)} title="Double-click for fullscreen">
                <PreviewPlayer
                    timelineClips={timelineClips} timelineTracks={timelineTracks} mediaItems={mediaItems}
                    playheadPosition={props.playheadPosition} isPlaying={props.isPlaying} onTogglePlayback={props.onTogglePlayback}
                    canvasWidth={preview.width} canvasHeight={preview.height} aspectStyle={aspect} showControls={false}
                />
                {props.selectedMedia?.type === 'image' && (
                    <button onClick={(e) => { e.stopPropagation(); setImageEditorOpen(true); }} className="absolute top-2 right-2 bg-gray-900/60 hover:bg-indigo-600 text-white p-1.5 rounded-lg backdrop-blur-sm border border-gray-600/40 transition-colors z-30" title="Open Image Editor">
                        <BrushIcon className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
    );

    /* ─── Render ─── */
    return (
        <div ref={containerRef} className="studio-workspace edit-workspace h-full flex relative" style={{ padding: 8 }}>
            {/* Left panel */}
            {!collapsed.left && (
                <div style={{ flexBasis: `${panelWidths[0]}%`, minWidth: 0 }} className="edit-side-panel h-full">
                    <LibraryPanel
                        {...props}
                        onCreateTitleClip={createTitleClipFromPreset}
                        onApplyTitlePresetToSelected={applyTitlePresetToSelected}
                        onApplyTitleTreatmentToSelected={applyTitleTreatmentToSelected}
                        onApplyTitleMotionToSelected={applyTitleMotionToSelected}
                        onToggleTitleAutoContrastForSelected={toggleTitleAutoContrastForSelected}
                        onGenerateSubtitlesFromSelected={generateSubtitlesFromSelected}
                        onUpdateSubtitleClipContent={props.onUpdateSubtitleClipContent}
                        onSplitSubtitleClip={props.onSplitSubtitleClip}
                        onMergeSubtitleClip={props.onMergeSubtitleClip}
                        onLoadMediaToSource={loadMediaToSource}
                        onLoadLibraryAssetToSource={loadLibraryAssetToSource}
                        sourcePreviewFrame={sourcePreviewFrame}
                        sourcePreviewLabel={srcSource ? `${srcSource.name} @ ${formatEditTime(srcPlay)}` : 'Source monitor'}
                    />
                </div>
            )}

            {/* Left toggle */}
            <div className="relative flex-shrink-0" style={{ width: 0 }}>
                <button onClick={() => togglePanel('left')} className="absolute top-1/2 -translate-y-1/2 z-20 w-4 h-8 bg-gray-700/70 hover:bg-indigo-600 rounded-r flex items-center justify-center transition-colors" style={{ left: collapsed.left ? 0 : -2 }} title={collapsed.left ? 'Show Browser' : 'Hide Browser'}>
                    {collapsed.left ? <ChevronRightIcon className="w-3 h-3 text-gray-300" /> : <ChevronLeftIcon className="w-3 h-3 text-gray-300" />}
                </button>
            </div>

            {!collapsed.left && <DraggableDivider onDrag={handleDrag(0)} onDoubleClick={resetWidths} />}

            {/* Center */}
            <div ref={centerRef} style={{ flexBasis: `${panelWidths[1]}%`, flexGrow: 1, minWidth: 0 }} className="edit-center-panel flex flex-col h-full px-0.5">
                {/* Unified compact toolbar */}
                <div className="edit-toolbar flex items-center gap-1.5 px-2 py-1 bg-gray-800/30 border border-gray-700/40 rounded flex-shrink-0 mb-px">
                    {/* Monitor switcher */}
                    <div className="flex items-center gap-px">
                        {(['program', 'source', 'split'] as const).map(v => (
                            <button key={v} onClick={() => setMonView(v)} disabled={v === 'split' && !canSplit}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium capitalize transition-colors ${effective === v ? 'bg-indigo-600/25 text-indigo-300' : 'text-gray-500 hover:text-gray-300'} ${v === 'split' && !canSplit ? 'opacity-25 cursor-not-allowed' : ''}`}
                            >{v}</button>
                        ))}
                    </div>
                    <div className="w-px h-3.5 bg-gray-700/40" />
                    <button onClick={toggleFocus} className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${focusMode ? 'bg-emerald-600/20 text-emerald-300' : 'text-gray-500 hover:text-gray-300'}`}>{focusMode ? 'Exit Focus' : 'Focus'}</button>
                    <div className="w-px h-3.5 bg-gray-700/40" />
                    <select value={preview.presetId} onChange={handlePresetChange} className="bg-transparent border-none text-[10px] text-gray-400 cursor-pointer px-0.5 py-0.5">
                        {PREVIEW_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                    <span className="text-[9px] text-gray-600 hidden md:inline">{preview.width}x{preview.height}</span>
                    <div className="w-px h-3.5 bg-gray-700/40" />
                    {/* Layout selector */}
                    <select value={activeLayoutName} onChange={e => { const l = allLayouts.find(x => x.name === e.target.value); if (l) applyLayout(l); }} className="bg-transparent border-none text-[10px] text-gray-400 cursor-pointer px-0.5 py-0.5">
                        <option value="" disabled>Layout...</option>
                        {allLayouts.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                    </select>
                    <button onClick={saveCurrentLayout} className="text-[10px] text-gray-500 hover:text-indigo-300 transition-colors" title="Save current layout">Save</button>
                    {savedLayouts.some(l => l.name === activeLayoutName) && (
                        <button onClick={() => deleteLayout(activeLayoutName)} className="text-[10px] text-gray-500 hover:text-red-400 transition-colors" title="Delete layout">Del</button>
                    )}
                    <button onClick={() => setToolbarOpen(!toolbarOpen)} className="ml-auto text-[10px] text-gray-500 hover:text-gray-300 px-1">{toolbarOpen ? 'Less' : 'More...'}</button>
                </div>

                {/* Expandable area */}
                {toolbarOpen && !focusMode && (
                    <div className="flex flex-col gap-px mb-px flex-shrink-0 animate-fadeIn">
                        <div className="bg-gray-800/30 border border-gray-700/40 rounded px-2 py-1">
                            <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[9px] uppercase tracking-widest text-gray-600 font-medium">Post Flow</span>
                                <div className="flex gap-0.5 text-[9px]">
                                    <button onClick={() => setWfView('compact')} className={wfView === 'compact' ? 'text-indigo-300' : 'text-gray-600'}>Compact</button>
                                    <button onClick={() => setWfView('list')} className={wfView === 'list' ? 'text-indigo-300' : 'text-gray-600'}>List</button>
                                </div>
                            </div>
                            {wfView === 'compact' ? (
                                <div className="flex gap-1 overflow-x-auto pb-0.5">
                                    {wfSteps.map(s => {
                                        const cur = s.workspace === 'EDIT';
                                        const ok = props.canAccessWorkspace ? props.canAccessWorkspace(s.workspace) : true;
                                        return <button key={s.id} disabled={!ok} onClick={() => props.onSwitchWorkspace?.(s.workspace)} title={s.desc}
                                            className={`rounded border px-2 py-0.5 text-[11px] font-medium transition min-w-[70px] ${cur ? 'border-indigo-500/50 bg-indigo-700/20 text-white' : 'border-gray-700/40 bg-gray-900/20 text-gray-400 hover:border-gray-600'} ${!ok ? 'opacity-25 cursor-not-allowed' : ''}`}
                                        >{s.label} <span className="text-gray-600 text-[9px]">{s.key}</span></button>;
                                    })}
                                </div>
                            ) : (
                                <div className="space-y-0.5">{wfSteps.map(s => {
                                    const cur = s.workspace === 'EDIT'; const ok = props.canAccessWorkspace ? props.canAccessWorkspace(s.workspace) : true;
                                    return <button key={s.id} disabled={!ok} onClick={() => props.onSwitchWorkspace?.(s.workspace)}
                                        className={`w-full rounded border px-2 py-1 text-left text-[11px] transition ${cur ? 'border-indigo-500/50 bg-indigo-700/20' : 'border-gray-700/40 bg-gray-900/20 hover:border-gray-600'} ${!ok ? 'opacity-25 cursor-not-allowed' : ''}`}
                                    ><div className="flex justify-between"><span className="font-medium text-white">{s.label}</span><span className="text-[9px] text-gray-600">Key {s.key}</span></div><div className="text-[10px] text-gray-500">{s.desc}</div></button>;
                                })}</div>
                            )}
                        </div>
                        {preview.presetId === 'custom' && (
                            <div className="flex items-center gap-2 bg-gray-800/30 border border-gray-700/40 rounded px-2 py-0.5 text-[10px] text-gray-400">
                                <span className="text-gray-600">Ratio</span>
                                <input type="text" value={customRatio} onChange={e => handleRatioChange(e.target.value)} placeholder="16:9" className="w-14 bg-gray-900/50 border border-gray-700/40 rounded px-1 py-0.5 text-[10px] text-gray-300" />
                                <span className="text-gray-600">W</span>
                                <input type="number" min="1" value={preview.width} onChange={e => handleDimChange('width', Number(e.target.value))} className="w-14 bg-gray-900/50 border border-gray-700/40 rounded px-1 py-0.5 text-[10px] text-gray-300" />
                                <span className="text-gray-600">H</span>
                                <input type="number" min="1" value={preview.height} onChange={e => handleDimChange('height', Number(e.target.value))} className="w-14 bg-gray-900/50 border border-gray-700/40 rounded px-1 py-0.5 text-[10px] text-gray-300" />
                            </div>
                        )}
                    </div>
                )}

                {/* Monitor - takes all remaining space */}
                <div className="flex-1 min-h-0" style={{ flexBasis: `${100 - tlHeight}%` }}>
                    <div className={`h-full grid gap-px ${effective === 'split' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        {effective === 'split' ? <>{sourcePanel}{programPanel}</> : effective === 'source' ? sourcePanel : programPanel}
                    </div>
                </div>

                <HorizontalDraggableDivider onDrag={handleVDrag} onDoubleClick={resetTL} />

                {/* Timeline */}
                <div className="flex flex-col gap-px" style={{ flexBasis: `${tlHeight}%`, minHeight: 160 }}>
                    <div className="flex items-center justify-between gap-1 bg-gray-800/30 border border-gray-700/40 rounded px-2 py-0.5 flex-shrink-0">
                        <div className="flex items-center gap-0.5 flex-wrap">
                            {([
                                { m: 'normal' as const, l: 'Trim', k: 'V', c: 'indigo' },
                                { m: 'ripple' as const, l: 'Ripple', k: 'R', c: 'amber' },
                                { m: 'roll' as const, l: 'Roll', k: 'O', c: 'cyan' },
                                { m: 'slip' as const, l: 'Slip', k: 'Y', c: 'fuchsia' },
                                { m: 'slide' as const, l: 'Slide', k: 'U', c: 'emerald' },
                            ]).map(({ m, l, k, c }) => (
                                <button key={m} onClick={() => props.onTrimModeChange(m)}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors ${props.trimMode === m ? `bg-${c}-700/25 border-${c}-500/40 text-${c}-300` : 'bg-transparent border-gray-700/30 text-gray-500 hover:text-gray-300'}`}
                                >{l} ({k})</button>
                            ))}
                        </div>
                        <div className="flex items-center gap-2 text-[9px] text-gray-600">
                            <span className="hidden lg:inline">Space/K J/L C</span>
                            <span className={`px-1 py-0.5 rounded ${props.isSnappingEnabled ? 'bg-indigo-900/15 text-indigo-400' : 'text-gray-600'}`}>Snap {props.isSnappingEnabled ? 'On' : 'Off'}</span>
                        </div>
                    </div>
                    <div className="edit-timeline-surface flex-1 min-h-0">
                        <Timeline
                            tracks={timelineTracks} clips={timelineClips} mediaItems={mediaItems} selectedClipId={selectedClipId}
                            onSelectClip={props.onSelectClip} onUpdateClip={onUpdateClip} onBatchUpdateClips={props.onBatchUpdateClips}
                            playheadPosition={props.playheadPosition} isSnappingEnabled={props.isSnappingEnabled} trimMode={props.trimMode}
                            onPlayheadUpdate={props.onPlayheadUpdate} onSnappingToggle={props.onSnappingToggle} onSplitClip={props.onSplitClip}
                            onAddTrack={props.onAddTrack} onUpdateTrack={props.onUpdateTrack} activeTrackId={props.activeTrackId}
                            onSetActiveTrack={props.onSetActiveTrack} onDropMedia={props.onDropMedia}
                            onDropLibraryAsset={props.onDropLibraryAsset}
                            onDropEffect={props.onDropEffectOnClip} onDropEffectStack={props.onDropEffectStackOnClip}
                            waveformCache={waveformCache}
                            onMatchGap={handleMatchTimelineGap}
                        />
                    </div>
                </div>
            </div>

            {/* Right divider */}
            {!collapsed.right && <DraggableDivider onDrag={handleDrag(1)} onDoubleClick={resetWidths} />}

            {/* Right toggle */}
            <div className="relative flex-shrink-0" style={{ width: 0 }}>
                <button onClick={() => togglePanel('right')} className="absolute top-1/2 -translate-y-1/2 z-20 w-4 h-8 bg-gray-700/70 hover:bg-indigo-600 rounded-l flex items-center justify-center transition-colors" style={{ right: collapsed.right ? 0 : -2 }} title={collapsed.right ? 'Show Inspector' : 'Hide Inspector'}>
                    {collapsed.right ? <ChevronLeftIcon className="w-3 h-3 text-gray-300" /> : <ChevronRightIcon className="w-3 h-3 text-gray-300" />}
                </button>
            </div>

            {/* Right panel */}
            {!collapsed.right && <div style={{ flexBasis: `${panelWidths[2]}%`, minWidth: 0 }} className="edit-side-panel h-full"><InspectorPanel {...props} /></div>}

            <ImageEditorModal isOpen={imageEditorOpen} mediaItem={props.selectedMedia} onClose={() => setImageEditorOpen(false)} onSave={handleImageSave} />

            {/* Keyboard shortcuts overlay */}
            {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}

            {/* Fullscreen monitor overlay */}
            {isFullscreen && (
                <FullscreenMonitor onClose={() => setIsFullscreen(false)}>
                    <PreviewPlayer
                        timelineClips={timelineClips} timelineTracks={timelineTracks} mediaItems={mediaItems}
                        playheadPosition={props.playheadPosition} isPlaying={props.isPlaying} onTogglePlayback={props.onTogglePlayback}
                        canvasWidth={preview.width} canvasHeight={preview.height} showControls={true}
                    />
                </FullscreenMonitor>
            )}
        </div>
    );
};

export default EditWorkspace;
