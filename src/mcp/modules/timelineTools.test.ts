import test from 'node:test';
import assert from 'node:assert/strict';

import './timelineTools.ts';
import { EDIT_LIVE } from './timelineTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';
import type { TimelineClip, TimelineTrack } from '../../types.ts';

const clip = (id: string, trackId: string, start: number, end: number): TimelineClip => ({
    id, mediaId: `m-${id}`, trackId, start, end, duration: end - start, speed: 1, sourceIn: 0, sourceOut: end - start, effect: null,
});
const tracks: TimelineTrack[] = [
    { id: 'v1', name: 'V1', type: 'video', isLocked: false, isMuted: false, isTargeted: true },
    { id: 'a1', name: 'A1', type: 'audio', isLocked: false, isMuted: false, isTargeted: false },
];

const ALL = [
    'timeline_marker_list', 'timeline_marker_add', 'timeline_marker_update', 'timeline_marker_remove', 'timeline_marker_goto',
    'timeline_set_playhead', 'timeline_goto_edit_point', 'timeline_ripple_delete', 'timeline_lift', 'timeline_extract',
    'timeline_source_edit', 'timeline_editor_state', 'timeline_set_in_out', 'timeline_set_playback_resolution', 'timeline_shuttle',
    'timeline_linked_selection', 'timeline_track_height', 'timeline_zoom', 'timeline_layout_set', 'timeline_mode_switch',
    'timeline_list_clips', 'timeline_select_clip',
];

test('timeline tools are published with schemas', async () => {
    const { ctx } = createTestContext();
    const mcp = await createMcpHarness(ctx);
    try {
        const names = mcp.list().map((tool) => tool.name);
        ALL.forEach((name) => assert.ok(names.includes(name), `${name} missing`));
        assert.ok(!names.some((name) => name.startsWith('workspace_') || name === 'timeline_workspace_set'));
        assert.match(mcp.list().find((tool) => tool.name === 'timeline_marker_add')!.description, /changes the project/);
    } finally {
        mcp.dispose();
    }
});

test('markers: add, list, update, goto, remove via extras.markers', async () => {
    const { ctx, state } = createTestContext({ playheadPosition: 2 });
    const mcp = await createMcpHarness(ctx);
    try {
        const first = await mcp.call('timeline_marker_add', { name: 'Intro', color: 'red' });
        assert.equal(first.created, true);
        await mcp.call('timeline_marker_add', { time: '00:00:05:12', comment: 'Drop' });
        const again = await mcp.call('timeline_marker_add', { time: 2 });
        assert.equal(again.created, false);
        const list = await mcp.call('timeline_marker_list');
        const markers = list.markers as Array<{ id: string; time: number; name: string; color: string }>;
        assert.deepEqual(markers.map((m) => m.time), [2, 5.5]);
        assert.equal((state.extras.markers as unknown[]).length, 2);

        const updated = await mcp.call('timeline_marker_update', { markerId: markers[1].id, name: 'Refrain', color: 'blue', duration: 1 });
        assert.equal((updated.marker as { name: string }).name, 'Refrain');
        const badColor = await mcp.call('timeline_marker_update', { markerId: markers[1].id, color: 'pink' });
        assert.equal(badColor.ok, false);

        state.playheadPosition = 0;
        const next = await mcp.call('timeline_marker_goto', { direction: 'next' });
        assert.equal(next.playhead, 2);
        await mcp.call('timeline_marker_goto', { direction: 'next' });
        assert.equal(state.playheadPosition, 5.5);
        const prev = await mcp.call('timeline_marker_goto', { direction: 'previous' });
        assert.equal(prev.playhead, 2);

        const removed = await mcp.call('timeline_marker_remove', { markerId: markers[0].id });
        assert.equal(removed.count, 1);
        assert.equal((await mcp.call('timeline_marker_remove', { markerId: 'nope' })).ok, false);
    } finally {
        mcp.dispose();
    }
});

