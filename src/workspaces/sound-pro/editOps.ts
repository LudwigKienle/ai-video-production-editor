/**
 * Clip edits for the sound views, honouring the four edit modes known from
 * DAWs:
 *  - slip:    free placement.
 *  - grid:    positions snap to the grid (seconds).
 *  - spot:    exact placement from a time entered in a dialog (no snapping).
 *  - shuffle: clips on a track stay butted together; moving, trimming and
 *             deleting ripples the following clips on that track.
 *
 * Pure functions on the shared timeline clip list (same shape as the editor).
 * Timing follows the editor: duration = sourceOut − sourceIn, timeline length
 * = duration / speed.
 */

import type { EditMode } from './model.ts';

export type EditClip = {
  id: string;
  mediaId: string;
  trackId: string;
  start: number;
  end: number;
  duration: number;
  speed: number;
  sourceIn?: number;
  sourceOut?: number;
};

export const MIN_CLIP_SEC = 0.04;
const EPS = 1e-6;

export const snapToGrid = (time: number, gridSec: number): number =>
  gridSec > 0 ? Math.round(time / gridSec) * gridSec : time;

const placeTime = (time: number, mode: EditMode, gridSec: number): number =>
  Math.max(0, mode === 'grid' ? snapToGrid(time, gridSec) : time);

const byStart = <T extends EditClip>(a: T, b: T) => a.start - b.start || a.id.localeCompare(b.id);

const shiftClip = <T extends EditClip>(clip: T, delta: number): T => ({ ...clip, start: clip.start + delta, end: clip.end + delta });

/** Lays the given clips (sorted) gaplessly from `from`. */
const packTrack = <T extends EditClip>(clips: T[], from: number): T[] => {
  let cursor = from;
  return clips.map((clip) => {
    const length = clip.end - clip.start;
    const moved = { ...clip, start: cursor, end: cursor + length };
    cursor += length;
    return moved;
  });
};

export const moveClip = <T extends EditClip>(
  clips: T[],
  clipId: string,
  requestedStart: number,
  mode: EditMode,
  gridSec: number,
  targetTrackId?: string,
): T[] => {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip || !Number.isFinite(requestedStart)) return clips;
  const trackId = targetTrackId || clip.trackId;
  const length = clip.end - clip.start;
  if (mode !== 'shuffle') {
    const start = placeTime(requestedStart, mode, gridSec);
    return clips.map((c) => (c.id === clipId ? { ...c, trackId, start, end: start + length } : c));
  }
  // shuffle: remove from the old track (closing the gap), insert into the target track sequence
  const others = clips.filter((c) => c.id !== clipId);
  const oldTrack = others.filter((c) => c.trackId === clip.trackId).sort(byStart);
  let result = others;
  if (clip.trackId !== trackId) {
    const rippled = new Map(oldTrack.filter((c) => c.start > clip.start).map((c) => [c.id, shiftClip(c, -length)]));
    result = result.map((c) => rippled.get(c.id) ?? c);
  }
  const seq = result.filter((c) => c.trackId === trackId).sort(byStart);
  const origin = seq.length ? Math.min(seq[0].start, Math.max(0, requestedStart)) : Math.max(0, requestedStart);
  let index = seq.findIndex((c) => requestedStart < (c.start + c.end) / 2);
  if (index < 0) index = seq.length;
  const moving = { ...clip, trackId, start: 0, end: length };
  const packed = packTrack([...seq.slice(0, index), moving, ...seq.slice(index)], seq.length ? origin : Math.max(0, requestedStart));
  const updated = new Map<string, T>(result.map((c) => [c.id, c]));
  for (const c of packed) updated.set(c.id, c);
  return clips.map((c) => updated.get(c.id) ?? c);
};

export const trimClip = <T extends EditClip>(
  clips: T[],
  clipId: string,
  edge: 'start' | 'end',
  requestedTime: number,
  mode: EditMode,
  gridSec: number,
  mediaDuration?: number,
): T[] => {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip || !Number.isFinite(requestedTime)) return clips;
  const speed = Math.max(0.05, clip.speed || 1);
  const sourceIn = clip.sourceIn ?? 0;
  const sourceOut = clip.sourceOut ?? sourceIn + clip.duration;
  const maxSource = mediaDuration && mediaDuration > 0 ? mediaDuration : Number.POSITIVE_INFINITY;
  const time = placeTime(requestedTime, mode, gridSec);
  let next: T;
  let delta = 0; // change of the clip's timeline end, for shuffle ripple
  if (edge === 'start') {
    const earliest = clip.start - sourceIn / speed; // cannot reveal media before 0
    const latest = clip.end - MIN_CLIP_SEC;
    const newStart = Math.min(latest, Math.max(earliest, 0, time));
    const newSourceIn = Math.max(0, sourceIn + (newStart - clip.start) * speed);
    if (mode === 'shuffle') {
      // the clip keeps its start; its tail (and everything after it) moves
      const length = clip.end - newStart;
      next = { ...clip, sourceIn: newSourceIn, sourceOut, duration: sourceOut - newSourceIn, end: clip.start + length };
      delta = next.end - clip.end;
    } else {
      next = { ...clip, start: newStart, sourceIn: newSourceIn, sourceOut, duration: sourceOut - newSourceIn };
    }
  } else {
    const latest = clip.start + (maxSource - sourceIn) / speed;
    const newEnd = Math.max(clip.start + MIN_CLIP_SEC, Math.min(latest, time));
    const newSourceOut = sourceIn + (newEnd - clip.start) * speed;
    next = { ...clip, end: newEnd, sourceIn, sourceOut: newSourceOut, duration: newSourceOut - sourceIn };
    delta = newEnd - clip.end;
  }
  return clips.map((c) => {
    if (c.id === clipId) return next;
    if (mode === 'shuffle' && Math.abs(delta) > EPS && c.trackId === clip.trackId && c.start >= clip.end - EPS) return shiftClip(c, delta);
    return c;
  });
};

