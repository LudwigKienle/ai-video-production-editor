import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MediaItem, TimelineClip, TimelineTrack, WaveformCache } from '../types';
import type { LibraryAsset } from '../hooks/useLibraryAssets';
import PreviewPlayer from './PreviewPlayer';
import Timeline from './Timeline';
import EditTransportBar from './EditTransportBar';
import { ChevronLeftIcon, ChevronRightIcon, EditIcon, MaximizeIcon } from './icons';
import { DEFAULT_TIMELINE_FPS, formatTimecode } from '../utils/timecode';

export type TrimMode = 'normal' | 'ripple' | 'roll' | 'slip' | 'slide';

/**
 * Everything a page needs to show and edit the one shared sequence.
 * Edit, Trim, Color and Fusion all receive the same object from App so the
 * timeline, playhead and selection stay in sync between pages.
 */
export interface SharedSequenceProps {
    mediaItems: MediaItem[];
    timelineClips: TimelineClip[];
    timelineTracks: TimelineTrack[];
    activeTrackId: string | null;
    selectedClipId: string | null;
    playheadPosition: number;
    isPlaying: boolean;
    isSnappingEnabled: boolean;
    waveformCache: WaveformCache;
    trimMode: TrimMode;
    onSelectClip: (clipId: string | null) => void;
    onUpdateClip: (clip: TimelineClip) => void;
    onBatchUpdateClips: (clips: TimelineClip[]) => void;
    onTrimModeChange: (mode: TrimMode) => void;
    onPlayheadUpdate: (position: number) => void;
    onTogglePlayback: () => void;
    onSnappingToggle: () => void;
    onSplitClip: (clipId: string, splitAt: number) => void;
    onAddTrack: (type: 'video' | 'audio') => void;
    onUpdateTrack: (trackId: string, updates: Partial<Omit<TimelineTrack, 'id' | 'type'>>) => void;
    onSetActiveTrack: (trackId: string) => void;
    onDeleteClip?: () => void;
    onDropMedia?: (mediaId: string, trackId: string, time: number) => void;
    onDropLibraryAsset?: (asset: LibraryAsset, trackId: string, time: number) => void | Promise<void>;
    projectName?: string | null;
}

export type EditorPageId = 'trim' | 'color' | 'fusion';

interface EditorPageShellProps extends SharedSequenceProps {
    page: EditorPageId;
    /** Left part of the top bar (page tools). */
    toolbar?: React.ReactNode;
    /** Right part of the top bar. */
    toolbarEnd?: React.ReactNode;
    left?: React.ReactNode;
    right?: React.ReactNode;
    /** Replaces the program viewer with page content (Color, Fusion). */
    main?: React.ReactNode;
    /** Rendered under the program viewer (Trim editor). */
    belowViewer?: React.ReactNode;
    /** Where the transport row lives: inside the viewer panel, or as a full-width row above the clip strip. */
    transportPlacement?: 'viewer' | 'bar';
    /** Select the clip under the playhead whenever the playhead moves (Resolve colour page behaviour). */
    followPlayhead?: boolean;
    canvasWidth?: number;
    canvasHeight?: number;
    onSwitchToEdit?: () => void;
}

const sequenceDurationOf = (clips: TimelineClip[]) => clips.reduce((max, clip) => Math.max(max, clip.end), 0);

const loadBool = (key: string, fallback: boolean) => {
    if (typeof window === 'undefined') return fallback;
    try { const raw = window.localStorage.getItem(key); return raw === null ? fallback : raw === 'true'; } catch { return fallback; }
};
const loadNumber = (key: string, fallback: number, min: number, max: number) => {
    if (typeof window === 'undefined') return fallback;
    try { const raw = Number(window.localStorage.getItem(key)); return Number.isFinite(raw) && raw > 0 ? Math.max(min, Math.min(max, raw)) : fallback; } catch { return fallback; }
};

/* ─── Clip strip (film strip of visual clips in sequence order) ─── */

