import test from 'node:test';
import assert from 'node:assert/strict';

import { currentSource, DEFAULT_CUT_STATE, editSourceFor, parseCutState, setMark, sourceMediaLength } from './cutState.ts';
import { buildSourceTape } from './editOps.ts';

test('parseCutState falls back to defaults for garbage and clamps values', () => {
    assert.deepEqual(parseCutState(null), DEFAULT_CUT_STATE);
    assert.deepEqual(parseCutState('x'), DEFAULT_CUT_STATE);
    const parsed = parseCutState({
        viewerMode: 'tape', poolView: 'list', poolSort: 'name', poolSortDesc: true,
        sourceMediaId: 'm1', sourcePlayhead: -4, tapeTime: 3, detailZoom: 99999, multiFrame: 1, timelineHeight: 5,
        marks: { m1: { in: 1, out: 2 }, bad: 'x', empty: { in: null, out: null }, neg: { in: -1, out: 3 } },
        timelineIn: 2, timelineOut: 'x',
        trimTarget: { kind: 'edit', trackId: 'v1', time: 4, outgoingId: 'a', incomingId: null, side: 'weird' },
    });
    assert.equal(parsed.viewerMode, 'tape');
    assert.equal(parsed.poolView, 'list');
    assert.equal(parsed.poolSort, 'name');
    assert.equal(parsed.poolSortDesc, true);
    assert.equal(parsed.sourcePlayhead, 0);
    assert.equal(parsed.detailZoom, 600);
    assert.equal(parsed.multiFrame, 2);
    assert.equal(parsed.timelineHeight, 170);
    assert.deepEqual(parsed.marks, { m1: { in: 1, out: 2 }, neg: { in: null, out: 3 } });
    assert.equal(parsed.timelineIn, 2);
    assert.equal(parsed.timelineOut, null);
    assert.deepEqual(parsed.trimTarget, { kind: 'edit', trackId: 'v1', time: 4, outgoingId: 'a', incomingId: null, side: 'both' });
    assert.equal(parseCutState({ viewerMode: 'nope', trimTarget: { kind: 'edit', trackId: 'v', time: 1 } }).viewerMode, 'timeline');
    assert.equal(parseCutState({ trimTarget: { kind: 'edit', trackId: 'v', time: 1 } }).trimTarget, null);
    assert.deepEqual(parseCutState({ trimTarget: { kind: 'clip', clipId: 'c' } }).trimTarget, { kind: 'clip', clipId: 'c' });
    // Round trip through JSON.
    assert.deepEqual(parseCutState(JSON.parse(JSON.stringify(parsed))), parsed);
});

test('editSourceFor uses marks, whole media when unmarked, and rejects empty ranges', () => {
    const video = { id: 'v', type: 'video' as const, duration: 8 };
    assert.deepEqual(editSourceFor(video, undefined), { mediaId: 'v', sourceIn: 0, sourceOut: 8, mediaType: 'video' });
    assert.deepEqual(editSourceFor(video, { in: 2, out: null }), { mediaId: 'v', sourceIn: 2, sourceOut: 8, mediaType: 'video' });
    assert.deepEqual(editSourceFor(video, { in: 2, out: 20 }), { mediaId: 'v', sourceIn: 2, sourceOut: 8, mediaType: 'video' });
    assert.equal(editSourceFor(video, { in: 8, out: null }), null);
    const still = { id: 'i', type: 'image' as const };
    assert.equal(sourceMediaLength(still, 3), 3);
    assert.equal(editSourceFor(still, undefined, 3)?.sourceOut, 3);
});

test('setMark keeps In before Out and removes empty entries', () => {
    let marks = setMark({}, 'v', 'in', 2);
    marks = setMark(marks, 'v', 'out', 5);
    assert.deepEqual(marks.v, { in: 2, out: 5 });
    marks = setMark(marks, 'v', 'in', 6);
    assert.deepEqual(marks.v, { in: 6, out: null });
    marks = setMark(marks, 'v', 'in', null);
    assert.equal(marks.v, undefined);
});

test('currentSource follows the source clip or the tape position', () => {
    const media = [{ id: 'a', type: 'video' as const, duration: 4 }, { id: 'b', type: 'video' as const, duration: 6 }];
    const tape = buildSourceTape(media);
    const fromSource = currentSource({ ...DEFAULT_CUT_STATE, viewerMode: 'source', sourceMediaId: 'b', sourcePlayhead: 99 }, media, tape);
    assert.equal(fromSource?.media.id, 'b');
    assert.equal(fromSource?.time, 6);
    const fromTape = currentSource({ ...DEFAULT_CUT_STATE, viewerMode: 'tape', tapeTime: 5 }, media, tape);
    assert.equal(fromTape?.media.id, 'b');
    assert.equal(fromTape?.time, 1);
    assert.equal(currentSource({ ...DEFAULT_CUT_STATE, viewerMode: 'source', sourceMediaId: null }, media, tape), null);
});
