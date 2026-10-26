/**
 * Pure editing logic for the Cut page: smart edit buttons (smart insert,
 * append, ripple overwrite, close up, place on top, source overwrite), the
 * trim operations (ripple, roll, slip, slide, plain edge trim), blade, quick
 * transitions, fast review, shuttle (J/K/L) and the source tape.
 *
 * No React / DOM. Every function returns new arrays and never mutates its
 * inputs. Clip shapes stay compatible with `TimelineClip` / `TimelineTrack`
 * (start/end are sequence seconds, sourceIn/sourceOut are media seconds,
 * `speed` maps one onto the other), so results can be handed straight to
 * `onBatchUpdateClips` and to the MCP tools.
 */

export type CutClip = {
    id: string;
    mediaId: string;
    trackId: string;
    start: number;
    end: number;
    duration?: number;
    speed?: number;
    sourceIn?: number;
    sourceOut?: number;
    transform?: { scale: number; opacity: number; position: { x: number; y: number }; rotation?: number };
    transitionOut?: { type: string; duration: number };
    keyframes?: Array<{ id: string; time: number }>;
};

export type CutTrack = { id: string; type: 'video' | 'audio'; isLocked: boolean; isTargeted?: boolean };

/** What the source viewer hands to an edit button: one media item with marked In/Out (media seconds). */
export type EditSource = { mediaId: string; sourceIn: number; sourceOut: number; mediaType: 'video' | 'image' | 'audio' };

/** Media length lookup in seconds. Return Infinity for stills (they can be stretched freely). */
export type MediaLength = (mediaId: string) => number;

export type EditFailure = {
    ok: false;
    reason: 'no-track' | 'needs-track' | 'no-clip' | 'invalid';
    message: string;
    needsTrack?: 'video' | 'audio';
};
export type EditSuccess<T> = { ok: true; clips: T[]; selectId: string | null; playhead?: number; trackId?: string };
export type EditResult<T> = EditSuccess<T> | EditFailure;

/** Type guard (works without strictNullChecks, where `!result.ok` does not narrow). */
export const isEditFailure = <T>(result: EditResult<T>): result is EditFailure => result.ok === false;

/** Result of a trim: the new clips plus the delta (sequence seconds) that was actually applied after clamping. */
export type TrimResult<T> = { clips: T[]; applied: number };

export const EPS = 1e-6;
export const MIN_CLIP_LENGTH = 0.05;
export const CLOSE_UP_SCALE = 1.3;

/* ─── Basic accessors ─── */

export const speedOf = (clip: CutClip) => Math.max(0.05, clip.speed || 1);
export const sourceInOf = (clip: CutClip) => Math.max(0, clip.sourceIn ?? 0);
export const sourceOutOf = (clip: CutClip) => clip.sourceOut ?? (sourceInOf(clip) + (clip.end - clip.start) * speedOf(clip));
export const lengthOf = (clip: CutClip) => Math.max(0, clip.end - clip.start);
export const sourceLength = (source: EditSource) => Math.max(MIN_CLIP_LENGTH, source.sourceOut - source.sourceIn);

const clamp = (value: number, min: number, max: number) => (min > max ? min : Math.max(min, Math.min(max, value)));
const safeLength = (lookup: MediaLength, mediaId: string) => {
    const value = lookup(mediaId);
    return Number.isFinite(value) || value === Number.POSITIVE_INFINITY ? Math.max(MIN_CLIP_LENGTH, value) : Number.POSITIVE_INFINITY;
};

/** Rounds a time to the nearest frame. */
export const snapToFrame = (time: number, fps = 24) => Math.round(time * fps) / fps;

export const sequenceEnd = (clips: CutClip[]) => clips.reduce((max, clip) => Math.max(max, clip.end), 0);

const byStart = <T extends CutClip>(a: T, b: T) => a.start - b.start || a.id.localeCompare(b.id);

export const clipsOnTrack = <T extends CutClip>(clips: T[], trackId: string) => clips.filter((clip) => clip.trackId === trackId).sort(byStart);

/** Every cut on a track (or all tracks): clip starts and ends, plus 0. Sorted, de-duplicated. */
export function editPoints(clips: CutClip[], trackId?: string | null): number[] {
    const points = [0];
    clips.forEach((clip) => {
        if (trackId && clip.trackId !== trackId) return;
        points.push(clip.start, clip.end);
    });
    points.sort((a, b) => a - b);
    return points.filter((value, index) => index === 0 || value - points[index - 1] > EPS);
}

/** The edit point closest to `time` (ties go to the earlier point). */
export function nearestEditPoint(clips: CutClip[], trackId: string | null, time: number): number {
    const points = editPoints(clips, trackId);
    let best = points[0];
    points.forEach((point) => { if (Math.abs(point - time) < Math.abs(best - time) - EPS) best = point; });
    return best;
}

