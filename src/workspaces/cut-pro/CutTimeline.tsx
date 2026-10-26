/**
 * Dual timeline of the Cut page.
 *  - Upper: the whole programme, always fitted to the width (click/drag to jump).
 *  - Lower: zoomed detail with a fixed playhead in the centre; the sequence
 *    scrolls underneath (drag the background, wheel). Cuts and clips are
 *    picked here for the trim editor and trimmed by dragging.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MediaItem, TimelineClip, TimelineTrack } from '../../types';
import { formatRulerLabel, formatTimecode, pickRulerStep } from '../../utils/timecode';
import { detailViewport, findEditPoint, neighbours, overviewScale, sequenceEnd, type TrimTarget, type TrimTool } from './editOps';
import { WaveformSvg } from './CutViewer';
import { Lock } from 'lucide-react';

const HEADER_W = 54;
const RULER_H = 20;
const EDGE_PX = 9;
const ROLL_PX = 3;

type TrimDragPhase = 'start' | 'move' | 'end' | 'cancel';

export interface CutTimelineProps {
    clips: TimelineClip[];
    tracks: TimelineTrack[];
    mediaItems: MediaItem[];
    posters: Record<string, string>;
    waveforms: Record<string, number[]>;
    playhead: number;
    selectedClipId: string | null;
    activeTrackId: string | null;
    trimTarget: TrimTarget | null;
    trimTool: TrimTool;
    timelineIn: number | null;
    timelineOut: number | null;
    zoom: number;
    height: number;
    onZoom: (zoom: number) => void;
    onSeek: (time: number) => void;
    onSelectClip: (clipId: string | null) => void;
    onSetActiveTrack: (trackId: string) => void;
    onTrimTarget: (target: TrimTarget | null) => void;
    onTrimDrag: (phase: TrimDragPhase, target: TrimTarget | null, deltaSeconds: number) => void;
    onDropMedia?: (mediaId: string, trackId: string, time: number) => void;
}

const useWidth = <T extends HTMLElement>() => {
    const ref = useRef<T>(null);
    const [width, setWidth] = useState(800);
    useEffect(() => {
        const element = ref.current;
        if (!element || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver((entries) => { const next = entries[0]?.contentRect.width; if (next && next > 0) setWidth(next); });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return [ref, width] as const;
};

const displayOrder = (tracks: TimelineTrack[]) => [...tracks.filter((track) => track.type === 'video').reverse(), ...tracks.filter((track) => track.type === 'audio')];

const labelsOf = (tracks: TimelineTrack[]) => {
    const labels: Record<string, string> = {};
    let v = 0;
    let a = 0;
    tracks.forEach((track) => { labels[track.id] = track.type === 'video' ? `V${++v}` : `A${++a}`; });
    return labels;
};

/* ─── Upper overview ─── */

const Overview: React.FC<Pick<CutTimelineProps, 'clips' | 'tracks' | 'mediaItems' | 'playhead' | 'selectedClipId' | 'timelineIn' | 'timelineOut' | 'onSeek'> & { detailSpan: number }> = ({
    clips, tracks, mediaItems, playhead, selectedClipId, timelineIn, timelineOut, onSeek, detailSpan,
}) => {
    const [ref, width] = useWidth<HTMLDivElement>();
    const duration = sequenceEnd(clips);
    const { pixelsPerSecond: pps } = overviewScale(duration, width);
    const order = displayOrder(tracks);
    const rowH = Math.max(6, Math.min(12, Math.floor(52 / Math.max(1, order.length))));
    const seek = (event: React.PointerEvent) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        onSeek(Math.max(0, Math.min(Math.max(duration, 0), (event.clientX - rect.left) / pps)));
    };
    const step = pickRulerStep(pps, 70);
    const ticks: number[] = [];
    for (let t = 0; t * pps <= width && ticks.length < 400; t += step) ticks.push(t);
    return (
        <div className="cutp-ov" data-automation-id="cut-timeline-overview">
            <div className="cutp-ov__label">Gesamt</div>
            <div
                ref={ref}
                className="cutp-ov__lanes"
                style={{ height: RULER_H - 6 + order.length * (rowH + 1) + 2 }}
                onPointerDown={(event) => { (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId); seek(event); }}
                onPointerMove={(event) => { if (event.buttons & 1) seek(event); }}
            >
                <div className="cutp-ov__ruler">
                    {ticks.map((t) => <span key={t} style={{ left: t * pps }}>{formatRulerLabel(t, step)}</span>)}
                </div>
                {timelineIn !== null && timelineOut !== null && timelineOut > timelineIn && (
                    <div className="cutp-ov__range" style={{ left: timelineIn * pps, width: (timelineOut - timelineIn) * pps }} />
                )}
                {order.map((track, row) => (
                    <div key={track.id} className={`cutp-ov__row cutp-ov__row--${track.type}`} style={{ top: RULER_H - 6 + row * (rowH + 1), height: rowH }}>
                        {clips.filter((clip) => clip.trackId === track.id).map((clip) => {
                            const media = mediaItems.find((item) => item.id === clip.mediaId);
                            return (
                                <span
                                    key={clip.id}
                                    className={`cutp-ov__clip cutp-ov__clip--${media?.type || 'video'} ${clip.id === selectedClipId ? 'cutp-ov__clip--sel' : ''}`}
                                    style={{ left: clip.start * pps, width: Math.max(1, (clip.end - clip.start) * pps - 1) }}
                                />
                            );
                        })}
                    </div>
                ))}
                <div className="cutp-ov__window" style={{ left: (playhead - detailSpan / 2) * pps, width: detailSpan * pps }} />
                <div className="cutp-playhead" style={{ left: playhead * pps }} />
            </div>
        </div>
    );
};

