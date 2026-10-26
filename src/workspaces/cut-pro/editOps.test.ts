import test from 'node:test';
import assert from 'node:assert/strict';

import {
    adjacentEdit,
    appendToEnd,
    applyTrim,
    bladeAt,
    buildSourceTape,
    carveRange,
    closeUp,
    detailViewport,
    editPoints,
    fastReviewRate,
    findEditPoint,
    freeTrackAbove,
    insertAt,
    locateTape,
    nearestEditPoint,
    nextShuttle,
    overviewScale,
    pickTargetTrack,
    placeOnTop,
    quickTransitionDuration,
    retarget,
    rippleOverwrite,
    rippleTrimIn,
    rippleTrimOut,
    rollEdit,
    setTransitionOut,
    slideClip,
    slipClip,
    smartInsert,
    sortMedia,
    sourceOverwrite,
    splitClip,
    tapeLength,
    tapeTimeOf,
    trimEdge,
    type CutClip,
    type CutTrack,
    type EditSource,
} from './editOps.ts';

const clip = (id: string, trackId: string, start: number, end: number, extra: Partial<CutClip> = {}): CutClip => ({
    id, mediaId: `m-${id}`, trackId, start, end, speed: 1, sourceIn: 0, sourceOut: end - start, duration: end - start, ...extra,
});

const tracks: CutTrack[] = [
    { id: 'v1', type: 'video', isLocked: false, isTargeted: true },
    { id: 'v2', type: 'video', isLocked: false },
    { id: 'a1', type: 'audio', isLocked: false, isTargeted: true },
];

const lengths: Record<string, number> = { 'm-a': 10, 'm-b': 10, 'm-c': 10, src: 8, 'm-still': Number.POSITIVE_INFINITY };
const mediaLength = (mediaId: string) => lengths[mediaId] ?? 10;

let n = 0;
const makeId = () => `new-${++n}`;

const source: EditSource = { mediaId: 'src', sourceIn: 1, sourceOut: 3, mediaType: 'video' };

const byId = (clips: CutClip[], id: string) => {
    const found = clips.find((entry) => entry.id === id);
    assert.ok(found, `clip ${id} missing`);
    return found;
};
const near = (actual: number | undefined, expected: number, message?: string) => assert.ok(Math.abs((actual ?? NaN) - expected) < 1e-6, `${message || ''} expected ${expected}, got ${actual}`);

/* ─── Edit points ─── */

test('editPoints and nearestEditPoint find cuts on a track', () => {
    const clips = [clip('a', 'v1', 0, 4), clip('b', 'v1', 4, 9), clip('x', 'v2', 2, 3)];
    assert.deepEqual(editPoints(clips, 'v1'), [0, 4, 9]);
    assert.deepEqual(editPoints(clips), [0, 2, 3, 4, 9]);
    assert.equal(nearestEditPoint(clips, 'v1', 5.5), 4);
    assert.equal(nearestEditPoint(clips, 'v1', 7), 9);
    assert.equal(nearestEditPoint(clips, 'v1', 2), 0, 'ties go to the earlier point');
    assert.equal(adjacentEdit(clips, null, 3.5, 1), 4);
    assert.equal(adjacentEdit(clips, null, 3.5, -1), 3);
    assert.equal(adjacentEdit(clips, null, 9, 1), null);
});

test('findEditPoint returns outgoing and incoming clips within tolerance', () => {
    const clips = [clip('a', 'v1', 0, 4), clip('b', 'v1', 4, 9)];
    const hit = findEditPoint(clips, 'v1', 4.05, 0.1);
    assert.ok(hit);
    assert.equal(hit.outgoing?.id, 'a');
    assert.equal(hit.incoming?.id, 'b');
    assert.equal(findEditPoint(clips, 'v1', 6, 0.1), null);
    const tail = findEditPoint(clips, 'v1', 9, 0.1);
    assert.equal(tail?.outgoing?.id, 'b');
    assert.equal(tail?.incoming, null);
});

/* ─── Smart edits ─── */