/** Previous / next edit point strictly before / after `time` (across all tracks when trackId is null). */
export function adjacentEdit(clips: CutClip[], trackId: string | null, time: number, direction: -1 | 1): number | null {
    const points = editPoints(clips, trackId);
    if (direction < 0) return [...points].reverse().find((point) => point < time - EPS) ?? null;
    return points.find((point) => point > time + EPS) ?? null;
}

export type EditPointHit<T extends CutClip> = { time: number; trackId: string; outgoing: T | null; incoming: T | null };

/** Finds the cut on `trackId` within `tolerance` seconds of `time`: outgoing clip ends there, incoming starts there. */
export function findEditPoint<T extends CutClip>(clips: T[], trackId: string, time: number, tolerance: number): EditPointHit<T> | null {
    const track = clipsOnTrack(clips, trackId);
    let best: EditPointHit<T> | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const consider = (point: number) => {
        const distance = Math.abs(point - time);
        if (distance > tolerance + EPS || distance >= bestDistance) return;
        const outgoing = track.find((clip) => Math.abs(clip.end - point) < 1e-3) || null;
        const incoming = track.find((clip) => Math.abs(clip.start - point) < 1e-3) || null;
        if (!outgoing && !incoming) return;
        bestDistance = distance;
        best = { time: point, trackId, outgoing, incoming };
    };
    track.forEach((clip) => { consider(clip.start); consider(clip.end); });
    return best;
}

/** The directly adjacent clips (touching within 1 ms) and the nearest clips either side on the same track. */
export function neighbours<T extends CutClip>(clips: T[], clip: CutClip) {
    const track = clipsOnTrack(clips, clip.trackId).filter((entry) => entry.id !== clip.id);
    const before = [...track].reverse().find((entry) => entry.end <= clip.start + 1e-3) || null;
    const after = track.find((entry) => entry.start >= clip.end - 1e-3) || null;
    return {
        before,
        after,
        adjacentBefore: before && Math.abs(before.end - clip.start) < 1e-3 ? before : null,
        adjacentAfter: after && Math.abs(after.start - clip.end) < 1e-3 ? after : null,
    };
}

/** Top-most clip under the playhead on a track (or any visual track when trackId is null). */
export function clipAt<T extends CutClip>(clips: T[], trackId: string | null, time: number): T | null {
    return clips.find((clip) => (!trackId || clip.trackId === trackId) && time >= clip.start - EPS && time < clip.end - EPS) || null;
}

export function isRangeFree(clips: CutClip[], trackId: string, start: number, end: number, ignoreIds: string[] = []): boolean {
    return !clips.some((clip) => clip.trackId === trackId && !ignoreIds.includes(clip.id) && clip.start < end - 1e-4 && clip.end > start + 1e-4);
}

/* ─── Track targeting ─── */

/** Destination track for a source: the active track when it fits, else the targeted one, else the first unlocked one of that type. */
export function pickTargetTrack(tracks: CutTrack[], mediaType: EditSource['mediaType'], activeTrackId: string | null): CutTrack | null {
    const type = mediaType === 'audio' ? 'audio' : 'video';
    const candidates = tracks.filter((track) => track.type === type && !track.isLocked);
    return candidates.find((track) => track.id === activeTrackId)
        || candidates.find((track) => track.isTargeted)
        || candidates[0]
        || null;
}

/** First unlocked video track above `baseTrackId` (array order = stacking order) that is free over [start, end]. */
export function freeTrackAbove(clips: CutClip[], tracks: CutTrack[], baseTrackId: string | null, start: number, end: number): CutTrack | null {
    const video = tracks.filter((track) => track.type === 'video');
    const baseIndex = baseTrackId ? video.findIndex((track) => track.id === baseTrackId) : -1;
    return video.slice(baseIndex + 1).find((track) => !track.isLocked && isRangeFree(clips, track.id, start, end)) || null;
}

/* ─── Clip construction ─── */

export function createClip<T extends CutClip>(source: EditSource, trackId: string, start: number, id: string): T {
    const length = sourceLength(source);
    const clip = {
        id,
        mediaId: source.mediaId,
        trackId,
        start,
        end: start + length,
        duration: length,
        speed: 1,
        sourceIn: source.sourceIn,
        sourceOut: source.sourceIn + length,
        effect: null,
    };
    return clip as unknown as T;
}

const shiftKeyframes = <T extends CutClip>(clip: T, sourceOffset: number): T => {
    if (!clip.keyframes || Math.abs(sourceOffset) < EPS) return clip;
    return { ...clip, keyframes: clip.keyframes.map((frame) => ({ ...frame, time: frame.time - sourceOffset })).filter((frame) => frame.time >= -EPS) };
};