export const splitClipAt = <T extends EditClip>(clips: T[], clipId: string, time: number, newId: string): T[] => {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip || !(time > clip.start + MIN_CLIP_SEC / 2) || !(time < clip.end - MIN_CLIP_SEC / 2)) return clips;
  const speed = Math.max(0.05, clip.speed || 1);
  const sourceIn = clip.sourceIn ?? 0;
  const sourceOut = clip.sourceOut ?? sourceIn + clip.duration;
  const splitSource = sourceIn + (time - clip.start) * speed;
  const first = { ...clip, end: time, sourceOut: splitSource, duration: splitSource - sourceIn };
  const second = { ...clip, id: newId, start: time, sourceIn: splitSource, sourceOut, duration: sourceOut - splitSource };
  const index = clips.findIndex((c) => c.id === clipId);
  return [...clips.slice(0, index), first, second, ...clips.slice(index + 1)];
};

export const deleteClips = <T extends EditClip>(clips: T[], clipIds: string[], mode: EditMode): T[] => {
  const ids = new Set(clipIds);
  const removed = clips.filter((c) => ids.has(c.id));
  if (!removed.length) return clips;
  let result = clips.filter((c) => !ids.has(c.id));
  if (mode !== 'shuffle') return result;
  // ripple: later clips on the same track move left by the removed lengths before them
  for (const gone of removed.sort((a, b) => b.start - a.start)) {
    const length = gone.end - gone.start;
    result = result.map((c) => (c.trackId === gone.trackId && c.start >= gone.end - EPS ? shiftClip(c, -length) : c));
  }
  return result;
};

/** Deletes [start, end) on the given tracks (selector range); shuffle closes the hole. */
export const deleteRange = <T extends EditClip>(clips: T[], trackIds: string[], start: number, end: number, mode: EditMode, makeId: () => string): T[] => {
  if (!(end > start)) return clips;
  const tracks = new Set(trackIds);
  let result = clips;
  for (const clip of clips) {
    if (!tracks.has(clip.trackId) || clip.end <= start || clip.start >= end) continue;
    if (clip.start < start && clip.end > end) {
      result = splitClipAt(result, clip.id, end, makeId());
      result = splitClipAt(result, clip.id, start, makeId());
    } else if (clip.start < start) {
      result = splitClipAt(result, clip.id, start, makeId());
    } else if (clip.end > end) {
      result = splitClipAt(result, clip.id, end, makeId());
    }
  }
  const inside = result.filter((c) => tracks.has(c.trackId) && c.start >= start - EPS && c.end <= end + EPS).map((c) => c.id);
  result = result.filter((c) => !inside.includes(c.id));
  if (mode === 'shuffle') {
    const length = end - start;
    result = result.map((c) => (tracks.has(c.trackId) && c.start >= end - EPS ? shiftClip(c, -length) : c));
  }
  return result;
};

export const nudgeClips = <T extends EditClip>(clips: T[], clipIds: string[], deltaSec: number): T[] => {
  const ids = new Set(clipIds);
  const moving = clips.filter((c) => ids.has(c.id));
  if (!moving.length || !Number.isFinite(deltaSec)) return clips;
  const minStart = Math.min(...moving.map((c) => c.start));
  const delta = Math.max(-minStart, deltaSec);
  return clips.map((c) => (ids.has(c.id) ? shiftClip(c, delta) : c));
};

/**
 * Crossfade at the cut between `leftId` and the next clip on its track. Both
 * clips are extended into each other by half the duration where their media
 * allows it; the fade lengths are returned for the mix document.
 */
export const crossfadeClips = <T extends EditClip>(
  clips: T[],
  leftId: string,
  duration: number,
  mediaDuration: (mediaId: string) => number | undefined,
): { clips: T[]; rightId: string | null; fade: number } => {
  const left = clips.find((c) => c.id === leftId);
  if (!left || !(duration > 0)) return { clips, rightId: null, fade: 0 };
  const right = clips
    .filter((c) => c.trackId === left.trackId && c.id !== left.id && c.start >= left.end - 0.05 && c.start <= left.end + 0.05)
    .sort(byStart)[0];
  if (!right) return { clips, rightId: null, fade: 0 };
  const half = duration / 2;
  const lSpeed = Math.max(0.05, left.speed || 1);
  const rSpeed = Math.max(0.05, right.speed || 1);
  const lIn = left.sourceIn ?? 0;
  const lOut = left.sourceOut ?? lIn + left.duration;
  const rIn = right.sourceIn ?? 0;
  const rOut = right.sourceOut ?? rIn + right.duration;
  const lMax = mediaDuration(left.mediaId) ?? lOut;
  const extendLeft = Math.max(0, Math.min(half, (lMax - lOut) / lSpeed, (right.end - right.start) - MIN_CLIP_SEC));
  const extendRight = Math.max(0, Math.min(half, rIn / rSpeed, (left.end - left.start) - MIN_CLIP_SEC));
  const cut = left.end;
  const nextLeft = { ...left, end: cut + extendLeft, sourceOut: lOut + extendLeft * lSpeed, duration: lOut + extendLeft * lSpeed - lIn };
  const nextRight = { ...right, start: cut - extendRight, sourceIn: rIn - extendRight * rSpeed, duration: rOut - (rIn - extendRight * rSpeed) };
  const fade = extendLeft + extendRight;
  return {
    clips: clips.map((c) => (c.id === left.id ? nextLeft : c.id === right.id ? nextRight : c)),
    rightId: right.id,
    fade,
  };
};
