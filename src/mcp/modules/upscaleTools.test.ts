import test from 'node:test';
import assert from 'node:assert/strict';

import './upscaleTools.ts';
import { applySettingsArgs, estimateFor } from './upscaleTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';
import { DEFAULT_SETTINGS } from '../../workspaces/upscale-pro/upscaleOps.ts';
import type { MediaItem } from '../../types.ts';

const TOOLS = [
  'upscale_models_list', 'upscale_estimate', 'upscale_state_get', 'upscale_input_add', 'upscale_settings_set',
  'upscale_view_set', 'upscale_preview_render', 'upscale_queue_add', 'upscale_queue_list', 'upscale_queue_cancel',
];

const media: MediaItem[] = [
  { id: 'v1', name: 'clip.mp4', type: 'video', url: 'blob:clip', source: 'upload', duration: 6 },
  { id: 'a1', name: 'song.wav', type: 'audio', url: 'blob:song', source: 'upload' },
];

/** Stand-in for the mounted Upscale page (mock provider: no credits). */
const fakePage = () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let settings = structuredClone(DEFAULT_SETTINGS);
  const jobs: Array<{ id: string; status: string; purpose: string; mock: boolean }> = [];
  const record = (name: string) => (args: Record<string, unknown>) => { calls.push({ name, args }); return undefined; };
  const dispose = registerLiveCommands({
    'upscale.state.get': () => ({ inputs: [], settings }),
    'upscale.estimate': (args) => ({ ...estimateFor(applySettingsArgs(settings, args), { kind: 'video', width: 1920, height: 1080, fps: 24, seconds: 6 }), mediaId: args.mediaId }),
    'upscale.input.add': (args) => { record('input')(args); return { inputId: `in-${args.mediaId}` }; },
    'upscale.settings.set': (args) => { settings = applySettingsArgs(settings, args); return { settings }; },
    'upscale.view.set': (args) => { record('view')(args); return { view: args }; },
    'upscale.preview.render': (args) => { const job = { id: `p${jobs.length}`, status: 'queued', purpose: 'preview', mock: true }; jobs.push(job); record('preview')(args); return { jobId: job.id, mock: true }; },
    'upscale.queue.add': (args) => { const job = { id: `j${jobs.length}`, status: 'queued', purpose: 'export', mock: true }; jobs.push(job); record('queue')(args); return { jobId: job.id, mock: true }; },
    'upscale.queue.list': () => ({ jobs }),
    'upscale.queue.cancel': (args) => { jobs.forEach((job) => { if (args.all || job.id === args.jobId) job.status = 'cancelled'; }); return { cancelled: jobs.filter((j) => j.status === 'cancelled').map((j) => j.id) }; },
  });
  return { calls, dispose, getSettings: () => settings };
};

test('upscale tools are published with schemas; paid tools are marked as writes', async () => {
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    const listed = mcp.list();
    for (const name of TOOLS) assert.ok(listed.some((tool) => tool.name === name), `${name} missing`);
    const queueAdd = listed.find((tool) => tool.name === 'upscale_queue_add')!;
    assert.match(queueAdd.description, /confirm: true/);
    assert.match(queueAdd.description, /changes the project/);
  } finally {
    mcp.dispose();
  }
});

test('models list and standalone estimate need no page', async () => {
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    const models = await mcp.call('upscale_models_list', { kind: 'video' });
    assert.ok((models.enhancement as Array<{ kind: string }>).every((m) => m.kind === 'video'));
    assert.equal((models.hdr as unknown[]).length, 2);

    const estimate = await mcp.call('upscale_estimate', { kind: 'video', sourceWidth: 1920, sourceHeight: 1080, seconds: 4, fps: 25, preset: '8k', model: 'topaz-video', interpolate: true, grain: 0.3 });
    const output = estimate.output as { width: number; height: number; fps: number; limited: boolean };
    assert.deepEqual([output.width, output.height, output.fps, output.limited], [3840, 2160, 50, true]);
    assert.ok((estimate.estimatedUsd as number) > 0);
    assert.ok((estimate.estimatedBytes as number) > 0);

    const image = await mcp.call('upscale_estimate', { kind: 'image', sourceWidth: 1000, sourceHeight: 800, scale: 4, model: 'real-esrgan' });
    assert.deepEqual([(image.output as { width: number }).width, (image.output as { height: number }).height], [4000, 3200]);
    const bad = await mcp.call('upscale_estimate', { kind: 'image', sourceWidth: 10, sourceHeight: 10, model: 'nope' });
    assert.equal(bad.ok, false);
  } finally {
    mcp.dispose();
  }
});

test('page tools go through live commands; paid tools require confirm', async () => {
  const { ctx, state } = createTestContext({ mediaItems: media });
  const page = fakePage();
  const mcp = await createMcpHarness(ctx);
  try {
    const added = await mcp.call('upscale_input_add', { mediaId: 'v1' });
    assert.equal(added.inputId, 'in-v1');
    assert.equal((await mcp.call('upscale_input_add', { mediaId: 'a1' })).ok, false);
    assert.equal((await mcp.call('upscale_input_add', { mediaId: 'zz' })).ok, false);

    const set = await mcp.call('upscale_settings_set', { preset: '4k', model: 'crystal-video', grain: 0.4, grainSize: 2 });
    assert.equal(page.getSettings().output.mode, 'preset');
    assert.equal(page.getSettings().enhance.videoModel, 'crystal-video');
    assert.equal(page.getSettings().post.grain, 0.4);
    assert.ok(set.settings);

    const state1 = await mcp.call('upscale_state_get');
    assert.ok(state1.settings);
    await mcp.call('upscale_view_set', { mode: 'wipe', wipe: 0.3, zoom: '2' });
    assert.equal(page.calls.find((c) => c.name === 'view')?.args.mode, 'wipe');

    const viaPage = await mcp.call('upscale_estimate', { mediaId: 'v1' });
    assert.equal(viaPage.mediaId, 'v1');

    const refused = await mcp.call('upscale_queue_add', { mediaId: 'v1' });
    assert.equal(refused.ok, false);
    assert.match(String(refused.message), /confirm: true/);
    const refusedPreview = await mcp.call('upscale_preview_render', { lengthSeconds: 1 });
    assert.equal(refusedPreview.ok, false);
    assert.equal(page.calls.filter((c) => c.name === 'queue' || c.name === 'preview').length, 0);

    const queued = await mcp.call('upscale_queue_add', { mediaId: 'v1', confirm: true, scale: 2 });
    assert.equal(queued.mock, true);
    await mcp.call('upscale_preview_render', { lengthSeconds: 0, confirm: true });
    const list = await mcp.call('upscale_queue_list');
    assert.equal((list.jobs as unknown[]).length, 2);
    const cancel = await mcp.call('upscale_queue_cancel', { jobId: queued.jobId });
    assert.deepEqual(cancel.cancelled, [queued.jobId]);
    assert.equal((await mcp.call('upscale_queue_cancel', {})).ok, false);
    assert.equal(state.activeWorkspace, 'EDIT'); // page was "mounted": no navigation needed
  } finally {
    mcp.dispose();
    page.dispose();
  }
});

test('page tools open the Upscale workspace when the page is not mounted', async () => {
  const { ctx, state } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    const pending = mcp.call('upscale_state_get');
    // The tool asked the app to open the page; simulate the page mounting.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(state.activeWorkspace, 'UPSCALE');
    const dispose = registerLiveCommands({ 'upscale.state.get': () => ({ inputs: [] }) });
    const result = await pending;
    assert.deepEqual(result.inputs, []);
    dispose();
  } finally {
    mcp.dispose();
  }
});
