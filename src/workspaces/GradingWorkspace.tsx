/**
 * POST workspace (bottom bar "Color"): the grading page plus the audio
 * analyzer. The grading page lives in ./color-pro (node based, GPU graded,
 * gallery, scopes); this file keeps the props contract with App.tsx.
 */
import React, { useState, useRef } from 'react';
import { TimelineClip, MediaItem, StoryBible, AudioCue } from '../types';
import { ColorIcon, AudioIcon, MagicWandIcon, UploadIcon, ClipboardCheckIcon, BrainIcon } from '../components/icons';
import { analyzeAudioRequirements } from '../services/geminiService';
import { extractFrameFromVideo } from '../utils/helpers';
import { type SharedSequenceProps } from '../components/EditorPageShell';
import ColorPage from './color-pro/ColorPage';
import '../mcp/modules/colorTools';

interface PostWorkspaceProps extends SharedSequenceProps {
    selectedClip: TimelineClip | null;
    selectedMedia: MediaItem | null;
    onUpdateFilters: (clipId: string, filters: TimelineClip['filters']) => void;
    storyBible?: StoryBible;
    onSwitchToEdit?: () => void;
}


// ---------------------------------------------------------------------------
// Audio analyzer (unchanged behaviour, lighter chrome)
// ---------------------------------------------------------------------------

const AudioAnalyzerPanel: React.FC<Pick<PostWorkspaceProps, 'timelineClips' | 'mediaItems' | 'storyBible'>> = ({ timelineClips, mediaItems, storyBible }) => {
    const [mode, setMode] = useState<'timeline' | 'upload'>('timeline');
    const [cues, setCues] = useState<AudioCue[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleAnalyze = async () => {
        setIsLoading(true);
        setCues([]);
        try {
            let timelineDescription = '';
            const videoFrames: { base64: string; mimeType: string }[] = [];
            if (mode === 'timeline') {
                if (timelineClips.length === 0) throw new Error('Timeline is empty.');
                timelineDescription = timelineClips
                    .slice()
                    .sort((a, b) => a.start - b.start)
                    .map((clip, i) => {
                        const media = mediaItems.find((m) => m.id === clip.mediaId);
                        return `[${i + 1}] Time: ${clip.start.toFixed(1)}s - ${clip.end.toFixed(1)}s | Type: ${media?.type} | Content: ${media?.name}`;
                    }).join('\n');
                const visualClips = timelineClips.filter((c) => {
                    const m = mediaItems.find((mi) => mi.id === c.mediaId);
                    return m?.type === 'image' || m?.type === 'video';
                }).slice(0, 3);
                for (const clip of visualClips) {
                    const media = mediaItems.find((m) => m.id === clip.mediaId);
                    if (media?.url) {
                        try {
                            const frameDataUrl = await extractFrameFromVideo(media.url, 0);
                            videoFrames.push({ base64: frameDataUrl.split(',')[1], mimeType: 'image/jpeg' });
                        } catch (e) { console.error('Could not extract frame', e); }
                    }
                }
            } else {
                if (!uploadedFile) throw new Error('Please upload a video file first.');
                timelineDescription = `External Video File: ${uploadedFile.name}`;
            }
            const results = await analyzeAudioRequirements(storyBible?.script || 'No script provided.', timelineDescription, videoFrames);
            setCues(results);
        } catch (e) {
            alert((e as Error).message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="color-page__audio">
            <div className="color-panel">
                <div className="color-panel__head">
                    <BrainIcon className="w-4 h-4" />
                    <span>Smart audio analyzer</span>
                </div>
                <div className="toolbar-segmented mb-3">
                    <button type="button" className={`toolbar-segmented__item ${mode === 'timeline' ? 'toolbar-segmented__item--active' : ''}`} onClick={() => setMode('timeline')}>Timeline</button>
                    <button type="button" className={`toolbar-segmented__item ${mode === 'upload' ? 'toolbar-segmented__item--active' : ''}`} onClick={() => setMode('upload')}>Upload</button>
                </div>
                {mode === 'upload' && (
                    <button type="button" className="color-dropzone" onClick={() => fileInputRef.current?.click()}>
                        <input type="file" ref={fileInputRef} className="hidden" accept="video/*" onChange={(e) => setUploadedFile(e.target.files?.[0] || null)} />
                        {uploadedFile ? <span>{uploadedFile.name}</span> : <><UploadIcon className="w-5 h-5" /><span>Click to upload an edit</span></>}
                    </button>
                )}
                <button type="button" onClick={handleAnalyze} disabled={isLoading} className="app-button app-primary w-full justify-center text-xs">
                    <MagicWandIcon className="w-4 h-4" />
                    {isLoading ? 'Analyzing…' : 'Generate audio cues'}
                </button>
                <div className="color-panel__scroll">
                    {cues.length === 0 && !isLoading && (
                        <p className="app-muted text-xs">Suggests Suno music prompts, ElevenLabs voice-over scripts, and sound-effect placement with timecodes.</p>
                    )}
                    {cues.map((cue, idx) => (
                        <div key={idx} className="color-cue">
                            <div className="color-cue__head">
                                <span className="color-cue__time">{cue.timecode}</span>
                                <span className={`status-chip ${cue.type === 'music' ? 'status-chip--accent' : cue.type === 'voiceover' ? 'status-chip--success' : 'status-chip--warm'}`}>{cue.type}</span>
                            </div>
                            <div className="color-cue__title">{cue.title}</div>
                            <p className="color-cue__reason">{cue.reasoning}</p>
                            <div className="color-cue__prompt">
                                <button type="button" className="toolbar-button toolbar-button--text" onClick={() => { void navigator.clipboard.writeText(cue.prompt); }} title="Copy prompt"><ClipboardCheckIcon className="w-3.5 h-3.5" /> Copy</button>
                                <p>{cue.prompt}</p>
                                {cue.type === 'voiceover' && cue.voiceSettings && <p className="color-cue__voice">{cue.voiceSettings}</p>}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const PostWorkspace: React.FC<PostWorkspaceProps> = (props) => {
    const [activeTab, setActiveTab] = useState<'color' | 'audio'>('color');

    const pageTabs = (
        <div className="cp-seg" role="tablist" aria-label="Color-Seite">
            <button type="button" role="tab" aria-selected={activeTab === 'color'} onClick={() => setActiveTab('color')} className={`cp-btn ${activeTab === 'color' ? 'cp-btn--on' : ''}`} data-automation-id="color.tab.color">
                <ColorIcon className="w-4 h-4" /> Farbe
            </button>
            <button type="button" role="tab" aria-selected={activeTab === 'audio'} onClick={() => setActiveTab('audio')} className={`cp-btn ${activeTab === 'audio' ? 'cp-btn--on' : ''}`} data-automation-id="color.tab.audio">
                <AudioIcon className="w-4 h-4" /> Audio
            </button>
        </div>
    );

    return (
        <ColorPage
            {...props}
            pageTabs={pageTabs}
            altContent={activeTab === 'audio' ? <AudioAnalyzerPanel {...props} /> : undefined}
        />
    );
};

export default PostWorkspace;