/** Splits a clip at sequence time `at`. Null when `at` is not strictly inside. Keyframes follow their half. */
export function splitClip<T extends CutClip>(clip: T, at: number, rightId: string): [T, T] | null {
    if (!(at > clip.start + EPS && at < clip.end - EPS)) return null;
    const speed = speedOf(clip);
    const sIn = sourceInOf(clip);
    const sOut = sourceOutOf(clip);
    const offset = (at - clip.start) * speed;
    const sourceAt = sIn + offset;
    const left: T = { ...clip, end: at, sourceIn: sIn, sourceOut: sourceAt, duration: sourceAt - sIn };
    const right: T = { ...clip, id: rightId, start: at, sourceIn: sourceAt, sourceOut: sOut, duration: sOut - sourceAt };
    delete (left as CutClip).transitionOut;
    if (clip.keyframes) {
        left.keyframes = clip.keyframes.filter((frame) => frame.time <= offset + EPS);
        right.keyframes = clip.keyframes.filter((frame) => frame.time >= offset - EPS).map((frame) => ({ ...frame, id: `${frame.id}-r`, time: Math.max(0, frame.time - offset) }));
    }
    return [left, right];
}

/** Restricts a clip to the sequence range [from, to] (subset of its span). */
export function cropClip<T extends CutClip>(clip: T, from: number, to: number): T {
    const speed = speedOf(clip);
    const head = Math.max(0, from - clip.start);
    const sIn = sourceInOf(clip) + head * speed;
    const sOut = sIn + (to - from) * speed;
    return shiftKeyframes({ ...clip, start: from, end: to, sourceIn: sIn, sourceOut: sOut, duration: sOut - sIn }, head * speed);
}

/** Clears [start, end) on a track (overwrite semantics): overlapping clips are cropped, split or removed. */
export function carveRange<T extends CutClip>(clips: T[], trackId: string, start: number, end: number, makeId: () => string): T[] {
    const out: T[] = [];
    clips.forEach((clip) => {
        if (clip.trackId !== trackId || clip.end <= start + EPS || clip.start >= end - EPS) { out.push(clip); return; }
        if (clip.start < start - EPS) out.push(cropClip(clip, clip.start, start));
        if (clip.end > end + EPS) out.push(cropClip({ ...clip, id: clip.start < start - EPS ? makeId() : clip.id }, end, clip.end));
    });
    return out;
}

/**
 * Opens a gap of `delta` seconds at `at` on every unlocked track in `trackIds`:
 * clips starting at/after `at` move right, clips spanning `at` are split and their
 * tail moves (keeps the tracks in sync).
 */
function openGap<T extends CutClip>(clips: T[], trackIds: Set<string>, at: number, delta: number, makeId: () => string): T[] {
    const out: T[] = [];
    clips.forEach((clip) => {
        if (!trackIds.has(clip.trackId)) { out.push(clip); return; }
        if (clip.start >= at - EPS) { out.push({ ...clip, start: clip.start + delta, end: clip.end + delta }); return; }
        if (clip.end > at + EPS) {
            const parts = splitClip(clip, at, makeId());
            if (parts) { out.push(parts[0], { ...parts[1], start: parts[1].start + delta, end: parts[1].end + delta }); return; }
        }
        out.push(clip);
    });
    return out;
}

const unlockedIds = (tracks: CutTrack[]) => new Set(tracks.filter((track) => !track.isLocked).map((track) => track.id));

const checkTrack = (tracks: CutTrack[], trackId: string | null, source: EditSource): EditFailure | CutTrack => {
    const track = trackId ? tracks.find((entry) => entry.id === trackId) : null;
    if (!track || track.isLocked) return { ok: false, reason: 'no-track', message: 'Keine freigeschaltete Zielspur.' };
    if ((source.mediaType === 'audio') !== (track.type === 'audio')) return { ok: false, reason: 'no-track', message: 'Die Zielspur passt nicht zum Medientyp.' };
    return track;
};

const validSource = (source: EditSource | null): source is EditSource =>
    Boolean(source && source.mediaId && Number.isFinite(source.sourceIn) && Number.isFinite(source.sourceOut) && source.sourceOut > source.sourceIn + EPS);

const invalidSource: EditFailure = { ok: false, reason: 'invalid', message: 'Keine gültige Quelle (In/Out prüfen).' };

/* ─── Smart edit buttons ─── */

/** Inserts the source at exactly `at`, rippling every unlocked track. */
export function insertAt<T extends CutClip>(clips: T[], tracks: CutTrack[], trackId: string, source: EditSource, at: number, makeId: () => string): EditResult<T> {
    if (!validSource(source)) return invalidSource;
    const track = checkTrack(tracks, trackId, source);
    if ('ok' in track) return track;
    const start = Math.max(0, at);
    const length = sourceLength(source);
    const shifted = openGap(clips, unlockedIds(tracks), start, length, makeId);
    const clip = createClip<T>(source, track.id, start, makeId());
    return { ok: true, clips: [...shifted, clip], selectId: clip.id, playhead: start + length, trackId: track.id };
}

/** Smart Insert: inserts at the edit point nearest the playhead on the target track, so no clip is cut in two. */
export function smartInsert<T extends CutClip>(clips: T[], tracks: CutTrack[], trackId: string, source: EditSource, playhead: number, makeId: () => string): EditResult<T> {
    const at = nearestEditPoint(clips, trackId, playhead);
    return insertAt(clips, tracks, trackId, source, at, makeId);
}