test('playhead, edit points, ripple delete, lift and extract', async () => {
    const { ctx, state } = createTestContext({
        timelineTracks: tracks,
        timelineClips: [clip('a', 'v1', 0, 4), clip('b', 'v1', 4, 8), clip('c', 'v1', 8, 12), clip('s', 'a1', 0, 12)],
        selectedClipId: 'b',
        extras: { markers: [{ id: 'mk', time: 10, name: '', color: 'green', comment: '', duration: 0 }] },
    });
    const mcp = await createMcpHarness(ctx);
    try {
        assert.equal((await mcp.call('timeline_set_playhead', { time: '00:00:01:00' })).playhead, 1);
        assert.equal((await mcp.call('timeline_set_playhead', { time: '+12' })).playhead, 1.5);
        // Plain number strings are seconds (agents), not typed frames.
        assert.equal((await mcp.call('timeline_set_playhead', { time: '4' })).playhead, 4);
        assert.equal((await mcp.call('timeline_set_playhead', { time: '2.5' })).playhead, 2.5);
        assert.equal((await mcp.call('timeline_goto_edit_point', { direction: 'next' })).playhead, 4);
        assert.equal((await mcp.call('timeline_goto_edit_point', { direction: 'previous' })).playhead, 0);

        const ripple = await mcp.call('timeline_ripple_delete', {});
        assert.equal(ripple.removed, 'b');
        assert.deepEqual(state.timelineClips.filter((c) => c.trackId === 'v1').map((c) => [c.id, c.start]), [['a', 0], ['c', 4]]);
        assert.equal(state.selectedClipId, null);

        const lift = await mcp.call('timeline_lift', { in: 1, out: 2 });
        assert.equal(lift.changed, true);
        assert.deepEqual(lift.trackIds, ['v1']);
        assert.equal(state.timelineClips.filter((c) => c.trackId === 'v1').length, 3);

        const extract = await mcp.call('timeline_extract', { in: '00:00:05:00', out: '00:00:06:00', trackIds: ['v1', 'a1'] });
        assert.equal(extract.changed, true);
        assert.deepEqual(state.timelineClips.filter((c) => c.trackId === 'a1').map((c) => [c.start, c.end]).sort((x, y) => x[0] - y[0]), [[0, 5], [5, 11]]);
        assert.equal((state.extras.markers as Array<{ time: number }>)[0].time, 9);

        const noRange = await mcp.call('timeline_lift', {});
        assert.equal(noRange.ok, false);
    } finally {
        mcp.dispose();
    }
});

test('editor UI tools go through live commands; mode switch sets the workspace', async () => {
    const { ctx, state } = createTestContext({ timelineTracks: tracks });
    const calls: Array<[string, Record<string, unknown>]> = [];
    const record = (name: string) => (args: Record<string, unknown>) => { calls.push([name, args]); return { handled: name, ...args }; };
    const dispose = registerLiveCommands(Object.fromEntries(Object.values(EDIT_LIVE).map((name) => [name, record(name)])));
    const mcp = await createMcpHarness(ctx);
    try {
        assert.equal((await mcp.call('timeline_editor_state')).handled, EDIT_LIVE.state);
        await mcp.call('timeline_set_in_out', { in: '00:00:01:00', out: 3 });
        assert.deepEqual(calls.at(-1), [EDIT_LIVE.inOut, { in: 1, out: 3 }]);
        await mcp.call('timeline_set_in_out', { clear: true });
        assert.deepEqual(calls.at(-1), [EDIT_LIVE.inOut, { in: null, out: null }]);
        await mcp.call('timeline_set_playback_resolution', { program: 'half' });
        assert.equal(calls.at(-1)![1].program, 'half');
        await mcp.call('timeline_shuttle', { rate: 2 });
        assert.equal(calls.at(-1)![1].rate, 2);
        await mcp.call('timeline_linked_selection', { enabled: true });
        assert.equal(calls.at(-1)![1].enabled, true);
        await mcp.call('timeline_track_height', { step: 1 });
        assert.equal(calls.at(-1)![0], EDIT_LIVE.trackHeight);
        await mcp.call('timeline_zoom', { direction: 'fit' });
        assert.equal(calls.at(-1)![0], EDIT_LIVE.zoom);
        await mcp.call('timeline_source_edit', { mode: 'overwrite' });
        assert.equal(calls.at(-1)![1].mode, 'overwrite');
        const layout = await mcp.call('timeline_layout_set', { layout: 'farbe' });
        assert.equal(layout.layout, 'farbe');
        assert.equal(calls.at(-1)![1].workspace, 'color');
        assert.equal((await mcp.call('timeline_layout_set', { layout: 'nope' })).ok, false);

        // Lift without explicit range reads the editor's program In/Out.
        dispose();
        const disposeState = registerLiveCommands({ [EDIT_LIVE.state]: () => ({ programIn: 2, programOut: 3 }), [EDIT_LIVE.inOut]: () => ({}) });
        state.timelineClips = [clip('x', 'v1', 0, 5)];
        const lift = await mcp.call('timeline_lift', {});
        assert.equal(lift.in, 2);
        assert.equal(lift.out, 3);
        disposeState();

        await mcp.call('timeline_mode_switch', { mode: 'exportieren' });
        assert.equal(state.activeWorkspace, 'EXPORT');
        await mcp.call('timeline_mode_switch', { mode: 'importieren' });
        assert.equal(state.activeWorkspace, 'IMPORT');
        assert.equal((await mcp.call('timeline_mode_switch', { mode: 'x' })).ok, false);
    } finally {
        dispose();
        mcp.dispose();
    }
});

