import test from 'node:test';
import assert from 'node:assert/strict';

import './exportTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';
import { dispatchExportCommand, getExportState, resetExportStoreForTests } from '../../workspaces/export-pro/exportStore.ts';
import type { TimelineClip } from '../../types.ts';

const clip = (id: string, end: number): TimelineClip => ({ id, mediaId: 'm1', trackId: 'v1', start: 0, end, duration: end, speed: 1, effect: null });

const TOOLS = [
    'export_presets_list', 'export_settings_get', 'export_settings_set', 'export_estimate',
    'export_queue_add', 'export_queue_list', 'export_queue_remove', 'export_queue_render_all',
    'export_queue_cancel', 'export_view_set',
];

test('export tools are published with schemas', async () => {
    resetExportStoreForTests();
    const { ctx } = createTestContext();
    const mcp = await createMcpHarness(ctx);
    try {
        const names = mcp.list().map((tool) => tool.name);
        for (const name of TOOLS) assert.ok(names.includes(name), `${name} missing`);
        assert.match(mcp.list().find((tool) => tool.name === 'export_queue_add')!.description, /changes the project/);
    } finally {
        mcp.dispose();
    }
});

test('presets, settings, estimate and view over MCP', async () => {
    resetExportStoreForTests();
    const { ctx, state } = createTestContext({ timelineClips: [clip('c1', 60)] });
    const mcp = await createMcpHarness(ctx);
    try {
        const presets = await mcp.call('export_presets_list');
        assert.ok((presets.presets as Array<{ id: string }>).some((preset) => preset.id === 'prores-4444'));

        const set = await mcp.call('export_settings_set', {
            presetId: 'youtube-1080',
            filename: 'opener-final',
            destinations: { audio: true },
            range: { mode: 'inout', inPoint: 10, outPoint: 40 },
            effects: { timecode: { enabled: true } },
        });
        assert.equal(set.ok, true);
        const got = await mcp.call('export_settings_get');
        const settings = got.settings as { presetId: string; filename: string; range: { mode: string }; effects: { timecode: { enabled: boolean; position: string } } };
        assert.equal(settings.presetId, 'youtube-1080');
        assert.equal(settings.filename, 'opener-final');
        assert.equal(settings.range.mode, 'inout');
        assert.equal(settings.effects.timecode.enabled, true);
        assert.equal(settings.effects.timecode.position, 'bottom-center', 'nested patch keeps other fields');
        assert.equal((got.enabledDestinations as Record<string, boolean>).audio, true);

        const estimate = await mcp.call('export_estimate', { kind: 'media' });
        // 16 Mbit/s + 320 kbit/s for 30 s
        assert.equal(estimate.bytes, Math.round(((16_000_000 + 320_000) * 30 / 8) * 1.01));
        assert.equal((estimate.range as { duration: number }).duration, 30);

        await mcp.call('export_settings_set', { video: { bitrateKbps: 8000 } });
        assert.equal(getExportState().settings.presetId, 'custom');

        const view = await mcp.call('export_view_set', { view: 'davinci', open: true });
        assert.equal(view.view, 'davinci');
        assert.equal(state.activeWorkspace, 'EXPORT');

        const bad = await mcp.call('export_settings_set', { presetId: 'nope' });
        assert.equal(bad.ok, false);
    } finally {
        mcp.dispose();
    }
});

test('queue add / list / render / cancel / remove over MCP', async () => {
    resetExportStoreForTests();
    const { ctx } = createTestContext({ timelineClips: [clip('c1', 12)], playheadPosition: 3 });
    const mcp = await createMcpHarness(ctx);
    // Simulates the mounted Export page (ExportWorkspace registers these live commands).
    const dispose = registerLiveCommands({
        'export.queue.renderAll': () => dispatchExportCommand('export.queue.renderAll', {}),
        'export.queue.renderJob': (args) => dispatchExportCommand('export.queue.renderJob', { jobId: String(args.jobId) }),
        'export.queue.cancel': () => dispatchExportCommand('export.queue.cancel', {}),
    });
    try {
        const added = await mcp.call('export_queue_add', { kinds: ['media', 'still'] });
        const jobIds = added.jobIds as string[];
        assert.equal(jobIds.length, 2);
        const listed = await mcp.call('export_queue_list');
        const jobs = listed.jobs as Array<{ id: string; kind: string; status: string; range: { start: number } }>;
        assert.deepEqual(jobs.map((job) => job.kind), ['media', 'still']);
        assert.equal(jobs[1].range.start, 3, 'still uses the playhead');

        const render = await mcp.call('export_queue_render_all', { jobId: jobIds[0] });
        assert.deepEqual(render.scope, [jobIds[0]]);
        assert.equal(getExportState().runner.active, true);

        await mcp.call('export_queue_cancel');
        assert.equal(getExportState().runner.active, false);

        const removed = await mcp.call('export_queue_remove', { jobId: jobIds[1] });
        assert.equal(removed.remaining, 1);
        const missing = await mcp.call('export_queue_remove', { jobId: 'nope' });
        assert.equal(missing.ok, false);
        await mcp.call('export_queue_render_all');
        assert.equal(getExportState().runner.jobIds, null);
    } finally {
        dispose();
        mcp.dispose();
    }
});
