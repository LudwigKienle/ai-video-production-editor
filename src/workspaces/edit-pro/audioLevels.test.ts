import test from 'node:test';
import assert from 'node:assert/strict';

import { computeTrackLevels, dbToMeterFraction, linearToDb, mixLevels, volumeToDb, waveformLevelAt } from './audioLevels.ts';

test('waveformLevelAt samples the envelope by source time', () => {
    const peaks = [0, 0.25, 0.5, 1];
    assert.equal(waveformLevelAt(peaks, 4, 0.1), 0);
    assert.equal(waveformLevelAt(peaks, 4, 2.2), 0.5);
    assert.equal(waveformLevelAt(peaks, 4, 4), 1);
    assert.equal(waveformLevelAt(peaks, 4, 9), 0);
    assert.equal(waveformLevelAt(undefined, 4, 1), null);
    assert.equal(waveformLevelAt([], 4, 1), null);
});

test('computeTrackLevels honours clip offset, volume, mute and solo', () => {
    const tracks = [
        { id: 'a1', type: 'audio' as const, isMuted: false },
        { id: 'a2', type: 'audio' as const, isMuted: true },
        { id: 'v1', type: 'video' as const, isMuted: false },
    ];
    const clips = [
        { id: 'c1', mediaId: 'm1', trackId: 'a1', start: 10, end: 14, sourceIn: 2, volume: 0.5 },
        { id: 'c2', mediaId: 'm1', trackId: 'a2', start: 10, end: 14 },
        { id: 'c3', mediaId: 'm2', trackId: 'v1', start: 0, end: 20 },
    ];
    const media = [{ id: 'm1', type: 'audio', duration: 8 }, { id: 'm2', type: 'video', duration: 20 }];
    const waveforms = { m1: [0.1, 0.2, 0.4, 0.8, 1, 1, 1, 1] };
    const levels = computeTrackLevels(tracks, clips, media, waveforms, 11);
    // source time = 2 + 1 = 3 -> index 3 -> 0.8 * 0.5
    assert.equal(levels[0].level, 0.4);
    assert.equal(levels[1].level, 0, 'muted track is silent');
    assert.equal(levels[1].audible, false);
    assert.equal(levels[2].level, null, 'video without waveform has no data');
    const solo = computeTrackLevels([{ ...tracks[0] }, { id: 'a3', type: 'audio' as const, isMuted: false, isSolo: true }], clips, media, waveforms, 11);
    assert.equal(solo[0].audible, false);
    assert.equal(computeTrackLevels(tracks, clips, media, waveforms, 30)[0].level, 0, 'no clip under the playhead');
});

test('dB helpers', () => {
    assert.equal(linearToDb(1), 0);
    assert.equal(linearToDb(0), -60);
    assert.ok(Math.abs(linearToDb(0.5) + 6.02) < 0.01);
    assert.equal(dbToMeterFraction(0), 1);
    assert.equal(dbToMeterFraction(-60), 0);
    assert.equal(dbToMeterFraction(-30), 0.5);
    assert.equal(dbToMeterFraction(6), 1);
    assert.ok(Math.abs(mixLevels([0.3, 0.4, null]) - 0.5) < 1e-9);
    assert.equal(volumeToDb(1), '+0.0');
    assert.equal(volumeToDb(0), '-∞');
});