export const ClipStrip: React.FC<{
    clips: TimelineClip[];
    tracks: TimelineTrack[];
    mediaItems: MediaItem[];
    selectedClipId: string | null;
    playheadPosition: number;
    onSelect: (clip: TimelineClip) => void;
}> = ({ clips, tracks, mediaItems, selectedClipId, playheadPosition, onSelect }) => {
    const ordered = useMemo(() => {
        const trackOrder = new Map(tracks.map((track, index) => [track.id, index]));
        return clips
            .filter((clip) => { const media = mediaItems.find((item) => item.id === clip.mediaId); return media && media.type !== 'audio'; })
            .sort((a, b) => (a.start === b.start ? (trackOrder.get(a.trackId) ?? 0) - (trackOrder.get(b.trackId) ?? 0) : a.start - b.start));
    }, [clips, tracks, mediaItems]);
    const activeRef = useRef<HTMLButtonElement | null>(null);
    useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [selectedClipId]);

    if (ordered.length === 0) {
        return <div className="clipstrip clipstrip--empty">No clips on the timeline yet. Add media in the Edit page.</div>;
    }
    return (
        <div className="clipstrip" role="listbox" aria-label="Sequence clips">
            {ordered.map((clip, index) => {
                const media = mediaItems.find((item) => item.id === clip.mediaId);
                const active = clip.id === selectedClipId;
                const current = playheadPosition >= clip.start && playheadPosition < clip.end;
                return (
                    <button
                        key={clip.id}
                        ref={active ? activeRef : undefined}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={`clipstrip__item ${active ? 'clipstrip__item--active' : ''} ${current ? 'clipstrip__item--current' : ''}`}
                        onClick={() => onSelect(clip)}
                        title={`${media?.name || 'Clip'} · ${formatTimecode(clip.start)} → ${formatTimecode(clip.end)}`}
                    >
                        <span className="clipstrip__thumb">
                            {media?.type === 'image' && <img src={media.url} alt="" draggable={false} />}
                            {media?.type === 'video' && <video src={media.url} muted preload="metadata" />}
                            {clip.textConfig && <span className="clipstrip__title">T</span>}
                        </span>
                        <span className="clipstrip__index">{index + 1}</span>
                        <span className="clipstrip__name">{clip.textConfig?.content || media?.name || 'Clip'}</span>
                        <span className="clipstrip__time">{formatTimecode(clip.end - clip.start).slice(3)}</span>
                    </button>
                );
            })}
        </div>
    );
};

/* ─── Shell ─── */