test('smartInsert inserts at the nearest edit point and ripples all unlocked tracks', () => {
    const clips = [clip('a', 'v1', 0, 4), clip('b', 'v1', 4, 9), clip('x', 'v2', 3, 6), clip('s', 'a1', 0, 9)];
    const result = smartInsert(clips, tracks, 'v1', source, 5.2, makeId);
    assert.ok(result.ok);
    const inserted = byId(result.clips, result.selectId!);
    near(inserted.start, 4);
    near(inserted.end, 6);
    near(inserted.sourceIn, 1);
    near(inserted.sourceOut, 3);
    near(byId(result.clips, 'b').start, 6, 'b ripples');
    // v2 clip spanning the insert point is split, its tail moves.
    const v2 = result.clips.filter((entry) => entry.trackId === 'v2').sort((l, r) => l.start - r.start);
    assert.equal(v2.length, 2);
    near(v2[0].end, 4);
    near(v2[1].start, 6);
    near(v2[1].sourceIn, 1);
    near(result.playhead, 6);
    assert.equal(clips.length, 4, 'input not mutated');
});

test('insert leaves locked tracks alone and refuses mismatched tracks', () => {
    const locked = tracks.map((track) => (track.id === 'v2' ? { ...track, isLocked: true } : track));
    const clips = [clip('a', 'v1', 0, 4), clip('x', 'v2', 4, 6)];
    const result = insertAt(clips, locked, 'v1', source, 4, makeId);
    assert.ok(result.ok);
    near(byId(result.clips, 'x').start, 4);
    const wrong = insertAt(clips, tracks, 'a1', source, 0, makeId);
    assert.equal(wrong.ok, false);
    const lockedTarget = insertAt(clips, locked, 'v2', source, 0, makeId);
    assert.equal(lockedTarget.ok, false);
    const bad = insertAt(clips, tracks, 'v1', { ...source, sourceOut: source.sourceIn }, 0, makeId);
    assert.equal(bad.ok, false);
});

test('appendToEnd places the source after the last clip of the sequence', () => {
    const clips = [clip('a', 'v1', 0, 4), clip('s', 'a1', 0, 7)];
    const result = appendToEnd(clips, tracks, 'v1', source, makeId);
    assert.ok(result.ok);
    const added = byId(result.clips, result.selectId!);
    near(added.start, 7);
    near(added.end, 9);
    near(result.playhead, 9);
});

test('rippleOverwrite replaces the clip under the playhead and ripples by the difference', () => {
    const clips = [clip('a', 'v1', 0, 4), clip('b', 'v1', 4, 9), clip('c', 'v1', 9, 12), clip('x', 'v2', 10, 11)];
    const result = rippleOverwrite(clips, tracks, 'v1', source, 5, makeId);
    assert.ok(result.ok);
    assert.equal(result.clips.some((entry) => entry.id === 'b'), false);
    const added = byId(result.clips, result.selectId!);
    near(added.start, 4);
    near(added.end, 6);
    near(byId(result.clips, 'c').start, 6);
    near(byId(result.clips, 'x').start, 7, 'other tracks ripple too');
    const miss = rippleOverwrite(clips, tracks, 'v1', source, 20, makeId);
    assert.equal(miss.ok, false);
    assert.equal(!miss.ok && miss.reason, 'no-clip');
});

test('closeUp duplicates the clip from the playhead onto a free track above with scale 1.3', () => {
    const clips = [clip('a', 'v1', 0, 4, { sourceIn: 2, sourceOut: 6, transform: { scale: 1, opacity: 0.8, position: { x: 10, y: 0 } } })];
    const result = closeUp(clips, tracks, 'v1', 1, makeId);
    assert.ok(result.ok);
    const copy = byId(result.clips, result.selectId!);
    assert.equal(copy.trackId, 'v2');
    near(copy.start, 1);
    near(copy.end, 4);
    near(copy.sourceIn, 3);
    near(copy.sourceOut, 6);
    near(copy.transform?.scale, 1.3);
    near(copy.transform?.opacity, 0.8);
    near(byId(result.clips, 'a').transform?.scale, 1, 'original untouched');
    const ranged = closeUp(clips, tracks, 'v1', 1, makeId, { range: { start: 2, end: 3 } });
    assert.ok(ranged.ok);
    near(byId(ranged.clips, ranged.selectId!).end, 3);
});

test('closeUp asks for a new track when nothing above is free', () => {
    const clips = [clip('a', 'v1', 0, 4), clip('x', 'v2', 0, 4)];
    const result = closeUp(clips, tracks, 'v1', 1, makeId);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.needsTrack, 'video');
    const none = closeUp([], tracks, 'v1', 1, makeId);
    assert.equal(!none.ok && none.reason, 'no-clip');
});

