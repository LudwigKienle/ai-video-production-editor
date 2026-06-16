


import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MediaItem, TimelineClip, EffectType, Effect, ReferenceItem, TransitionType, TimelineTrack, WaveformCache } from '../types';
import { FunctionDeclaration } from '@google/genai';
import MediaBin from '../components/MediaBin';
import EffectsPanel from '../components/EffectsPanel';
import PreviewPlayer from '../components/PreviewPlayer';
import Timeline from '../components/Timeline';
import InspectorPanel from '../components/InspectorPanel';
import TransitionsPanel from '../components/TransitionsPanel';
import ImageEditorModal from '../components/ImageEditorModal';
import { ChevronLeftIcon, ChevronRightIcon, BrushIcon } from '../components/icons';
import { generateMusicPromptForTimeline } from '../services/geminiService';
import { generateSpeechWithElevenLabs } from '../services/elevenLabsService';

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
    onSelectClip: (clipId: string | null) => void;
    onApplyCSSEffect: (effect: EffectType) => void;
    onApplyAIEffect: (effect: Effect) => void;
    onApplyNativeEffect: (effect: Effect, value: string) => void;
    onUpdateClip: (updatedClip: TimelineClip) => void;
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
    isPlaying: boolean;
    onTogglePlayback: () => void;
    onDeleteClip: () => void;
    onDropMedia: (mediaId: string, trackId: string, time: number) => void;
    onAddGeneratedMedia: (item: MediaItem) => void;
}

