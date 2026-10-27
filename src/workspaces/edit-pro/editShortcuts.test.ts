import test from 'node:test';
import assert from 'node:assert/strict';

import { nextShuttleRate, resolveEditShortcut } from './editShortcuts.ts';
import { parseTimecodeInput } from './timecodeInput.ts';
import { fxMaxDimensionFor, playbackScale } from './playbackResolution.ts';

const r = (event: Record<string, unknown>, focused: string | null = 'timeline') => resolveEditShortcut({ key: '', ...event } as never, focused as never);

test('marker keys', () => {
    assert.deepEqual(r({ key: 'm' }), { kind: 'addMarker' });
    assert.deepEqual(r({ key: 'M', shiftKey: true }), { kind: 'nextMarker' });
    assert.deepEqual(r({ key: 'M', shiftKey: true, metaKey: true }), { kind: 'previousMarker' });
    assert.equal(r({ key: 'm', altKey: true }), null);
    assert.equal(r({ key: 'm', metaKey: true }), null);
});

test('lift / extract / insert / overwrite (US and German layouts)', () => {
    assert.deepEqual(r({ key: ';' }), { kind: 'lift' });
    assert.deepEqual(r({ key: ';', shiftKey: true, code: 'Comma' }), { kind: 'lift' });
    assert.deepEqual(r({ key: "'", code: 'Quote' }), { kind: 'extract' });
    assert.deepEqual(r({ key: "'", shiftKey: true, code: 'Backslash' }), { kind: 'extract' });
    assert.deepEqual(r({ key: ',' }), { kind: 'insert' });
    assert.deepEqual(r({ key: '.' }), { kind: 'overwrite' });
});

test('zoom and track heights', () => {
    assert.deepEqual(r({ key: '=', code: 'Equal' }), { kind: 'zoom', direction: 'in' });
    assert.deepEqual(r({ key: '+', code: 'BracketRight' }), { kind: 'zoom', direction: 'in' });
    assert.deepEqual(r({ key: '-', code: 'Slash' }), { kind: 'zoom', direction: 'out' });
    assert.deepEqual(r({ key: '\\', code: 'Backslash' }), { kind: 'zoom', direction: 'fit' });
    assert.deepEqual(r({ key: '#', code: 'Backslash' }), { kind: 'zoom', direction: 'fit' });
    assert.deepEqual(r({ key: '+', code: 'Equal', shiftKey: true }), { kind: 'trackHeight', direction: 1 });
    assert.deepEqual(r({ key: '*', code: 'BracketRight', shiftKey: true }), { kind: 'trackHeight', direction: 1 });
    assert.deepEqual(r({ key: '_', code: 'Minus', shiftKey: true }), { kind: 'trackHeight', direction: -1 });
});

test('ripple delete with Alt, shuttle keys, source focus', () => {
    assert.deepEqual(r({ key: 'Backspace', altKey: true }), { kind: 'rippleDelete' });
    assert.deepEqual(r({ key: 'Delete', altKey: true }), { kind: 'rippleDelete' });
    assert.equal(r({ key: 'Delete' }), null);
    assert.deepEqual(r({ key: 'L' }), { kind: 'shuttle', key: 'l' });
    assert.equal(r({ key: 'l' }, 'source'), null);
    assert.equal(r({ key: 'k', metaKey: true }), null);
});

test('shuttle rates 1x/2x/4x and reversal', () => {
    assert.equal(nextShuttleRate(0, 'l'), 1);
    assert.equal(nextShuttleRate(1, 'l'), 2);
    assert.equal(nextShuttleRate(2, 'l'), 4);
    assert.equal(nextShuttleRate(4, 'l'), 4);
    assert.equal(nextShuttleRate(4, 'j'), -1);
    assert.equal(nextShuttleRate(-1, 'j'), -2);
    assert.equal(nextShuttleRate(-2, 'k'), 0);
});

test('timecode input parsing', () => {
    const fps = 24;
    assert.equal(parseTimecodeInput('00:00:05:12', fps), 5.5);
    assert.equal(parseTimecodeInput('5:12', fps), 5.5);
    assert.equal(parseTimecodeInput('512', fps), 5.5);
    assert.equal(parseTimecodeInput('12', fps), 0.5);
    assert.equal(parseTimecodeInput('+12', fps, 10), 10.5);
    assert.equal(parseTimecodeInput('-24', fps, 10), 9);
    assert.equal(parseTimecodeInput('+1:00', fps, 2), 3);
    assert.equal(parseTimecodeInput('+48', fps, 0), 2);
    assert.equal(parseTimecodeInput('2.5s', fps), 2.5);
    assert.equal(parseTimecodeInput('-99', fps, 1), 0);
    assert.equal(parseTimecodeInput('1:02:03:04', fps), 3723 + 4 / 24);
    assert.equal(parseTimecodeInput('abc', fps), null);
    assert.equal(parseTimecodeInput('', fps), null);
    assert.equal(parseTimecodeInput('+', fps), null);
});

test('playback resolution scale', () => {
    assert.equal(playbackScale('half'), 0.5);
    assert.equal(fxMaxDimensionFor('full', 1920, 1080), undefined);
    assert.equal(fxMaxDimensionFor('half', 1920, 1080), 960);
    assert.equal(fxMaxDimensionFor('quarter', 720, 1280), 320);
});
