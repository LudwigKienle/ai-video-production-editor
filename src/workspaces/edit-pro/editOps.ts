/**
 * Pure sequence editing operations for the pro editor: lift / extract of the
 * program In/Out range, clip splitting, edit-point navigation and per-track
 * height maths. No React / DOM, so everything is unit-testable and can be
 * reused by agents. All functions return new arrays; inputs are never mutated.
 */

export type EditClip = {
    id: string;
    trackId: string;
    start: number;
    end: number;
    duration?: number;
    speed?: number;
    sourceIn?: number;
    sourceOut?: number;
    keyframes?: Array<{ id: string; time: number }>;
};

export type EditTrack = { id: string; type: 'video' | 'audio'; isLocked: boolean; isTargeted?: boolean };

const EPS = 1e-6;

const speedOf = (clip: EditClip) => Math.max(0.05, clip.speed || 1);
const sourceInOf = (clip: EditClip) => clip.sourceIn ?? 0;
const sourceOutOf = (clip: EditClip) => clip.sourceOut ?? (sourceInOf(clip) + (clip.end - clip.start) * speedOf(clip));

/**
 * Splits a clip at sequence time `at`. Returns null when `at` is not strictly
 * inside the clip. The left part keeps the id; the right part gets `rightId`.
 * Keyframes (clip-relative, source-time units) follow their half.
 */
export function splitClipAt<T extends EditClip>(clip: T, at: number, rightId: string): [T, T] | null {
    if (!(at > clip.start + EPS && at < clip.end - EPS)) return null;
    const speed = speedOf(clip);
    const sIn = sourceInOf(clip);
    const sOut = sourceOutOf(clip);
    const sourceAt = sIn + (at - clip.start) * speed;
    const offset = (at - clip.start) * speed;
    const left: T = { ...clip, end: at, sourceIn: sIn, sourceOut: sourceAt, duration: sourceAt - sIn };
    const right: T = { ...clip, id: rightId, start: at, sourceIn: sourceAt, sourceOut: sOut, duration: sOut - sourceAt };
    if (clip.keyframes) {
        left.keyframes = clip.keyframes.filter((frame) => frame.time <= offset + EPS);
        right.keyframes = clip.keyframes
            .filter((frame) => frame.time >= offset - EPS)
            .map((frame) => ({ ...frame, id: `${frame.id}-r`, time: Math.max(0, frame.time - offset) }));
    }
    return [left, right];
}

/** Trims a clip so it only covers [from, to] of the sequence (subset of its own span). */
function cropClip<T extends EditClip>(clip: T, from: number, to: number): T {
    const speed = speedOf(clip);
    const sIn = sourceInOf(clip);
    const headCut = Math.max(0, from - clip.start);
    const newIn = sIn + headCut * speed;
    const newOut = newIn + (to - from) * speed;
    const next: T = { ...clip, start: from, end: to, sourceIn: newIn, sourceOut: newOut, duration: newOut - newIn };
    if (clip.keyframes && headCut > 0) {
        const offset = headCut * speed;
        next.keyframes = clip.keyframes.filter((frame) => frame.time >= offset - EPS).map((frame) => ({ ...frame, time: frame.time - offset }));
    }
    return next;
}

/**
 * Tracks affected by lift / extract: the targeted tracks, or every unlocked
 * track when nothing is targeted. Locked tracks are never touched.
 */
export function rangeEditTracks(tracks: EditTrack[]): string[] {
    const unlocked = tracks.filter((track) => !track.isLocked);
    const targeted = unlocked.filter((track) => track.isTargeted);
    return (targeted.length > 0 ? targeted : unlocked).map((track) => track.id);
}

export type RangeEditResult<T> = { clips: T[]; changed: boolean; removedIds: string[]; addedIds: string[] };

/**
 * Removes [inPoint, outPoint) from the clips on `trackIds`, leaving a gap
 * (Lift). Clips spanning the range are split; fragments shorter than
 * `minLength` are dropped.
 */
export function liftRange<T extends EditClip>(
    clips: T[],
    trackIds: string[],
    inPoint: number,
    outPoint: number,
    options: { makeId: () => string; minLength?: number },
): RangeEditResult<T> {
    const minLength = options.minLength ?? 1 / 48;
    const start = Math.min(inPoint, outPoint);
    const end = Math.max(inPoint, outPoint);
    if (!(end - start > EPS)) return { clips, changed: false, removedIds: [], addedIds: [] };
    const affected = new Set(trackIds);
    const removedIds: string[] = [];
    const addedIds: string[] = [];
    let changed = false;
    const out: T[] = [];
    clips.forEach((clip) => {
        if (!affected.has(clip.trackId) || clip.end <= start + EPS || clip.start >= end - EPS) {
            out.push(clip);
            return;
        }
        changed = true;
        const keepHead = clip.start < start - EPS && start - clip.start >= minLength;
        const keepTail = clip.end > end + EPS && clip.end - end >= minLength;
        if (keepHead) out.push(cropClip(clip, clip.start, start));
        if (keepTail) {
            const tail = cropClip(clip, end, clip.end);
            if (keepHead) {
                const id = options.makeId();
                addedIds.push(id);
                out.push({ ...tail, id, keyframes: tail.keyframes?.map((frame) => ({ ...frame, id: `${frame.id}-r` })) });
            } else {
                out.push(tail);
            }
        }
        if (!keepHead && !keepTail) removedIds.push(clip.id);
    });
    return { clips: changed ? out : clips, changed, removedIds, addedIds };
}

