import test from 'node:test';
import assert from 'node:assert/strict';

import './imageGenTools.ts';
import './videoGenTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';
import { applySettings, snapshotSettings, type LiveSetting } from '../livePageCore.ts';

/** Simulates a mounted page that uses the live-page protocol. */
function fakePage(ns: string, onAction: (action: string, args: Record<string, unknown>) => unknown) {
  const values: Record<string, unknown> = { prompt: '', modelId: 'gemini-pro', imageSize: '2K' };
  const settings: Record<string, LiveSetting> = {
    prompt: { value: '', set: ((v: string) => { values.prompt = v; }) as never, type: 'string' },
    modelId: { value: '', set: ((v: string) => { values.modelId = v; }) as never, type: 'string', options: ['gemini-pro', 'flux-pro'] },
    imageSize: { value: '', set: ((v: string) => { values.imageSize = v; }) as never, type: 'string', options: ['1K', '2K', '4K'] },
  };
  const sync = () => { for (const key of Object.keys(settings)) settings[key].value = values[key]; return snapshotSettings(settings); };
  const dispose = registerLiveCommands({
    [`${ns}.get`]: () => ({ settings: sync(), info: { status: 'idle' } }),
    [`${ns}.set`]: (args) => ({ changed: applySettings(settings, args.settings), settings: sync() }),
    [`${ns}.action`]: async (args) => {
      applySettings(settings, args.settings);
      const result = await onAction(String(args.action), args.args as Record<string, unknown>);
      return { result, settings: sync(), info: { status: 'Model failed: quota' } };
    },
  });
  return { values, dispose };
}

test('image and video page tools are published with paid/destructive markers', async () => {
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    const byName = new Map(mcp.list().map((tool) => [tool.name, tool]));
    for (const name of ['image_gen_get_state', 'image_gen_set', 'image_gen_generate', 'image_gen_relight', 'image_gen_add_reference', 'image_gen_director_plan', 'image_gen_start_lora_training', 'image_gen_comfy_start', 'image_gen_comfy_export_workflow', 'video_gen_get_state', 'video_gen_set', 'video_gen_generate', 'video_gen_set_frame', 'video_gen_set_audio', 'video_gen_burst_apply', 'video_gen_burst_analyze']) {
      assert.ok(byName.has(name), `${name} missing`);
    }
    assert.match(byName.get('image_gen_generate')!.description, /KOSTET CREDITS/);
    assert.match(byName.get('video_gen_generate')!.description, /KOSTET CREDITS/);
    assert.match(byName.get('image_gen_clear_moodboard')!.description, /LÖSCHT/);
    assert.doesNotMatch(byName.get('image_gen_get_state')!.description, /KOSTET/);
  } finally {
    mcp.dispose();
  }
});

test('settings are validated; generate returns the new media item', async () => {
  const { ctx, state } = createTestContext();
  const page = fakePage('image_gen', (action) => {
    if (action === 'generate') state.mediaItems = [...state.mediaItems, { id: 'img-new', name: 'a.png', type: 'image', url: 'blob:a', source: 'generated' }];
    return null;
  });
  const mcp = await createMcpHarness(ctx);
  try {
    const bad = await mcp.call('image_gen_set', { settings: { modelId: 'nope' } });
    assert.equal(bad.ok, false);
    assert.match(String(bad.message), /must be one of/);
    const unknown = await mcp.call('image_gen_set', { settings: { colour: 'red' } });
    assert.match(String(unknown.message), /Unknown setting/);

    const generated = await mcp.call('image_gen_generate', { confirm: true,  settings: { prompt: 'Neon stage, crowd', modelId: 'flux-pro' } });
    assert.equal(page.values.prompt, 'Neon stage, crowd');
    assert.equal((generated.mediaItems as Array<{ id: string }>)[0].id, 'img-new');
    assert.equal(state.activeWorkspace, 'EDIT', 'page was mounted: no navigation');
  } finally {
    page.dispose();
    mcp.dispose();
  }
});

test('a generate that adds nothing reports the page status as error', async () => {
  const { ctx } = createTestContext();
  const page = fakePage('video_gen', () => null);
  const mcp = await createMcpHarness(ctx);
  try {
    const failed = await mcp.call('video_gen_generate', { confirm: true,  settings: { prompt: 'x' } });
    assert.equal(failed.ok, false);
    assert.match(String(failed.message), /quota/);
  } finally {
    page.dispose();
    mcp.dispose();
  }
});

test('tools open the page when it is not mounted', async () => {
  const { ctx, state } = createTestContext();
  let page: ReturnType<typeof fakePage> | null = null;
  const original = ctx.actions.setActiveWorkspace;
  ctx.actions.setActiveWorkspace = (workspace) => {
    original(workspace);
    setTimeout(() => { page = fakePage('video_gen', () => ({ target: 'start' })); }, 20);
  };
  const mcp = await createMcpHarness(ctx);
  try {
    const result = await mcp.call('video_gen_set_frame', { target: 'start', url: 'https://x/frame.jpg' });
    assert.equal(result.ok, true);
    assert.equal(state.activeWorkspace, 'VIDEO_GEN');
  } finally {
    (page as ReturnType<typeof fakePage> | null)?.dispose();
    mcp.dispose();
  }
});