/* ─── Lower detail ─── */

const CutTimeline: React.FC<CutTimelineProps> = (props) => {
    const {
        clips, tracks, mediaItems, posters, waveforms, playhead, selectedClipId, activeTrackId, trimTarget, trimTool,
        timelineIn, timelineOut, zoom, height, onZoom, onSeek, onSelectClip, onSetActiveTrack, onTrimTarget, onTrimDrag, onDropMedia,
    } = props;
    const [laneRef, laneWidth] = useWidth<HTMLDivElement>();
    const order = useMemo(() => displayOrder(tracks), [tracks]);
    const labels = useMemo(() => labelsOf(tracks), [tracks]);
    const view = detailViewport(playhead, zoom, laneWidth);
    const duration = sequenceEnd(clips);
    const overviewH = 70;
    const lanesH = Math.max(60, height - overviewH - RULER_H - 6);
    const videoCount = order.filter((track) => track.type === 'video').length;
    const audioCount = order.length - videoCount;
    const unitH = lanesH / Math.max(1, videoCount * 1.25 + audioCount);
    const rowHeights = order.map((track) => Math.max(26, Math.min(track.type === 'video' ? 84 : 60, track.type === 'video' ? unitH * 1.25 : unitH)));
    const rowTops = rowHeights.reduce<number[]>((acc, value, index) => { acc.push(index === 0 ? 0 : acc[index - 1] + rowHeights[index - 1] + 1); return acc; }, []);

    const latest = useRef({ playhead, zoom });
    latest.current = { playhead, zoom };

    const timeAt = (clientX: number) => {
        const rect = laneRef.current?.getBoundingClientRect();
        if (!rect) return playhead;
        return playhead + (clientX - rect.left - laneWidth / 2) / zoom;
    };
    const rowAt = (clientY: number) => {
        const rect = laneRef.current?.getBoundingClientRect();
        if (!rect) return -1;
        const y = clientY - rect.top - RULER_H;
        return rowTops.findIndex((top, index) => y >= top && y < top + rowHeights[index] + 1);
    };

    /** Resolves what a click at (time, track) grabs: a cut side, a cut (roll) or a clip body. */
    const hitTest = (time: number, track: TimelineTrack) => {
        const tolerance = EDGE_PX / zoom;
        const edit = findEditPoint(clips, track.id, time, tolerance);
        if (edit) {
            const distancePx = Math.abs(time - edit.time) * zoom;
            const both = (edit.outgoing && edit.incoming && distancePx <= ROLL_PX) || trimTool === 'roll';
            const side: 'out' | 'in' | 'both' = both ? 'both' : time < edit.time ? (edit.outgoing ? 'out' : 'in') : (edit.incoming ? 'in' : 'out');
            const target: TrimTarget = { kind: 'edit', trackId: track.id, time: edit.time, outgoingId: edit.outgoing?.id ?? null, incomingId: edit.incoming?.id ?? null, side };
            return { target, clip: null as TimelineClip | null };
        }
        const clip = clips.find((entry) => entry.trackId === track.id && time >= entry.start && time < entry.end) || null;
        if (clip && (trimTool === 'slip' || trimTool === 'slide')) return { target: { kind: 'clip', clipId: clip.id } as TrimTarget, clip };
        return { target: null, clip };
    };

    const drag = useRef<{ kind: 'scrub' | 'trim'; startX: number; startPlayhead: number; moved: boolean; target: TrimTarget | null; clickTime: number; clipId: string | null } | null>(null);

    const onPointerDown = (event: React.PointerEvent) => {
        if (event.button !== 0) return;
        const rect = laneRef.current?.getBoundingClientRect();
        if (!rect) return;
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        const time = timeAt(event.clientX);
        const row = rowAt(event.clientY);
        const onRuler = event.clientY - rect.top < RULER_H;
        const track = !onRuler && row >= 0 ? order[row] : null;
        if (track && !track.isLocked) {
            const hit = hitTest(time, track);
            if (hit.target) {
                drag.current = { kind: 'trim', startX: event.clientX, startPlayhead: playhead, moved: false, target: hit.target, clickTime: time, clipId: hit.clip?.id ?? null };
                onTrimTarget(hit.target);
                onTrimDrag('start', hit.target, 0);
                return;
            }
            drag.current = { kind: 'scrub', startX: event.clientX, startPlayhead: playhead, moved: false, target: null, clickTime: time, clipId: hit.clip?.id ?? null };
            return;
        }
        drag.current = { kind: 'scrub', startX: event.clientX, startPlayhead: playhead, moved: false, target: null, clickTime: time, clipId: null };
    };

    const onPointerMove = (event: React.PointerEvent) => {
        const state = drag.current;
        if (!state) return;
        const dx = event.clientX - state.startX;
        if (!state.moved && Math.abs(dx) < 3) return;
        state.moved = true;
        if (state.kind === 'trim') onTrimDrag('move', state.target, dx / latest.current.zoom);
        else onSeek(Math.max(0, Math.min(duration, state.startPlayhead - dx / latest.current.zoom)));
    };

    const onPointerUp = (event: React.PointerEvent) => {
        const state = drag.current;
        drag.current = null;
        if (!state) return;
        if (state.kind === 'trim') { onTrimDrag(state.moved ? 'end' : 'cancel', state.target, 0); return; }
        if (state.moved) return;
        // Plain click: select the clip under the pointer (or nothing) and move the playhead there.
        const row = rowAt(event.clientY);
        if (row >= 0 && order[row]) onSetActiveTrack(order[row].id);
        onSelectClip(state.clipId);
        onTrimTarget(null);
        onSeek(Math.max(0, Math.min(Math.max(duration, 0), state.clickTime)));
    };

    const onWheel = useCallback((event: WheelEvent) => {
        event.preventDefault();
        const { playhead: current, zoom: z } = latest.current;
        if (event.ctrlKey || event.metaKey) {
            onZoom(z * Math.exp(-event.deltaY * 0.0025));
            return;
        }
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        onSeek(Math.max(0, current + delta / z));
    }, [onSeek, onZoom]);

    useEffect(() => {
        const element = laneRef.current;
        if (!element) return;
        element.addEventListener('wheel', onWheel, { passive: false });
        return () => element.removeEventListener('wheel', onWheel);
    }, [onWheel, laneRef]);

    const onDragOver = (event: React.DragEvent) => {
        if (!onDropMedia || !Array.from(event.dataTransfer.types).includes('application/x-media-id')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (event: React.DragEvent) => {
        if (!onDropMedia) return;
        const mediaId = event.dataTransfer.getData('application/x-media-id');
        const row = rowAt(event.clientY);
        if (!mediaId || row < 0 || !order[row]) return;
        event.preventDefault();
        onDropMedia(mediaId, order[row].id, Math.max(0, timeAt(event.clientX)));
    };

    const step = pickRulerStep(zoom, 80);
    const minor = step / 4;
    const ticks: Array<{ t: number; major: boolean }> = [];
    const firstTick = Math.max(0, Math.floor(view.startTime / minor) * minor);
    for (let t = firstTick; t <= view.endTime && ticks.length < 600; t += minor) ticks.push({ t, major: Math.abs(t / step - Math.round(t / step)) < 1e-6 });

    const trimEdgeFor = (clip: TimelineClip): { start?: boolean; end?: boolean; body?: boolean } => {
        if (!trimTarget) return {};
        if (trimTarget.kind === 'clip') {
            if (trimTarget.clipId === clip.id) return { body: true };
            const target = clips.find((entry) => entry.id === trimTarget.clipId);
            if (target && trimTool === 'slide') {
                const near = neighbours(clips, target);
                if (near.adjacentBefore?.id === clip.id) return { end: true };
                if (near.adjacentAfter?.id === clip.id) return { start: true };
            }
            return {};
        }
        return {
            end: trimTarget.outgoingId === clip.id && trimTarget.side !== 'in',
            start: trimTarget.incomingId === clip.id && trimTarget.side !== 'out',
        };
    };

    return (
        <div className="cutp-tl" style={{ height }} data-automation-id="cut-timeline">
            <Overview clips={clips} tracks={tracks} mediaItems={mediaItems} playhead={playhead} selectedClipId={selectedClipId} timelineIn={timelineIn} timelineOut={timelineOut} onSeek={onSeek} detailSpan={laneWidth / Math.max(1, zoom)} />
            <div className="cutp-dt">
                <div className="cutp-dt__heads" style={{ width: HEADER_W }}>
                    <div className="cutp-dt__corner" style={{ height: RULER_H }}>{formatTimecode(playhead).slice(3)}</div>
                    {order.map((track, row) => (
                        <button
                            key={track.id}
                            type="button"
                            className={`cutp-dt__head cutp-dt__head--${track.type} ${track.id === activeTrackId ? 'cutp-dt__head--active' : ''} ${track.isLocked ? 'cutp-dt__head--locked' : ''}`}
                            style={{ height: rowHeights[row] }}
                            onClick={() => onSetActiveTrack(track.id)}
                            title={`${labels[track.id]}${track.isLocked ? ' (gesperrt)' : ''} – als Zielspur setzen`}
                            data-automation-id={`cut-track-${track.id}`}
                        >
                            {labels[track.id]}
                            {track.isLocked && <Lock className="w-3 h-3" />}
                        </button>
                    ))}
                </div>
                <div
                    ref={laneRef}
                    className={`cutp-dt__lanes cutp-dt__lanes--${trimTool}`}
                    data-automation-id="cut-timeline-detail"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={() => { if (drag.current?.kind === 'trim') onTrimDrag('cancel', drag.current.target, 0); drag.current = null; }}
                    onDragOver={onDragOver}
                    onDrop={onDrop}
                >
                    <div className="cutp-dt__ruler" style={{ height: RULER_H }}>
                        {ticks.map(({ t, major }) => (
                            <span key={t.toFixed(4)} className={major ? 'cutp-dt__tick cutp-dt__tick--major' : 'cutp-dt__tick'} style={{ left: view.timeToX(t) }}>
                                {major && <em>{formatRulerLabel(t, step)}</em>}
                            </span>
                        ))}
                        {timelineIn !== null && <span className="cutp-dt__mark cutp-dt__mark--in" style={{ left: view.timeToX(timelineIn) }} />}
                        {timelineOut !== null && <span className="cutp-dt__mark cutp-dt__mark--out" style={{ left: view.timeToX(timelineOut) }} />}
                    </div>
                    {view.startTime < 0 && <div className="cutp-dt__before" style={{ width: Math.max(0, view.timeToX(0)) }} />}
                    {order.map((track, row) => (
                        <div key={track.id} className={`cutp-dt__row cutp-dt__row--${track.type} ${track.id === activeTrackId ? 'cutp-dt__row--active' : ''}`} style={{ top: RULER_H + rowTops[row], height: rowHeights[row] }}>
                            {clips.filter((clip) => clip.trackId === track.id && clip.end > view.startTime - 1 && clip.start < view.endTime + 1).map((clip) => {
                                const media = mediaItems.find((item) => item.id === clip.mediaId);
                                const left = view.timeToX(clip.start);
                                const width = Math.max(2, (clip.end - clip.start) * zoom);
                                const poster = posters[clip.mediaId];
                                const peaks = waveforms[clip.mediaId];
                                const length = media?.type === 'image' ? 0 : media?.duration || 0;
                                const from = length > 0 ? (clip.sourceIn ?? 0) / length : 0;
                                const to = length > 0 ? (clip.sourceOut ?? length) / length : 1;
                                const edge = trimEdgeFor(clip);
                                const isAudio = track.type === 'audio';
                                return (
                                    <div
                                        key={clip.id}
                                        className={`cutp-clip cutp-clip--${isAudio ? 'audio' : media?.type || 'video'} ${clip.id === selectedClipId ? 'cutp-clip--sel' : ''} ${edge.body ? 'cutp-clip--trim' : ''}`}
                                        style={{ left, width }}
                                        data-automation-id={`cut-clip-${clip.id}`}
                                        title={`${clip.textConfig?.content || media?.name || 'Clip'} · ${formatTimecode(clip.start)} → ${formatTimecode(clip.end)}`}
                                    >
                                        {!isAudio && poster && <span className="cutp-clip__thumbs" style={{ backgroundImage: `url("${poster}")` }} />}
                                        <span className="cutp-clip__name">{clip.textConfig?.content || media?.name || 'Clip'}</span>
                                        {peaks && peaks.length > 0 && length > 0 && (
                                            <WaveformSvg peaks={peaks} from={from} to={Math.min(1, to)} className={`cutp-clip__wave ${isAudio ? 'cutp-clip__wave--full' : ''}`} />
                                        )}
                                        {clip.transitionOut && (
                                            <span className="cutp-clip__fx" style={{ width: Math.max(6, Math.min(width, clip.transitionOut.duration * zoom)) }} title={`${clip.transitionOut.type} · ${clip.transitionOut.duration.toFixed(2)} s`} />
                                        )}
                                        {edge.start && <span className="cutp-clip__edge cutp-clip__edge--in" />}
                                        {edge.end && <span className="cutp-clip__edge cutp-clip__edge--out" />}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                    <div className="cutp-playhead cutp-playhead--fixed" style={{ left: view.playheadX }} />
                </div>
            </div>
        </div>
    );
};

export default CutTimeline;