test('placeOnTop picks the first free video track above everything at the playhead', () => {
    const three = [...tracks, { id: 'v3', type: 'video' as const, isLocked: false }];
    const clips = [clip('a', 'v1', 0, 10), clip('x', 'v2', 1, 2)];
    const result = placeOnTop(clips, three, source, 1.5, makeId);
    assert.ok(result.ok);
    assert.equal(byId(result.clips, result.selectId!).trackId, 'v3');
    const later = placeOnTop(clips, three, source, 5, makeId);
    assert.ok(later.ok);
    assert.equal(byId(later.clips, later.selectId!).trackId, 'v2');
    const full = placeOnTop(clips, tracks, source, 1.5, makeId);
    assert.equal(!full.ok && full.needsTrack, 'video');
    const audio = placeOnTop([clip('s', 'a1', 0, 5)], tracks, { ...source, mediaType: 'audio' }, 1, makeId);
    assert.equal(!audio.ok && audio.needsTrack, 'audio');
});

test('sourceOverwrite lines the source playhead up with the timeline playhead on a track above', () => {
    const clips = [clip('a', 'v1', 0, 10)];
    const result = sourceOverwrite(clips, tracks, 'v1', { mediaId: 'src', sourceIn: 1, sourceOut: 5, mediaType: 'video' }, 2, 6, makeId);
    assert.ok(result.ok);
    const added = byId(result.clips, result.selectId!);
    assert.equal(added.trackId, 'v2');
    near(added.start, 5);
    near(added.end, 9);
    // The anchor frame (source 2) sits at timeline 6.
    near((added.sourceIn ?? 0) + (6 - added.start), 2);
    const early = sourceOverwrite(clips, tracks, 'v1', { mediaId: 'src', sourceIn: 0, sourceOut: 5, mediaType: 'video' }, 4, 1, makeId);
    assert.ok(early.ok);
    const head = byId(early.clips, early.selectId!);
    near(head.start, 0);
    near(head.sourceIn, 3, 'head before zero is cut off');
});

test('bladeAt splits every clip under the playhead on unlocked tracks and keeps keyframes with their half', () => {
    const locked = tracks.map((track) => (track.id === 'a1' ? { ...track, isLocked: true } : track));
    const clips = [
        clip('a', 'v1', 0, 4, { keyframes: [{ id: 'k1', time: 1 }, { id: 'k2', time: 3 }], transitionOut: { type: 'Cross Fade', duration: 1 } }),
        clip('x', 'v2', 1, 3),
        clip('s', 'a1', 0, 4),
    ];
    const result = bladeAt(clips, locked, 2, makeId);
    assert.equal(result.cut, 2);
    assert.equal(result.clips.length, 5);
    const left = byId(result.clips, 'a');
    near(left.end, 2);
    assert.equal(left.transitionOut, undefined, 'transition stays on the right half');
    assert.deepEqual(left.keyframes?.map((frame) => frame.id), ['k1']);
    const right = result.clips.find((entry) => entry.mediaId === 'm-a' && entry.id !== 'a')!;
    near(right.sourceIn, 2);
    assert.equal(right.transitionOut?.type, 'Cross Fade');
    near(right.keyframes?.[0].time, 1);
    assert.equal(result.clips.filter((entry) => entry.trackId === 'a1').length, 1);
    const only = bladeAt(clips, tracks, 2, makeId, ['v2']);
    assert.equal(only.cut, 1);
});

test('splitClip respects speed', () => {
    const fast = clip('f', 'v1', 0, 2, { speed: 2, sourceIn: 0, sourceOut: 4 });
    const parts = splitClip(fast, 1, 'r');
    assert.ok(parts);
    near(parts[0].sourceOut, 2);
    near(parts[1].sourceIn, 2);
    assert.equal(splitClip(fast, 0, 'r'), null);
});

