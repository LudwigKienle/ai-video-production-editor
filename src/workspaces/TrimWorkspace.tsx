import React, { useMemo, useRef, useState } from 'react';
import type { MediaItem, TimelineClip } from '../types';
import EditorPageShell, { type SharedSequenceProps, type TrimMode } from '../components/EditorPageShell';
import { ScissorsIcon, TrashIcon, MarkInIcon, MarkOutIcon, SkipBackIcon, SkipForwardIcon } from '../components/icons';
import { DEFAULT_TIMELINE_FPS, formatTimecode } from '../utils/timecode';

interface TrimWorkspaceProps extends SharedSequenceProps {
    onSwitchToEdit?: () => void;
}

const MIN_CLIP_SECONDS = 0.5;
const EPSILON = 1e-4;
const FRAME = 1 / DEFAULT_TIMELINE_FPS;

const TRIM_MODES: Array<{ mode: TrimMode; label: string; key: string; hint: string }> = [
    { mode: 'normal', label: 'Trim', key: 'V', hint: 'Change a clip edge; neighbours stay where they are' },
    { mode: 'ripple', label: 'Ripple', key: 'R', hint: 'Change a clip edge and shift everything after it' },
    { mode: 'roll', label: 'Roll', key: 'O', hint: 'Move the cut between two clips on the timeline' },
    { mode: 'slip', label: 'Slip', key: 'Y', hint: 'Change which frames play without moving the clip' },
    { mode: 'slide', label: 'Slide', key: 'U', hint: 'Move a clip while trimming its neighbours' },
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

type ClipRange = { sourceIn: number; sourceOut: number; speed: number; mediaDuration: number };

const rangeOf = (clip: TimelineClip, media: MediaItem | null): ClipRange => {
    const speed = Math.max(0.05, clip.speed || 1);
    const sourceIn = Math.max(0, clip.sourceIn ?? 0);
    const fallbackOut = sourceIn + Math.max(MIN_CLIP_SECONDS * speed, (clip.end - clip.start) * speed);
    const sourceOut = clip.sourceOut ?? fallbackOut;
    const mediaDuration = Math.max(sourceOut, media?.duration || sourceOut || clip.duration || 5);
    return { sourceIn, sourceOut, speed, mediaDuration };
};

/* ─── Range editor: a bar over the whole media with draggable in/out handles ─── */

const RangeEditor: React.FC<{
    media: MediaItem | null;
    range: ClipRange;
    sourcePlayhead: number | null;
    onChange: (next: { sourceIn: number; sourceOut: number }, edge: 'in' | 'out' | 'both') => void;
}> = ({ media, range, sourcePlayhead, onChange }) => {
    const barRef = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<{ edge: 'in' | 'out' | 'both'; startX: number; startIn: number; startOut: number } | null>(null);
    const { sourceIn, sourceOut, mediaDuration, speed } = range;
    const pct = (value: number) => `${clamp((value / mediaDuration) * 100, 0, 100)}%`;
    const minLength = MIN_CLIP_SECONDS * speed;

    const beginDrag = (edge: 'in' | 'out' | 'both') => (event: React.PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        setDrag({ edge, startX: event.clientX, startIn: sourceIn, startOut: sourceOut });
    };
    const moveDrag = (event: React.PointerEvent) => {
        if (!drag || !barRef.current) return;
        const width = barRef.current.getBoundingClientRect().width || 1;
        const deltaTime = ((event.clientX - drag.startX) / width) * mediaDuration;
        if (drag.edge === 'in') {
            onChange({ sourceIn: clamp(drag.startIn + deltaTime, 0, drag.startOut - minLength), sourceOut: drag.startOut }, 'in');
        } else if (drag.edge === 'out') {
            onChange({ sourceIn: drag.startIn, sourceOut: clamp(drag.startOut + deltaTime, drag.startIn + minLength, mediaDuration) }, 'out');
        } else {
            const length = drag.startOut - drag.startIn;
            const nextIn = clamp(drag.startIn + deltaTime, 0, mediaDuration - length);
            onChange({ sourceIn: nextIn, sourceOut: nextIn + length }, 'both');
        }
    };
    const endDrag = () => setDrag(null);

    return (
        <div className="trim-range">
            <div className="trim-range__scale">
                <span>{formatTimecode(0)}</span>
                <span>{formatTimecode(mediaDuration)}</span>
            </div>
            <div ref={barRef} className={`trim-range__bar ${drag ? 'trim-range__bar--dragging' : ''}`} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                {media?.type === 'image' && <img src={media.url} alt="" className="trim-range__media" draggable={false} />}
                {media?.type === 'video' && <video src={media.url} muted preload="metadata" className="trim-range__media" />}
                <div className="trim-range__mask" style={{ left: 0, width: pct(sourceIn) }} />
                <div className="trim-range__mask" style={{ left: pct(sourceOut), right: 0 }} />
                <div className="trim-range__window" style={{ left: pct(sourceIn), width: pct(sourceOut - sourceIn) }} onPointerDown={beginDrag('both')} title="Drag to slip the range">
                    <span className="trim-range__label">{formatTimecode((sourceOut - sourceIn) / speed)}</span>
                </div>
                <div className="trim-range__handle trim-range__handle--in" style={{ left: pct(sourceIn) }} onPointerDown={beginDrag('in')} title="Drag the in point"><MarkInIcon className="w-3.5 h-3.5" /></div>
                <div className="trim-range__handle trim-range__handle--out" style={{ left: pct(sourceOut) }} onPointerDown={beginDrag('out')} title="Drag the out point"><MarkOutIcon className="w-3.5 h-3.5" /></div>
                {sourcePlayhead !== null && <div className="trim-range__playhead" style={{ left: pct(sourcePlayhead) }} />}
            </div>
        </div>
    );
};

/* ─── Workspace ─── */

const TrimWorkspace: React.FC<TrimWorkspaceProps> = (props) => {
    const { mediaItems, timelineClips, timelineTracks, selectedClipId, playheadPosition, trimMode, onTrimModeChange, onSelectClip, onPlayheadUpdate, onUpdateClip, onBatchUpdateClips, onSplitClip, onDeleteClip } = props;

    const selectedClip = timelineClips.find((clip) => clip.id === selectedClipId) || null;
    const selectedMedia = selectedClip ? mediaItems.find((item) => item.id === selectedClip.mediaId) || null : null;
    const range = selectedClip ? rangeOf(selectedClip, selectedMedia) : null;
    const ripple = trimMode === 'ripple';

    const orderedClips = useMemo(() => {
        const trackOrder = new Map(timelineTracks.map((track, index) => [track.id, index]));
        return [...timelineClips].sort((a, b) => (a.start === b.start ? (trackOrder.get(a.trackId) ?? 0) - (trackOrder.get(b.trackId) ?? 0) : a.start - b.start));
    }, [timelineClips, timelineTracks]);

    const playheadInClip = Boolean(selectedClip && playheadPosition >= selectedClip.start - EPSILON && playheadPosition <= selectedClip.end + EPSILON);
    const sourcePlayhead = selectedClip && range && playheadInClip
        ? clamp(range.sourceIn + (playheadPosition - selectedClip.start) * range.speed, 0, range.mediaDuration)
        : null;

    const neighbours = (clip: TimelineClip) => {
        const sameTrack = timelineClips.filter((entry) => entry.trackId === clip.trackId && entry.id !== clip.id).sort((a, b) => a.start - b.start);
        const previous = [...sameTrack].reverse().find((entry) => entry.end <= clip.start + EPSILON) || null;
        const next = sameTrack.find((entry) => entry.start >= clip.end - EPSILON) || null;
        return { previous, next };
    };

    /** Applies a new source range to the selected clip, honouring the trim mode. */
    const applyRange = (next: { sourceIn: number; sourceOut: number }, edge: 'in' | 'out' | 'both') => {
        if (!selectedClip || !range) return;
        const { speed } = range;
        const length = Math.max(MIN_CLIP_SECONDS, (next.sourceOut - next.sourceIn) / speed);
        const { previous, next: following } = neighbours(selectedClip);
        let start = selectedClip.start;
        let end = selectedClip.end;
        let sourceIn = next.sourceIn;
        let sourceOut = next.sourceOut;

        if (edge === 'both') {
            // Slip: timeline stays, only the frames change.
        } else if (ripple) {
            end = start + length;
        } else if (edge === 'in') {
            const minStart = previous ? previous.end : 0;
            start = Math.max(minStart, end - length);
            sourceIn = sourceOut - (end - start) * speed;
        } else {
            const maxEnd = following ? following.start : Number.POSITIVE_INFINITY;
            end = Math.min(maxEnd, start + length);
            sourceOut = sourceIn + (end - start) * speed;
        }

        const updated: TimelineClip = { ...selectedClip, start, end, sourceIn, sourceOut, duration: Math.max(MIN_CLIP_SECONDS * speed, sourceOut - sourceIn) };
        const delta = end - selectedClip.end;
        if (ripple && Math.abs(delta) > EPSILON) {
            const shifted = timelineClips.map((clip) => {
                if (clip.id === selectedClip.id) return updated;
                if (clip.trackId !== selectedClip.trackId || clip.start < selectedClip.end - EPSILON) return clip;
                return { ...clip, start: clip.start + delta, end: clip.end + delta };
            });
            onBatchUpdateClips(shifted);
        } else {
            onUpdateClip(updated);
        }
    };

    const setInFromPlayhead = () => { if (range && sourcePlayhead !== null) applyRange({ sourceIn: Math.min(sourcePlayhead, range.sourceOut - MIN_CLIP_SECONDS * range.speed), sourceOut: range.sourceOut }, 'in'); };
    const setOutFromPlayhead = () => { if (range && sourcePlayhead !== null) applyRange({ sourceIn: range.sourceIn, sourceOut: Math.max(sourcePlayhead, range.sourceIn + MIN_CLIP_SECONDS * range.speed) }, 'out'); };
    const resetRange = () => { if (range) applyRange({ sourceIn: 0, sourceOut: range.mediaDuration }, 'out'); };
    const nudge = (edge: 'in' | 'out', frames: number) => {
        if (!range) return;
        const delta = frames * FRAME * range.speed;
        if (edge === 'in') applyRange({ sourceIn: clamp(range.sourceIn + delta, 0, range.sourceOut - MIN_CLIP_SECONDS * range.speed), sourceOut: range.sourceOut }, 'in');
        else applyRange({ sourceIn: range.sourceIn, sourceOut: clamp(range.sourceOut + delta, range.sourceIn + MIN_CLIP_SECONDS * range.speed, range.mediaDuration) }, 'out');
    };
    const setSpeed = (speed: number) => {
        if (!selectedClip || !range) return;
        const safe = clamp(speed, 0.25, 4);
        const length = (range.sourceOut - range.sourceIn) / safe;
        const updated: TimelineClip = { ...selectedClip, speed: safe, end: selectedClip.start + length };
        const delta = updated.end - selectedClip.end;
        if (ripple && Math.abs(delta) > EPSILON) {
            onBatchUpdateClips(timelineClips.map((clip) => {
                if (clip.id === selectedClip.id) return updated;
                if (clip.trackId !== selectedClip.trackId || clip.start < selectedClip.end - EPSILON) return clip;
                return { ...clip, start: clip.start + delta, end: clip.end + delta };
            }));
        } else {
            const { next: following } = neighbours(selectedClip);
            if (following && updated.end > following.start + EPSILON) updated.end = following.start;
            onUpdateClip(updated);
        }
    };
    const jumpTo = (clip: TimelineClip, where: 'start' | 'end') => onPlayheadUpdate(where === 'start' ? clip.start + FRAME : Math.max(clip.start, clip.end - FRAME));
    const selectClip = (clip: TimelineClip) => { onSelectClip(clip.id); if (playheadPosition < clip.start || playheadPosition >= clip.end) jumpTo(clip, 'start'); };

    const toolbar = (
        <>
            <div className="edit-seg" role="tablist" aria-label="Trim mode">
                {TRIM_MODES.map((entry) => (
                    <button key={entry.mode} type="button" role="tab" aria-selected={trimMode === entry.mode} className={`edit-seg__item ${trimMode === entry.mode ? 'edit-seg__item--active' : ''}`} onClick={() => onTrimModeChange(entry.mode)} title={`${entry.hint} (${entry.key})`}>
                        {entry.label}<kbd className="edit-seg__key">{entry.key}</kbd>
                    </button>
                ))}
            </div>
            <span className="edit-toolbar__hint">{ripple ? 'Later clips follow every trim' : 'Neighbours stay in place'}</span>
        </>
    );

    const left = (
        <div className="trim-list">
            <div className="trim-list__head"><span>Clips</span><small>{orderedClips.length}</small></div>
            <div className="trim-list__rows">
                {orderedClips.length === 0 && <p className="edit-empty-note">Nothing to trim yet. Add clips in the Edit page.</p>}
                {orderedClips.map((clip, index) => {
                    const media = mediaItems.find((item) => item.id === clip.mediaId);
                    const track = timelineTracks.find((entry) => entry.id === clip.trackId);
                    const active = clip.id === selectedClipId;
                    return (
                        <button key={clip.id} type="button" className={`trim-row ${active ? 'trim-row--active' : ''}`} onClick={() => selectClip(clip)}>
                            <span className="trim-row__index">{index + 1}</span>
                            <span className="trim-row__text">
                                <span className="trim-row__name">{clip.textConfig?.content || media?.name || 'Clip'}</span>
                                <span className="trim-row__meta">{track?.type === 'audio' ? 'A' : 'V'} · {formatTimecode(clip.start)} → {formatTimecode(clip.end)}</span>
                            </span>
                            <span className="trim-row__dur">{formatTimecode(clip.end - clip.start).slice(3)}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );

    const belowViewer = selectedClip && range ? (
        <div className="trim-editor">
            <div className="trim-editor__head">
                <div className="trim-editor__title">
                    <strong>{selectedClip.textConfig?.content || selectedMedia?.name || 'Clip'}</strong>
                    <small>{selectedMedia?.type || 'clip'} · source {formatTimecode(range.mediaDuration)} · speed {range.speed.toFixed(2)}×</small>
                </div>
                <div className="trim-editor__actions">
                    <button type="button" className="edit-text-btn" onClick={() => jumpTo(selectedClip, 'start')} title="Go to clip start"><SkipBackIcon className="w-3.5 h-3.5" />Start</button>
                    <button type="button" className="edit-text-btn" onClick={() => jumpTo(selectedClip, 'end')} title="Go to clip end"><SkipForwardIcon className="w-3.5 h-3.5" />End</button>
                    <span className="edit-divider" />
                    <button type="button" className="edit-text-btn" onClick={() => onSplitClip(selectedClip.id, playheadPosition)} disabled={!playheadInClip} title="Split at playhead (C)"><ScissorsIcon className="w-3.5 h-3.5" />Split</button>
                    {onDeleteClip && <button type="button" className="edit-text-btn" onClick={onDeleteClip} title="Remove clip from the timeline (Delete)"><TrashIcon className="w-3.5 h-3.5" />Remove</button>}
                </div>
            </div>
            <RangeEditor media={selectedMedia} range={range} sourcePlayhead={sourcePlayhead} onChange={applyRange} />
            <div className="trim-editor__fields">
                <div className="trim-field">
                    <span className="trim-field__label">In</span>
                    <span className="trim-field__value edit-timecode__now">{formatTimecode(range.sourceIn)}</span>
                    <div className="trim-field__nudge">
                        <button type="button" className="edit-icon-btn" onClick={() => nudge('in', -1)} title="In point one frame earlier">−1</button>
                        <button type="button" className="edit-icon-btn" onClick={() => nudge('in', 1)} title="In point one frame later">+1</button>
                        <button type="button" className="edit-text-btn" onClick={setInFromPlayhead} disabled={sourcePlayhead === null} title="Set the in point at the playhead"><MarkInIcon className="w-3.5 h-3.5" />At playhead</button>
                    </div>
                </div>
                <div className="trim-field">
                    <span className="trim-field__label">Out</span>
                    <span className="trim-field__value edit-timecode__now">{formatTimecode(range.sourceOut)}</span>
                    <div className="trim-field__nudge">
                        <button type="button" className="edit-icon-btn" onClick={() => nudge('out', -1)} title="Out point one frame earlier">−1</button>
                        <button type="button" className="edit-icon-btn" onClick={() => nudge('out', 1)} title="Out point one frame later">+1</button>
                        <button type="button" className="edit-text-btn" onClick={setOutFromPlayhead} disabled={sourcePlayhead === null} title="Set the out point at the playhead"><MarkOutIcon className="w-3.5 h-3.5" />At playhead</button>
                    </div>
                </div>
                <div className="trim-field">
                    <span className="trim-field__label">Duration</span>
                    <span className="trim-field__value edit-timecode__now">{formatTimecode(selectedClip.end - selectedClip.start)}</span>
                    <div className="trim-field__nudge">
                        <button type="button" className="edit-text-btn" onClick={resetRange} title="Use the whole source">Use all</button>
                    </div>
                </div>
                <div className="trim-field">
                    <span className="trim-field__label">Speed</span>
                    <span className="trim-field__value edit-timecode__now">{range.speed.toFixed(2)}×</span>
                    <div className="trim-field__nudge trim-field__nudge--wide">
                        <input type="range" min={0.25} max={4} step={0.05} value={range.speed} onChange={(event) => setSpeed(Number(event.target.value))} onDoubleClick={() => setSpeed(1)} aria-label="Clip speed" />
                        <button type="button" className="edit-text-btn" onClick={() => setSpeed(1)} disabled={Math.abs(range.speed - 1) < 0.01}>1×</button>
                    </div>
                </div>
            </div>
        </div>
    ) : (
        <div className="trim-editor trim-editor--empty">
            <strong>Select a clip to trim</strong>
            <span>Pick one from the list, the film strip or the timeline. Drag the in and out handles, or set them at the playhead.</span>
        </div>
    );

    return (
        <EditorPageShell
            {...props}
            page="trim"
            toolbar={toolbar}
            left={left}
            belowViewer={belowViewer}
            onSwitchToEdit={props.onSwitchToEdit}
        />
    );
};

export default TrimWorkspace;