/** Append: puts the source after the last clip of the whole sequence. */
export function appendToEnd<T extends CutClip>(clips: T[], tracks: CutTrack[], trackId: string, source: EditSource, makeId: () => string): EditResult<T> {
    if (!validSource(source)) return invalidSource;
    const track = checkTrack(tracks, trackId, source);
    if ('ok' in track) return track;
    const start = sequenceEnd(clips);
    const clip = createClip<T>(source, track.id, start, makeId());
    return { ok: true, clips: [...clips, clip], selectId: clip.id, playhead: start + sourceLength(source), trackId: track.id };
}

/**
 * Ripple Overwrite: replaces the clip under the playhead on the target track with
 * the source and ripples everything after it by the length difference.
 */
export function rippleOverwrite<T extends CutClip>(clips: T[], tracks: CutTrack[], trackId: string, source: EditSource, playhead: number, makeId: () => string): EditResult<T> {
    if (!validSource(source)) return invalidSource;
    const track = checkTrack(tracks, trackId, source);
    if ('ok' in track) return track;
    const target = clipAt(clips, track.id, playhead);
    if (!target) return { ok: false, reason: 'no-clip', message: 'Unter dem Playhead liegt auf der Zielspur kein Clip.' };
    const length = sourceLength(source);
    const delta = length - lengthOf(target);
    const unlocked = unlockedIds(tracks);
    const oldEnd = target.end;
    const clip = createClip<T>(source, track.id, target.start, makeId());
    const rest = clips.filter((entry) => entry.id !== target.id).map((entry) => {
        if (!unlocked.has(entry.trackId) || entry.start < oldEnd - 1e-3) return entry;
        return { ...entry, start: entry.start + delta, end: entry.end + delta };
    });
    return { ok: true, clips: [...rest, clip], selectId: clip.id, playhead: target.start + length, trackId: track.id };
}

/**
 * Close Up: duplicates the clip under the playhead (from the playhead to its end, or
 * the given range) onto the next free video track above, punched in by `scale`.
 */
export function closeUp<T extends CutClip>(
    clips: T[], tracks: CutTrack[], baseTrackId: string | null, playhead: number, makeId: () => string,
    options: { scale?: number; range?: { start: number; end: number } | null } = {},
): EditResult<T> {
    const video = tracks.filter((track) => track.type === 'video');
    const visual = clips.filter((clip) => video.some((track) => track.id === clip.trackId));
    const topMost = [...video].reverse().map((track) => clipAt(visual, track.id, playhead)).find(Boolean) || null;
    const base = (baseTrackId ? clipAt(visual, baseTrackId, playhead) : null) || topMost;
    if (!base) return { ok: false, reason: 'no-clip', message: 'Unter dem Playhead liegt kein Videoclip.' };
    const from = Math.max(base.start, options.range ? options.range.start : playhead);
    const to = Math.min(base.end, options.range ? options.range.end : base.end);
    if (to - from < MIN_CLIP_LENGTH) return { ok: false, reason: 'invalid', message: 'Der Bereich für die Nahaufnahme ist zu kurz.' };
    const target = freeTrackAbove(clips, tracks, base.trackId, from, to);
    if (!target) return { ok: false, reason: 'needs-track', needsTrack: 'video', message: 'Keine freie Videospur darüber.' };
    const scale = options.scale ?? CLOSE_UP_SCALE;
    const copy = cropClip({ ...base, id: makeId(), trackId: target.id }, from, to);
    delete (copy as CutClip).transitionOut;
    const transform = base.transform || { scale: 1, opacity: 1, position: { x: 0, y: 0 } };
    const clip = { ...copy, transform: { ...transform, position: { ...transform.position }, scale: transform.scale * scale } } as T;
    return { ok: true, clips: [...clips, clip], selectId: clip.id, playhead: from, trackId: target.id };
}

/** Place on Top: puts the source at the playhead on the first free video track above everything there. */
export function placeOnTop<T extends CutClip>(clips: T[], tracks: CutTrack[], source: EditSource, playhead: number, makeId: () => string): EditResult<T> {
    if (!validSource(source)) return invalidSource;
    if (source.mediaType === 'audio') {
        const audio = tracks.filter((track) => track.type === 'audio' && !track.isLocked);
        const start = Math.max(0, playhead);
        const free = audio.find((track) => isRangeFree(clips, track.id, start, start + sourceLength(source)));
        if (!free) return { ok: false, reason: 'needs-track', needsTrack: 'audio', message: 'Keine freie Audiospur.' };
        const clip = createClip<T>(source, free.id, start, makeId());
        return { ok: true, clips: [...clips, clip], selectId: clip.id, playhead: start, trackId: free.id };
    }
    const start = Math.max(0, playhead);
    const end = start + sourceLength(source);
    const video = tracks.filter((track) => track.type === 'video');
    let topIndex = -1;
    video.forEach((track, index) => { if (!isRangeFree(clips, track.id, start, end)) topIndex = index; });
    const target = video.slice(topIndex + 1).find((track) => !track.isLocked && isRangeFree(clips, track.id, start, end)) || null;
    if (!target) return { ok: false, reason: 'needs-track', needsTrack: 'video', message: 'Keine freie Videospur darüber.' };
    const clip = createClip<T>(source, target.id, start, makeId());
    return { ok: true, clips: [...clips, clip], selectId: clip.id, playhead: start, trackId: target.id };
}