test('carveRange crops, splits and removes clips for overwrite', () => {
    const clips = [clip('a', 'v1', 0, 4), clip('b', 'v1', 4, 6), clip('c', 'v1', 6, 10)];
    const carved = carveRange(clips, 'v1', 3, 7, makeId);
    assert.equal(carved.some((entry) => entry.id === 'b'), false);
    near(byId(carved, 'a').end, 3);
    const tail = byId(carved, 'c');
    near(tail.start, 7);
    near(tail.sourceIn, 1);
    const middle = carveRange([clip('m', 'v1', 0, 10)], 'v1', 2, 3, makeId);
    assert.equal(middle.length, 2);
});

/* ─── Trims ─── */

test('rippleTrimOut extends into handles, is clamped to media length and ripples the track', () => {
    const clips = [clip('a', 'v1', 0, 4, { sourceIn: 2, sourceOut: 6 }), clip('b', 'v1', 4, 9), clip('x', 'v2', 5, 6)];
    const result = rippleTrimOut(clips, 'a', 1, mediaLength);
    near(result.applied, 1);
    near(byId(result.clips, 'a').end, 5);
    near(byId(result.clips, 'a').sourceOut, 7);
    near(byId(result.clips, 'b').start, 5);
    near(byId(result.clips, 'x').start, 5, 'other tracks keep their place');
    const clamped = rippleTrimOut(clips, 'a', 100, mediaLength);
    near(clamped.applied, 4, 'only 4 s of handle left in a 10 s file');
    near(byId(clamped.clips, 'a').sourceOut, 10);
    const shorter = rippleTrimOut(clips, 'a', -100, mediaLength, 0.5);
    near(byId(shorter.clips, 'a').end, 0.5);
    near(byId(shorter.clips, 'b').start, 0.5);
});

test('rippleTrimIn keeps the start, changes the first frame and pulls later clips', () => {
    const clips = [clip('a', 'v1', 0, 4), clip('b', 'v1', 4, 9, { sourceIn: 1, sourceOut: 6, keyframes: [{ id: 'k', time: 2 }] }), clip('c', 'v1', 9, 10)];
    const result = rippleTrimIn(clips, 'b', 0.5, mediaLength);
    const b = byId(result.clips, 'b');
    near(b.start, 4);
    near(b.end, 8.5);
    near(b.sourceIn, 1.5);
    near(b.keyframes?.[0].time, 1.5, 'keyframes stay on their source frame');
    near(byId(result.clips, 'c').start, 8.5);
    const back = rippleTrimIn(clips, 'b', -5, mediaLength);
    near(back.applied, -1, 'cannot go before the first media frame');
    near(byId(back.clips, 'b').end, 10);
});

test('trimEdge (no ripple) stops at neighbours and zero', () => {
    const clips = [clip('a', 'v1', 0, 4, { sourceIn: 2, sourceOut: 6 }), clip('b', 'v1', 5, 9, { sourceIn: 3, sourceOut: 7 })];
    const out = trimEdge(clips, 'a', 'out', 3, mediaLength);
    near(out.applied, 1, 'gap of 1 s to the next clip');
    near(byId(out.clips, 'b').start, 5);
    const inEdge = trimEdge(clips, 'b', 'in', -3, mediaLength);
    near(inEdge.applied, -1, 'gap of 1 s to the previous clip');
    near(byId(inEdge.clips, 'b').sourceIn, 2);
    const first = trimEdge(clips, 'a', 'in', -5, mediaLength);
    near(first.applied, 0, 'already at zero');
});

test('rollEdit moves the cut and keeps total length, clamped by both handles', () => {
    const clips = [clip('a', 'v1', 0, 4, { sourceIn: 0, sourceOut: 4 }), clip('b', 'v1', 4, 8, { sourceIn: 1, sourceOut: 5 })];
    const result = rollEdit(clips, 'a', 'b', 0.5, mediaLength);
    near(byId(result.clips, 'a').end, 4.5);
    near(byId(result.clips, 'a').sourceOut, 4.5);
    near(byId(result.clips, 'b').start, 4.5);
    near(byId(result.clips, 'b').sourceIn, 1.5);
    near(byId(result.clips, 'b').end, 8);
    const left = rollEdit(clips, 'a', 'b', -3, mediaLength);
    near(left.applied, -1, 'incoming only has 1 s of head handle');
    const one = rollEdit([clip('a', 'v1', 0, 4)], 'a', null, 1, mediaLength);
    near(one.applied, 1, 'roll against a gap trims the edge');
});