const LookbookPanel: React.FC<any> = ({ references, setReferences, onGenerateVideoFromRef, onEditImageRef }) => {
    return (
        <div className="bg-gray-800/50 p-4 flex flex-col h-full">
            <h3 className="text-lg font-semibold mb-4 text-white">Lookbook</h3>
            <div className="flex-grow overflow-y-auto pr-2 -mr-2 space-y-2">
                {references.length === 0 && <p className="text-gray-500 text-center">Run the 'Automated Production Pipeline' in the 'Project' tab to generate references.</p>}
                {references.map(ref => (
                    <div key={ref.id} className="bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                        <p className="font-semibold capitalize text-indigo-300">{ref.type}: {ref.name}</p>
                        {ref.isGenerating && <div className="text-center text-sm text-yellow-400 mt-2">Generating...</div>}
                        {ref.imageUrl && (
                             <div className="mt-2 flex items-center gap-2">
                                <img src={ref.imageUrl} className="w-16 h-16 object-cover rounded" alt={`Reference for ${ref.name}`}/>
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
};

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
            setPrompt(result.prompt);
            setMood(result.mood);
            setDuration(result.duration);
            setBpm(typeof result.bpm === 'number' ? result.bpm : null);
            setInstruments(result.instruments || []);
            setMixNotes(result.mixNotes || '');
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setError(msg);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleGenerateAudio = async () => {
        if (!prompt.trim()) return setError('Generate or enter a prompt first.');
        setError('');
        setIsGenerating(true);
        try {
            const item = await generateSpeechWithElevenLabs(prompt, { voiceId, modelId, outputFormat });
            onAddGeneratedMedia(item);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setError(msg);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="bg-gray-800/50 p-4 flex flex-col h-full">
            <h3 className="text-lg font-semibold mb-4 text-white">Music Assistant</h3>
            <div className="space-y-3 text-xs text-gray-300">
                <button
                    onClick={handleAnalyze}
                    disabled={isAnalyzing}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2 rounded-lg"
                >
                    {isAnalyzing ? 'Analyzing Timeline...' : 'Analyze Edit'}
                </button>
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="w-full bg-gray-900/70 border border-gray-700 rounded-lg p-2 text-xs"
                    rows={5}
                    placeholder="Music prompt will appear here..."
                />
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
                    <button
                        onClick={handleGenerateAudio}
                        disabled={isGenerating}
                        className="w-full bg-gray-700 hover:bg-gray-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2 rounded-lg"
                    >
                        {isGenerating ? 'Generating Audio...' : 'Generate Audio (ElevenLabs)'}
                    </button>
                </div>
                {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
        </div>
    );
};

const LibraryPanel: React.FC<any> = (props) => {
    const [activeTab, setActiveTab] = useState('effects');

    const renderTabContent = () => {
        switch (activeTab) {
            case 'lookbook':
                return <LookbookPanel {...props} onGenerateVideoFromRef={props.onGenerateVideoFromReference} onEditImageRef={props.onEditReferenceImage} />;
            case 'media':
                return <MediaBin mediaItems={props.mediaItems} onAddMedia={props.onAddMedia} onAddToTimeline={props.onAddToTimeline} />;
            case 'effects':
                return <EffectsPanel onApplyEffect={props.onApplyCSSEffect} onApplyAIEffect={props.onApplyAIEffect} onApplyNativeEffect={props.onApplyNativeEffect} disabled={!props.selectedClipId} />;
            case 'transitions':
                return <TransitionsPanel onApplyTransition={props.onApplyTransition} disabled={!props.selectedClipId} />;
            case 'music':
                return <MusicAssistantPanel timelineClips={props.timelineClips} mediaItems={props.mediaItems} onAddGeneratedMedia={props.onAddGeneratedMedia} apiKeyReady={props.apiKeyReady} />;
            default:
                return null;
        }
    }

    return (
        <div className="flex flex-col h-full bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
            <div className="flex-shrink-0 flex border-b border-gray-700">
                <button onClick={() => setActiveTab('lookbook')} className={`px-4 py-2 text-sm font-medium ${activeTab === 'lookbook' ? 'text-indigo-400 bg-gray-700/50' : 'text-gray-400 hover:bg-gray-700/30'}`}>Lookbook</button>
                <button onClick={() => setActiveTab('media')} className={`px-4 py-2 text-sm font-medium ${activeTab === 'media' ? 'text-indigo-400 bg-gray-700/50' : 'text-gray-400 hover:bg-gray-700/30'}`}>Media</button>
                <button onClick={() => setActiveTab('effects')} className={`px-4 py-2 text-sm font-medium ${activeTab === 'effects' ? 'text-indigo-400 bg-gray-700/50' : 'text-gray-400 hover:bg-gray-700/30'}`}>Effects</button>
                <button onClick={() => setActiveTab('transitions')} className={`px-4 py-2 text-sm font-medium ${activeTab === 'transitions' ? 'text-indigo-400 bg-gray-700/50' : 'text-gray-400 hover:bg-gray-700/30'}`}>Transitions</button>
                <button onClick={() => setActiveTab('music')} className={`px-4 py-2 text-sm font-medium ${activeTab === 'music' ? 'text-indigo-400 bg-gray-700/50' : 'text-gray-400 hover:bg-gray-700/30'}`}>Music</button>
            </div>
            <div className="flex-grow min-h-0 flex flex-col">
                {renderTabContent()}
            </div>
        </div>
    )
}

const DraggableDivider: React.FC<{ onDrag: (delta: number) => void }> = ({ onDrag }) => {
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;
            onDrag(deltaX);
        };

        const handleMouseUp = () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    return (
        <div
            className="w-2 h-full cursor-col-resize bg-gray-700/50 hover:bg-indigo-500 transition-colors"
            onMouseDown={handleMouseDown}
        />
    );
};

const EditWorkspace: React.FC<EditWorkspaceProps> = (props) => {
    const { mediaItems, timelineClips, selectedClipId, selectedClip, onUpdateClip, timelineTracks, waveformCache, onAddMedia } = props;

    const containerRef = useRef<HTMLDivElement>(null);
    const [panelWidths, setPanelWidths] = useState([25, 50, 25]); // Percentages
    const [collapsedPanels, setCollapsedPanels] = useState({ left: false, right: false });
    const [isImageEditorOpen, setIsImageEditorOpen] = useState(false);

    const handleDrag = (dividerIndex: number) => (deltaX: number) => {
        if (!containerRef.current) return;
        const totalWidth = containerRef.current.offsetWidth;
        const deltaPercent = (deltaX / totalWidth) * 100;

        setPanelWidths(prev => {
            const newWidths = [...prev];
            newWidths[dividerIndex] += deltaPercent;
            newWidths[dividerIndex + 1] -= deltaPercent;

            const minWidth = 15; // Min width in percent
            if (newWidths[dividerIndex] < minWidth || newWidths[dividerIndex + 1] < minWidth) {
                return prev; // Don't allow resizing below min width
            }
            return newWidths;
        });
    };

    const togglePanel = (panel: 'left' | 'right') => {
        setCollapsedPanels(prev => ({ ...prev, [panel]: !prev[panel] }));
    };

    const handleImageEditorSave = (newMedia: MediaItem) => {
        const file = new File([], newMedia.name); // Dummy file object since we just need to add it to state
        // Manually update parent state since onAddMedia expects FileList
        // We really just want to push to mediaItems in parent.
        // Quick hack: Use a callback prop in parent or extend onAddMedia to accept MediaItem directly.
        // Assuming parent has access, we can't easily push from here without lifting state logic or props modification.
        // Let's modify App.tsx handleAddMedia or just pass a new prop.
        // For now, we will assume onAddMedia can handle it if we mock a FileList, or better, change MediaBin logic.
        // Actually, let's just use a direct prop if possible, but to minimize changes, let's just trigger a re-fetch or similar.
        // EASIEST: Just append to mediaItems via a new prop `onAddGeneratedMedia`.
        // Since we don't have that prop, we will use a workaround or add it to `EditWorkspaceProps`.
        // Let's assume onAddMedia is strictly for files. We need `setMediaItems` from App.tsx or similar.
        // Wait, `onRoughCutReady` in ProjectWorkspace accepted MediaItem[].
        // Let's just create a File from the Blob and use onAddMedia.

        fetch(newMedia.url)
            .then(res => res.blob())
            .then(blob => {
                const file = new File([blob], newMedia.name, { type: 'image/png' });
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                onAddMedia(dataTransfer.files);
            });
    };

    return (
        <div ref={containerRef} className="p-4 h-full flex gap-0 relative">
            {!collapsedPanels.left && (
                <div style={{ flexBasis: `${panelWidths[0]}%` }} className="min-w-0 h-full transition-all duration-300">
                    <LibraryPanel {...props} />
                </div>
            )}
             <div className="relative">
                <button
                    onClick={() => togglePanel('left')}
                    className="absolute top-1/2 -translate-y-1/2 -left-2.5 z-20 w-5 h-10 bg-indigo-600 hover:bg-indigo-500 rounded-r-md flex items-center justify-center"
                    title={collapsedPanels.left ? "Expand" : "Collapse"}
                >
                    {collapsedPanels.left ? <ChevronRightIcon className="w-4 h-4 text-white"/> : <ChevronLeftIcon className="w-4 h-4 text-white"/>}
                </button>
            </div>
            {!collapsedPanels.left && <DraggableDivider onDrag={handleDrag(0)} />}

            <div style={{ flexBasis: `${panelWidths[1]}%` }} className="flex flex-col gap-4 h-full min-w-0 px-2">
                <div className="flex-grow min-h-0 relative">
                    <PreviewPlayer
                        timelineClips={timelineClips}
                        timelineTracks={timelineTracks}
                        mediaItems={mediaItems}
                        playheadPosition={props.playheadPosition}
                        isPlaying={props.isPlaying}
                        onTogglePlayback={props.onTogglePlayback}
                    />
                    {props.selectedMedia?.type === 'image' && (
                        <button
                            onClick={() => setIsImageEditorOpen(true)}
                            className="absolute top-4 right-4 bg-gray-800/80 hover:bg-indigo-600 text-white p-2 rounded-lg backdrop-blur-md shadow-lg border border-gray-600 transition-colors z-30"
                            title="Open Image Editor"
                        >
                            <BrushIcon className="w-5 h-5"/>
                        </button>
                    )}
                </div>
                <div className="h-2/5 min-h-[250px] flex-shrink-0 flex flex-col gap-2">
                  <div className="flex items-center justify-between bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-[10px] text-gray-400">
                    <span>Drag media onto the timeline. Use the playhead to scrub.</span>
                    <span>Snapping: {props.isSnappingEnabled ? 'On' : 'Off'}</span>
                  </div>
                  <div className="flex-1 min-h-0">
                    <Timeline
                      tracks={timelineTracks}
                      clips={timelineClips}
                      mediaItems={mediaItems}
                      selectedClipId={selectedClipId}
                      onSelectClip={props.onSelectClip}
                      onUpdateClip={onUpdateClip}
                      playheadPosition={props.playheadPosition}
                      isSnappingEnabled={props.isSnappingEnabled}
                      onPlayheadUpdate={props.onPlayheadUpdate}
                      onSnappingToggle={props.onSnappingToggle}
                      onSplitClip={props.onSplitClip}
                      onAddTrack={props.onAddTrack}
                      onUpdateTrack={props.onUpdateTrack}
                      onDropMedia={props.onDropMedia}
                      waveformCache={waveformCache}
                    />
                  </div>
                </div>
            </div>

            {!collapsedPanels.right && <DraggableDivider onDrag={handleDrag(1)} />}
             <div className="relative">
                 <button
                    onClick={() => togglePanel('right')}
                    className="absolute top-1/2 -translate-y-1/2 -right-2.5 z-20 w-5 h-10 bg-indigo-600 hover:bg-indigo-500 rounded-l-md flex items-center justify-center"
                    title={collapsedPanels.right ? "Expand" : "Collapse"}
                >
                    {collapsedPanels.right ? <ChevronLeftIcon className="w-4 h-4 text-white"/> : <ChevronRightIcon className="w-4 h-4 text-white"/>}
                </button>
            </div>
            {!collapsedPanels.right && (
                <div style={{ flexBasis: `${panelWidths[2]}%` }} className="min-w-0 h-full transition-all duration-300">
                    <InspectorPanel {...props} />
                </div>
            )}

            <ImageEditorModal
                isOpen={isImageEditorOpen}
                mediaItem={props.selectedMedia}
                onClose={() => setIsImageEditorOpen(false)}
                onSave={handleImageEditorSave}
            />
        </div>
    );
};

export default EditWorkspace;
