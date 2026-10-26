import test from 'node:test';
import assert from 'node:assert/strict';

import './cutTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';
import type { MediaItem, TimelineClip } from '../../types.ts';

const media = (id: string, duration: number, type: MediaItem['type'] = 'video'): MediaItem => ({ id, name: id, type, url: `blob:${id}`, source: 'upload', duration });
const clip = (id: string, mediaId: string, start: number, end: number, extra: Partial<TimelineClip> = {}): TimelineClip => ({
    id, mediaId, trackId: 'v1', start, end, duration: end - start, speed: 1, sourceIn: 0, sourceOut: end - start, effect: null, ...extra,
});

const ALL = ['cut_smart_insert', 'cut_append', 'cut_ripple_overwrite', 'cut_close_up', 'cut_place_on_top', 'cut_source_overwrite', 'cut_trim', 'cut_blade', 'cut_transition_add', 'cut_source_tape_get', 'cut_edit_points_get', 'cut_viewer_state_get', 'cut_viewer_set'];

const setup = () => createTestContext({
    mediaItems: [media('ma', 10), media('mb', 10), media('src', 8), media('still', 5, 'image')],
    timelineClips: [clip('a', 'ma', 0, 4), clip('b', 'mb', 4, 8, { sourceIn: 1, sourceOut: 5 })],
    playheadPosition: 5,
});

test('cut tools are published with schemas', async () => {
    const { ctx } = setup();
    const mcp = await createMcpHarness(ctx);
    try {
        const names = mcp.list().map((tool) => tool.name);
        ALL.forEach((name) => assert.ok(names.includes(name), `${name} missing`));
        assert.match(mcp.list().find((tool) => tool.name === 'cut_trim')!.description, /changes the project/);
    } finally { mcp.dispose(); }
});

test('smart insert, append and ripple overwrite edit the timeline', async () => {
    const { ctx, state } = setup();
    const mcp = await createMcpHarness(ctx);
    try {
        const inserted = await mcp.call('cut_smart_insert', { mediaId: 'src', sourceIn: 1, sourceOut: 3 });
        assert.equal(inserted.ok, true);
        const added = state.timelineClips.find((entry) => entry.id === inserted.clipId)!;
        assert.equal(added.start, 4, 'nearest edit point to 5 is 4');
        assert.equal(state.timelineClips.find((entry) => entry.id === 'b')!.start, 6);
        assert.equal(state.selectedClipId, inserted.clipId);
        assert.equal(state.playheadPosition, 6);

        const appended = await mcp.call('cut_append', { mediaId: 'still' });
        const tail = state.timelineClips.find((entry) => entry.id === appended.clipId)!;
        assert.equal(tail.start, 10);

        const replaced = await mcp.call('cut_ripple_overwrite', { mediaId: 'src', sourceIn: 0, sourceOut: 1, at: 7 });
        assert.equal(replaced.ok, true);
        assert.equal(state.timelineClips.some((entry) => entry.id === 'b'), false);
        assert.equal(state.timelineClips.find((entry) => entry.id === appended.clipId)!.start, 7);

        const missing = await mcp.call('cut_append', { mediaId: 'nope' });
        assert.equal(missing.ok, false);
    } finally { mcp.dispose(); }
});

test('close up, place on top and source overwrite add a track when needed', async () => {
    const { ctx, state } = setup();
    const mcp = await createMcpHarness(ctx);
    try {
        const close = await mcp.call('cut_close_up', { at: 1 });
        assert.equal(close.ok, true);
        assert.ok(close.addedTrackId, 'new video track');
        const copy = state.timelineClips.find((entry) => entry.id === close.clipId)!;
        assert.equal(copy.trackId, close.addedTrackId);
        assert.equal(copy.transform?.scale, 1.3);
        assert.equal(copy.start, 1);
        assert.equal(copy.end, 4);

        const top = await mcp.call('cut_place_on_top', { mediaId: 'src', sourceOut: 2, at: 2 });
        assert.equal(top.ok, true);
        assert.equal(state.timelineTracks.filter((track) => track.type === 'video').length, 3);

        const sync = await mcp.call('cut_source_overwrite', { mediaId: 'src', sourceIn: 0, sourceOut: 4, sourceAnchor: 2, at: 6 });
        const synced = state.timelineClips.find((entry) => entry.id === sync.clipId)!;
        assert.equal(synced.start, 4);
    } finally { mcp.dispose(); }
});

test('trim, blade, transitions and read tools', async () => {
    const { ctx, state } = setup();
    const mcp = await createMcpHarness(ctx);
    try {
        const ripple = await mcp.call('cut_trim', { mode: 'ripple', clipId: 'a', edge: 'out', frames: 12 });
        assert.equal(ripple.appliedFrames, 12);
        assert.equal(state.timelineClips.find((entry) => entry.id === 'b')!.start, 4.5);

        const roll = await mcp.call('cut_trim', { mode: 'roll', clipId: 'b', edge: 'in', frames: -48 });
        assert.equal(roll.appliedFrames, -24, 'b only has 1 s of head handle');
        assert.equal(roll.clamped, true);

        const slip = await mcp.call('cut_trim', { mode: 'slip', clipId: 'a', frames: 24 });
        assert.equal(slip.appliedFrames, 24);
        const bad = await mcp.call('cut_trim', { mode: 'zoom', clipId: 'a', frames: 1 });
        assert.equal(bad.ok, false);

        const edits = await mcp.call('cut_edit_points_get', { trackId: 'v1' });
        assert.ok((edits.edits as Array<{ outgoingId: string | null }>).some((edit) => edit.outgoingId === 'a'));

        const dissolve = await mcp.call('cut_transition_add', { clipId: 'a', kind: 'dissolve' });
        assert.deepEqual(state.timelineClips.find((entry) => entry.id === 'a')!.transitionOut, { type: 'Cross Fade', duration: 1 });
        assert.equal(dissolve.ok, true);
        await mcp.call('cut_transition_add', { clipId: 'a', kind: 'cut' });
        assert.equal(state.timelineClips.find((entry) => entry.id === 'a')!.transitionOut, undefined);

        const blade = await mcp.call('cut_blade', { at: 1 });
        assert.equal(blade.cut, 1);
        assert.equal(state.timelineClips.length, 3);

        const tape = await mcp.call('cut_source_tape_get', { sort: 'name' });
        assert.equal(tape.length, 33);
        assert.equal((tape.segments as Array<{ mediaId: string }>)[0].mediaId, 'ma');
    } finally { mcp.dispose(); }
});

test('viewer tools reach the mounted Cut page through live commands', async () => {
    const { ctx } = setup();
    const mcp = await createMcpHarness(ctx);
    let viewer: Record<string, unknown> = { viewerMode: 'timeline' };
    const dispose = registerLiveCommands({
        'cut.state.get': () => viewer,
        'cut.state.set': (args) => { viewer = { ...viewer, viewerMode: args.mode ?? viewer.viewerMode, sourceMediaId: args.mediaId ?? null }; return viewer; },
    });
    try {
        const set = await mcp.call('cut_viewer_set', { mode: 'source', mediaId: 'src' });
        assert.equal((set.state as { viewerMode: string }).viewerMode, 'source');
        const read = await mcp.call('cut_viewer_state_get');
        assert.equal((read.state as { sourceMediaId: string }).sourceMediaId, 'src');
    } finally { dispose(); mcp.dispose(); }
});