const EditorPageShell: React.FC<EditorPageShellProps> = (props) => {
    const {
        page, toolbar, toolbarEnd, left, right, main, belowViewer,
        transportPlacement = 'viewer', followPlayhead = false,
        canvasWidth = 1280, canvasHeight = 720, onSwitchToEdit,
        mediaItems, timelineClips, timelineTracks, selectedClipId, playheadPosition, isPlaying,
        onSelectClip, onPlayheadUpdate, onTogglePlayback,
    } = props;

    const timelineOpenKey = `page_shell_timeline_open_${page}`;
    const timelineHeightKey = `page_shell_timeline_height_${page}`;
    const [timelineOpen, setTimelineOpen] = useState(() => loadBool(timelineOpenKey, page === 'trim'));
    const [timelineHeight, setTimelineHeight] = useState(() => loadNumber(timelineHeightKey, page === 'trim' ? 300 : 240, 160, 640));
    const [dragging, setDragging] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const sequenceDuration = sequenceDurationOf(timelineClips);
    const clampPlayhead = useCallback((value: number) => Math.max(0, Math.min(Math.max(sequenceDuration, 0), value)), [sequenceDuration]);

    useEffect(() => { try { window.localStorage.setItem(timelineOpenKey, String(timelineOpen)); } catch { /* ignore */ } }, [timelineOpen, timelineOpenKey]);
    useEffect(() => { try { window.localStorage.setItem(timelineHeightKey, String(timelineHeight)); } catch { /* ignore */ } }, [timelineHeight, timelineHeightKey]);

    // Follow the playhead: select the top-most visual clip under it.
    const latest = useRef({ timelineClips, timelineTracks, mediaItems, selectedClipId, onSelectClip });
    latest.current = { timelineClips, timelineTracks, mediaItems, selectedClipId, onSelectClip };
    useEffect(() => {
        if (!followPlayhead) return;
        const { timelineClips: clips, timelineTracks: tracks, mediaItems: media, selectedClipId: selected, onSelectClip: select } = latest.current;
        const trackOrder = new Map(tracks.map((track, index) => [track.id, index]));
        const under = clips
            .filter((clip) => playheadPosition >= clip.start && playheadPosition < clip.end)
            .filter((clip) => { const item = media.find((entry) => entry.id === clip.mediaId); return item && item.type !== 'audio'; })
            .sort((a, b) => (trackOrder.get(b.trackId) ?? 0) - (trackOrder.get(a.trackId) ?? 0))[0];
        if (under && under.id !== selected) select(under.id);
    }, [followPlayhead, playheadPosition]);

    // Keyboard: frame stepping and home/end (space, J/K/L and C are handled by the app).
    const playheadRef = useRef({ position: playheadPosition, update: onPlayheadUpdate, duration: sequenceDuration });
    playheadRef.current = { position: playheadPosition, update: onPlayheadUpdate, duration: sequenceDuration };
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            const tag = (event.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (event.target as HTMLElement)?.isContentEditable) return;
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const { position, update, duration } = playheadRef.current;
            const frame = 1 / DEFAULT_TIMELINE_FPS;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                const delta = (event.shiftKey ? 1 : frame) * (event.key === 'ArrowLeft' ? -1 : 1);
                update(Math.max(0, Math.min(duration, position + delta)));
            } else if (event.key === 'Home') { event.preventDefault(); update(0); }
            else if (event.key === 'End') { event.preventDefault(); update(duration); }
            else if (event.key === 'F11') { event.preventDefault(); setFullscreen((prev) => !prev); }
            else if (event.key === 'Escape' && fullscreen) { setFullscreen(false); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [fullscreen]);

    const selectFromStrip = (clip: TimelineClip) => {
        onSelectClip(clip.id);
        if (playheadPosition < clip.start || playheadPosition >= clip.end) onPlayheadUpdate(clip.start + 1 / DEFAULT_TIMELINE_FPS);
    };

    const handleDividerDown = (event: React.MouseEvent) => {
        event.preventDefault();
        const startY = event.clientY;
        const startHeight = timelineHeight;
        setDragging(true);
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        const move = (ev: MouseEvent) => setTimelineHeight(Math.max(160, Math.min(640, startHeight - (ev.clientY - startY))));
        const up = () => { setDragging(false); document.body.style.cursor = ''; document.body.style.userSelect = ''; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    const transport = (
        <EditTransportBar
            isPlaying={isPlaying}
            position={playheadPosition}
            duration={sequenceDuration}
            disabled={timelineClips.length === 0}
            onTogglePlayback={onTogglePlayback}
            onSeek={(time) => onPlayheadUpdate(clampPlayhead(time))}
            onStepFrame={(direction) => onPlayheadUpdate(clampPlayhead(playheadPosition + direction / DEFAULT_TIMELINE_FPS))}
            showScrubber={transportPlacement === 'viewer'}
            trailing={transportPlacement === 'bar' ? (
                <button type="button" className="edit-icon-btn" onClick={() => setFullscreen(true)} title="Fullscreen program monitor (F11)"><MaximizeIcon className="w-4 h-4" /></button>
            ) : undefined}
        />
    );

    const viewer = (
        <div className="edit-monitor-panel page-shell__viewer">
            <div className="edit-monitor-panel__bar">
                <div className="edit-monitor-panel__title">
                    <span>Program</span>
                    <small>{props.projectName || 'Untitled sequence'}</small>
                </div>
                <div className="flex items-center gap-1">
                    <span className="edit-toolbar__hint hidden md:inline">{canvasWidth} × {canvasHeight}</span>
                    <button type="button" className="edit-icon-btn" onClick={() => setFullscreen(true)} title="Fullscreen (F11)"><MaximizeIcon className="w-4 h-4" /></button>
                </div>
            </div>
            <div className="edit-monitor-panel__stage" onDoubleClick={() => setFullscreen(true)}>
                <PreviewPlayer
                    timelineClips={timelineClips} timelineTracks={timelineTracks} mediaItems={mediaItems}
                    playheadPosition={playheadPosition} isPlaying={isPlaying} onTogglePlayback={onTogglePlayback}
                    canvasWidth={canvasWidth} canvasHeight={canvasHeight} aspectStyle={{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }} showControls={false}
                />
                {timelineClips.length === 0 && (
                    <div className="edit-monitor-empty">
                        <strong>Nothing on the timeline yet</strong>
                        <span>Build the sequence in the Edit page. Every page shares the same timeline, playhead and selection.</span>
                    </div>
                )}
            </div>
            {transportPlacement === 'viewer' && transport}
        </div>
    );

    return (
        <div className={`studio-workspace edit-workspace page-shell page-shell--${page}`}>
            <div className="edit-toolbar page-shell__bar">
                {toolbar}
                <div className="edit-toolbar__spacer" />
                {toolbarEnd}
                {onSwitchToEdit && (
                    <button type="button" className="edit-text-btn" onClick={onSwitchToEdit} title="Open the full Edit page (3)"><EditIcon className="w-3.5 h-3.5" />Edit page</button>
                )}
                <button type="button" className={`edit-text-btn ${timelineOpen ? 'edit-text-btn--outline' : ''}`} onClick={() => setTimelineOpen((prev) => !prev)} title="Show or hide the shared timeline">
                    {timelineOpen ? <ChevronRightIcon className="w-3.5 h-3.5 rotate-90" /> : <ChevronLeftIcon className="w-3.5 h-3.5 rotate-90" />}
                    Timeline
                </button>
            </div>

            <div className={`page-shell__body ${left ? 'page-shell__body--left' : ''} ${right ? 'page-shell__body--right' : ''}`}>
                {left && <aside className="page-shell__side">{left}</aside>}
                <div className="page-shell__center">
                    {main ?? viewer}
                    {belowViewer}
                </div>
                {right && <aside className="page-shell__side page-shell__side--right">{right}</aside>}
            </div>

            {transportPlacement === 'bar' && <div className="page-shell__transport">{transport}</div>}

            <div className="page-shell__strip">
                <ClipStrip clips={timelineClips} tracks={timelineTracks} mediaItems={mediaItems} selectedClipId={selectedClipId} playheadPosition={playheadPosition} onSelect={selectFromStrip} />
            </div>

            {timelineOpen && (
                <>
                    <div className={`edit-divider-h ${dragging ? 'edit-divider-h--active' : ''}`} onMouseDown={handleDividerDown} title="Drag to resize">
                        <div className="edit-divider-h__grip" />
                    </div>
                    <div className="edit-timeline-surface page-shell__timeline" style={{ height: timelineHeight }}>
                        <Timeline
                            tracks={timelineTracks} clips={timelineClips} mediaItems={mediaItems} selectedClipId={selectedClipId}
                            activeTrackId={props.activeTrackId} playheadPosition={playheadPosition}
                            isSnappingEnabled={props.isSnappingEnabled} trimMode={props.trimMode} onTrimModeChange={props.onTrimModeChange}
                            waveformCache={props.waveformCache}
                            onSelectClip={onSelectClip} onSetActiveTrack={props.onSetActiveTrack}
                            onUpdateClip={props.onUpdateClip} onBatchUpdateClips={props.onBatchUpdateClips}
                            onPlayheadUpdate={onPlayheadUpdate} onSnappingToggle={props.onSnappingToggle} onSplitClip={props.onSplitClip}
                            onAddTrack={props.onAddTrack} onUpdateTrack={props.onUpdateTrack}
                            onDropMedia={props.onDropMedia} onDropLibraryAsset={props.onDropLibraryAsset}
                        />
                    </div>
                </>
            )}

            {fullscreen && (
                <div className="fixed inset-0 z-[9998] bg-black flex flex-col" onDoubleClick={() => setFullscreen(false)}>
                    <div className="flex-1 min-h-0 flex items-center justify-center" onClick={(event) => event.stopPropagation()}>
                        <PreviewPlayer
                            timelineClips={timelineClips} timelineTracks={timelineTracks} mediaItems={mediaItems}
                            playheadPosition={playheadPosition} isPlaying={isPlaying} onTogglePlayback={onTogglePlayback}
                            canvasWidth={canvasWidth} canvasHeight={canvasHeight} showControls={true}
                        />
                    </div>
                    <div className="flex-shrink-0 flex items-center justify-center gap-1 py-2 text-xs" style={{ color: 'rgb(255 255 255 / 0.55)' }}>
                        Double-click or press <kbd className="edit-kbd">Esc</kbd> to exit fullscreen
                    </div>
                </div>
            )}
        </div>
    );
};

export default EditorPageShell;