/**
 * Source Overwrite: lays the source onto the next free track above the target so the
 * source frame under the source playhead lines up with the timeline playhead
 * (sync by position; media without timecode).
 */
export function sourceOverwrite<T extends CutClip>(
    clips: T[], tracks: CutTrack[], baseTrackId: string | null, source: EditSource, sourcePlayhead: number, playhead: number, makeId: () => string,
): EditResult<T> {
    if (!validSource(source)) return invalidSource;
    const anchor = clamp(sourcePlayhead, source.sourceIn, source.sourceOut);
    let start = playhead - (anchor - source.sourceIn);
    let sIn = source.sourceIn;
    if (start < 0) { sIn -= start; start = 0; }
    const trimmed: EditSource = { ...source, sourceIn: sIn };
    if (!validSource(trimmed)) return invalidSource;
    const end = start + sourceLength(trimmed);
    if (source.mediaType === 'audio') return placeOnTop(clips, tracks, trimmed, start, makeId);
    const target = freeTrackAbove(clips, tracks, baseTrackId, start, end);
    if (!target) return { ok: false, reason: 'needs-track', needsTrack: 'video', message: 'Keine freie Videospur darüber.' };
    const clip = createClip<T>(trimmed, target.id, start, makeId());
    return { ok: true, clips: [...clips, clip], selectId: clip.id, playhead, trackId: target.id };
}

/** Blade: cuts every clip under `at` on the given (unlocked) tracks. */
export function bladeAt<T extends CutClip>(clips: T[], tracks: CutTrack[], at: number, makeId: () => string, trackIds?: string[] | null): { clips: T[]; cut: number } {
    const allowed = new Set(tracks.filter((track) => !track.isLocked && (!trackIds || trackIds.length === 0 || trackIds.includes(track.id))).map((track) => track.id));
    let cut = 0;
    const out: T[] = [];
    clips.forEach((clip) => {
        const parts = allowed.has(clip.trackId) ? splitClip(clip, at, makeId()) : null;
        if (parts) { cut += 1; out.push(parts[0], parts[1]); } else out.push(clip);
    });
    return { clips: out, cut };
}

/* ─── Trims (all deltas in sequence seconds; results are clamped to media length and neighbours) ─── */

/** Head handle in sequence seconds; stills (infinite media length) can always grow at the head. */
const headRoom = (clip: CutClip, lookup: MediaLength) => (safeLength(lookup, clip.mediaId) === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : sourceInOf(clip) / speedOf(clip));

const replace = <T extends CutClip>(clips: T[], updates: Map<string, T>) => clips.map((clip) => updates.get(clip.id) || clip);

const shiftTrackAfter = <T extends CutClip>(clips: T[], trackId: string, from: number, delta: number, skip: Set<string>) =>
    clips.map((clip) => (clip.trackId !== trackId || skip.has(clip.id) || clip.start < from - 1e-3 ? clip : { ...clip, start: clip.start + delta, end: clip.end + delta }));

/** Ripple trim of a clip's out point: the clip gets longer/shorter, later clips on its track follow. */
export function rippleTrimOut<T extends CutClip>(clips: T[], clipId: string, delta: number, mediaLength: MediaLength, minLength = MIN_CLIP_LENGTH): TrimResult<T> {
    const clip = clips.find((entry) => entry.id === clipId);
    if (!clip) return { clips, applied: 0 };
    const speed = speedOf(clip);
    const sOut = sourceOutOf(clip);
    const limit = safeLength(mediaLength, clip.mediaId);
    const applied = clamp(delta, -(lengthOf(clip) - minLength), (limit - sOut) / speed);
    if (Math.abs(applied) < EPS) return { clips, applied: 0 };
    const nextSourceOut = sOut + applied * speed;
    const updated: T = { ...clip, end: clip.end + applied, sourceOut: nextSourceOut, duration: nextSourceOut - sourceInOf(clip) };
    const shifted = shiftTrackAfter(clips, clip.trackId, clip.end, applied, new Set([clip.id]));
    return { clips: replace(shifted, new Map([[clip.id, updated]])), applied };
}

