/**
 * Serializable UI state of the Cut page plus the pure helpers that turn it
 * into an edit source. Kept free of React so agents and tests can read,
 * validate and replay it.
 */
import type { EditSource, PoolSort, TapeSegment, TrimTarget } from './editOps.ts';
import { locateTape, MIN_CLIP_LENGTH } from './editOps.ts';

export type ViewerMode = 'source' | 'tape' | 'timeline';
export type PoolView = 'thumbs' | 'list';
export type SourceMarks = { in: number | null; out: number | null };

export type CutUiState = {
    viewerMode: ViewerMode;
    poolView: PoolView;
    poolSort: PoolSort;
    poolSortDesc: boolean;
    sourceMediaId: string | null;
    /** Media seconds of the source viewer playhead. */
    sourcePlayhead: number;
    /** Seconds on the source tape. */
    tapeTime: number;
    marks: Record<string, SourceMarks>;
    timelineIn: number | null;
    timelineOut: number | null;
    /** Pixels per second of the lower (detail) timeline. */
    detailZoom: number;
    /** Frames per Shift+, / Shift+. step. */
    multiFrame: number;
    /** Height in px of the dual timeline area. */
    timelineHeight: number;
    trimTarget: TrimTarget | null;
};

export const DEFAULT_CUT_STATE: CutUiState = {
    viewerMode: 'timeline',
    poolView: 'thumbs',
    poolSort: 'added',
    poolSortDesc: false,
    sourceMediaId: null,
    sourcePlayhead: 0,
    tapeTime: 0,
    marks: {},
    timelineIn: null,
    timelineOut: null,
    detailZoom: 80,
    multiFrame: 5,
    timelineHeight: 300,
    trimTarget: null,
};

export const DETAIL_ZOOM_MIN = 8;
export const DETAIL_ZOOM_MAX = 600;
export const TIMELINE_HEIGHT_MIN = 170;
export const TIMELINE_HEIGHT_MAX = 800;

const num = (value: unknown, fallback: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const optNum = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options.includes(value as T) ? (value as T) : fallback);

const parseTrimTarget = (value: unknown): TrimTarget | null => {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    if (raw.kind === 'clip' && typeof raw.clipId === 'string') return { kind: 'clip', clipId: raw.clipId };
    if (raw.kind === 'edit' && typeof raw.trackId === 'string' && typeof raw.time === 'number' && Number.isFinite(raw.time)) {
        const id = (entry: unknown) => (typeof entry === 'string' ? entry : null);
        const outgoingId = id(raw.outgoingId);
        const incomingId = id(raw.incomingId);
        if (!outgoingId && !incomingId) return null;
        return { kind: 'edit', trackId: raw.trackId, time: raw.time, outgoingId, incomingId, side: oneOf(raw.side, ['out', 'in', 'both'] as const, 'both') };
    }
    return null;
};

/** Validates anything (e.g. JSON from localStorage or an agent) into a complete state. Never throws. */
export function parseCutState(input: unknown): CutUiState {
    if (!input || typeof input !== 'object') return { ...DEFAULT_CUT_STATE, marks: {} };
    const raw = input as Record<string, unknown>;
    const marks: Record<string, SourceMarks> = {};
    if (raw.marks && typeof raw.marks === 'object') {
        Object.entries(raw.marks as Record<string, unknown>).slice(0, 500).forEach(([key, entry]) => {
            if (!entry || typeof entry !== 'object') return;
            const mark = entry as Record<string, unknown>;
            const markIn = optNum(mark.in);
            const markOut = optNum(mark.out);
            if (markIn === null && markOut === null) return;
            marks[key] = { in: markIn, out: markOut };
        });
    }
    return {
        viewerMode: oneOf(raw.viewerMode, ['source', 'tape', 'timeline'] as const, DEFAULT_CUT_STATE.viewerMode),
        poolView: oneOf(raw.poolView, ['thumbs', 'list'] as const, DEFAULT_CUT_STATE.poolView),
        poolSort: oneOf(raw.poolSort, ['added', 'name', 'type', 'duration'] as const, DEFAULT_CUT_STATE.poolSort),
        poolSortDesc: raw.poolSortDesc === true,
        sourceMediaId: typeof raw.sourceMediaId === 'string' ? raw.sourceMediaId : null,
        sourcePlayhead: num(raw.sourcePlayhead, 0, 0),
        tapeTime: num(raw.tapeTime, 0, 0),
        marks,
        timelineIn: optNum(raw.timelineIn),
        timelineOut: optNum(raw.timelineOut),
        detailZoom: num(raw.detailZoom, DEFAULT_CUT_STATE.detailZoom, DETAIL_ZOOM_MIN, DETAIL_ZOOM_MAX),
        multiFrame: Math.round(num(raw.multiFrame, DEFAULT_CUT_STATE.multiFrame, 2, 60)),
        timelineHeight: Math.round(num(raw.timelineHeight, DEFAULT_CUT_STATE.timelineHeight, TIMELINE_HEIGHT_MIN, TIMELINE_HEIGHT_MAX)),
        trimTarget: parseTrimTarget(raw.trimTarget),
    };
}

export type SourceMedia = { id: string; type: 'video' | 'image' | 'audio'; duration?: number };

/** Length the source viewer works with: the media duration, or the still length for images. */
export const sourceMediaLength = (media: SourceMedia, stillLength = 5) =>
    Math.max(MIN_CLIP_LENGTH, media.type === 'image' ? (media.duration && media.duration > 0 ? media.duration : stillLength) : (media.duration && media.duration > 0 ? media.duration : stillLength));

/** The media currently shown by the source / tape viewer and its playhead (media seconds). */
export function currentSource(state: CutUiState, media: SourceMedia[], tape: TapeSegment[]): { media: SourceMedia; time: number } | null {
    if (state.viewerMode === 'tape') {
        const hit = locateTape(tape, state.tapeTime);
        const item = hit ? media.find((entry) => entry.id === hit.mediaId) : null;
        return item && hit ? { media: item, time: hit.offset } : null;
    }
    const item = state.sourceMediaId ? media.find((entry) => entry.id === state.sourceMediaId) : null;
    if (!item) return null;
    return { media: item, time: Math.max(0, Math.min(sourceMediaLength(item), state.sourcePlayhead)) };
}

/** Builds the edit source from the marks of a media item (whole media when unmarked). Null when the marks are unusable. */
export function editSourceFor(media: SourceMedia, marks: SourceMarks | undefined, stillLength = 5): EditSource | null {
    const length = sourceMediaLength(media, stillLength);
    const markIn = Math.max(0, Math.min(length, marks?.in ?? 0));
    const markOut = Math.max(0, Math.min(length, marks?.out ?? length));
    if (markOut - markIn < MIN_CLIP_LENGTH) return null;
    return { mediaId: media.id, sourceIn: markIn, sourceOut: markOut, mediaType: media.type };
}

/** Sets an In or Out mark; an In after the Out (or vice versa) clears the other mark, like a tape deck. */
export function setMark(marks: Record<string, SourceMarks>, mediaId: string, which: 'in' | 'out', time: number | null): Record<string, SourceMarks> {
    const current = marks[mediaId] || { in: null, out: null };
    const next: SourceMarks = { ...current, [which]: time === null ? null : Math.max(0, time) };
    if (next.in !== null && next.out !== null && next.out <= next.in) {
        if (which === 'in') next.out = null; else next.in = null;
    }
    const copy = { ...marks };
    if (next.in === null && next.out === null) delete copy[mediaId]; else copy[mediaId] = next;
    return copy;
}