test('list and select clips by id or by time', async () => {
    const v2 = { id: 'v2', name: 'V2', type: 'video' as const, isLocked: false, isMuted: false, isTargeted: false };
    const { ctx, state } = createTestContext({
        timelineTracks: [...tracks, v2],
        timelineClips: [clip('c1', 'v1', 0, 5), clip('c2', 'v1', 5, 9), clip('t1', 'v2', 4, 6), clip('a1', 'a1', 0, 9)],
        mediaItems: [{ id: 'm-c1', name: 'cliff.mp4', type: 'video', url: 'x' } as never],
    });
    const mcp = await createMcpHarness(ctx);
    try {
        const all = await mcp.call('timeline_list_clips');
        assert.equal((all.clips as unknown[]).length, 4);
        assert.equal((all.clips as Array<{ name: string }>)[0].name, 'cliff.mp4');
        assert.equal((all.tracks as unknown[]).length, 3);
        const under = await mcp.call('timeline_list_clips', { time: 5.5 });
        assert.deepEqual((under.clips as Array<{ id: string }>).map((c) => c.id).sort(), ['a1', 'c2', 't1']);
        const onTrack = await mcp.call('timeline_list_clips', { trackId: 'v1' });
        assert.deepEqual((onTrack.clips as Array<{ id: string }>).map((c) => c.id), ['c1', 'c2']);

        const byTime = await mcp.call('timeline_select_clip', { time: 5, moveTo: 'start' });
        assert.equal(byTime.selectedClipId, 't1', 'topmost video track wins');
        assert.equal(state.selectedClipId, 't1');
        assert.equal(state.playheadPosition, 4);
        await mcp.call('timeline_select_clip', { clipId: 'c1' });
        assert.equal(state.selectedClipId, 'c1');
        assert.equal((await mcp.call('timeline_select_clip', { clipId: 'nope' })).ok, false);
        assert.equal((await mcp.call('timeline_select_clip', { time: 50 })).ok, false);
    } finally {
        mcp.dispose();
    }
});

test('plain number strings are seconds for markers', async () => {
    const { ctx } = createTestContext({ timelineTracks: tracks, timelineClips: [clip('c1', 'v1', 0, 30)] });
    const mcp = await createMcpHarness(ctx);
    try {
        const plain = await mcp.call('timeline_marker_add', { time: '16', name: 'Plain seconds' });
        assert.equal((plain.marker as { time: number }).time, 16, '"16" means 16 seconds, not 16 frames');
        const decimal = await mcp.call('timeline_marker_add', { time: '5.5', name: 'Decimal' });
        assert.equal((decimal.marker as { time: number }).time, 5.5);
    } finally {
        mcp.dispose();
    }
});