test('stills have unlimited head handles for roll, ripple-in and slide', () => {
    const clips = [clip('a', 'v1', 0, 4, { sourceOut: 4 }), clip('s', 'v1', 4, 8, { mediaId: 'm-still', sourceIn: 0, sourceOut: 4 })];
    const roll = rollEdit(clips, 'a', 's', -1, mediaLength);
    near(roll.applied, -1);
    near(byId(roll.clips, 's').start, 3);
    near(byId(roll.clips, 's').sourceIn, 0, 'source in never goes negative');
    const ripple = rippleTrimIn(clips, 's', -2, mediaLength);
    near(ripple.applied, -2);
    near(byId(ripple.clips, 's').end, 10);
    const slide = slideClip([clip('x', 'v1', 0, 2), clip('y', 'v1', 2, 4), clip('s', 'v1', 4, 8, { mediaId: 'm-still' })], 'y', -1, mediaLength);
    near(slide.applied, -1);
});

test('slipClip changes frames but not position, clamped to the media', () => {
    const clips = [clip('a', 'v1', 2, 6, { sourceIn: 1, sourceOut: 5 })];
    const result = slipClip(clips, 'a', 2, mediaLength);
    const a = byId(result.clips, 'a');
    near(a.start, 2);
    near(a.end, 6);
    near(a.sourceIn, 3);
    near(a.sourceOut, 7);
    near(slipClip(clips, 'a', 50, mediaLength).applied, 5);
    near(slipClip(clips, 'a', -50, mediaLength).applied, -1);
    const fast = [clip('f', 'v1', 0, 2, { speed: 2, sourceIn: 2, sourceOut: 6 })];
    near(slipClip(fast, 'f', 10, mediaLength).applied, 2, 'speed 2: 4 s of source = 2 s of timeline');
});

test('slideClip moves a clip between its neighbours', () => {
    const clips = [
        clip('a', 'v1', 0, 4, { sourceIn: 0, sourceOut: 4 }),
        clip('b', 'v1', 4, 6, { sourceIn: 0, sourceOut: 2 }),
        clip('c', 'v1', 6, 10, { sourceIn: 1, sourceOut: 5 }),
    ];
    const result = slideClip(clips, 'b', 0.5, mediaLength);
    near(byId(result.clips, 'b').start, 4.5);
    near(byId(result.clips, 'a').end, 4.5);
    near(byId(result.clips, 'a').sourceOut, 4.5);
    near(byId(result.clips, 'c').start, 6.5);
    near(byId(result.clips, 'c').sourceIn, 1.5);
    near(byId(result.clips, 'c').end, 10);
    near(slideClip(clips, 'b', -10, mediaLength).applied, -1, 'incoming clip has 1 s of head handle');
    near(slideClip(clips, 'b', 10, mediaLength, 0.5).applied, 3.5, 'outgoing keeps at least 0.5 s');
    const alone = [clip('z', 'v1', 2, 3)];
    near(slideClip(alone, 'z', -5, mediaLength).applied, -2, 'cannot slide before zero');
});

test('applyTrim dispatches tools and retarget follows the cut', () => {
    const clips = [clip('a', 'v1', 0, 4, { sourceOut: 4 }), clip('b', 'v1', 4, 8, { sourceIn: 1, sourceOut: 5 })];
    const edit = { kind: 'edit' as const, trackId: 'v1', time: 4, outgoingId: 'a', incomingId: 'b', side: 'out' as const };
    const ripple = applyTrim(clips, edit, 'ripple', 0.5, mediaLength);
    near(byId(ripple.clips, 'b').start, 4.5);
    near(retarget(ripple.clips, edit).kind === 'edit' ? (retarget(ripple.clips, edit) as typeof edit).time : 0, 4.5);
    const normal = applyTrim(clips, edit, 'normal', 0.5, mediaLength);
    near(normal.applied, 0, 'no room without ripple');
    const roll = applyTrim(clips, { ...edit, side: 'both' }, 'normal', 0.5, mediaLength);
    near(byId(roll.clips, 'b').sourceIn, 1.5);
    const slip = applyTrim(clips, { kind: 'clip', clipId: 'b' }, 'slip', 1, mediaLength);
    near(byId(slip.clips, 'b').sourceIn, 2);
    const slide = applyTrim(clips, { kind: 'clip', clipId: 'b' }, 'slide', 1, mediaLength);
    near(byId(slide.clips, 'b').start, 5);
});