/** Ripple trim of a clip's in point: the clip keeps its start, shows later/earlier frames, later clips follow. */
export function rippleTrimIn<T extends CutClip>(clips: T[], clipId: string, delta: number, mediaLength: MediaLength, minLength = MIN_CLIP_LENGTH): TrimResult<T> {
    const clip = clips.find((entry) => entry.id === clipId);
    if (!clip) return { clips, applied: 0 };
    const speed = speedOf(clip);
    const sIn = sourceInOf(clip);
    const applied = clamp(delta, -headRoom(clip, mediaLength), lengthOf(clip) - minLength);
    if (Math.abs(applied) < EPS) return { clips, applied: 0 };
    const nextSourceIn = Math.max(0, sIn + applied * speed);
    const updated: T = shiftKeyframes({ ...clip, end: clip.end - applied, sourceIn: nextSourceIn, duration: sourceOutOf(clip) - nextSourceIn }, applied * speed);
    const shifted = shiftTrackAfter(clips, clip.trackId, clip.end, -applied, new Set([clip.id]));
    return { clips: replace(shifted, new Map([[clip.id, updated]])), applied };
}

/** Plain trim of one edge: neighbours stay where they are, so the edge stops at the next clip / previous clip / zero. */
export function trimEdge<T extends CutClip>(clips: T[], clipId: string, edge: 'in' | 'out', delta: number, mediaLength: MediaLength, minLength = MIN_CLIP_LENGTH): TrimResult<T> {
    const clip = clips.find((entry) => entry.id === clipId);
    if (!clip) return { clips, applied: 0 };
    const speed = speedOf(clip);
    const { before, after } = neighbours(clips, clip);
    if (edge === 'out') {
        const sOut = sourceOutOf(clip);
        const roomRight = after ? after.start - clip.end : Number.POSITIVE_INFINITY;
        const applied = clamp(delta, -(lengthOf(clip) - minLength), Math.min(roomRight, (safeLength(mediaLength, clip.mediaId) - sOut) / speed));
        if (Math.abs(applied) < EPS) return { clips, applied: 0 };
        const nextOut = sOut + applied * speed;
        return { clips: replace(clips, new Map([[clip.id, { ...clip, end: clip.end + applied, sourceOut: nextOut, duration: nextOut - sourceInOf(clip) }]])), applied };
    }
    const sIn = sourceInOf(clip);
    const roomLeft = clip.start - (before ? before.end : 0);
    const applied = clamp(delta, -Math.min(roomLeft, headRoom(clip, mediaLength)), lengthOf(clip) - minLength);
    if (Math.abs(applied) < EPS) return { clips, applied: 0 };
    const nextIn = Math.max(0, sIn + applied * speed);
    const updated = shiftKeyframes({ ...clip, start: clip.start + applied, sourceIn: nextIn, duration: sourceOutOf(clip) - nextIn }, applied * speed);
    return { clips: replace(clips, new Map([[clip.id, updated]])), applied };
}

/** Roll: moves the cut between outgoing and incoming; the total length stays the same. */
export function rollEdit<T extends CutClip>(clips: T[], outgoingId: string | null, incomingId: string | null, delta: number, mediaLength: MediaLength, minLength = MIN_CLIP_LENGTH): TrimResult<T> {
    const outgoing = outgoingId ? clips.find((entry) => entry.id === outgoingId) || null : null;
    const incoming = incomingId ? clips.find((entry) => entry.id === incomingId) || null : null;
    if (!outgoing && !incoming) return { clips, applied: 0 };
    if (!outgoing) return trimEdge(clips, incoming!.id, 'in', delta, mediaLength, minLength);
    if (!incoming) return trimEdge(clips, outgoing.id, 'out', delta, mediaLength, minLength);
    const sA = speedOf(outgoing);
    const sB = speedOf(incoming);
    const outA = sourceOutOf(outgoing);
    const inB = sourceInOf(incoming);
    const min = Math.max(-(lengthOf(outgoing) - minLength), -headRoom(incoming, mediaLength));
    const max = Math.min((safeLength(mediaLength, outgoing.mediaId) - outA) / sA, lengthOf(incoming) - minLength);
    const applied = clamp(delta, min, max);
    if (Math.abs(applied) < EPS) return { clips, applied: 0 };
    const nextOutA = outA + applied * sA;
    const nextInB = Math.max(0, inB + applied * sB);
    const updates = new Map<string, T>([
        [outgoing.id, { ...outgoing, end: outgoing.end + applied, sourceOut: nextOutA, duration: nextOutA - sourceInOf(outgoing) }],
        [incoming.id, shiftKeyframes({ ...incoming, start: incoming.start + applied, sourceIn: nextInB, duration: sourceOutOf(incoming) - nextInB }, applied * sB)],
    ]);
    return { clips: replace(clips, updates), applied };
}

/** Slip: same place and length in the sequence, different frames. Positive delta shows later frames. */
export function slipClip<T extends CutClip>(clips: T[], clipId: string, delta: number, mediaLength: MediaLength): TrimResult<T> {
    const clip = clips.find((entry) => entry.id === clipId);
    if (!clip) return { clips, applied: 0 };
    const speed = speedOf(clip);
    const sIn = sourceInOf(clip);
    const sOut = sourceOutOf(clip);
    const applied = clamp(delta, -sIn / speed, (safeLength(mediaLength, clip.mediaId) - sOut) / speed);
    if (Math.abs(applied) < EPS) return { clips, applied: 0 };
    const updated = { ...clip, sourceIn: sIn + applied * speed, sourceOut: sOut + applied * speed };
    return { clips: replace(clips, new Map([[clip.id, updated]])), applied };
}

