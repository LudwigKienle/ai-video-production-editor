import test from 'node:test';
import assert from 'node:assert/strict';

import {
    addMarker,
    markerColorHex,
    nextMarker,
    normalizeMarkers,
    previousMarker,
    removeMarker,
    rippleMarkers,
    snapToFrame,
    updateMarker,
} from './markers.ts';
import type { SequenceMarker } from './markers.ts';

const fps = 24;

test('addMarker snaps to the frame grid and keeps the list sorted', () => {
    let markers: SequenceMarker[] = [];
    markers = addMarker(markers, 2.01, { fps, id: 'b' }).markers;
    markers = addMarker(markers, 1, { fps, id: 'a' }).markers;
    assert.deepEqual(markers.map((m) => m.id), ['a', 'b']);
    assert.equal(markers[1].time, snapToFrame(2.01, fps));
    assert.equal(markers[0].color, 'green');
    assert.equal(markers[0].duration, 0);
});

test('addMarker does not stack two markers on the same frame', () => {
    const first = addMarker([], 3, { fps, id: 'x' });
    const second = addMarker(first.markers, 3 + 0.01, { fps, id: 'y' });
    assert.equal(second.created, false);
    assert.equal(second.marker.id, 'x');
    assert.equal(second.markers, first.markers);
});

test('updateMarker edits name, colour and comment; invalid colour is ignored', () => {
    const { markers } = addMarker([], 1, { fps, id: 'm' });
    const next = updateMarker(markers, 'm', { name: 'Refrain', color: 'red', comment: 'Lauter' });
    assert.equal(next[0].name, 'Refrain');
    assert.equal(next[0].color, 'red');
    assert.equal(next[0].comment, 'Lauter');
    const same = updateMarker(next, 'm', { color: 'pink' as never });
    assert.equal(same, next);
    assert.equal(updateMarker(next, 'nope', { name: 'x' }), next);
});

test('next/previous marker navigation skips the marker under the playhead', () => {
    let markers: SequenceMarker[] = [];
    [1, 2, 5].forEach((t, i) => { markers = addMarker(markers, t, { fps, id: `m${i}` }).markers; });
    assert.equal(nextMarker(markers, 2, fps)?.time, 5);
    assert.equal(previousMarker(markers, 2, fps)?.time, 1);
    assert.equal(nextMarker(markers, 5, fps), null);
    assert.equal(previousMarker(markers, 1, fps), null);
});

test('removeMarker and rippleMarkers', () => {
    let markers: SequenceMarker[] = [];
    [1, 3, 6].forEach((t, i) => { markers = addMarker(markers, t, { fps, id: `m${i}` }).markers; });
    assert.deepEqual(removeMarker(markers, 'm1').map((m) => m.id), ['m0', 'm2']);
    const rippled = rippleMarkers(markers, 2, 4);
    assert.deepEqual(rippled.map((m) => [m.id, m.time]), [['m0', 1], ['m2', 4]]);
});

test('normalizeMarkers accepts old projects and drops malformed entries', () => {
    assert.deepEqual(normalizeMarkers(undefined), []);
    assert.deepEqual(normalizeMarkers({}), []);
    const result = normalizeMarkers([
        { id: 'a', time: 4, name: 'B', color: 'blue' },
        { id: 'a', time: 1 },
        { time: 'x' },
        null,
        { id: 'c', time: -2, color: 'neon', comment: 5 },
    ]);
    assert.equal(result.length, 3);
    assert.deepEqual(result.map((m) => m.time), [0, 1, 4]);
    assert.equal(new Set(result.map((m) => m.id)).size, 3);
    assert.equal(result[0].color, 'green');
    assert.equal(result[0].comment, '');
    assert.equal(result[2].color, 'blue');
    assert.match(markerColorHex('blue'), /^#/);
});