/**
 * Lift plus ripple (Extract): clips on the affected tracks that start at or
 * after `outPoint` move left by the range length, closing the gap.
 */
export function extractRange<T extends EditClip>(
    clips: T[],
    trackIds: string[],
    inPoint: number,
    outPoint: number,
    options: { makeId: () => string; minLength?: number },
): RangeEditResult<T> {
    const start = Math.min(inPoint, outPoint);
    const end = Math.max(inPoint, outPoint);
    const lifted = liftRange(clips, trackIds, start, end, options);
    const length = end - start;
    if (!(length > EPS)) return lifted;
    const affected = new Set(trackIds);
    let shifted = false;
    const next = lifted.clips.map((clip) => {
        if (!affected.has(clip.trackId) || clip.start < end - EPS) return clip;
        shifted = true;
        return { ...clip, start: Math.max(0, clip.start - length), end: Math.max(0, clip.end - length) };
    });
    return { ...lifted, clips: shifted ? next : lifted.clips, changed: lifted.changed || shifted };
}

/** Sorted, de-duplicated cut points (clip starts/ends) on the given tracks (all when omitted), always including 0. */
export function editPoints(clips: EditClip[], trackIds?: string[]): number[] {
    const filter = trackIds && trackIds.length > 0 ? new Set(trackIds) : null;
    const points = new Set<number>([0]);
    clips.forEach((clip) => {
        if (filter && !filter.has(clip.trackId)) return;
        points.add(Number(clip.start.toFixed(4)));
        points.add(Number(clip.end.toFixed(4)));
    });
    return Array.from(points).sort((a, b) => a - b);
}

export function adjacentEditPoint(points: number[], time: number, direction: -1 | 1, tolerance = 1e-4): number | null {
    if (direction < 0) {
        for (let i = points.length - 1; i >= 0; i -= 1) if (points[i] < time - tolerance) return points[i];
        return null;
    }
    return points.find((point) => point > time + tolerance) ?? null;
}

/* ─── Per-track heights ─── */

export const TRACK_HEIGHT_MIN = 28;
export const TRACK_HEIGHT_MAX = 220;
export const TRACK_HEIGHT_STEP = 16;

export const clampTrackHeight = (value: number): number =>
    Math.round(Math.max(TRACK_HEIGHT_MIN, Math.min(TRACK_HEIGHT_MAX, Number.isFinite(value) ? value : TRACK_HEIGHT_MIN)));

/** Height of one track (custom height or the default). */
export const trackHeightOf = (heights: Record<string, number>, trackId: string, fallback: number): number =>
    clampTrackHeight(heights[trackId] ?? fallback);

/** Top offset of each displayed row, plus total height. `gap` is added to every row (row = height + gap). */
export function trackRowLayout(trackIds: string[], heights: Record<string, number>, fallback: number, gap: number): { tops: number[]; rows: number[]; total: number } {
    const tops: number[] = [];
    const rows: number[] = [];
    let y = 0;
    trackIds.forEach((id) => {
        tops.push(y);
        const row = trackHeightOf(heights, id, fallback) + gap;
        rows.push(row);
        y += row;
    });
    return { tops, rows, total: y };
}

/** Index of the displayed row under `y` (px from the top of the tracks area), or -1. */
export function trackIndexAtY(layout: { tops: number[]; rows: number[] }, y: number): number {
    if (!(y >= 0)) return -1;
    for (let i = 0; i < layout.tops.length; i += 1) {
        if (y >= layout.tops[i] && y < layout.tops[i] + layout.rows[i]) return i;
    }
    return -1;
}

/** Grows (+1) or shrinks (-1) every listed track by one step. */
export function stepAllTrackHeights(heights: Record<string, number>, trackIds: string[], fallback: number, direction: -1 | 1): Record<string, number> {
    const next = { ...heights };
    trackIds.forEach((id) => { next[id] = clampTrackHeight(trackHeightOf(heights, id, fallback) + direction * TRACK_HEIGHT_STEP); });
    return next;
}

/* ─── Linked selection ─── */

/**
 * Clips linked to `clip` for linked selection: same media on another track
 * with the same in/out on the sequence (a video clip and its audio).
 */
export function linkedPartners<T extends EditClip & { mediaId: string }>(clips: T[], clip: T, tolerance = 1 / 48): T[] {
    return clips.filter((other) => other.id !== clip.id
        && other.mediaId === clip.mediaId
        && other.trackId !== clip.trackId
        && Math.abs(other.start - clip.start) < tolerance
        && Math.abs(other.end - clip.end) < tolerance);
}

/**
 * Ripple delete: removes a clip and moves the later clips on the same track
 * left by its length (Shift+Delete / Alt+Delete).
 */
export function rippleDeleteClip<T extends EditClip>(clips: T[], clipId: string): T[] {
    const target = clips.find((clip) => clip.id === clipId);
    if (!target) return clips;
    const length = target.end - target.start;
    return clips
        .filter((clip) => clip.id !== clipId)
        .map((clip) => (clip.trackId === target.trackId && clip.start >= target.end - EPS
            ? { ...clip, start: Math.max(0, clip.start - length), end: Math.max(0, clip.end - length) }
            : clip));
}