/** Slide: moves a clip along the sequence; the touching neighbours absorb the change. */
export function slideClip<T extends CutClip>(clips: T[], clipId: string, delta: number, mediaLength: MediaLength, minLength = MIN_CLIP_LENGTH): TrimResult<T> {
    const clip = clips.find((entry) => entry.id === clipId);
    if (!clip) return { clips, applied: 0 };
    const { before, after, adjacentBefore, adjacentAfter } = neighbours(clips, clip);
    let min = -clip.start;
    let max = Number.POSITIVE_INFINITY;
    if (adjacentBefore) {
        const sP = speedOf(adjacentBefore);
        min = Math.max(min, -(lengthOf(adjacentBefore) - minLength));
        max = Math.min(max, (safeLength(mediaLength, adjacentBefore.mediaId) - sourceOutOf(adjacentBefore)) / sP);
    } else if (before) {
        min = Math.max(min, before.end - clip.start);
    }
    if (adjacentAfter) {
        const sN = speedOf(adjacentAfter);
        max = Math.min(max, lengthOf(adjacentAfter) - minLength);
        min = Math.max(min, -headRoom(adjacentAfter, mediaLength));
        void sN;
    } else if (after) {
        max = Math.min(max, after.start - clip.end);
    }
    const applied = clamp(delta, min, max);
    if (Math.abs(applied) < EPS) return { clips, applied: 0 };
    const updates = new Map<string, T>([[clip.id, { ...clip, start: clip.start + applied, end: clip.end + applied }]]);
    if (adjacentBefore) {
        const nextOut = sourceOutOf(adjacentBefore) + applied * speedOf(adjacentBefore);
        updates.set(adjacentBefore.id, { ...adjacentBefore, end: adjacentBefore.end + applied, sourceOut: nextOut, duration: nextOut - sourceInOf(adjacentBefore) });
    }
    if (adjacentAfter) {
        const sN = speedOf(adjacentAfter);
        const nextIn = Math.max(0, sourceInOf(adjacentAfter) + applied * sN);
        updates.set(adjacentAfter.id, shiftKeyframes({ ...adjacentAfter, start: adjacentAfter.start + applied, sourceIn: nextIn, duration: sourceOutOf(adjacentAfter) - nextIn }, applied * sN));
    }
    return { clips: replace(clips, updates), applied };
}

export type TrimTool = 'normal' | 'ripple' | 'roll' | 'slip' | 'slide';

/** What is selected for trimming: one side of a cut, both sides (roll), or a whole clip (slip / slide). */
export type TrimTarget =
    | { kind: 'edit'; trackId: string; time: number; outgoingId: string | null; incomingId: string | null; side: 'out' | 'in' | 'both' }
    | { kind: 'clip'; clipId: string };

/**
 * Applies the trim tool to the target. Used for keyboard steps (`,` `.`) and for
 * drags (always computed from the clips at drag start, so it never accumulates error).
 */
export function applyTrim<T extends CutClip>(clips: T[], target: TrimTarget, tool: TrimTool, delta: number, mediaLength: MediaLength): TrimResult<T> {
    if (target.kind === 'clip') {
        if (tool === 'slide') return slideClip(clips, target.clipId, delta, mediaLength);
        return slipClip(clips, target.clipId, delta, mediaLength);
    }
    if (tool === 'roll' || target.side === 'both') return rollEdit(clips, target.outgoingId, target.incomingId, delta, mediaLength);
    const ripple = tool === 'ripple';
    if (target.side === 'out' && target.outgoingId) {
        return ripple ? rippleTrimOut(clips, target.outgoingId, delta, mediaLength) : trimEdge(clips, target.outgoingId, 'out', delta, mediaLength);
    }
    if (target.side === 'in' && target.incomingId) {
        return ripple ? rippleTrimIn(clips, target.incomingId, delta, mediaLength) : trimEdge(clips, target.incomingId, 'in', delta, mediaLength);
    }
    return { clips, applied: 0 };
}

/** Follows a trim target to its new position after an edit was applied. */
export function retarget(clips: CutClip[], target: TrimTarget): TrimTarget {
    if (target.kind === 'clip') return target;
    const outgoing = target.outgoingId ? clips.find((clip) => clip.id === target.outgoingId) : null;
    const incoming = target.incomingId ? clips.find((clip) => clip.id === target.incomingId) : null;
    if (target.side === 'in' && incoming) return { ...target, time: incoming.start };
    if (outgoing) return { ...target, time: outgoing.end };
    if (incoming) return { ...target, time: incoming.start };
    return target;
}

/* ─── Quick transitions ─── */

export type QuickTransition = 'cut' | 'dissolve' | 'smooth';

