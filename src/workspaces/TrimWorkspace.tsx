/**
 * Cut page: media pool, one switchable viewer (source clip / source tape /
 * timeline), smart edit buttons, a dual timeline (fitted overview + detail
 * under a fixed playhead) and a trim editor with dual-frame view.
 *
 * Every action is a named command (see `commands`), reachable from buttons,
 * keyboard, live commands (`cut.state.get` / `cut.state.set`) and the MCP
 * tools in src/mcp/modules/cutTools.ts. The editing maths lives in
 * cut-pro/editOps.ts; this file only wires state and UI.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TransitionType, type MediaItem, type TimelineClip, type TimelineTrack } from '../types';
import type { SharedSequenceProps, TrimMode } from '../components/EditorPageShell';
import { DEFAULT_TIMELINE_FPS, formatTimecode } from '../utils/timecode';
import { registerLiveCommands } from '../mcp/liveCommands';
import {
    adjacentEdit, appendToEnd, applyTrim, isEditFailure, bladeAt, buildSourceTape, closeUp, editPoints, fastReviewRate,
    findEditPoint, locateTape, neighbours, nextShuttle, pickTargetTrack, placeOnTop, quickTransitionDuration, retarget,
    rippleOverwrite, sequenceEnd, setTransitionOut, smartInsert, sortMedia, sourceOverwrite, tapeLength, tapeTimeOf,
    type EditResult, type QuickTransition, type TrimTarget, type TrimTool,
} from './cut-pro/editOps';
import {
    currentSource, DEFAULT_CUT_STATE, DETAIL_ZOOM_MAX, DETAIL_ZOOM_MIN, editSourceFor, parseCutState, setMark,
    sourceMediaLength, TIMELINE_HEIGHT_MAX, TIMELINE_HEIGHT_MIN, type CutUiState, type ViewerMode,
} from './cut-pro/cutState';
import MediaPoolStrip from './cut-pro/MediaPoolStrip';
import CutViewer, { TrimFrames, type TrimFrame } from './cut-pro/CutViewer';
import CutTimeline from './cut-pro/CutTimeline';
import { usePosterFrames, useWaveforms } from './cut-pro/useMediaAssets';
import {
    AppendIcon, BladeIcon, CloseUpIcon, DissolveIcon, HardCutIcon, PlaceOnTopIcon, RippleOverwriteIcon, SmartInsertIcon,
    SmoothCutIcon, SourceOverwriteIcon, TrimToolIcon,
} from './cut-pro/CutIcons';
import { EditIcon } from '../components/icons';
import { ZoomIn, ZoomOut } from 'lucide-react';
import './cut-pro/cutPage.css';

interface TrimWorkspaceProps extends SharedSequenceProps {
    onSwitchToEdit?: () => void;
    onAddMedia?: (files: FileList) => void | Promise<void>;
}

const FPS = DEFAULT_TIMELINE_FPS;
const FRAME = 1 / FPS;
const STATE_KEY = 'cut_page_state_v1';

const TOOLS: Array<{ mode: TrimMode; label: string; key: string; hint: string }> = [
    { mode: 'normal', label: 'Trimmen', key: 'V', hint: 'Kante ändern, Nachbarn bleiben stehen' },
    { mode: 'ripple', label: 'Ripple', key: 'R', hint: 'Kante ändern, alles danach rückt nach' },
    { mode: 'roll', label: 'Rollen', key: 'Shift+R', hint: 'Schnittpunkt zwischen zwei Clips verschieben' },
    { mode: 'slip', label: 'Slip', key: 'Y', hint: 'Andere Bilder zeigen, Clip bleibt an seinem Platz' },
    { mode: 'slide', label: 'Slide', key: 'U', hint: 'Clip verschieben, Nachbarn gleichen aus' },
];
const TOOL_LABEL: Record<TrimTool, string> = { normal: 'Trimmen', ripple: 'Ripple', roll: 'Rollen', slip: 'Slip', slide: 'Slide' };

const loadState = (): CutUiState => {
    try {
        const raw = window.localStorage.getItem(STATE_KEY);
        return raw ? parseCutState(JSON.parse(raw)) : { ...DEFAULT_CUT_STATE };
    } catch { return { ...DEFAULT_CUT_STATE }; }
};

const isTyping = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    const tag = element?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(element?.isContentEditable);
};

let idCounter = 0;
const makeId = () => `clip-${Date.now()}-${(idCounter += 1)}`;

const TrimWorkspace: React.FC<TrimWorkspaceProps> = (props) => {
    const {
        mediaItems, timelineClips, timelineTracks, activeTrackId, selectedClipId, playheadPosition, isPlaying, waveformCache, trimMode,
        onSelectClip, onBatchUpdateClips, onTrimModeChange, onPlayheadUpdate, onTogglePlayback, onAddTrack, onSetActiveTrack, onDropMedia,
    } = props;

    const [ui, setUi] = useState<CutUiState>(loadState);
    const [shuttle, setShuttle] = useState(0);
    const [notice, setNotice] = useState<string | null>(null);
    const [preview, setPreview] = useState<{ clips: TimelineClip[]; applied: number } | null>(null);
    const [trimOffset, setTrimOffset] = useState(0);
    const dragBase = useRef<TimelineClip[] | null>(null);
    const pending = useRef<{ run: (clips: TimelineClip[], tracks: TimelineTrack[]) => EditResult<TimelineClip>; trackCount: number; restoreTrack: string | null } | null>(null);

    const update = useCallback((patch: Partial<CutUiState> | ((prev: CutUiState) => Partial<CutUiState>)) => {
        setUi((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));
    }, []);

    // Persist (debounced; only the serializable state).
    useEffect(() => {
        const timer = window.setTimeout(() => { try { window.localStorage.setItem(STATE_KEY, JSON.stringify(ui)); } catch { /* storage full / blocked */ } }, 400);
        return () => window.clearTimeout(timer);
    }, [ui]);

    const say = useCallback((message: string) => setNotice(message), []);
    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(() => setNotice(null), 3500);
        return () => window.clearTimeout(timer);
    }, [notice]);

    /* ─── Derived ─── */

    const sortedMedia = useMemo(() => sortMedia(mediaItems, ui.poolSort, ui.poolSortDesc), [mediaItems, ui.poolSort, ui.poolSortDesc]);
    const tape = useMemo(() => buildSourceTape(sortedMedia), [sortedMedia]);
    const posters = usePosterFrames(mediaItems);
    const waveforms = useWaveforms(mediaItems, waveformCache);
    const shownClips = preview?.clips ?? timelineClips;
    const duration = sequenceEnd(timelineClips);
    const tool: TrimTool = trimMode;
    const usedMediaIds = useMemo(() => new Set(timelineClips.map((clip) => clip.mediaId)), [timelineClips]);
    const mediaLength = useCallback((mediaId: string) => {
        const item = mediaItems.find((entry) => entry.id === mediaId);
        if (!item) return 5;
        return item.type === 'image' ? Number.POSITIVE_INFINITY : Math.max(0.05, item.duration || 5);
    }, [mediaItems]);

    const current = currentSource(ui, mediaItems, tape);
    const sourceMediaItem = current ? mediaItems.find((item) => item.id === current.media.id) || null : null;
    /** Media the edit buttons use: the tape position in tape mode, else the loaded source clip. */
    const editMedia = ui.viewerMode === 'tape'
        ? sourceMediaItem
        : (ui.sourceMediaId ? mediaItems.find((item) => item.id === ui.sourceMediaId) || null : null);
    const editSourceTime = ui.viewerMode === 'tape' ? (current?.time ?? 0) : ui.sourcePlayhead;

    // Drop a trim target whose clips vanished (undo, delete …).
    useEffect(() => {
        const target = ui.trimTarget;
        if (!target) return;
        const exists = (id: string | null) => !id || timelineClips.some((clip) => clip.id === id);
        const valid = target.kind === 'clip' ? timelineClips.some((clip) => clip.id === target.clipId) : exists(target.outgoingId) && exists(target.incomingId) && Boolean(target.outgoingId || target.incomingId);
        if (!valid) update({ trimTarget: null });
    }, [timelineClips, ui.trimTarget, update]);

    /* ─── Edits ─── */

    const applyResult = useCallback((result: EditResult<TimelineClip>, label: string) => {
        if (isEditFailure(result)) { say(result.message); return false; }
        onBatchUpdateClips(result.clips);
        onSelectClip(result.selectId);
        if (typeof result.playhead === 'number') onPlayheadUpdate(result.playhead);
        say(label);
        return true;
    }, [onBatchUpdateClips, onSelectClip, onPlayheadUpdate, say]);

    const runEdit = useCallback((label: string, run: (clips: TimelineClip[], tracks: TimelineTrack[]) => EditResult<TimelineClip>) => {
        const result = run(timelineClips, timelineTracks);
        if (isEditFailure(result) && result.needsTrack) {
            pending.current = { run, trackCount: timelineTracks.length, restoreTrack: activeTrackId };
            onAddTrack(result.needsTrack);
            say(`${label}: neue ${result.needsTrack === 'video' ? 'Video' : 'Audio'}spur angelegt`);
            return;
        }
        applyResult(result, label);
    }, [timelineClips, timelineTracks, activeTrackId, onAddTrack, applyResult, say]);

    // Finish an edit that had to wait for a new track.
    useEffect(() => {
        const job = pending.current;
        if (!job || timelineTracks.length <= job.trackCount) return;
        pending.current = null;
        const result = job.run(timelineClips, timelineTracks);
        applyResult(result, 'Bearbeitet');
        if (job.restoreTrack) onSetActiveTrack(job.restoreTrack);
    }, [timelineTracks, timelineClips, applyResult, onSetActiveTrack]);

    const requireSource = useCallback(() => {
        if (!editMedia) { say('Erst einen Clip im Mediapool wählen.'); return null; }
        const source = editSourceFor(editMedia, ui.marks[editMedia.id]);
        if (!source) { say('In/Out der Quelle ergeben keinen Bereich.'); return null; }
        return source;
    }, [editMedia, ui.marks, say]);

    const targetTrackId = useCallback((mediaType: MediaItem['type']) => pickTargetTrack(timelineTracks, mediaType, activeTrackId)?.id ?? null, [timelineTracks, activeTrackId]);

    const commands = {
        loadSource: (mediaId: string) => {
            const item = mediaItems.find((entry) => entry.id === mediaId);
            if (!item) return;
            if (ui.viewerMode === 'tape') {
                update({ tapeTime: tapeTimeOf(tape, mediaId, ui.marks[mediaId]?.in ?? 0) ?? ui.tapeTime, sourceMediaId: mediaId });
            } else {
                update((prev) => ({ viewerMode: 'source', sourceMediaId: mediaId, sourcePlayhead: prev.sourceMediaId === mediaId ? prev.sourcePlayhead : prev.marks[mediaId]?.in ?? 0, trimTarget: null }));
            }
            setShuttle(0);
        },
        setViewerMode: (mode: ViewerMode) => {
            setShuttle(0);
            if (isPlaying && mode !== 'timeline') onTogglePlayback();
            if (mode === 'tape' && ui.sourceMediaId) {
                const at = tapeTimeOf(tape, ui.sourceMediaId, ui.sourcePlayhead);
                update({ viewerMode: mode, tapeTime: at ?? ui.tapeTime });
            } else if (mode === 'source' && ui.viewerMode === 'tape' && current) {
                update({ viewerMode: mode, sourceMediaId: current.media.id, sourcePlayhead: current.time });
            } else update({ viewerMode: mode });
        },
        markIn: () => {
            if (ui.viewerMode === 'timeline') { update((prev) => ({ timelineIn: playheadPosition, timelineOut: prev.timelineOut !== null && prev.timelineOut <= playheadPosition ? null : prev.timelineOut })); return; }
            if (!current) return;
            update((prev) => ({ marks: setMark(prev.marks, current.media.id, 'in', current.time) }));
        },
        markOut: () => {
            if (ui.viewerMode === 'timeline') { update((prev) => ({ timelineOut: playheadPosition, timelineIn: prev.timelineIn !== null && prev.timelineIn >= playheadPosition ? null : prev.timelineIn })); return; }
            if (!current) return;
            update((prev) => ({ marks: setMark(prev.marks, current.media.id, 'out', current.time) }));
        },
        clearMarks: (which: 'in' | 'out' | 'both' = 'both') => {
            if (ui.viewerMode === 'timeline') { update({ ...(which !== 'out' ? { timelineIn: null } : {}), ...(which !== 'in' ? { timelineOut: null } : {}) }); return; }
            if (!current) return;
            update((prev) => {
                let marks = prev.marks;
                if (which !== 'out') marks = setMark(marks, current.media.id, 'in', null);
                if (which !== 'in') marks = setMark(marks, current.media.id, 'out', null);
                return { marks };
            });
        },
        smartInsert: () => {
            const source = requireSource(); if (!source) return;
            const trackId = targetTrackId(source.mediaType); if (!trackId) { say('Keine freie Zielspur.'); return; }
            runEdit('Smart Insert', (clips, tracks) => smartInsert(clips, tracks, trackId, source, playheadPosition, makeId));
        },
        append: () => {
            const source = requireSource(); if (!source) return;
            const trackId = targetTrackId(source.mediaType); if (!trackId) { say('Keine freie Zielspur.'); return; }
            runEdit('Angehängt', (clips, tracks) => appendToEnd(clips, tracks, trackId, source, makeId));
        },
        rippleOverwrite: () => {
            const source = requireSource(); if (!source) return;
            const trackId = targetTrackId(source.mediaType); if (!trackId) { say('Keine freie Zielspur.'); return; }
            runEdit('Ripple-Überschreiben', (clips, tracks) => rippleOverwrite(clips, tracks, trackId, source, playheadPosition, makeId));
        },
        closeUp: () => {
            const base = targetTrackId('video');
            const range = ui.timelineIn !== null && ui.timelineOut !== null && ui.timelineOut > ui.timelineIn ? { start: ui.timelineIn, end: ui.timelineOut } : null;
            runEdit('Nahaufnahme', (clips, tracks) => closeUp(clips, tracks, base, playheadPosition, makeId, { range }));
        },
        placeOnTop: () => {
            const source = requireSource(); if (!source) return;
            runEdit('Oben platziert', (clips, tracks) => placeOnTop(clips, tracks, source, playheadPosition, makeId));
        },
        sourceOverwrite: () => {
            const source = requireSource(); if (!source) return;
            const base = targetTrackId('video');
            runEdit('Quelle überschrieben', (clips, tracks) => sourceOverwrite(clips, tracks, base, source, editSourceTime, playheadPosition, makeId));
        },
        blade: () => {
            const result = bladeAt(timelineClips, timelineTracks, playheadPosition, makeId);
            if (result.cut === 0) { say('Unter dem Playhead liegt kein Clip.'); return; }
            onBatchUpdateClips(result.clips);
            say(`${result.cut} Clip${result.cut > 1 ? 's' : ''} geschnitten`);
        },
        quickTransition: (kind: QuickTransition) => {
            const target = ui.trimTarget;
            const outgoingId = target?.kind === 'edit' ? target.outgoingId : selectedClipId;
            const outgoing = outgoingId ? timelineClips.find((clip) => clip.id === outgoingId) : null;
            if (!outgoing) { say('Erst einen Schnitt oder Clip wählen.'); return; }
            const after = neighbours(timelineClips, outgoing).adjacentAfter;
            const length = quickTransitionDuration(kind, outgoing.end - outgoing.start, after ? after.end - after.start : null, FPS);
            onBatchUpdateClips(setTransitionOut(timelineClips, outgoing.id, length === null ? null : { type: TransitionType.CROSS_FADE, duration: length }) as TimelineClip[]);
            say(kind === 'cut' ? 'Harter Schnitt' : kind === 'dissolve' ? 'Überblendung gesetzt' : 'Weicher Schnitt gesetzt');
        },
        selectTrim: (target: TrimTarget | null) => {
            update({ trimTarget: target });
            setTrimOffset(0);
            if (target) {
                setShuttle(0);
                if (isPlaying) onTogglePlayback();
                if (target.kind === 'edit') onPlayheadUpdate(target.time);
            }
        },
        trimStep: (frames: number) => {
            const target = ui.trimTarget;
            if (!target) {
                // Without a trim selection , and . step the playhead.
                onPlayheadUpdate(Math.max(0, Math.min(duration, playheadPosition + frames * FRAME)));
                return;
            }
            const result = applyTrim(timelineClips, target, tool, frames * FRAME, mediaLength);
            if (Math.abs(result.applied) < 1e-6) { say('Am Limit: kein Material mehr oder Nachbar im Weg.'); return; }
            onBatchUpdateClips(result.clips);
            const next = retarget(result.clips, target);
            update({ trimTarget: next });
            setTrimOffset((value) => value + Math.round(result.applied * FPS));
            if (next.kind === 'edit') onPlayheadUpdate(next.time);
        },
        jumpEdit: (direction: -1 | 1) => {
            const target = ui.trimTarget;
            if (target?.kind === 'edit') {
                const time = adjacentEdit(timelineClips, target.trackId, target.time, direction);
                if (time === null) return;
                const hit = findEditPoint(timelineClips, target.trackId, time, 1e-3);
                if (hit) { commands.selectTrim({ kind: 'edit', trackId: target.trackId, time: hit.time, outgoingId: hit.outgoing?.id ?? null, incomingId: hit.incoming?.id ?? null, side: target.side }); return; }
            }
            const time = adjacentEdit(timelineClips, null, playheadPosition, direction);
            if (time !== null) onPlayheadUpdate(time);
        },
        shuttle: (key: 'j' | 'k' | 'l') => {
            if (key === 'k') { setShuttle(0); if (isPlaying) onTogglePlayback(); return; }
            const base = ui.viewerMode === 'timeline' && isPlaying && shuttle === 0 ? 1 : shuttle;
            setShuttle(nextShuttle(base, key));
        },
        fastReview: () => {
            const length = ui.viewerMode === 'timeline'
                ? duration
                : ui.viewerMode === 'tape' ? (current ? sourceMediaLength(current.media) : 0) : (editMedia ? sourceMediaLength(editMedia) : 0);
            const rate = fastReviewRate(length);
            setShuttle(rate);
            say(`Schnelldurchsicht ${rate}×`);
        },
        setZoom: (zoom: number) => update({ detailZoom: Math.max(DETAIL_ZOOM_MIN, Math.min(DETAIL_ZOOM_MAX, zoom)) }),
    };
    const commandsRef = useRef(commands);
    commandsRef.current = commands;

    /* ─── Trim drags from the detail timeline ─── */

    const previewRef = useRef<{ clips: TimelineClip[]; applied: number } | null>(null);
    const onTrimDrag = useCallback((phase: 'start' | 'move' | 'end' | 'cancel', target: TrimTarget | null, delta: number) => {
        if (phase === 'start') { dragBase.current = timelineClips; previewRef.current = null; setPreview(null); return; }
        const base = dragBase.current;
        if (!base || !target) return;
        if (phase === 'move') {
            const next = applyTrim(base, target, tool, Math.round(delta * FPS) / FPS, mediaLength);
            previewRef.current = next;
            setPreview(next);
            return;
        }
        const last = previewRef.current;
        dragBase.current = null;
        previewRef.current = null;
        setPreview(null);
        if (phase === 'end' && last && Math.abs(last.applied) > 1e-6) {
            onBatchUpdateClips(last.clips);
            const next = retarget(last.clips, target);
            update({ trimTarget: next });
            setTrimOffset((value) => value + Math.round(last.applied * FPS));
            if (next.kind === 'edit') onPlayheadUpdate(next.time);
        }
    }, [timelineClips, tool, mediaLength, onBatchUpdateClips, update, onPlayheadUpdate]);

    /* ─── Shuttle / playback ─── */

    const playRef = useRef({ playheadPosition, duration, ui, tape });
    playRef.current = { playheadPosition, duration, ui, tape };

    useEffect(() => { if (!isPlaying && shuttle === 1 && ui.viewerMode === 'timeline') setShuttle(0); }, [isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

    const sourceIsNative = Boolean(sourceMediaItem && (sourceMediaItem.type === 'video' || sourceMediaItem.type === 'audio'));
    useEffect(() => {
        if (shuttle === 0) return;
        if (ui.viewerMode === 'timeline') {
            if (shuttle === 1) { if (!isPlaying) onTogglePlayback(); return; }
            if (isPlaying) onTogglePlayback();
        } else if (shuttle > 0 && sourceIsNative) {
            return; // the viewer element plays natively at this rate
        }
        let frame = 0;
        let last = performance.now();
        const tick = (now: number) => {
            const dt = Math.min(0.1, (now - last) / 1000);
            last = now;
            const { playheadPosition: position, duration: total, ui: state, tape: currentTape } = playRef.current;
            if (state.viewerMode === 'timeline') {
                const next = position + dt * shuttle;
                if (next <= 0 || next >= total) { onPlayheadUpdate(Math.max(0, Math.min(total, next))); setShuttle(0); return; }
                onPlayheadUpdate(next);
            } else if (state.viewerMode === 'tape') {
                const end = tapeLength(currentTape);
                const next = state.tapeTime + dt * shuttle;
                if (next <= 0 || next >= end) { update({ tapeTime: Math.max(0, Math.min(end, next)) }); setShuttle(0); return; }
                update({ tapeTime: next });
            } else {
                const item = mediaItems.find((entry) => entry.id === state.sourceMediaId);
                const end = item ? sourceMediaLength(item) : 0;
                const next = state.sourcePlayhead + dt * shuttle;
                if (next <= 0 || next >= end) { update({ sourcePlayhead: Math.max(0, Math.min(end, next)) }); setShuttle(0); return; }
                update({ sourcePlayhead: next });
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [shuttle, ui.viewerMode, sourceIsNative, current?.media.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const onSourceTime = useCallback((time: number) => {
        if (playRef.current.ui.viewerMode === 'tape') {
            const hit = locateTape(playRef.current.tape, playRef.current.ui.tapeTime);
            if (!hit) return;
            const segment = playRef.current.tape[hit.index];
            if (time >= segment.length - FRAME / 2) {
                const nextSegment = playRef.current.tape[hit.index + 1];
                if (nextSegment) update({ tapeTime: nextSegment.tapeStart }); else setShuttle(0);
                return;
            }
            update({ tapeTime: segment.tapeStart + time });
        } else update({ sourcePlayhead: time });
    }, [update]);
    const onSourceEnded = useCallback(() => {
        if (playRef.current.ui.viewerMode === 'tape') {
            const hit = locateTape(playRef.current.tape, playRef.current.ui.tapeTime);
            const nextSegment = hit ? playRef.current.tape[hit.index + 1] : null;
            if (nextSegment) { update({ tapeTime: nextSegment.tapeStart }); return; }
        }
        setShuttle(0);
    }, [update]);

    /* ─── Keyboard (capture phase, so the app's global J/K/L/O handlers do not also fire) ─── */

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (isTyping(event.target)) return;
            const run = commandsRef.current;
            const key = event.key;
            const lower = key.toLowerCase();
            const claim = () => { event.preventDefault(); event.stopPropagation(); };
            if ((event.metaKey || event.ctrlKey) && lower === 'b') { claim(); run.blade(); return; }
            if (event.metaKey || event.ctrlKey) return;
            if (event.altKey) {
                if (lower === 'x' || key === '≈') { claim(); run.clearMarks('both'); return; }
                if (lower === 'i' || key === '⁄') { claim(); run.clearMarks('in'); return; }
                if (lower === 'o' || key === 'ø') { claim(); run.clearMarks('out'); return; }
                if (key === 'F9') { claim(); run.closeUp(); return; }
                return;
            }
            switch (true) {
                case lower === 'j' || lower === 'k' || lower === 'l': claim(); run.shuttle(lower as 'j' | 'k' | 'l'); return;
                case lower === 'i': claim(); run.markIn(); return;
                case lower === 'o': claim(); run.markOut(); return;
                case key === ',' || key === ';' || key === '<': claim(); run.trimStep(-(event.shiftKey ? playRef.current.ui.multiFrame : 1)); return;
                case key === '.' || key === ':' || key === '>': claim(); run.trimStep(event.shiftKey ? playRef.current.ui.multiFrame : 1); return;
                case key === 'ArrowUp': claim(); run.jumpEdit(-1); return;
                case key === 'ArrowDown': claim(); run.jumpEdit(1); return;
                case key === 'ArrowLeft' || key === 'ArrowRight': {
                    claim();
                    const delta = (event.shiftKey ? 1 : FRAME) * (key === 'ArrowLeft' ? -1 : 1);
                    const state = playRef.current.ui;
                    if (state.viewerMode === 'timeline') onPlayheadUpdate(Math.max(0, Math.min(playRef.current.duration, playRef.current.playheadPosition + delta)));
                    else if (state.viewerMode === 'tape') update({ tapeTime: Math.max(0, Math.min(tapeLength(playRef.current.tape), state.tapeTime + delta)) });
                    else update({ sourcePlayhead: Math.max(0, state.sourcePlayhead + delta) });
                    return;
                }
                case key === ' ' && playRef.current.ui.viewerMode !== 'timeline': claim(); setShuttle((value) => (value === 0 ? 1 : 0)); return;
                case key === 'Escape': if (playRef.current.ui.trimTarget) { claim(); run.selectTrim(null); } return;
                case key === 'F9' && event.shiftKey: claim(); run.append(); return;
                case key === 'F9': claim(); run.smartInsert(); return;
                case key === 'F10' && event.shiftKey: claim(); run.rippleOverwrite(); return;
                case key === 'F12': claim(); run.placeOnTop(); return;
                case key === 'F11' && event.shiftKey: claim(); run.sourceOverwrite(); return;
                case lower === 'r' && event.shiftKey: claim(); onTrimModeChange('roll'); return;
                case key === '\\': claim(); run.quickTransition('dissolve'); return;
                default: return;
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [onPlayheadUpdate, onTrimModeChange, update]);

    /* ─── Live commands for MCP (cut_viewer_state_get / cut_viewer_set) ─── */

    const liveRef = useRef({ ui, timelineClips });
    liveRef.current = { ui, timelineClips };
    useEffect(() => registerLiveCommands({
        'cut.state.get': () => ({ ...liveRef.current.ui, shuttle: 0 }),
        'cut.state.set': (args) => {
            const run = commandsRef.current;
            if (typeof args.mode === 'string' && ['source', 'tape', 'timeline'].includes(args.mode)) run.setViewerMode(args.mode as ViewerMode);
            if (typeof args.mediaId === 'string') run.loadSource(args.mediaId);
            const mediaId = typeof args.mediaId === 'string' ? args.mediaId : liveRef.current.ui.sourceMediaId;
            if (mediaId) {
                setUi((prev) => {
                    let marks = prev.marks;
                    if (args.clearMarks === true) { marks = setMark(setMark(marks, mediaId, 'in', null), mediaId, 'out', null); }
                    if (typeof args.markIn === 'number') marks = setMark(marks, mediaId, 'in', args.markIn);
                    if (typeof args.markOut === 'number') marks = setMark(marks, mediaId, 'out', args.markOut);
                    return { ...prev, marks, ...(typeof args.sourceTime === 'number' ? { sourcePlayhead: Math.max(0, args.sourceTime) } : {}) };
                });
            }
            if (args.closeTrim === true || args.trimClipId === null) run.selectTrim(null);
            else if (typeof args.trimClipId === 'string') {
                const clips = liveRef.current.timelineClips;
                const clip = clips.find((entry) => entry.id === args.trimClipId);
                if (!clip) throw new Error(`Clip ${args.trimClipId} not found.`);
                const near = neighbours(clips, clip);
                if (args.trimEdge === 'clip') run.selectTrim({ kind: 'clip', clipId: clip.id });
                else if (args.trimEdge === 'in') run.selectTrim({ kind: 'edit', trackId: clip.trackId, time: clip.start, outgoingId: near.adjacentBefore?.id ?? null, incomingId: clip.id, side: 'in' });
                else run.selectTrim({ kind: 'edit', trackId: clip.trackId, time: clip.end, outgoingId: clip.id, incomingId: near.adjacentAfter?.id ?? null, side: 'out' });
            }
            return new Promise((resolve) => setTimeout(() => resolve(liveRef.current.ui), 50));
        },
    }), []);

    /* ─── Trim view (dual frames) ─── */

    const trimView = useMemo(() => {
        const target = ui.trimTarget;
        if (!target) return null;
        const find = (id: string | null) => (id ? shownClips.find((clip) => clip.id === id) || null : null);
        const mediaOf = (clip: TimelineClip | null) => (clip ? mediaItems.find((item) => item.id === clip.mediaId) || null : null);
        const lastFrame = (clip: TimelineClip) => Math.max(clip.sourceIn ?? 0, (clip.sourceOut ?? (clip.sourceIn ?? 0) + (clip.end - clip.start)) - FRAME * (clip.speed || 1));
        const frameOf = (clip: TimelineClip | null, which: 'first' | 'last', label: string, active: boolean): TrimFrame => ({
            media: mediaOf(clip),
            time: clip ? (which === 'first' ? clip.sourceIn ?? 0 : lastFrame(clip)) : 0,
            label: clip ? `${label} · ${mediaOf(clip)?.name || 'Clip'}` : `${label} · Lücke`,
            caption: clip ? `Quelle ${formatTimecode(which === 'first' ? clip.sourceIn ?? 0 : lastFrame(clip))} · Timeline ${formatTimecode(which === 'first' ? clip.start : clip.end)}` : '—',
            active,
        });
        let left: TrimFrame;
        let right: TrimFrame;
        if (target.kind === 'clip') {
            const clip = find(target.clipId);
            if (!clip) return null;
            if (tool === 'slide') {
                const near = neighbours(shownClips, clip);
                left = frameOf(near.adjacentBefore, 'last', 'Davor Ende', true);
                right = frameOf(near.adjacentAfter, 'first', 'Danach Anfang', true);
            } else {
                left = frameOf(clip, 'first', 'Anfang', true);
                right = frameOf(clip, 'last', 'Ende', true);
            }
        } else {
            left = frameOf(find(target.outgoingId), 'last', 'Ausgehend', target.side !== 'in');
            right = frameOf(find(target.incomingId), 'first', 'Eingehend', target.side !== 'out');
        }
        const label = target.kind === 'clip' ? (tool === 'slide' ? 'Slide' : 'Slip') : target.side === 'both' || tool === 'roll' ? 'Rollen' : TOOL_LABEL[tool];
        const offset = trimOffset + (preview ? Math.round(preview.applied * FPS) : 0);
        return <TrimFrames left={left} right={right} tool={label} offsetFrames={offset} onClose={() => commandsRef.current.selectTrim(null)} />;
    }, [ui.trimTarget, shownClips, mediaItems, tool, trimOffset, preview]);

    /* ─── Divider ─── */

    const startResize = (event: React.MouseEvent) => {
        event.preventDefault();
        const startY = event.clientY;
        const startHeight = ui.timelineHeight;
        const move = (ev: MouseEvent) => update({ timelineHeight: Math.max(TIMELINE_HEIGHT_MIN, Math.min(TIMELINE_HEIGHT_MAX, startHeight - (ev.clientY - startY))) });
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.cursor = ''; };
        document.body.style.cursor = 'row-resize';
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    /* ─── Viewer data ─── */

    const viewerMode = ui.viewerMode;
    const scrub = viewerMode === 'timeline'
        ? { duration: Math.max(duration, 0.001), time: playheadPosition, marks: ui.timelineIn !== null || ui.timelineOut !== null ? { in: ui.timelineIn, out: ui.timelineOut } : null }
        : viewerMode === 'tape'
            ? (() => {
                const hit = locateTape(tape, ui.tapeTime);
                const segment = hit ? tape[hit.index] : null;
                const mark = segment ? ui.marks[segment.mediaId] : undefined;
                return { duration: Math.max(tapeLength(tape), 0.001), time: ui.tapeTime, marks: segment && mark ? { in: mark.in !== null ? segment.tapeStart + mark.in : null, out: mark.out !== null ? segment.tapeStart + mark.out : null } : null };
            })()
            : { duration: sourceMediaItem ? sourceMediaLength(sourceMediaItem) : 0.001, time: current?.time ?? 0, marks: sourceMediaItem ? ui.marks[sourceMediaItem.id] ?? null : null };
    const onScrub = (time: number) => {
        setShuttle(0);
        if (viewerMode === 'timeline') onPlayheadUpdate(time);
        else if (viewerMode === 'tape') update({ tapeTime: time });
        else update({ sourcePlayhead: time });
    };
    const viewerTitle = viewerMode === 'timeline' ? (props.projectName || 'Timeline') : sourceMediaItem?.name || (viewerMode === 'tape' ? 'Quellband' : 'Kein Quellclip');
    const marks = sourceMediaItem ? ui.marks[sourceMediaItem.id] : undefined;
    const viewerSubtitle = viewerMode === 'timeline'
        ? `${timelineClips.length} Clips · ${formatTimecode(duration)}`
        : sourceMediaItem ? `In ${marks?.in != null ? formatTimecode(marks.in) : '—'} · Out ${marks?.out != null ? formatTimecode(marks.out) : '—'}${viewerMode === 'tape' ? ` · Band ${formatTimecode(ui.tapeTime)}` : ''}` : undefined;
    const reviewLength = viewerMode === 'timeline' ? duration : current ? sourceMediaLength(current.media) : 0;

    const smartButtons: Array<{ id: string; label: string; hint: string; icon: React.FC<{ className?: string }>; run: () => void }> = [
        { id: 'smart-insert', label: 'Smart Insert', hint: 'Am nächsten Schnittpunkt einfügen (F9)', icon: SmartInsertIcon, run: () => commandsRef.current.smartInsert() },
        { id: 'append', label: 'Anhängen', hint: 'Ans Ende der Timeline (Shift+F9)', icon: AppendIcon, run: () => commandsRef.current.append() },
        { id: 'ripple-overwrite', label: 'Ripple-Überschr.', hint: 'Clip unter dem Playhead ersetzen, Rest rückt nach (Shift+F10)', icon: RippleOverwriteIcon, run: () => commandsRef.current.rippleOverwrite() },
        { id: 'close-up', label: 'Nahaufnahme', hint: 'Kopie mit 130 % auf die Spur darüber (Alt+F9)', icon: CloseUpIcon, run: () => commandsRef.current.closeUp() },
        { id: 'place-on-top', label: 'Oben platzieren', hint: 'Auf die erste freie Spur darüber (F12)', icon: PlaceOnTopIcon, run: () => commandsRef.current.placeOnTop() },
        { id: 'source-overwrite', label: 'Quelle überschr.', hint: 'Quell-Playhead an Timeline-Playhead ausrichten, Spur darüber (Shift+F11)', icon: SourceOverwriteIcon, run: () => commandsRef.current.sourceOverwrite() },
    ];

    const editButtons = (
        <div className="cutp-smart" role="toolbar" aria-label="Schnitt-Aktionen" data-automation-id="cut-smart-edit-bar">
            {smartButtons.map(({ id, label, hint, icon: Icon, run }) => (
                <button key={id} type="button" className="cutp-smart__btn" onClick={run} title={hint} data-automation-id={`cut-edit-${id}`} disabled={id !== 'close-up' && !editMedia}>
                    <Icon className="w-5 h-5" />
                    <span>{label}</span>
                </button>
            ))}
        </div>
    );

    return (
        <div className="studio-workspace cutp" data-automation-id="cut-page">
            <div className="cutp-bar">
                <strong className="cutp-bar__title">Cut</strong>
                <small className="cutp-bar__project">{props.projectName || 'Unbenannte Sequenz'}</small>
                <span className="cutp-spacer" />
                {notice && <span className="cutp-notice" role="status" data-automation-id="cut-notice">{notice}</span>}
                {props.onSwitchToEdit && (
                    <button type="button" className="cutp-btn" onClick={props.onSwitchToEdit} title="Zur Edit-Seite (3)" data-automation-id="cut-switch-edit"><EditIcon className="w-3.5 h-3.5" />Edit-Seite</button>
                )}
            </div>

            <div className="cutp-top">
                <MediaPoolStrip
                    items={sortedMedia}
                    posters={posters}
                    activeMediaId={editMedia?.id ?? null}
                    usedMediaIds={usedMediaIds}
                    marks={ui.marks}
                    view={ui.poolView}
                    sort={ui.poolSort}
                    sortDesc={ui.poolSortDesc}
                    tapeActive={viewerMode === 'tape'}
                    onViewChange={(view) => update({ poolView: view })}
                    onSortChange={(sort, descending) => update({ poolSort: sort, poolSortDesc: descending })}
                    onLoadSource={(mediaId) => commandsRef.current.loadSource(mediaId)}
                    onToggleTape={() => commandsRef.current.setViewerMode(viewerMode === 'tape' ? 'source' : 'tape')}
                    onImport={props.onAddMedia ? (files) => { void props.onAddMedia?.(files); } : undefined}
                    footer={editButtons}
                />
                <CutViewer
                    mode={viewerMode}
                    onModeChange={(mode) => commandsRef.current.setViewerMode(mode)}
                    title={viewerTitle}
                    subtitle={viewerSubtitle}
                    timecode={viewerMode === 'timeline' ? playheadPosition : viewerMode === 'tape' ? ui.tapeTime : current?.time ?? 0}
                    duration={scrub.duration}
                    shuttle={viewerMode === 'timeline' && isPlaying && shuttle === 0 ? 1 : shuttle}
                    trimView={trimView}
                    timelineClips={shownClips}
                    timelineTracks={timelineTracks}
                    mediaItems={mediaItems}
                    playheadPosition={playheadPosition}
                    isPlaying={isPlaying}
                    onTogglePlayback={onTogglePlayback}
                    sourceMedia={sourceMediaItem}
                    sourceTime={current?.time ?? 0}
                    sourceRate={viewerMode !== 'timeline' && shuttle > 0 ? shuttle : 0}
                    sourceWaveform={sourceMediaItem ? waveforms[sourceMediaItem.id] : undefined}
                    onSourceTime={onSourceTime}
                    onSourceEnded={onSourceEnded}
                    scrubDuration={scrub.duration}
                    scrubTime={scrub.time}
                    scrubMarks={scrub.marks}
                    scrubSegments={viewerMode === 'tape' ? tape : undefined}
                    onScrub={onScrub}
                    onShuttle={(key) => commandsRef.current.shuttle(key)}
                    onJumpEdit={(direction) => commandsRef.current.jumpEdit(direction)}
                    onMarkIn={() => commandsRef.current.markIn()}
                    onMarkOut={() => commandsRef.current.markOut()}
                    onClearMarks={() => commandsRef.current.clearMarks('both')}
                    onFastReview={() => commandsRef.current.fastReview()}
                    fastReviewRate={fastReviewRate(reviewLength)}
                />
            </div>

            <div className="cutp-divider" onMouseDown={startResize} title="Ziehen: Höhe der Timelines" data-automation-id="cut-timeline-resize" />

            <div className="cutp-tlbar" role="toolbar" aria-label="Timeline-Werkzeuge">
                <button type="button" className="cutp-btn" onClick={() => commandsRef.current.blade()} title="Am Playhead schneiden (Cmd+B)" data-automation-id="cut-blade"><BladeIcon />Schneiden</button>
                <span className="cutp-sep" />
                <TrimToolIcon className="w-4 h-4 cutp-dim" />
                <div className="cutp-seg" role="tablist" aria-label="Trimm-Werkzeug">
                    {TOOLS.map((entry) => (
                        <button key={entry.mode} type="button" role="tab" aria-selected={trimMode === entry.mode} className={`cutp-btn ${trimMode === entry.mode ? 'cutp-btn--on' : ''}`} onClick={() => onTrimModeChange(entry.mode)} title={`${entry.hint} (${entry.key})`} data-automation-id={`cut-tool-${entry.mode}`}>
                            {entry.label}
                        </button>
                    ))}
                </div>
                <span className="cutp-sep" />
                <div className="cutp-seg" role="group" aria-label="Übergänge">
                    <button type="button" className="cutp-btn cutp-btn--icon" onClick={() => commandsRef.current.quickTransition('cut')} title="Harter Schnitt (Übergang entfernen)" data-automation-id="cut-transition-cut"><HardCutIcon /></button>
                    <button type="button" className="cutp-btn cutp-btn--icon" onClick={() => commandsRef.current.quickTransition('dissolve')} title="Überblendung 1 s (\\)" data-automation-id="cut-transition-dissolve"><DissolveIcon /></button>
                    <button type="button" className="cutp-btn cutp-btn--icon" onClick={() => commandsRef.current.quickTransition('smooth')} title="Weicher Schnitt (4 Frames)" data-automation-id="cut-transition-smooth"><SmoothCutIcon /></button>
                </div>
                <span className="cutp-sep" />
                <span className="cutp-hint" data-automation-id="cut-trim-hint">
                    {ui.trimTarget ? `${TOOL_LABEL[tool]} · , . = ±1 Frame · Shift = ±${ui.multiFrame} · Esc beendet` : 'Schnitt anklicken zum Trimmen · Mitte = Rollen'}
                </span>
                <span className="cutp-spacer" />
                <span className="cutp-tc cutp-tc--dim" title="Timeline In / Out">
                    {ui.timelineIn !== null ? formatTimecode(ui.timelineIn) : '--'} / {ui.timelineOut !== null ? formatTimecode(ui.timelineOut) : '--'}
                </span>
                <button type="button" className="cutp-btn cutp-btn--icon" onClick={() => commandsRef.current.setZoom(ui.detailZoom / 1.5)} title="Herauszoomen" data-automation-id="cut-zoom-out"><ZoomOut className="w-4 h-4" /></button>
                <input className="cutp-zoom" type="range" min={Math.log(DETAIL_ZOOM_MIN)} max={Math.log(DETAIL_ZOOM_MAX)} step={0.01} value={Math.log(ui.detailZoom)} onChange={(event) => commandsRef.current.setZoom(Math.exp(Number(event.target.value)))} aria-label="Zoom der Detail-Timeline" data-automation-id="cut-zoom" />
                <button type="button" className="cutp-btn cutp-btn--icon" onClick={() => commandsRef.current.setZoom(ui.detailZoom * 1.5)} title="Hineinzoomen" data-automation-id="cut-zoom-in"><ZoomIn className="w-4 h-4" /></button>
            </div>

            <CutTimeline
                clips={shownClips}
                tracks={timelineTracks}
                mediaItems={mediaItems}
                posters={posters}
                waveforms={waveforms}
                playhead={playheadPosition}
                selectedClipId={selectedClipId}
                activeTrackId={activeTrackId}
                trimTarget={ui.trimTarget}
                trimTool={tool}
                timelineIn={ui.timelineIn}
                timelineOut={ui.timelineOut}
                zoom={ui.detailZoom}
                height={ui.timelineHeight}
                onZoom={(zoom) => commandsRef.current.setZoom(zoom)}
                onSeek={(time) => { setShuttle(0); onPlayheadUpdate(Math.max(0, Math.min(Math.max(duration, 0), time))); }}
                onSelectClip={onSelectClip}
                onSetActiveTrack={onSetActiveTrack}
                onTrimTarget={(target) => commandsRef.current.selectTrim(target)}
                onTrimDrag={onTrimDrag}
                onDropMedia={onDropMedia}
            />
            {/* Edit points of the target track, for agents and screen readers. */}
            <span className="sr-only" data-automation-id="cut-edit-points">{editPoints(timelineClips, activeTrackId).map((time) => time.toFixed(3)).join(' ')}</span>
        </div>
    );
};

export default TrimWorkspace;