/* ─── Transitions, playback, tape, pool, geometry ─── */

test('quick transitions: cut clears, dissolve and smooth cut are limited by clip length', () => {
    assert.equal(quickTransitionDuration('cut', 4, 4), null);
    near(quickTransitionDuration('dissolve', 4, 4) ?? 0, 1);
    near(quickTransitionDuration('dissolve', 1, 4) ?? 0, 0.5);
    near(quickTransitionDuration('smooth', 4, 4, 24) ?? 0, 4 / 24);
    const clips = [clip('a', 'v1', 0, 4)];
    const withFade = setTransitionOut(clips, 'a', { type: 'Cross Fade', duration: 1 });
    assert.equal(withFade[0].transitionOut?.type, 'Cross Fade');
    assert.equal(setTransitionOut(withFade, 'a', null)[0].transitionOut, undefined);
    assert.equal(clips[0].transitionOut, undefined);
});

test('fastReviewRate and J/K/L shuttle', () => {
    assert.equal(fastReviewRate(3), 1);
    assert.equal(fastReviewRate(20), 4);
    assert.equal(fastReviewRate(600), 16);
    assert.equal(fastReviewRate(Number.NaN), 1);
    assert.equal(nextShuttle(0, 'l'), 1);
    assert.equal(nextShuttle(1, 'l'), 2);
    assert.equal(nextShuttle(8, 'l'), 8);
    assert.equal(nextShuttle(2, 'j'), -1);
    assert.equal(nextShuttle(-1, 'j'), -2);
    assert.equal(nextShuttle(-4, 'k'), 0);
});

test('source tape concatenates bin items and maps tape time back to media time', () => {
    const tape = buildSourceTape([{ id: 'v', type: 'video', duration: 4 }, { id: 'i', type: 'image' }, { id: 'a', type: 'audio', duration: 2 }], 3);
    assert.equal(tapeLength(tape), 9);
    assert.deepEqual(locateTape(tape, 5), { index: 1, mediaId: 'i', offset: 1 });
    assert.equal(locateTape(tape, 100)?.mediaId, 'a');
    near(locateTape(tape, 100)?.offset, 2);
    assert.equal(locateTape([], 1), null);
    assert.equal(tapeTimeOf(tape, 'a', 1), 8);
    assert.equal(tapeTimeOf(tape, 'nope'), null);
});

test('sortMedia is stable and supports all keys', () => {
    const items = [
        { id: '1', name: 'Shot 10', type: 'video', duration: 3 },
        { id: '2', name: 'shot 2', type: 'image', duration: 5 },
        { id: '3', name: 'Ambience', type: 'audio', duration: 1 },
    ];
    assert.deepEqual(sortMedia(items, 'name').map((item) => item.id), ['3', '2', '1']);
    assert.deepEqual(sortMedia(items, 'duration').map((item) => item.id), ['3', '1', '2']);
    assert.deepEqual(sortMedia(items, 'type').map((item) => item.id), ['3', '2', '1']);
    assert.deepEqual(sortMedia(items, 'added', true).map((item) => item.id), ['3', '2', '1']);
});

test('track targeting and free track search', () => {
    assert.equal(pickTargetTrack(tracks, 'video', null)?.id, 'v1');
    assert.equal(pickTargetTrack(tracks, 'video', 'v2')?.id, 'v2');
    assert.equal(pickTargetTrack(tracks, 'audio', 'v2')?.id, 'a1');
    assert.equal(pickTargetTrack([{ id: 'v', type: 'video', isLocked: true }], 'image', null), null);
    assert.equal(freeTrackAbove([clip('x', 'v2', 0, 2)], tracks, 'v1', 1, 3), null);
    assert.equal(freeTrackAbove([clip('x', 'v2', 0, 2)], tracks, 'v1', 2, 3)?.id, 'v2');
});

test('timeline geometry: detail viewport keeps the playhead centred, overview fits the programme', () => {
    const view = detailViewport(10, 50, 1000);
    near(view.startTime, 0);
    near(view.endTime, 20);
    near(view.timeToX(10), 500);
    near(view.timeToX(12), 600);
    near(overviewScale(100, 1000).pixelsPerSecond, 10);
    near(overviewScale(2, 1000).pixelsPerSecond, 100, 'short programmes use a minimum span');
});