/** Duration of a quick transition, limited to half of the shorter clip. Null means hard cut. */
export function quickTransitionDuration(kind: QuickTransition, outgoingLength: number, incomingLength: number | null, fps = 24): number | null {
    if (kind === 'cut') return null;
    const wanted = kind === 'dissolve' ? 1 : 4 / fps;
    const room = Math.min(outgoingLength, incomingLength ?? outgoingLength) / 2;
    return Math.max(1 / fps, Math.min(wanted, room));
}

/** Sets (or clears with `transition === null`) the out-transition of the outgoing clip. */
export function setTransitionOut<T extends CutClip>(clips: T[], clipId: string, transition: { type: string; duration: number } | null): T[] {
    return clips.map((clip) => {
        if (clip.id !== clipId) return clip;
        if (!transition) { const next = { ...clip }; delete (next as CutClip).transitionOut; return next; }
        return { ...clip, transitionOut: { ...transition } };
    });
}

/* ─── Playback helpers ─── */

/** Fast review speed: short clips play normally, long clips faster so each takes about `target` seconds. */
export function fastReviewRate(length: number, target = 5, maxRate = 16): number {
    if (!Number.isFinite(length) || length <= target) return 1;
    return Math.min(maxRate, Math.round((length / target) * 2) / 2);
}

/** J/K/L shuttle: L plays forward and doubles, J backwards and doubles, K stops. */
export function nextShuttle(current: number, key: 'j' | 'k' | 'l', max = 8): number {
    if (key === 'k') return 0;
    if (key === 'l') return current <= 0 ? 1 : Math.min(max, current * 2);
    return current >= 0 ? -1 : Math.max(-max, current * 2);
}

/* ─── Source tape (all bin clips as one scrubbable tape) ─── */

export type TapeItem = { id: string; type: 'video' | 'image' | 'audio'; duration?: number };
export type TapeSegment = { mediaId: string; tapeStart: number; tapeEnd: number; length: number };

export function buildSourceTape(items: TapeItem[], stillLength = 5): TapeSegment[] {
    let cursor = 0;
    return items.map((item) => {
        const raw = item.type === 'image' ? stillLength : item.duration || stillLength;
        const length = Math.max(MIN_CLIP_LENGTH, Number.isFinite(raw) ? raw : stillLength);
        const segment = { mediaId: item.id, tapeStart: cursor, tapeEnd: cursor + length, length };
        cursor += length;
        return segment;
    });
}

export const tapeLength = (tape: TapeSegment[]) => (tape.length ? tape[tape.length - 1].tapeEnd : 0);

/** Which media and media time sit at tape time `time` (clamped to the tape). */
export function locateTape(tape: TapeSegment[], time: number): { index: number; mediaId: string; offset: number } | null {
    if (tape.length === 0) return null;
    const t = clamp(time, 0, tapeLength(tape));
    let index = tape.findIndex((segment) => t >= segment.tapeStart - EPS && t < segment.tapeEnd - EPS);
    if (index < 0) index = tape.length - 1;
    const segment = tape[index];
    return { index, mediaId: segment.mediaId, offset: clamp(t - segment.tapeStart, 0, segment.length) };
}

/** Tape time of a media item at a media offset (or null when it is not on the tape). */
export function tapeTimeOf(tape: TapeSegment[], mediaId: string, offset = 0): number | null {
    const segment = tape.find((entry) => entry.mediaId === mediaId);
    return segment ? segment.tapeStart + clamp(offset, 0, segment.length) : null;
}

/* ─── Media pool sorting ─── */

export type PoolSort = 'added' | 'name' | 'type' | 'duration';

export function sortMedia<T extends { id: string; name: string; type: string; duration?: number }>(items: T[], sort: PoolSort, descending = false): T[] {
    const indexed = items.map((item, index) => ({ item, index }));
    const compare = (a: { item: T; index: number }, b: { item: T; index: number }) => {
        let result = 0;
        if (sort === 'name') result = a.item.name.localeCompare(b.item.name, undefined, { numeric: true, sensitivity: 'base' });
        else if (sort === 'type') result = a.item.type.localeCompare(b.item.type);
        else if (sort === 'duration') result = (a.item.duration || 0) - (b.item.duration || 0);
        return result || a.index - b.index;
    };
    const sorted = indexed.sort(compare).map((entry) => entry.item);
    return descending ? sorted.reverse() : sorted;
}

/* ─── Timeline geometry ─── */

/** Lower (detail) timeline: the playhead stays fixed in the centre and the sequence scrolls under it. */
export function detailViewport(playhead: number, pixelsPerSecond: number, width: number) {
    const pps = Math.max(1, pixelsPerSecond);
    const half = width / 2 / pps;
    return { startTime: playhead - half, endTime: playhead + half, playheadX: width / 2, timeToX: (time: number) => width / 2 + (time - playhead) * pps };
}

/** Upper (overview) timeline: the whole programme is always fitted to the width. */
export function overviewScale(duration: number, width: number, minDuration = 10) {
    const span = Math.max(minDuration, duration);
    return { pixelsPerSecond: Math.max(0.0001, width / span), span };
}
